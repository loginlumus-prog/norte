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
import { exigir, podeConcederAcesso, PODERES, unidadesQuePodem, type Papel, type Sessao } from './permissao'
import { inicioDoDiaEmSP } from './dia'
import { planoLibera } from './planos'
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

/**
 * Início e fim (exclusivo) de um mês "AAAA-MM", no calendário de São Paulo.
 *
 * Era a meia-noite do fuso do SERVIDOR: num servidor em UTC, a venda das 22h
 * do dia 30 caía no mês seguinte — e a comissão de um mês ia para o outro.
 */
function janelaDoMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  const seguinte = m === 12 ? `${a! + 1}-01` : `${a}-${String(m! + 1).padStart(2, '0')}`
  return { de: inicioDoDiaEmSP(`${mes}-01`), ate: inicioDoDiaEmSP(`${seguinte}-01`) }
}

/**
 * A meta de cada pessoa que vende, no mês, com o realizado.
 * Quem lê é a tela da equipe (todo mundo) e o painel.
 */
export async function metasDoMes(sessao: Sessao, mes: string): Promise<MetaDaPessoa[]> {
  exigir(sessao, 'equipe.ver')
  if (!mesValido(mes)) return []
  const { de, ate } = janelaDoMes(mes)

  // O gerente da loja 3 vê a equipe e as vendas da loja 3 — não quanto a
  // vendedora da loja 5 vendeu nem quanto ela ganha de comissão. `null` é o
  // dono (todas as lojas): nenhum filtro.
  const alcance = unidadesQuePodem(sessao, 'equipe.ver')
  const lojas = alcance === 'todas' ? null : alcance

  return comoOrg(sessao.orgId, async (db) => {
    const pessoas = await db.usuario.findMany({
      where: {
        ativo: true,
        acessos: {
          some: {
            papel: { in: PAPEIS_QUE_VENDEM },
            ...(lojas ? { unidadeId: { in: lojas } } : {}),
          },
        },
      },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    })
    // Todas as linhas até o mês pedido, da mais recente para trás: a
    // primeira de cada pessoa é a que vale (a do mês, ou a herdada).
    const metas = await db.meta.findMany({
      where: { mes: { lte: mes } },
      orderBy: { mes: 'desc' },
      select: { usuarioId: true, mes: true, valor: true, comissaoPct: true },
    })
    const vendas = await db.$queryRaw<{ vendedor_id: string; total: string }[]>`
      select v.vendedor_id, sum(v.total) as total
        from vendas v
       where v.situacao = 'CONCLUIDA' and v.vendedor_id is not null
         and v.criada_em >= ${de} and v.criada_em < ${ate}
         and (${lojas === null} or v.unidade_id = any(${lojas ?? ['-']}))
       group by 1
    `
    const devolucoes = await db.$queryRaw<{ vendedor_id: string; total: string }[]>`
      select v.vendedor_id, sum(d.valor) as total
        from devolucoes d join vendas v on v.id = d.venda_id
       where v.vendedor_id is not null
         and d.criada_em >= ${de} and d.criada_em < ${ate}
         and (${lojas === null} or v.unidade_id = any(${lojas ?? ['-']}))
       group by 1
    `

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
  if (!mesValido(mes)) return null
  const { de, ate } = janelaDoMes(mes)
  return comoOrg(sessao.orgId, async (db) => {
    const linha = await db.meta.findFirst({
      where: { usuarioId: sessao.usuarioId, mes: { lte: mes } },
      orderBy: { mes: 'desc' },
      select: { valor: true, comissaoPct: true },
    })
    const vendas = await db.venda.aggregate({
      where: { vendedorId: sessao.usuarioId, situacao: 'CONCLUIDA', criadaEm: { gte: de, lt: ate } },
      _sum: { total: true },
    })
    // Líquido de devolução, a mesma conta da tela da equipe — os dois
    // números têm que ser o mesmo, senão a pessoa desconfia dos dois.
    const devolucoes = await db.devolucao.aggregate({
      where: { venda: { vendedorId: sessao.usuarioId }, criadaEm: { gte: de, lt: ate } },
      _sum: { valor: true },
    })
    if (!linha) return null
    const valorC = centavos(linha.valor)
    const vendidoC = Math.max(centavos(vendas._sum.total ?? 0) - centavos(devolucoes._sum.valor ?? 0), 0)
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
  if (!Number.isFinite(m.valor) || !Number.isFinite(m.comissaoPct)) throw new Error('Meta e comissão precisam ser números.')
  // A própria comissão, ninguém define: o gerente se dava 50% sobre tudo
  // que vendeu, e a tela da equipe mostrava o número como se fosse combinado.
  if (m.usuarioId === sessao.usuarioId) {
    throw new Error('A sua própria meta e comissão quem define é outra pessoa.')
  }
  const valor = Math.max(0, m.valor)
  const pct = Math.min(Math.max(m.comissaoPct, 0), 50)

  await comoOrg(sessao.orgId, async (db) => {
    // Metas e comissão são módulo, e módulo do plano (`RECURSOS`): sem ele a
    // tela nem mostra — e a ação chamada direto também não grava.
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { plano: true, modulos: true } })
    if (!org.modulos.includes('metas') || !planoLibera(org.plano, 'metas')) {
      throw new Error('Metas e comissão não estão ligadas nesta empresa.')
    }
    const pessoa = await db.usuario.findUnique({
      where: { id: m.usuarioId },
      select: { nome: true, acessos: { select: { papel: true, unidadeId: true, expiraEm: true } } },
    })
    if (!pessoa) throw new Error('Pessoa não encontrada nesta empresa.')
    // Meta e comissão de alguém é poder SOBRE essa pessoa: a mesma régua de
    // trocar o papel dela. O gerente da loja 3 não mexe na comissão da
    // vendedora da loja 5, nem na do outro gerente.
    if (!pessoa.acessos.every((a) => podeConcederAcesso(sessao, a.papel as Papel, a.unidadeId))) {
      throw new Error('Você não pode definir a meta desta pessoa.')
    }
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
