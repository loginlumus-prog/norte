// Convidar gente para a equipe.
//
// Duas decisões de segurança que valem entender:
//
// 1. O QUE VAI NO LINK NÃO É O QUE FICA NO BANCO. O link leva um número
//    aleatório de 256 bits; o banco guarda só o resumo (SHA-256) dele. Se o
//    banco vazar, os convites em aberto continuam inúteis — não dá para voltar
//    do resumo para o link.
//
//    Aqui SHA-256 puro basta, sem scrypt: senha é curta e adivinhável, por isso
//    precisa de hash lento. Token de 256 bits aleatórios não se adivinha nem com
//    o universo inteiro de tempo, então o hash rápido não enfraquece nada.
//
// 2. NINGUÉM CONCEDE PAPEL QUE NÃO TEM (`podeConceder` em permissao.ts).
//    Sem isso, ter "gerir equipe" viraria caminho para virar dono.

import { createHash, randomBytes } from 'node:crypto'
import { comoOrg, acharOrgPorSlug } from './banco'
import { guardarSenha } from './senha'
import { normalizar } from './autenticacao'
import { exigir, podeConcederAcesso, unidadesQuePodem, type Papel, type Sessao } from './permissao'
import { DONO_SO_DA_EMPRESA, recadoNaoConcede } from './equipe'
import { gravarPinDoConvite, pinDoConviteServe } from './autorizacao'

// ── o convite só pelo WhatsApp ───────────────────────────────
// A dona muitas vezes tem o WhatsApp da vendedora, e não o e-mail. O convite
// então nasce sem e-mail: no lugar dele fica `whatsapp:<número>` — a mesma
// regra de "um link vivo por vez" passa a valer por número — e quem aceita
// digita o próprio e-mail (é com ele que entra depois). Nada disso é e-mail
// de verdade: nunca vai para envio, e a tela mostra o número.
const SEM_EMAIL = 'whatsapp:'

/** O e-mail de verdade do convite, ou nulo quando ele nasceu só com o WhatsApp. */
export const emailDoConvite = (guardado: string) => (guardado.startsWith(SEM_EMAIL) ? null : guardado)
/** O número do convite que nasceu só com o WhatsApp. */
export const whatsappDoConvite = (guardado: string) => (guardado.startsWith(SEM_EMAIL) ? guardado.slice(SEM_EMAIL.length) : null)

/** Celular com DDD (10 ou 11 números, com ou sem o 55): só os números, sem o 55. */
export function telefoneDoConvite(bruto: string | null | undefined): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  return d.length === 10 || d.length === 11 ? d : null
}

/** Quem não opera (o contador, que só lê) não precisa de PIN. */
const pedePinPara = (papel: Papel) => papel !== 'CONTADOR'

export const VALE_DIAS = 7

/**
 * O que fica no banco no lugar do link.
 *
 * Exportado porque o script que cria empresa precisa gravar o PRIMEIRO convite
 * — o do dono — e ali ainda não existe sessão para chamar `convidar`. Duas
 * cópias desta linha seria uma a mais: o dia em que uma mudasse, os convites
 * do outro caminho parariam de abrir, e o erro apareceria como "link inválido"
 * sem pista nenhuma.
 */
export const resumirToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

const resumir = resumirToken

export type ConviteCriado = {
  id: string
  /** Vazio quando o convite nasceu só com o WhatsApp. */
  email: string
  papel: Papel
  expiraEm: Date
  /** Só existe agora, neste retorno. Não é recuperável depois. */
  link: string
}

export async function convidar(
  sessao: Sessao,
  dados: { email?: string | null; telefone?: string | null; papel: Papel; unidadeId?: string | null; cargoId?: string | null },
  baseDoLink: string,
): Promise<ConviteCriado> {
  const emailDigitado = normalizar(dados.email ?? '')
  const telefone = telefoneDoConvite(dados.telefone)
  if (!emailDigitado && !telefone) throw new Error('Informe o e-mail ou o WhatsApp (com DDD) da pessoa.')
  if (emailDigitado && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDigitado)) throw new Error('Esse e-mail não parece certo.')
  // Sem e-mail, o número ocupa o lugar dele (ver SEM_EMAIL, no topo).
  const email = emailDigitado || `${SEM_EMAIL}${telefone}`
  const unidadeId = dados.unidadeId ?? null
  const cargoId = dados.papel === 'CARGO' ? (dados.cargoId ?? null) : null
  if (dados.papel === 'CARGO' && !cargoId) throw new Error('Escolha qual cargo.')

  exigir(sessao, 'equipe.gerir', unidadeId ?? undefined)

  // Sem loja (`null`) é a empresa inteira, e só convida para a empresa
  // inteira quem tem a empresa inteira. Antes `null` virava "alguma loja", e
  // o gerente da loja 3 convidava balconista para todas as lojas.
  if (dados.papel === 'DONO' && unidadeId !== null) throw new Error(DONO_SO_DA_EMPRESA)
  if (!podeConcederAcesso(sessao, dados.papel, unidadeId)) {
    throw new Error(recadoNaoConcede(dados.papel, unidadeId))
  }

  // A conferência de e-mail repetido acontece FORA da transação de escrita.
  // Lançar de dentro dela aborta a transação, e transação abortada deixa a
  // conexão inutilizável em alguns servidores — inclusive no banco local de
  // desenvolvimento. Ler antes, escrever depois: mais simples e mais seguro.
  const { jaTem, lojaExiste, cargoExiste, pendentes } = await comoOrg(sessao.orgId, async (db) => ({
    jaTem: await db.usuario.findUnique({
      where: { orgId_email: { orgId: sessao.orgId, email } },
      select: { id: true },
    }),
    // A loja vem do formulário: procurar aqui passa pelo RLS.
    lojaExiste: unidadeId ? !!(await db.unidade.findUnique({ where: { id: unidadeId }, select: { id: true } })) : true,
    cargoExiste: cargoId ? !!(await db.cargo.findUnique({ where: { id: cargoId }, select: { id: true } })) : true,
    pendentes: await db.convite.findMany({
      where: { email, aceitoEm: null },
      select: { papel: true, unidadeId: true },
    }),
  }))
  if (jaTem) throw new EmailJaUsado(emailDigitado)
  if (!lojaExiste) throw new Error('Loja não encontrada nesta empresa.')
  if (!cargoExiste) throw new Error('Cargo não encontrado nesta empresa.')
  // Convidar de novo o mesmo e-mail apaga o convite anterior. Se o anterior
  // foi feito por alguém acima (a dona convidando uma gerente), o gerente não
  // pode derrubá-lo trocando por um convite de balconista.
  if (pendentes.some((c) => !podeConcederAcesso(sessao, c.papel as Papel, c.unidadeId))) {
    throw new Error('Já existe um convite para este e-mail feito por quem tem mais acesso que você.')
  }

  // Aqui havia uma conferência de cota do plano. Ela saiu: cadastrar gente é
  // de graça em todo plano, inclusive no grátis. O que a assinatura limita é
  // quanta gente fica DENTRO ao mesmo tempo, e essa conferência mora no login.
  //
  // Vale dizer por quê, porque parece dinheiro deixado na mesa e não é: cobrar
  // por conta cadastrada faz a loja compartilhar senha, e senha compartilhada
  // faz o livro de auditoria mentir. O livro é o que este sistema vende.

  const token = randomBytes(32).toString('base64url')
  const expiraEm = new Date(Date.now() + VALE_DIAS * 864e5)

  const convite = await comoOrg(sessao.orgId, async (db) => {
    // Convite anterior ainda aberto para o mesmo e-mail perde a validade:
    // um e-mail, um link vivo por vez.
    await db.convite.deleteMany({ where: { email, aceitoEm: null } })

    const criado = await db.convite.create({
      data: {
        orgId: sessao.orgId,
        email,
        papel: dados.papel,
        unidadeId,
        cargoId,
        token: resumir(token),
        expiraEm,
      },
      select: { id: true },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'convite.criou',
        alvoTipo: 'convite',
        alvoId: criado.id,
        alvoNome: email,
        depois: { papel: dados.papel, unidadeId },
      },
    })
    return criado
  })

  return {
    id: convite.id,
    email: emailDigitado,
    papel: dados.papel,
    expiraEm,
    link: `${baseDoLink.replace(/\/$/, '')}/convite/${token}`,
  }
}

// ─────────────────────────────────────────────────────────────

export type Aceite =
  | { ok: true; email: string; papel: Papel; usuarioId: string }
  | { ok: false; motivo: 'invalido' | 'vencido' | 'ja_usado' | 'empresa_nao_existe' }
  /** O que a pessoa digitou não serve (o PIN, o e-mail): a frase diz o quê. Nada foi criado. */
  | { ok: false; motivo: 'dados'; erro: string }

/**
 * O convite ainda serve? Para a TELA do convite, antes de mostrar o formulário.
 *
 * Responde só "serve" ou "não serve" — nunca o e-mail convidado, nem se ele já
 * tem conta. Abrir o link e saber que ele não vale não ensina nada a quem está
 * tentando adivinhar: o token tem 256 bits (ver o topo), e um formulário que
 * abre para link morto só faz a pessoa escolher senha para nada.
 */
export async function conviteServe(slugEmpresa: string, token: string): Promise<boolean> {
  const org = await acharOrgPorSlug(slugEmpresa)
  if (!org || !token) return false
  return comoOrg(org.id, async (db) => {
    const convite = await db.convite.findUnique({
      where: { token: resumir(token) },
      select: { expiraEm: true, aceitoEm: true },
    })
    return !!convite && !convite.aceitoEm && convite.expiraEm > new Date()
  })
}

/**
 * O que a tela do convite precisa saber para montar o formulário: se o link
 * serve, se falta o e-mail (convite só pelo WhatsApp) e se pede o PIN.
 * Nunca o e-mail convidado — o mesmo cuidado de `conviteServe`.
 */
export async function conviteParaTela(
  slugEmpresa: string,
  token: string,
): Promise<{ serve: false } | { serve: true; pedeEmail: boolean; pedePin: boolean }> {
  const org = await acharOrgPorSlug(slugEmpresa)
  if (!org || !token) return { serve: false }
  const c = await comoOrg(org.id, (db) =>
    db.convite.findUnique({ where: { token: resumir(token) }, select: { email: true, papel: true, expiraEm: true, aceitoEm: true } }),
  )
  if (!c || c.aceitoEm || c.expiraEm <= new Date()) return { serve: false }
  return { serve: true, pedeEmail: !emailDoConvite(c.email), pedePin: pedePinPara(c.papel as Papel) }
}

/**
 * Aceitar o convite: a pessoa escolhe o nome, a senha e o PIN, e a conta
 * nasce ali — pronta para vender, sem passar por Minha conta.
 *
 * `invalido` cobre token errado E token de outra empresa de propósito — quem
 * está tentando não descobre qual dos dois é.
 */
export async function aceitarConvite(
  slugEmpresa: string,
  token: string,
  dados: { nome: string; senha: string; pin?: string | null; email?: string | null },
): Promise<Aceite> {
  const org = await acharOrgPorSlug(slugEmpresa)
  if (!org) return { ok: false, motivo: 'empresa_nao_existe' }

  // O que se confere ANTES de a conta nascer: o e-mail (convite só pelo
  // WhatsApp) e o PIN. Recusa aqui não gasta o convite.
  const antes = await comoOrg(org.id, (db) =>
    db.convite.findUnique({
      where: { token: resumir(token) },
      select: { email: true, unidadeId: true, expiraEm: true, aceitoEm: true },
    }),
  )
  if (!antes) return { ok: false, motivo: 'invalido' }
  if (antes.aceitoEm) return { ok: false, motivo: 'ja_usado' }
  if (antes.expiraEm <= new Date()) return { ok: false, motivo: 'vencido' }

  let emailFinal = emailDoConvite(antes.email)
  if (!emailFinal) {
    const digitado = normalizar(dados.email ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(digitado)) {
      return { ok: false, motivo: 'dados', erro: 'Digite o seu e-mail: é com ele que você entra depois.' }
    }
    const ja = await comoOrg(org.id, (db) =>
      db.usuario.findUnique({ where: { orgId_email: { orgId: org.id, email: digitado } }, select: { id: true } }),
    )
    if (ja) return { ok: false, motivo: 'dados', erro: 'Esse e-mail já tem conta nesta empresa. Entre com ele, ou use outro.' }
    emailFinal = digitado
  }

  const pin = String(dados.pin ?? '').trim()
  if (pin) {
    const r = await pinDoConviteServe(org.id, resumir(token), antes.unidadeId, pin)
    if (!r.ok) return { ok: false, motivo: 'dados', erro: r.erro }
  }

  const senhaHash = await guardarSenha(dados.senha)
  const emailDaConta = emailFinal

  const aceite: Aceite = await comoOrg(org.id, async (db) => {
    const convite = await db.convite.findUnique({
      where: { token: resumir(token) },
      select: { id: true, email: true, papel: true, unidadeId: true, cargoId: true, expiraEm: true, aceitoEm: true },
    })
    if (!convite) return { ok: false as const, motivo: 'invalido' as const }
    if (convite.aceitoEm) return { ok: false as const, motivo: 'ja_usado' as const }
    if (convite.expiraEm <= new Date()) return { ok: false as const, motivo: 'vencido' as const }

    const usuario = await db.usuario.create({
      data: {
        orgId: org.id,
        nome: dados.nome.trim(),
        email: emailDaConta,
        senhaHash,
      },
      select: { id: true },
    })

    await db.acesso.create({
      data: {
        orgId: org.id,
        usuarioId: usuario.id,
        unidadeId: convite.unidadeId,
        papel: convite.papel,
        cargoId: convite.papel === 'CARGO' ? convite.cargoId : null,
      },
    })

    await db.convite.update({
      where: { id: convite.id },
      data: { aceitoEm: new Date() },
    })

    await db.auditoria.create({
      data: {
        orgId: org.id,
        unidadeId: convite.unidadeId,
        usuarioId: usuario.id,
        quem: dados.nome.trim(),
        acao: 'convite.aceitou',
        alvoTipo: 'usuario',
        alvoId: usuario.id,
        alvoNome: emailDaConta,
        depois: { papel: convite.papel, unidadeId: convite.unidadeId },
      },
    })

    return { ok: true as const, email: emailDaConta, papel: convite.papel as Papel, usuarioId: usuario.id }
  })
  // O PIN, já conferido lá em cima, depois de a conta existir (ele é amarrado
  // à pessoa). Fora da transação: o scrypt é lento de propósito.
  if (aceite.ok && pin) await gravarPinDoConvite(org.id, aceite.usuarioId, dados.nome.trim(), pin)
  return aceite
}

// ─────────────────────────────────────────────────────────────

/**
 * Os convites em aberto. O gerente preso a uma loja vê só os da loja dele —
 * o convite da empresa inteira (sem loja) e o das outras lojas não são da
 * conta dele, e traziam o e-mail de quem ainda nem entrou.
 */
export async function listarConvites(sessao: Sessao) {
  exigir(sessao, 'equipe.ver')
  const alcance = unidadesQuePodem(sessao, 'equipe.ver')
  return comoOrg(sessao.orgId, (db) =>
    db.convite.findMany({
      where: { aceitoEm: null, ...(alcance === 'todas' ? {} : { unidadeId: { in: alcance } }) },
      select: { id: true, email: true, papel: true, unidadeId: true, expiraEm: true, criadoEm: true, cargo: { select: { nome: true } } },
      orderBy: { criadoEm: 'desc' },
    }),
  )
}

export async function revogarConvite(sessao: Sessao, conviteId: string) {
  exigir(sessao, 'equipe.gerir')
  await comoOrg(sessao.orgId, async (db) => {
    const alvo = await db.convite.findUnique({
      where: { id: conviteId },
      select: { email: true, unidadeId: true, papel: true },
    })
    if (!alvo) return
    // Cancelar um convite é o mesmo poder que fazê-lo: o gerente da loja 3
    // não cancela o convite que a dona fez para a gerente da loja 5.
    if (!podeConcederAcesso(sessao, alvo.papel as Papel, alvo.unidadeId)) {
      throw new Error('Você não pode cancelar este convite: ele dá um acesso que você não pode conceder.')
    }
    await db.convite.delete({ where: { id: conviteId } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: alvo.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'convite.revogou',
        alvoTipo: 'convite',
        alvoId: conviteId,
        alvoNome: alvo.email,
      },
    })
  })
}

/** Já existe gente com esse e-mail na empresa. */
export class EmailJaUsado extends Error {
  constructor(readonly email: string) {
    super(`Já existe alguém com o e-mail ${email} nesta empresa.`)
    this.name = 'EmailJaUsado'
  }
}

/** Convites vencidos não servem para nada; some com eles de tempos em tempos. */
export async function limparVencidos(orgId: string) {
  return comoOrg(orgId, (db) =>
    db.convite.deleteMany({ where: { aceitoEm: null, expiraEm: { lt: new Date() } } }),
  )
}
