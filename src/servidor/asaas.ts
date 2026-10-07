// A cobrança do Norte pelo Asaas.
//
// ── o caminho do dinheiro ────────────────────────────────────
// 1. A loja clica "Assinar" (ou compra um pacote de respostas). Criamos a
//    cobrança no Asaas com a forma em aberto (`UNDEFINED`): a pessoa escolhe
//    Pix, boleto ou cartão na página de pagamento do Asaas, que abrimos para ela.
// 2. O Asaas avisa em /api/asaas quando o dinheiro entra. O aviso NÃO é
//    acreditado: com o id dele, perguntamos ao Asaas (com a nossa chave) se o
//    pagamento existe e está pago. Aviso inventado não libera nada.
// 3. Pago o primeiro mês, o plano liga (o teste vira assinatura), o pagamento
//    entra no livro (`registrarPagamento`, que gera as comissões dos
//    parceiros) e nasce a assinatura mensal no Asaas, a partir do mês seguinte.
//    Os meses seguintes chegam pelo mesmo aviso.
//
// ── por que o primeiro mês é cobrança avulsa ─────────────────
// O desconto de indicação (50% na primeira mensalidade) só vale uma vez, e a
// assinatura do Asaas aplica desconto em todas. E a assinatura só nasce
// depois de pago: quem clicou e desistiu não fica com boleto todo mês.
//
// ── a referência ─────────────────────────────────────────────
// `externalReference` diz de quem é e o que é cada cobrança:
//   norte:m:<org>:<plano>:<AAAA-MM>:<cheioCent>   o primeiro mês
//   norte:s:<org>                                 a assinatura mensal
//   norte:p:<org>:<pacote>                        um pacote de respostas
//
// Variáveis: ASAAS_API_KEY (sem ela, tudo segue como pedido à equipe),
// ASAAS_AMBIENTE=sandbox para testar, ASAAS_WEBHOOK_TOKEN (opcional; se
// existir, o aviso tem de trazê-lo no cabeçalho `asaas-access-token`).

import { timingSafeEqual } from 'node:crypto'
import type { Plano } from '@prisma/client'
import { comoOrg } from './banco'
import { diaEmSP, somarDias } from './dia'
import { PACOTES, PLANOS, ehPacote, type Pacote } from './planos'
import { eventosDePedido, pedidoAberto } from './pedidos'
import { indicacaoDaEmpresa, lerDocumento, registrarPagamento, valorDaMensalidade, PagamentoRepetido, type FormaDePagamento } from './parceiros'
import { atenderPacoteDeRespostas, trocarPlanoPelaEquipe } from './operacao'

// ─────────────────────────────────────────────────────────────
// A CONVERSA COM O ASAAS
// ─────────────────────────────────────────────────────────────

export const asaasLigado = () => Boolean(process.env.ASAAS_API_KEY?.trim())

const endereco = () =>
  process.env.ASAAS_AMBIENTE === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'

export class AsaasFalhou extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'AsaasFalhou'
  }
}

/** Falta o CPF ou CNPJ de quem paga: o Asaas não cria cobrança sem ele. */
export class FaltaDocumento extends Error {
  constructor(motivo = 'Para gerar a cobrança, informe o CPF ou o CNPJ de quem paga.') {
    super(motivo)
    this.name = 'FaltaDocumento'
  }
}

type Buscar = typeof fetch
let buscar: Buscar = (...a) => fetch(...a)
/** Para os testes: troca a ida ao Asaas por uma de mentira. */
export function trocarConexaoAsaas(f: Buscar | null) {
  buscar = f ?? ((...a) => fetch(...a))
}

async function chamar<T>(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
  const chave = process.env.ASAAS_API_KEY?.trim()
  if (!chave) throw new AsaasFalhou('O Asaas não está ligado neste servidor.')
  let r: Response
  try {
    r = await buscar(`${endereco()}${caminho}`, {
      method: metodo,
      headers: { access_token: chave, 'content-type': 'application/json', 'user-agent': 'Norte (gestornorte.com)' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new AsaasFalhou('O Asaas não respondeu. Tente de novo em instantes.')
  }
  const texto = await r.text()
  let dados: unknown = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = null
  }
  if (!r.ok) {
    const erros = (dados as { errors?: { description?: string }[] } | null)?.errors
    const motivo = erros?.map((e) => e.description).filter(Boolean).join(' ') || `O Asaas recusou (${r.status}).`
    // Só o motivo — nunca a chave, nunca o corpo inteiro.
    console.error('[asaas]', metodo, caminho.split('?')[0], r.status, motivo)
    throw new AsaasFalhou(motivo)
  }
  return dados as T
}

type ClienteAsaas = { id: string; deleted?: boolean }
export type PagamentoAsaas = {
  id: string
  customer: string
  status: string
  value: number
  billingType: string
  dueDate: string
  paymentDate?: string | null
  clientPaymentDate?: string | null
  confirmedDate?: string | null
  externalReference?: string | null
  subscription?: string | null
  invoiceUrl?: string
  deleted?: boolean
}
type AssinaturaAsaas = { id: string; value: number; externalReference?: string | null; status?: string; deleted?: boolean }
type Lista<T> = { data: T[] }

// ─────────────────────────────────────────────────────────────
// A REFERÊNCIA
// ─────────────────────────────────────────────────────────────

export type Referencia =
  | { tipo: 'm'; orgId: string; plano: Plano; referencia: string; cheioCent: number }
  | { tipo: 's'; orgId: string }
  | { tipo: 'p'; orgId: string; pacote: Pacote }

export function escreverReferencia(r: Referencia): string {
  if (r.tipo === 'm') return `norte:m:${r.orgId}:${r.plano}:${r.referencia}:${r.cheioCent}`
  if (r.tipo === 's') return `norte:s:${r.orgId}`
  return `norte:p:${r.orgId}:${r.pacote}`
}

export function lerReferencia(texto: string | null | undefined): Referencia | null {
  const p = String(texto ?? '').split(':')
  if (p[0] !== 'norte' || !p[2] || !/^[a-z0-9]{10,40}$/i.test(p[2])) return null
  const orgId = p[2]
  if (p[1] === 's' && p.length === 3) return { tipo: 's', orgId }
  if (p[1] === 'p' && p.length === 4 && ehPacote(p[3])) return { tipo: 'p', orgId, pacote: p[3] as Pacote }
  if (p[1] === 'm' && p.length === 6 && p[3]! in PLANOS && /^\d{4}-(0[1-9]|1[0-2])$/.test(p[4]!) && /^\d+$/.test(p[5]!)) {
    return { tipo: 'm', orgId, plano: p[3] as Plano, referencia: p[4]!, cheioCent: Number(p[5]) }
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// O CLIENTE (a empresa, no Asaas)
// ─────────────────────────────────────────────────────────────

/**
 * O cliente desta empresa no Asaas: o que já existe (procurado pela
 * referência, que é o id da empresa) ou um novo. O CPF/CNPJ vem da empresa
 * ou do formulário — e, vindo do formulário, fica guardado na empresa.
 */
async function clienteDa(orgId: string, documentoDigitado: string | null, email: string | null): Promise<string> {
  const org = await comoOrg(orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: orgId }, select: { nome: true, razaoSocial: true, documento: true, email: true } }),
  )
  let documento = org.documento?.replace(/\D/g, '') || null
  if (documentoDigitado?.trim()) {
    const d = lerDocumento(documentoDigitado)
    if ('erro' in d) throw new FaltaDocumento(d.erro)
    documento = d.ok
    if (documento !== org.documento) {
      await comoOrg(orgId, (db) => db.org.update({ where: { id: orgId }, data: { documento } }))
    }
  }

  const achados = await chamar<Lista<ClienteAsaas>>('GET', `/customers?externalReference=${encodeURIComponent(orgId)}`)
  const ja = achados.data.find((c) => !c.deleted)
  if (ja) {
    if (documentoDigitado?.trim() && documento) await chamar('POST', `/customers/${ja.id}`, { cpfCnpj: documento })
    return ja.id
  }

  if (!documento || 'erro' in lerDocumento(documento)) throw new FaltaDocumento()
  const novo = await chamar<ClienteAsaas>('POST', '/customers', {
    name: (org.razaoSocial || org.nome).slice(0, 100),
    cpfCnpj: documento,
    email: org.email || email || undefined,
    externalReference: orgId,
  })
  return novo.id
}

/**
 * A cobrança avulsa com esta referência: a que já está em aberto (o segundo
 * clique não gera outra) ou uma nova. As em aberto de OUTRO pedido do mesmo
 * tipo (trocou de plano antes de pagar) são apagadas.
 */
async function cobrancaAvulsa(
  cliente: string,
  ref: Referencia,
  valorCent: number,
  descricao: string,
): Promise<{ id: string; invoiceUrl: string }> {
  const texto = escreverReferencia(ref)
  const prefixo = texto.split(':').slice(0, 3).join(':') + ':'
  const abertas = await chamar<Lista<PagamentoAsaas>>('GET', `/payments?customer=${encodeURIComponent(cliente)}&status=PENDING&limit=50`)
  for (const p of abertas.data) {
    if (p.deleted || !p.externalReference?.startsWith(prefixo)) continue
    if (p.externalReference === texto && Math.round(p.value * 100) === valorCent && p.invoiceUrl) return { id: p.id, invoiceUrl: p.invoiceUrl }
    await chamar('DELETE', `/payments/${p.id}`)
  }
  const nova = await chamar<PagamentoAsaas>('POST', '/payments', {
    customer: cliente,
    billingType: 'UNDEFINED',
    value: valorCent / 100,
    dueDate: somarDias(diaEmSP(), 3),
    description: descricao.slice(0, 500),
    externalReference: texto,
  })
  if (!nova.invoiceUrl) throw new AsaasFalhou('O Asaas não devolveu a página de pagamento.')
  return { id: nova.id, invoiceUrl: nova.invoiceUrl }
}

// ─────────────────────────────────────────────────────────────
// O QUE A TELA DA ASSINATURA CHAMA
// ─────────────────────────────────────────────────────────────

const reais = (cent: number) => (cent / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** O primeiro mês de um plano. Devolve a página de pagamento do Asaas. */
export async function cobrarPrimeiroMes(
  orgId: string,
  d: { plano: Plano; mensalCent: number; documento: string | null; email: string | null },
): Promise<{ invoiceUrl: string; pagarCent: number; descontoCent: number }> {
  if (!(d.mensalCent > 0)) throw new AsaasFalhou('Este plano não tem preço para cobrar.')
  const ind = await indicacaoDaEmpresa(orgId)
  const v = valorDaMensalidade(d.mensalCent, Boolean(ind?.descontoDisponivel))
  const cliente = await clienteDa(orgId, d.documento, d.email)
  const referencia = diaEmSP().slice(0, 7)
  const r = await cobrancaAvulsa(
    cliente,
    { tipo: 'm', orgId, plano: d.plano, referencia, cheioCent: v.cheioCent },
    v.pagarCent,
    `Norte · plano ${PLANOS[d.plano].titulo} · primeira mensalidade` +
      (v.descontoCent > 0 ? ` (${reais(v.cheioCent)} com ${reais(v.descontoCent)} de desconto de indicação)` : ''),
  )
  return { invoiceUrl: r.invoiceUrl, pagarCent: v.pagarCent, descontoCent: v.descontoCent }
}

/** Um pacote de respostas. Devolve a página de pagamento do Asaas. */
export async function cobrarPacote(
  orgId: string,
  d: { pacote: Pacote; documento: string | null; email: string | null },
): Promise<{ invoiceUrl: string; valorCent: number }> {
  const pac = PACOTES[d.pacote]
  const valorCent = Math.round(pac.preco * 100)
  const cliente = await clienteDa(orgId, d.documento, d.email)
  const r = await cobrancaAvulsa(
    cliente,
    { tipo: 'p', orgId, pacote: d.pacote },
    valorCent,
    `Norte · pacote de +${pac.respostas.toLocaleString('pt-BR')} respostas do assistente`,
  )
  return { invoiceUrl: r.invoiceUrl, valorCent }
}

/**
 * A conta do mês mudou (subiu ou desceu de plano): a assinatura do Asaas
 * acompanha, inclusive a cobrança do mês que ainda não foi paga. Sem preço
 * (o Grátis), a assinatura é cancelada.
 */
export async function ajustarAssinatura(orgId: string, mensalCent: number | null): Promise<'mudou' | 'cancelou' | 'sem-assinatura'> {
  if (!asaasLigado()) return 'sem-assinatura'
  const c = await comoOrg(orgId, (db) => db.cobranca.findUnique({ where: { orgId }, select: { provedor: true, assinaturaId: true } }))
  if (c?.provedor !== 'asaas' || !c.assinaturaId) return 'sem-assinatura'
  if (!mensalCent || mensalCent <= 0) {
    await chamar('DELETE', `/subscriptions/${c.assinaturaId}`)
    await comoOrg(orgId, (db) => db.cobranca.update({ where: { orgId }, data: { assinaturaId: null, valorMensal: 0, proximaCobranca: null } }))
    return 'cancelou'
  }
  await chamar('POST', `/subscriptions/${c.assinaturaId}`, { value: mensalCent / 100, updatePendingPayments: true })
  await comoOrg(orgId, (db) => db.cobranca.update({ where: { orgId }, data: { valorMensal: mensalCent / 100 } }))
  return 'mudou'
}

// ─────────────────────────────────────────────────────────────
// O AVISO DO ASAAS (/api/asaas)
// ─────────────────────────────────────────────────────────────

const PAGO = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'])
const EVENTOS_DE_PAGO = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'])

function mesmoToken(veio: string | null, esperado: string): boolean {
  const a = Buffer.from(veio ?? '')
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * A porta do aviso. Responde rápido (o Asaas pausa a fila depois de muitas
 * falhas) e devolve o trabalho para depois. Token errado: 401. Aviso que não
 * nos interessa: 200 e nada.
 */
export function receberAvisoAsaas(bruto: string, token: string | null): { status: number; trabalho?: () => Promise<void> } {
  if (!asaasLigado()) return { status: 404 }
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN?.trim()
  if (esperado && !mesmoToken(token, esperado)) return { status: 401 }
  let aviso: { event?: string; payment?: { id?: string } }
  try {
    aviso = JSON.parse(bruto)
  } catch {
    return { status: 400 }
  }
  const id = aviso.payment?.id
  if (!id || !/^[a-z0-9_]{5,60}$/i.test(id)) return { status: 200 }
  if (EVENTOS_DE_PAGO.has(aviso.event ?? '')) return { status: 200, trabalho: () => processarPagamento(id).then(() => undefined) }
  if (aviso.event === 'PAYMENT_OVERDUE') return { status: 200, trabalho: () => marcarAtraso(id) }
  return { status: 200 }
}

const FORMA: Record<string, FormaDePagamento> = { PIX: 'pix', BOLETO: 'boleto', CREDIT_CARD: 'cartao', DEBIT_CARD: 'cartao' }

/** A referência do pagamento: a dele, ou a da assinatura que o gerou. */
async function referenciaDe(p: PagamentoAsaas): Promise<{ ref: Referencia; assinatura: AssinaturaAsaas | null } | null> {
  const direta = lerReferencia(p.externalReference)
  if (direta && direta.tipo !== 's') return { ref: direta, assinatura: null }
  if (!p.subscription) return direta ? { ref: direta, assinatura: null } : null
  const s = await chamar<AssinaturaAsaas>('GET', `/subscriptions/${p.subscription}`)
  const daAssinatura = lerReferencia(s.externalReference)
  return daAssinatura?.tipo === 's' ? { ref: daAssinatura, assinatura: s } : null
}

const MARCA = 'asaas.recebeu'

/** O mesmo dia no mês seguinte ('AAAA-MM-DD'), no máximo dia 28. */
export function mesSeguinte(dia: string): string {
  const ano = Number(dia.slice(0, 4))
  const mes = Number(dia.slice(5, 7))
  const d = Math.min(28, Number(dia.slice(8, 10)))
  return `${mes === 12 ? ano + 1 : ano}-${String(mes === 12 ? 1 : mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * O pagamento, conferido no próprio Asaas. Devolve o que fez (para o teste e
 * o log). Repetir o mesmo aviso não faz nada duas vezes.
 */
export async function processarPagamento(pagamentoId: string): Promise<string> {
  const p = await chamar<PagamentoAsaas>('GET', `/payments/${pagamentoId}`)
  if (p.deleted || !PAGO.has(p.status)) return 'não está pago'
  const achado = await referenciaDe(p)
  if (!achado) return 'não é do Norte'
  const { ref, assinatura } = achado
  const orgId = ref.orgId

  const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { id: true, plano: true, situacao: true } }))
  if (!org) return 'empresa não existe'
  const ja = await comoOrg(orgId, (db) => db.auditoria.findFirst({ where: { acao: MARCA, alvoId: p.id }, select: { id: true } }))
  if (ja) return 'já processado'

  const pagoCent = Math.round(p.value * 100)
  const dia = p.clientPaymentDate || p.paymentDate || p.confirmedDate || diaEmSP()
  const pagoEm = new Date(`${dia.slice(0, 10)}T12:00:00-03:00`)
  const forma = FORMA[p.billingType] ?? 'transferencia'
  const marcar = (oQue: string) =>
    comoOrg(orgId, (db) =>
      db.auditoria.create({
        data: {
          orgId,
          quem: 'Asaas',
          autor: 'SISTEMA',
          acao: MARCA,
          alvoTipo: 'cobranca',
          alvoId: p.id,
          alvoNome: oQue,
          depois: { valor: p.value, forma, tipo: ref.tipo },
        },
      }),
    )

  if (ref.tipo === 'p') {
    // Pacote não tem chave única no banco: a marca vem ANTES, para um aviso
    // repetido no meio do caminho não dar o pacote duas vezes.
    await marcar(`pacote de respostas (${reais(pagoCent)})`)
    const pedido = pedidoAberto(await eventosDePedido(orgId), 'respostas')
    await atenderPacoteDeRespostas(orgId, { motivo: `Pago no Asaas (${p.id})`, quem: 'Asaas', pedidoId: pedido?.id ?? null, pacote: ref.pacote })
    return 'pacote entregue'
  }

  const referencia = ref.tipo === 'm' ? ref.referencia : p.dueDate.slice(0, 7)
  const cheioCent = Math.max(pagoCent, ref.tipo === 'm' ? ref.cheioCent : Math.round((assinatura?.value ?? p.value) * 100))

  if (ref.tipo === 'm' && (org.plano !== ref.plano || org.situacao === 'TESTE')) {
    const pedido = pedidoAberto(await eventosDePedido(orgId), 'plano')
    try {
      await trocarPlanoPelaEquipe(orgId, ref.plano, { motivo: `Primeira mensalidade paga no Asaas (${p.id})`, quem: 'Asaas', pedidoId: pedido?.id ?? null })
    } catch (e) {
      // Pago, mas o plano não cabe (loja demais, por exemplo): o pagamento
      // entra igual, e o pedido fica aberto para a equipe resolver.
      console.error('[asaas] pago, mas o plano não foi aplicado', orgId, (e as Error).message)
    }
  }

  try {
    await registrarPagamento(orgId, {
      referencia,
      valorCheioCent: cheioCent,
      valorPagoCent: pagoCent,
      forma,
      pagoEm,
      quem: 'Asaas',
      observacao: `Asaas ${p.id}`,
    })
  } catch (e) {
    if (!(e instanceof PagamentoRepetido)) throw e
  }

  if (org.situacao === 'INADIMPLENTE') {
    await comoOrg(orgId, (db) => db.org.updateMany({ where: { id: orgId, situacao: 'INADIMPLENTE' }, data: { situacao: 'ATIVA' } }))
  }

  // O primeiro mês pago faz nascer a assinatura, do mês seguinte em diante.
  // Até o dia 28: o dia 31 não existe em todo mês.
  const proximaCobranca = mesSeguinte(diaEmSP(pagoEm))
  const c = await comoOrg(orgId, (db) => db.cobranca.findUnique({ where: { orgId }, select: { assinaturaId: true } }))
  let assinaturaId = c?.assinaturaId ?? null
  if (ref.tipo === 'm' && !assinaturaId) {
    const s = await chamar<AssinaturaAsaas>('POST', '/subscriptions', {
      customer: p.customer,
      billingType: 'UNDEFINED',
      value: ref.cheioCent / 100,
      nextDueDate: proximaCobranca,
      cycle: 'MONTHLY',
      description: `Norte · plano ${PLANOS[ref.plano].titulo} · mensalidade`,
      externalReference: escreverReferencia({ tipo: 's', orgId }),
    })
    assinaturaId = s.id
  }
  const dados = {
    provedor: 'asaas',
    assinaturaId,
    pagoAte: new Date(`${proximaCobranca}T23:59:59-03:00`),
    proximaCobranca: new Date(`${proximaCobranca}T12:00:00-03:00`),
    tentativas: 0,
    ...(ref.tipo === 'm' ? { valorMensal: ref.cheioCent / 100 } : {}),
  }
  await comoOrg(orgId, (db) => db.cobranca.upsert({ where: { orgId }, create: { orgId, ...dados }, update: dados }))

  await marcar(ref.tipo === 'm' ? `primeira mensalidade (${reais(pagoCent)})` : `mensalidade ${referencia} (${reais(pagoCent)})`)
  return ref.tipo === 'm' ? 'assinatura começou' : 'mensalidade paga'
}

/** A mensalidade venceu sem pagamento: a empresa fica em atraso (o acesso continua). */
async function marcarAtraso(pagamentoId: string): Promise<void> {
  const p = await chamar<PagamentoAsaas>('GET', `/payments/${pagamentoId}`)
  if (p.deleted || p.status !== 'OVERDUE' || !p.subscription) return
  const achado = await referenciaDe(p)
  if (achado?.ref.tipo !== 's') return
  const orgId = achado.ref.orgId
  await comoOrg(orgId, async (db) => {
    const mudou = await db.org.updateMany({ where: { id: orgId, situacao: 'ATIVA' }, data: { situacao: 'INADIMPLENTE' } })
    await db.cobranca.updateMany({ where: { orgId }, data: { tentativas: { increment: 1 } } })
    if (mudou.count > 0) {
      await db.auditoria.create({
        data: {
          orgId,
          quem: 'Asaas',
          autor: 'SISTEMA',
          acao: 'asaas.atrasou',
          alvoTipo: 'cobranca',
          alvoId: p.id,
          alvoNome: `mensalidade ${p.dueDate.slice(0, 7)} (${reais(Math.round(p.value * 100))})`,
        },
      })
    }
  })
}
