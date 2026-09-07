// Os números do painel.
//
// Tudo em UMA função e UMA passada no banco por assunto, porque painel que
// dispara vinte consultas fica lento justo no cliente que tem muita venda —
// que é o cliente que a gente não pode perder.
//
// E todas as consultas recebem a lista de unidades. Consolidado é "todas as
// que esta pessoa pode ver", não "todas as que existem": o gerente da loja 3
// vê o total da loja 3, e não o da empresa.

import { comoOrg } from './banco'
import type { Sessao } from './permissao'

const DIA = 864e5

export type Resumo = {
  hoje: { vendas: number; total: number; ticket: number }
  mes: { vendas: number; total: number; ticket: number; custo: number }
  ontem: { total: number }
  porDia: { dia: string; total: number }[]
  porForma: { forma: string; total: number; vendas: number }[]
  porUnidade: { unidadeId: string; nome: string; total: number; vendas: number }[]
  porVendedor: { nome: string; total: number; vendas: number }[]
  maisVendidos: { descricao: string; quantidade: number; total: number }[]
  parados: { descricao: string; codigo: string | null; saldo: number; desde: number | null }[]
  acabando: { descricao: string; codigo: string | null; saldo: number; minimo: number }[]
  estoque: { itens: number; unidades: number; valorCusto: number }
  clientes: { total: number; novosNoMes: number }
}

const n = (v: unknown) => Number(v ?? 0)

export async function resumoDoPainel(
  sessao: Sessao,
  unidadeIds: string[],
): Promise<Resumo> {
  if (unidadeIds.length === 0) return vazio()

  const inicioHoje = new Date()
  inicioHoje.setHours(0, 0, 0, 0)
  const inicioOntem = new Date(inicioHoje.getTime() - DIA)
  const inicioMes = new Date(inicioHoje.getFullYear(), inicioHoje.getMonth(), 1)
  const trintaDias = new Date(inicioHoje.getTime() - 29 * DIA)

  return comoOrg(sessao.orgId, async (db) => {
    const uni = unidadeIds

    const [
      totaisHoje,
      totaisOntem,
      totaisMes,
      porDia,
      porForma,
      porUnidade,
      porVendedor,
      maisVendidos,
      paradosBrutos,
      acabandoBrutos,
      estoque,
      clientesTotal,
      clientesNovos,
    ] = await Promise.all([
      db.venda.aggregate({
        where: { unidadeId: { in: uni }, situacao: 'CONCLUIDA', criadaEm: { gte: inicioHoje } },
        _sum: { total: true }, _count: true,
      }),
      db.venda.aggregate({
        where: {
          unidadeId: { in: uni }, situacao: 'CONCLUIDA',
          criadaEm: { gte: inicioOntem, lt: inicioHoje },
        },
        _sum: { total: true },
      }),
      db.venda.aggregate({
        where: { unidadeId: { in: uni }, situacao: 'CONCLUIDA', criadaEm: { gte: inicioMes } },
        _sum: { total: true }, _count: true,
      }),

      db.$queryRaw<{ dia: string; total: string }[]>`
        select to_char(v.criada_em::date, 'YYYY-MM-DD') as dia, sum(v.total) as total
          from vendas v
         where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
           and v.criada_em >= ${trintaDias}
         group by 1 order by 1
      `,

      db.$queryRaw<{ forma: string; total: string; vendas: string }[]>`
        select p.forma::text as forma, sum(p.valor) as total, count(*)::int as vendas
          from pagamentos p
          join vendas v on v.id = p.venda_id
         where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
           and v.criada_em >= ${inicioMes}
         group by 1 order by 2 desc
      `,

      db.$queryRaw<{ unidadeId: string; nome: string; total: string; vendas: string }[]>`
        select u.id as "unidadeId", u.nome,
               coalesce(sum(v.total), 0) as total,
               count(v.id)::int as vendas
          from unidades u
          left join vendas v on v.unidade_id = u.id
               and v.situacao = 'CONCLUIDA' and v.criada_em >= ${inicioMes}
         where u.id = any(${uni})
         group by u.id, u.nome order by 3 desc
      `,

      db.$queryRaw<{ nome: string; total: string; vendas: string }[]>`
        select coalesce(v.vendedor_nome, 'sem vendedor') as nome,
               sum(v.total) as total, count(*)::int as vendas
          from vendas v
         where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
           and v.criada_em >= ${inicioMes}
         group by 1 order by 2 desc limit 8
      `,

      db.$queryRaw<{ descricao: string; quantidade: string; total: string }[]>`
        select i.descricao, sum(i.quantidade) as quantidade, sum(i.total) as total
          from venda_itens i
          join vendas v on v.id = i.venda_id
         where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
           and v.criada_em >= ${inicioMes}
         group by 1 order by 3 desc limit 8
      `,

      // Parado: tem saldo e NÃO vendeu nos 30 dias. É dinheiro na arara.
      db.$queryRaw<{ descricao: string; codigo: string | null; saldo: string; dias: number | null }[]>`
        select p.nome ||
               coalesce(' — ' || (select string_agg(o.valor, ' · ')
                                    from variacao_opcoes vo join opcoes o on o.id = vo.opcao_id
                                   where vo.variacao_id = va.id), '') as descricao,
               va.codigo,
               sum(e.quantidade) as saldo,
               (select (current_date - max(v.criada_em::date))::int
                  from venda_itens i join vendas v on v.id = i.venda_id
                 where i.variacao_id = va.id and v.unidade_id = any(${uni})) as dias
          from variacoes va
          join produtos p on p.id = va.produto_id
          join estoque e on e.variacao_id = va.id and e.unidade_id = any(${uni})
         where va.ativa and e.quantidade > 0
         group by va.id, p.nome, va.codigo
        having not exists (
                 select 1 from venda_itens i join vendas v on v.id = i.venda_id
                  where i.variacao_id = va.id and v.unidade_id = any(${uni})
                    and v.criada_em >= ${trintaDias})
         order by saldo desc limit 8
      `,

      db.$queryRaw<{ descricao: string; codigo: string | null; saldo: string; minimo: string }[]>`
        select p.nome ||
               coalesce(' — ' || (select string_agg(o.valor, ' · ')
                                    from variacao_opcoes vo join opcoes o on o.id = vo.opcao_id
                                   where vo.variacao_id = va.id), '') as descricao,
               va.codigo, sum(e.quantidade) as saldo, max(e.minimo) as minimo
          from estoque e
          join variacoes va on va.id = e.variacao_id
          join produtos p on p.id = va.produto_id
         where e.unidade_id = any(${uni}) and va.ativa and e.minimo is not null
         group by va.id, p.nome, va.codigo
        having sum(e.quantidade) <= max(e.minimo)
         order by sum(e.quantidade) asc limit 8
      `,

      db.$queryRaw<{ itens: string; unidades: string; valor: string }[]>`
        select count(distinct e.variacao_id)::int as itens,
               coalesce(sum(e.quantidade), 0) as unidades,
               coalesce(sum(e.quantidade * coalesce(p.custo, 0)), 0) as valor
          from estoque e
          join variacoes va on va.id = e.variacao_id
          join produtos p on p.id = va.produto_id
         where e.unidade_id = any(${uni}) and e.quantidade > 0
      `,

      db.cliente.count({ where: { ativo: true } }),
      db.cliente.count({ where: { ativo: true, criadoEm: { gte: inicioMes } } }),
    ])

    const custoMes = await db.$queryRaw<{ custo: string }[]>`
      select coalesce(sum(i.quantidade * coalesce(i.custo_unit, 0)), 0) as custo
        from venda_itens i join vendas v on v.id = i.venda_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${inicioMes}
    `

    const totalHoje = n(totaisHoje._sum.total)
    const totalMes = n(totaisMes._sum.total)

    return {
      hoje: {
        vendas: totaisHoje._count,
        total: totalHoje,
        ticket: totaisHoje._count ? totalHoje / totaisHoje._count : 0,
      },
      ontem: { total: n(totaisOntem._sum.total) },
      mes: {
        vendas: totaisMes._count,
        total: totalMes,
        ticket: totaisMes._count ? totalMes / totaisMes._count : 0,
        custo: n(custoMes[0]?.custo),
      },
      porDia: porDia.map((d) => ({ dia: d.dia, total: n(d.total) })),
      porForma: porForma.map((f) => ({ forma: f.forma, total: n(f.total), vendas: n(f.vendas) })),
      porUnidade: porUnidade.map((u) => ({
        unidadeId: u.unidadeId, nome: u.nome, total: n(u.total), vendas: n(u.vendas),
      })),
      porVendedor: porVendedor.map((v) => ({ nome: v.nome, total: n(v.total), vendas: n(v.vendas) })),
      maisVendidos: maisVendidos.map((i) => ({
        descricao: i.descricao, quantidade: n(i.quantidade), total: n(i.total),
      })),
      parados: paradosBrutos.map((p) => ({
        descricao: p.descricao, codigo: p.codigo, saldo: n(p.saldo), desde: p.dias,
      })),
      acabando: acabandoBrutos.map((a) => ({
        descricao: a.descricao, codigo: a.codigo, saldo: n(a.saldo), minimo: n(a.minimo),
      })),
      estoque: {
        itens: n(estoque[0]?.itens),
        unidades: n(estoque[0]?.unidades),
        valorCusto: n(estoque[0]?.valor),
      },
      clientes: { total: clientesTotal, novosNoMes: clientesNovos },
    }
  })
}

const vazio = (): Resumo => ({
  hoje: { vendas: 0, total: 0, ticket: 0 },
  ontem: { total: 0 },
  mes: { vendas: 0, total: 0, ticket: 0, custo: 0 },
  porDia: [], porForma: [], porUnidade: [], porVendedor: [],
  maisVendidos: [], parados: [], acabando: [],
  estoque: { itens: 0, unidades: 0, valorCusto: 0 },
  clientes: { total: 0, novosNoMes: 0 },
})
