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
// R$ 100 seria a loja pagar para receber a peça de volta. O fator é
// total ÷ subtotal da venda, aplicado ao preço do item.
//
// ── o que volta e o que não volta ────────────────────────────
// O estoque volta (movimento DEVOLUCAO apontando para a venda). Os pontos
// que a venda deu voltam na proporção do que foi devolvido. O que NÃO
// acontece: a venda não muda de situação — ela continua CONCLUIDA, com a
// devolução pendurada. Relatório que quer o líquido desconta as devoluções
// do período; é assim que o mês de março não muda quando alguém devolve em
// abril.

import { colunaDoDia, diaDaColuna, diaEmSP, somarDias } from './dia'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, type Sessao } from './permissao'
import { mexerEstoqueEm } from './estoque'
import { centavos, reais, multiplicar } from './dinheiro'
import type { DestinoDevolucao } from '@prisma/client'

/** Quantos dias o vale vale. Depois disso ele não paga mais nada. */
export const VALE_DIAS = 90

/**
 * O alfabeto do código do vale: sem 0/O, 1/I/L, porque o código é lido de um
 * papel e digitado no balcão — e "VT-0O1I" não é código, é adivinhação.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function gerarCodigoDeVale(sorteio: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += ALFABETO[Math.floor(sorteio() * ALFABETO.length)]
  return `VT-${s}`
}

/**
 * Quanto de cada item ainda pode voltar: o vendido menos o já devolvido.
 * Puro, para testar. `quantidade` e `devolvido` na mesma unidade do item.
 */
export function restante(quantidade: number, devolvido: number): number {
  return Math.max(0, Math.round((quantidade - devolvido) * 1000) / 1000)
}

/**
 * O valor que volta por um item, em centavos: o preço pago × a quantidade,
 * ajustado pelo que a venda inteira teve de desconto.
 */
export function valorDevolvidoCent(
  precoUnitCent: number,
  quantidade: number,
  fatorPago: number,
): number {
  const cheio = multiplicar(precoUnitCent, quantidade)
  return Math.max(0, Math.floor(cheio * fatorPago))
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
 */
export function abaterDoFiado(
  parcelas: { id: string; numero: number; valorCent: number; pagoCent: number }[],
  valorCent: number,
): { abatidoCent: number; parcelas: { id: string; novoValorCent: number; quitada: boolean }[] } {
  let resta = Math.max(0, valorCent)
  const mudadas: { id: string; novoValorCent: number; quitada: boolean }[] = []
  for (const p of [...parcelas].sort((a, b) => b.numero - a.numero)) {
    if (resta <= 0) break
    const aberto = p.valorCent - p.pagoCent
    if (aberto <= 0) continue
    const tira = Math.min(aberto, resta)
    const novoValorCent = p.valorCent - tira
    mudadas.push({ id: p.id, novoValorCent, quitada: novoValorCent <= p.pagoCent })
    resta -= tira
  }
  return { abatidoCent: Math.max(0, valorCent) - resta, parcelas: mudadas }
}

export type PedidoDevolucao = {
  vendaId: string
  itens: { vendaItemId: string; quantidade: number }[]
  destino: DestinoDevolucao
  motivo: string
}

export type ResultadoDevolucao =
  | {
      ok: true
      devolucaoId: string
      /** O que vai para o cliente: vale, dinheiro da gaveta ou estorno. */
      valor: number
      /** O que abateu o fiado desta venda, antes de sobrar para o cliente. */
      abatido: number
      vale: { codigo: string; validade: Date } | null
    }
  | { ok: false; motivo: 'nao_achada' | 'cancelada' | 'sem_itens' | 'passa_do_vendido' | 'sem_motivo' | 'caixa_fechado' | 'sem_permissao' }

export async function devolver(sessao: Sessao, p: PedidoDevolucao): Promise<ResultadoDevolucao> {
  const motivo = p.motivo.trim()
  if (motivo.length < 3) return { ok: false, motivo: 'sem_motivo' }
  const pedidos = p.itens.filter((i) => i.quantidade > 0)
  if (pedidos.length === 0) return { ok: false, motivo: 'sem_itens' }

  return comoOrg(sessao.orgId, async (db) => {
    await travarVenda(db, p.vendaId)
    const v = await db.venda.findUnique({
      where: { id: p.vendaId },
      select: {
        id: true, numero: true, unidadeId: true, situacao: true, clienteId: true,
        subtotal: true, total: true, pontosGanhos: true,
        itens: {
          select: {
            id: true, variacaoId: true, descricao: true, quantidade: true, precoUnit: true,
            devolucoes: { select: { quantidade: true } },
          },
        },
      },
    })
    if (!v) return { ok: false as const, motivo: 'nao_achada' as const }
    if (v.situacao === 'CANCELADA') return { ok: false as const, motivo: 'cancelada' as const }

    // Troca (vale) é gesto de balcão. Dinheiro saindo da gaveta e estorno
    // são gestos de quem pode cancelar venda — o mesmo nível de confiança.
    const precisa = p.destino === 'VALE' ? 'venda.criar' : 'venda.cancelar'
    if (!pode(sessao, precisa, v.unidadeId)) return { ok: false as const, motivo: 'sem_permissao' as const }

    // ── o que ainda pode voltar ──
    const porId = new Map(v.itens.map((i) => [i.id, i]))
    for (const ped of pedidos) {
      const item = porId.get(ped.vendaItemId)
      if (!item) return { ok: false as const, motivo: 'nao_achada' as const }
      const jaVoltou = item.devolucoes.reduce((s, d) => s + Number(d.quantidade), 0)
      if (ped.quantidade > restante(Number(item.quantidade), jaVoltou) + 1e-9) {
        return { ok: false as const, motivo: 'passa_do_vendido' as const }
      }
    }

    // ── quanto volta ──
    const subtotalCent = centavos(v.subtotal)
    const totalCent = centavos(v.total)
    const fator = subtotalCent > 0 ? totalCent / subtotalCent : 1

    const linhas = pedidos.map((ped) => {
      const item = porId.get(ped.vendaItemId)!
      return {
        item,
        quantidade: ped.quantidade,
        valorCent: valorDevolvidoCent(centavos(item.precoUnit), ped.quantidade, fator),
      }
    })
    const valorCent = linhas.reduce((s, l) => s + l.valorCent, 0)

    // ── o fiado desta venda vem primeiro ──
    // Venda no crediário com parcela em aberto: a peça devolvida ainda não foi
    // paga. Antes disto a devolução em dinheiro TIRAVA da gaveta o valor de
    // uma peça que o cliente continuava devendo — e as parcelas seguiam
    // cobrando. Agora o valor abate a dívida, e só o que sobra vai ao cliente.
    const emAberto = await db.parcela.findMany({
      where: { vendaId: v.id, quitadaEm: null },
      select: { id: true, numero: true, valor: true, pago: true },
    })
    const fiado = abaterDoFiado(
      emAberto.map((x) => ({ id: x.id, numero: x.numero, valorCent: centavos(x.valor), pagoCent: centavos(x.pago) })),
      valorCent,
    )
    const paraClienteCent = valorCent - fiado.abatidoCent

    // ── dinheiro sai da gaveta: precisa de gaveta ──
    let caixaId: string | null = null
    if (p.destino === 'DINHEIRO' && paraClienteCent > 0) {
      const caixa = await db.caixa.findFirst({
        where: { unidadeId: v.unidadeId, aberto: true },
        select: { id: true },
      })
      if (!caixa) return { ok: false as const, motivo: 'caixa_fechado' as const }
      caixaId = caixa.id
    }

    // ── o vale ──
    let vale: { id: string; codigo: string; validade: Date } | null = null
    if (p.destino === 'VALE' && paraClienteCent > 0) {
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
            clienteId: v.clienteId,
            valor: reais(paraClienteCent),
            saldo: reais(paraClienteCent),
            validade,
            quem: sessao.nome,
          },
          select: { id: true },
        })
        vale = { id: criado.id, codigo, validade }
        break
      }
      if (!vale) throw new Error('Não deu para gerar um código de vale.')
    }

    // ── a devolução ──
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
    for (const l of linhas) {
      if (!l.item.variacaoId) continue
      await mexerEstoqueEm(db, sessao, {
        variacaoId: l.item.variacaoId,
        unidadeId: v.unidadeId,
        tipo: 'DEVOLUCAO',
        quantidade: l.quantidade,
        referencia: v.id,
        motivo: `Devolução da venda ${v.numero}`,
      })
    }

    // ── a dívida do fiado diminui ──
    for (const x of fiado.parcelas) {
      await db.parcela.update({
        where: { id: x.id },
        data: { valor: reais(x.novoValorCent), ...(x.quitada ? { quitadaEm: new Date() } : {}) },
      })
    }

    // ── o dinheiro sai da gaveta ──
    if (p.destino === 'DINHEIRO' && caixaId && paraClienteCent > 0) {
      await db.caixaMovimento.create({
        data: {
          orgId: sessao.orgId,
          caixaId,
          tipo: 'SANGRIA',
          valor: reais(paraClienteCent),
          motivo: `Devolução da venda ${v.numero}`,
          quem: sessao.nome,
        },
      })
    }

    // ── os pontos voltam na proporção ──
    if (v.clienteId && v.pontosGanhos > 0 && totalCent > 0) {
      const tirar = Math.floor((v.pontosGanhos * valorCent) / totalCent)
      if (tirar > 0) {
        const depois = await db.cliente.update({
          where: { id: v.clienteId },
          data: { pontos: { decrement: tirar } },
          select: { pontos: true },
        })
        await db.movimentoPontos.create({
          data: {
            orgId: sessao.orgId,
            clienteId: v.clienteId,
            tipo: 'AJUSTE',
            pontos: -tirar,
            saldoDepois: depois.pontos,
            vendaId: v.id,
            motivo: `Devolução da venda ${v.numero}`,
            quem: sessao.nome,
          },
        })
      }
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: v.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'venda.devolveu',
        alvoTipo: 'venda',
        alvoId: v.id,
        alvoNome: `Venda ${v.numero}`,
        valor: reais(valorCent),
        motivo: [
          motivo,
          fiado.abatidoCent > 0 ? `${reais(fiado.abatidoCent).toFixed(2)} abatido do crediário` : null,
          paraClienteCent > 0
            ? p.destino === 'VALE' ? `vale ${vale!.codigo}` : p.destino === 'DINHEIRO' ? 'em dinheiro' : 'estorno por fora'
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      },
    })

    return {
      ok: true as const,
      devolucaoId: dev.id,
      valor: reais(paraClienteCent),
      abatido: reais(fiado.abatidoCent),
      vale: vale ? { codigo: vale.codigo, validade: vale.validade } : null,
    }
  })
}

// ─────────────────────────────────────────────────────────────
// O VALE NO BALCÃO
// ─────────────────────────────────────────────────────────────

export type ValeConsultado =
  | { ok: true; id: string; codigo: string; saldo: number; cliente: string | null; validade: Date | null }
  | { ok: false; motivo: 'nao_achado' | 'zerado' | 'vencido' }

/** Lê um vale pelo código, como o balcão faz antes de aceitar. */
export async function consultarVale(sessao: Sessao, codigo: string): Promise<ValeConsultado> {
  exigir(sessao, 'venda.criar')
  const c = normalizarCodigo(codigo)
  if (!c) return { ok: false, motivo: 'nao_achado' }

  return comoOrg(sessao.orgId, async (db) => {
    const v = await db.vale.findFirst({
      where: { codigo: c },
      select: {
        id: true, codigo: true, saldo: true, validade: true,
        cliente: { select: { nome: true } },
      },
    })
    if (!v) return { ok: false as const, motivo: 'nao_achado' as const }
    if (centavos(v.saldo) <= 0) return { ok: false as const, motivo: 'zerado' as const }
    if (v.validade && venceu(v.validade)) return { ok: false as const, motivo: 'vencido' as const }
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

/** "vt 3f9k2a" → "VT-3F9K2A". O papel amassado não tem culpa da formatação. */
export function normalizarCodigo(bruto: string): string | null {
  const limpo = bruto.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const corpo = limpo.startsWith('VT') ? limpo.slice(2) : limpo
  if (corpo.length !== 6) return null
  return `VT-${corpo}`
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
      select: { id: true, codigo: true, saldo: true, valor: true, validade: true, criadoEm: true },
    })
    return vales.map((v) => ({
      ...v,
      saldo: Number(v.saldo),
      valor: Number(v.valor),
      vencido: v.validade ? venceu(v.validade) : false,
    }))
  })
}
