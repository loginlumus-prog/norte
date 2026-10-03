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

import { comoOrg, type BancoDaOrg } from './banco'
import {
  exigir, exigirNoAlcance, pode, podeNoAlcance, soAsQuePode, textoDaBusca, type Capacidade, type Sessao,
} from './permissao'
import { colunaDoDia, diaDaColuna, diaEmSP, inicioDoDiaEmSP } from './dia'
import { centavos, reais } from './dinheiro'
import { taxasDoPeriodo } from './taxas'
import { receitaPorLoja, somarReceita } from './receita'
import { hojeNaLoja, situacaoDoVencimento } from './recorrentes'
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

/**
 * O teto de um lançamento: R$ 10 milhões. Ninguém no varejo pequeno paga uma
 * conta desse tamanho, e um zero a mais digitado — ou um número mandado
 * direto para a ação — virava um DRE de R$ 1 bilhão negativo que só se
 * desfazia apagando a linha no banco.
 */
export const TETO_LANCAMENTO = 10_000_000

/** Quantos anos para trás uma baixa pode ir. Mais que isso é dedo errado (o ano "1926"). */
export const ANOS_DE_BAIXA = 5

/** Os tetos dos textos: cabem na tela, no livro e na planilha. */
const TEXTO_MAX = { descricao: 200, fornecedor: 120, documento: 60, observacoes: 1000 } as const

/**
 * O dia de pagamento cabe? Nem depois de hoje (é agendamento, não
 * pagamento) nem mais de `ANOS_DE_BAIXA` anos para trás. Devolve o erro, ou
 * nulo. `pagoEm` é o dia numa coluna `date`.
 */
function erroDoDiaPago(pagoEm: Date, agora: Date): string | null {
  if (Number.isNaN(pagoEm.getTime())) return 'A data do pagamento não é uma data.'
  const dia = diaDaColuna(pagoEm)
  const hoje = diaEmSP(agora)
  if (dia > hoje) return 'A data do pagamento não pode ser depois de hoje.'
  const limite = `${Number(hoje.slice(0, 4)) - ANOS_DE_BAIXA}${hoje.slice(4)}`
  if (dia < limite) return `A data do pagamento está mais de ${ANOS_DE_BAIXA} anos para trás. Confira o ano.`
  return null
}

export async function lancar(sessao: Sessao, l: NovoLancamento, agora = new Date()) {
  // Sem loja é da empresa inteira, e isso só lança quem alcança a empresa
  // inteira — ver `exigirNoAlcance`.
  exigirNoAlcance(sessao, 'financeiro.lancar', l.unidadeId || null)
  if (!Number.isFinite(l.valor) || l.valor <= 0) throw new Error('O valor precisa ser maior que zero.')
  if (l.valor > TETO_LANCAMENTO) throw new Error('Valor alto demais para um lançamento: confira os zeros.')
  if (!l.descricao.trim()) throw new Error('Todo lançamento precisa de descrição.')
  if (l.tipo !== 'DESPESA' && l.tipo !== 'RECEITA') throw new Error('Escolha se é despesa ou receita.')
  if (Number.isNaN(l.vencimento.getTime())) throw new Error('A data de vencimento não é uma data.')
  if (l.pagoEm) {
    const erro = erroDoDiaPago(l.pagoEm, agora)
    if (erro) throw new Error(erro)
  }

  return comoOrg(sessao.orgId, async (db) => {
    // Categoria, conta e loja vêm do formulário, e o formulário é do
    // navegador. Procurar cada uma AQUI passa pelo RLS: id de outra empresa
    // simplesmente não aparece. Sem isto o lançamento nascia apontando para a
    // categoria de outra empresa — a chave estrangeira do banco não olha o
    // RLS — e o DRE desta tela quebrava ao tentar ler o nome dela.
    const categoria = await db.categoriaFinanceira.findUnique({
      where: { id: l.categoriaId },
      select: { id: true, tipo: true },
    })
    if (!categoria) throw new Error('Categoria não encontrada.')
    // O DRE soma pelo GRUPO da categoria: despesa lançada numa categoria de
    // receita entraria no resultado como dinheiro que chegou.
    if (categoria.tipo !== l.tipo) {
      throw new Error(l.tipo === 'DESPESA' ? 'Essa categoria é de receita.' : 'Essa categoria é de despesa.')
    }
    if (l.contaId) {
      const conta = await db.contaFinanceira.findUnique({ where: { id: l.contaId }, select: { id: true } })
      if (!conta) throw new Error('Conta não encontrada.')
    }
    if (l.unidadeId) {
      const loja = await db.unidade.findUnique({ where: { id: l.unidadeId }, select: { id: true } })
      if (!loja) throw new Error('Loja não encontrada.')
    }

    const criado = await db.lancamento.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: l.unidadeId || null,
        categoriaId: l.categoriaId,
        contaId: l.contaId ?? null,
        tipo: l.tipo,
        descricao: l.descricao.trim().slice(0, TEXTO_MAX.descricao),
        valor: reais(centavos(l.valor)),
        vencimento: l.vencimento,
        pagoEm: l.pagoEm ?? null,
        fornecedor: l.fornecedor?.trim().slice(0, TEXTO_MAX.fornecedor) || null,
        documento: l.documento?.trim().slice(0, TEXTO_MAX.documento) || null,
        observacoes: l.observacoes?.trim().slice(0, TEXTO_MAX.observacoes) || null,
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
        alvoNome: l.descricao.trim().slice(0, TEXTO_MAX.descricao),
        valor: l.valor,
      },
    })
    return criado.id
  })
}

/**
 * O dia de hoje, pronto para gravar numa coluna `date` (`pagoEm`).
 *
 * `new Date()` NÃO serve: depois das 21h em São Paulo já é o dia seguinte em
 * UTC, e é o dia em UTC que a coluna guarda — a conta paga às 22h do dia 30
 * aparecia paga no dia 1º, e saía do DRE do mês em que foi paga.
 */
export const hojeParaColuna = (agora: Date = new Date()) => colunaDoDia(diaEmSP(agora))

/**
 * Marca como pago num dia (ou desfaz a baixa, com `null`).
 *
 * O dia é escolhido: a conta de luz paga no sábado e marcada na segunda tem
 * de entrar no dia em que o dinheiro saiu — é por ele que o DRE conta, e a
 * conta paga em 31/08 e marcada em 02/09 mudava de mês. E a baixa se desfaz:
 * sem isso, um toque na conta errada ficava para sempre.
 *
 * `pagoEm` é o dia numa coluna `date` (`colunaDoDia`). Dia depois de hoje
 * não é pagamento, é agendamento, e é recusado — e dia de mais de
 * `ANOS_DE_BAIXA` anos atrás também: a tela aceitava 1900, e a conta sumia
 * do mês em que foi paga para um DRE que ninguém abre.
 */
export async function marcarPago(sessao: Sessao, id: string, pagoEm: Date | null, agora = new Date()) {
  exigir(sessao, 'financeiro.lancar')
  if (pagoEm) {
    const erro = erroDoDiaPago(pagoEm, agora)
    if (erro) throw new Error(erro)
  }

  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.lancamento.findUnique({
      where: { id },
      select: { descricao: true, valor: true, pagoEm: true, unidadeId: true },
    })
    if (!antes) return
    // A LOJA do lançamento decide, e ela só se sabe depois de achar. Sem isto
    // o financeiro da loja 3 dava baixa na conta da loja 5 colando o id —
    // `exigir` sem loja passa para quem pode lançar em QUALQUER uma. E sem
    // loja é da empresa inteira: só quem alcança a empresa inteira dá baixa.
    exigirNoAlcance(sessao, 'financeiro.lancar', antes.unidadeId)

    // Clique duplo, ou duas abas: dar baixa no mesmo dia no que já está pago
    // (ou desfazer o que já está em aberto) não escreve outra linha no livro.
    const dia = (d: Date | null) => (d ? diaDaColuna(d) : null)
    if (dia(antes.pagoEm) === dia(pagoEm)) return

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
        antes: { pagoEm: dia(antes.pagoEm) },
        depois: { pagoEm: dia(pagoEm) },
      },
    })
  })
}

/* ── as contas da empresa inteira ─────────────────────────── */

/**
 * O que fazer, nesta leitura, com o lançamento SEM loja (o aluguel do
 * escritório, o contador — a conta da empresa inteira):
 *
 *   'dentro' — a leitura é a empresa: entra no resultado e nas listas;
 *   'fora'   — a leitura é uma loja (ou algumas): a conta da empresa não é
 *              dela. O DRE a mostra numa linha à parte, fora do resultado;
 *              as listas não a trazem;
 *   'oculta' — quem olha não alcança a empresa inteira: não aparece.
 *
 * Antes ela entrava em TODA loja escolhida: o aluguel do escritório saía no
 * resultado da loja A e de novo no da B, e A + B dava menos que a empresa. E
 * o financeiro preso à loja A lia (e somava) as contas da empresa inteira.
 *
 * "A empresa" é a leitura que pega todas as lojas que vendem e estão
 * abertas — depósito não conta: a empresa de uma loja e um depósito, olhando
 * a loja, está olhando a empresa.
 */
export type ContasDaEmpresa = 'dentro' | 'fora' | 'oculta'

export async function contasDaEmpresa(
  db: BancoDaOrg,
  sessao: Sessao,
  unidadeIds: readonly string[],
  capacidade: Capacidade = 'financeiro.ver',
): Promise<ContasDaEmpresa> {
  if (!podeNoAlcance(sessao, capacidade, null)) return 'oculta'
  const abertas = await db.unidade.findMany({ where: { ativa: true }, select: { id: true, ehDeposito: true } })
  const lojas = abertas.some((u) => !u.ehDeposito) ? abertas.filter((u) => !u.ehDeposito) : abertas
  return lojas.every((u) => unidadeIds.includes(u.id)) ? 'dentro' : 'fora'
}

/* ── contas a vencer ──────────────────────────────────────── */

export type AVencer = {
  vencidas: { id: string; descricao: string; valor: number; vencimento: Date; unidadeId: string | null; dias: number }[]
  hoje: { id: string; descricao: string; valor: number; vencimento: Date; unidadeId: string | null }[]
  proximas: { id: string; descricao: string; valor: number; vencimento: Date; unidadeId: string | null; dias: number }[]
  totalVencido: number
  totalProximos: number
}

/**
 * O que vence, separado por urgência.
 *
 * Vencida vem primeiro e com quantos dias de atraso, porque é o único grupo
 * que já custou dinheiro — juro e multa correm enquanto a lista não é olhada.
 */
export async function aVencer(sessao: Sessao, pedidas: string[], dias = 15, agora = new Date()): Promise<AVencer> {
  exigir(sessao, 'financeiro.ver')
  // A lista de lojas vem de quem chama, e quem chama pode ter vindo do
  // endereço. Só entram as que esta pessoa vê no financeiro.
  const unidadeIds = soAsQuePode(sessao, 'financeiro.ver', pedidas)

  // `vencimento` é coluna DATE, que o Prisma lê como meia-noite UTC. "Hoje"
  // tem de estar na mesma régua — meia-noite UTC do dia da LOJA —, senão a
  // conta que vence hoje (00:00 UTC) parecia anterior à meia-noite local
  // (03:00 UTC) e aparecia como "vencida há 0 dias", e o grupo "vence hoje"
  // nunca tinha nada. Apareceu quando as contas recorrentes passaram a nascer
  // com vencimento exato.
  const hojeK = hojeNaLoja(agora)
  const hoje = new Date(`${hojeK}T00:00:00.000Z`)
  const limite = new Date(hoje.getTime() + dias * 864e5)

  return comoOrg(sessao.orgId, async (db) => {
    // A conta sem loja só na leitura da empresa — ver `contasDaEmpresa`.
    const empresa = await contasDaEmpresa(db, sessao, unidadeIds)
    const linhas = await db.lancamento.findMany({
      where: {
        tipo: 'DESPESA',
        pagoEm: null,
        vencimento: { lte: limite },
        OR: [{ unidadeId: { in: unidadeIds } }, ...(empresa === 'dentro' ? [{ unidadeId: null }] : [])],
      },
      orderBy: { vencimento: 'asc' },
      select: { id: true, descricao: true, valor: true, vencimento: true, unidadeId: true },
    })

    const diasEntre = (d: Date) => Math.round((hoje.getTime() - d.getTime()) / 864e5)

    const vencidas = linhas
      .filter((l) => situacaoDoVencimento(l.vencimento, agora) === 'vencida')
      .map((l) => ({ ...l, valor: Number(l.valor), dias: diasEntre(l.vencimento) }))
    const doDia = linhas
      .filter((l) => situacaoDoVencimento(l.vencimento, agora) === 'hoje')
      .map((l) => ({ ...l, valor: Number(l.valor) }))
    const proximas = linhas
      .filter((l) => situacaoDoVencimento(l.vencimento, agora) === 'a vencer')
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
  /** O que voltou em devolução no período. Já descontado da receita. */
  devolucoes: number
  /** As taxas de cartão e Pix calculadas venda a venda. Zero quando a loja não escreveu taxa. */
  taxasCalculadas: number
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

/* ── o recebido, por forma e por maquininha ───────────────── */

export type RecebidoNaMaquininha = {
  unidadeId: string
  unidade: string
  /** O nome como no cadastro da loja. Nulo = pagamento sem maquininha marcada. */
  maquininha: string | null
  formas: { forma: string; total: number; vendas: number; taxa: number }[]
  total: number
  taxa: number
}

export type RecebidoNoPeriodo = {
  /** Dinheiro, Pix, débito, crédito, vale… — o total de cada forma, para a empresa inteira lida. */
  porForma: { forma: string; total: number; vendas: number }[]
  /** Pix, débito e crédito separados por loja e por maquininha. */
  maquininhas: RecebidoNaMaquininha[]
  total: number
}

/**
 * O que entrou nas vendas do período, por forma de pagamento e, nas formas que
 * passam por maquininha ou conta do Pix, por maquininha.
 *
 * Por LOJA e por nome: duas lojas com "Mercado Pago" são duas contas, e o
 * extrato de cada uma só bate com a sua. A taxa é a gravada em cada pagamento
 * (a do dia da venda), a mesma conta do DRE.
 */
export async function recebidoPorForma(
  sessao: Sessao,
  pedidas: string[],
  de: Date,
  ate: Date,
): Promise<RecebidoNoPeriodo> {
  exigir(sessao, 'financeiro.ver')
  const unidadeIds = soAsQuePode(sessao, 'financeiro.ver', pedidas)
  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.$queryRaw<
      { unidade_id: string; unidade: string; forma: string; maquininha: string | null; total: string; vendas: number; taxa: string }[]
    >`
      select v.unidade_id, u.nome as unidade, p.forma::text as forma, p.maquininha,
             sum(p.valor) as total, count(distinct v.id)::int as vendas,
             sum(p.valor * coalesce(p.taxa_pct, 0) / 100) as taxa
        from pagamentos p
        join vendas v on v.id = p.venda_id
        join unidades u on u.id = v.unidade_id
       where v.unidade_id = any(${unidadeIds}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de} and v.criada_em <= ${ate}
       group by 1, 2, 3, 4
    `
    const ORDEM = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'CREDIARIO', 'VALE', 'TRANSFERENCIA']
    const forma = new Map<string, { totalC: number; vendas: number }>()
    const maq = new Map<string, RecebidoNaMaquininha & { totalC: number; taxaC: number }>()
    for (const l of linhas) {
      const c = centavos(l.total)
      const f = forma.get(l.forma) ?? forma.set(l.forma, { totalC: 0, vendas: 0 }).get(l.forma)!
      f.totalC += c
      f.vendas += l.vendas
      if (!['PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA'].includes(l.forma)) continue
      const nome = l.maquininha?.trim() || null
      const chave = `${l.unidade_id}\u0000${nome ?? ''}`
      const g =
        maq.get(chave) ??
        maq
          .set(chave, { unidadeId: l.unidade_id, unidade: l.unidade, maquininha: nome, formas: [], total: 0, taxa: 0, totalC: 0, taxaC: 0 })
          .get(chave)!
      const t = centavos(l.taxa)
      g.formas.push({ forma: l.forma, total: reais(c), vendas: l.vendas, taxa: reais(t) })
      g.totalC += c
      g.taxaC += t
    }
    const pos = (f: string) => (ORDEM.indexOf(f) < 0 ? 99 : ORDEM.indexOf(f))
    const porForma = [...forma.entries()]
      .map(([f, x]) => ({ forma: f, total: reais(x.totalC), vendas: x.vendas }))
      .sort((a, b) => pos(a.forma) - pos(b.forma))
    const maquininhas = [...maq.values()]
      .map(({ totalC, taxaC, ...g }) => ({
        ...g,
        formas: g.formas.sort((a, b) => pos(a.forma) - pos(b.forma)),
        total: reais(totalC),
        taxa: reais(taxaC),
      }))
      .sort(
        (a, b) =>
          a.unidade.localeCompare(b.unidade, 'pt-BR') ||
          (a.maquininha === null ? 1 : b.maquininha === null ? -1 : a.maquininha.localeCompare(b.maquininha, 'pt-BR')),
      )
    return { porForma, maquininhas, total: reais(porForma.reduce((s, f) => s + centavos(f.total), 0)) }
  })
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
  pedidas: string[],
  de: Date,
  /** INCLUSIVO: o último instante do período. Para um mês, `janelaDoMes(mes).ate − 1 ms`. */
  ate: Date,
): Promise<DRE> {
  exigir(sessao, 'financeiro.ver')
  const unidadeIds = soAsQuePode(sessao, 'financeiro.ver', pedidas)
  return comoOrg(sessao.orgId, async (db) =>
    calcularDRE(db, unidadeIds, de, ate, await contasDaEmpresa(db, sessao, unidadeIds)),
  )
}

/**
 * A conta do DRE, dentro de uma transação que já existe. É a MESMA para a
 * tela do mês, o fechamento e o gráfico dos seis meses — o gráfico já teve a
 * conta dele, e mostrava um resultado diferente do quadro logo acima (deixava
 * de fora as outras receitas, o sinal de encomenda e o juro do crediário).
 */
async function calcularDRE(
  db: BancoDaOrg,
  unidadeIds: string[],
  de: Date,
  ate: Date,
  /** A conta sem loja, nesta leitura — ver `contasDaEmpresa`. */
  empresa: ContasDaEmpresa,
): Promise<DRE> {
  {
    // Venda, devolução e "troca sem a compra" na régua de `receita.ts` — a
    // mesma do painel e da análise. A janela de lá é exclusiva no fim.
    const receita = somarReceita((await receitaPorLoja(db, unidadeIds, de, new Date(ate.getTime() + 1))).values())
    const cmv = await db.$queryRaw<{ custo: string }[]>`
      select coalesce(sum(i.quantidade * coalesce(i.custo_unit, 0)), 0) as custo
        from venda_itens i join vendas v on v.id = i.venda_id
       where v.unidade_id = any(${unidadeIds}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de} and v.criada_em <= ${ate}
    `
    // O custo do que VOLTOU sai do CMV, pela data da devolução — a mesma em
    // que a receita dela sai. Sem isto a devolução tirava a receita e deixava
    // o custo: a peça que voltou para a arara contava como vendida a preço
    // zero, e o resultado do mês saía menor do que foi.
    const cmvDevolvido = await db.$queryRaw<{ custo: string }[]>`
      select coalesce(sum(di.quantidade * coalesce(vi.custo_unit, 0)), 0) as custo
        from devolucao_itens di
        join devolucoes d on d.id = di.devolucao_id
        join venda_itens vi on vi.id = di.venda_item_id
       where d.unidade_id = any(${unidadeIds})
         and d.criada_em >= ${de} and d.criada_em <= ${ate}
    `
    // Regime de CAIXA: conta o que foi pago no período, não o que venceu.
    // É como o comércio pequeno enxerga o mês, e é o que bate com o extrato.
    //
    // `pago_em` é coluna `date`: compara com o DIA em São Paulo, não com o
    // instante. Com o instante, o que foi pago no dia 1º caía fora do mês.
    //
    // A conta sem loja (da empresa inteira) só entra no resultado quando a
    // leitura É a empresa. Olhando uma loja, ela vem à parte, numa linha fora
    // do resultado — e nem isso para quem não alcança a empresa inteira.
    const grupos = await db.$queryRaw<{ grupo: GrupoDRE; nome: string; total: string }[]>`
      select c.grupo, c.nome, sum(l.valor) as total
        from lancamentos l join categorias_financeiras c on c.id = l.categoria_id
       where l.pago_em is not null
         and l.pago_em >= ${diaEmSP(de)}::date and l.pago_em <= ${diaEmSP(ate)}::date
         and (l.unidade_id = any(${unidadeIds}) or (${empresa === 'dentro'} and l.unidade_id is null))
       group by c.grupo, c.nome
       order by 3 desc
    `
    const daEmpresa =
      empresa === 'fora'
        ? await db.$queryRaw<{ grupo: GrupoDRE; tipo: string; nome: string; total: string }[]>`
            select c.grupo, c.tipo::text as tipo, c.nome, sum(l.valor) as total
              from lancamentos l join categorias_financeiras c on c.id = l.categoria_id
             where l.pago_em is not null and l.unidade_id is null and c.grupo <> 'MERCADORIA'
               and l.pago_em >= ${diaEmSP(de)}::date and l.pago_em <= ${diaEmSP(ate)}::date
             group by c.grupo, c.tipo, c.nome
             order by 4 desc
          `
        : []
    // O desconto dado ao receber o crediário é venda que não virou dinheiro:
    // a loja vendeu 100, aceitou 70 para fechar o acordo, e o resultado
    // seguia contando 100. Sai da receita, pela data do recebimento — a mesma
    // régua do juro logo abaixo. A baixa externa não tem desconto.
    const descontoCred = await db.$queryRaw<{ desconto: string }[]>`
      select coalesce(sum(r.desconto), 0) as desconto
        from recebimentos r join parcelas p on p.id = r.parcela_id
       where p.unidade_id = any(${unidadeIds})
         and not r.externo
         and r.criado_em >= ${de} and r.criado_em <= ${ate}
    `
    // Juro e multa de atraso do crediário são receita que não é venda. A
    // baixa externa ("já pagou fora") não entra: o dinheiro foi recebido —
    // e contado — no outro sistema.
    const jurosCred = await db.$queryRaw<{ juros: string }[]>`
      select coalesce(sum(r.juros + r.multa), 0) as juros
        from recebimentos r join parcelas p on p.id = r.parcela_id
       where p.unidade_id = any(${unidadeIds})
         and not r.externo
         and r.criado_em >= ${de} and r.criado_em <= ${ate}
    `
    // A mensalidade da escola (mensalidades.ts) é receita que não é venda de
    // balcão: o que ABATEU a mensalidade vai na linha "Mensalidades", e o juro
    // e a multa de atraso vão em "Outras receitas", como o juro do crediário.
    // Pela data em que o dinheiro entrou — regime de caixa, o mesmo do resto.
    // O desconto de pontualidade (`abono`) não é dinheiro e não entra.
    const mens = await db.$queryRaw<{ total: string; atraso: string }[]>`
      select coalesce(sum(p.valor - p.juros - p.multa), 0) as total,
             coalesce(sum(p.juros + p.multa), 0) as atraso
        from pagamentos_mensalidade p
       where p.unidade_id = any(${unidadeIds})
         and p.criado_em >= ${de} and p.criado_em <= ${ate}
    `
    const taxas = await taxasDoPeriodo(db, unidadeIds, de, ate)

    const porGrupo = (g: GrupoDRE) => {
      const itens = grupos.filter((x) => x.grupo === g)
      return {
        valor: itens.reduce((s, x) => s + centavos(x.total), 0),
        itens: itens.map((x) => ({ nome: x.nome, valor: Number(x.total) })),
      }
    }

    const vendaBrutaC = receita.brutoCent
    // O que voltou em devolução sai da receita: a peça devolvida não foi
    // vendida, mesmo que a venda continue registrada.
    const devolC = receita.devolvidoCent
    const semCompraC = receita.semCompraCent
    const descontoCredC = centavos(descontoCred[0]?.desconto ?? 0)
    const mensalidadesC = centavos(mens[0]?.total ?? 0)
    const receitaVendaC = vendaBrutaC - devolC - semCompraC - descontoCredC + mensalidadesC

    const outrasReceitas = porGrupo('RECEITA_OUTRA')
    const jurosC = centavos(jurosCred[0]?.juros ?? 0)
    if (jurosC > 0) {
      outrasReceitas.valor += jurosC
      outrasReceitas.itens.push({ nome: 'Juros e multa de crediário recebidos', valor: reais(jurosC) })
    }
    const atrasoMensC = centavos(mens[0]?.atraso ?? 0)
    if (atrasoMensC > 0) {
      outrasReceitas.valor += atrasoMensC
      outrasReceitas.itens.push({ nome: 'Juros e multa de mensalidades', valor: reais(atrasoMensC) })
    }

    const imposto = porGrupo('IMPOSTO')
    const cmvC = centavos(cmv[0]?.custo ?? 0) - centavos(cmvDevolvido[0]?.custo ?? 0)

    const receitaBrutaC = receitaVendaC + outrasReceitas.valor
    const receitaLiquidaC = receitaBrutaC - imposto.valor
    const lucroBrutoC = receitaLiquidaC - cmvC

    const operacionais = (['PESSOAL', 'OCUPACAO', 'COMERCIAL', 'ADMINISTRATIVA', 'OUTRA'] as const).map(
      (g) => ({ g, ...porGrupo(g) }),
    )
    const totalOperacionalC = operacionais.reduce((s, o) => s + o.valor, 0)
    const operacionalC = lucroBrutoC - totalOperacionalC

    const financeira = porGrupo('FINANCEIRA')
    // A taxa da maquininha calculada venda a venda entra aqui, ao lado do que
    // a loja lançou à mão. Quem lança à mão zera a taxa em Configurações e
    // esta linha some das vendas dali em diante (cada venda guarda a taxa do
    // dia dela — ver `taxasDoPeriodo`).
    if (taxas.totalCent > 0) {
      financeira.valor += taxas.totalCent
      financeira.itens.push({ nome: 'Taxas de cartão e Pix (calculadas)', valor: reais(taxas.totalCent) })
    }
    const resultadoC = operacionalC - financeira.valor

    // Compra de mercadoria NÃO é despesa do mês: ela vira custo quando a peça
    // é vendida, e isso já está no CMV. Mas ela também não pode simplesmente
    // sumir do relatório — quem pagou R$ 5.400 ao fornecedor procura esse
    // número, e não achar faz o dono desconfiar do sistema inteiro. Então ela
    // aparece como informação, fora da conta.
    const compra = porGrupo('MERCADORIA')

    // A conta da empresa inteira, olhando uma loja: despesa negativa, receita
    // positiva, e o saldo numa linha só — fora do resultado da loja.
    const empresaItens = daEmpresa.map((x) => ({
      nome: x.nome,
      valor: x.tipo === 'RECEITA' ? Number(x.total) : -Number(x.total),
    }))
    const empresaC = daEmpresa.reduce((s, x) => s + (x.tipo === 'RECEITA' ? 1 : -1) * centavos(x.total), 0)

    const linhas: LinhaDRE[] = [
      { chave: 'venda', rotulo: 'Venda de mercadoria', valor: reais(vendaBrutaC) },
      ...(devolC > 0 ? [{ chave: 'devolucoes', rotulo: '(−) Devoluções', valor: -reais(devolC) }] : []),
      ...(semCompraC > 0
        ? [{ chave: 'semCompra', rotulo: '(−) Pago com vale de troca sem a compra', valor: -reais(semCompraC) }]
        : []),
      ...(descontoCredC > 0
        ? [{ chave: 'descontoCred', rotulo: '(−) Descontos no recebimento do crediário', valor: -reais(descontoCredC) }]
        : []),
      ...(mensalidadesC > 0 ? [{ chave: 'mensalidades', rotulo: 'Mensalidades', valor: reais(mensalidadesC) }] : []),
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
      ...(daEmpresa.length > 0
        ? [{
            chave: 'empresa',
            rotulo: 'Despesas da empresa (fora do resultado da loja)',
            valor: reais(empresaC),
            itens: empresaItens,
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
      devolucoes: reais(devolC),
      taxasCalculadas: reais(taxas.totalCent),
    }
  }
}

/* ── mês a mês ────────────────────────────────────────────── */

export type MesDoResultado = {
  /** "2026-04" */
  mes: string
  /** "abr" */
  rotulo: string
  receita: number
  cmv: number
  despesas: number
  taxas: number
  resultado: number
}

/* ── o mês no calendário da loja ──────────────────────────── */

/**
 * Início e fim (exclusivo) de "AAAA-MM", à meia-noite de São Paulo.
 *
 * Já foi a meia-noite da máquina: num servidor em UTC o mês começava às 21h
 * do último dia do anterior, e a venda da noite de 31/08 entrava no
 * fechamento de setembro. Para o DRE, que fecha com `<=`, o fim é
 * `ate − 1 ms` — e não 23:59:59, que deixava de fora a venda do último
 * segundo do mês.
 */
export function janelaDoMes(mes: string) {
  return { de: inicioDoDiaEmSP(`${mes}-01`), ate: inicioDoDiaEmSP(`${outroMes(mes, 1)}-01`) }
}

/** O mês "AAAA-MM" somado de `n`. Aritmética de calendário, sem relógio. */
export function outroMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1 + n, 1)).toISOString().slice(0, 7)
}

/** O mês de agora no calendário de São Paulo. */
export const mesDeAgora = (agora: Date = new Date()) => diaEmSP(agora).slice(0, 7)

/**
 * O mês que veio do endereço, normalizado para "AAAA-MM" — ou nulo.
 *
 * Aceita "2026-9" (os links antigos escreviam assim). `?mes=lixo`,
 * `?mes=2026-13` e o parâmetro repetido (que o Next entrega como lista) são
 * nulo, e quem chama usa o mês corrente.
 */
export function lerMes(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(0?[1-9]|1[0-2])$/.exec(v)
  return m ? `${m[1]}-${m[2]!.padStart(2, '0')}` : null
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * O resultado dos últimos N meses, para o gráfico "entrou × saiu".
 *
 * Cada mês é o DRE daquele mês — a mesma `calcularDRE` do quadro de cima, e
 * não uma conta paralela. A conta paralela já existiu e discordava do
 * resultado do mês: deixava de fora as receitas lançadas (sinal de
 * encomenda, "outras receitas"), o juro do crediário e os impostos. Seis
 * DREs numa transação só custam mais consultas, e é uma tela que se abre
 * poucas vezes por dia.
 *
 * "Entrou" é a receita bruta (venda menos devolução, mais outras receitas);
 * "saiu" é tudo que o DRE desconta até o resultado: imposto, custo da
 * mercadoria vendida, despesas operacionais e financeiras (com as taxas).
 */
export async function resultadoPorMes(
  sessao: Sessao,
  pedidas: string[],
  meses = 6,
  agora = new Date(),
): Promise<MesDoResultado[]> {
  exigir(sessao, 'financeiro.ver')
  const unidadeIds = soAsQuePode(sessao, 'financeiro.ver', pedidas)

  // O mês de agora em SÃO PAULO: às 22h do dia 30, num servidor em UTC, o
  // gráfico já andava para o mês seguinte, vazio.
  const atual = mesDeAgora(agora)
  const chaves = Array.from({ length: meses }, (_, i) => outroMes(atual, i - (meses - 1)))

  return comoOrg(sessao.orgId, async (db) => {
    const saida: MesDoResultado[] = []
    const empresa = await contasDaEmpresa(db, sessao, unidadeIds)
    // Um de cada vez: consultas dentro da mesma transação não andam em paralelo.
    for (const mes of chaves) {
      const { de, ate } = janelaDoMes(mes)
      const dre = await calcularDRE(db, unidadeIds, de, new Date(ate.getTime() - 1), empresa)
      const valor = (chave: string) => dre.linhas.find((l) => l.chave === chave)?.valor ?? 0
      const receita = valor('bruta')
      const cmv = -valor('cmv')
      const taxas = dre.taxasCalculadas
      // Imposto + despesas operacionais + financeiras lançadas; a taxa
      // calculada vem separada para o gráfico poder dizer o que é.
      const despesas = reais(centavos(receita) - centavos(cmv) - centavos(taxas) - centavos(dre.resultado))
      saida.push({
        mes,
        rotulo: MES_CURTO[Number(mes.slice(5)) - 1]!,
        receita,
        cmv,
        despesas,
        taxas,
        resultado: dre.resultado,
      })
    }
    return saida
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
  /** Nulo = da empresa inteira. */
  unidadeId: string | null
  categoria: string
  fornecedor: string | null
  documento: string | null
  quem: string
  /** Nasceu de uma conta recorrente (ver `recorrentes.ts`). */
  recorrente: boolean
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
  /** A tela mostra 500; a planilha pede tudo do mês. */
  limite = 500,
): Promise<LancamentoNaLista[]> {
  exigir(sessao, 'financeiro.ver')

  // O mês pelo DIA, não pelo instante: `vencimento` é coluna `date`, que chega
  // como meia-noite UTC. Com a meia-noite de São Paulo aqui, a conta que vence
  // no dia 1º ficava fora do próprio mês. Ver `dia.ts`.
  // Mês que não é mês (veio do endereço: `?mes=2026-13`) é lista vazia, não
  // "Invalid Date" estourando no Prisma e a tela de erro no lugar da lista.
  if (!Number.isInteger(f.ano) || !Number.isInteger(f.mes) || f.mes < 1 || f.mes > 12) return []
  const mm = String(f.mes).padStart(2, '0')
  const de = colunaDoDia(`${f.ano}-${mm}-01`)
  const ate = colunaDoDia(f.mes === 12 ? `${f.ano + 1}-01-01` : `${f.ano}-${String(f.mes + 1).padStart(2, '0')}-01`)
  const q = textoDaBusca(f.q)
  // Só as lojas que esta pessoa pode ver no financeiro — a lista vem do
  // endereço, e o endereço é do usuário.
  const lojas = f.unidadeIds.filter((u) => pode(sessao, 'financeiro.ver', u))

  return comoOrg(sessao.orgId, async (db) => {
    const empresa = await contasDaEmpresa(db, sessao, lojas)
    const linhas = await db.lancamento.findMany({
      where: {
        // DUAS condições de "ou", e por isso dentro de um AND. Antes as duas
        // eram a mesma chave `OR` no mesmo objeto, e a da busca SOBRESCREVIA a
        // da loja: com qualquer coisa digitada na busca, o gerente da loja 3
        // passava a ver os lançamentos da loja 5.
        AND: [
          // Lançamento sem unidade é da empresa inteira (aluguel do escritório,
          // contador): aparece na leitura da empresa, e não em cada loja — o
          // mesmo critério do DRE (ver `contasDaEmpresa`).
          { OR: [{ unidadeId: { in: lojas } }, ...(empresa === 'dentro' ? [{ unidadeId: null }] : [])] },
          ...(q
            ? [
                {
                  OR: [
                    { descricao: { contains: q, mode: 'insensitive' as const } },
                    { fornecedor: { contains: q, mode: 'insensitive' as const } },
                    { documento: { contains: q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
        vencimento: { gte: de, lt: ate },
        ...(f.tipo ? { tipo: f.tipo } : {}),
        ...(f.categoriaId ? { categoriaId: f.categoriaId } : {}),
        ...(f.situacao === 'aberto' ? { pagoEm: null } : f.situacao === 'pago' ? { pagoEm: { not: null } } : {}),
      },
      orderBy: [{ vencimento: 'asc' }, { criadoEm: 'asc' }],
      take: limite,
      select: {
        id: true, tipo: true, descricao: true, valor: true, vencimento: true, pagoEm: true,
        fornecedor: true, documento: true, quem: true, recorrenteId: true, unidadeId: true,
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
      unidadeId: l.unidadeId,
      categoria: l.categoria.nome,
      fornecedor: l.fornecedor,
      documento: l.documento,
      quem: l.quem,
      recorrente: l.recorrenteId !== null,
    }))
  })
}
