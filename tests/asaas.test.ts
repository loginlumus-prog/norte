// A cobrança pelo Asaas (servidor/asaas.ts), com banco de verdade e um Asaas
// de mentira: gerar a cobrança, receber o aviso, conferir no "Asaas", ligar o
// plano, registrar o pagamento (com o desconto de indicação) e não fazer nada
// duas vezes quando o aviso se repete.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'

let db: PGlite
let servidor: PGLiteSocketServer
let a: typeof import('../src/servidor/asaas')
let banco: typeof import('../src/servidor/banco')

// ── o Asaas de mentira ──
type Pag = { id: string; customer: string; status: string; value: number; billingType: string; dueDate: string; externalReference?: string; subscription?: string; invoiceUrl: string; paymentDate?: string }
const asaas = {
  clientes: [] as { id: string; externalReference: string; cpfCnpj: string }[],
  pagamentos: [] as Pag[],
  assinaturas: [] as { id: string; value: number; externalReference: string; nextDueDate: string }[],
  apagados: [] as string[],
}
let seq = 0
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

async function falso(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = new URL(String(url))
  const caminho = u.pathname.replace(/^\/v3/, '')
  const metodo = init?.method ?? 'GET'
  const corpo = init?.body ? JSON.parse(String(init.body)) : {}
  if ((init?.headers as Record<string, string>)?.access_token !== 'chave-de-teste') return json({ errors: [{ description: 'chave' }] }, 401)
  if (metodo === 'GET' && caminho === '/customers') {
    return json({ data: asaas.clientes.filter((c) => c.externalReference === u.searchParams.get('externalReference')) })
  }
  if (metodo === 'POST' && caminho === '/customers') {
    const c = { id: `cus_${++seq}`, externalReference: corpo.externalReference, cpfCnpj: corpo.cpfCnpj }
    asaas.clientes.push(c)
    return json(c)
  }
  if (metodo === 'GET' && caminho === '/payments') {
    return json({ data: asaas.pagamentos.filter((p) => p.customer === u.searchParams.get('customer') && p.status === u.searchParams.get('status')) })
  }
  if (metodo === 'POST' && caminho === '/payments') {
    const p: Pag = { id: `pay_${++seq}`, customer: corpo.customer, status: 'PENDING', value: corpo.value, billingType: 'UNDEFINED', dueDate: corpo.dueDate, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}` }
    asaas.pagamentos.push(p)
    return json(p)
  }
  const pg = caminho.match(/^\/payments\/(\w+)$/)
  if (pg && metodo === 'GET') {
    const p = asaas.pagamentos.find((x) => x.id === pg[1])
    return p ? json(p) : json({ errors: [{ description: 'não achei' }] }, 404)
  }
  if (pg && metodo === 'DELETE') {
    asaas.apagados.push(pg[1]!)
    asaas.pagamentos = asaas.pagamentos.filter((x) => x.id !== pg[1])
    return json({ deleted: true })
  }
  if (metodo === 'POST' && caminho === '/subscriptions') {
    const s = { id: `sub_${++seq}`, value: corpo.value, externalReference: corpo.externalReference, nextDueDate: corpo.nextDueDate }
    asaas.assinaturas.push(s)
    return json(s)
  }
  const sb = caminho.match(/^\/subscriptions\/(\w+)$/)
  if (sb && metodo === 'GET') return json(asaas.assinaturas.find((x) => x.id === sb[1]))
  if (sb && metodo === 'POST') {
    const s = asaas.assinaturas.find((x) => x.id === sb[1])!
    s.value = corpo.value
    return json(s)
  }
  return json({ errors: [{ description: `rota ${metodo} ${caminho}` }] }, 404)
}

const linha = async <T>(sql: string) => (await db.query<T>(sql)).rows

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.ASAAS_API_KEY = 'chave-de-teste'
  delete process.env.ASAAS_WEBHOOK_TOKEN
  db = await subirBanco()
  await db.exec(`
    insert into orgs (id, nome, slug, plano, situacao, teste_ate, modulos, atualizada_em) values
      ('orgsorveteria01', 'Sorveteria', 'sorveteria', 'BALCAO_AGENTE', 'TESTE', now() + interval '20 days', '{}', now());
    insert into unidades (id, org_id, nome, eh_deposito, eh_fabrica, ativa, atualizada_em) values
      ('uni-a', 'orgsorveteria01', 'Loja A', false, false, true, now());
  `)
  const porta = 56000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  a = await import('../src/servidor/asaas')
  banco = await import('../src/servidor/banco')
  a.trocarConexaoAsaas(falso as typeof fetch)
}, 60_000)

afterAll(async () => {
  a?.trocarConexaoAsaas(null)
  delete process.env.ASAAS_API_KEY
  await banco?.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

describe('a referência', () => {
  it('vai e volta, e recusa o que não é do Norte', () => {
    const r = { tipo: 'm', orgId: 'orgsorveteria01', plano: 'BALCAO', referencia: '2026-10', cheioCent: 14990 } as const
    expect(a.lerReferencia(a.escreverReferencia(r))).toEqual(r)
    expect(a.lerReferencia('norte:p:orgsorveteria01:grande')).toEqual({ tipo: 'p', orgId: 'orgsorveteria01', pacote: 'grande' })
    expect(a.lerReferencia('outra:coisa')).toBeNull()
    expect(a.lerReferencia('norte:m:orgsorveteria01:NAOEXISTE:2026-10:1')).toBeNull()
    expect(a.mesSeguinte('2026-12-31')).toBe('2027-01-28')
    expect(a.mesSeguinte('2026-10-06')).toBe('2026-11-06')
  })
})

describe('assinar e pagar', () => {
  it('sem CPF/CNPJ, pede; com ele, gera uma cobrança só, mesmo clicando duas vezes', async () => {
    await expect(a.cobrarPrimeiroMes('orgsorveteria01', { plano: 'BALCAO_AGENTE', mensalCent: 14990, documento: null, email: null })).rejects.toBeInstanceOf(a.FaltaDocumento)
    await expect(a.cobrarPrimeiroMes('orgsorveteria01', { plano: 'BALCAO_AGENTE', mensalCent: 14990, documento: '111.111.111-11', email: null })).rejects.toThrow('não confere')

    const c1 = await a.cobrarPrimeiroMes('orgsorveteria01', { plano: 'BALCAO_AGENTE', mensalCent: 14990, documento: '529.982.247-25', email: null })
    expect(c1.pagarCent).toBe(14990)
    const c2 = await a.cobrarPrimeiroMes('orgsorveteria01', { plano: 'BALCAO_AGENTE', mensalCent: 14990, documento: null, email: null })
    expect(c2.invoiceUrl).toBe(c1.invoiceUrl)
    expect(asaas.pagamentos).toHaveLength(1)
    // O documento ficou guardado na empresa.
    expect((await linha<{ documento: string }>(`select documento from orgs where id = 'orgsorveteria01'`))[0]!.documento).toBe('52998224725')

    // Trocou de plano antes de pagar: a cobrança velha sai, nasce outra.
    await a.cobrarPrimeiroMes('orgsorveteria01', { plano: 'BALCAO', mensalCent: 8990, documento: null, email: null })
    expect(asaas.pagamentos).toHaveLength(1)
    expect(asaas.apagados).toHaveLength(1)
    await a.cobrarPrimeiroMes('orgsorveteria01', { plano: 'BALCAO_AGENTE', mensalCent: 14990, documento: null, email: null })
  })

  it('o aviso: token errado é recusado; aviso de outro evento não faz nada', () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token-certo'
    expect(a.receberAvisoAsaas('{}', 'errado').status).toBe(401)
    expect(a.receberAvisoAsaas(JSON.stringify({ event: 'PAYMENT_CREATED', payment: { id: 'pay_1' } }), 'token-certo')).toEqual({ status: 200 })
    expect(a.receberAvisoAsaas(JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } }), 'token-certo').trabalho).toBeTypeOf('function')
    delete process.env.ASAAS_WEBHOOK_TOKEN
  })

  it('pagamento ainda em aberto não liga nada (o aviso não é acreditado sozinho)', async () => {
    const p = asaas.pagamentos[0]!
    expect(await a.processarPagamento(p.id)).toBe('não está pago')
    expect((await linha<{ situacao: string }>(`select situacao from orgs where id = 'orgsorveteria01'`))[0]!.situacao).toBe('TESTE')
  })

  it('pago: o teste vira assinatura, o mês entra no livro e nasce a mensalidade no Asaas — uma vez só', async () => {
    const p = asaas.pagamentos[0]!
    p.status = 'RECEIVED'
    p.billingType = 'PIX'
    p.paymentDate = '2026-10-06'
    expect(await a.processarPagamento(p.id)).toBe('assinatura começou')
    expect(await a.processarPagamento(p.id)).toBe('já processado')

    const [org] = await linha<{ situacao: string; plano: string }>(`select situacao, plano from orgs where id = 'orgsorveteria01'`)
    expect(org).toEqual({ situacao: 'ATIVA', plano: 'BALCAO_AGENTE' })
    const pagos = await linha<{ valor_pago: string; forma: string }>(`select valor_pago::text, forma from pagamentos_norte where org_id = 'orgsorveteria01'`)
    expect(pagos).toHaveLength(1)
    expect(Number(pagos[0]!.valor_pago)).toBe(149.9)
    expect(pagos[0]!.forma).toBe('pix')
    expect(asaas.assinaturas).toHaveLength(1)
    expect(asaas.assinaturas[0]).toMatchObject({ value: 149.9, nextDueDate: '2026-11-06', externalReference: 'norte:s:orgsorveteria01' })
    const [c] = await linha<{ provedor: string; assinatura_id: string }>(`select provedor, assinatura_id from cobranca where org_id = 'orgsorveteria01'`)
    expect(c).toEqual({ provedor: 'asaas', assinatura_id: asaas.assinaturas[0]!.id })
  })

  it('o mês seguinte chega pela assinatura; vencido, a empresa fica em atraso e volta quando paga', async () => {
    const s = asaas.assinaturas[0]!
    const p: Pag = { id: 'pay_mes2', customer: asaas.clientes[0]!.id, status: 'OVERDUE', value: 149.9, billingType: 'BOLETO', dueDate: '2026-11-06', subscription: s.id, invoiceUrl: 'x' }
    asaas.pagamentos.push(p)
    await a.receberAvisoAsaas(JSON.stringify({ event: 'PAYMENT_OVERDUE', payment: { id: p.id } }), null).trabalho!()
    expect((await linha<{ situacao: string }>(`select situacao from orgs where id = 'orgsorveteria01'`))[0]!.situacao).toBe('INADIMPLENTE')

    p.status = 'RECEIVED'
    p.paymentDate = '2026-11-08'
    expect(await a.processarPagamento(p.id)).toBe('mensalidade paga')
    expect((await linha<{ situacao: string }>(`select situacao from orgs where id = 'orgsorveteria01'`))[0]!.situacao).toBe('ATIVA')
    const refs = await linha<{ referencia: string }>(`select referencia from pagamentos_norte where org_id = 'orgsorveteria01' order by referencia`)
    expect(refs.map((r) => r.referencia)).toEqual(['2026-10', '2026-11'])
  })

  it('mudar de plano depois acompanha no Asaas', async () => {
    expect(await a.ajustarAssinatura('orgsorveteria01', 8990)).toBe('mudou')
    expect(asaas.assinaturas[0]!.value).toBe(89.9)
  })

  it('o pacote de respostas entra quando o pagamento cai, e só uma vez', async () => {
    const c = await a.cobrarPacote('orgsorveteria01', { pacote: 'pequeno', documento: null, email: null })
    const p = asaas.pagamentos.find((x) => x.invoiceUrl === c.invoiceUrl)!
    p.status = 'CONFIRMED'
    p.billingType = 'CREDIT_CARD'
    expect(await a.processarPagamento(p.id)).toBe('pacote entregue')
    expect(await a.processarPagamento(p.id)).toBe('já processado')
  })
})
