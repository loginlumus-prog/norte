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
import { exigir, podeConceder, type Papel, type Sessao } from './permissao'

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
  email: string
  papel: Papel
  expiraEm: Date
  /** Só existe agora, neste retorno. Não é recuperável depois. */
  link: string
}

export async function convidar(
  sessao: Sessao,
  dados: { email: string; papel: Papel; unidadeId?: string | null },
  baseDoLink: string,
): Promise<ConviteCriado> {
  const email = normalizar(dados.email)
  const unidadeId = dados.unidadeId ?? null

  exigir(sessao, 'equipe.gerir', unidadeId ?? undefined)

  if (!podeConceder(sessao, dados.papel, unidadeId ?? undefined)) {
    throw new Error(`Você não pode conceder o papel ${dados.papel}.`)
  }

  // A conferência de e-mail repetido acontece FORA da transação de escrita.
  // Lançar de dentro dela aborta a transação, e transação abortada deixa a
  // conexão inutilizável em alguns servidores — inclusive no banco local de
  // desenvolvimento. Ler antes, escrever depois: mais simples e mais seguro.
  const jaTem = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({
      where: { orgId_email: { orgId: sessao.orgId, email } },
      select: { id: true },
    }),
  )
  if (jaTem) throw new EmailJaUsado(email)

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
    email,
    papel: dados.papel,
    expiraEm,
    link: `${baseDoLink.replace(/\/$/, '')}/convite/${token}`,
  }
}

// ─────────────────────────────────────────────────────────────

export type Aceite =
  | { ok: true; email: string; papel: Papel }
  | { ok: false; motivo: 'invalido' | 'vencido' | 'ja_usado' | 'empresa_nao_existe' }

/**
 * Aceitar o convite: a pessoa escolhe o nome e a senha, e a conta nasce ali.
 *
 * `invalido` cobre token errado E token de outra empresa de propósito — quem
 * está tentando não descobre qual dos dois é.
 */
export async function aceitarConvite(
  slugEmpresa: string,
  token: string,
  dados: { nome: string; senha: string },
): Promise<Aceite> {
  const org = await acharOrgPorSlug(slugEmpresa)
  if (!org) return { ok: false, motivo: 'empresa_nao_existe' }

  const senhaHash = await guardarSenha(dados.senha)

  return comoOrg(org.id, async (db) => {
    const convite = await db.convite.findUnique({
      where: { token: resumir(token) },
      select: { id: true, email: true, papel: true, unidadeId: true, expiraEm: true, aceitoEm: true },
    })
    if (!convite) return { ok: false as const, motivo: 'invalido' as const }
    if (convite.aceitoEm) return { ok: false as const, motivo: 'ja_usado' as const }
    if (convite.expiraEm <= new Date()) return { ok: false as const, motivo: 'vencido' as const }

    const usuario = await db.usuario.create({
      data: {
        orgId: org.id,
        nome: dados.nome.trim(),
        email: convite.email,
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
        alvoNome: convite.email,
        depois: { papel: convite.papel, unidadeId: convite.unidadeId },
      },
    })

    return { ok: true as const, email: convite.email, papel: convite.papel as Papel }
  })
}

// ─────────────────────────────────────────────────────────────

export async function listarConvites(sessao: Sessao) {
  exigir(sessao, 'equipe.ver')
  return comoOrg(sessao.orgId, (db) =>
    db.convite.findMany({
      where: { aceitoEm: null },
      select: { id: true, email: true, papel: true, unidadeId: true, expiraEm: true, criadoEm: true },
      orderBy: { criadoEm: 'desc' },
    }),
  )
}

export async function revogarConvite(sessao: Sessao, conviteId: string) {
  exigir(sessao, 'equipe.gerir')
  await comoOrg(sessao.orgId, async (db) => {
    const alvo = await db.convite.findUnique({
      where: { id: conviteId },
      select: { email: true, unidadeId: true },
    })
    if (!alvo) return
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
