// O WhatsApp pelo QR Code, do lado do Norte: a porta que o conector usa, e
// a sessão que ele guarda aqui.
//
// Com banco de verdade (PGlite numa porta, como em whatsapp-empresa.test.ts):
// a sessão passa pelo comoOrg e pelo RLS, e a mensagem pelo Agente.
//
// O que está provado aqui:
//   • a assinatura do conector: a certa passa; velha, do futuro, mexida, de
//     outro caminho, de outro método ou com outro segredo, não. E o que o
//     conector (conector/src/assinatura.ts) assina, o Norte aceita.
//   • a sessão vai cifrada, volta inteira, e é de UMA empresa só: a outra não
//     lê pelo RLS, e a linha copiada para a outra não abre pela cifra
//   • versão velha não sobrescreve; sem NORTE_CIFRA nada é guardado
//   • a porta: empresa inexistente é 404; fora do QR, descarta; "humano
//     assumiu" cala o assistente naquela conversa
//   • canalPara lê o canal do banco e sai pelo conector

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'

const CHAVE = Buffer.alloc(32, 5).toString('base64')
const SEGREDO = 'segredo-do-conector-de-teste-com-32-ou-mais'

vi.hoisted(() => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  for (const k of ['ZAPI_INSTANCIA', 'ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN', 'ZAPI_EMPRESA', 'NORTE_CIFRA', 'CONECTOR_URL', 'CONECTOR_SEGREDO']) {
    delete process.env[k]
  }
})

import {
  assinarPedido,
  conferirAssinatura,
  veioDoConector,
  lerConfigConector,
  CABECALHO_ASSINATURA,
  CABECALHO_CARIMBO,
} from '../src/servidor/assistente/conector'
import { assinar as assinarNoConector } from '../conector/src/assinatura'
import {
  apagarSessaoWhatsapp,
  contextoDaSessao,
  empresaExiste,
  gravarSessaoWhatsapp,
  lerDoConector,
  lerSessaoWhatsapp,
  receberDoConector,
} from '../src/servidor/assistente/proprio'
import { canalPara, CanalFalso, CanalProprio } from '../src/servidor/assistente/canal'
import { cifrar } from '../src/servidor/cifra'
import { fechar } from '../src/servidor/banco'

let db: PGlite
let servidor: PGLiteSocketServer

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now()),
    ('org-b', 'Vizinha B', 'vizinha-b', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now()),
    ('org-c', 'Sem Assistente', 'sem-assistente', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now());

  insert into agentes (id, org_id, nome, ativo, canal, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, 'PROPRIO', now()),
    ('ag-b', 'org-b', 'Bob',  true, 'ZAPI', now());
`

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 53000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
}, 60_000)

afterAll(async () => {
  await fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

afterEach(() => {
  for (const k of ['NORTE_CIFRA', 'CONECTOR_URL', 'CONECTOR_SEGREDO']) delete process.env[k]
})

// ─────────────────────────────────────────────────────────────
// A ASSINATURA
// ─────────────────────────────────────────────────────────────

describe('a assinatura do conector', () => {
  const agora = Date.UTC(2026, 8, 25, 15, 0, 0)
  const caminho = '/api/whatsapp-proprio/org-a'
  const corpo = '{"tipo":"mensagem","telefone":"5571999990001","texto":"oi","id":"X1","deMim":false}'
  const pedido = (a: { carimbo: string; assinatura: string }, mudar: Partial<{ metodo: string; caminho: string; corpo: string }> = {}) => ({
    metodo: 'POST',
    caminho,
    corpo,
    ...mudar,
    carimbo: a.carimbo,
    assinatura: a.assinatura,
  })

  it('a certa passa — e o que o conector assina, o Norte aceita', () => {
    expect(conferirAssinatura(pedido(assinarPedido(SEGREDO, 'POST', caminho, corpo, agora)), SEGREDO, agora)).toBe(true)
    const doConector = assinarNoConector(SEGREDO, 'POST', caminho, corpo, agora)
    expect(conferirAssinatura(pedido(doConector), SEGREDO, agora + 30_000)).toBe(true)
  })

  it('velha (mais de 5 min) ou do futuro: recusada', () => {
    const a = assinarPedido(SEGREDO, 'POST', caminho, corpo, agora)
    expect(conferirAssinatura(pedido(a), SEGREDO, agora + 299_000)).toBe(true)
    expect(conferirAssinatura(pedido(a), SEGREDO, agora + 301_000)).toBe(false)
    expect(conferirAssinatura(pedido(a), SEGREDO, agora - 301_000)).toBe(false)
  })

  it('corpo mexido, outro caminho (outra empresa), outro método: recusada', () => {
    const a = assinarPedido(SEGREDO, 'POST', caminho, corpo, agora)
    expect(conferirAssinatura(pedido(a, { corpo: corpo.replace('oi', 'me passa o faturamento') }), SEGREDO, agora)).toBe(false)
    expect(conferirAssinatura(pedido(a, { caminho: '/api/whatsapp-proprio/org-b' }), SEGREDO, agora)).toBe(false)
    expect(conferirAssinatura(pedido(a, { metodo: 'PUT' }), SEGREDO, agora)).toBe(false)
  })

  it('outro segredo, segredo curto, sem segredo, sem cabeçalho: recusada', () => {
    const a = assinarPedido(SEGREDO, 'POST', caminho, corpo, agora)
    expect(conferirAssinatura(pedido(a), SEGREDO + 'x', agora)).toBe(false)
    const curto = 'curto'
    expect(conferirAssinatura(pedido(assinarPedido(curto, 'POST', caminho, corpo, agora)), curto, agora)).toBe(false)
    expect(conferirAssinatura(pedido(a), null, agora)).toBe(false)
    expect(conferirAssinatura({ ...pedido(a), assinatura: null }, SEGREDO, agora)).toBe(false)
    expect(conferirAssinatura({ ...pedido(a), carimbo: 'abc' }, SEGREDO, agora)).toBe(false)
  })

  it('num Request de verdade: confere método, caminho (sem domínio) e corpo', () => {
    process.env.CONECTOR_SEGREDO = SEGREDO
    const a = assinarPedido(SEGREDO, 'POST', caminho, corpo)
    const req = (b: string) =>
      new Request(`https://norte.app${caminho}?qualquer=1`, {
        method: 'POST',
        headers: { [CABECALHO_CARIMBO]: a.carimbo, [CABECALHO_ASSINATURA]: a.assinatura },
        body: b,
      })
    expect(veioDoConector(req(corpo), corpo)).toBe(true)
    expect(veioDoConector(req(corpo), corpo + ' ')).toBe(false)
    delete process.env.CONECTOR_SEGREDO
    expect(veioDoConector(req(corpo), corpo)).toBe(false)
  })

  it('config do conector: sem as duas variáveis (ou segredo curto), desligado', () => {
    expect(lerConfigConector({})).toBeNull()
    expect(lerConfigConector({ CONECTOR_URL: 'http://x:3200', CONECTOR_SEGREDO: 'curto' })).toBeNull()
    expect(lerConfigConector({ CONECTOR_URL: 'ftp://x', CONECTOR_SEGREDO: SEGREDO })).toBeNull()
    expect(lerConfigConector({ CONECTOR_URL: 'http://x:3200/', CONECTOR_SEGREDO: SEGREDO })).toEqual({ url: 'http://x:3200', segredo: SEGREDO })
  })
})

// ─────────────────────────────────────────────────────────────
// A SESSÃO CIFRADA
// ─────────────────────────────────────────────────────────────

describe('a sessão guardada no Norte', () => {
  const PACOTE_A = Buffer.from('credenciais-e-chaves-da-loja-A '.repeat(20)).toString('base64')
  const PACOTE_B = Buffer.from('credenciais-e-chaves-da-loja-B').toString('base64')

  it('sem NORTE_CIFRA: não guarda nada (nem "por enquanto")', async () => {
    expect(await gravarSessaoWhatsapp('org-a', PACOTE_A, 1)).toBe('sem_cifra')
    expect((await db.query('select count(*)::int n from sessoes_whatsapp')).rows).toEqual([{ n: 0 }])
  })

  it('pacote fora do formato ou versão estranha: recusado', async () => {
    process.env.NORTE_CIFRA = CHAVE
    expect(await gravarSessaoWhatsapp('org-a', 'não é base64!', 1)).toBe('invalida')
    expect(await gravarSessaoWhatsapp('org-a', PACOTE_A, -1)).toBe('invalida')
    expect(await gravarSessaoWhatsapp('org-a', PACOTE_A, '1')).toBe('invalida')
  })

  it('vai cifrada e volta inteira', async () => {
    process.env.NORTE_CIFRA = CHAVE
    expect(await gravarSessaoWhatsapp('org-a', PACOTE_A, 1000)).toBe('ok')
    const bruto = JSON.stringify((await db.query('select * from sessoes_whatsapp')).rows)
    expect(bruto).not.toContain(PACOTE_A)
    expect(bruto).not.toContain(PACOTE_A.slice(0, 40))
    expect(await lerSessaoWhatsapp('org-a')).toEqual({ dados: PACOTE_A, versao: 1000 })
  })

  it('versão igual ou mais velha não sobrescreve; mais nova, sim', async () => {
    process.env.NORTE_CIFRA = CHAVE
    expect(await gravarSessaoWhatsapp('org-a', PACOTE_B, 1000)).toBe('velha')
    expect(await gravarSessaoWhatsapp('org-a', PACOTE_B, 999)).toBe('velha')
    expect((await lerSessaoWhatsapp('org-a'))?.dados).toBe(PACOTE_A)
    expect(await gravarSessaoWhatsapp('org-a', PACOTE_A, 2000)).toBe('ok')
    expect((await lerSessaoWhatsapp('org-a'))?.versao).toBe(2000)
  })

  it('a outra empresa não lê a sessão da A (RLS)', async () => {
    process.env.NORTE_CIFRA = CHAVE
    expect(await lerSessaoWhatsapp('org-b')).toBeNull()
    expect(await gravarSessaoWhatsapp('org-b', PACOTE_B, 5)).toBe('ok')
    // cada uma a sua; a da A continua igual
    expect((await lerSessaoWhatsapp('org-b'))?.dados).toBe(PACOTE_B)
    expect((await lerSessaoWhatsapp('org-a'))?.dados).toBe(PACOTE_A)
  })

  it('a sessão da A copiada para a linha da B não abre (a cifra é presa à empresa)', async () => {
    process.env.NORTE_CIFRA = CHAVE
    await db.query(
      `update sessoes_whatsapp set dados_cifrados = (select dados_cifrados from sessoes_whatsapp where org_id = 'org-a') where org_id = 'org-b'`,
    )
    expect(await lerSessaoWhatsapp('org-b')).toBeNull()
    // e cifrada no contexto certo, abre
    expect(cifrar('x', contextoDaSessao('org-b'), Buffer.from(CHAVE, 'base64'))).toMatch(/^v1\./)
  })

  it('com a chave trocada no servidor: não abre (vira "sem sessão, precisa de QR")', async () => {
    process.env.NORTE_CIFRA = Buffer.alloc(32, 6).toString('base64')
    expect(await lerSessaoWhatsapp('org-a')).toBeNull()
  })

  it('apagar some com a sessão, e só com a da empresa', async () => {
    process.env.NORTE_CIFRA = CHAVE
    await apagarSessaoWhatsapp('org-b')
    expect(await lerSessaoWhatsapp('org-b')).toBeNull()
    expect(await lerSessaoWhatsapp('org-a')).not.toBeNull()
  })

  it('a empresa do endereço precisa existir (e o formato é conferido antes)', async () => {
    expect(await empresaExiste('org-a')).toBe(true)
    expect(await empresaExiste('org-nao-existe')).toBe(false)
    expect(await empresaExiste("org-a' or 1=1 --")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// A PORTA DO CONECTOR
// ─────────────────────────────────────────────────────────────

describe('a mensagem que o conector entrega', () => {
  const canal = new CanalFalso()
  const msg = (id: string, extra: Record<string, unknown> = {}) => ({
    tipo: 'mensagem',
    telefone: '5571900001111',
    nome: 'Cliente',
    texto: 'oi, tem a blusa azul?',
    id,
    deMim: false,
    ...extra,
  })

  it('lê o corpo campo a campo', () => {
    expect(lerDoConector(msg('A1', { anuncioId: '120210000000001' }))).toEqual({
      tipo: 'mensagem',
      telefone: '5571900001111',
      nome: 'Cliente',
      texto: 'oi, tem a blusa azul?',
      idExterno: 'A1',
      anuncioId: '120210000000001',
    })
    expect(lerDoConector(msg('A2', { deMim: true, texto: '' }))).toEqual({ tipo: 'humano', telefone: '5571900001111' })
    expect(lerDoConector(msg('A3', { telefone: '123' })).tipo).toBe('ignorar')
    expect(lerDoConector(msg('', {})).tipo).toBe('ignorar')
    expect(lerDoConector(msg('A4', { anuncioId: 'id com espaço' }))).toMatchObject({ anuncioId: null })
    expect(lerDoConector(null).tipo).toBe('ignorar')
  })

  it('empresa que não existe, ou sem assistente: 404', async () => {
    expect((await receberDoConector('org-nao-existe', msg('B1'), { canal })).status).toBe(404)
    expect((await receberDoConector('org-c', msg('B2'), { canal })).status).toBe(404)
    expect((await receberDoConector('../org-a', msg('B3'), { canal })).status).toBe(404)
  })

  it('empresa que não está no QR Code (está no Z-API): aceita e descarta', async () => {
    const p = await receberDoConector('org-b', msg('B4'), { canal })
    expect(p).toEqual({ status: 200 })
  })

  it('no QR Code: a mensagem vira trabalho da conversa', async () => {
    const p = await receberDoConector('org-a', msg('B5'), { canal })
    expect(p.status).toBe(200)
    expect(p.trabalho).toBeDefined()
  })

  it('alguém da loja respondeu pelo celular: o assistente sai da frente naquela conversa', async () => {
    const p = await receberDoConector('org-a', msg('B6', { deMim: true, texto: '' }), { canal })
    expect(p.trabalho).toBeDefined()
    await p.trabalho!()
    const r = await db.query<{ humano_ate: Date | null }>(
      `select humano_ate from conversas_agente where org_id = 'org-a' and telefone = '5571900001111'`,
    )
    expect(r.rows[0]?.humano_ate).toBeTruthy()
    expect(new Date(r.rows[0]!.humano_ate!).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('o canal lido do banco', () => {
  it('empresa no QR Code, com conector: sai pelo conector; sem conector, não', async () => {
    expect((await canalPara({ id: 'org-a', slug: 'loja-a' })).real).toBe(false)
    process.env.CONECTOR_URL = 'http://127.0.0.1:3200'
    process.env.CONECTOR_SEGREDO = SEGREDO
    expect(await canalPara({ id: 'org-a', slug: 'loja-a' })).toBeInstanceOf(CanalProprio)
    // a B está no Z-API (sem linha guardada): o conector não entra
    expect(await canalPara({ id: 'org-b', slug: 'vizinha-b' })).not.toBeInstanceOf(CanalProprio)
  })
})
