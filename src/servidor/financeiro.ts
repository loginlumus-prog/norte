// O dinheiro que não é venda de balcão, e o DRE.
//
// ── a regra que evita contar duas vezes ──────────────────────
// Receita de VENDA não vira lançamento. Ela já mora em `vendas`, e o DRE puxa
// de lá. Se a venda também virasse lançamento, o mês fecharia com o dobro do
// faturamento — e ninguém percebe isso olhando a tela, só no fim do ano
// quando o contador não bate.
//
// ── por que o DRE tem grupo e não só categoria ───────────────
// O nome da categoria é da empresa: "aluguel da loja 2", "luz do depósito".
// O grupo é da contabilidade: OCUPACAO. É o grupo que decide a linha do
// relatório, então o dono pode criar quantas categorias quiser sem quebrar o
// formato que o contador espera.

import { comoOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import type { GrupoDRE, TipoLancamento } from '@prisma/client'

/* ── categorias que toda empresa começa tendo ─────────────── */

export const CATEGORIAS_PADRAO: {
  nome: string
  tipo: TipoLancamento
  grupo: GrupoDRE
}[] = [
  { nome: 'Compra de mercadoria', tipo: 'DESPESA', grupo: 'MERCADORIA' },
  { nome: 'Salários e encargos', tipo: 'DESPESA', grupo: 'PESSOAL' },
  { nome: 'Pró-labore', tipo: 'DESPESA', grupo: 'PESSOAL' },
  { nome: 'Comissão', tipo: 'DESPESA', grupo: 'PESSOAL' },
  { nome: 'Aluguel', tipo: 'DESPESA', grupo: 'OCUPACAO' },
  { nome: 'Condomínio e IPTU', tipo: 'DESPESA', grupo: 'OCUPACAO' },
  { nome: 'Luz, água e internet', tipo: 'DESPESA', grupo: 'OCUPACAO' },
  { nome: 'Anúncio e divulgação', tipo: 'DESPESA', grupo: 'COMERCIAL' },
  { nome: 'Embalagem e sacola', tipo: 'DESPESA', grupo: 'COMERCIAL' },
  { nome: 'Entrega e frete', tipo: 'DESPESA', grupo: 'COMERCIAL' },
  { nome: 'Contabilidade', tipo: 'DESPESA', grupo: 'ADMINISTRATIVA' },
  { nome: 'Sistema e software', tipo: 'DESPESA', grupo: 'ADMINISTRATIVA' },
  { nome: 'Material de escritório', tipo: 'DESPESA', grupo: 'ADMINISTRATIVA' },
  { nome: 'Taxa de maquininha', tipo: 'DESPESA', grupo: 'FINANCEIRA' },
  { nome: 'Juros e tarifas', tipo: 'DESPESA', grupo: 'FINANCEIRA' },
  { nome: 'Impostos sobre venda', tipo: 'DESPESA', grupo: 'IMPOSTO' },
  { nome: 'Outras despesas', tipo: 'DESPESA', grupo: 'OUTRA' },
  { nome: 'Outras receitas', tipo: 'RECEITA', grupo: 'RECEITA_OUTRA' },
]

/** Cria as categorias e contas que toda empresa precisa para começar. */
export async function prepararFinanceiro(sessao: Sessao) {
  exigir(sessao, 'financeiro.lancar')

  return comoOrg(sessao.orgId, async (db) => {
    if ((await db.categoriaFinanceira.count()) > 0) return false

    await db.categoriaFinanceira.createMany({
      data: CATEGORIAS_PADRAO.map((c, i) => ({ orgId: sessao.orgId, ...c, ordem: i })),
    })
    await db.contaFinanceira.createMany({
      data: [
        { orgId: sessao.orgId, nome: 'Caixa da loja', tipo: 'CAIXA' as const },
        { orgId: sessao.orgId, nome: 'Conta do banco', tipo: 'BANCO' as const },
      ],
    })
    return true
  })
}

/* ── lançar ───────────────────────────────────────────────── */

export type NovoLancamento = {
  categoriaId: string
  contaId?: string | null
  unidadeId?: string | null
  tipo: TipoLancamento
  descricao: string
  valor: number
  vencimento: Date
  /** Já pago? Passa a data. Fica nulo para "a pagar". */
  pagoEm?: Date | null
  fornecedor?: string
  documento?: string
  observacoes?: string
}

export async function lancar(sessao: Sessao, l: NovoLancamento) {
  exigir(sessao, 'financeiro.lancar', l.unidadeId ?? undefined)
  if (l.valor <= 0) throw new Error('O valor precisa ser maior que zero.')
  if (!l.descricao.trim()) throw new Error('Todo lançamento precisa de descrição.')

  return comoOrg(sessao.orgId, async (db) => {
    const criado = await db.lancamento.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: l.unidadeId ?? null,
        categoriaId: l.categoriaId,
        contaId: l.contaId ?? null,
        tipo: l.tipo,
        descricao: l.descricao.trim(),
        valor: reais(centavos(l.valor)),
        vencimento: l.vencimento,
        pagoEm: l.pagoEm ?? null,
        fornecedor: l.fornecedor?.trim() || null,
        documento: l.documento?.trim() || null,
        observacoes: l.observacoes?.trim() || null,
        quem: sessao.nome,
      },
      select: { id: true },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: l.unidadeId ?? null,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: l.tipo === 'DESPESA' ? 'financeiro.despesa' : 'financeiro.receita',
        alvoTipo: 'lancamento',
        alvoId: criado.id,
        alvoNome: l.descricao,
        valor: l.valor,
      },
    })
    return criado.id
  })
}

/** Marca como pago (ou desmarca, se a pessoa se enganou). */
export async function marcarPago(sessao: Sessao, id: string, pagoEm: Date | null) {
  exigir(sessao, 'financeiro.lancar')

  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.lancamento.findUnique({
      where: { id },
      select: { descricao: true, valor: true, pagoEm: true, unidadeId: true },
    })
    if (!antes) return

    await db.lancamento.update({ where: { id }, data: { pagoEm } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: antes.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: pagoEm ? 'financeiro.pagou' : 'financeiro.despagou',
        alvoTipo: 'lancamento',
        alvoId: id,
        alvoNome: antes.descricao,
        valor: Number(antes.valor),
        antes: { pagoEm: antes.pagoEm },
        depois: { pagoEm },
      },
    })
  })
}

/* ── contas a vencer ──────────────────────────────────────── */

export type AVencer = {
  vencidas: { id: string; descricao: string; valor: number; vencimento: Date; dias: number }[]
  hoje: { id: string; descricao: string; valor: number; vencimento: Date }[]
  proximas: { id: string; descricao: string; valor: number; vencimento: Date; dias: number }[]
  totalVencido: number
  totalProximos: number
}

/**
 * O que vence, separado por urgência.
 *
 * Vencida vem primeiro e com quantos dias de atraso, porque é o único grupo
 * que já custou dinheiro — juro e multa correm enquanto a lista não é olhada.
 */
export async function aVencer(sessao: Sessao, unidadeIds: string[], dias = 15): Promise<AVencer> {
  exigir(sessao, 'financeiro.ver')

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const limite = new Date(hoje.getTime() + dias * 864e5)

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.lancamento.findMany({
      where: {
        tipo: 'DESPESA',
        pagoEm: null,
        vencimento: { lte: limite },
        OR: [{ unidadeId: { in: unidadeIds } }, { unidadeId: null }],
      },
      orderBy: { vencimento: 'asc' },
      select: { id: true, descricao: true, valor: true, vencimento: true },
    })

    const diasEntre = (d: Date) => Math.round((hoje.getTime() - d.getTime()) / 864e5)

    const vencidas = linhas
      .filter((l) => l.vencimento < hoje)
      .map((l) => ({ ...l, valor: Number(l.valor), dias: diasEntre(l.vencimento) }))
    const doDia = linhas
      .filter((l) => l.vencimento.getTime() === hoje.getTime())
      .map((l) => ({ ...l, valor: Number(l.valor) }))
    const proximas = linhas
      .filter((l) => l.vencimento > hoje)
      .map((l) => ({ ...l, valor: Number(l.valor), dias: -diasEntre(l.vencimento) }))

    return {
      vencidas,
      hoje: doDia,
      proximas,
      totalVencido: vencidas.reduce((s, l) => s + l.valor, 0),
      totalProximos: doDia.concat(proximas as never[]).reduce((s, l) => s + l.valor, 0),
    }
  })
}

/* ── DRE ──────────────────────────────────────────────────── */

export type LinhaDRE = {
  chave: string
  rotulo: string
  valor: number
  /** Linha de soma, em negrito. */
  total?: boolean
  /** Detalhe por categoria, para abrir. */
  itens?: { nome: string; valor: number }[]
  /** Informativa: saiu dinheiro, mas não entra na conta do resultado. */
  fora?: boolean
}

export type DRE = {
  de: Date
  ate: Date
  linhas: LinhaDRE[]
  resultado: number
  margem: number
}

const ROTULO: Record<GrupoDRE, string> = {
  RECEITA_OUTRA: 'Outras receitas',
  IMPOSTO: 'Impostos sobre venda',
  MERCADORIA: 'Compra de mercadoria',
  PESSOAL: 'Pessoal',
  OCUPACAO: 'Ocupação',
  COMERCIAL: 'Comercial',
  ADMINISTRATIVA: 'Administrativas',
  FINANCEIRA: 'Financeiras',
  OUTRA: 'Outras despesas',
}

/**
 * O DRE do período, no formato que a contabilidade usa.
 *
 * A receita vem de `vendas` e o custo da mercadoria vendida vem do custo
 * gravado em cada item no momento da venda — não do custo de hoje. Se puxasse
 * o custo atual, mudar o preço de compra reescreveria a margem de meses
 * fechados.
 */
export async function montarDRE(
  sessao: Sessao,
  unidadeIds: string[],
  de: Date,
  ate: Date,
): Promise<DRE> {
  exigir(sessao, 'financeiro.ver')

  return comoOrg(sessao.orgId, async (db) => {
    const [venda, cmv, grupos] = await Promise.all([
      db.venda.aggregate({
        where: { unidadeId: { in: unidadeIds }, situacao: 'CONCLUIDA', criadaEm: { gte: de, lte: ate } },
        _sum: { total: true },
      }),
      db.$queryRaw<{ custo: string }[]>`
        select coalesce(sum(i.quantidade * coalesce(i.custo_unit, 0)), 0) as custo
          from venda_itens i join vendas v on v.id = i.venda_id
         where v.unidade_id = any(${unidadeIds}) and v.situacao = 'CONCLUIDA'
           and v.criada_em >= ${de} and v.criada_em <= ${ate}
      `,
      // Regime de CAIXA: conta o que foi pago no período, não o que venceu.
      // É como o comércio pequeno enxerga o mês, e é o que bate com o extrato.
      db.$queryRaw<{ grupo: GrupoDRE; nome: string; total: string }[]>`
        select c.grupo, c.nome, sum(l.valor) as total
          from lancamentos l join categorias_financeiras c on c.id = l.categoria_id
         where l.pago_em is not null
           and l.pago_em >= ${de} and l.pago_em <= ${ate}
           and (l.unidade_id = any(${unidadeIds}) or l.unidade_id is null)
         group by c.grupo, c.nome
         order by 3 desc
      `,
    ])

    const porGrupo = (g: GrupoDRE) => {
      const itens = grupos.filter((x) => x.grupo === g)
      return {
        valor: itens.reduce((s, x) => s + centavos(x.total), 0),
        itens: itens.map((x) => ({ nome: x.nome, valor: Number(x.total) })),
      }
    }

    const receitaVendaC = centavos(venda._sum.total ?? 0)
    const outrasReceitas = porGrupo('RECEITA_OUTRA')
    const imposto = porGrupo('IMPOSTO')
    const cmvC = centavos(cmv[0]?.custo ?? 0)

    const receitaBrutaC = receitaVendaC + outrasReceitas.valor
    const receitaLiquidaC = receitaBrutaC - imposto.valor
    const lucroBrutoC = receitaLiquidaC - cmvC

    const operacionais = (['PESSOAL', 'OCUPACAO', 'COMERCIAL', 'ADMINISTRATIVA', 'OUTRA'] as const).map(
      (g) => ({ g, ...porGrupo(g) }),
    )
    const totalOperacionalC = operacionais.reduce((s, o) => s + o.valor, 0)
    const operacionalC = lucroBrutoC - totalOperacionalC

    const financeira = porGrupo('FINANCEIRA')
    const resultadoC = operacionalC - financeira.valor

    // Compra de mercadoria NÃO é despesa do mês: ela vira custo quando a peça
    // é vendida, e isso já está no CMV. Mas ela também não pode simplesmente
    // sumir do relatório — quem pagou R$ 5.400 ao fornecedor procura esse
    // número, e não achar faz o dono desconfiar do sistema inteiro. Então ela
    // aparece como informação, fora da conta.
    const compra = porGrupo('MERCADORIA')

    const linhas: LinhaDRE[] = [
      { chave: 'venda', rotulo: 'Venda de mercadoria', valor: reais(receitaVendaC) },
      ...(outrasReceitas.valor > 0
        ? [{ chave: 'outras', rotulo: 'Outras receitas', valor: reais(outrasReceitas.valor), itens: outrasReceitas.itens }]
        : []),
      { chave: 'bruta', rotulo: 'Receita bruta', valor: reais(receitaBrutaC), total: true },
      { chave: 'imposto', rotulo: `(−) ${ROTULO.IMPOSTO}`, valor: -reais(imposto.valor), itens: imposto.itens },
      { chave: 'liquida', rotulo: 'Receita líquida', valor: reais(receitaLiquidaC), total: true },
      { chave: 'cmv', rotulo: '(−) Custo da mercadoria vendida', valor: -reais(cmvC) },
      { chave: 'lucroBruto', rotulo: 'Lucro bruto', valor: reais(lucroBrutoC), total: true },
      ...operacionais
        .filter((o) => o.valor > 0)
        .map((o) => ({
          chave: o.g,
          rotulo: `(−) ${ROTULO[o.g]}`,
          valor: -reais(o.valor),
          itens: o.itens,
        })),
      { chave: 'operacional', rotulo: 'Resultado operacional', valor: reais(operacionalC), total: true },
      ...(financeira.valor > 0
        ? [{ chave: 'fin', rotulo: `(−) ${ROTULO.FINANCEIRA}`, valor: -reais(financeira.valor), itens: financeira.itens }]
        : []),
      { chave: 'resultado', rotulo: 'Resultado do período', valor: reais(resultadoC), total: true },
      ...(compra.valor > 0
        ? [{
            chave: 'compra',
            rotulo: 'Compra de mercadoria (fora do resultado)',
            valor: reais(compra.valor),
            itens: compra.itens,
            fora: true,
          }]
        : []),
    ]

    return {
      de,
      ate,
      linhas,
      resultado: reais(resultadoC),
      margem: receitaBrutaC > 0 ? (resultadoC / receitaBrutaC) * 100 : 0,
    }
  })
}

/* ── os lançamentos, listados ─────────────────────────────── */

export type FiltroLancamentos = {
  unidadeIds: string[]
  /** Mês (1-12) e ano do vencimento. */
  ano: number
  mes: number
  tipo?: TipoLancamento | null
  categoriaId?: string | null
  /** 'aberto' = ainda não pago; 'pago' = já pago. */
  situacao?: 'aberto' | 'pago' | null
  q?: string | null
}

export type LancamentoNaLista = {
  id: string
  tipo: TipoLancamento
  descricao: string
  valor: number
  vencimento: Date
  pagoEm: Date | null
  categoria: string
  fornecedor: string | null
  documento: string | null
  quem: string
}

/**
 * Tudo que foi lançado no mês, para ver e corrigir.
 *
 * O financeiro tinha o que VENCE e o DRE, e não tinha a lista do que foi
 * lançado — o dono que quer saber "quanto eu paguei de fornecedor em agosto"
 * ou "esse lançamento de R$ 1.200 é o quê?" não tinha onde olhar. O DRE
 * agrega; esta lista é a prova dele.
 *
 * Filtra por VENCIMENTO, e não por data de criação: é a coluna que o dono usa
 * para pensar ("as contas de setembro"), e é a mesma régua do DRE.
 */
export async function listarLancamentos(
  sessao: Sessao,
  f: FiltroLancamentos,
): Promise<LancamentoNaLista[]> {
  exigir(sessao, 'financeiro.ver')

  const de = new Date(f.ano, f.mes - 1, 1)
  const ate = new Date(f.ano, f.mes, 1)
  const q = f.q?.trim() ?? ''

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.lancamento.findMany({
      where: {
        // Lançamento sem unidade é da empresa inteira (aluguel do escritório,
        // contador) e aparece em qualquer loja escolhida.
        OR: [{ unidadeId: { in: f.unidadeIds } }, { unidadeId: null }],
        vencimento: { gte: de, lt: ate },
        ...(f.tipo ? { tipo: f.tipo } : {}),
        ...(f.categoriaId ? { categoriaId: f.categoriaId } : {}),
        ...(f.situacao === 'aberto' ? { pagoEm: null } : f.situacao === 'pago' ? { pagoEm: { not: null } } : {}),
        ...(q
          ? {
              OR: [
                { descricao: { contains: q, mode: 'insensitive' } },
                { fornecedor: { contains: q, mode: 'insensitive' } },
                { documento: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ vencimento: 'asc' }, { criadoEm: 'asc' }],
      take: 500,
      select: {
        id: true, tipo: true, descricao: true, valor: true, vencimento: true, pagoEm: true,
        fornecedor: true, documento: true, quem: true,
        categoria: { select: { nome: true } },
      },
    })
    return linhas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      descricao: l.descricao,
      valor: Number(l.valor),
      vencimento: l.vencimento,
      pagoEm: l.pagoEm,
      categoria: l.categoria.nome,
      fornecedor: l.fornecedor,
      documento: l.documento,
      quem: l.quem,
    }))
  })
}
