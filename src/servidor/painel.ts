// Os números do painel.
//
// Tudo em UMA função e UMA passada no banco por assunto, porque painel que
// dispara vinte consultas fica lento justo no cliente que tem muita venda —
// que é o cliente que a gente não pode perder.
//
// E todas as consultas recebem a lista de unidades. Consolidado é "todas as
// que esta pessoa pode ver", não "todas as que existem": o gerente da loja 3
// vê o total da loja 3, e não o da empresa.
//
// ── o fuso ───────────────────────────────────────────────────
// A venda é gravada em UTC (é como o Prisma escreve `timestamp`). Agrupar
// "por dia" e "por hora" direto na coluna daria o dia de Londres: a venda das
// 22h de sexta cairia no sábado. Toda conta de calendário aqui converte antes
// para o horário de São Paulo — o Brasil comercial não tem horário de verão
// desde 2019, e a loja de Manaus verá uma hora a mais no relógio do gráfico,
// o que é um defeito conhecido e pequeno. Quando houver fuso por empresa,
// ele entra aqui, num lugar só.

import { comoOrg } from './banco'
import type { Plano } from '@prisma/client'
import type { Sessao } from './permissao'
import type { Janela } from './periodo'

const DIA = 864e5

export type PontoDoDia = { dia: string; total: number; vendas: number }

export type Resumo = {
  plano: Plano
  /** O periodo escolhido. Tudo abaixo e dele, menos o que diz o contrario. */
  atual: { vendas: number; total: number; ticket: number; custo: number }
  /** A janela do MESMO tamanho, imediatamente antes. */
  anterior: { vendas: number; total: number }
  devolucoes: { quantas: number; valor: number }
  porDia: PontoDoDia[]
  porDiaAnterior: PontoDoDia[]
  /** dia da semana (0 = domingo) × hora (0-23), em reais. */
  porHora: number[][]
  porForma: { forma: string; total: number; vendas: number }[]
  porCategoria: { nome: string; total: number; quantidade: number }[]
  porUnidade: { unidadeId: string; nome: string; total: number; vendas: number }[]
  porVendedor: { nome: string; total: number; vendas: number }[]
  maisVendidos: { descricao: string; quantidade: number; total: number }[]
  parados: { descricao: string; codigo: string | null; saldo: number; desde: number | null }[]
  acabando: { descricao: string; codigo: string | null; saldo: number; minimo: number }[]
  estoque: { itens: number; unidades: number; valorCusto: number }
  estoquePorCategoria: { nome: string; valor: number }[]
  clientes: {
    total: number
    novosNoPeriodo: number
    /** Vendas do período com cliente escolhido, e o total de vendas. */
    identificadas: number
    vendas: number
    /** Pessoas diferentes que compraram no período. */
    pessoas: number
    /** Pessoas que compraram duas vezes ou mais no período. */
    recorrentes: number
  }
}

const n = (v: unknown) => Number(v ?? 0)

/** Cada dia da janela, mesmo o que não vendeu nada: gráfico não pula dia. */
export function densificar(de: Date, ate: Date, linhas: PontoDoDia[]): PontoDoDia[] {
  const por = new Map(linhas.map((l) => [l.dia, l]))
  const saida: PontoDoDia[] = []
  for (let d = new Date(de.getFullYear(), de.getMonth(), de.getDate()); d < ate; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    saida.push(por.get(chave) ?? { dia: chave, total: 0, vendas: 0 })
  }
  return saida
}

export async function resumoDoPainel(
  sessao: Sessao,
  unidadeIds: string[],
  j: Janela,
): Promise<Resumo> {
  if (unidadeIds.length === 0) return vazio()

  // "Parado ha mais de 30 dias" NAO segue o filtro: e uma definicao do
  // negocio, nao um recorte de leitura. Olhando 7 dias, tudo pareceria parado.
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const trintaDias = new Date(hoje.getTime() - 29 * DIA)

  return comoOrg(sessao.orgId, async (db) => {
    const uni = unidadeIds

    const porDiaSql = (de: Date, ate: Date) => db.$queryRaw<{ dia: string; total: string; vendas: number }[]>`
      select to_char((v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as dia,
             sum(v.total) as total,
             count(*)::int as vendas
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de} and v.criada_em < ${ate}
       group by 1 order by 1
    `

    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { plano: true } })
    const totaisAtual = await db.venda.aggregate({
      where: {
        unidadeId: { in: uni }, situacao: 'CONCLUIDA',
        criadaEm: { gte: j.de, lt: j.ate },
      },
      _sum: { total: true }, _count: true,
    })
    const totaisAnterior = await db.venda.aggregate({
      where: {
        unidadeId: { in: uni }, situacao: 'CONCLUIDA',
        criadaEm: { gte: j.deAnterior, lt: j.ateAnterior },
      },
      _sum: { total: true }, _count: true,
    })
    // Com a contagem junto: sem ela o grafico responde "quanto" e nao
    // responde "de quantas vendas" — e dia de R$ 900 em uma venda e dia de
    // R$ 900 em vinte sao dois dias completamente diferentes para quem
    // decide o que fazer amanha.
    const porDia = await porDiaSql(j.de, j.ate)
    const porDiaAnterior = await porDiaSql(j.deAnterior, j.ateAnterior)
    // Quando a loja vende: dia da semana × hora. E o que decide escala de
    // equipe e horario de abrir.
    const porHora = await db.$queryRaw<{ dia: number; hora: number; total: string }[]>`
      select extract(dow from (v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo'))::int as dia,
             extract(hour from (v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo'))::int as hora,
             sum(v.total) as total
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
       group by 1, 2
    `
    const porForma = await db.$queryRaw<{ forma: string; total: string; vendas: string }[]>`
      select p.forma::text as forma, sum(p.valor) as total, count(*)::int as vendas
        from pagamentos p
        join vendas v on v.id = p.venda_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
       group by 1 order by 2 desc
    `
    const porCategoria = await db.$queryRaw<{ nome: string; total: string; quantidade: string }[]>`
      select coalesce(c.nome, 'Sem categoria') as nome, sum(i.total) as total, sum(i.quantidade) as quantidade
        from venda_itens i
        join vendas v on v.id = i.venda_id
        left join variacoes va on va.id = i.variacao_id
        left join produtos p on p.id = va.produto_id
        left join categorias c on c.id = p.categoria_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
       group by 1 order by 2 desc limit 8
    `
    const porUnidade = await db.$queryRaw<{ unidadeId: string; nome: string; total: string; vendas: string }[]>`
      select u.id as "unidadeId", u.nome,
             coalesce(sum(v.total), 0) as total,
             count(v.id)::int as vendas
        from unidades u
        left join vendas v on v.unidade_id = u.id
             and v.situacao = 'CONCLUIDA' and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
       where u.id = any(${uni})
       group by u.id, u.nome order by 3 desc
    `
    const porVendedor = await db.$queryRaw<{ nome: string; total: string; vendas: string }[]>`
      select coalesce(v.vendedor_nome, 'sem vendedor') as nome,
             sum(v.total) as total, count(*)::int as vendas
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
       group by 1 order by 2 desc limit 8
    `
    const maisVendidos = await db.$queryRaw<{ descricao: string; quantidade: string; total: string }[]>`
      select i.descricao, sum(i.quantidade) as quantidade, sum(i.total) as total
        from venda_itens i
        join vendas v on v.id = i.venda_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
       group by 1 order by 3 desc limit 8
    `
    // Parado: tem saldo e NÃO vendeu nos 30 dias. É dinheiro na arara.
    const paradosBrutos = await db.$queryRaw<{ descricao: string; codigo: string | null; saldo: string; dias: number | null }[]>`
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
    `
    const acabandoBrutos = await db.$queryRaw<{ descricao: string; codigo: string | null; saldo: string; minimo: string }[]>`
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
    `
    const estoque = await db.$queryRaw<{ itens: string; unidades: string; valor: string }[]>`
      select count(distinct e.variacao_id)::int as itens,
             coalesce(sum(e.quantidade), 0) as unidades,
             coalesce(sum(e.quantidade * coalesce(p.custo, 0)), 0) as valor
        from estoque e
        join variacoes va on va.id = e.variacao_id
        join produtos p on p.id = va.produto_id
       where e.unidade_id = any(${uni}) and e.quantidade > 0
    `
    const estoquePorCategoria = await db.$queryRaw<{ nome: string; valor: string }[]>`
      select coalesce(c.nome, 'Sem categoria') as nome,
             coalesce(sum(e.quantidade * coalesce(p.custo, 0)), 0) as valor
        from estoque e
        join variacoes va on va.id = e.variacao_id
        join produtos p on p.id = va.produto_id
        left join categorias c on c.id = p.categoria_id
       where e.unidade_id = any(${uni}) and e.quantidade > 0
       group by 1 order by 2 desc limit 8
    `
    const clientesTotal = await db.cliente.count({ where: { ativo: true } })
    const clientesNovos = await db.cliente.count({ where: { ativo: true, criadoEm: { gte: j.de, lt: j.ate } } })
    const identificacao = await db.$queryRaw<{ identificadas: number; vendas: number; pessoas: number }[]>`
      select count(*) filter (where v.cliente_id is not null)::int as identificadas,
             count(*)::int as vendas,
             count(distinct v.cliente_id)::int as pessoas
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
    `
    const recorrentes = await db.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from (
        select v.cliente_id from vendas v
         where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA' and v.cliente_id is not null
           and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
         group by v.cliente_id having count(*) >= 2) s
    `
    const devolucoes = await db.devolucao.aggregate({
      where: { unidadeId: { in: uni }, criadaEm: { gte: j.de, lt: j.ate } },
      _sum: { valor: true }, _count: true,
    })
    const custoMes = await db.$queryRaw<{ custo: string }[]>`
      select coalesce(sum(i.quantidade * coalesce(i.custo_unit, 0)), 0) as custo
        from venda_itens i join vendas v on v.id = i.venda_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
    `

    const total = n(totaisAtual._sum.total)

    const calor: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
    for (const h of porHora) {
      const linha = calor[h.dia]
      if (linha && h.hora >= 0 && h.hora < 24) linha[h.hora] = (linha[h.hora] ?? 0) + n(h.total)
    }

    return {
      plano: org.plano,
      atual: {
        vendas: totaisAtual._count,
        total,
        ticket: totaisAtual._count ? total / totaisAtual._count : 0,
        custo: n(custoMes[0]?.custo),
      },
      anterior: {
        vendas: totaisAnterior._count,
        total: n(totaisAnterior._sum.total),
      },
      devolucoes: { quantas: devolucoes._count, valor: n(devolucoes._sum.valor) },
      porDia: densificar(j.de, j.ate, porDia.map((d) => ({ dia: d.dia, total: n(d.total), vendas: n(d.vendas) }))),
      porDiaAnterior: densificar(
        j.deAnterior,
        j.ateAnterior,
        porDiaAnterior.map((d) => ({ dia: d.dia, total: n(d.total), vendas: n(d.vendas) })),
      ),
      porHora: calor,
      porForma: porForma.map((f) => ({ forma: f.forma, total: n(f.total), vendas: n(f.vendas) })),
      porCategoria: porCategoria.map((c) => ({ nome: c.nome, total: n(c.total), quantidade: n(c.quantidade) })),
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
      estoquePorCategoria: estoquePorCategoria.map((c) => ({ nome: c.nome, valor: n(c.valor) })),
      clientes: {
        total: clientesTotal,
        novosNoPeriodo: clientesNovos,
        identificadas: n(identificacao[0]?.identificadas),
        vendas: n(identificacao[0]?.vendas),
        pessoas: n(identificacao[0]?.pessoas),
        recorrentes: n(recorrentes[0]?.n),
      },
    }
  })
}

const vazio = (): Resumo => ({
  plano: 'GRATIS',
  atual: { vendas: 0, total: 0, ticket: 0, custo: 0 },
  anterior: { vendas: 0, total: 0 },
  devolucoes: { quantas: 0, valor: 0 },
  porDia: [], porDiaAnterior: [], porHora: [],
  porForma: [], porCategoria: [], porUnidade: [], porVendedor: [],
  maisVendidos: [], parados: [], acabando: [],
  estoque: { itens: 0, unidades: 0, valorCusto: 0 },
  estoquePorCategoria: [],
  clientes: { total: 0, novosNoPeriodo: 0, identificadas: 0, vendas: 0, pessoas: 0, recorrentes: 0 },
})
