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

import { comoOrg, type BancoDaOrg } from './banco'
import type { Plano } from '@prisma/client'
import { exigir, soAsQuePode, type Sessao } from './permissao'
import { janela, type Janela } from './periodo'
import { diaEmSP, inicioDoDiaEmSP, somarDias } from './dia'
import { reais } from './dinheiro'
import { contaDoVendedor, realizadoPorVendedor, receitaPorLoja, somarReceita, ticketMedio } from './receita'

export type PontoDoDia = { dia: string; total: number; vendas: number }

/**
 * Um item do "Mais vendidos". `servico` diz se é serviço do catálogo: a
 * consulta foi feita 24 vezes, não são "24 un" de consulta. Item avulso
 * (fora do catálogo) conta como mercadoria, que é como sempre apareceu.
 */
export type MaisVendido = { descricao: string; quantidade: number; total: number; servico: boolean }

export type Resumo = {
  plano: Plano
  /** O periodo escolhido. Tudo abaixo e dele, menos o que diz o contrario. */
  /**
   * `custo` é o custo da mercadoria que FICOU vendida: o das vendas menos o
   * das peças que voltaram em devolução na janela. A margem bruta é
   * (total − devoluções.valor − custo) sobre (total − devoluções.valor).
   *
   * `total` é o BRUTO (o que passou no balcão); `liquido` é a receita da
   * régua de `receita.ts` — menos devolução e menos o vale de troca sem a
   * compra. O ticket é o líquido sobre as vendas: o mesmo da Análise.
   * (`liquido` é opcional só para quem monta um resumo à mão; `resumoDoPainel`
   * sempre preenche.)
   */
  atual: { vendas: number; total: number; liquido?: number; ticket: number; custo: number }
  /** A janela do MESMO tamanho, imediatamente antes. */
  anterior: { vendas: number; total: number }
  devolucoes: { quantas: number; valor: number }
  porDia: PontoDoDia[]
  porDiaAnterior: PontoDoDia[]
  /** dia da semana (0 = domingo) × hora (0-23), em reais. */
  porHora: number[][]
  porForma: { forma: string; total: number; vendas: number }[]
  /** `servico`: só serviço na categoria — a quantidade vira "24×", não "24 un". */
  porCategoria: { nome: string; total: number; quantidade: number; servico: boolean }[]
  porUnidade: { unidadeId: string; nome: string; total: number; vendas: number }[]
  /**
   * O líquido de cada vendedor, na conta da meta (`contaDoVendedor`): a troca
   * paga com vale não conta de novo para quem registrou — a blusa trocada
   * fica com quem a vendeu.
   */
  porVendedor: { nome: string; total: number; vendas: number }[]
  maisVendidos: MaisVendido[]
  parados: { descricao: string; codigo: string | null; saldo: number; desde: number | null }[]
  acabando: { descricao: string; codigo: string | null; saldo: number; minimo: number }[]
  /** `unidades` é só o que se conta (un, par, cx); peso e medida à parte. */
  estoque: { itens: number; unidades: number; quilos: number; litros: number; metros: number; valorCusto: number }
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

/**
 * Cada dia da janela, mesmo o que não vendeu nada: gráfico não pula dia.
 *
 * As chaves são o dia em SÃO PAULO, o mesmo que o SQL agrupa. Eram montadas
 * com o relógio da máquina: num servidor em UTC, a janela que começa 00:00 de
 * São Paulo (03:00 UTC) gerava as chaves certas por acaso — mas a do dia de
 * hoje, depois das 21h, virava amanhã, e as vendas da noite sumiam do gráfico.
 */
export function densificar(de: Date, ate: Date, linhas: PontoDoDia[]): PontoDoDia[] {
  const por = new Map(linhas.map((l) => [l.dia, l]))
  const saida: PontoDoDia[] = []
  const fim = diaEmSP(ate)
  for (let chave = diaEmSP(de); chave < fim; chave = somarDias(chave, 1)) {
    saida.push(por.get(chave) ?? { dia: chave, total: 0, vendas: 0 })
  }
  return saida
}

export async function resumoDoPainel(
  sessao: Sessao,
  unidadeIds: string[],
  j: Janela,
): Promise<Resumo> {
  exigir(sessao, 'relatorio.ver')
  unidadeIds = soAsQuePode(sessao, 'relatorio.ver', unidadeIds)
  if (unidadeIds.length === 0) return vazio()

  // "Parado ha mais de 30 dias" NAO segue o filtro: e uma definicao do
  // negocio, nao um recorte de leitura. Olhando 7 dias, tudo pareceria parado.
  // Dia de São Paulo, não da máquina — ver `dia.ts`.
  const hoje = diaEmSP()
  const trintaDias = inicioDoDiaEmSP(somarDias(hoje, -29))

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
    const porCategoria = await db.$queryRaw<{ nome: string; total: string; quantidade: string; servico: boolean }[]>`
      select coalesce(c.nome, 'Sem categoria') as nome, sum(i.total) as total, sum(i.quantidade) as quantidade,
             bool_and(coalesce(p.servico, false)) as servico
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
    // Por vendedor na conta da meta, e não o total bruto de cada um: a troca
    // dava R$ 100 para quem vendeu a blusa e outros R$ 100 para quem
    // registrou a troca — R$ 200 "vendidos" de uma blusa só.
    const porVendedorLinhas = await realizadoPorVendedor(db, { de: j.de, ate: j.ate, unidadeIds: uni })
    const idsVendedor = [...new Set(porVendedorLinhas.map((l) => l.vendedorId).filter((x): x is string => !!x))]
    const nomesVendedor = new Map(
      (await db.usuario.findMany({ where: { id: { in: idsVendedor } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]),
    )
    const porPessoa = new Map<string, { nome: string; linhas: typeof porVendedorLinhas }>()
    for (const l of porVendedorLinhas) {
      const nome = l.vendedorId ? (nomesVendedor.get(l.vendedorId) ?? 'sem nome') : (l.nomeAvulso ?? 'sem vendedor')
      const k = l.vendedorId ?? `avulso:${nome}`
      const p = porPessoa.get(k) ?? { nome, linhas: [] }
      p.linhas.push(l)
      porPessoa.set(k, p)
    }
    const porVendedor = [...porPessoa.values()]
      .map((p) => {
        const c = contaDoVendedor(p.linhas)
        return { nome: p.nome, total: reais(c.liquidoCent), vendas: c.vendas }
      })
      .filter((p) => p.total > 0 || p.vendas > 0)
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 8)
    const maisVendidos = await db.$queryRaw<{ descricao: string; quantidade: string; total: string; servico: boolean }[]>`
      select i.descricao, sum(i.quantidade) as quantidade, sum(i.total) as total,
             bool_and(coalesce(p.servico, false)) as servico
        from venda_itens i
        join vendas v on v.id = i.venda_id
        left join variacoes va on va.id = i.variacao_id
        left join produtos p on p.id = va.produto_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
       group by 1 order by 3 desc limit 8
    `
    // Parado: tem saldo e NÃO vendeu nos 30 dias. É dinheiro na arara.
    // Material de uso fica de fora: ele não sai por venda, sai pelo consumo —
    // a acetona do salão seria "parada" para sempre, e a lista de parados
    // viraria a lista de material.
    const paradosBrutos = await db.$queryRaw<{ descricao: string; codigo: string | null; saldo: string; dias: number | null }[]>`
      select p.nome ||
             coalesce(' — ' || (select string_agg(o.valor, ' · ')
                                  from variacao_opcoes vo join opcoes o on o.id = vo.opcao_id
                                 where vo.variacao_id = va.id), '') as descricao,
             va.codigo,
             sum(e.quantidade) as saldo,
             -- current_date e criada_em::date eram o dia do BANCO (UTC), não o
             -- da loja: a venda das 22h caía no dia seguinte, e os dias parados
             -- erravam por um conforme a hora em que a tela abria.
             (select (${hoje}::date - max((v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date))::int
                from venda_itens i join vendas v on v.id = i.venda_id
               where i.variacao_id = va.id and v.unidade_id = any(${uni})
                 and v.situacao = 'CONCLUIDA') as dias
        from variacoes va
        join produtos p on p.id = va.produto_id
        join estoque e on e.variacao_id = va.id and e.unidade_id = any(${uni})
       where va.ativa and e.quantidade > 0 and not p.uso_interno
       group by va.id, p.nome, va.codigo
      having not exists (
               select 1 from venda_itens i join vendas v on v.id = i.venda_id
                where i.variacao_id = va.id and v.unidade_id = any(${uni})
                  -- Venda cancelada não é venda: a peça cuja única saída foi
                  -- desfeita continua parada (a régua da Análise).
                  and v.situacao = 'CONCLUIDA'
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
    // Peça e quilo não se somam: 800 blusas mais 381 kg de sorvete davam
    // "800,381 peças". O que se conta (un, par, caixa) fica num número; o que
    // se pesa ou mede vai em quilos, litros e metros, cada um com a sua sigla.
    const estoque = await db.$queryRaw<{ itens: string; unidades: string; quilos: string; litros: string; metros: string; valor: string }[]>`
      select count(distinct e.variacao_id)::int as itens,
             coalesce(sum(e.quantidade) filter (where p.medida::text in ('UN', 'PAR', 'CX')), 0) as unidades,
             coalesce(sum(case p.medida::text when 'KG' then e.quantidade when 'G' then e.quantidade / 1000 end), 0) as quilos,
             coalesce(sum(case p.medida::text when 'L' then e.quantidade when 'ML' then e.quantidade / 1000 end), 0) as litros,
             coalesce(sum(e.quantidade) filter (where p.medida::text = 'M'), 0) as metros,
             coalesce(sum(e.quantidade * coalesce(p.custo, 0)), 0) as valor
        from estoque e
        join variacoes va on va.id = e.variacao_id
        join produtos p on p.id = va.produto_id
       where e.unidade_id = any(${uni}) and e.quantidade > 0 and not p.servico
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
    // A peça que voltou não foi vendida: a receita já sai pela devolução, e o
    // custo dela tem de sair junto. Sem isto, a loja que devolveu muito
    // aparecia com margem PIOR do que a real — a receita caía e o custo não.
    const custoDevolvido = await custoDasDevolucoes(db, uni, j.de, j.ate)
    const receita = somarReceita((await receitaPorLoja(db, uni, j.de, j.ate)).values())

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
        liquido: reais(receita.liquidoCent),
        ticket: ticketMedio(receita),
        custo: n(custoMes[0]?.custo) - custoDevolvido,
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
      porCategoria: porCategoria.map((c) => ({ nome: c.nome, total: n(c.total), quantidade: n(c.quantidade), servico: !!c.servico })),
      porUnidade: porUnidade.map((u) => ({
        unidadeId: u.unidadeId, nome: u.nome, total: n(u.total), vendas: n(u.vendas),
      })),
      porVendedor,
      maisVendidos: maisVendidos.map((i) => ({
        descricao: i.descricao, quantidade: n(i.quantidade), total: n(i.total), servico: !!i.servico,
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
        quilos: n(estoque[0]?.quilos),
        litros: n(estoque[0]?.litros),
        metros: n(estoque[0]?.metros),
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

// ─────────────────────────────────────────────────────────────
// O DIA DE HOJE — o painel simples
// ─────────────────────────────────────────────────────────────
//
// O simples não escolhe período: é sempre hoje. E a comparação NÃO é com
// ontem. É com o mesmo dia da semana passada, até a MESMA HORA — por dois
// motivos que aparecem no primeiro sábado de uso:
//
//   1. Comércio tem semana. Sábado contra sexta é sempre "subiu", segunda
//      contra domingo é sempre "caiu", e a seta vira previsão do calendário
//      em vez de notícia. Quarta contra quarta é a mesma freguesia.
//   2. O dia ainda não acabou. Às 10h, o dia de hoje contra o dia inteiro de
//      ontem é queda de 80% todo santo dia — e seta vermelha toda manhã
//      ensina a não olhar a seta. Até a mesma hora, a conta é justa desde a
//      primeira venda.
//
// O dia inteiro da semana passada vem junto, separado: é o "quanto dá para
// fazer hoje", a meta que ninguém precisou escrever.

export type ResumoDeHoje = {
  plano: Plano
  /** `ticket` é o líquido sobre as vendas, a régua de `receita.ts` — a mesma do painel completo. */
  hoje: { total: number; vendas: number; ticket: number; ultima: Date | null }
  /** O mesmo dia da semana passada: até esta hora, e inteiro. */
  semanaPassada: { ateAgora: number; vendasAteAgora: number; diaInteiro: number }
  /** Reais por hora (0-23), no relógio de São Paulo. */
  porHora: number[]
  porHoraSemanaPassada: number[]
  /** Os cinco que mais venderam nos últimos 7 dias, em reais. */
  maisVendidos: MaisVendido[]
}

export async function resumoDeHoje(
  sessao: Sessao,
  unidadeIds: string[],
  agora: Date = new Date(),
): Promise<ResumoDeHoje> {
  exigir(sessao, 'relatorio.ver')
  unidadeIds = soAsQuePode(sessao, 'relatorio.ver', unidadeIds)

  const j = janela('hoje', agora)
  const semana = janela('7d', agora)
  // Dias de calendário de São Paulo, não o relógio da máquina — mesma regra
  // de `periodo.ts`. E "até esta hora" é a mesma hora de São Paulo uma
  // semana atrás: sem horário de verão desde 2019, são 7 × 24h exatas.
  const hojeSP = diaEmSP(agora)
  const dePassada = inicioDoDiaEmSP(somarDias(hojeSP, -7))
  const atePassada = inicioDoDiaEmSP(somarDias(hojeSP, -6))
  const agoraPassada = new Date(agora.getTime() - 7 * 864e5)

  const zerado = (): number[] => Array.from({ length: 24 }, () => 0)
  if (unidadeIds.length === 0) {
    return {
      plano: 'GRATIS',
      hoje: { total: 0, vendas: 0, ticket: 0, ultima: null },
      semanaPassada: { ateAgora: 0, vendasAteAgora: 0, diaInteiro: 0 },
      porHora: zerado(), porHoraSemanaPassada: zerado(), maisVendidos: [],
    }
  }

  return comoOrg(sessao.orgId, async (db) => {
    const uni = unidadeIds
    const conta = (de: Date, ate: Date) =>
      db.venda.aggregate({
        where: { unidadeId: { in: uni }, situacao: 'CONCLUIDA', criadaEm: { gte: de, lt: ate } },
        _sum: { total: true }, _count: true, _max: { criadaEm: true },
      })
    const horaSql = (de: Date, ate: Date) => db.$queryRaw<{ hora: number; total: string }[]>`
      select extract(hour from (v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo'))::int as hora,
             sum(v.total) as total
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de} and v.criada_em < ${ate}
       group by 1
    `
    const porHoras = (linhas: { hora: number; total: string }[]) => {
      const h = zerado()
      for (const l of linhas) if (l.hora >= 0 && l.hora < 24) h[l.hora] = n(l.total)
      return h
    }

    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { plano: true } })
    const hoje = await conta(j.de, j.ate)
    const ateAgora = await conta(dePassada, agoraPassada)
    const diaInteiro = await conta(dePassada, atePassada)
    const porHora = await horaSql(j.de, j.ate)
    const porHoraPassada = await horaSql(dePassada, atePassada)
    // Sete dias e não hoje: às 10h a lista de hoje tem dois itens e muda a
    // cada venda. A da semana é a que diz o que repor e o que pôr na vitrine.
    const maisVendidos = await db.$queryRaw<{ descricao: string; quantidade: string; total: string; servico: boolean }[]>`
      select i.descricao, sum(i.quantidade) as quantidade, sum(i.total) as total,
             bool_and(coalesce(p.servico, false)) as servico
        from venda_itens i
        join vendas v on v.id = i.venda_id
        left join variacoes va on va.id = i.variacao_id
        left join produtos p on p.id = va.produto_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${semana.de} and v.criada_em < ${semana.ate}
       group by 1 order by 3 desc limit 5
    `

    const total = n(hoje._sum.total)
    const receitaHoje = somarReceita((await receitaPorLoja(db, uni, j.de, j.ate)).values())
    return {
      plano: org.plano,
      hoje: {
        total,
        vendas: hoje._count,
        ticket: ticketMedio(receitaHoje),
        ultima: hoje._max.criadaEm ?? null,
      },
      semanaPassada: {
        ateAgora: n(ateAgora._sum.total),
        vendasAteAgora: ateAgora._count,
        diaInteiro: n(diaInteiro._sum.total),
      },
      porHora: porHoras(porHora),
      porHoraSemanaPassada: porHoras(porHoraPassada),
      maisVendidos: maisVendidos.map((i) => ({
        descricao: i.descricao, quantidade: n(i.quantidade), total: n(i.total), servico: !!i.servico,
      })),
    }
  })
}

/**
 * O custo (na hora da venda) do que voltou em devolução no período.
 *
 * A devolução guarda a quantidade devolvida de cada item; o custo vem do
 * `custo_unit` do item vendido — a mesma fotografia que o CMV usa. Filtrado
 * pela DATA DA DEVOLUÇÃO, que é quando a receita sai também.
 */
export async function custoDasDevolucoes(
  db: BancoDaOrg,
  unidadeIds: string[],
  de: Date,
  /** Exclusivo, como toda janela de `periodo.ts`. */
  ate: Date,
): Promise<number> {
  const linhas = await db.$queryRaw<{ custo: string }[]>`
    select coalesce(sum(di.quantidade * coalesce(vi.custo_unit, 0)), 0) as custo
      from devolucao_itens di
      join devolucoes d on d.id = di.devolucao_id
      join venda_itens vi on vi.id = di.venda_item_id
     where d.unidade_id = any(${unidadeIds})
       and d.criada_em >= ${de} and d.criada_em < ${ate}
  `
  return n(linhas[0]?.custo)
}

const vazio = (): Resumo => ({
  plano: 'GRATIS',
  atual: { vendas: 0, total: 0, liquido: 0, ticket: 0, custo: 0 },
  anterior: { vendas: 0, total: 0 },
  devolucoes: { quantas: 0, valor: 0 },
  porDia: [], porDiaAnterior: [], porHora: [],
  porForma: [], porCategoria: [], porUnidade: [], porVendedor: [],
  maisVendidos: [], parados: [], acabando: [],
  estoque: { itens: 0, unidades: 0, quilos: 0, litros: 0, metros: 0, valorCusto: 0 },
  estoquePorCategoria: [],
  clientes: { total: 0, novosNoPeriodo: 0, identificadas: 0, vendas: 0, pessoas: 0, recorrentes: 0 },
})
