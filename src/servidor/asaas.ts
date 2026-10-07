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
//   norte:u:<org>:<plano>:<novoCent>              subir de plano já assinado
//
// ── subir de plano é pago; descer, não ───────────────────────
// Quem já assina e SOBE de plano paga a diferença proporcional aos dias que
// faltam até a próxima mensalidade, e o plano novo liga quando o dinheiro
// entra. Antes subia na hora e só a mensalidade seguinte mudava: dava para
// subir no dia seguinte ao pagamento, usar o mês inteiro e descer na véspera
// da cobrança — o plano caro pelo preço do barato, todo mês. Descer continua
// na hora (quem desce já pagou o mês pelo preço maior).
//
// ── a mensalidade acompanha a empresa ───────────────────────
// A conta do mês depende das lojas, das unidades de fábrica e das marcas do
// Farol, não só do plano. Abrir uma loja (ou fechar) muda o valor da
// assinatura no Asaas (`sincronizarMensalidade`), e todo pagamento recebido
// confere de novo — senão a loja nova saía de graça para sempre.
//
// ── um aviso de cada vez ─────────────────────────────────────
// O Asaas manda mais de um aviso para o mesmo pagamento (CONFIRMED e
// RECEIVED chegam juntos no boleto), e a porta responde na hora e trabalha
// depois — os dois trabalhos corriam juntos, passavam os dois pela
// conferência de "já processado" e criavam DUAS assinaturas: a empresa
// pagava em dobro todo mês. Agora o trabalho de cada empresa entra numa fila
// (`emFila`), e antes de criar a assinatura procuramos no próprio Asaas se
// ela já existe.
//
// ── estorno ──────────────────────────────────────────────────
// Pagamento estornado (ou contestado no cartão) estorna as comissões que
// ainda não foram pagas aos parceiros. O plano não volta sozinho: a equipe
// decide (a auditoria marca `asaas.estornou`).
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
import { assinaturaDaEmpresa } from './assinatura'

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
type AssinaturaAsaas = { id: string; value: number; externalReference?: string | null; status?: string; deleted?: boolean; customer?: string }
type Lista<T> = { data: T[] }

// ─────────────────────────────────────────────────────────────
// A REFERÊNCIA
// ─────────────────────────────────────────────────────────────

export type Referencia =
  | { tipo: 'm'; orgId: string; plano: Plano; referencia: string; cheioCent: number }
  | { tipo: 's'; orgId: string }
  | { tipo: 'p'; orgId: string; pacote: Pacote }
  | { tipo: 'u'; orgId: string; plano: Plano; novoCent: number }

export function escreverReferencia(r: Referencia): string {
  if (r.tipo === 'm') return `norte:m:${r.orgId}:${r.plano}:${r.referencia}:${r.cheioCent}`
  if (r.tipo === 's') return `norte:s:${r.orgId}`
  if (r.tipo === 'u') return `norte:u:${r.orgId}:${r.plano}:${r.novoCent}`
  return `norte:p:${r.orgId}:${r.pacote}`
}

export function lerReferencia(texto: string | null | undefined): Referencia | null {
  const p = String(texto ?? '').split(':')
  if (p[0] !== 'norte' || !p[2] || !/^[a-z0-9]{10,40}$/i.test(p[2])) return null
  const orgId = p[2]
  if (p[1] === 's' && p.length === 3) return { tipo: 's', orgId }
  if (p[1] === 'p' && p.length === 4 && ehPacote(p[3])) return { tipo: 'p', orgId, pacote: p[3] as Pacote }
  if (p[1] === 'u' && p.length === 5 && p[3]! in PLANOS && /^\d+$/.test(p[4]!)) {
    return { tipo: 'u', orgId, plano: p[3] as Plano, novoCent: Number(p[4]) }
  }
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

/** O Asaas não cobra menos que isto (R$ 5,00). */
export const MINIMO_ASAAS_CENT = 500

/**
 * Subir de plano já assinado: a diferença proporcional aos dias que faltam
 * até a próxima mensalidade. Abaixo do mínimo do Asaas, nada a cobrar
 * (`null`): quem chama sobe na hora.
 */
export async function cobrarDiferenca(
  orgId: string,
  d: { plano: Plano; atualCent: number; novoCent: number; agora?: Date },
): Promise<{ invoiceUrl: string; valorCent: number; dias: number } | null> {
  const agora = d.agora ?? new Date()
  const c = await comoOrg(orgId, (db) => db.cobranca.findUnique({ where: { orgId }, select: { proximaCobranca: true } }))
  const ate = c?.proximaCobranca?.getTime() ?? agora.getTime() + 30 * 864e5
  const dias = Math.min(31, Math.max(1, Math.ceil((ate - agora.getTime()) / 864e5)))
  const valorCent = Math.round(((d.novoCent - d.atualCent) * Math.min(dias, 30)) / 30)
  if (valorCent < MINIMO_ASAAS_CENT) return null
  const cliente = await clienteDa(orgId, null, null)
  const r = await cobrancaAvulsa(
    cliente,
    { tipo: 'u', orgId, plano: d.plano, novoCent: d.novoCent },
    valorCent,
    `Norte · troca para o plano ${PLANOS[d.plano].titulo} · diferença de ${dias} dia${dias === 1 ? '' : 's'} até a próxima mensalidade`,
  )
  return { invoiceUrl: r.invoiceUrl, valorCent, dias }
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

/**
 * A assinatura do Asaas com o valor que a empresa deve HOJE: o plano, as
 * lojas além da cota, a fábrica e as marcas do Farol. Chamada quando abre,
 * fecha ou muda uma loja, quando muda o Farol, e a cada mensalidade paga.
 * Nunca derruba quem chamou: falhou, fica no log e a próxima chamada acerta.
 */
export async function sincronizarMensalidade(orgId: string): Promise<'mudou' | 'cancelou' | 'sem-assinatura' | 'igual' | 'falhou'> {
  if (!asaasLigado()) return 'sem-assinatura'
  try {
    const c = await comoOrg(orgId, (db) => db.cobranca.findUnique({ where: { orgId }, select: { provedor: true, assinaturaId: true, valorMensal: true } }))
    if (c?.provedor !== 'asaas' || !c.assinaturaId) return 'sem-assinatura'
    const a = await assinaturaDaEmpresa(orgId)
    if (a.mensal.total === null) return 'igual'
    const devido = Math.round(a.mensal.total * 100)
    if (Math.round(Number(c.valorMensal ?? 0) * 100) === devido) return 'igual'
    return await ajustarAssinatura(orgId, devido)
  } catch (e) {
    console.error('[asaas] não deu para acertar a mensalidade', orgId, (e as Error).message)
    return 'falhou'
  }
}

// ─────────────────────────────────────────────────────────────
// O AVISO DO ASAAS (/api/asaas)
// ─────────────────────────────────────────────────────────────

const PAGO = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'])
const EVENTOS_DE_PAGO = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'])
/** O dinheiro voltou para quem pagou: estorno, ou contestação no cartão. */
export const EVENTOS_DE_ESTORNO = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'])

/**
 * Um trabalho de cada vez por chave (a empresa). O Norte roda num processo
 * só; num segundo processo, quem segura a assinatura dobrada é a procura no
 * Asaas antes de criar (`assinaturaQueJaExiste`).
 */
const filas = new Map<string, Promise<unknown>>()
function emFila<T>(chave: string, trabalho: () => Promise<T>): Promise<T> {
  const antes = filas.get(chave) ?? Promise.resolve()
  const vez = antes.catch(() => undefined).then(trabalho)
  filas.set(chave, vez)
  void vez.finally(() => {
    if (filas.get(chave) === vez) filas.delete(chave)
  }).catch(() => undefined)
  return vez
}

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
  if (EVENTOS_DE_ESTORNO.has(aviso.event ?? '')) return { status: 200, trabalho: () => estornarPagamento(id).then(() => undefined) }
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
  return emFila(achado.ref.orgId, () => processarDaEmpresa(p, achado.ref, achado.assinatura))
}

/** A assinatura desta empresa que já existe no Asaas (ativa), se houver. */
async function assinaturaQueJaExiste(cliente: string, orgId: string): Promise<string | null> {
  const ref = encodeURIComponent(escreverReferencia({ tipo: 's', orgId }))
  const l = await chamar<Lista<AssinaturaAsaas>>('GET', `/subscriptions?customer=${encodeURIComponent(cliente)}&externalReference=${ref}`)
  return l.data.find((s) => !s.deleted && s.status !== 'INACTIVE' && s.status !== 'EXPIRED')?.id ?? null
}

async function processarDaEmpresa(p: PagamentoAsaas, ref: Referencia, assinatura: AssinaturaAsaas | null): Promise<string> {
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

  if (ref.tipo === 'u') {
    // A diferença paga: o plano sobe e a mensalidade passa ao valor novo.
    // A marca vem antes, como no pacote.
    await marcar(`diferença para o plano ${PLANOS[ref.plano].titulo} (${reais(pagoCent)})`)
    const pedido = pedidoAberto(await eventosDePedido(orgId), 'plano')
    try {
      await trocarPlanoPelaEquipe(orgId, ref.plano, { motivo: `Diferença paga no Asaas (${p.id})`, quem: 'Asaas', pedidoId: pedido?.id ?? null })
    } catch (e) {
      await avisarEquipe(orgId, p.id, `pago, mas o plano ${PLANOS[ref.plano].titulo} não foi aplicado: ${(e as Error).message}`)
      return 'pago, plano pendente'
    }
    await ajustarAssinatura(orgId, ref.novoCent)
    return 'plano subiu'
  }

  const referencia = ref.tipo === 'm' ? ref.referencia : p.dueDate.slice(0, 7)
  const cheioCent = Math.max(pagoCent, ref.tipo === 'm' ? ref.cheioCent : Math.round((assinatura?.value ?? p.value) * 100))

  if (ref.tipo === 'm' && (org.plano !== ref.plano || org.situacao === 'TESTE')) {
    const pedido = pedidoAberto(await eventosDePedido(orgId), 'plano')
    try {
      await trocarPlanoPelaEquipe(orgId, ref.plano, { motivo: `Primeira mensalidade paga no Asaas (${p.id})`, quem: 'Asaas', pedidoId: pedido?.id ?? null })
    } catch (e) {
      // Pago, mas o plano não cabe (loja demais, por exemplo): o pagamento
      // entra igual, e o pedido fica aberto para a equipe resolver — com a
      // marca na auditoria, para não depender de alguém ler o log.
      await avisarEquipe(orgId, p.id, `pago, mas o plano ${PLANOS[ref.plano].titulo} não foi aplicado: ${(e as Error).message}`)
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
  // Até o dia 28: o dia 31 não existe em todo mês. A mensalidade paga
  // empurra para o vencimento SEGUINTE ao dela (pagar atrasado não muda o dia).
  const proximaCobranca = mesSeguinte(ref.tipo === 'm' ? diaEmSP(pagoEm) : p.dueDate.slice(0, 10))
  const c = await comoOrg(orgId, (db) => db.cobranca.findUnique({ where: { orgId }, select: { assinaturaId: true } }))
  let assinaturaId = c?.assinaturaId ?? null
  if (ref.tipo === 'm' && !assinaturaId) assinaturaId = await assinaturaQueJaExiste(p.customer, orgId)
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
  // A mensalidade seguinte com o valor de hoje (abriu loja no meio do mês?).
  if (ref.tipo === 's') await sincronizarMensalidade(orgId)
  return ref.tipo === 'm' ? 'assinatura começou' : 'mensalidade paga'
}

/** Uma marca na auditoria para a equipe resolver (aparece no console e na Auditoria). */
async function avisarEquipe(orgId: string, pagamentoId: string, oQue: string): Promise<void> {
  console.error('[asaas]', orgId, oQue)
  await comoOrg(orgId, (db) =>
    db.auditoria.create({
      data: { orgId, quem: 'Asaas', autor: 'SISTEMA', acao: 'asaas.pendente', alvoTipo: 'cobranca', alvoId: pagamentoId, alvoNome: oQue.slice(0, 200) },
    }),
  )
}

/**
 * O dinheiro voltou (estorno, ou contestação no cartão): as comissões deste
 * pagamento que ainda não foram repassadas saem da conta dos parceiros. As já
 * pagas ficam como estão — a equipe acerta no repasse seguinte, se for o caso.
 */
export async function estornarPagamento(pagamentoId: string): Promise<string> {
  const p = await chamar<PagamentoAsaas>('GET', `/payments/${pagamentoId}`)
  const achado = await referenciaDe(p)
  if (!achado) return 'não é do Norte'
  const orgId = achado.ref.orgId
  return emFila(orgId, () =>
    comoOrg(orgId, async (db) => {
      const ja = await db.auditoria.findFirst({ where: { acao: 'asaas.estornou', alvoId: p.id }, select: { id: true } })
      if (ja) return 'já estornado'
      const pago = await db.pagamentoNorte.findFirst({ where: { orgId, observacao: `Asaas ${p.id}` }, select: { id: true, referencia: true } })
      const r = pago
        ? await db.comissao.updateMany({ where: { pagamentoId: pago.id, repasseId: null, estornadaEm: null }, data: { estornadaEm: new Date() } })
        : { count: 0 }
      await db.auditoria.create({
        data: {
          orgId,
          quem: 'Asaas',
          autor: 'SISTEMA',
          acao: 'asaas.estornou',
          alvoTipo: 'cobranca',
          alvoId: p.id,
          alvoNome: `${pago ? `mensalidade ${pago.referencia}` : 'cobrança'} estornada (${reais(Math.round(p.value * 100))})`,
          depois: { comissoesEstornadas: r.count, status: p.status },
        },
      })
      return r.count > 0 ? `${r.count} comissão(ões) estornada(s)` : 'estornado, sem comissão a desfazer'
    }),
  )
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
