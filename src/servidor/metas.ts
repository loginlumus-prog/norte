// Metas e comissão por vendedor.
//
// ── o que é ──────────────────────────────────────────────────
// Uma meta de venda por pessoa por mês, e a porcentagem de comissão dela.
// O sistema faz a conta que a loja fazia no caderno no dia 30: quanto cada
// um vendeu (líquido do que voltou em devolução), quanto falta para a meta,
// e quanto é a comissão.
//
// ── mês sem linha herda a última ─────────────────────────────
// Meta que zera todo dia primeiro é meta que ninguém acompanha. Se setembro
// não tem linha, vale a de agosto; se agosto não tem, a de julho. A tela diz
// "herdada" para a pessoa saber que dá para mudar.
//
// Puro onde dá (a conta da comissão e a chave do mês), banco no resto.

import { comoOrg } from './banco'
import { exigir, PODERES, type Papel, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'

/** "2026-09" */
export const mesChave = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export const MES_NOME = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** "2026-09" → "setembro de 2026". */
export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `${MES_NOME[(m ?? 1) - 1]} de ${a}`
}

/** Comissão em centavos: pct sobre o líquido, para baixo. */
export function calcularComissao(liquidoCent: number, pct: number): number {
  if (liquidoCent <= 0 || pct <= 0) return 0
  return Math.floor((liquidoCent * pct) / 100)
}

/** O mês pedido é válido? Aceita só "AAAA-MM" de verdade. */
export function mesValido(m: string | undefined | null): m is string {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return false
  const n = Number(m.slice(5))
  return n >= 1 && n <= 12
}

export type MetaDaPessoa = {
  usuarioId: string
  nome: string
  mes: string
  valor: number
  comissaoPct: number
  /** A linha veio de um mês anterior (não há linha para este mês). */
  herdada: boolean
  vendido: number
  devolvido: number
  liquido: number
  comissao: number
  /** 0 a 1 quando há meta; nulo sem meta. Pode passar de 1. */
  progresso: number | null
}

const PAPEIS_QUE_VENDEM = (Object.keys(PODERES) as Papel[]).filter((p) => PODERES[p].includes('venda.criar'))

/** Início e fim (exclusivo) de um mês "AAAA-MM", no horário local. */
function janelaDoMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return { de: new Date(a!, m! - 1, 1), ate: new Date(a!, m!, 1) }
}

/**
 * A meta de cada pessoa que vende, no mês, com o realizado.
 * Quem lê é a tela da equipe (todo mundo) e o painel.
 */
export async function metasDoMes(sessao: Sessao, mes: string): Promise<MetaDaPessoa[]> {
  exigir(sessao, 'equipe.ver')
  const { de, ate } = janelaDoMes(mes)

  return comoOrg(sessao.orgId, async (db) => {
    const [pessoas, metas, vendas, devolucoes] = await Promise.all([
      db.usuario.findMany({
        where: { ativo: true, acessos: { some: { papel: { in: PAPEIS_QUE_VENDEM } } } },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      }),
      // Todas as linhas até o mês pedido, da mais recente para trás: a
      // primeira de cada pessoa é a que vale (a do mês, ou a herdada).
      db.meta.findMany({
        where: { mes: { lte: mes } },
        orderBy: { mes: 'desc' },
        select: { usuarioId: true, mes: true, valor: true, comissaoPct: true },
      }),
      db.$queryRaw<{ vendedor_id: string; total: string }[]>`
        select v.vendedor_id, sum(v.total) as total
          from vendas v
         where v.situacao = 'CONCLUIDA' and v.vendedor_id is not null
           and v.criada_em >= ${de} and v.criada_em < ${ate}
         group by 1
      `,
      db.$queryRaw<{ vendedor_id: string; total: string }[]>`
        select v.vendedor_id, sum(d.valor) as total
          from devolucoes d join vendas v on v.id = d.venda_id
         where v.vendedor_id is not null
           and d.criada_em >= ${de} and d.criada_em < ${ate}
         group by 1
      `,
    ])

    const vendidoDe = new Map(vendas.map((v) => [v.vendedor_id, centavos(v.total)]))
    const devolvidoDe = new Map(devolucoes.map((d) => [d.vendedor_id, centavos(d.total)]))

    return pessoas.map((p) => {
      const linha = metas.find((m) => m.usuarioId === p.id)
      const valorC = linha ? centavos(linha.valor) : 0
      const pct = linha ? Number(linha.comissaoPct) : 0
      const vendidoC = vendidoDe.get(p.id) ?? 0
      const devolvidoC = devolvidoDe.get(p.id) ?? 0
      const liquidoC = Math.max(vendidoC - devolvidoC, 0)
      return {
        usuarioId: p.id,
        nome: p.nome,
        mes,
        valor: reais(valorC),
        comissaoPct: pct,
        herdada: !!linha && linha.mes !== mes,
        vendido: reais(vendidoC),
        devolvido: reais(devolvidoC),
        liquido: reais(liquidoC),
        comissao: reais(calcularComissao(liquidoC, pct)),
        progresso: valorC > 0 ? liquidoC / valorC : null,
      }
    })
  })
}

/** A meta da própria pessoa, para o balcão dizer "faltam R$ X". */
export async function minhaMeta(sessao: Sessao, mes: string) {
  const { de, ate } = janelaDoMes(mes)
  return comoOrg(sessao.orgId, async (db) => {
    const [linha, vendas] = await Promise.all([
      db.meta.findFirst({
        where: { usuarioId: sessao.usuarioId, mes: { lte: mes } },
        orderBy: { mes: 'desc' },
        select: { valor: true, comissaoPct: true },
      }),
      db.venda.aggregate({
        where: { vendedorId: sessao.usuarioId, situacao: 'CONCLUIDA', criadaEm: { gte: de, lt: ate } },
        _sum: { total: true },
      }),
    ])
    if (!linha) return null
    const valorC = centavos(linha.valor)
    const vendidoC = centavos(vendas._sum.total ?? 0)
    return {
      valor: reais(valorC),
      comissaoPct: Number(linha.comissaoPct),
      vendido: reais(vendidoC),
      progresso: valorC > 0 ? vendidoC / valorC : null,
      comissao: reais(calcularComissao(vendidoC, Number(linha.comissaoPct))),
    }
  })
}

export async function salvarMeta(
  sessao: Sessao,
  m: { usuarioId: string; mes: string; valor: number; comissaoPct: number },
) {
  exigir(sessao, 'equipe.gerir')
  if (!mesValido(m.mes)) throw new Error('Mês inválido.')
  const valor = Math.max(0, m.valor)
  const pct = Math.min(Math.max(m.comissaoPct, 0), 50)

  await comoOrg(sessao.orgId, async (db) => {
    const pessoa = await db.usuario.findUnique({ where: { id: m.usuarioId }, select: { nome: true } })
    if (!pessoa) throw new Error('Pessoa não encontrada nesta empresa.')
    await db.meta.upsert({
      where: { orgId_usuarioId_mes: { orgId: sessao.orgId, usuarioId: m.usuarioId, mes: m.mes } },
      create: { orgId: sessao.orgId, usuarioId: m.usuarioId, mes: m.mes, valor: reais(centavos(valor)), comissaoPct: pct, quem: sessao.nome },
      update: { valor: reais(centavos(valor)), comissaoPct: pct, quem: sessao.nome },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'equipe.meta',
        alvoTipo: 'usuario',
        alvoId: m.usuarioId,
        alvoNome: pessoa.nome,
        valor,
        motivo: `${nomeDoMes(m.mes)} · comissão ${pct}%`,
      },
    })
  })
  return { valor, comissaoPct: pct }
}
