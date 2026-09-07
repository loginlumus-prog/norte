// Entrar no sistema.
//
// O login é SEMPRE por empresa: a pessoa chega em /nome-da-empresa e entra ali.
// Nunca existe busca de usuário por e-mail atravessando empresas — isso seria
// um jeito pronto de descobrir quem é cliente de quem.
//
// Duas defesas que parecem detalhe e não são:
//
// 1. Quando o e-mail não existe, a senha é conferida contra um hash falso.
//    Sem isso, "e-mail não cadastrado" responde na hora e "senha errada" demora,
//    e essa diferença de tempo revela quem tem conta na empresa.
//
// 2. E-mail errado e senha errada devolvem exatamente o mesmo motivo. Quem
//    tenta não descobre qual dos dois errou.

import { comoOrg, acharOrgPorSlug } from './banco'
import { conferirSenha, precisaTrocar, HASH_ISCA } from './senha'
import type { Sessao, Papel } from './permissao'

export type Entrada =
  | { ok: true; sessao: Sessao; senhaPrecisaTrocar: boolean }
  | { ok: false; motivo: MotivoRecusa }

export type MotivoRecusa =
  | 'empresa_nao_existe' // seguro dizer: o endereço está na URL
  | 'empresa_suspensa' // precisa dizer: é problema de pagamento, tem conserto
  | 'credenciais' // genérico de propósito
  | 'sem_acesso' // existe e a senha bate, mas não tem papel em lugar nenhum

export const RECADO: Record<MotivoRecusa, string> = {
  empresa_nao_existe: 'Não encontramos essa empresa.',
  empresa_suspensa: 'O acesso desta empresa está suspenso. Fale com o responsável.',
  credenciais: 'E-mail ou senha não conferem.',
  sem_acesso: 'Sua conta não tem acesso liberado. Peça para o responsável liberar.',
}

export async function entrar(
  slugEmpresa: string,
  email: string,
  senha: string,
): Promise<Entrada> {
  const org = await acharOrgPorSlug(slugEmpresa)
  if (!org) return { ok: false, motivo: 'empresa_nao_existe' }
  if (org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') {
    return { ok: false, motivo: 'empresa_suspensa' }
  }

  const achado = await comoOrg(org.id, async (db) => {
    const usuario = await db.usuario.findUnique({
      where: { orgId_email: { orgId: org.id, email: normalizar(email) } },
      select: { id: true, nome: true, senhaHash: true, ativo: true },
    })
    if (!usuario) return null

    const acessos = await db.acesso.findMany({
      where: { usuarioId: usuario.id },
      select: { papel: true, unidadeId: true, expiraEm: true },
    })
    return { usuario, acessos }
  })

  // Confere a senha mesmo sem usuário: gasta o mesmo tempo dos dois jeitos.
  const guardado = achado?.usuario.senhaHash ?? HASH_ISCA
  const senhaBate = await conferirSenha(senha, guardado)

  if (!achado || !senhaBate) return { ok: false, motivo: 'credenciais' }
  // Conta desativada responde igual a senha errada: quem saiu da empresa não
  // precisa saber que o cadastro dele ainda existe.
  if (!achado.usuario.ativo) return { ok: false, motivo: 'credenciais' }

  const agora = new Date()
  const acessos = achado.acessos
    .filter((a) => !a.expiraEm || a.expiraEm > agora)
    .map((a) => ({ papel: a.papel as Papel, unidadeId: a.unidadeId, expiraEm: a.expiraEm }))

  if (acessos.length === 0) return { ok: false, motivo: 'sem_acesso' }

  const sessao: Sessao = {
    orgId: org.id,
    usuarioId: achado.usuario.id,
    nome: achado.usuario.nome,
    acessos,
  }

  await registrarEntrada(sessao)

  return {
    ok: true,
    sessao,
    senhaPrecisaTrocar: precisaTrocar(achado.usuario.senhaHash!),
  }
}

/** Quem entrou e quando — o cliente enxerga isso no livro dele. */
async function registrarEntrada(sessao: Sessao) {
  await comoOrg(sessao.orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'sessao.entrou',
        alvoTipo: 'usuario',
        alvoId: sessao.usuarioId,
      },
    }),
  )
}

// Tentativa que falha NÃO vai para o livro de propósito: sem limite de
// tentativas, quem quisesse poderia encher a auditoria do cliente de lixo só
// errando senha. O registro de falha entra junto com o limite de tentativas,
// na camada de requisição.

/** E-mail é caixa-baixa e sem espaço nas pontas, sempre e em todo lugar. */
export const normalizar = (email: string) => email.trim().toLowerCase()
