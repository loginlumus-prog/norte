// Devolver e trocar.
//
// ── devolver não é cancelar ──────────────────────────────────
// Cancelar desfaz a venda inteira e existe para o engano: passou a venda
// errada, o cliente desistiu antes de sair. Devolver é o dia seguinte: a
// blusa não serviu, o tênis apertou. Tira PARTE da venda, o resto fica.
//
// E o valor daquela parte precisa ir para algum lugar. Três destinos:
//
//   VALE      vira crédito para trocar. É a troca: a pessoa leva um código
//             no papel e gasta numa venda futura, como forma de pagamento.
//   DINHEIRO  sai da gaveta agora. Registrado como SANGRIA do caixa aberto,
//             senão o fechamento acusa falta de um dinheiro que foi devolvido.
//   ESTORNO   devolvido por fora (cartão, Pix). O sistema não faz o estorno
//             e não finge que faz — só anota que aconteceu, com quem e quando.
//
// ── quanto vale o que voltou ─────────────────────────────────
// O que a pessoa recebe é o que ela PAGOU pela peça, não a etiqueta. Numa
// venda com desconto de 10%, a blusa de R$ 100 foi paga por R$ 90 — devolver
// R$ 100 seria a loja pagar para receber a peça de volta. A conta é o total
// da linha (já sem o desconto dado nela), na proporção do que volta, vezes o
// fator (total − juro − acréscimo) ÷ subtotal da venda — nunca mais que 1:
// o acréscimo é de uma peça que a venda não diz qual, e devolução nunca passa
// do que a peça custou (ver `fatorPago` em troca-conta.ts).
//
// ── onde acontece ────────────────────────────────────────────
// A cliente comprou no Centro e devolve no Shopping: o dinheiro sai da gaveta
// do Shopping, a peça volta para a arara do Shopping, e o vale é de lá. A
// devolução continua contada na loja da VENDA (é lá que a receita dela está),
// e o livro das duas lojas registra.
//
// ── o vale volta como vale ───────────────────────────────────
// Compra paga com vale, devolvida "em dinheiro": o vale virava dinheiro na
// mão. O que sai em dinheiro (ou estorno) nunca passa do que a compra recebeu
// FORA do vale, somadas as devoluções anteriores; o resto volta num vale novo.
//
// ── o que volta e o que não volta ────────────────────────────
// O estoque volta (movimento DEVOLUCAO apontando para a venda). Os pontos
// que a venda deu saem, e os que o cliente gastou nela voltam, na proporção
// do que foi devolvido. O que NÃO
// acontece: a venda não muda de situação — ela continua CONCLUIDA, com a
// devolução pendurada. Relatório que quer o líquido desconta as devoluções
// do período; é assim que o mês de março não muda quando alguém devolve em
// abril.

import { randomInt } from 'node:crypto'
import { colunaDoDia, diaDaColuna, diaEmSP, somarDias } from './dia'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, SemPermissao, type Sessao } from './permissao'
import { mexerEstoqueEm } from './estoque'
import { expandir } from './composicao'
import { travarCaixaAberto } from './caixa'
import { centavos, reais, multiplicar } from './dinheiro'
import { desfazerTentativa, reservarTentativa } from './limite'
import { fatorPago, valorDevolvidoCent, valorDoItemCent } from './troca-conta'
import type { DestinoDevolucao } from '@prisma/client'

/** Quantos dias o vale vale. Depois disso ele não paga mais nada. */
export const VALE_DIAS = 90

/**
 * O alfabeto do código do vale: sem 0/O, 1/I/L, porque o código é lido de um
 * papel e digitado no balcão — e "VT-0O1I" não é código, é adivinhação.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Quantos símbolos tem o código novo. O vale é dinheiro ao portador: quem
 * acerta um código gasta o crédito de outra pessoa. Seis símbolos sorteados
 * com `Math.random` eram ~900 milhões de combinações num gerador previsível;
 * dez, com o sorteio do sistema operacional, são ~8 × 10¹⁴ — e a consulta do
 * balcão tem freio (ver `consultarVale`). Os de seis que já estão no papel
 * continuam valendo (`normalizarCodigo` aceita os dois).
 */
const SIMBOLOS_DO_VALE = 10

/**
 * "VT-K3M9P-2QXRT": dez símbolos em dois grupos de cinco, que é como se dita
 * e se digita sem perder o lugar. `sorteio` só para teste e demonstração (um
 * número em [0, 1), como `Math.random`); sem ele, `crypto.randomInt`.
 */
export function gerarCodigoDeVale(sorteio?: () => number): string {
  let s = ''
  for (let i = 0; i < SIMBOLOS_DO_VALE; i++) {
    s += ALFABETO[sorteio ? Math.floor(sorteio() * ALFABETO.length) : randomInt(ALFABETO.length)]
  }
  return `VT-${s.slice(0, 5)}-${s.slice(5)}`
}

/**
 * Um vale novo, dentro de uma transação já aberta: o da devolução e o da
 * troca sem a compra (troca.ts). Vale 90 dias, da loja que emitiu.
 */
export async function criarValeEm(
  db: BancoDaOrg,
  sessao: Sessao,
  p: { clienteId: string | null; unidadeId: string; valorCent: number },
): Promise<{ id: string; codigo: string; validade: Date }> {
  // Coluna `date`: o dia, contado no calendário de São Paulo e gravado à
  // meia-noite UTC, como o banco o devolve. A meia-noite LOCAL gravava o
  // dia certo só enquanto o servidor estivesse no fuso de São Paulo.
  const validade = colunaDoDia(somarDias(diaEmSP(), VALE_DIAS))
  // Código sorteado; se bater num que já existe (raro), sorteia de novo.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigoDeVale()
    const existe = await db.vale.findFirst({ where: { codigo }, select: { id: true } })
    if (existe) continue
    const criado = await db.vale.create({
      data: {
        orgId: sessao.orgId,
        codigo,
        clienteId: p.clienteId,
        unidadeId: p.unidadeId,
        valor: reais(p.valorCent),
        saldo: reais(p.valorCent),
        validade,
        quem: sessao.nome,
      },
      select: { id: true },
    })
    return { id: criado.id, codigo, validade }
  }
  throw new Error('Não deu para gerar um código de vale.')
}

/**
 * Quanto de cada item ainda pode voltar: o vendido menos o já devolvido.
 * Puro, para testar. `quantidade` e `devolvido` na mesma unidade do item.
 */
export function restante(quantidade: number, devolvido: number): number {
  return Math.max(0, Math.round((quantidade - devolvido) * 1000) / 1000)
}

/**
 * O valor que volta por um item: o preço pago × a quantidade, ajustado pelo
 * que a venda inteira teve de desconto. Mora em troca-conta.ts (puro), porque
 * a tela da troca mostra a mesma conta que a devolução grava.
 */
export { valorDevolvidoCent }

/**
 * As medidas que se CONTAM: peça, par, caixa. Nelas "1,5" não existe — meia
 * camiseta não sai da prateleira, e aceitar a fração deixava o estoque com
 * 48,5 peças e a devolução pagando meia peça de volta. Quilo, grama, litro,
 * mililitro e metro se PESAM ou MEDEM, e aí a fração é o normal.
 *
 * Mora aqui, e não em venda.ts, porque a venda já importa deste arquivo — e a
 * regra é a mesma para vender e para devolver.
 */
const MEDIDAS_CONTADAS = new Set(['UN', 'PAR', 'CX'])

export function pedeInteiro(medida: string | null | undefined): boolean {
  return MEDIDAS_CONTADAS.has(medida ?? 'UN')
}

/**
 * Trava a linha da venda até o fim da transação (`select ... for update`).
 *
 * Cancelar e devolver leem a venda, conferem o que ainda pode voltar e só
 * depois escrevem. Sem a trava, duas dessas ao mesmo tempo — o clique duplo,
 * ou duas pessoas na mesma venda — conferiam a MESMA fotografia e as duas
 * passavam: a peça voltava duas vezes ao estoque, e o dinheiro saía duas
 * vezes da gaveta. Com ela, a segunda espera a primeira e confere o que
 * sobrou.
 */
export async function travarVenda(db: Pick<BancoDaOrg, '$queryRaw'>, vendaId: string) {
  await db.$queryRaw`select id from vendas where id = ${vendaId} for update`
}

/**
 * Quanto da devolução abate o fiado da própria venda, e como fica cada
 * parcela. Puro, em centavos.
 *
 * Peça comprada no crediário e devolvida antes de ser paga não pode virar
 * dinheiro na mão do cliente nem vale: ele ainda DEVE aquela peça. O valor
 * devolvido primeiro apaga a dívida em aberto — da última parcela para a
 * primeira, que é a dívida mais longe de ser paga — e só o que sobrar vai
 * para o destino escolhido (vale, dinheiro, estorno).
 *
 * `parcelas` em qualquer ordem; a conta ordena pelo número.
 *
 * O que a parcela ainda deve é valor − pago − desconto (o desconto que a
 * gerente autorizou no recebimento abate sem dinheiro entrar). Sem o
 * desconto na conta, a parcela de R$ 100 com R$ 30 perdoados parecia dever
 * R$ 100: a devolução "abatia" R$ 100 de uma dívida de R$ 70, e os R$ 30 a
 * mais sumiam — nem vale, nem dívida.
 */
export function abaterDoFiado(
  parcelas: { id: string; numero: number; valorCent: number; pagoCent: number; descontoCent?: number }[],
  valorCent: number,
): { abatidoCent: number; parcelas: { id: string; novoValorCent: number; quitada: boolean }[] } {
  let resta = Math.max(0, valorCent)
  const mudadas: { id: string; novoValorCent: number; quitada: boolean }[] = []
  for (const p of [...parcelas].sort((a, b) => b.numero - a.numero)) {
    if (resta <= 0) break
    const abatidoAntes = p.pagoCent + Math.max(0, p.descontoCent ?? 0)
    const aberto = p.valorCent - abatidoAntes
    if (aberto <= 0) continue
    const tira = Math.min(aberto, resta)
    const novoValorCent = p.valorCent - tira
    mudadas.push({ id: p.id, novoValorCent, quitada: novoValorCent <= abatidoAntes })
    resta -= tira
  }
  return { abatidoCent: Math.max(0, valorCent) - resta, parcelas: mudadas }
}

export type PedidoDevolucao = {
  vendaId: string
  /**
   * `variacaoId` só vale para o item SEM cadastro (a venda trazida do sistema
   * anterior, o avulso): é a peça do catálogo que volta ao estoque no lugar
   * dele. Sem isto, a blusa devolvida voltava em dinheiro ou vale e sumia do
   * estoque — a gerente achava na arara uma peça que o sistema não tinha.
   * Item com cadastro volta para a variação dele, sempre.
   */
  itens: { vendaItemId: string; quantidade: number; variacaoId?: string | null }[]
  destino: DestinoDevolucao
  motivo: string
  /**
   * A loja onde a devolução ACONTECE — a de quem está no balcão. O dinheiro
   * sai do caixa aberto dela, a peça volta para o estoque dela e o vale é
   * dela. Sem ela, a loja da venda (o de sempre).
   */
  unidadeId?: string | null
}

export type ResultadoDevolucao =
  | {
      ok: true
      devolucaoId: string
      /** O que vai para o cliente: vale, dinheiro da gaveta ou estorno. */
      valor: number
      /**
       * Quanto de `valor` virou vale. Com destino VALE, tudo; com dinheiro ou
       * estorno, a parte que a compra pagou com vale (o vale volta como vale).
       */
      emVale: number
      /** O que abateu o fiado desta venda, antes de sobrar para o cliente. */
      abatido: number
      vale: { id: string; codigo: string; validade: Date } | null
    }
  | {
      ok: false
      motivo:
        | 'nao_achada'
        | 'cancelada'
        | 'saldo_importado'
        | 'sem_itens'
        | 'passa_do_vendido'
        | 'sem_motivo'
        | 'caixa_fechado'
        | 'sem_permissao'
        | 'item_repetido'
        | 'quantidade_fracionada'
        | 'item_ajuste'
    }

/** A forma do pedido, conferida antes de abrir o banco. Pura. */
function conferirPedido(
  p: PedidoDevolucao,
):
  | { ok: true; motivo: string; pedidos: PedidoDevolucao['itens'] }
  | { ok: false; motivo: 'sem_motivo' | 'sem_itens' | 'item_repetido' } {
  const motivo = String(p.motivo ?? '').trim()
  if (motivo.length < 3) return { ok: false, motivo: 'sem_motivo' }
  // Quantidade que não é número finito não é devolução — `NaN > resto` é
  // falso e passava pela conferência.
  if (p.itens.some((i) => !Number.isFinite(i.quantidade) || i.quantidade < 0)) {
    return { ok: false, motivo: 'sem_itens' }
  }
  const pedidos = p.itens.filter((i) => i.quantidade > 0)
  if (pedidos.length === 0) return { ok: false, motivo: 'sem_itens' }

  // Um item, uma linha. A conferência de baixo compara CADA linha com o que
  // resta do item: com o mesmo item repetido (dois campos `qtd-<id>` no
  // formulário montado na mão), cada linha passava sozinha — a blusa vendida
  // uma vez voltava três vezes, com três vales, três sangrias e +3 no estoque.
  if (new Set(pedidos.map((i) => i.vendaItemId)).size !== pedidos.length) {
    return { ok: false, motivo: 'item_repetido' }
  }
  return { ok: true, motivo, pedidos }
}

export async function devolver(sessao: Sessao, p: PedidoDevolucao): Promise<ResultadoDevolucao> {
  const conferido = conferirPedido(p)
  if (!conferido.ok) return { ok: false, motivo: conferido.motivo }
  return comoOrg(sessao.orgId, (db) => devolverEm(db, sessao, p))
}

/**
 * A devolução DENTRO de uma transação já aberta. É o que a troca usa
 * (troca.ts): a devolução e a venda nova na mesma transação, para a peça não
 * voltar ao estoque sem a outra sair — e o vale não nascer sem a venda que o
 * gasta.
 *
 * Toda recusa (`ok: false`) sai ANTES da primeira escrita: quem chama pode
 * devolver a recusa sem desfazer nada.
 */
export async function devolverEm(db: BancoDaOrg, sessao: Sessao, p: PedidoDevolucao): Promise<ResultadoDevolucao> {
  const conferido = conferirPedido(p)
  if (!conferido.ok) return { ok: false, motivo: conferido.motivo }
  const { motivo, pedidos } = conferido

  await travarVenda(db, p.vendaId)
  // Uma consulta por lista (pagamentos, itens, devoluções): duas listas no
  // mesmo select o Prisma busca em paralelo, e dentro da transação isso
  // avisa (e quebra no pg@9).
  const venda = await db.venda.findUnique({
    where: { id: p.vendaId },
    select: {
      id: true, numero: true, unidadeId: true, situacao: true, clienteId: true,
      subtotal: true, total: true, acrescimo: true, pontosGanhos: true, pontosUsados: true,
      unidade: { select: { nome: true } },
    },
  })
  if (!venda) return { ok: false as const, motivo: 'nao_achada' as const }
  const pagamentos = await db.pagamento.findMany({
    where: { vendaId: venda.id },
    select: { forma: true, valor: true, juros: true },
  })
  const itens = await db.vendaItem.findMany({
    where: { vendaId: venda.id },
    select: {
      id: true, variacaoId: true, descricao: true, medida: true, quantidade: true, precoUnit: true, total: true,
      devolucoes: { select: { quantidade: true } },
    },
  })
  const v = { ...venda, pagamentos, itens }
  if (v.situacao === 'CANCELADA') return { ok: false as const, motivo: 'cancelada' as const }
  // O saldo trazido do sistema anterior não tem peça para voltar: o "item"
  // dele é a dívida. Devolver aqui criaria vale ou sangria de uma venda que
  // nunca passou por este balcão.
  if (v.situacao === 'SALDO_IMPORTADO') return { ok: false as const, motivo: 'saldo_importado' as const }

  // ── onde a devolução acontece ──
  // A loja de quem está no balcão (ver `PedidoDevolucao.unidadeId`). Em outra
  // loja que não a da venda, quem devolve precisa enxergar a venda de lá —
  // e a loja daqui precisa vender (depósito não tem balcão nem gaveta).
  const onde = p.unidadeId || v.unidadeId
  const outraLoja = onde !== v.unidadeId
  let ondeNome = v.unidade.nome
  if (outraLoja) {
    const u = await db.unidade.findUnique({ where: { id: onde }, select: { nome: true, ativa: true, ehDeposito: true } })
    if (!u || !u.ativa || u.ehDeposito) return { ok: false as const, motivo: 'sem_permissao' as const }
    if (!pode(sessao, 'venda.ver', v.unidadeId)) return { ok: false as const, motivo: 'sem_permissao' as const }
    ondeNome = u.nome
  }

  // Troca (vale) é gesto de balcão. Dinheiro saindo da gaveta e estorno
  // são gestos de quem pode cancelar venda — o mesmo nível de confiança. Na
  // loja onde acontece: é a gaveta e o estoque dela que mexem.
  const precisa = p.destino === 'VALE' ? 'venda.criar' : 'venda.cancelar'
  if (!pode(sessao, precisa, onde)) return { ok: false as const, motivo: 'sem_permissao' as const }

  // ── o que ainda pode voltar ──
  const porId = new Map(v.itens.map((i) => [i.id, i]))
  for (const ped of pedidos) {
    const item = porId.get(ped.vendaItemId)
    if (!item) return { ok: false as const, motivo: 'nao_achada' as const }
    // A linha negativa do pedido do catálogo ("menos o sinal já pago") é
    // acerto de conta, não peça: não volta. Devolvê-la "valeria" um número
    // negativo e encolheria o vale das peças de verdade da mesma venda — que
    // continuam devolvíveis.
    if (centavos(item.precoUnit) < 0 || centavos(item.total) < 0) {
      return { ok: false as const, motivo: 'item_ajuste' as const }
    }
    if (pedeInteiro(item.medida) && !Number.isInteger(ped.quantidade)) {
      return { ok: false as const, motivo: 'quantidade_fracionada' as const }
    }
    const jaVoltou = item.devolucoes.reduce((s, d) => s + Number(d.quantidade), 0)
    if (ped.quantidade > restante(Number(item.quantidade), jaVoltou) + 1e-9) {
      return { ok: false as const, motivo: 'passa_do_vendido' as const }
    }
  }

  // ── a peça do catálogo, para o item sem cadastro ──
  // Conferida antes de qualquer escrita: variação que não existe (ou de
  // outra empresa — o RLS não a mostra) é recusa limpa.
  const voltaComo = new Map<string, { id: string; nome: string }>()
  const pedidasComo = [
    ...new Set(
      pedidos.filter((ped) => ped.variacaoId && !porId.get(ped.vendaItemId)!.variacaoId).map((ped) => ped.variacaoId!),
    ),
  ]
  if (pedidasComo.length > 0) {
    const vs = await db.variacao.findMany({
      where: { id: { in: pedidasComo } },
      select: { id: true, produto: { select: { nome: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } },
    })
    if (vs.length !== pedidasComo.length) return { ok: false as const, motivo: 'nao_achada' as const }
    for (const x of vs) {
      voltaComo.set(x.id, {
        id: x.id,
        nome: x.opcoes.length ? `${x.produto.nome} — ${x.opcoes.map((o) => o.opcao.valor).join(' · ')}` : x.produto.nome,
      })
    }
  }

  // ── quanto volta ──
  // O juro do crédito parcelado (quando a loja cobra) está dentro do total,
  // mas não é preço de peça: devolver a blusa não devolve juro de
  // maquininha — quem estorna o parcelamento é a operadora.
  // E o acréscimo fica de fora (ver `fatorPago`): a devolução nunca passa do
  // que a peça custou.
  const subtotalCent = centavos(v.subtotal)
  const jurosCent = v.pagamentos.reduce((s, x) => s + centavos(x.juros), 0)
  const totalCent = centavos(v.total) - jurosCent
  const fator = fatorPago(subtotalCent, totalCent, 0, centavos(v.acrescimo))

  const linhas = pedidos.map((ped) => {
    const item = porId.get(ped.vendaItemId)!
    return {
      item,
      quantidade: ped.quantidade,
      variacaoId: ped.variacaoId ?? null,
      valorCent: valorDoItemCent(centavos(item.total), Number(item.quantidade), ped.quantidade, fator),
    }
  })
  const valorCent = linhas.reduce((s, l) => s + l.valorCent, 0)
  // A parte da venda que voltou, pela etiqueta: é a régua dos pontos que o
  // cliente GASTOU nela (ver "os pontos voltam", embaixo).
  const cheioCent = linhas.reduce((s, l) => s + multiplicar(centavos(l.item.precoUnit), l.quantidade), 0)

  // ── o fiado desta venda vem primeiro ──
  // Venda no crediário com parcela em aberto: a peça devolvida ainda não foi
  // paga. Antes disto a devolução em dinheiro TIRAVA da gaveta o valor de
  // uma peça que o cliente continuava devendo — e as parcelas seguiam
  // cobrando. Agora o valor abate a dívida, e só o que sobra vai ao cliente.
  const emAberto = await db.parcela.findMany({
    where: { vendaId: v.id, quitadaEm: null },
    select: { id: true, numero: true, valor: true, pago: true, desconto: true },
  })
  const fiado = abaterDoFiado(
    emAberto.map((x) => ({
      id: x.id,
      numero: x.numero,
      valorCent: centavos(x.valor),
      pagoCent: centavos(x.pago),
      descontoCent: centavos(x.desconto),
    })),
    valorCent,
  )
  const paraClienteCent = valorCent - fiado.abatidoCent

  // ── o vale volta como vale ──
  // O que pode sair em dinheiro (ou estorno) é o que a compra recebeu FORA do
  // vale, menos o que as devoluções anteriores já tiraram por fora (o que não
  // virou vale nelas: dinheiro, estorno, abatimento do fiado). O abatimento
  // de agora vem primeiro — é dinheiro de fora também (a parcela). O resto
  // vira vale, seja qual for o destino pedido.
  const valePagoCent = v.pagamentos.filter((x) => x.forma === 'VALE').reduce((s, x) => s + centavos(x.valor), 0)
  let foraCent = 0
  if (p.destino !== 'VALE' && paraClienteCent > 0) {
    const anteriores = await db.devolucao.findMany({
      where: { vendaId: v.id },
      select: { valor: true, vale: { select: { valor: true } } },
    })
    const foraJaSaiuCent = anteriores.reduce((s, d) => s + centavos(d.valor) - centavos(d.vale?.valor ?? 0), 0)
    const foraLivreCent = Math.max(0, totalCent - valePagoCent - foraJaSaiuCent - fiado.abatidoCent)
    foraCent = Math.min(paraClienteCent, foraLivreCent)
  }
  const emValeCent = paraClienteCent - foraCent

  // ── dinheiro sai da gaveta: precisa de gaveta ──
  // A gaveta da loja onde a devolução acontece. Preso até o fim: o turno não
  // fecha no meio desta sangria.
  let caixaId: string | null = null
  if (p.destino === 'DINHEIRO' && foraCent > 0) {
    caixaId = await travarCaixaAberto(db, onde)
    if (!caixaId) return { ok: false as const, motivo: 'caixa_fechado' as const }
  }

  // ── o vale ──
  // Da loja onde a devolução acontece: com "vale por loja" ligado, só se
  // gasta nela — e é nela que a cliente está.
  const vale =
    emValeCent > 0
      ? await criarValeEm(db, sessao, { clienteId: v.clienteId, unidadeId: onde, valorCent: emValeCent })
      : null

  // ── a devolução ──
  // Contada na loja da VENDA: é lá que a receita dela está, e os relatórios
  // descontam a devolução de onde a venda entrou (ver o topo do arquivo).
  const dev = await db.devolucao.create({
    data: {
      orgId: sessao.orgId,
      vendaId: v.id,
      unidadeId: v.unidadeId,
      destino: p.destino,
      valor: reais(valorCent),
      motivo,
      quem: sessao.nome,
      usuarioId: sessao.usuarioId,
      valeId: vale?.id ?? null,
      itens: {
        create: linhas.map((l) => ({
          orgId: sessao.orgId,
          vendaItemId: l.item.id,
          quantidade: l.quantidade,
          valor: reais(l.valorCent),
        })),
      },
    },
    select: { id: true },
  })

  // ── o estoque volta ──
  // Para a variação do item; no item sem cadastro, para a peça do catálogo
  // que quem devolveu apontou (ver `PedidoDevolucao.itens`). Na loja onde a
  // devolução acontece: é lá que a peça está, na mão.
  const daLoja = outraLoja ? ` da ${v.unidade.nome}, devolvida na ${ondeNome}` : ''
  for (const l of linhas) {
    const como = !l.item.variacaoId && l.variacaoId ? voltaComo.get(l.variacaoId) : undefined
    const variacaoId = l.item.variacaoId ?? como?.id
    if (!variacaoId) continue
    // O composto (a Casquinha + Água) devolve o que leva — ver composicao.ts.
    for (const b of (await expandir(db, [{ variacaoId, quantidade: l.quantidade }])).baixas) {
      await mexerEstoqueEm(db, sessao, {
        variacaoId: b.variacaoId,
        unidadeId: onde,
        tipo: 'DEVOLUCAO',
        quantidade: b.quantidade,
        referencia: v.id,
        motivo: como
          ? `Devolução da venda ${v.numero}${daLoja} (${l.item.descricao}, sem cadastro, voltou como ${como.nome})`
          : `Devolução da venda ${v.numero}${daLoja}`,
      })
    }
  }

  // ── a dívida do fiado diminui ──
  for (const x of fiado.parcelas) {
    await db.parcela.update({
      where: { id: x.id },
      data: { valor: reais(x.novoValorCent), ...(x.quitada ? { quitadaEm: new Date() } : {}) },
    })
  }

  // ── o dinheiro sai da gaveta ──
  if (p.destino === 'DINHEIRO' && caixaId && foraCent > 0) {
    await db.caixaMovimento.create({
      data: {
        orgId: sessao.orgId,
        caixaId,
        tipo: 'SANGRIA',
        valor: reais(foraCent),
        motivo: `Devolução da venda ${v.numero}${outraLoja ? ` (${v.unidade.nome})` : ''}`,
        quem: sessao.nome,
      },
    })
  }

  // ── os pontos voltam na proporção ──
  // Nos dois sentidos, como no cancelamento. O que a venda DEU sai na
  // proporção do dinheiro que voltou. O que a venda GASTOU volta na
  // proporção da peça: numa venda de R$ 100 paga com R$ 80 e 200 pontos, o
  // dinheiro da devolução já sai com o desconto dos pontos embutido (o
  // fator total ÷ subtotal) — sem devolver os pontos, o cliente perdia os
  // 200 que usou numa peça que devolveu. Para baixo, sempre: a soma das
  // devoluções nunca passa do que foi gasto.
  const tirar =
    v.clienteId && v.pontosGanhos > 0 && totalCent > 0 ? Math.floor((v.pontosGanhos * valorCent) / totalCent) : 0
  const voltam =
    v.clienteId && v.pontosUsados > 0 && subtotalCent > 0
      ? Math.floor((v.pontosUsados * Math.min(cheioCent, subtotalCent)) / subtotalCent)
      : 0
  const deltaPontos = voltam - tirar
  if (v.clienteId && deltaPontos !== 0) {
    const depois = await db.cliente.update({
      where: { id: v.clienteId },
      data: { pontos: { increment: deltaPontos } },
      select: { pontos: true },
    })
    await db.movimentoPontos.create({
      data: {
        orgId: sessao.orgId,
        clienteId: v.clienteId,
        tipo: 'AJUSTE',
        pontos: deltaPontos,
        saldoDepois: depois.pontos,
        vendaId: v.id,
        motivo: [
          `Devolução da venda ${v.numero}`,
          voltam > 0 ? `${voltam} usados voltaram` : null,
          tirar > 0 ? `${tirar} ganhos saíram` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        quem: sessao.nome,
      },
    })
  }

  // No livro das DUAS lojas quando a devolução foi em outra: a da venda vê a
  // receita saindo; a de onde aconteceu vê a peça e o dinheiro (ou o vale).
  const textoDoLivro = [
    motivo,
    outraLoja ? `venda da ${v.unidade.nome}, devolvida na ${ondeNome}` : null,
    fiado.abatidoCent > 0 ? `${reais(fiado.abatidoCent).toFixed(2)} abatido do crediário` : null,
    foraCent > 0 ? `${reais(foraCent).toFixed(2)} ${p.destino === 'DINHEIRO' ? 'em dinheiro' : 'estorno por fora'}` : null,
    vale
      ? p.destino === 'VALE'
        ? `vale ${vale.codigo}`
        : `${reais(emValeCent).toFixed(2)} em vale ${vale.codigo} (a compra foi paga com vale)`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  for (const unidadeId of outraLoja ? [v.unidadeId, onde] : [v.unidadeId]) {
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'venda.devolveu',
        alvoTipo: 'venda',
        alvoId: v.id,
        alvoNome: `Venda ${v.numero}`,
        valor: reais(valorCent),
        motivo: textoDoLivro,
      },
    })
  }

  return {
    ok: true as const,
    devolucaoId: dev.id,
    valor: reais(paraClienteCent),
    emVale: reais(emValeCent),
    abatido: reais(fiado.abatidoCent),
    vale: vale ? { id: vale.id, codigo: vale.codigo, validade: vale.validade } : null,
  }
}

// ─────────────────────────────────────────────────────────────
// O VALE NO BALCÃO
// ─────────────────────────────────────────────────────────────

export type ValeConsultado =
  | { ok: true; id: string; codigo: string; saldo: number; cliente: string | null; validade: Date | null }
  | { ok: false; motivo: 'nao_achado' | 'zerado' | 'vencido' }
  | { ok: false; motivo: 'outra_loja'; loja: string }
  /** Código errado demais vezes seguidas: a consulta espera (ver `consultarVale`). */
  | { ok: false; motivo: 'bloqueado'; esperarMin: number; recado: string }

/**
 * Lê um vale pelo código, como o balcão faz antes de aceitar. Com a loja da
 * venda, já diz se o vale é de outra loja (regra "vale por loja") — a venda
 * confere de novo ao fechar.
 *
 * O vale é dinheiro ao portador, e esta consulta diz "existe, vale R$ X" para
 * quem digitar o código certo. Por isso:
 *   • a loja é obrigatória, e a pessoa precisa vender NELA — sem a loja, a
 *     permissão valia para "alguma loja", e qualquer acesso consultava tudo;
 *   • tem freio, o mesmo do login e do PIN (limite.ts): código que não existe
 *     conta como erro, por pessoa; cinco em 15 minutos seguram a consulta.
 *     O vale achado sai da conta, mas NÃO zera os erros de antes: senão
 *     quem chuta intercala o próprio vale entre os chutes e nunca para.
 */
export async function consultarVale(sessao: Sessao, codigo: string, unidadeId?: string): Promise<ValeConsultado> {
  if (!unidadeId) throw new SemPermissao('venda.criar')
  exigir(sessao, 'venda.criar', unidadeId)
  const c = normalizarCodigo(codigo)
  // Formato errado não gasta tentativa: é dedo, não chute (como o PIN).
  if (!c) return { ok: false, motivo: 'nao_achado' }

  const reserva = await reservarTentativa(sessao.orgId, `vale:${sessao.usuarioId}`, null)
  if (reserva.bloqueado) {
    return {
      ok: false,
      motivo: 'bloqueado',
      esperarMin: reserva.esperarMin,
      recado: `Código de vale errado muitas vezes. Espere ${reserva.esperarMin} min e tente de novo.`,
    }
  }

  const r = await consultarValeEm(sessao, c, unidadeId)
  if (r.ok || r.motivo !== 'nao_achado') await desfazerTentativa(sessao.orgId, reserva.tentativaId)
  return r
}

async function consultarValeEm(sessao: Sessao, c: string, unidadeId: string | undefined): Promise<ValeConsultado> {
  return comoOrg(sessao.orgId, async (db) => {
    const v = await db.vale.findFirst({
      where: { codigo: c },
      select: {
        id: true, codigo: true, saldo: true, validade: true, unidadeId: true,
        cliente: { select: { nome: true } },
        unidade: { select: { nome: true } },
      },
    })
    if (!v) return { ok: false as const, motivo: 'nao_achado' as const }
    if (centavos(v.saldo) <= 0) return { ok: false as const, motivo: 'zerado' as const }
    if (v.validade && venceu(v.validade)) return { ok: false as const, motivo: 'vencido' as const }
    if (unidadeId && v.unidadeId && v.unidadeId !== unidadeId) {
      const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { valePorLoja: true } })
      if (org?.valePorLoja) return { ok: false as const, motivo: 'outra_loja' as const, loja: v.unidade?.nome ?? 'outra loja' }
    }
    return {
      ok: true as const,
      id: v.id,
      codigo: v.codigo,
      saldo: reais(centavos(v.saldo)),
      cliente: v.cliente?.nome ?? null,
      validade: v.validade,
    }
  })
}

/**
 * "vt k3m9p 2qxrt" → "VT-K3M9P-2QXRT"; "vt 3f9k2a" → "VT-3F9K2A" (o código
 * de seis, de antes, continua valendo). O papel amassado não tem culpa da
 * formatação.
 */
export function normalizarCodigo(bruto: string): string | null {
  const limpo = String(bruto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const serve = (n: number) => n === 6 || n === SIMBOLOS_DO_VALE
  // Com o "VT" na frente, ou sem ele (o código que começa com VT, digitado
  // sem o prefixo, também tem de achar).
  const corpo = limpo.startsWith('VT') && serve(limpo.length - 2) ? limpo.slice(2) : serve(limpo.length) ? limpo : null
  if (!corpo) return null
  return corpo.length === 6 ? `VT-${corpo}` : `VT-${corpo.slice(0, 5)}-${corpo.slice(5)}`
}

/**
 * Vencido = a data de validade já passou (a data inteira ainda vale).
 *
 * Comparado pelo DIA no calendário de São Paulo — ver `dia.ts`. Antes a conta
 * usava o horário local sobre uma coluna `date` que chega como meia-noite UTC,
 * e o vale era recusado no balcão justamente no último dia dele.
 */
export function venceu(validade: Date, hoje = new Date()): boolean {
  return diaDaColuna(validade) < diaEmSP(hoje)
}

/** Os vales de um cliente com saldo — para a ficha e para o balcão oferecer. */
export async function valesDoCliente(sessao: Sessao, clienteId: string) {
  exigir(sessao, 'cliente.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const vales = await db.vale.findMany({
      where: { clienteId, saldo: { gt: 0 } },
      orderBy: { criadoEm: 'desc' },
      select: {
        id: true, codigo: true, saldo: true, valor: true, validade: true, criadoEm: true,
        unidadeId: true, unidade: { select: { nome: true } },
      },
    })
    return vales.map(({ unidade, ...v }) => ({
      ...v,
      loja: unidade?.nome ?? null,
      saldo: Number(v.saldo),
      valor: Number(v.valor),
      vencido: v.validade ? venceu(v.validade) : false,
    }))
  })
}

export type ValeNoBalcao = { codigo: string; saldo: number; validade: Date | null }

/**
 * Os vales que a cliente pode gastar AGORA, nesta loja: com saldo, dentro
 * da validade e (com "vale por loja") desta loja ou sem loja. É o que o
 * balcão oferece sozinho quando a cliente é escolhida — na loja ninguém
 * guarda o papel do vale, e o código amassado não pode ser o que separa a
 * cliente do crédito dela. Dentro de uma transação já aberta.
 */
export async function valesParaUsarEm(
  db: BancoDaOrg,
  clienteId: string,
  unidadeId: string,
  valePorLoja: boolean,
): Promise<ValeNoBalcao[]> {
  const vales = await db.vale.findMany({
    where: {
      clienteId,
      saldo: { gt: 0 },
      ...(valePorLoja ? { OR: [{ unidadeId }, { unidadeId: null }] } : {}),
    },
    orderBy: [{ validade: 'asc' }, { criadoEm: 'asc' }],
    select: { codigo: true, saldo: true, validade: true },
  })
  // O que vence primeiro, primeiro: é o crédito que a cliente perde antes.
  return vales
    .filter((v) => !v.validade || !venceu(v.validade))
    .map((v) => ({ codigo: v.codigo, saldo: reais(centavos(v.saldo)), validade: v.validade }))
}
