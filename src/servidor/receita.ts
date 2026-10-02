// A receita de venda, numa régua só.
//
// ── por que existe ───────────────────────────────────────────
// O painel dividia o total BRUTO pelo número de vendas e a Análise dividia o
// LÍQUIDO (venda menos devolução) — a mesma loja, no mesmo mês, tinha dois
// tickets médios. E a troca contava duas vezes: a blusa de R$ 100 que voltou
// em vale e saiu de novo como "venda nova paga com o vale" aparecia como
// R$ 200 vendidos no "por vendedor", e a comissão ia inteira para quem
// registrou a troca, zerando quem vendeu de verdade.
//
// Aqui mora a conta, e todo relatório pede a ela:
//
//   receita líquida = vendas concluídas − devoluções − vale de "troca sem a
//                     compra" usado para pagar venda
//
// ── a troca sem a compra ─────────────────────────────────────
// O vale que NÃO nasceu de uma devolução desta empresa é o da troca de peça
// comprada no sistema anterior (troca.ts): o dinheiro dela entrou — e foi
// contado — no outro sistema. A venda nova paga com esse vale não é dinheiro
// novo, e a parte paga com ele não é receita. (O custo da peça nova continua
// no CMV: a peça que voltou entrou no estoque sem custo registrado — defeito
// conhecido, pequeno, anotado.)
//
// ── a troca, para meta e comissão ────────────────────────────
// A parte da venda nova paga com vale de DEVOLUÇÃO não é venda de quem
// registrou a troca: é o dinheiro da venda de antes, que ficou na loja. Ela
// sai de quem registrou e VOLTA para quem vendeu a peça original — que tinha
// perdido o valor na devolução. A troca fica neutra: a blusa conta uma vez,
// para quem a vendeu. Ver `contaDoVendedor`.
//
// Tudo com o `db` de uma transação que já existe, uma consulta depois da
// outra (nada de Promise.all dentro do comoOrg).

import type { BancoDaOrg } from './banco'
import { centavos, reais } from './dinheiro'

export type ReceitaDaLoja = {
  /** Vendas concluídas na janela. */
  vendas: number
  brutoCent: number
  /** Devolvido na janela, pela data e pela loja da devolução. */
  devolvidoCent: number
  /** Pago com vale de troca sem a compra (vale sem devolução). */
  semCompraCent: number
  liquidoCent: number
}

const zerada = (): ReceitaDaLoja => ({ vendas: 0, brutoCent: 0, devolvidoCent: 0, semCompraCent: 0, liquidoCent: 0 })

/**
 * A receita de cada loja na janela [de, ate) — `ate` EXCLUSIVO, como toda
 * janela de `periodo.ts`. Loja sem movimento não aparece no mapa.
 */
export async function receitaPorLoja(
  db: BancoDaOrg,
  unidadeIds: string[],
  de: Date,
  ate: Date,
): Promise<Map<string, ReceitaDaLoja>> {
  const saida = new Map<string, ReceitaDaLoja>()
  if (unidadeIds.length === 0) return saida
  const da = (u: string) => {
    let r = saida.get(u)
    if (!r) saida.set(u, (r = zerada()))
    return r
  }

  const vendas = await db.$queryRaw<{ unidade_id: string; vendas: number; total: string }[]>`
    select v.unidade_id, count(*)::int as vendas, coalesce(sum(v.total), 0) as total
      from vendas v
     where v.unidade_id = any(${unidadeIds}) and v.situacao = 'CONCLUIDA'
       and v.criada_em >= ${de} and v.criada_em < ${ate}
     group by 1
  `
  const devolucoes = await db.$queryRaw<{ unidade_id: string; total: string }[]>`
    select d.unidade_id, coalesce(sum(d.valor), 0) as total
      from devolucoes d
     where d.unidade_id = any(${unidadeIds})
       and d.criada_em >= ${de} and d.criada_em < ${ate}
     group by 1
  `
  const semCompra = await db.$queryRaw<{ unidade_id: string; total: string }[]>`
    select v.unidade_id, coalesce(sum(p.valor), 0) as total
      from pagamentos p
      join vendas v on v.id = p.venda_id
     where p.forma = 'VALE' and p.vale_id is not null
       and not exists (select 1 from devolucoes d where d.vale_id = p.vale_id)
       and v.unidade_id = any(${unidadeIds}) and v.situacao = 'CONCLUIDA'
       and v.criada_em >= ${de} and v.criada_em < ${ate}
     group by 1
  `
  for (const v of vendas) {
    const r = da(v.unidade_id)
    r.vendas = Number(v.vendas)
    r.brutoCent = centavos(v.total)
  }
  for (const d of devolucoes) da(d.unidade_id).devolvidoCent = centavos(d.total)
  for (const s of semCompra) da(s.unidade_id).semCompraCent = centavos(s.total)
  for (const r of saida.values()) r.liquidoCent = r.brutoCent - r.devolvidoCent - r.semCompraCent
  return saida
}

/** As lojas somadas numa receita só. */
export function somarReceita(lojas: Iterable<ReceitaDaLoja>): ReceitaDaLoja {
  const s = zerada()
  for (const r of lojas) {
    s.vendas += r.vendas
    s.brutoCent += r.brutoCent
    s.devolvidoCent += r.devolvidoCent
    s.semCompraCent += r.semCompraCent
    s.liquidoCent += r.liquidoCent
  }
  return s
}

/**
 * Ticket médio, em reais: a receita LÍQUIDA sobre as vendas concluídas. A
 * mesma conta no Painel, na Análise e no assistente.
 */
export const ticketMedio = (r: Pick<ReceitaDaLoja, 'vendas' | 'liquidoCent'>): number =>
  r.vendas > 0 ? reais(r.liquidoCent) / r.vendas : 0

// ─────────────────────────────────────────────────────────────
// POR VENDEDOR
// ─────────────────────────────────────────────────────────────

export type LinhaDoVendedor = {
  unidadeId: string
  /** Nulo = venda sem vendedor escolhido. */
  vendedorId: string | null
  /** Só quando não há `vendedorId`: o nome gravado na venda (venda importada). */
  nomeAvulso: string | null
  vendas: number
  /** Total das vendas da pessoa. */
  vendaCent: number
  /** Devolvido das vendas DELA (pela loja da venda, na data da devolução). */
  devolvidoCent: number
  /** Parte das vendas dela paga com vale (de troca ou de troca sem a compra). */
  valeSaiCent: number
  /** Vale de devolução de venda DELA que pagou uma venda nova — volta para ela. */
  valeEntraCent: number
}

/**
 * O realizado de cada (loja, vendedor) na janela [de, ate).
 *
 * `unidadeIds` nulo = todas as lojas. `vendedores` limita a algumas pessoas
 * (o balcão pergunta só pela própria meta). A loja de cada pedaço é a da
 * venda a que ele pertence: a devolução e o vale que volta são da loja da
 * venda ORIGINAL; o vale que sai, da loja da venda nova.
 */
export async function realizadoPorVendedor(
  db: BancoDaOrg,
  o: { de: Date; ate: Date; unidadeIds: string[] | null; vendedores?: string[] },
): Promise<LinhaDoVendedor[]> {
  const todas = o.unidadeIds === null
  const lojas = o.unidadeIds ?? ['-']
  const todos = !o.vendedores
  const pessoas = o.vendedores ?? ['-']

  const vendas = await db.$queryRaw<{ unidade_id: string; vendedor_id: string | null; nome: string | null; vendas: number; total: string }[]>`
    select v.unidade_id, v.vendedor_id,
           case when v.vendedor_id is null then v.vendedor_nome end as nome,
           count(*)::int as vendas, coalesce(sum(v.total), 0) as total
      from vendas v
     where v.situacao = 'CONCLUIDA'
       and v.criada_em >= ${o.de} and v.criada_em < ${o.ate}
       and (${todas} or v.unidade_id = any(${lojas}))
       and (${todos} or v.vendedor_id = any(${pessoas}))
     group by 1, 2, 3
  `
  const devolucoes = await db.$queryRaw<{ unidade_id: string; vendedor_id: string | null; nome: string | null; total: string }[]>`
    select v.unidade_id, v.vendedor_id,
           case when v.vendedor_id is null then v.vendedor_nome end as nome,
           coalesce(sum(d.valor), 0) as total
      from devolucoes d join vendas v on v.id = d.venda_id
     where d.criada_em >= ${o.de} and d.criada_em < ${o.ate}
       and (${todas} or v.unidade_id = any(${lojas}))
       and (${todos} or v.vendedor_id = any(${pessoas}))
     group by 1, 2, 3
  `
  const valeSai = await db.$queryRaw<{ unidade_id: string; vendedor_id: string | null; nome: string | null; total: string }[]>`
    select v.unidade_id, v.vendedor_id,
           case when v.vendedor_id is null then v.vendedor_nome end as nome,
           coalesce(sum(p.valor), 0) as total
      from pagamentos p join vendas v on v.id = p.venda_id
     where p.forma = 'VALE' and p.vale_id is not null and v.situacao = 'CONCLUIDA'
       and v.criada_em >= ${o.de} and v.criada_em < ${o.ate}
       and (${todas} or v.unidade_id = any(${lojas}))
       and (${todos} or v.vendedor_id = any(${pessoas}))
     group by 1, 2, 3
  `
  // O vale que pagou a venda nova volta para quem vendeu a peça que voltou,
  // na data da venda nova — é quando o dinheiro "volta a ser venda".
  const valeEntra = await db.$queryRaw<{ unidade_id: string; vendedor_id: string | null; nome: string | null; total: string }[]>`
    select vo.unidade_id, vo.vendedor_id,
           case when vo.vendedor_id is null then vo.vendedor_nome end as nome,
           coalesce(sum(p.valor), 0) as total
      from pagamentos p
      join vendas v on v.id = p.venda_id
      join devolucoes d on d.vale_id = p.vale_id
      join vendas vo on vo.id = d.venda_id
     where p.forma = 'VALE' and v.situacao = 'CONCLUIDA'
       and v.criada_em >= ${o.de} and v.criada_em < ${o.ate}
       and (${todas} or vo.unidade_id = any(${lojas}))
       and (${todos} or vo.vendedor_id = any(${pessoas}))
     group by 1, 2, 3
  `

  const porChave = new Map<string, LinhaDoVendedor>()
  const linha = (r: { unidade_id: string; vendedor_id: string | null; nome: string | null }) => {
    const k = `${r.unidade_id}|${r.vendedor_id ?? ''}|${r.vendedor_id ? '' : (r.nome ?? '')}`
    let l = porChave.get(k)
    if (!l) {
      l = {
        unidadeId: r.unidade_id, vendedorId: r.vendedor_id, nomeAvulso: r.vendedor_id ? null : r.nome,
        vendas: 0, vendaCent: 0, devolvidoCent: 0, valeSaiCent: 0, valeEntraCent: 0,
      }
      porChave.set(k, l)
    }
    return l
  }
  for (const v of vendas) {
    const l = linha(v)
    l.vendas += Number(v.vendas)
    l.vendaCent += centavos(v.total)
  }
  for (const d of devolucoes) linha(d).devolvidoCent += centavos(d.total)
  for (const s of valeSai) linha(s).valeSaiCent += centavos(s.total)
  for (const e of valeEntra) linha(e).valeEntraCent += centavos(e.total)
  return [...porChave.values()]
}

export type ContaDoVendedor = {
  vendas: number
  /** Venda nova de verdade: sem a parte paga com vale, e com o vale que voltou da troca. */
  vendidoCent: number
  /** Devolução que NÃO ficou na loja como venda nova. */
  devolvidoCent: number
  /** O que conta para a meta e a comissão. Nunca negativo. */
  liquidoCent: number
}

/**
 * Soma as linhas de uma pessoa (ou de uma pessoa numa loja) na conta da meta.
 *
 * A devolução que virou venda nova não é devolução, e a venda paga com o
 * vale dela não é venda: os dois se anulam. O que sobra do vale que voltou
 * (devolução de outro mês, gasta agora) entra como vendido; o que sobra da
 * devolução (vale ainda não gasto, ou dinheiro de volta) sai como devolvido.
 */
export function contaDoVendedor(linhas: readonly LinhaDoVendedor[]): ContaDoVendedor {
  let vendas = 0, venda = 0, dev = 0, sai = 0, entra = 0
  for (const l of linhas) {
    vendas += l.vendas
    venda += l.vendaCent
    dev += l.devolvidoCent
    sai += l.valeSaiCent
    entra += l.valeEntraCent
  }
  const vendidoCent = venda - sai + Math.max(entra - dev, 0)
  const devolvidoCent = Math.max(dev - entra, 0)
  return { vendas, vendidoCent, devolvidoCent, liquidoCent: Math.max(vendidoCent - devolvidoCent, 0) }
}
