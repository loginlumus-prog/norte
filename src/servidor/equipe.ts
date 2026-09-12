// A equipe: quem tem acesso, com que papel e em qual loja.
//
// O convite (quem ENTRA) mora em `convite.ts`. Aqui está o que acontece
// depois: mudar o papel de alguém, tirar o acesso, devolver.
//
// ── três travas que parecem burocracia e não são ─────────────
//
// 1. NINGUÉM MUDA O PRÓPRIO ACESSO. Nem para menos. Sem isso, a única dona
//    consegue se rebaixar sem querer e a empresa fica sem ninguém que possa
//    configurar nada — inclusive desfazer o rebaixamento.
//
// 2. A EMPRESA NUNCA FICA SEM DONO. Desativar o último ou rebaixá-lo é
//    recusado. É o caso que a gente só descobriria com o cliente ligando
//    sem conseguir entrar em nada.
//
// 3. TIROU O ACESSO, A SESSÃO MORRE NA HORA. `cortarSessoes` derruba o
//    cookie que já estava aberto. Sem isso, demitir alguém de manhã só faz
//    efeito quando o cookie dele expira, até 12 horas depois.

import { comoOrg } from './banco'
import { cortarSessoes } from './pagina'
import { exigir, podeConceder, PODERES, type Papel, type Sessao } from './permissao'

export type PessoaDaEquipe = {
  id: string
  nome: string
  email: string
  ativo: boolean
  ultimoLogin: Date | null
  acessos: { id: string; papel: Papel; unidadeId: string | null; unidadeNome: string | null; expiraEm: Date | null }[]
}

export async function listarEquipe(sessao: Sessao): Promise<PessoaDaEquipe[]> {
  exigir(sessao, 'equipe.ver')

  return comoOrg(sessao.orgId, async (db) => {
    const pessoas = await db.usuario.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      select: {
        id: true, nome: true, email: true, ativo: true, ultimoLogin: true,
        acessos: { select: { id: true, papel: true, unidadeId: true, expiraEm: true } },
      },
    })
    const unidades = await db.unidade.findMany({ select: { id: true, nome: true } })

    const nomeDa = new Map(unidades.map((u) => [u.id, u.nome]))
    return pessoas.map((p) => ({
      ...p,
      acessos: p.acessos.map((a) => ({
        ...a,
        papel: a.papel as Papel,
        unidadeNome: a.unidadeId ? (nomeDa.get(a.unidadeId) ?? null) : null,
      })),
    }))
  })
}

export type Vendedor = { id: string; nome: string }

/**
 * Quem pode vender NESTA unidade — para o balcão escolher "quem vendeu".
 *
 * Derivado da tabela de poderes: é gente ativa cujo papel inclui
 * `venda.criar`, com acesso à unidade ou à empresa inteira. A lista existe
 * para meta e comissão: a vendedora atende no salão, a caixa registra, e a
 * venda precisa ir para o nome certo.
 */
export async function listarVendedores(sessao: Sessao, unidadeId: string): Promise<Vendedor[]> {
  exigir(sessao, 'venda.criar', unidadeId)
  const agora = new Date()
  const papeis = (Object.keys(PODERES) as Papel[]).filter((p) => PODERES[p].includes('venda.criar'))

  return comoOrg(sessao.orgId, async (db) => {
    const pessoas = await db.usuario.findMany({
      where: {
        ativo: true,
        acessos: {
          some: {
            papel: { in: papeis },
            OR: [{ unidadeId: null }, { unidadeId }],
            AND: [{ OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] }],
          },
        },
      },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    })
    return pessoas
  })
}

export type ResultadoEquipe = { ok: true } | { ok: false; motivo: string }

/** Quantos donos ATIVOS a empresa tem agora. */
async function quantosDonos(orgId: string, exceto?: string): Promise<number> {
  return comoOrg(orgId, (db) =>
    db.acesso.count({
      where: {
        papel: 'DONO',
        usuario: { ativo: true },
        ...(exceto ? { usuarioId: { not: exceto } } : {}),
      },
    }),
  )
}

export async function mudarAcesso(
  sessao: Sessao,
  usuarioId: string,
  novo: { papel: Papel; unidadeId: string | null },
): Promise<ResultadoEquipe> {
  exigir(sessao, 'equipe.gerir', novo.unidadeId ?? undefined)

  if (usuarioId === sessao.usuarioId) {
    return { ok: false, motivo: 'Você não pode mudar o próprio acesso. Peça para outra pessoa.' }
  }
  if (!podeConceder(sessao, novo.papel, novo.unidadeId ?? undefined)) {
    return { ok: false, motivo: `Você não pode conceder o papel ${novo.papel}.` }
  }

  const era = await comoOrg(sessao.orgId, (db) =>
    db.acesso.findFirst({ where: { usuarioId }, select: { papel: true } }),
  )
  // Tirar o último dono é o erro que só aparece quando ninguém mais entra.
  if (era?.papel === 'DONO' && novo.papel !== 'DONO' && (await quantosDonos(sessao.orgId, usuarioId)) === 0) {
    return { ok: false, motivo: 'Esta é a única pessoa com acesso de dono. Promova outra antes.' }
  }

  await comoOrg(sessao.orgId, async (db) => {
    const pessoa = await db.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } })

    await db.acesso.deleteMany({ where: { usuarioId } })
    await db.acesso.create({
      data: { orgId: sessao.orgId, usuarioId, papel: novo.papel, unidadeId: novo.unidadeId },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: novo.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'equipe.papel.alterou',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: pessoa?.nome ?? null,
        antes: { papel: era?.papel ?? null },
        depois: { papel: novo.papel, unidadeId: novo.unidadeId },
      },
    })
  })

  // O cookie dela carrega os papéis ANTIGOS. Sem o corte, quem foi rebaixado
  // continua com o poder de antes até o cookie expirar.
  await cortarSessoes(sessao.orgId, usuarioId)
  return { ok: true }
}

export async function mudarSituacao(
  sessao: Sessao,
  usuarioId: string,
  ativo: boolean,
): Promise<ResultadoEquipe> {
  exigir(sessao, 'equipe.gerir')

  if (usuarioId === sessao.usuarioId) {
    return { ok: false, motivo: 'Você não pode desativar a própria conta.' }
  }
  if (!ativo && (await quantosDonos(sessao.orgId, usuarioId)) === 0) {
    const eraDono = await comoOrg(sessao.orgId, (db) =>
      db.acesso.count({ where: { usuarioId, papel: 'DONO' } }),
    )
    if (eraDono > 0) {
      return { ok: false, motivo: 'Esta é a única pessoa com acesso de dono. A empresa ficaria sem ninguém.' }
    }
  }

  await comoOrg(sessao.orgId, async (db) => {
    const pessoa = await db.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } })
    await db.usuario.update({ where: { id: usuarioId }, data: { ativo } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: ativo ? 'equipe.reativou' : 'equipe.desativou',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: pessoa?.nome ?? null,
        depois: { ativo },
      },
    })
  })

  // Vale nos dois sentidos: desativar derruba agora; reativar também corta,
  // porque a sessão velha foi emitida quando a conta estava morta.
  await cortarSessoes(sessao.orgId, usuarioId)
  return { ok: true }
}
