// Troca numa tela só.
//
// ── o que era ────────────────────────────────────────────────
// Trocar a blusa por outra era dois caminhos em duas telas: Vendas → achar a
// compra → Devolver (vira vale, anota o código) → Balcão → lançar a peça
// nova → pagar com o código do vale. Cinco minutos com a cliente esperando, e
// o meio do caminho era o perigo: a devolução gravada e a venda nova não (a
// internet caiu, a vendedora foi atender outra), e a cliente saía com a peça
// nova sem venda nenhuma — ou o vale ficava aberto para ser gasto de novo.
//
// ── o que é ──────────────────────────────────────────────────
// Uma tela: acha a compra, marca peça por peça o que voltou (pelo preço que
// ela PAGOU), lança o que ela leva, e a conta diz "cliente paga R$ X / vira
// vale R$ X / sem diferença". Por baixo, NUMA transação só:
//
//   1. a devolução da compra, com destino VALE (devolucao.ts, `devolverEm`):
//      a peça volta ao estoque, os pontos acertam, o crediário em aberto da
//      própria compra é abatido primeiro;
//   2. a venda nova (venda.ts, `registrarVenda` dentro da mesma transação),
//      paga com esse vale e, se passar, com a diferença em qualquer forma —
//      dinheiro na gaveta do turno, Pix e cartão com a maquininha, crediário
//      com as parcelas e o 1º vencimento. As regras da venda valem todas:
//      estoque (e "vende sem estoque"), tabela de preço da forma, caixa;
//   3. o que sobrar do vale fica no vale — é o papel que a cliente leva.
//
// Se qualquer pedaço recusa ou estoura, nada fica: nem devolução, nem vale,
// nem venda, nem estoque mexido.
//
// ── a troca sem a compra ─────────────────────────────────────
// A loja vendia noutro sistema até ontem, e a cliente volta com a peça de
// lá. Não há compra para achar: a vendedora escolhe a peça no catálogo e
// digita o preço que a cliente pagou. Preço digitado vira vale — é dinheiro
// —, e por isso pede o PIN de quem pode autorizar desconto (ou ser essa
// pessoa). A peça volta ao estoque e o crédito nasce como vale desta loja.

import type { FormaPagamento, Prisma } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, numeroDaBusca, pode, SemPermissao, textoDaBusca, type Sessao } from './permissao'
import { autorizarComPin } from './autorizacao'
import { criarValeEm, devolverEm, normalizarCodigo, pedeInteiro, restante, type ResultadoDevolucao } from './devolucao'
import {
  registrarVenda,
  EstoqueSumiu,
  PontosDisputados,
  ValeDisputado,
  type PagamentoDaVenda,
  type ResultadoVenda,
} from './venda'
import { mexerEstoqueEm } from './estoque'
import { centavos, lerDinheiro, mostrar, multiplicar, reais } from './dinheiro'
import { diaEmSP, diasEntre, inicioDoDiaEmSP, somarDias } from './dia'
import {
  contaDaTroca,
  fatorPago,
  precoDaPeca,
  precoSemCompraPareceErrado,
  tabelaDaTroca,
  valorDevolvidoCent,
} from './troca-conta'

// ─────────────────────────────────────────────────────────────
// ACHAR A COMPRA
// ─────────────────────────────────────────────────────────────

/** Os períodos da busca, em dias para trás. Zero = hoje. */
export const PERIODOS_DA_TROCA = [0, 7, 30, 90] as const

export type CompraAchada = {
  id: string
  numero: number
  criadaEm: Date
  total: number
  cliente: string | null
  /** As peças, numa linha: é o que a vendedora confere com a sacola na mão. */
  itens: string
  formas: FormaPagamento[]
  /** Ainda tem peça que pode voltar. */
  podeVoltar: boolean
}

/**
 * As compras desta loja no período, pela busca: nome da cliente, peça
 * (nome ou código da etiqueta), número da venda ou valor ("189,90").
 */
export async function procurarCompras(
  sessao: Sessao,
  f: { unidadeId: string; dias: number; q?: string | null },
): Promise<CompraAchada[]> {
  exigir(sessao, 'venda.criar', f.unidadeId)
  exigir(sessao, 'venda.ver', f.unidadeId)
  const dias = (PERIODOS_DA_TROCA as readonly number[]).includes(f.dias) ? f.dias : 30
  const desde = inicioDoDiaEmSP(somarDias(diaEmSP(), -dias))
  const q = textoDaBusca(f.q)

  const ou: Prisma.VendaWhereInput[] = []
  if (q) {
    ou.push({ cliente: { nome: { contains: q, mode: 'insensitive' } } })
    ou.push({ itens: { some: { descricao: { contains: q, mode: 'insensitive' } } } })
    ou.push({ itens: { some: { codigo: { contains: q, mode: 'insensitive' } } } })
    const numero = numeroDaBusca(q)
    if (numero !== null) ou.push({ numero })
    // "189,90" ou "R$ 189,90": o valor da compra, que é o que está no
    // comprovante amassado quando o resto não está.
    const valor = /^(r\$\s*)?\d{1,7}([.,]\d{1,2})?$/i.test(q) ? lerDinheiro(q) : null
    if (valor !== null && valor > 0) ou.push({ total: valor })
  }

  return comoOrg(sessao.orgId, async (db) => {
    const vendas = await db.venda.findMany({
      where: {
        unidadeId: f.unidadeId,
        situacao: 'CONCLUIDA',
        criadaEm: { gte: desde },
        ...(ou.length > 0 ? { OR: ou } : {}),
      },
      orderBy: { criadaEm: 'desc' },
      take: 40,
      select: {
        id: true, numero: true, criadaEm: true, total: true,
        cliente: { select: { nome: true } },
        pagamentos: { select: { forma: true } },
        itens: {
          orderBy: { id: 'asc' },
          select: { descricao: true, quantidade: true, devolucoes: { select: { quantidade: true } } },
        },
      },
    })
    return vendas.map((v) => ({
      id: v.id,
      numero: v.numero,
      criadaEm: v.criadaEm,
      total: Number(v.total),
      cliente: v.cliente?.nome ?? null,
      itens: v.itens
        .map((i) => {
          const n = Number(i.quantidade)
          return `${n !== 1 ? `${String(n).replace('.', ',')}× ` : ''}${i.descricao}`
        })
        .join(' · '),
      formas: [...new Set(v.pagamentos.map((p) => p.forma))],
      podeVoltar: v.itens.some(
        (i) => restante(Number(i.quantidade), i.devolucoes.reduce((s, d) => s + Number(d.quantidade), 0)) > 0,
      ),
    }))
  })
}

export type CompraParaTroca = {
  id: string
  numero: number
  criadaEm: Date
  /** Há quantos dias foi a compra (no calendário de São Paulo). */
  dias: number
  unidadeId: string
  unidade: string
  total: number
  cliente: { id: string; nome: string } | null
  /** Quanto de cada real da etiqueta ela pagou (ver troca-conta.ts). */
  fator: number
  /** O crediário em aberto DESTA compra: a devolução abate dele primeiro. */
  fiadoAbertoCent: number
  itens: {
    id: string
    descricao: string
    codigo: string | null
    medida: string
    inteiro: boolean
    /** Quanto ainda pode voltar. */
    restante: number
    precoUnitCent: number
    /** Item sem cadastro (venda trazida do sistema anterior, avulso): o estoque só volta se apontarem a peça. */
    semCadastro: boolean
  }[]
}

/** A compra aberta para a troca: as peças que ainda podem voltar e quanto vale cada uma. */
export async function compraParaTroca(sessao: Sessao, vendaId: string): Promise<CompraParaTroca | null> {
  exigir(sessao, 'venda.ver')
  if (!/^[\w-]{1,64}$/.test(vendaId)) return null
  return comoOrg(sessao.orgId, async (db) => {
    const v = await db.venda.findUnique({
      where: { id: vendaId },
      select: {
        id: true, numero: true, criadaEm: true, unidadeId: true, situacao: true,
        subtotal: true, total: true,
        unidade: { select: { nome: true } },
        cliente: { select: { id: true, nome: true } },
        pagamentos: { select: { juros: true } },
        itens: {
          orderBy: { id: 'asc' },
          select: {
            id: true, descricao: true, codigo: true, medida: true, quantidade: true, precoUnit: true, variacaoId: true,
            devolucoes: { select: { quantidade: true } },
          },
        },
      },
    })
    if (!v || v.situacao !== 'CONCLUIDA') return null
    if (!pode(sessao, 'venda.criar', v.unidadeId)) return null
    const abertas = await db.parcela.findMany({
      where: { vendaId: v.id, quitadaEm: null },
      select: { valor: true, pago: true, desconto: true },
    })
    const fiadoAbertoCent = abertas.reduce(
      (s, p) => s + Math.max(0, centavos(p.valor) - centavos(p.pago) - centavos(p.desconto)),
      0,
    )
    return {
      id: v.id,
      numero: v.numero,
      criadaEm: v.criadaEm,
      dias: diasEntre(diaEmSP(v.criadaEm), diaEmSP()),
      unidadeId: v.unidadeId,
      unidade: v.unidade.nome,
      total: Number(v.total),
      cliente: v.cliente,
      fator: fatorPago(
        centavos(v.subtotal),
        centavos(v.total),
        v.pagamentos.reduce((s, x) => s + centavos(x.juros), 0),
      ),
      fiadoAbertoCent,
      itens: v.itens
        .map((i) => ({
          id: i.id,
          descricao: i.descricao,
          codigo: i.codigo,
          medida: i.medida,
          inteiro: pedeInteiro(i.medida),
          restante: restante(Number(i.quantidade), i.devolucoes.reduce((s, d) => s + Number(d.quantidade), 0)),
          precoUnitCent: centavos(i.precoUnit),
          semCadastro: !i.variacaoId,
        }))
        .filter((i) => i.restante > 0),
    }
  })
}

// ─────────────────────────────────────────────────────────────
// O PAPEL DO VALE
// ─────────────────────────────────────────────────────────────

export type ValeParaImprimir = {
  codigo: string
  valor: number
  saldo: number
  validade: Date | null
  criadoEm: Date
  quem: string
  cliente: string | null
  /** A loja que emitiu (com "vale por loja", a única onde ele serve). */
  loja: { nome: string; apelido: string | null; documento: string | null; telefone: string | null } | null
  /** A compra de onde veio (a devolução), quando veio de uma. */
  daVenda: number | null
  valePorLoja: boolean
}

/** O vale, para o papel que a cliente leva. Quem vende na loja do vale pode imprimir. */
export async function valeParaImprimir(sessao: Sessao, codigoBruto: string): Promise<ValeParaImprimir | null> {
  exigir(sessao, 'venda.criar')
  const codigo = normalizarCodigo(codigoBruto)
  if (!codigo) return null
  return comoOrg(sessao.orgId, async (db) => {
    const v = await db.vale.findFirst({
      where: { codigo },
      select: {
        codigo: true, valor: true, saldo: true, validade: true, criadoEm: true, quem: true, unidadeId: true,
        cliente: { select: { nome: true } },
        unidade: { select: { nome: true, apelido: true, documento: true, telefone: true } },
        devolucao: { select: { venda: { select: { numero: true } } } },
      },
    })
    if (!v) return null
    if (v.unidadeId && !pode(sessao, 'venda.criar', v.unidadeId)) return null
    const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { valePorLoja: true } })
    return {
      codigo: v.codigo,
      valor: Number(v.valor),
      saldo: Number(v.saldo),
      validade: v.validade,
      criadoEm: v.criadoEm,
      quem: v.quem,
      cliente: v.cliente?.nome ?? null,
      loja: v.unidade,
      daVenda: v.devolucao?.venda.numero ?? null,
      valePorLoja: !!org?.valePorLoja,
    }
  })
}

// ─────────────────────────────────────────────────────────────
// TROCAR
// ─────────────────────────────────────────────────────────────

export type PedidoTroca = {
  /** A loja onde a troca acontece: a peça volta para cá e a nova sai daqui. */
  unidadeId: string
  /** A compra. Nula = "não achei a compra" (comprada no sistema anterior). */
  vendaId: string | null
  /**
   * Da compra: quanto de cada item volta. No item sem cadastro (a venda do
   * sistema anterior), `variacaoId` é a peça do catálogo que volta ao
   * estoque no lugar dele — ver `PedidoDevolucao`.
   */
  voltam: { vendaItemId: string; quantidade: number; variacaoId?: string | null }[]
  /** Sem a compra: a peça do catálogo e o preço que a cliente pagou, digitado. */
  semCompra: { variacaoId: string; quantidade: number; precoUnit: number }[]
  /** O que ela leva agora. Vazio = só devolve, e o crédito vira vale. */
  leva: { variacaoId: string; quantidade: number }[]
  /**
   * Como paga o que a peça nova passa do crédito. O valor é conferido contra
   * a conta do servidor — a tela mostra a mesma conta (troca-conta.ts).
   */
  diferenca: Omit<PagamentoDaVenda, 'referencia'> | null
  /**
   * A cliente. Na troca com a compra, vale a da compra; esta só entra quando
   * a compra não tem cliente. Sem a compra, é ela quem fica com o vale (e com
   * a dívida, se a diferença for no crediário).
   */
  clienteId: string | null
  /** O CPF que a cliente ditou para o crediário da diferença. */
  clienteCpf?: string | null
  vendedorId?: string | null
  motivo: string
  /** O PIN de quem autoriza a troca sem a compra. Conferido aqui, nunca guardado. */
  pin?: string | null
  /** O troco do dinheiro da diferença — vai para o comprovante (ver `NovaVenda.troco`). */
  troco?: number
}

export type ResultadoTroca =
  | {
      ok: true
      /** A venda nova (nula quando ela só devolveu, sem levar nada). */
      vendaId: string | null
      numero: number | null
      /** A compra de onde as peças voltaram (nula na troca sem a compra). */
      compraNumero: number | null
      voltou: number
      /** O que abateu o crediário em aberto da própria compra. */
      abatido: number
      credito: number
      levou: number
      /** O que a cliente pagou além do crédito (sem o juro do crédito parcelado). */
      pagou: number
      /** O vale que sobrou, com saldo: o papel que a cliente leva. */
      vale: { codigo: string; saldo: number; validade: Date | null } | null
      semEstoque: string[]
      autorizadoPor: string | null
    }
  | { ok: false; motivo: string; recado: string; precisaPin?: boolean }

/** Desfaz a transação inteira levando a recusa — ver `trocar`. */
class Desfazer extends Error {
  constructor(readonly resultado: Extract<ResultadoTroca, { ok: false }>) {
    super(resultado.recado)
    this.name = 'Desfazer'
  }
}

const recusa = (motivo: string, recado: string, extra: { precisaPin?: boolean } = {}) =>
  ({ ok: false as const, motivo, recado, ...extra })

const quantidadeBoa = (q: unknown) => typeof q === 'number' && Number.isFinite(q) && q > 0

/** Teto do preço digitado sem a compra, contra o dedo errado em peça sem etiqueta de hoje. */
const TETO_SEM_COMPRA_CENT = 1_000_000

export async function trocar(sessao: Sessao, p: PedidoTroca): Promise<ResultadoTroca> {
  exigir(sessao, 'venda.criar', p.unidadeId)

  // ── a forma do que chegou ──
  // Tudo vem do navegador. Quantidade que não é número positivo não é peça
  // (`NaN > resto` é falso e passava); preço digitado precisa ser dinheiro.
  const voltam = (p.voltam ?? []).filter((i) => i && i.quantidade !== 0)
  const semCompra = (p.semCompra ?? []).filter((i) => i && i.quantidade !== 0)
  const leva = (p.leva ?? []).filter((i) => i && i.quantidade !== 0)
  if (
    voltam.some((i) => !quantidadeBoa(i.quantidade)) ||
    semCompra.some((i) => !quantidadeBoa(i.quantidade) || !(Number.isFinite(i.precoUnit) && i.precoUnit > 0)) ||
    leva.some((i) => !quantidadeBoa(i.quantidade))
  ) {
    return recusa('sem_itens', 'Uma das quantidades ou preços não deu para ler. Confira e tente de novo.')
  }
  if (p.vendaId ? semCompra.length > 0 : voltam.length > 0) {
    return recusa('sem_itens', 'A troca veio misturada (com e sem a compra). Recarregue a tela e marque de novo.')
  }
  if ((p.vendaId ? voltam.length : semCompra.length) === 0) {
    return recusa('sem_itens', 'Marque o que está voltando.')
  }
  if (p.diferenca) {
    if (p.diferenca.forma === 'VALE') {
      return recusa('pagamento_recusado', 'A diferença se paga em dinheiro, Pix, cartão ou crediário. Outro vale entra pelo balcão.')
    }
    if (!Number.isFinite(p.diferenca.valor) || p.diferenca.valor < 0) {
      return recusa('pagamento_recusado', 'O valor da diferença não deu para ler.')
    }
  }
  const motivoLimpo = String(p.motivo ?? '').trim().slice(0, 200)
  // A devolução pede motivo de três letras; "Troca" já diz o principal, e o
  // que a vendedora escreveu vem junto.
  const motivo = motivoLimpo ? `Troca: ${motivoLimpo}` : 'Troca'

  // ── a autorização da troca sem a compra ──
  // ANTES da transação: a conferência do PIN abre as próprias (o freio e o
  // livro), e transação não aninha. Quem pode dar desconto acima do teto
  // não precisa de PIN — é a mesma régua do item avulso na venda.
  let autorizador: { usuarioId: string; nome: string } | null = null
  if (!p.vendaId && !pode(sessao, 'venda.desconto', p.unidadeId)) {
    const creditoCent = semCompra.reduce((s, i) => s + multiplicar(centavos(i.precoUnit), i.quantidade), 0)
    if (!p.pin || !String(p.pin).trim()) {
      return recusa(
        'precisa_pin',
        `Troca sem a compra vira um vale de ${mostrar(creditoCent)} pelo preço digitado: precisa do PIN de quem pode autorizar.`,
        { precisaPin: true },
      )
    }
    const r = await autorizarComPin({
      orgId: sessao.orgId,
      unidadeId: p.unidadeId,
      pin: String(p.pin).trim().slice(0, 12),
      capacidade: 'venda.desconto',
      motivo: `Troca sem a compra (sistema anterior): crédito de ${mostrar(creditoCent)}`,
      quemPediu: { usuarioId: sessao.usuarioId, nome: sessao.nome },
    })
    if (!r.ok) return recusa('autorizacao_recusada', r.erro, { precisaPin: true })
    autorizador = r.autorizador
  }

  try {
    return await comoOrg(sessao.orgId, (db) => trocarEm(db, sessao, p, { voltam, semCompra, leva, motivo, autorizador }))
  } catch (e) {
    if (e instanceof Desfazer) return e.resultado
    if (e instanceof EstoqueSumiu) {
      return recusa('estoque_sumiu', `${e.message} A troca não foi feita: confira o estoque e tente de novo.`)
    }
    if (e instanceof ValeDisputado || e instanceof PontosDisputados) {
      return recusa('disputa', `${e.message} A troca não foi feita: tente de novo.`)
    }
    if (e instanceof SemPermissao) return recusa('sem_permissao', 'Você não pode fazer troca nesta loja. Nada foi gravado.')
    throw e
  }
}

async function trocarEm(
  db: BancoDaOrg,
  sessao: Sessao,
  p: PedidoTroca,
  c: {
    voltam: PedidoTroca['voltam']
    semCompra: PedidoTroca['semCompra']
    leva: PedidoTroca['leva']
    motivo: string
    autorizador: { usuarioId: string; nome: string } | null
  },
): Promise<ResultadoTroca> {
  // ── a loja ──
  const loja = await db.unidade.findUnique({ where: { id: p.unidadeId }, select: { ativa: true, ehDeposito: true, nome: true } })
  if (!loja || !loja.ativa || loja.ehDeposito) return recusa('loja_nao_vende', 'Esta loja não vende (depósito ou desativada).')

  // ── a cliente escolhida na tela, quando vale ──
  let clienteId: string | null = null
  if (p.clienteId) {
    const cli = await db.cliente.findFirst({ where: { id: p.clienteId, ativo: true }, select: { id: true } })
    if (!cli) return recusa('cliente', 'A cliente escolhida não foi encontrada. Escolha de novo.')
    clienteId = cli.id
  }

  let vale: { id: string; codigo: string } | null = null
  let voltaCent = 0
  let abatidoCent = 0
  let creditoCent = 0
  let compraNumero: number | null = null
  let origem: string

  if (p.vendaId) {
    // ── 1. a devolução da compra, destino VALE ──
    const compra = await db.venda.findUnique({
      where: { id: p.vendaId },
      select: { unidadeId: true, clienteId: true, numero: true, unidade: { select: { nome: true } } },
    })
    if (!compra) return recusa('nao_achada', 'A compra não foi encontrada.')
    // A troca acontece na loja da compra: a peça volta para o estoque de lá,
    // e o vale que nasce é de lá (com "vale por loja", só se gasta lá).
    if (compra.unidadeId !== p.unidadeId) {
      return recusa('outra_loja', `Esta compra foi na ${compra.unidade.nome}. A troca dela é feita lá.`)
    }
    if (compra.clienteId) clienteId = compra.clienteId
    compraNumero = compra.numero

    const dev = await devolverEm(db, sessao, { vendaId: p.vendaId, itens: c.voltam, destino: 'VALE', motivo: c.motivo })
    // A devolução recusa antes de escrever qualquer coisa: dá para devolver a
    // recusa sem desfazer nada.
    if (!dev.ok) return recusaDaDevolucao(dev)
    abatidoCent = centavos(dev.abatido)
    creditoCent = centavos(dev.valor)
    voltaCent = abatidoCent + creditoCent
    vale = dev.vale
    // A compra sem cliente e a cliente escolhida agora: o vale ganha dono.
    if (vale && !compra.clienteId && clienteId) {
      await db.vale.update({ where: { id: vale.id }, data: { clienteId } })
    }
    origem = `Troca da venda ${compra.numero}`
  } else {
    // ── 1'. sem a compra: a peça volta pelo preço digitado ──
    const ids = [...new Set(c.semCompra.map((i) => i.variacaoId))]
    const vs = await db.variacao.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, ajustePreco: true,
        produto: { select: { nome: true, medida: true, precoVista: true, precoCartao: true, precoCrediario: true } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
      },
    })
    const porId = new Map(vs.map((x) => [x.id, x]))
    const linhas: { variacaoId: string; descricao: string; quantidade: number; cent: number }[] = []
    for (const i of c.semCompra) {
      const x = porId.get(i.variacaoId)
      if (!x) return recusa('nao_achada', 'Uma das peças que voltam não está no cadastro. Escolha de novo.')
      const descricao = x.opcoes.length ? `${x.produto.nome} — ${x.opcoes.map((o) => o.opcao.valor).join(' · ')}` : x.produto.nome
      if (pedeInteiro(x.produto.medida) && !Number.isInteger(i.quantidade)) {
        return recusa('quantidade_fracionada', `Peça volta inteira: ${descricao}.`)
      }
      const precoCent = centavos(i.precoUnit)
      const ajuste = centavos(x.ajustePreco ?? 0)
      const maisCara =
        Math.max(
          centavos(x.produto.precoVista ?? 0),
          x.produto.precoCartao != null ? centavos(x.produto.precoCartao) : 0,
          x.produto.precoCrediario != null ? centavos(x.produto.precoCrediario) : 0,
        ) + ajuste
      if (precoCent > TETO_SEM_COMPRA_CENT || precoSemCompraPareceErrado(precoCent, maisCara)) {
        return recusa('preco_errado', `${mostrar(precoCent)} por ${descricao} parece dedo errado. Confira o preço que a cliente pagou.`)
      }
      linhas.push({ variacaoId: x.id, descricao, quantidade: i.quantidade, cent: multiplicar(precoCent, i.quantidade) })
    }
    voltaCent = linhas.reduce((s, l) => s + l.cent, 0)
    creditoCent = voltaCent

    // A peça volta ao estoque desta loja — é aqui que ela está, na mão.
    for (const l of linhas) {
      await mexerEstoqueEm(db, sessao, {
        variacaoId: l.variacaoId,
        unidadeId: p.unidadeId,
        tipo: 'DEVOLUCAO',
        quantidade: l.quantidade,
        motivo: `Troca sem a compra (sistema anterior)${c.autorizador ? ` · autorizada por ${c.autorizador.nome}` : ''}`,
      })
    }
    vale = await criarValeEm(db, sessao, { clienteId, unidadeId: p.unidadeId, valorCent: creditoCent })
    origem = `Troca sem a compra (sistema anterior): ${linhas.map((l) => `${l.quantidade !== 1 ? `${l.quantidade}× ` : ''}${l.descricao} ${mostrar(l.cent)}`).join(', ')}`
  }

  // ── 2. a venda nova ──
  let venda: Extract<ResultadoVenda, { ok: true }> | null = null
  let pagaCent = 0
  let levaCent = 0
  if (c.leva.length === 0) {
    // Só devolveu: o crédito inteiro é o vale. Diferença para pagar não há.
    if (p.diferenca && centavos(p.diferenca.valor) > 0) {
      throw new Desfazer(recusa('nada_a_pagar', 'Sem peça nova, não há diferença para pagar: o crédito vira vale.'))
    }
  } else {
    // O preço de hoje das peças novas, na tabela da forma da diferença — a
    // mesma conta que a venda refaz e confere logo abaixo.
    const tabela = tabelaDaTroca(p.diferenca?.forma ?? null)
    const vs = await db.variacao.findMany({
      where: { id: { in: [...new Set(c.leva.map((i) => i.variacaoId))] } },
      select: { id: true, ajustePreco: true, produto: { select: { precoVista: true, precoCartao: true, precoCrediario: true } } },
    })
    const precoDe = new Map(
      vs.map((x) => [
        x.id,
        precoDaPeca(
          {
            vista: centavos(x.produto.precoVista ?? 0),
            cartao: x.produto.precoCartao != null ? centavos(x.produto.precoCartao) : null,
            crediario: x.produto.precoCrediario != null ? centavos(x.produto.precoCrediario) : null,
          },
          centavos(x.ajustePreco ?? 0),
          tabela,
        ),
      ]),
    )
    levaCent = c.leva.reduce((s, i) => s + multiplicar(precoDe.get(i.variacaoId) ?? 0, i.quantidade), 0)
    const conta = contaDaTroca({ voltaCent: creditoCent, fiadoAbertoCent: 0, levaCent })
    pagaCent = conta.pagaCent

    const pagamentos: PagamentoDaVenda[] = []
    if (conta.usaCent > 0 && vale) pagamentos.push({ forma: 'VALE', valor: reais(conta.usaCent), referencia: vale.codigo })
    if (conta.pagaCent > 0) {
      if (!p.diferenca || centavos(p.diferenca.valor) <= 0) {
        throw new Desfazer(recusa('falta_pagar', `A peça nova passa do crédito: falta pagar ${mostrar(conta.pagaCent)}. Escolha como a cliente paga.`))
      }
      if (centavos(p.diferenca.valor) !== conta.pagaCent) {
        throw new Desfazer(
          recusa(
            'diferenca_nao_fecha',
            `A diferença é ${mostrar(conta.pagaCent)}, e a tela mandou ${mostrar(centavos(p.diferenca.valor))}. O preço pode ter mudado: confira e confirme de novo.`,
          ),
        )
      }
      pagamentos.push({ ...p.diferenca, valor: reais(conta.pagaCent) })
    } else if (p.diferenca && centavos(p.diferenca.valor) > 0) {
      throw new Desfazer(recusa('nada_a_pagar', 'O crédito cobre a peça nova: não há diferença para pagar. Confira e confirme de novo.'))
    }

    const r = await registrarVenda(
      sessao,
      {
        unidadeId: p.unidadeId,
        clienteId,
        vendedorId: p.vendedorId ?? null,
        itens: c.leva.map((i) => ({ variacaoId: i.variacaoId, quantidade: i.quantidade })),
        pagamentos,
        clienteCpf: p.clienteCpf ?? null,
        troco: p.troco,
        observacoes: origem.slice(0, 500),
      },
      { db, autorizador: c.autorizador },
    )
    // A venda recusou (estoque, caixa fechado, crediário...): a devolução e o
    // vale já estão escritos nesta transação — desfaz tudo.
    if (!r.ok) throw new Desfazer(recusaDaVenda(r))
    venda = r
  }

  // ── 3. o que sobrou do vale ──
  const sobra = vale
    ? await db.vale.findUnique({ where: { id: vale.id }, select: { codigo: true, saldo: true, validade: true } })
    : null
  const valeQueFica = sobra && centavos(sobra.saldo) > 0 ? { codigo: sobra.codigo, saldo: reais(centavos(sobra.saldo)), validade: sobra.validade } : null

  await db.auditoria.create({
    data: {
      orgId: sessao.orgId,
      unidadeId: p.unidadeId,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao: 'venda.trocou',
      alvoTipo: 'venda',
      alvoId: venda?.vendaId ?? p.vendaId ?? null,
      alvoNome: venda ? `Venda ${venda.numero}` : compraNumero !== null ? `Venda ${compraNumero}` : 'Troca sem a compra',
      valor: reais(voltaCent),
      motivo: [
        origem.slice(0, 200),
        `voltou ${mostrar(voltaCent)}`,
        abatidoCent > 0 ? `${mostrar(abatidoCent)} abatido do crediário da compra` : null,
        venda ? `levou ${mostrar(levaCent)} (venda ${venda.numero})` : null,
        pagaCent > 0 && p.diferenca ? `pagou ${mostrar(pagaCent)} (${p.diferenca.forma.toLowerCase()})` : null,
        valeQueFica ? `vale ${valeQueFica.codigo} com ${mostrar(centavos(valeQueFica.saldo))}` : null,
        c.autorizador ? `autorizada por ${c.autorizador.nome}` : null,
        c.motivo !== 'Troca' ? c.motivo : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  })

  return {
    ok: true,
    vendaId: venda?.vendaId ?? null,
    numero: venda?.numero ?? null,
    compraNumero,
    voltou: reais(voltaCent),
    abatido: reais(abatidoCent),
    credito: reais(creditoCent),
    levou: reais(levaCent),
    pagou: reais(pagaCent),
    vale: valeQueFica,
    semEstoque: venda?.semEstoque ?? [],
    autorizadoPor: c.autorizador?.nome ?? null,
  }
}

function recusaDaDevolucao(d: Extract<ResultadoDevolucao, { ok: false }>) {
  const recado: Record<typeof d.motivo, string> = {
    nao_achada: 'A compra (ou uma peça dela) não foi encontrada. Recarregue a tela.',
    cancelada: 'Esta compra foi cancelada — não há o que trocar.',
    saldo_importado: 'Este é o saldo de crediário trazido do sistema anterior: não tem peça para voltar. Use "Não achei a compra".',
    sem_itens: 'Marque o que está voltando.',
    passa_do_vendido: 'Está voltando mais do que foi comprado — parte já pode ter voltado antes. Recarregue a compra.',
    sem_motivo: 'Diga o motivo da troca.',
    caixa_fechado: 'O caixa desta loja precisa estar aberto.',
    sem_permissao: 'Você não pode fazer troca nesta loja.',
    item_repetido: 'A mesma peça veio duas vezes. Recarregue a tela e marque de novo.',
    quantidade_fracionada: 'Peça, par e caixa voltam inteiros: 1, 2, 3.',
  }
  return recusa(d.motivo, recado[d.motivo])
}

function recusaDaVenda(r: Extract<ResultadoVenda, { ok: false }>) {
  switch (r.motivo) {
    case 'sem_estoque':
      return recusa(
        r.motivo,
        `O sistema diz que acabou: ${r.faltando.map((f) => f.descricao).join(', ')}. Esta loja não vende sem estoque — confira a prateleira ou escolha outra peça.`,
      )
    case 'pagamento_nao_fecha':
      return recusa(r.motivo, `A conta não fechou (${mostrar(centavos(r.total))} × ${mostrar(centavos(r.pago))}). O preço pode ter mudado: recarregue e confirme de novo.`)
    case 'caixa_fechado':
      return recusa(r.motivo, 'Para receber a diferença em dinheiro o caixa desta loja precisa estar aberto.')
    case 'desconto_acima_do_teto':
      return recusa(r.motivo, 'A troca passou do desconto que a loja permite. Chame quem pode autorizar.')
    case 'avulso_negado':
      return recusa(r.motivo, 'Item fora do cadastro não entra na troca.')
    case 'vendedor_invalido':
      return recusa(r.motivo, 'Quem vendeu não pode vender nesta loja. Escolha de novo.')
    case 'sem_itens':
      return recusa(r.motivo, 'Escolha o que a cliente leva.')
    case 'fora_da_loja':
      return recusa(r.motivo, `Esta loja não vende: ${r.itens.join(', ')}.`)
    case 'uso_interno':
      return recusa(r.motivo, `Material de uso não se vende: ${r.itens.join(', ')}.`)
    case 'item_inativo':
      return recusa(r.motivo, `Saiu do cadastro: ${r.itens.join(', ')}. Escolha outra peça.`)
    case 'quantidade_fracionada':
      return recusa(r.motivo, `Peça se conta inteira: ${r.itens.join(', ')}.`)
    case 'loja_nao_vende':
      return recusa(r.motivo, 'Esta loja não vende (depósito ou desativada).')
    case 'autorizacao_recusada':
    case 'pagamento_recusado':
    case 'pontos_recusados':
    case 'vale_recusado':
    case 'crediario_recusado':
    case 'teto_do_plano':
    case 'encomenda_recusada':
    case 'agendamento_recusado':
      return recusa(r.motivo, r.recado)
    default:
      // Recusa que este arquivo ainda não conhece: nada foi gravado, e a
      // frase genérica é melhor que nenhuma.
      return recusa('recusada', 'A venda da peça nova foi recusada, e nada foi gravado. Tente de novo.')
  }
}
