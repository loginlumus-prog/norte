// Receber o crediário de uma vez: várias parcelas, várias formas, um recibo.
//
// ── o que muda em relação a receber uma parcela por vez ──────
// A cliente chega com o carnê e diz "vim pagar as atrasadas" — três parcelas
// de duas compras, metade no Pix, metade em dinheiro. Antes eram três
// recebimentos digitados um a um, sem papel nenhum no fim. Aqui é UMA
// operação, numa transação só: ou entra tudo, ou nada; e sai UM recibo, com o
// que foi pago, o atraso, o desconto, o que ela ainda deve e quem recebeu.
//
// ── a conta ──────────────────────────────────────────────────
// É a de recibos-conta.ts (pura): a tela faz a mesma, para mostrar; aqui ela é
// refeita com o banco travado e é esta que vale. Se a conta de agora der outra
// que a da tela (virou o dia, outro caixa recebeu), recusa — a cliente não
// pode levar papel com número que a tela não mostrou.
//
// ── o dinheiro ───────────────────────────────────────────────
// Todo recebimento entra no turno ABERTO da loja, em qualquer forma: o
// dinheiro na conta da gaveta, o cartão e o Pix no fechamento, para conferir
// a maquininha (ver caixa.ts). Dinheiro sem caixa aberto é recusado — ele
// entraria numa gaveta que ninguém vai contar.
//
// ── perdão e desconto ────────────────────────────────────────
// Cobrar menos atraso do que a conta pede, ou dar desconto no valor, é dar
// dinheiro da loja. Só quem negocia o crediário (`crediario.cobrar` — a
// gerente, a dona) faz direto; a vendedora pede a autorização na hora, com o
// PIN de quem pode (autorizacao.ts). Fica escrito no recibo e no livro quem
// autorizou e por quê.
//
// ── "já pagou fora" ──────────────────────────────────────────
// A loja continua com o sistema antigo para a nota fiscal, e às vezes a
// cliente paga lá. A baixa externa acerta a dívida aqui com a referência de
// lá — sem entrar no caixa, no DRE nem nas metas (o dinheiro não passou por
// aqui; contar seria contar duas vezes). É de quem negocia o crediário.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { colunaDoDia, diaDaColuna, diaEmSP, diasEntre } from './dia'
import { travarVenda } from './devolucao'
import { travarCaixaAberto } from './caixa'
import { lerTaxas, taxaDe } from './taxas'
import { assinarExcecao, autorizarComPin } from './autorizacao'
import { maquininhasNoBanco } from './maquininhas'
import {
  contaDasMarcadas,
  encargosDeHoje,
  explicarRecusa,
  planejarRecebimento,
  repartirNasFormas,
  temMaquininha,
  type ParcelaParaReceber,
  type RegraAtraso,
} from './recibos-conta'
import type { FormaPagamento } from '@prisma/client'

/** As formas de receber parcela. Crediário e vale não pagam crediário. */
export const FORMAS_DE_RECEBER: FormaPagamento[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA']

const brlC = (c: number) => reais(c).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ─────────────────────────────────────────────────────────────
// LER
// ─────────────────────────────────────────────────────────────

export async function regraDoAtraso(db: BancoDaOrg, orgId: string): Promise<RegraAtraso> {
  const o = await db.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { crediarioJurosMes: true, crediarioMultaPct: true, crediarioCarenciaDias: true, crediarioArredondar: true },
  })
  return {
    jurosMes: Number(o.crediarioJurosMes),
    multaPct: Number(o.crediarioMultaPct),
    carenciaDias: o.crediarioCarenciaDias,
    arredondar: o.crediarioArredondar,
  }
}

export type ParcelaDoCarne = ParcelaParaReceber & {
  vendaId: string
  vendaNumero: number
  /** "AAAA-MM-DD" do dia da compra (São Paulo). */
  vendaDia: string
  /** Saldo trazido do sistema anterior: o "título" de lá. */
  importada: boolean
  numero: number
  de: number
  /** "AAAA-MM-DD" */
  vencimento: string
  valorC: number
  pagoC: number
  descontoC: number
  dias: number
  diasJuros: number
}

/**
 * As parcelas em aberto da cliente NESTA loja, da mais antiga para a mais
 * nova, com o atraso de hoje. Cada loja é um credor (CNPJ próprio): o recibo
 * de uma não abate a dívida da outra.
 */
async function parcelasAbertas(
  db: BancoDaOrg,
  clienteId: string,
  unidadeId: string,
  regra: RegraAtraso,
  agora: Date,
): Promise<ParcelaDoCarne[]> {
  const linhas = await db.parcela.findMany({
    where: { clienteId, unidadeId, quitadaEm: null },
    orderBy: [{ vencimento: 'asc' }, { venda: { numero: 'asc' } }, { numero: 'asc' }, { id: 'asc' }],
    select: {
      id: true, vendaId: true, numero: true, de: true, vencimento: true, valor: true, pago: true, desconto: true,
      jurosAte: true, multaCobrada: true,
      venda: { select: { numero: true, criadaEm: true, situacao: true } },
    },
  })
  const saida: ParcelaDoCarne[] = []
  for (const p of linhas) {
    const valorC = centavos(p.valor)
    const pagoC = centavos(p.pago)
    const descontoC = centavos(p.desconto)
    const restaC = valorC - pagoC - descontoC
    if (restaC <= 0) continue
    const e = encargosDeHoje({ restaC, vencimento: p.vencimento, jurosAte: p.jurosAte, multaCobrada: p.multaCobrada }, regra, agora)
    saida.push({
      id: p.id,
      vendaId: p.vendaId,
      vendaNumero: p.venda.numero,
      vendaDia: diaEmSP(p.venda.criadaEm),
      importada: p.venda.situacao === 'SALDO_IMPORTADO',
      numero: p.numero,
      de: p.de,
      vencimento: diaDaColuna(p.vencimento),
      valorC,
      pagoC,
      descontoC,
      restaC,
      dias: e.dias,
      diasJuros: e.diasJuros,
      multaC: e.multaC,
      jurosC: e.jurosC,
    })
  }
  return saida
}

export type Maquininha = { nome: string; formas: string[] }

export type FichaParaReceber = {
  cliente: { id: string; nome: string; documento: string | null; telefone: string | null }
  unidade: { id: string; nome: string }
  regra: RegraAtraso
  parcelas: ParcelaDoCarne[]
  /** O que ela deve nas OUTRAS lojas que a pessoa enxerga — só para avisar. */
  outrasLojas: { unidadeId: string; nome: string; devendoC: number; vencidoC: number }[]
  caixaAberto: boolean
  /** Pode perdoar e dar desconto sem pedir PIN, e dar baixa externa. */
  negocia: boolean
  maquininhas: Maquininha[]
  /** "AAAA-MM-DD" de hoje em São Paulo — o dia da conta. */
  hoje: string
}

export async function fichaParaReceber(
  sessao: Sessao,
  clienteId: string,
  unidadeId: string,
  agora = new Date(),
): Promise<FichaParaReceber | null> {
  exigir(sessao, 'crediario.receber', unidadeId)
  const vis = unidadesQuePodem(sessao, 'crediario.ver')
  const todas = vis === 'todas'
  const outras = todas ? [] : vis.filter((u) => u !== unidadeId)
  return comoOrg(sessao.orgId, async (db) => {
    const cliente = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, nome: true, documento: true, telefone: true },
    })
    const unidade = await db.unidade.findUnique({ where: { id: unidadeId }, select: { id: true, nome: true } })
    if (!cliente || !unidade) return null
    const regra = await regraDoAtraso(db, sessao.orgId)
    const parcelas = await parcelasAbertas(db, clienteId, unidadeId, regra, agora)
    const hoje = colunaDoDia(diaEmSP(agora))
    const outrasLinhas = todas || outras.length
      ? await db.$queryRaw<{ unidade_id: string; nome: string; devendo: string; vencido: string }[]>`
          select p.unidade_id, u.nome,
                 sum(p.valor - p.pago - p.desconto) as devendo,
                 coalesce(sum(p.valor - p.pago - p.desconto) filter (where p.vencimento < ${hoje}), 0) as vencido
            from parcelas p join unidades u on u.id = p.unidade_id
           where p.cliente_id = ${clienteId} and p.quitada_em is null and p.unidade_id <> ${unidadeId}
             and (${todas} or p.unidade_id = any(${todas ? [unidadeId] : outras}))
           group by 1, 2
          having sum(p.valor - p.pago - p.desconto) > 0
           order by 2`
      : []
    const caixa = await db.caixa.findFirst({ where: { unidadeId, aberto: true }, select: { id: true } })
    const maquininhas = (await maquininhasNoBanco(db, unidadeId)).map((m) => ({ nome: m.nome, formas: [...m.formas] as string[] }))
    return {
      cliente,
      unidade,
      regra,
      parcelas,
      outrasLojas: outrasLinhas.map((l) => ({
        unidadeId: l.unidade_id,
        nome: l.nome,
        devendoC: centavos(l.devendo),
        vencidoC: centavos(l.vencido),
      })),
      caixaAberto: !!caixa,
      negocia: pode(sessao, 'crediario.cobrar', unidadeId),
      maquininhas,
      hoje: diaEmSP(agora),
    }
  })
}

/** Quem tem crediário em aberto nesta loja, pelo nome, telefone ou CPF — o "veio só pagar". */
export async function procurarDevedores(
  sessao: Sessao,
  termo: string,
  unidadeId: string,
  agora = new Date(),
): Promise<{ id: string; nome: string; telefone: string | null; devendoC: number; vencidoC: number }[]> {
  exigir(sessao, 'crediario.receber', unidadeId)
  const t = (termo ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const digitos = t.replace(/\D/g, '')
  if (t.length < 2) return []
  const hoje = colunaDoDia(diaEmSP(agora))
  const nome = `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.$queryRaw<{ id: string; nome: string; telefone: string | null; devendo: string; vencido: string }[]>`
      select c.id, c.nome, c.telefone,
             sum(p.valor - p.pago - p.desconto) as devendo,
             coalesce(sum(p.valor - p.pago - p.desconto) filter (where p.vencimento < ${hoje}), 0) as vencido
        from parcelas p join clientes c on c.id = p.cliente_id
       where p.unidade_id = ${unidadeId} and p.quitada_em is null
         and (c.nome ilike ${nome}
              or (${digitos.length >= 4} and (regexp_replace(coalesce(c.telefone, ''), '\\D', '', 'g') like ${`%${digitos}%`}
                                           or regexp_replace(coalesce(c.documento, ''), '\\D', '', 'g') like ${`%${digitos}%`})))
       group by c.id, c.nome, c.telefone
      having sum(p.valor - p.pago - p.desconto) > 0
       order by 5 desc, 4 desc, c.nome
       limit 12`,
  )
  return linhas.map((l) => ({ id: l.id, nome: l.nome, telefone: l.telefone, devendoC: centavos(l.devendo), vencidoC: centavos(l.vencido) }))
}

// ─────────────────────────────────────────────────────────────
// RECEBER
// ─────────────────────────────────────────────────────────────

export type FormaPedida = { forma: FormaPagamento; valor: number; maquininha?: string | null }

export type PedidoDeRecibo = {
  clienteId: string
  unidadeId: string
  /** As parcelas marcadas. Vazio = abate das mais antigas. */
  parcelaIds: string[]
  /** Como entrou o dinheiro (o que FICA — sem o troco). */
  formas: FormaPedida[]
  /** O que a cliente entregou em dinheiro, para o troco. */
  entregue?: number | null
  perdoarAtraso?: boolean
  /** Perdoar parte do atraso, em R$. */
  descontoAtraso?: number
  /** Desconto no valor das marcadas, em R$. */
  desconto?: number
  /** O total das marcadas que a tela mostrou (com o atraso). */
  esperado?: number | null
  /** PIN de quem autoriza, quando quem recebe não pode dar desconto. */
  autorizacao?: { pin: string } | null
  /** Por que o desconto ou o perdão. */
  motivo?: string | null
  /**
   * Não arredonda o atraso para cima, mesmo com a regra da empresa ligada.
   * É o caminho de uma parcela só (`receberParcela`): quem chama já diz
   * quanto do total é atraso, e esse número é o do atraso sem arredondar —
   * com o arredondamento por cima, os centavos dele saíam do VALOR da parcela
   * e ela ficava aberta com R$ 0,04 dizendo "quitada".
   */
  semArredondar?: boolean
}

export type ResultadoDoRecibo =
  | { ok: true; reciboId: string; saldoDepois: number; quitou: boolean; troco: number; recebido: number }
  /** `precisaPin`: a exceção pede a assinatura de quem faz (ver `assinarExcecao`). */
  | { ok: false; erro: string; precisaPin?: true }

class Recusa extends Error {}

const MUDOU = 'Alguma parcela mudou agora (outro recebimento, uma devolução ou virou o dia). Nada foi recebido: confira os valores e receba de novo.'

/** Limpa o texto do motivo (livro de auditoria e papel). */
const limparTexto = (s: string | null | undefined, max = 200) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Quem autoriza o desconto/perdão: a própria pessoa, se negocia o crediário
 * nesta loja; senão, quem digitou o PIN. Fora de qualquer transação — a
 * conferência do PIN abre a dela (e conta as tentativas).
 */
async function quemAutoriza(
  sessao: Sessao,
  unidadeId: string,
  pin: string | null | undefined,
  motivo: string,
): Promise<{ ok: true; usuarioId: string; nome: string } | { ok: false; erro: string }> {
  if (pode(sessao, 'crediario.cobrar', unidadeId)) return { ok: true, usuarioId: sessao.usuarioId, nome: sessao.nome }
  if (!pin) return { ok: false, erro: 'Desconto e perdão do atraso precisam da autorização de quem negocia o crediário: peça o PIN da gerente.' }
  const r = await autorizarComPin({
    orgId: sessao.orgId,
    unidadeId,
    pin,
    capacidade: 'crediario.cobrar',
    motivo,
    quemPediu: { usuarioId: sessao.usuarioId, nome: sessao.nome },
  })
  return r.ok ? { ok: true, usuarioId: r.autorizador.usuarioId, nome: r.autorizador.nome } : { ok: false, erro: r.erro }
}

export async function receberVarias(sessao: Sessao, p: PedidoDeRecibo, agora = new Date()): Promise<ResultadoDoRecibo> {
  exigir(sessao, 'crediario.receber', p.unidadeId)

  // ── o pedido, antes de tocar no banco ──
  const formas = (p.formas ?? []).filter((f) => f && Number.isFinite(f.valor) && f.valor > 0)
  if (formas.length === 0) return { ok: false, erro: 'Diga quanto ela está pagando e como.' }
  if (formas.length > 4) return { ok: false, erro: 'Divida em até quatro formas.' }
  if (formas.some((f) => !FORMAS_DE_RECEBER.includes(f.forma))) return { ok: false, erro: 'Crediário se recebe em dinheiro, Pix, cartão ou transferência.' }
  const formasC: { forma: string; valorC: number; maquininha: string | null }[] = formas.map((f) => ({
    forma: f.forma as string,
    valorC: centavos(f.valor),
    maquininha: limparTexto(f.maquininha, 60) || null,
  }))
  const dinheiroC = formasC.filter((f) => f.forma === 'DINHEIRO').reduce((s, f) => s + f.valorC, 0)
  const totalC = formasC.reduce((s, f) => s + f.valorC, 0)
  let trocoC = 0
  if (p.entregue !== null && p.entregue !== undefined) {
    if (!Number.isFinite(p.entregue)) return { ok: false, erro: 'Não deu para ler o valor entregue.' }
    const entregueC = centavos(p.entregue)
    if (dinheiroC === 0) return { ok: false, erro: 'Troco é só para pagamento em dinheiro.' }
    if (entregueC < dinheiroC) return { ok: false, erro: `Ela entregou menos que a parte em dinheiro (${brlC(dinheiroC)}).` }
    trocoC = entregueC - dinheiroC
  }
  const numero = (v: unknown) => (Number.isFinite(v as number) ? Math.max(0, centavos(v as number)) : 0)
  const descontoAtrasoC = numero(p.descontoAtraso)
  const descontoC = numero(p.desconto)
  const negociou = !!p.perdoarAtraso || descontoAtrasoC > 0 || descontoC > 0
  const motivo = limparTexto(p.motivo)

  let autorizador: { usuarioId: string; nome: string } | null = null
  if (negociou) {
    if (motivo.length < 3) return { ok: false, erro: 'Diga o motivo do desconto ou do perdão (fica no recibo e no livro).' }
    const a = await quemAutoriza(sessao, p.unidadeId, p.autorizacao?.pin, motivo)
    if (!a.ok) return { ok: false, erro: a.erro }
    autorizador = { usuarioId: a.usuarioId, nome: a.nome }
  }

  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const cliente = await db.cliente.findUnique({ where: { id: p.clienteId }, select: { id: true, nome: true } })
      if (!cliente) throw new Recusa('Cliente não encontrado.')

      // Trava as vendas de TODAS as parcelas abertas dela nesta loja — o
      // dinheiro pode cair em qualquer uma (a sobra vai para as mais antigas).
      // Em ordem de id: duas transações travando as mesmas vendas na mesma
      // ordem não se prendem uma na outra.
      const vendas = await db.parcela.findMany({
        where: { clienteId: p.clienteId, unidadeId: p.unidadeId, quitadaEm: null },
        distinct: ['vendaId'],
        select: { vendaId: true },
      })
      for (const id of vendas.map((v) => v.vendaId).sort()) await travarVenda(db, id)

      // As maquininhas da loja: a escolhida tem de ser dela e aceitar a
      // forma; loja com uma só para a forma dispensa a pergunta.
      if (formasC.some((f) => temMaquininha(f.forma))) {
        const lista = await maquininhasNoBanco(db, p.unidadeId)
        for (const f of formasC) {
          if (!temMaquininha(f.forma)) continue
          const daForma = lista.filter((m) => (m.formas as string[]).includes(f.forma))
          if (f.maquininha && !daForma.some((m) => m.nome === f.maquininha)) {
            throw new Recusa(`"${f.maquininha}" não é maquininha desta loja para esta forma.`)
          }
          if (!f.maquininha && daForma.length === 1) f.maquininha = daForma[0]!.nome
        }
      }
      for (const f of formasC) if (!temMaquininha(f.forma)) f.maquininha = null

      const regra = await regraDoAtraso(db, sessao.orgId)
      const arredondar = regra.arredondar && !p.semArredondar
      const abertas = await parcelasAbertas(db, p.clienteId, p.unidadeId, regra, agora)
      if (abertas.length === 0) throw new Recusa('Ela não deve nada nesta loja.')
      const marcadas = [...new Set(p.parcelaIds ?? [])]
      if (marcadas.some((id) => !abertas.some((a) => a.id === id))) throw new Recusa(MUDOU)

      if (p.esperado !== null && p.esperado !== undefined && marcadas.length > 0) {
        const conta = contaDasMarcadas(abertas, marcadas, arredondar)
        if (!Number.isFinite(p.esperado) || centavos(p.esperado) !== conta.totalC) throw new Recusa(MUDOU)
      }

      const plano = planejarRecebimento(abertas, {
        marcadas,
        dinheiroC: totalC,
        perdoarAtraso: p.perdoarAtraso,
        descontoAtrasoC,
        descontoC,
        arredondar,
      })
      if (!plano.ok) throw new Recusa(explicarRecusa(plano, brlC))
      if (negociou && plano.perdoadoC === 0 && plano.descontoC === 0) autorizador = null

      // O turno fica preso até o fim: nada cai num caixa que outro tablet
      // está fechando neste segundo. Dinheiro sem caixa aberto não entra.
      const caixaId = await travarCaixaAberto(db, p.unidadeId)
      if (dinheiroC > 0 && !caixaId) {
        throw new Recusa('Para receber em dinheiro o caixa desta loja precisa estar aberto. Abra o caixa — ou escolha Pix, cartão ou transferência.')
      }
      const taxas = formasC.some((f) => temMaquininha(f.forma)) ? await lerTaxas(db) : []

      const saldoAntesC = abertas.reduce((s, a) => s + a.restaC, 0)
      const abateC = plano.principalC + plano.descontoC
      const saldoDepoisC = saldoAntesC - abateC

      const comoEstavam = await fotoDasParcelas(db, plano.linhas.map((l) => l.id))
      const recibo = await db.reciboCrediario.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: p.unidadeId,
          clienteId: p.clienteId,
          caixaId,
          valor: reais(plano.dinheiroC),
          juros: reais(plano.jurosC),
          multa: reais(plano.multaC),
          desconto: reais(plano.descontoC),
          perdoado: reais(plano.perdoadoC),
          troco: reais(trocoC),
          saldoAntes: reais(saldoAntesC),
          saldoDepois: reais(saldoDepoisC),
          quemId: sessao.usuarioId,
          quem: sessao.nome,
          autorizadoPorId: autorizador?.usuarioId ?? null,
          autorizadoPor: autorizador?.nome ?? null,
          motivo: autorizador ? motivo : null,
          criadoEm: agora,
        },
        select: { id: true },
      })

      await gravarParcelas(db, abertas, plano.linhas, agora)

      const pedacos = repartirNasFormas(plano.linhas, formasC)
      await db.recebimento.createMany({
        data: pedacos.map((x) => ({
          orgId: sessao.orgId,
          parcelaId: x.parcelaId,
          caixaId,
          reciboId: recibo.id,
          forma: x.forma as FormaPagamento,
          valor: reais(x.valorC),
          juros: reais(x.jurosC),
          multa: reais(x.multaC),
          desconto: reais(x.descontoC),
          maquininha: x.maquininha,
          taxaPct: temMaquininha(x.forma) ? taxaDe(taxas, x.forma as FormaPagamento, 1) : null,
          quem: sessao.nome,
          criadoEm: agora,
        })),
      })

      const extras = [
        plano.multaC > 0 ? `multa ${reais(plano.multaC).toFixed(2)}` : '',
        plano.jurosC > 0 ? `juros ${reais(plano.jurosC).toFixed(2)}` : '',
        plano.perdoadoC > 0 ? `atraso perdoado ${reais(plano.perdoadoC).toFixed(2)}` : '',
        plano.descontoC > 0 ? `desconto ${reais(plano.descontoC).toFixed(2)}` : '',
        autorizador ? `autorizado por ${autorizador.nome}: ${motivo}` : '',
      ].filter(Boolean)
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: p.unidadeId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'crediario.recebeu',
          alvoTipo: 'cliente',
          alvoId: cliente.id,
          alvoNome: cliente.nome,
          valor: reais(plano.dinheiroC),
          motivo: [quaisParcelas(abertas, plano.linhas), ...extras, saldoDepoisC === 0 ? 'quitou' : `ainda deve ${reais(saldoDepoisC).toFixed(2)}`]
            .join(' · ')
            .slice(0, 300),
          antes: { parcelas: comoEstavam },
          depois: { reciboId: recibo.id, formas: formasC.map((f) => ({ forma: f.forma, valor: reais(f.valorC), maquininha: f.maquininha })) },
        },
      })

      return {
        ok: true as const,
        reciboId: recibo.id,
        saldoDepois: reais(saldoDepoisC),
        quitou: saldoDepoisC === 0,
        troco: reais(trocoC),
        recebido: reais(plano.dinheiroC),
      }
    })
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.message }
    throw e
  }
}

/** "venda 12 (1/3, 2/3) · venda 15 (1/1)" — para o livro. */
function quaisParcelas(abertas: ParcelaDoCarne[], linhas: { id: string }[]): string {
  const porVenda = new Map<number, string[]>()
  for (const l of linhas) {
    const a = abertas.find((x) => x.id === l.id)!
    porVenda.set(a.vendaNumero, [...(porVenda.get(a.vendaNumero) ?? []), `${a.numero}/${a.de}`])
  }
  return [...porVenda].map(([n, ps]) => `venda ${n} (${ps.join(', ')})`).join(' · ')
}

/**
 * Grava cada parcela do plano — ANTES dos recebimentos, e só se ela ainda
 * estiver como foi lida (`pago`, `valor` e `desconto`). O clique duplo, ou
 * duas pessoas recebendo da mesma cliente, liam o mesmo `pago`: sem a
 * condição nasciam dois recebimentos e a parcela abatia uma vez. Com ela, o
 * segundo não acha a linha como estava e desiste — a transação inteira volta.
 */
async function gravarParcelas(
  db: BancoDaOrg,
  abertas: ParcelaDoCarne[],
  linhas: { id: string; principalC: number; descontoC: number; jurosC: number; multaC: number; quita: boolean; atrasoResolvido: boolean }[],
  agora: Date,
  externo?: { pagoEm: string },
) {
  const hoje = diaEmSP(agora)
  for (const l of linhas) {
    const a = abertas.find((x) => x.id === l.id)!
    const atrasada = externo ? externo.pagoEm > a.vencimento : l.atrasoResolvido
    const gravou = await db.parcela.updateMany({
      where: { id: a.id, pago: reais(a.pagoC), valor: reais(a.valorC), desconto: reais(a.descontoC), quitadaEm: null },
      data: {
        pago: reais(a.pagoC + l.principalC),
        desconto: reais(a.descontoC + l.descontoC),
        juros: { increment: reais(l.jurosC) },
        multa: { increment: reais(l.multaC) },
        // O atraso que havia hoje ficou resolvido — cobrado, ou perdoado por
        // quem autorizou. A multa não volta; o juro conta de hoje em diante.
        // Na baixa externa, resolvido lá fora no dia em que ela pagou.
        ...(atrasada ? { multaCobrada: true, jurosAte: colunaDoDia(externo ? maiorDia(externo.pagoEm, a.vencimento) : hoje) } : {}),
        quitadaEm: l.quita ? agora : null,
      },
    })
    if (gravou.count === 0) throw new Recusa(MUDOU)
  }
}

const maiorDia = (a: string, b: string) => (a > b ? a : b)

// ─────────────────────────────────────────────────────────────
// JÁ PAGOU FORA
// ─────────────────────────────────────────────────────────────

export type PedidoDeBaixaExterna = {
  clienteId: string
  unidadeId: string
  parcelaIds: string[]
  valor: number
  /**
   * "Quitou tudo": a baixa de TODO o carnê dela nesta loja, com o valor
   * contado aqui dentro, com o banco travado — e não o que a tela leu antes
   * (`valor` e `parcelaIds` são ignorados). Uma parcela recebida no meio não
   * vira baixa de dinheiro que ela não deve mais.
   */
  tudo?: boolean
  /** O PIN de quem dá a baixa, quando a empresa pede assinatura nas exceções. */
  pin?: string | null
  /** Como ela pagou lá — só para o registro. */
  forma?: FormaPagamento
  /** De onde veio: "sistema antigo, recibo 123". */
  referencia: string
  /** "AAAA-MM-DD": o dia em que pagou lá. */
  pagoEm: string
}

export async function baixaExterna(sessao: Sessao, p: PedidoDeBaixaExterna, agora = new Date()): Promise<ResultadoDoRecibo> {
  exigir(sessao, 'crediario.cobrar', p.unidadeId)
  const referencia = limparTexto(p.referencia, 120)
  if (referencia.length < 3) return { ok: false, erro: 'Diga de onde veio o pagamento (ex.: "sistema antigo, recibo 123").' }
  if (!p.tudo && (!Number.isFinite(p.valor) || p.valor <= 0)) return { ok: false, erro: 'Diga quanto ela pagou lá.' }
  const hoje = diaEmSP(agora)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.pagoEm ?? '') || p.pagoEm > hoje || diasEntre(p.pagoEm, hoje) > 5 * 366) {
    return { ok: false, erro: 'O dia do pagamento precisa ser hoje ou antes.' }
  }
  const forma = p.forma && FORMAS_DE_RECEBER.includes(p.forma) ? p.forma : 'DINHEIRO'
  // Fora da transação: a conferência do PIN abre a dela (o freio).
  const assinatura = await assinarExcecao(sessao, { pin: p.pin })
  if (!assinatura.ok) return { ok: false, erro: assinatura.erro, precisaPin: true }

  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const cliente = await db.cliente.findUnique({ where: { id: p.clienteId }, select: { id: true, nome: true } })
      if (!cliente) throw new Recusa('Cliente não encontrado.')
      const vendas = await db.parcela.findMany({
        where: { clienteId: p.clienteId, unidadeId: p.unidadeId, quitadaEm: null },
        distinct: ['vendaId'],
        select: { vendaId: true },
      })
      for (const id of vendas.map((v) => v.vendaId).sort()) await travarVenda(db, id)

      const regra = await regraDoAtraso(db, sessao.orgId)
      const abertas = await parcelasAbertas(db, p.clienteId, p.unidadeId, regra, agora)
      if (abertas.length === 0) throw new Recusa('Ela não deve nada nesta loja.')
      const marcadas = p.tudo ? abertas.map((a) => a.id) : [...new Set(p.parcelaIds ?? [])]
      if (marcadas.some((id) => !abertas.some((a) => a.id === id))) throw new Recusa(MUDOU)
      const valorC = p.tudo ? abertas.reduce((s, a) => s + a.restaC, 0) : centavos(p.valor)

      const plano = planejarRecebimento(abertas, { marcadas, dinheiroC: valorC, semAtraso: true })
      if (!plano.ok) throw new Recusa(explicarRecusa(plano, brlC))

      const saldoAntesC = abertas.reduce((s, a) => s + a.restaC, 0)
      const saldoDepoisC = saldoAntesC - plano.principalC
      const comoEstavam = await fotoDasParcelas(db, plano.linhas.map((l) => l.id))
      const recibo = await db.reciboCrediario.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: p.unidadeId,
          clienteId: p.clienteId,
          caixaId: null,
          valor: reais(plano.dinheiroC),
          saldoAntes: reais(saldoAntesC),
          saldoDepois: reais(saldoDepoisC),
          externo: true,
          referencia,
          pagoEm: colunaDoDia(p.pagoEm),
          quemId: sessao.usuarioId,
          quem: sessao.nome,
          criadoEm: agora,
        },
        select: { id: true },
      })
      await gravarParcelas(db, abertas, plano.linhas, agora, { pagoEm: p.pagoEm })
      await db.recebimento.createMany({
        data: plano.linhas.map((l) => ({
          orgId: sessao.orgId,
          parcelaId: l.id,
          caixaId: null,
          reciboId: recibo.id,
          forma,
          valor: reais(l.principalC),
          externo: true,
          quem: sessao.nome,
          criadoEm: agora,
        })),
      })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: p.unidadeId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: p.tudo ? 'crediario.quitou' : 'crediario.baixa_externa',
          alvoTipo: 'cliente',
          alvoId: cliente.id,
          alvoNome: cliente.nome,
          valor: reais(plano.dinheiroC),
          motivo: `${p.tudo ? 'quitou tudo · ' : ''}pago fora em ${p.pagoEm.split('-').reverse().join('/')} · ${referencia} · ${quaisParcelas(abertas, plano.linhas)}`.slice(0, 300),
          antes: { parcelas: comoEstavam },
          depois: { reciboId: recibo.id, forma },
          assinado: assinatura.assinou,
        },
      })
      return { ok: true as const, reciboId: recibo.id, saldoDepois: reais(saldoDepoisC), quitou: saldoDepoisC === 0, troco: 0, recebido: reais(plano.dinheiroC) }
    })
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.message }
    throw e
  }
}

// ─────────────────────────────────────────────────────────────
// ESTORNAR O RECIBO LANÇADO ERRADO
// ─────────────────────────────────────────────────────────────
//
// Recebeu na ficha da cliente errada, digitou 500 em vez de 50: o recibo
// precisa sair, e a dívida voltar a ser o que era. Não é cancelar cobrança —
// é desfazer um lançamento. Por isso:
//   • é de quem pode cancelar venda na loja do recibo (`venda.cancelar`), e
//     assina SEMPRE com o PIN dela (é dinheiro saindo do registro);
//   • só o recibo MAIS NOVO de cada parcela: o de antes de outro pagamento
//     mudaria o chão em que o de depois foi calculado;
//   • só enquanto o turno dele estiver aberto: o turno fechado já foi
//     contado, e mexer nele faria o fechamento de ontem mudar sozinho;
//   • as parcelas voltam a ser o que eram — pago, desconto, juro, multa, e
//     até onde o atraso estava resolvido (a fotografia que o recebimento
//     guardou no livro). Recibo de antes dessa fotografia não se estorna.
//
// O recibo e os recebimentos dele saem do banco (é como o fechamento e o DRE
// deixam de contá-los); o livro guarda tudo o que eles eram.

/** Como as parcelas estavam ANTES do recebimento, no que a conta não refaz sozinha. */
type FotoDaParcela = { id: string; multaCobrada: boolean; jurosAte: string | null }

async function fotoDasParcelas(db: BancoDaOrg, ids: string[]): Promise<FotoDaParcela[]> {
  const ps = await db.parcela.findMany({ where: { id: { in: ids } }, select: { id: true, multaCobrada: true, jurosAte: true } })
  return ps.map((x) => ({ id: x.id, multaCobrada: x.multaCobrada, jurosAte: x.jurosAte ? x.jurosAte.toISOString() : null }))
}

export type PedidoDeEstorno = { reciboId: string; motivo: string; pin?: string | null }

export type ResultadoDoEstorno =
  | { ok: true; valor: number; saldoDepois: number; turnoAberto: boolean }
  | { ok: false; erro: string; precisaPin?: true }

export async function estornarRecibo(sessao: Sessao, p: PedidoDeEstorno): Promise<ResultadoDoEstorno> {
  const motivo = limparTexto(p.motivo)
  if (motivo.length < 3) return { ok: false, erro: 'Diga por que o recibo está sendo estornado (fica no livro).' }
  if (!/^[\w-]{1,64}$/.test(p.reciboId ?? '')) return { ok: false, erro: 'Recibo não encontrado.' }

  // A loja do recibo antes do PIN: quem não pode estornar nem gasta tentativa.
  const dono = await comoOrg(sessao.orgId, (db) =>
    db.reciboCrediario.findUnique({ where: { id: p.reciboId }, select: { unidadeId: true } }),
  )
  if (!dono || !pode(sessao, 'crediario.ver', dono.unidadeId)) return { ok: false, erro: 'Recibo não encontrado.' }
  if (!pode(sessao, 'venda.cancelar', dono.unidadeId)) {
    return { ok: false, erro: 'Estornar recibo é para quem pode cancelar venda nesta loja. Chame a gerente.' }
  }
  // Fora da transação: a conferência do PIN abre a dela (o freio).
  const assinatura = await assinarExcecao(sessao, { pin: p.pin, sempre: true })
  if (!assinatura.ok) return { ok: false, erro: assinatura.erro, precisaPin: true }

  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const r = await db.reciboCrediario.findUnique({
        where: { id: p.reciboId },
        select: {
          id: true, unidadeId: true, clienteId: true, caixaId: true, valor: true, juros: true, multa: true,
          desconto: true, perdoado: true, troco: true, saldoAntes: true, saldoDepois: true, externo: true,
          referencia: true, pagoEm: true, quem: true, autorizadoPor: true, motivo: true, criadoEm: true,
          cliente: { select: { nome: true } },
        },
      })
      if (!r) throw new Recusa('Recibo não encontrado (pode ter sido estornado agora).')
      const recs = await db.recebimento.findMany({
        where: { reciboId: r.id },
        select: { id: true, parcelaId: true, forma: true, valor: true, juros: true, multa: true, desconto: true, maquininha: true, criadoEm: true },
      })
      if (recs.length === 0) throw new Recusa('Este recibo não tem recebimento para desfazer.')
      const parcelaIds = [...new Set(recs.map((x) => x.parcelaId))]

      // As vendas das parcelas travadas, em ordem (como o recebimento): nada
      // recebe nem devolve nelas no meio do estorno.
      const vendas = await db.parcela.findMany({ where: { id: { in: parcelaIds } }, distinct: ['vendaId'], select: { vendaId: true } })
      for (const id of vendas.map((v) => v.vendaId).sort()) await travarVenda(db, id)

      // Só o mais novo: outro pagamento depois deste nas mesmas parcelas foi
      // calculado em cima dele.
      const depois = await db.recebimento.count({
        where: {
          parcelaId: { in: parcelaIds },
          criadoEm: { gte: r.criadoEm },
          OR: [{ reciboId: null }, { reciboId: { not: r.id } }],
        },
      })
      if (depois > 0) throw new Recusa('Estas parcelas receberam outro pagamento depois deste recibo. Estorne primeiro o mais novo.')

      // A fotografia de como as parcelas estavam (ver `fotoDasParcelas`).
      const livro = await db.auditoria.findFirst({
        where: {
          acao: { in: ['crediario.recebeu', 'crediario.baixa_externa', 'crediario.quitou'] },
          alvoTipo: 'cliente',
          alvoId: r.clienteId,
          depois: { path: ['reciboId'], equals: r.id },
        },
        orderBy: { criadoEm: 'desc' },
        select: { antes: true },
      })
      const fotos = ((livro?.antes as { parcelas?: FotoDaParcela[] } | null)?.parcelas ?? []).filter((f) => parcelaIds.includes(f.id))
      if (fotos.length !== parcelaIds.length) {
        throw new Recusa('Este recibo é de antes do estorno existir: o sistema não guardou como as parcelas estavam. Fale com o suporte.')
      }

      // O turno: aberto, preso até o fim (o fechamento espera). Fechado, não
      // se mexe — já foi contado.
      let turnoAberto = false
      if (r.caixaId) {
        turnoAberto = !!(await travarCaixaAberto(db, r.unidadeId, r.caixaId))
        if (!turnoAberto) {
          throw new Recusa('O turno deste recibo já fechou, e o dinheiro dele já foi contado. Um recibo de turno fechado não se estorna.')
        }
      }

      // ── as parcelas voltam ──
      const parcelas = await db.parcela.findMany({
        where: { id: { in: parcelaIds } },
        select: { id: true, valor: true, pago: true, desconto: true, juros: true, multa: true, quitadaEm: true },
      })
      for (const x of parcelas) {
        const dela = recs.filter((y) => y.parcelaId === x.id)
        const principalC = dela.reduce((s, y) => s + centavos(y.valor) - centavos(y.juros) - centavos(y.multa), 0)
        const descontoC = dela.reduce((s, y) => s + centavos(y.desconto), 0)
        const jurosC = dela.reduce((s, y) => s + centavos(y.juros), 0)
        const multaC = dela.reduce((s, y) => s + centavos(y.multa), 0)
        const pagoC = centavos(x.pago) - principalC
        const descC = centavos(x.desconto) - descontoC
        const jurC = centavos(x.juros) - jurosC
        const mulC = centavos(x.multa) - multaC
        if (pagoC < 0 || descC < 0 || jurC < 0 || mulC < 0) {
          throw new Recusa('As parcelas deste recibo não batem com os recebimentos dele. Nada foi estornado: fale com o suporte.')
        }
        const foto = fotos.find((f) => f.id === x.id)!
        const restaC = centavos(x.valor) - pagoC - descC
        await db.parcela.update({
          where: { id: x.id },
          data: {
            pago: reais(pagoC),
            desconto: reais(descC),
            juros: reais(jurC),
            multa: reais(mulC),
            multaCobrada: foto.multaCobrada,
            jurosAte: foto.jurosAte ? new Date(foto.jurosAte) : null,
            // Volta a dever: abre. (A devolução que abateu a parcela depois
            // pode ter deixado ela quitada mesmo assim — aí fica.)
            quitadaEm: restaC > 0 ? null : x.quitadaEm,
          },
        })
      }

      // ── o recibo sai (e, com ele, do turno, do fechamento e do DRE) ──
      await db.recebimento.deleteMany({ where: { reciboId: r.id } })
      await db.reciboCrediario.delete({ where: { id: r.id } })

      const saldo = await db.$queryRaw<{ s: string }[]>`
        select coalesce(sum(valor - pago - desconto), 0) as s from parcelas
         where cliente_id = ${r.clienteId} and unidade_id = ${r.unidadeId} and quitada_em is null`
      const saldoDepoisC = centavos(saldo[0]?.s ?? 0)

      const dinheiroC = recs.filter((y) => y.forma === 'DINHEIRO').reduce((s, y) => s + centavos(y.valor), 0)
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: r.unidadeId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'crediario.estornou',
          alvoTipo: 'cliente',
          alvoId: r.clienteId,
          alvoNome: r.cliente.nome,
          valor: reais(centavos(r.valor)),
          motivo: [
            `estornou o recibo ${codigoDoRecibo(r.id)} de ${brlC(centavos(r.valor))}`,
            r.externo ? 'baixa externa' : null,
            dinheiroC > 0 ? `${brlC(dinheiroC)} em dinheiro saem da conta da gaveta` : null,
            motivo,
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 300),
          antes: {
            recibo: {
              id: r.id, criadoEm: r.criadoEm.toISOString(), quem: r.quem, caixaId: r.caixaId, externo: r.externo,
              referencia: r.referencia, valor: Number(r.valor), juros: Number(r.juros), multa: Number(r.multa),
              desconto: Number(r.desconto), perdoado: Number(r.perdoado), troco: Number(r.troco),
              saldoAntes: Number(r.saldoAntes), saldoDepois: Number(r.saldoDepois), autorizadoPor: r.autorizadoPor, motivo: r.motivo,
            },
            recebimentos: recs.map((y) => ({
              parcelaId: y.parcelaId, forma: y.forma, valor: Number(y.valor), juros: Number(y.juros),
              multa: Number(y.multa), desconto: Number(y.desconto), maquininha: y.maquininha,
            })),
          },
          depois: { saldoNaLoja: reais(saldoDepoisC) },
          assinado: assinatura.assinou,
        },
      })

      return { ok: true as const, valor: reais(centavos(r.valor)), saldoDepois: reais(saldoDepoisC), turnoAberto }
    })
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.message }
    throw e
  }
}

// ─────────────────────────────────────────────────────────────
// O PAPEL: o credor, o recibo, o carnê
// ─────────────────────────────────────────────────────────────

export type Credor = {
  /** O nome que a cliente conhece (o "nome no comprovante"). */
  nome: string
  razaoSocial: string | null
  cnpj: string | null
  ie: string | null
  endereco: string | null
  telefone: string | null
  /** O que falta para o papel valer como confissão de dívida. */
  faltando: string[]
}

/**
 * A quem se deve: a identidade legal da loja, e a da empresa onde a loja não
 * tem a sua (empresa de um CNPJ só preenche uma vez, no cadastro).
 */
export async function credorDaLoja(db: BancoDaOrg, orgId: string, unidadeId: string): Promise<Credor> {
  const org = await db.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { nome: true, razaoSocial: true, documento: true, inscricaoEstadual: true, telefone: true, whatsapp: true },
  })
  const u = await db.unidade.findUnique({
    where: { id: unidadeId },
    select: {
      nome: true, apelido: true, razaoSocial: true, documento: true, inscricaoEstadual: true,
      endereco: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true, telefone: true,
    },
  })
  const rua = [u?.endereco, u?.numero, u?.complemento].filter(Boolean).join(', ')
  const endereco = rua
    ? [rua, u?.bairro, [u?.cidade, u?.estado].filter(Boolean).join('/'), u?.cep ? `CEP ${u.cep}` : null].filter(Boolean).join(' · ')
    : null
  const credor = {
    nome: u?.apelido || u?.nome || org.nome,
    razaoSocial: u?.razaoSocial || org.razaoSocial || null,
    cnpj: mostrarDocumento(u?.documento || org.documento || null),
    ie: u?.inscricaoEstadual || org.inscricaoEstadual || null,
    endereco,
    telefone: u?.telefone || org.whatsapp || org.telefone || null,
  }
  const faltando = [
    !credor.razaoSocial && 'razão social',
    !credor.cnpj && 'CNPJ',
    !credor.endereco && 'endereço',
    !credor.telefone && 'telefone',
  ].filter((x): x is string => !!x)
  return { ...credor, faltando }
}

export function mostrarDocumento(d: string | null): string | null {
  if (!d) return null
  const s = d.replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
  return d
}

export type ReciboNoPapel = {
  id: string
  /** Código curto para achar o recibo depois ("R-7KQ2PA"). */
  codigo: string
  criadoEm: Date
  unidadeId: string
  credor: Credor
  cliente: { id: string; nome: string; cpf: string | null }
  quem: string
  autorizadoPor: string | null
  motivo: string | null
  externo: boolean
  referencia: string | null
  pagoEm: string | null
  valor: number
  juros: number
  multa: number
  desconto: number
  perdoado: number
  troco: number
  saldoAntes: number
  saldoDepois: number
  formas: { forma: FormaPagamento; maquininha: string | null; valor: number }[]
  parcelas: {
    id: string
    vendaNumero: number
    numero: number
    de: number
    vencimento: string
    valor: number
    /** O que este recibo abateu dela (dinheiro + desconto). */
    abatido: number
    juros: number
    multa: number
    emAtraso: boolean
    quitou: boolean
  }[]
  /** As parcelas que ainda faltam HOJE (o papel reimpresso mostra o de agora). */
  faltam: { vendaNumero: number; numero: number; de: number; vencimento: string; resta: number }[]
}

export const codigoDoRecibo = (id: string) => `R-${id.slice(-6).toUpperCase()}`

export async function acharRecibo(sessao: Sessao, id: string): Promise<ReciboNoPapel | null> {
  exigir(sessao, 'crediario.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const r = await db.reciboCrediario.findUnique({
      where: { id },
      include: {
        cliente: { select: { id: true, nome: true, documento: true } },
        recebimentos: {
          orderBy: { id: 'asc' },
          include: { parcela: { select: { id: true, numero: true, de: true, vencimento: true, valor: true, quitadaEm: true, venda: { select: { numero: true } } } } },
        },
      },
    })
    if (!r || !pode(sessao, 'crediario.ver', r.unidadeId)) return null
    const credor = await credorDaLoja(db, sessao.orgId, r.unidadeId)
    const faltam = await db.parcela.findMany({
      where: { clienteId: r.clienteId, unidadeId: r.unidadeId, quitadaEm: null },
      orderBy: [{ vencimento: 'asc' }, { numero: 'asc' }],
      select: { numero: true, de: true, vencimento: true, valor: true, pago: true, desconto: true, venda: { select: { numero: true } } },
    })

    const formas = new Map<string, { forma: FormaPagamento; maquininha: string | null; valor: number }>()
    const parcelas = new Map<string, ReciboNoPapel['parcelas'][number]>()
    const dia = diaDaColuna
    const quando = r.externo && r.pagoEm ? dia(r.pagoEm) : diaEmSP(r.criadoEm)
    for (const x of r.recebimentos) {
      const chave = `${x.forma}|${x.maquininha ?? ''}`
      const f = formas.get(chave) ?? { forma: x.forma, maquininha: x.maquininha, valor: 0 }
      f.valor = reais(centavos(f.valor) + centavos(x.valor))
      formas.set(chave, f)
      const p = parcelas.get(x.parcelaId) ?? {
        id: x.parcela.id,
        vendaNumero: x.parcela.venda.numero,
        numero: x.parcela.numero,
        de: x.parcela.de,
        vencimento: dia(x.parcela.vencimento),
        valor: Number(x.parcela.valor),
        abatido: 0,
        juros: 0,
        multa: 0,
        emAtraso: dia(x.parcela.vencimento) < quando,
        quitou: false,
      }
      p.abatido = reais(centavos(p.abatido) + centavos(x.valor) - centavos(x.juros) - centavos(x.multa) + centavos(x.desconto))
      p.juros = reais(centavos(p.juros) + centavos(x.juros))
      p.multa = reais(centavos(p.multa) + centavos(x.multa))
      parcelas.set(x.parcelaId, p)
    }
    // "Quitou" no papel é o que ESTE recibo fez: a parcela que fechou nele.
    const quitadasNele = await db.parcela.findMany({
      where: { id: { in: [...parcelas.keys()] }, quitadaEm: r.criadoEm },
      select: { id: true },
    })
    for (const q of quitadasNele) parcelas.get(q.id)!.quitou = true

    return {
      id: r.id,
      codigo: codigoDoRecibo(r.id),
      criadoEm: r.criadoEm,
      unidadeId: r.unidadeId,
      credor,
      cliente: { id: r.cliente.id, nome: r.cliente.nome, cpf: mostrarDocumento(r.cliente.documento) },
      quem: r.quem,
      autorizadoPor: r.autorizadoPor,
      motivo: r.motivo,
      externo: r.externo,
      referencia: r.referencia,
      pagoEm: r.pagoEm ? dia(r.pagoEm) : null,
      valor: Number(r.valor),
      juros: Number(r.juros),
      multa: Number(r.multa),
      desconto: Number(r.desconto),
      perdoado: Number(r.perdoado),
      troco: Number(r.troco),
      saldoAntes: Number(r.saldoAntes),
      saldoDepois: Number(r.saldoDepois),
      formas: [...formas.values()].filter((f) => f.valor > 0),
      parcelas: [...parcelas.values()].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.vendaNumero - b.vendaNumero),
      faltam: faltam
        .map((f) => ({
          vendaNumero: f.venda.numero,
          numero: f.numero,
          de: f.de,
          vencimento: dia(f.vencimento),
          resta: reais(centavos(f.valor) - centavos(f.pago) - centavos(f.desconto)),
        }))
        .filter((f) => f.resta > 0),
    }
  })
}

export type ReciboNaLista = {
  id: string
  codigo: string
  criadoEm: Date
  unidade: string
  valor: number
  abatido: number
  externo: boolean
  referencia: string | null
  quem: string
  parcelas: number
  saldoDepois: number
}

/** Os recibos da cliente, do mais novo — a ficha mostra e reimprime. */
export async function recibosDoCliente(sessao: Sessao, clienteId: string, limite = 30): Promise<ReciboNaLista[]> {
  exigir(sessao, 'crediario.ver')
  const permitidas = unidadesQuePodem(sessao, 'crediario.ver')
  if (permitidas.length === 0) return []
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.reciboCrediario.findMany({
      where: { clienteId, ...(permitidas === 'todas' ? {} : { unidadeId: { in: permitidas } }) },
      orderBy: { criadoEm: 'desc' },
      take: limite,
      select: {
        id: true, criadoEm: true, valor: true, desconto: true, juros: true, multa: true, externo: true, referencia: true,
        quem: true, saldoDepois: true, saldoAntes: true,
        unidade: { select: { nome: true } },
        recebimentos: { select: { parcelaId: true } },
      },
    }),
  )
  return linhas.map((r) => ({
    id: r.id,
    codigo: codigoDoRecibo(r.id),
    criadoEm: r.criadoEm,
    unidade: r.unidade.nome,
    valor: Number(r.valor),
    abatido: reais(centavos(r.saldoAntes) - centavos(r.saldoDepois)),
    externo: r.externo,
    referencia: r.referencia,
    quem: r.quem,
    parcelas: new Set(r.recebimentos.map((x) => x.parcelaId)).size,
    saldoDepois: Number(r.saldoDepois),
  }))
}

export type CarneNoPapel = {
  vendaId: string
  vendaNumero: number
  criadaEm: Date
  situacao: string
  credor: Credor
  cliente: { id: string; nome: string; cpf: string | null; telefone: string | null }
  vendedor: string | null
  itens: { descricao: string; codigo: string | null; quantidade: number; total: number }[]
  total: number
  financiado: number
  pagoAgora: number
  parcelas: { numero: number; de: number; vencimento: string; valor: number; resta: number; quitada: boolean }[]
  /** O que ela deve nesta loja hoje, somando todas as compras. */
  saldoNaLoja: number
  regra: RegraAtraso
}

/** O carnê da venda no crediário: as parcelas como estão hoje. */
export async function carneDaVenda(sessao: Sessao, vendaId: string): Promise<CarneNoPapel | null> {
  exigir(sessao, 'venda.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const v = await db.venda.findUnique({
      where: { id: vendaId },
      select: {
        id: true, numero: true, criadaEm: true, situacao: true, unidadeId: true, total: true, vendedorNome: true,
        cliente: { select: { id: true, nome: true, documento: true, telefone: true } },
        itens: { select: { descricao: true, codigo: true, quantidade: true, total: true } },
        pagamentos: { select: { forma: true, valor: true } },
        parcelas: { orderBy: { numero: 'asc' }, select: { numero: true, de: true, vencimento: true, valor: true, pago: true, desconto: true, quitadaEm: true } },
      },
    })
    if (!v || !pode(sessao, 'venda.ver', v.unidadeId) || !v.cliente || v.parcelas.length === 0) return null
    const credor = await credorDaLoja(db, sessao.orgId, v.unidadeId)
    const regra = await regraDoAtraso(db, sessao.orgId)
    const saldo = await db.$queryRaw<{ s: string }[]>`
      select coalesce(sum(valor - pago - desconto), 0) as s from parcelas
       where cliente_id = ${v.cliente.id} and unidade_id = ${v.unidadeId} and quitada_em is null`
    const financiadoC = v.parcelas.reduce((s, p) => s + centavos(p.valor), 0)
    const crediarioC = v.pagamentos.filter((p) => p.forma === 'CREDIARIO').reduce((s, p) => s + centavos(p.valor), 0)
    return {
      vendaId: v.id,
      vendaNumero: v.numero,
      criadaEm: v.criadaEm,
      situacao: v.situacao,
      credor,
      cliente: { id: v.cliente.id, nome: v.cliente.nome, cpf: mostrarDocumento(v.cliente.documento), telefone: v.cliente.telefone },
      vendedor: v.vendedorNome,
      itens: v.itens.map((i) => ({ descricao: i.descricao, codigo: i.codigo, quantidade: Number(i.quantidade), total: Number(i.total) })),
      total: Number(v.total),
      financiado: reais(financiadoC),
      // O que foi pago fora do crediário na hora (a entrada). Pela forma de
      // pagamento, e não pelo total menos as parcelas: a devolução abaixa o
      // valor das parcelas e a "entrada" cresceria sozinha.
      pagoAgora: reais(Math.max(0, centavos(v.total) - crediarioC)),
      parcelas: v.parcelas.map((p) => ({
        numero: p.numero,
        de: p.de,
        vencimento: diaDaColuna(p.vencimento),
        valor: Number(p.valor),
        resta: reais(Math.max(0, centavos(p.valor) - centavos(p.pago) - centavos(p.desconto))),
        quitada: !!p.quitadaEm,
      })),
      saldoNaLoja: reais(centavos(saldo[0]?.s ?? 0)),
      regra,
    }
  })
}
