// A conta de cada pessoa: esquecer a senha, trocar a senha, confirmar o
// e-mail — e o link de senha nova que quem administra a equipe gera.
//
// ── o link é o convite de novo ───────────────────────────────
// Mesmo esquema do convite (convite.ts): o link leva 32 bytes aleatórios, o
// banco guarda só o SHA-256 (`tokens_conta.hash`). Vazou o banco, os links
// em aberto continuam inúteis. Cada link serve UMA vez, vence sozinho, e
// pedir outro apaga o anterior — um link vivo por pessoa e por tipo.
//
//   senha, pedido por e-mail    30 minutos (a pessoa está com a caixa aberta)
//   senha, gerado na Equipe     24 horas (passa de mão em mão, pelo WhatsApp,
//                               e a pessoa pode estar de folga)
//   confirmar o e-mail          48 horas (o cadastro acabou de ser feito e
//                               ninguém lê e-mail na hora)
//
// ── "esqueci a senha" não pode virar lista de clientes ───────
// A resposta da tela é SEMPRE a mesma frase, exista a conta ou não, e o
// trabalho de verdade (procurar a pessoa, gerar o link, mandar o e-mail)
// acontece DEPOIS da resposta (`after`, na ação) — nem o tempo de resposta
// diz se o e-mail tem conta. O freio conta o e-mail DIGITADO, como o do
// login (limite.ts): "este foi bloqueado, aquele não" também entregaria
// quem existe.
//
// ── trocou a senha, todo mundo sai ───────────────────────────
// Redefinir ou trocar a senha empurra `sessoesDesde` para agora, na MESMA
// transação que grava a senha nova: o cookie de quem estava dentro (inclusive
// o de quem roubou a senha antiga) morre na próxima tela. Quem trocou a
// própria senha ganha um cookie novo na hora (a ação abre de novo), então só
// os OUTROS aparelhos saem.

import { randomBytes } from 'node:crypto'
import type { TipoTokenConta } from '@prisma/client'
import { acharOrgPorSlug, comoOrg } from './banco'
import { resumirToken } from './convite'
import { normalizar } from './autenticacao'
import { conferirSenha, guardarSenha } from './senha'
import { reservarTentativa, concluirTentativa } from './limite'
import { emailConfigurado, enviarEmail } from './email'
import { emailConfirmarCadastro, emailRedefinirSenha, emailSenhaAlterada } from './email-modelos'
import { liberarVaga } from './presenca'
import { podeMexerEm } from './equipe'
import { exigir, exigirQueNaoSejaSuporte, type Papel, type Sessao } from './permissao'

export const VALE_SENHA_MIN = 30
export const VALE_LINK_EQUIPE_H = 24
export const VALE_CONFIRMACAO_H = 48

/** Janela do freio dos pedidos públicos (esqueci a senha, reenviar confirmação). */
export const JANELA_PEDIDO_MIN = 60
/** Pedidos por e-mail digitado na janela — é a caixa de alguém que está recebendo. */
export const MAX_PEDIDOS_POR_EMAIL = 3
/** Pedidos por endereço de rede na janela, somando os e-mails. */
export const MAX_PEDIDOS_POR_IP = 10

const MIN = 60_000
const HORA = 60 * MIN

function novoToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: resumirToken(token) }
}

/** Token que chega do navegador: só a forma de um base64url de 32 bytes passa. */
const tokenComForma = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t)

// ─────────────────────────────────────────────────────────────
// O FREIO DOS PEDIDOS PÚBLICOS
// ─────────────────────────────────────────────────────────────

export type FreioPedido = { bloqueado: false } | { bloqueado: true; esperarMin: number }

/**
 * Este pedido pode acontecer? Se pode, já fica contado.
 *
 * O desenho é o do freio do login (limite.ts): contar e anotar num passo só,
 * dentro da trava do Postgres por e-mail e por endereço — senão dez pedidos
 * simultâneos passariam os dez pela contagem de três. A contagem por e-mail
 * soma os dois tipos: é a mesma caixa de entrada recebendo.
 */
export async function reservarPedido(
  orgId: string,
  tipo: TipoTokenConta,
  emailDigitado: string,
  ip: string | null,
  agora = new Date(),
): Promise<FreioPedido> {
  const email = normalizar(emailDigitado).slice(0, 254)
  const desde = new Date(agora.getTime() - JANELA_PEDIDO_MIN * MIN)
  const faltam = (maisAntigo: Date) =>
    Math.max(1, Math.ceil((maisAntigo.getTime() + JANELA_PEDIDO_MIN * MIN - agora.getTime()) / MIN))

  return comoOrg(orgId, async (db) => {
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`pedido:email:${orgId}:${email}`}))`
    if (ip) await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`pedido:ip:${orgId}:${ip}`}))`

    const doEmail = await db.pedidoConta.findMany({
      where: { email, criadoEm: { gt: desde } },
      orderBy: { criadoEm: 'asc' },
      select: { criadoEm: true },
    })
    if (doEmail.length >= MAX_PEDIDOS_POR_EMAIL) return { bloqueado: true as const, esperarMin: faltam(doEmail[0]!.criadoEm) }

    if (ip) {
      const doIp = await db.pedidoConta.findMany({
        where: { ip, criadoEm: { gt: desde } },
        orderBy: { criadoEm: 'asc' },
        select: { criadoEm: true },
      })
      if (doIp.length >= MAX_PEDIDOS_POR_IP) return { bloqueado: true as const, esperarMin: faltam(doIp[0]!.criadoEm) }
    }

    await db.pedidoConta.create({ data: { orgId, tipo, email, ip, criadoEm: agora } })
    // Limpeza de carona: pedido de ontem não freia ninguém.
    await db.pedidoConta.deleteMany({ where: { criadoEm: { lt: new Date(agora.getTime() - 24 * HORA) } } })
    return { bloqueado: false as const }
  })
}

// ─────────────────────────────────────────────────────────────
// ESQUECI A SENHA
// ─────────────────────────────────────────────────────────────

/** O que aconteceu de verdade. NUNCA vai para a tela — só para o teste e o log. */
export type Desfecho = 'enviado' | 'sem_conta' | 'nao_configurado' | 'falhou'

/**
 * Procura a pessoa e, se ela existe e está ativa, manda o link de senha nova.
 *
 * Roda DEPOIS da resposta (a ação chama com `after`). Não lança: um erro
 * aqui não tem mais tela para aparecer, então vira linha no log.
 *
 * `base` é o endereço público do Norte (NORTE_URL), NÃO o Host da
 * requisição — ver `enderecoPublico` em requisicao.ts.
 */
export async function enviarLinkDeSenha(
  orgId: string,
  emailDigitado: string,
  base: string,
  ip: string | null,
): Promise<Desfecho> {
  const email = normalizar(emailDigitado)
  if (!emailConfigurado()) return 'nao_configurado'
  try {
    const achado = await comoOrg(orgId, async (db) => {
      const org = await db.org.findUnique({ where: { id: orgId }, select: { nome: true, slug: true, situacao: true } })
      if (!org || org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') return null
      const pessoa = await db.usuario.findUnique({
        where: { orgId_email: { orgId, email } },
        select: { id: true, nome: true, ativo: true },
      })
      // Conta desativada fica calada como conta que não existe: quem saiu da
      // empresa não recupera o acesso por aqui.
      if (!pessoa || !pessoa.ativo) return null

      const { token, hash } = novoToken()
      // Um link vivo por vez: pedir de novo apaga o anterior.
      await db.tokenConta.deleteMany({ where: { usuarioId: pessoa.id, tipo: 'SENHA', usadoEm: null } })
      await db.tokenConta.create({
        data: { orgId, usuarioId: pessoa.id, tipo: 'SENHA', hash, ip, expiraEm: new Date(Date.now() + VALE_SENHA_MIN * MIN) },
      })
      return { org, pessoa, token }
    })
    if (!achado) return 'sem_conta'

    const r = await enviarEmail(
      emailRedefinirSenha({
        para: email,
        nome: achado.pessoa.nome,
        empresa: achado.org.nome,
        link: `${base}/${achado.org.slug}/redefinir-senha?t=${achado.token}`,
        validadeMin: VALE_SENHA_MIN,
      }),
    )
    return r.ok ? 'enviado' : 'falhou'
  } catch (e) {
    console.error('[conta] o link de senha não pôde ser preparado:', e instanceof Error ? e.name : 'erro')
    return 'falhou'
  }
}

export type Redefinicao =
  | { ok: true; usuarioId: string; nome: string; email: string; empresa: string }
  | { ok: false; motivo: 'invalido' | 'vencido' | 'ja_usado' | 'empresa_suspensa' }

/**
 * Grava a senha nova de quem tem o link.
 *
 * `invalido` cobre token errado, token de OUTRA empresa (o RLS nem deixa ver)
 * e conta desativada — de propósito, a mesma resposta: quem está tentando
 * não descobre qual dos três é.
 *
 * Lança o erro de senha fraca de `guardarSenha` (frase de gente, a tela
 * mostra) ANTES de tocar no link: senha curta não gasta o link.
 */
export async function redefinirSenha(slug: string, token: string, novaSenha: string): Promise<Redefinicao> {
  const org = await acharOrgPorSlug(slug)
  if (!org || !tokenComForma(token)) return { ok: false, motivo: 'invalido' }
  if (org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') return { ok: false, motivo: 'empresa_suspensa' }

  const senhaHash = await guardarSenha(novaSenha)
  const agora = new Date()

  const r = await comoOrg(org.id, async (db): Promise<Redefinicao> => {
    const t = await db.tokenConta.findUnique({
      where: { hash: resumirToken(token) },
      select: {
        id: true, tipo: true, expiraEm: true, usadoEm: true,
        usuario: { select: { id: true, nome: true, email: true, ativo: true } },
      },
    })
    if (!t || t.tipo !== 'SENHA' || !t.usuario.ativo) return { ok: false, motivo: 'invalido' }
    if (t.usadoEm) return { ok: false, motivo: 'ja_usado' }
    if (t.expiraEm <= agora) return { ok: false, motivo: 'vencido' }

    // Marca como usado SÓ se ainda não estava: dois envios ao mesmo tempo
    // com o mesmo link, o segundo espera a trava da linha e acha zero.
    const marcado = await db.tokenConta.updateMany({ where: { id: t.id, usadoEm: null }, data: { usadoEm: agora } })
    if (marcado.count === 0) return { ok: false, motivo: 'ja_usado' }
    await db.tokenConta.deleteMany({ where: { usuarioId: t.usuario.id, tipo: 'SENHA', usadoEm: null } })

    await db.usuario.update({
      where: { id: t.usuario.id },
      // O link chegou por um caminho que prova o e-mail (ou por quem gere a
      // equipe, que responde por ele): a conta deixa de esperar confirmação.
      data: { senhaHash, sessoesDesde: agora, emailPendente: false },
    })
    await db.auditoria.create({
      data: {
        orgId: org.id,
        usuarioId: t.usuario.id,
        quem: t.usuario.nome,
        acao: 'conta.senha.redefiniu',
        alvoTipo: 'usuario',
        alvoId: t.usuario.id,
        alvoNome: t.usuario.nome,
        // Nada da senha nem do link. Só o fato, e que as sessões caíram.
        depois: { sessoesEncerradas: true },
      },
    })
    return { ok: true, usuarioId: t.usuario.id, nome: t.usuario.nome, email: t.usuario.email, empresa: org.nome }
  })

  // A vaga de quem estava dentro volta na hora — a sessão dela acabou de morrer.
  if (r.ok) await liberarVaga(org.id, r.usuarioId).catch(() => {})
  return r
}

/** O aviso de "a sua senha foi trocada". Não lança. */
export async function avisarSenhaTrocada(d: { para: string; nome: string; empresa: string; slug: string; base: string }) {
  if (!emailConfigurado()) return
  await enviarEmail(
    emailSenhaAlterada({ para: d.para, nome: d.nome, empresa: d.empresa, quando: new Date(), linkEntrar: `${d.base}/${d.slug}/entrar` }),
  ).catch(() => {})
}

// ─────────────────────────────────────────────────────────────
// O LINK QUE QUEM GERE A EQUIPE GERA
// ─────────────────────────────────────────────────────────────

export type LinkGerado = { ok: true; link: string; nome: string; expiraEm: Date } | { ok: false; motivo: string }

/**
 * Um link de senha nova para alguém da equipe — para o servidor sem e-mail,
 * ou para quem não lê e-mail. Aparece UMA vez na tela, como o do convite.
 *
 * As travas são as de mexer no acesso de alguém (`podeMexerEm`): o gerente
 * da loja 3 gera para o balcão da loja 3, não para a dona. Gerar um link de
 * senha é, na prática, poder entrar como aquela pessoa — então é o mesmo
 * poder de tirar o acesso dela, e não menos.
 *
 * `baseDaEmpresa` já vem com o slug: `https://.../exemplo`.
 */
export async function gerarLinkDeSenha(sessao: Sessao, usuarioId: string, baseDaEmpresa: string): Promise<LinkGerado> {
  exigir(sessao, 'equipe.gerir')
  // Link de senha é entrar como a pessoa: o suporte vendendo com o login da
  // vendedora é justamente o que o modo edição não deixa.
  exigirQueNaoSejaSuporte(sessao, 'gera link de senha de outra pessoa')
  if (usuarioId === sessao.usuarioId) {
    return { ok: false, motivo: 'A sua própria senha você troca em "Minha conta" — clique no seu nome, no rodapé do menu.' }
  }

  const expiraEm = new Date(Date.now() + VALE_LINK_EQUIPE_H * HORA)
  const r = await comoOrg(sessao.orgId, async (db): Promise<LinkGerado> => {
    const pessoa = await db.usuario.findUnique({
      where: { id: usuarioId },
      select: { nome: true, ativo: true, acessos: { select: { papel: true, unidadeId: true, expiraEm: true } } },
    })
    if (!pessoa) return { ok: false, motivo: 'Pessoa não encontrada nesta empresa.' }
    if (!podeMexerEm(sessao, pessoa.acessos.map((a) => ({ ...a, papel: a.papel as Papel })))) {
      return { ok: false, motivo: 'Você não pode gerar senha para esta pessoa: ela tem um papel ou uma loja que você não pode conceder.' }
    }
    if (!pessoa.ativo) return { ok: false, motivo: 'Esta conta está sem acesso. Devolva o acesso antes de gerar o link.' }

    const { token, hash } = novoToken()
    await db.tokenConta.deleteMany({ where: { usuarioId, tipo: 'SENHA', usadoEm: null } })
    await db.tokenConta.create({ data: { orgId: sessao.orgId, usuarioId, tipo: 'SENHA', hash, expiraEm } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'equipe.senha.gerou-link',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: pessoa.nome,
        depois: { valeHoras: VALE_LINK_EQUIPE_H },
      },
    })
    return { ok: true, link: `${baseDaEmpresa.replace(/\/$/, '')}/redefinir-senha?t=${token}`, nome: pessoa.nome, expiraEm }
  })
  return r
}

// ─────────────────────────────────────────────────────────────
// TROCAR A PRÓPRIA SENHA
// ─────────────────────────────────────────────────────────────

export type Troca = { ok: true; email: string; nome: string } | { ok: false; motivo: string }

/**
 * Trocar a própria senha, com a atual.
 *
 * A senha atual passa pelo MESMO freio do login (limite.ts), contando no
 * e-mail da pessoa: uma sessão esquecida aberta no balcão não pode virar
 * lugar para testar senhas da dona em série.
 */
export async function trocarMinhaSenha(sessao: Sessao, atual: string, nova: string, ip: string | null): Promise<Troca> {
  if (!atual) return { ok: false, motivo: 'Digite a senha atual.' }
  if (nova === atual) return { ok: false, motivo: 'A senha nova precisa ser diferente da atual.' }

  let senhaHash: string
  try {
    senhaHash = await guardarSenha(nova)
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : 'Senha inválida.' }
  }

  const eu = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { email: true, nome: true, senhaHash: true, ativo: true } }),
  )
  if (!eu || !eu.ativo) return { ok: false, motivo: 'Sua sessão expirou. Entre de novo.' }

  const freio = await reservarTentativa(sessao.orgId, eu.email, ip)
  if (freio.bloqueado) return { ok: false, motivo: `Muitas tentativas seguidas. Tente de novo em ${freio.esperarMin} min.` }

  const bate = eu.senhaHash ? await conferirSenha(atual, eu.senhaHash) : false
  if (!bate) {
    await concluirTentativa(sessao.orgId, freio.tentativaId, false)
    return { ok: false, motivo: 'A senha atual não confere.' }
  }
  await concluirTentativa(sessao.orgId, freio.tentativaId, true)

  const agora = new Date()
  await comoOrg(sessao.orgId, async (db) => {
    await db.usuario.update({ where: { id: sessao.usuarioId }, data: { senhaHash, sessoesDesde: agora } })
    // Link de senha que estivesse em aberto perde o sentido.
    await db.tokenConta.deleteMany({ where: { usuarioId: sessao.usuarioId, tipo: 'SENHA', usadoEm: null } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'conta.senha.trocou',
        alvoTipo: 'usuario',
        alvoId: sessao.usuarioId,
        alvoNome: eu.nome,
        depois: { sessoesEncerradas: true },
      },
    })
  })
  return { ok: true, email: eu.email, nome: eu.nome }
}

// ─────────────────────────────────────────────────────────────
// CONFIRMAR O E-MAIL (conta nascida no cadastro do site)
// ─────────────────────────────────────────────────────────────

/**
 * Gera o link de confirmação e manda. Chamado logo depois do cadastro, e de
 * novo quando a pessoa pede outro na tela de entrar. Não lança.
 */
export async function enviarConfirmacao(
  orgId: string,
  usuarioId: string,
  base: string,
  ip: string | null,
): Promise<Desfecho | 'ja_confirmado'> {
  if (!emailConfigurado()) return 'nao_configurado'
  try {
    const achado = await comoOrg(orgId, async (db) => {
      const org = await db.org.findUnique({ where: { id: orgId }, select: { nome: true, slug: true } })
      const pessoa = await db.usuario.findUnique({
        where: { id: usuarioId },
        select: { nome: true, email: true, ativo: true, emailPendente: true },
      })
      if (!org || !pessoa || !pessoa.ativo) return null
      if (!pessoa.emailPendente) return 'ja_confirmado' as const
      const { token, hash } = novoToken()
      await db.tokenConta.deleteMany({ where: { usuarioId, tipo: 'EMAIL', usadoEm: null } })
      await db.tokenConta.create({
        data: { orgId, usuarioId, tipo: 'EMAIL', hash, ip, expiraEm: new Date(Date.now() + VALE_CONFIRMACAO_H * HORA) },
      })
      return { org, pessoa, token }
    })
    if (!achado) return 'sem_conta'
    if (achado === 'ja_confirmado') return achado

    const r = await enviarEmail(
      emailConfirmarCadastro({
        para: achado.pessoa.email,
        nome: achado.pessoa.nome,
        empresa: achado.org.nome,
        link: `${base}/${achado.org.slug}/confirmar-email?t=${achado.token}`,
        validadeHoras: VALE_CONFIRMACAO_H,
      }),
    )
    return r.ok ? 'enviado' : 'falhou'
  } catch (e) {
    console.error('[conta] a confirmação não pôde ser preparada:', e instanceof Error ? e.name : 'erro')
    return 'falhou'
  }
}

/** "Reenviar a confirmação", pedido na tela de entrar pelo e-mail digitado. Não lança. */
export async function reenviarConfirmacao(
  orgId: string,
  emailDigitado: string,
  base: string,
  ip: string | null,
): Promise<Desfecho | 'ja_confirmado'> {
  const email = normalizar(emailDigitado)
  try {
    const pessoa = await comoOrg(orgId, (db) =>
      db.usuario.findUnique({ where: { orgId_email: { orgId, email } }, select: { id: true } }),
    )
    if (!pessoa) return 'sem_conta'
    return await enviarConfirmacao(orgId, pessoa.id, base, ip)
  } catch {
    return 'falhou'
  }
}

export type Confirmacao = { ok: true; email: string } | { ok: false; motivo: 'invalido' | 'vencido' | 'ja_usado' }

export async function confirmarEmail(slug: string, token: string): Promise<Confirmacao> {
  const org = await acharOrgPorSlug(slug)
  if (!org || !tokenComForma(token)) return { ok: false, motivo: 'invalido' }
  const agora = new Date()

  return comoOrg(org.id, async (db): Promise<Confirmacao> => {
    const t = await db.tokenConta.findUnique({
      where: { hash: resumirToken(token) },
      select: { id: true, tipo: true, expiraEm: true, usadoEm: true, usuario: { select: { id: true, nome: true, email: true, ativo: true } } },
    })
    if (!t || t.tipo !== 'EMAIL' || !t.usuario.ativo) return { ok: false, motivo: 'invalido' }
    if (t.usadoEm) return { ok: false, motivo: 'ja_usado' }
    if (t.expiraEm <= agora) return { ok: false, motivo: 'vencido' }

    const marcado = await db.tokenConta.updateMany({ where: { id: t.id, usadoEm: null }, data: { usadoEm: agora } })
    if (marcado.count === 0) return { ok: false, motivo: 'ja_usado' }
    await db.usuario.update({ where: { id: t.usuario.id }, data: { emailPendente: false } })
    await db.auditoria.create({
      data: {
        orgId: org.id,
        usuarioId: t.usuario.id,
        quem: t.usuario.nome,
        acao: 'conta.email.confirmou',
        alvoTipo: 'usuario',
        alvoId: t.usuario.id,
        alvoNome: t.usuario.nome,
      },
    })
    return { ok: true, email: t.usuario.email }
  })
}
