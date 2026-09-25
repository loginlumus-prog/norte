// As três leituras que só fazem sentido quando a loja já anda.
//
// O painel responde "como foi o mês". Estas três respondem perguntas que o
// dono só faz depois que o mês passou várias vezes:
//
//   • entre lojas — "qual das minhas lojas está puxando, e qual está pesando?"
//   • curva ABC   — "de tudo que eu tenho, o que realmente sustenta a casa?"
//   • escala      — "quem abriu, a que horas, e quanto saiu naquele turno?"
//
// ── por que elas ficam juntas num arquivo só ─────────────────
// Porque são a mesma família: nenhuma delas mexe em nada, todas leem a mesma
// janela de tempo e as mesmas unidades, e as três só existem no plano Rede.
// Separadas em três arquivos, a regra de plano ficaria escrita em três
// lugares — e é exatamente o tipo de regra que se esquece de repetir.
//
// ── o que NÃO está aqui ──────────────────────────────────────
// Nada de "o que fazer". A leitura mostra o número e para. Conselho é o que
// o assistente faz, com a chave da IA, e é outro produto — misturar os dois
// aqui faria a tela prometer uma coisa que o plano do cliente pode não ter.

import { comoOrg } from './banco'
import { exigir, soAsQuePode, type Sessao } from './permissao'
import { PLANOS } from './planos'
import type { Plano } from '@prisma/client'

/** Número vindo do banco (Decimal, string ou nulo) em reais. */
const n = (v: unknown) => Number(v ?? 0)

/**
 * Estas leituras são do plano Rede para cima.
 *
 * Escrito como degrau, e não como lista de planos, porque plano novo acima do
 * Rede herda sozinho — lista precisaria ser lembrada.
 */
export function temAnaliseAvancada(plano: Plano): boolean {
  return PLANOS[plano].degrau >= PLANOS.REDE.degrau
}

/**
 * O plano da empresa, sozinho.
 *
 * `exigirEntrada` devolve a fachada da empresa — nome, slug, módulos — e o
 * plano não está lá de propósito: ele é dado de cobrança, e a fachada é lida
 * em toda página, inclusive na porta. Quem precisa dele pede.
 */
export async function planoDaEmpresa(sessao: Sessao): Promise<Plano> {
  return comoOrg(sessao.orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: { plano: true },
    })
    return org.plano
  })
}

// ── 1. entre lojas ───────────────────────────────────────────

export type LojaComparada = {
  unidadeId: string
  nome: string
  vendas: number
  receita: number
  custo: number
  margem: number
  /** Margem em porcento da receita. Nulo quando não vendeu nada. */
  margemPct: number | null
  ticket: number
  /** Valor de custo parado na prateleira: tem estoque e não vendeu na janela. */
  parado: number
  /** Valor de custo de TUDO que está em estoque nesta loja. */
  estoque: number
}

export async function compararLojas(
  sessao: Sessao,
  unidadeIds: string[],
  de: Date,
  ate: Date,
): Promise<LojaComparada[]> {
  exigir(sessao, 'relatorio.ver')
  // A lista de lojas vem de quem chama (e quem chama leu do endereço).
  unidadeIds = soAsQuePode(sessao, 'relatorio.ver', unidadeIds)
  if (unidadeIds.length === 0) return []

  return comoOrg(sessao.orgId, async (db) => {
    const uni = unidadeIds

    const lojas = await db.unidade.findMany({
      where: { id: { in: uni } },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    })

    // Receita e contagem vêm da venda. O custo vem do ITEM, e por isso são
    // duas consultas e não uma: juntar venda com item multiplicaria o total
    // da venda pelo número de itens dela, e a receita sairia inflada.
    const receitas = await db.$queryRaw<{ unidade_id: string; vendas: number; receita: string }[]>`
      select v.unidade_id, count(*)::int as vendas, sum(v.total) as receita
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de} and v.criada_em < ${ate}
       group by 1
    `

    // `custo_unit` é a fotografia do custo NA HORA DA VENDA. Usar o custo de
    // hoje faria a margem de março mudar sozinha quando o fornecedor
    // reajustasse em setembro.
    const custos = await db.$queryRaw<{ unidade_id: string; custo: string }[]>`
      select v.unidade_id, sum(coalesce(i.custo_unit, 0) * i.quantidade) as custo
        from venda_itens i
        join vendas v on v.id = i.venda_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de} and v.criada_em < ${ate}
       group by 1
    `

    // Estoque total e estoque parado, na mesma passada. "Parado" aqui é
    // relativo À JANELA que a pessoa está olhando: escolheu 90 dias, parado
    // é o que não saiu em 90 dias. É o recorte que ela tem na cabeça.
    const estoques = await db.$queryRaw<{ unidade_id: string; estoque: string; parado: string }[]>`
      select e.unidade_id,
             sum(e.quantidade * coalesce(p.custo, 0)) as estoque,
             sum(case when x.vendeu is null then e.quantidade * coalesce(p.custo, 0) else 0 end) as parado
        from estoque e
        join variacoes vr on vr.id = e.variacao_id
        join produtos p on p.id = vr.produto_id
        left join lateral (
          select 1 as vendeu
            from venda_itens i
            join vendas v on v.id = i.venda_id
           where i.variacao_id = e.variacao_id
             and v.unidade_id = e.unidade_id
             and v.situacao = 'CONCLUIDA'
             and v.criada_em >= ${de} and v.criada_em < ${ate}
           limit 1
        ) x on true
       where e.unidade_id = any(${uni}) and e.quantidade > 0
       group by 1
    `

    const receitaDe = new Map(receitas.map((r) => [r.unidade_id, r]))
    const custoDe = new Map(custos.map((c) => [c.unidade_id, n(c.custo)]))
    const estoqueDe = new Map(estoques.map((e) => [e.unidade_id, e]))

    return lojas.map((l) => {
      const r = receitaDe.get(l.id)
      const receita = n(r?.receita)
      const custo = custoDe.get(l.id) ?? 0
      const vendas = r?.vendas ?? 0
      const est = estoqueDe.get(l.id)
      return {
        unidadeId: l.id,
        nome: l.nome,
        vendas,
        receita,
        custo,
        margem: receita - custo,
        margemPct: receita > 0 ? ((receita - custo) / receita) * 100 : null,
        ticket: vendas > 0 ? receita / vendas : 0,
        parado: n(est?.parado),
        estoque: n(est?.estoque),
      }
    })
  })
}

// ── 2. curva ABC ─────────────────────────────────────────────

export type LinhaAbc = {
  produtoId: string
  nome: string
  marca: string
  /** 'UN', 'KG'… — "saiu 1,8" só quer dizer algo com a medida junto. */
  medida: string
  quantidade: number
  receita: number
  margem: number
  /** Fatia da receita do período, em porcento. */
  fatiaPct: number
  /** Fatia acumulada até esta linha, em porcento. */
  acumuladoPct: number
  classe: 'A' | 'B' | 'C'
}

/**
 * Os dois cortes clássicos: A até 80% do faturamento, B até 95%, C o resto.
 *
 * Não são número mágico — são o ponto onde a lista deixa de responder. O A é
 * a lista que o dono precisa saber de cor e nunca deixar faltar. O C é a
 * cauda: cada item sozinho não paga o espaço que ocupa na prateleira.
 */
const CORTE_A = 80
const CORTE_B = 95

/**
 * Classifica uma lista JÁ ORDENADA da maior receita para a menor.
 *
 * Pura de propósito: é a única conta da curva que pode sair errada de um
 * jeito que ninguém nota — uma classe trocada não parece defeito, parece
 * opinião. Testada em `tests/relatorios.test.ts`.
 */
export function classificarAbc<T extends { receita: number }>(
  itens: T[],
): (T & { fatiaPct: number; acumuladoPct: number; classe: 'A' | 'B' | 'C' })[] {
  const total = itens.reduce((s, i) => s + i.receita, 0)
  let acumulado = 0
  return itens.map((i) => {
    const fatiaPct = total > 0 ? (i.receita / total) * 100 : 0
    // O corte olha o acumulado ANTES desta linha, não depois.
    //
    // A diferença aparece no caso que mais importa: a loja onde um produto
    // sozinho é 90% do faturamento. Olhando o acumulado DEPOIS, esse produto
    // fecha em 90%, passa dos 80 e cai em B — a classe A ficaria vazia na
    // loja inteira, e a lista diria que o carro-chefe é secundário. Olhando
    // ANTES, ele entra em A, porque é ele que forma os 80%.
    const antes = acumulado
    acumulado += fatiaPct
    return {
      ...i,
      fatiaPct,
      acumuladoPct: acumulado,
      classe: (antes < CORTE_A ? 'A' : antes < CORTE_B ? 'B' : 'C') as 'A' | 'B' | 'C',
    }
  })
}

export async function curvaAbc(
  sessao: Sessao,
  unidadeIds: string[],
  de: Date,
  ate: Date,
): Promise<LinhaAbc[]> {
  exigir(sessao, 'relatorio.ver')
  // A lista de lojas vem de quem chama (e quem chama leu do endereço).
  unidadeIds = soAsQuePode(sessao, 'relatorio.ver', unidadeIds)
  if (unidadeIds.length === 0) return []

  return comoOrg(sessao.orgId, async (db) => {
    const uni = unidadeIds

    // Agrupa por PRODUTO, não por variação: "Camiseta canelada" é uma decisão
    // de compra, e "Camiseta canelada Azul M" é uma linha de grade. Quem olha
    // curva ABC está decidindo o que comprar, não o que repor.
    //
    // Item avulso (variacao_id nulo) fica de fora de propósito: ele não tem
    // produto, não se recompra, e entraria na lista como um nome digitado uma
    // vez só.
    const linhas = await db.$queryRaw<
      { produto_id: string; nome: string; marca: string | null; medida: string; quantidade: string; receita: string; custo: string }[]
    >`
      select p.id as produto_id, p.nome, p.marca, p.medida::text as medida,
             sum(i.quantidade) as quantidade,
             sum(i.total) as receita,
             sum(coalesce(i.custo_unit, 0) * i.quantidade) as custo
        from venda_itens i
        join vendas v on v.id = i.venda_id
        join variacoes vr on vr.id = i.variacao_id
        join produtos p on p.id = vr.produto_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de} and v.criada_em < ${ate}
       group by 1, 2, 3, 4
       order by receita desc
    `

    return classificarAbc(
      linhas.map((l) => ({
        produtoId: l.produto_id,
        nome: l.nome,
        marca: l.marca ?? '',
        medida: l.medida,
        quantidade: n(l.quantidade),
        receita: n(l.receita),
        margem: n(l.receita) - n(l.custo),
      })),
    )
  })
}

// ── 3. dinheiro parado ───────────────────────────────────────

export type ParadoNaPrateleira = {
  produtoId: string
  nome: string
  marca: string
  /** A medida do produto: "tem 12" é peça, "tem 4,5" é quilo. */
  medida: string
  quantidade: number
  /** O que a loja pagou pelo que está parado. */
  valor: number
  /** Dias desde a última venda. Nulo = nunca vendeu. */
  diasParado: number | null
}

/**
 * Quantos dias sem sair para uma peça contar como parada.
 *
 * Trinta, que é o mesmo número que o painel já usa. Vale repetir por quê: é
 * um mês de aluguel. O que não girou em um ciclo de aluguel não pagou o
 * espaço que ocupou — e essa é a conta que a lista está fazendo.
 */
export const PARADO_DIAS = 30

export async function dinheiroParado(
  sessao: Sessao,
  unidadeIds: string[],
): Promise<ParadoNaPrateleira[]> {
  exigir(sessao, 'relatorio.ver')
  // A lista de lojas vem de quem chama (e quem chama leu do endereço).
  unidadeIds = soAsQuePode(sessao, 'relatorio.ver', unidadeIds)
  if (unidadeIds.length === 0) return []

  const corte = new Date(Date.now() - PARADO_DIAS * 86400000)

  return comoOrg(sessao.orgId, async (db) => {
    const uni = unidadeIds

    // Aqui a janela do filtro NÃO entra, e é de propósito: "está parado há
    // quanto tempo" é uma pergunta sobre o produto, não sobre o recorte que a
    // pessoa escolheu para ler. Olhando 7 dias, a loja inteira pareceria
    // parada — e o número perderia o sentido que ele tem.
    const linhas = await db.$queryRaw<
      { produto_id: string; nome: string; marca: string | null; medida: string; quantidade: string; valor: string; ultima: Date | null }[]
    >`
      select p.id as produto_id, p.nome, p.marca, p.medida::text as medida,
             sum(e.quantidade) as quantidade,
             sum(e.quantidade * coalesce(p.custo, 0)) as valor,
             max(x.ultima) as ultima
        from estoque e
        join variacoes vr on vr.id = e.variacao_id
        join produtos p on p.id = vr.produto_id
        left join lateral (
          select max(v.criada_em) as ultima
            from venda_itens i
            join vendas v on v.id = i.venda_id
           where i.variacao_id = e.variacao_id
             and v.unidade_id = any(${uni})
             and v.situacao = 'CONCLUIDA'
        ) x on true
       where e.unidade_id = any(${uni}) and e.quantidade > 0
       group by 1, 2, 3, 4
      having max(x.ultima) is null or max(x.ultima) < ${corte}
       order by valor desc
    `

    const agora = Date.now()
    return linhas.map((l) => ({
      produtoId: l.produto_id,
      nome: l.nome,
      marca: l.marca ?? '',
      medida: l.medida,
      quantidade: n(l.quantidade),
      valor: n(l.valor),
      diasParado: l.ultima ? Math.floor((agora - new Date(l.ultima).getTime()) / 86400000) : null,
    }))
  })
}

// ── 4. escala e presença ─────────────────────────────────────

export type TurnoNaEscala = {
  caixaId: string
  unidade: string
  quem: string
  abriu: Date
  fechou: Date | null
  /** Horas que o caixa ficou aberto. Nulo enquanto não fecha. */
  horas: number | null
  vendas: number
  total: number
  /** Contado menos esperado. Nulo enquanto não fecha. */
  diferenca: number | null
}

export async function escala(
  sessao: Sessao,
  unidadeIds: string[],
  de: Date,
  ate: Date,
): Promise<TurnoNaEscala[]> {
  exigir(sessao, 'relatorio.ver')
  exigir(sessao, 'caixa.ver')
  // Os turnos são do CAIXA de cada loja: entra só a loja em que a pessoa vê
  // o caixa, não toda loja em que ela lê relatório.
  const permitidas = soAsQuePode(sessao, 'caixa.ver', unidadeIds)
  if (permitidas.length === 0) return []

  return comoOrg(sessao.orgId, async (db) => {
    const uni = permitidas

    // A venda liga no caixa por `caixa_id`, então o total do turno é o que
    // saiu NAQUELE turno — não o que saiu no dia. É a diferença entre
    // "a loja vendeu bem terça" e "a Ana vendeu bem no turno da tarde".
    const linhas = await db.$queryRaw<
      {
        id: string
        unidade: string
        aberto_por: string
        aberto_em: Date
        fechado_em: Date | null
        saldo_esperado: string | null
        saldo_contado: string | null
        vendas: number
        total: string
      }[]
    >`
      select c.id, u.nome as unidade, c.aberto_por, c.aberto_em, c.fechado_em,
             c.saldo_esperado, c.saldo_contado,
             coalesce(t.vendas, 0)::int as vendas,
             coalesce(t.total, 0) as total
        from caixas c
        join unidades u on u.id = c.unidade_id
        left join lateral (
          select count(*)::int as vendas, sum(v.total) as total
            from vendas v
           where v.caixa_id = c.id and v.situacao = 'CONCLUIDA'
        ) t on true
       where c.unidade_id = any(${uni})
         and c.aberto_em >= ${de} and c.aberto_em < ${ate}
       order by c.aberto_em desc
    `

    return linhas.map((l) => ({
      caixaId: l.id,
      unidade: l.unidade,
      quem: l.aberto_por,
      abriu: l.aberto_em,
      fechou: l.fechado_em,
      horas: l.fechado_em
        ? (new Date(l.fechado_em).getTime() - new Date(l.aberto_em).getTime()) / 3600000
        : null,
      vendas: l.vendas,
      total: n(l.total),
      diferenca:
        l.fechado_em && l.saldo_contado !== null && l.saldo_esperado !== null
          ? n(l.saldo_contado) - n(l.saldo_esperado)
          : null,
    }))
  })
}
