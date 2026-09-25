// O WhatsApp de cada empresa: a linha própria no Z-API, o endereço próprio
// do webhook, e o caminho de migração de quem estava na linha global.
//
// Com banco de verdade (PGlite exposto numa porta, como em
// `assistente-fluxo.test.ts`): a porta do webhook lê o Agente, e a tela grava
// nele — as duas coisas precisam passar pelo `comoOrg` e pelo RLS.
//
// O que está provado aqui:
//   • a escolha do canal: QR Code (canal PROPRIO + conector configurado) >
//     linha própria > global (só ZAPI_EMPRESA) > mentira
//   • token cifrado de uma empresa colado na linha de outra não abre
//   • o token entra e não sai: nem banco, nem tela, nem livro de auditoria
//   • sem NORTE_CIFRA, nada é guardado, e o recado diz o porquê
//   • o endereço próprio abre; o antigo (HMAC do slug) só enquanto a empresa
//     não gerou um; trocar derruba o anterior na hora
//   • a mensagem de teste sai pela linha da própria empresa

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'

const CHAVE = Buffer.alloc(32, 7).toString('base64')

vi.hoisted(() => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.WEBHOOK_SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-ok'
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste'
  for (const k of ['ZAPI_INSTANCIA', 'ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN', 'ZAPI_EMPRESA', 'ZAPI_URL', 'NORTE_CIFRA', 'CONECTOR_URL', 'CONECTOR_SEGREDO']) delete process.env[k]
})

import { cifrar } from '../src/servidor/cifra'
import { escolherCanal, canalPara, contextoDoToken, CanalZapi, CanalProprio } from '../src/servidor/assistente/canal'
import {
  receberWebhook,
  tokenDoWebhook,
  conferirTokenProprio,
  resumoDoToken,
  novoTokenDoWebhook,
  portaAbre,
  lerZapi,
} from '../src/servidor/assistente/webhook'
import {
  estadoDaConexao,
  salvarLinhaZapi,
  apagarLinhaZapi,
  gerarEnderecoDoWebhook,
  conectarCanal,
  desconectarCanal,
  mensagemDeTeste,
} from '../src/servidor/assistente/conexao'
import { CanalFalso } from '../src/servidor/assistente/canal'
import { fechar } from '../src/servidor/banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

const sessao = (orgId: string, usuarioId: string, papel: 'DONO' | 'BALCAO'): Sessao =>
  ({ orgId, usuarioId, nome: 'Fulana', acessos: [{ papel, unidadeId: papel === 'DONO' ? null : 'uni-a1', expiraEm: null }] }) as Sessao

const DONA_A = sessao('org-a', 'usr-ana', 'DONO')
const DONA_B = sessao('org-b', 'usr-bia', 'DONO')
const BALCAO_A = sessao('org-a', 'usr-beto', 'BALCAO')

const TOKEN_B = 'TokenDaInstanciaDaB0123456789ab12'
const CLIENT_B = 'ClientTokenDaContaB00000000cd34'
const INSTANCIA_B = '3C4B5D6E7F8A9B0C1D2E3F4A5B6C7D8E'

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now()),
    ('org-b', 'Vizinha B', 'vizinha-b', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now()),
    ('org-c', 'Sem Assistente', 'sem-assistente', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now());

  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro A', now()),
    ('uni-b1', 'org-b', 'Sul B', now());

  insert into usuarios (id, org_id, nome, email, telefone, atualizado_em) values
    ('usr-ana',  'org-a', 'Ana Dona',    'ana@a.com',  '(71) 99999-0001', now()),
    ('usr-beto', 'org-a', 'Beto Balcão', 'beto@a.com', null, now()),
    ('usr-bia',  'org-b', 'Bia Vizinha', 'bia@b.com',  '(11) 97777-0003', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-ana',  'org-a', 'usr-ana',  null,     'DONO'),
    ('ac-beto', 'org-a', 'usr-beto', 'uni-a1', 'BALCAO'),
    ('ac-bia',  'org-b', 'usr-bia',  null,     'DONO');

  insert into agentes (id, org_id, nome, ativo, canal, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, 'ZAPI', now()),
    ('ag-b', 'org-b', 'Bob',  true, 'NENHUM', now());
`

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 50000 + Math.floor(Math.random() * 3000)
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
  vi.unstubAllGlobals()
  for (const k of ['ZAPI_INSTANCIA', 'ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN', 'ZAPI_EMPRESA', 'NORTE_CIFRA', 'CONECTOR_URL', 'CONECTOR_SEGREDO']) delete process.env[k]
})

const SEGREDO_CONECTOR = 'segredo-do-conector-com-mais-de-32-caracteres'
const comConector = () => {
  process.env.CONECTOR_URL = 'http://conector.interno:3200'
  process.env.CONECTOR_SEGREDO = SEGREDO_CONECTOR
}

const comChave = () => {
  process.env.NORTE_CIFRA = CHAVE
}
const comGlobal = (empresa: string) => {
  process.env.ZAPI_INSTANCIA = 'INSTANCIA-GLOBAL'
  process.env.ZAPI_TOKEN = 'TOKEN-GLOBAL'
  process.env.ZAPI_CLIENT_TOKEN = 'CLIENT-GLOBAL'
  process.env.ZAPI_EMPRESA = empresa
}

/** Um `fetch` que grava para onde foi cada envio e responde "ok". */
function zapiFalso() {
  const pedidos: { url: string; headers: Record<string, string> }[] = []
  const buscar = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, headers: init.headers as Record<string, string> })
    return new Response('{"messageId":"m1"}', { status: 200 })
  }) as unknown as typeof fetch
  return { pedidos, buscar }
}

const tudoDoBanco = async () =>
  JSON.stringify([
    (await db.query(`select * from agentes`)).rows,
    (await db.query(`select * from auditoria`)).rows,
  ])

const zapi = (messageId: string) => ({
  type: 'ReceivedCallback',
  phone: '5571900001111',
  messageId,
  fromMe: false,
  text: { message: 'oi' },
})

// ─────────────────────────────────────────────────────────────
// A ESCOLHA DO CANAL
// ─────────────────────────────────────────────────────────────

const linhaVazia = { zapiInstancia: null, zapiTokenCifrado: null, zapiClientTokenCifrado: null }

describe('qual linha cada empresa usa', () => {
  const linhaDaB = () => ({
    zapiInstancia: INSTANCIA_B,
    zapiTokenCifrado: cifrar(TOKEN_B, contextoDoToken('org-b', 'zapi_token'), Buffer.from(CHAVE, 'base64')),
    zapiClientTokenCifrado: cifrar(CLIENT_B, contextoDoToken('org-b', 'zapi_client_token'), Buffer.from(CHAVE, 'base64')),
  })

  it('sem linha própria e sem global: o canal de mentira', () => {
    const r = escolherCanal({ id: 'org-a', slug: 'loja-a' }, null)
    expect(r.origem).toBe('nenhuma')
    expect(r.canal.real).toBe(false)
  })

  it('a global serve SÓ à empresa de ZAPI_EMPRESA', () => {
    comGlobal('loja-a')
    expect(escolherCanal({ id: 'org-a', slug: 'loja-a' }, null).origem).toBe('global')
    expect(escolherCanal({ id: 'org-b', slug: 'vizinha-b' }, null).origem).toBe('nenhuma')
  })

  it('a linha própria ganha de tudo — até da global, para a própria empresa do piloto', async () => {
    comChave()
    comGlobal('vizinha-b')
    const api = zapiFalso()
    const r = escolherCanal({ id: 'org-b', slug: 'vizinha-b' }, linhaDaB(), api.buscar)
    expect(r.origem).toBe('propria')
    expect(r.canal).toBeInstanceOf(CanalZapi)
    expect(await r.canal.enviar('(11) 97777-0003', 'oi')).toMatchObject({ ok: true })
    expect(api.pedidos[0]!.url).toBe(`https://api.z-api.io/instances/${INSTANCIA_B}/token/${TOKEN_B}/send-text`)
    expect(api.pedidos[0]!.headers['Client-Token']).toBe(CLIENT_B)
  })

  it('o token cifrado da B, colado na linha da A, não abre — e a A não sai pela linha da B', () => {
    comChave()
    const r = escolherCanal({ id: 'org-a', slug: 'loja-a' }, linhaDaB())
    expect(r.origem).toBe('nenhuma')
  })

  it('no QR Code (canal PROPRIO) com o conector configurado: o QR ganha de tudo', async () => {
    comChave()
    comConector()
    comGlobal('vizinha-b')
    const pedidos: { url: string; init: RequestInit }[] = []
    const buscar = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init })
      return new Response('{"ok":true,"id":"WA-1"}', { status: 200 })
    }) as unknown as typeof fetch
    const r = escolherCanal({ id: 'org-b', slug: 'vizinha-b' }, { ...linhaDaB(), canal: 'PROPRIO' }, buscar)
    expect(r.origem).toBe('qr')
    expect(r.canal).toBeInstanceOf(CanalProprio)
    expect(r.canal.real).toBe(true)
    expect(await r.canal.enviar('(11) 97777-0003', 'oi')).toEqual({ ok: true, id: 'WA-1' })
    expect(pedidos[0]!.url).toBe('http://conector.interno:3200/sessoes/org-b/enviar')
    expect((pedidos[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SEGREDO_CONECTOR}`)
    expect(JSON.parse(String(pedidos[0]!.init.body))).toEqual({ numero: '5511977770003', texto: 'oi' })
    // e mídia também sai pelo conector
    expect(await r.canal.enviarMidia!('(11) 97777-0003', { tipo: 'imagem', url: 'https://norte.app/x.jpg', legenda: 'olha' })).toMatchObject({ ok: true })
    expect(JSON.parse(String(pedidos[1]!.init.body))).toEqual({ numero: '5511977770003', midia: { tipo: 'imagem', url: 'https://norte.app/x.jpg', legenda: 'olha' } })
  })

  it('o conector recusou: o motivo dele volta, sem "ok"', async () => {
    comConector()
    const buscar = (async () => new Response('{"ok":false,"motivo":"limite diário de envios deste número"}', { status: 429 })) as unknown as typeof fetch
    const r = escolherCanal({ id: 'org-a', slug: 'loja-a' }, { ...linhaVazia, canal: 'PROPRIO' }, buscar)
    expect(await r.canal.enviar('(71) 99999-0001', 'oi')).toEqual({ ok: false, motivo: 'limite diário de envios deste número' })
  })

  it('no QR Code mas SEM conector neste servidor: cai para o Z-API da empresa (e depois para a global)', () => {
    comChave()
    comGlobal('vizinha-b')
    expect(escolherCanal({ id: 'org-b', slug: 'vizinha-b' }, { ...linhaDaB(), canal: 'PROPRIO' }).origem).toBe('propria')
    expect(escolherCanal({ id: 'org-b', slug: 'vizinha-b' }, { ...linhaVazia, canal: 'PROPRIO' }).origem).toBe('global')
    expect(escolherCanal({ id: 'org-a', slug: 'loja-a' }, { ...linhaVazia, canal: 'PROPRIO' }).origem).toBe('nenhuma')
  })

  it('conector configurado, mas a empresa está no Z-API (ou em nenhum): o QR não entra', () => {
    comChave()
    comConector()
    expect(escolherCanal({ id: 'org-b', slug: 'vizinha-b' }, { ...linhaDaB(), canal: 'ZAPI' }).origem).toBe('propria')
    expect(escolherCanal({ id: 'org-a', slug: 'loja-a' }, { ...linhaVazia, canal: 'NENHUM' }).origem).toBe('nenhuma')
  })

  it('com a chave trocada no servidor, a linha própria não abre (e não "tenta assim mesmo")', () => {
    process.env.NORTE_CIFRA = Buffer.alloc(32, 9).toString('base64')
    comGlobal('vizinha-b')
    // cai para a global, que é o que a B tinha antes
    expect(escolherCanal({ id: 'org-b', slug: 'vizinha-b' }, linhaDaB()).origem).toBe('global')
  })
})

// ─────────────────────────────────────────────────────────────
// A LINHA PRÓPRIA NA TELA
// ─────────────────────────────────────────────────────────────

describe('guardar a linha própria', () => {
  it('sem NORTE_CIFRA no servidor: recusa com recado claro e nada é gravado', async () => {
    const antes = await tudoDoBanco()
    const r = await salvarLinhaZapi(DONA_B, { instancia: INSTANCIA_B, token: TOKEN_B, clientToken: CLIENT_B })
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.erro).toMatch(/NORTE_CIFRA/)
    expect(await tudoDoBanco()).toBe(antes)
  })

  it('só quem configura o assistente guarda', async () => {
    comChave()
    await expect(salvarLinhaZapi(BALCAO_A, { instancia: INSTANCIA_B, token: TOKEN_B, clientToken: '' })).rejects.toThrow()
  })

  it('caractere de URL no token é recusado (ele vai no caminho da chamada)', async () => {
    comChave()
    const r = await salvarLinhaZapi(DONA_B, { instancia: INSTANCIA_B, token: 'abc/../../outra', clientToken: '' })
    expect(r).toMatchObject({ ok: false })
  })

  it('guarda cifrado: o token não está no banco, nem no livro, nem no que a tela recebe', async () => {
    comChave()
    const r = await salvarLinhaZapi(DONA_B, { instancia: INSTANCIA_B, token: TOKEN_B, clientToken: CLIENT_B })
    expect(r).toEqual({ ok: true })

    const tudo = await tudoDoBanco()
    expect(tudo).not.toContain(TOKEN_B)
    expect(tudo).not.toContain(CLIENT_B)
    expect(tudo).toContain('agente.zapi.salvou')

    const estado = await estadoDaConexao(DONA_B)
    expect(JSON.stringify(estado)).not.toContain(TOKEN_B)
    expect(JSON.stringify(estado)).not.toContain(CLIENT_B)
    expect(estado.linha).toEqual({
      instancia: INSTANCIA_B,
      token: { guardado: true, final: 'ab12' },
      clientToken: { guardado: true, final: 'cd34' },
    })
    expect(estado.origemCanal).toBe('propria')
    expect(estado.canalReal).toBe(true)
    // linha pronta, porta ainda fechada (canal NENHUM)
    expect(estado.situacao).toBe('desconectado')
  })

  it('campo de token vazio mantém o que está guardado', async () => {
    comChave()
    const r = await salvarLinhaZapi(DONA_B, { instancia: INSTANCIA_B, token: '', clientToken: '' })
    expect(r).toEqual({ ok: true })
    expect((await estadoDaConexao(DONA_B)).linha.token).toEqual({ guardado: true, final: 'ab12' })
  })

  it('canalPara lê a linha do banco e sai pela instância da própria empresa', async () => {
    comChave()
    const canal = await canalPara({ id: 'org-b', slug: 'vizinha-b' })
    expect(canal.real).toBe(true)
    // e a A, sem linha e sem global, continua no de mentira
    expect((await canalPara({ id: 'org-a', slug: 'loja-a' })).real).toBe(false)
  })

  it('a mensagem de teste sai pela linha da própria empresa', async () => {
    comChave()
    comGlobal('vizinha-b') // mesmo sendo a do piloto, a própria vale
    const api = zapiFalso()
    vi.stubGlobal('fetch', api.buscar)
    const r = await mensagemDeTeste(DONA_B)
    expect(r).toMatchObject({ ok: true })
    expect(api.pedidos).toHaveLength(1)
    expect(api.pedidos[0]!.url).toContain(`/instances/${INSTANCIA_B}/token/${TOKEN_B}/`)
  })

  it('remover a linha: a empresa volta ao canal de mentira', async () => {
    comChave()
    await apagarLinhaZapi(DONA_B)
    const estado = await estadoDaConexao(DONA_B)
    expect(estado.linha.token).toEqual({ guardado: false })
    expect(estado.origemCanal).toBe('nenhuma')
    expect(await tudoDoBanco()).toContain('agente.zapi.apagou')
  })
})

// ─────────────────────────────────────────────────────────────
// A PORTA DO WEBHOOK
// ─────────────────────────────────────────────────────────────

describe('o token do endereço', () => {
  it('confere o próprio pelo resumo, em tempo constante; o formato errado nem é resumido', () => {
    const { token, resumo } = novoTokenDoWebhook()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(resumo).toBe(resumoDoToken(token))
    expect(conferirTokenProprio(resumo, token)).toBe(true)
    expect(conferirTokenProprio(resumo, novoTokenDoWebhook().token)).toBe(false)
    expect(conferirTokenProprio(resumo, token.slice(1))).toBe(false)
    expect(conferirTokenProprio(resumo, resumo)).toBe(false)
    expect(conferirTokenProprio(resumo, undefined)).toBe(false)
  })

  it('com endereço próprio, SÓ ele abre; sem, o antigo', () => {
    const antigo = tokenDoWebhook('loja-a')!
    const { token, resumo } = novoTokenDoWebhook()
    expect(portaAbre('loja-a', antigo, null)).toBe(true)
    expect(portaAbre('loja-a', token, null)).toBe(false)
    expect(portaAbre('loja-a', token, resumo)).toBe(true)
    expect(portaAbre('loja-a', antigo, resumo)).toBe(false)
  })
})

describe('a porta, com o banco', () => {
  const canal = new CanalFalso()

  it('empresa que ainda não gerou endereço: o antigo abre (o caminho de migração)', async () => {
    const p = await receberWebhook('loja-a', tokenDoWebhook('loja-a')!, zapi('W-1'), { canal })
    expect(p.status).toBe(200)
  })

  it('empresa que não existe, ou sem assistente: 401, igual a token errado', async () => {
    expect((await receberWebhook('nao-existe', tokenDoWebhook('nao-existe')!, zapi('W-2'), { canal })).status).toBe(401)
    expect((await receberWebhook('sem-assistente', tokenDoWebhook('sem-assistente')!, zapi('W-3'), { canal })).status).toBe(401)
    expect((await receberWebhook('loja-a', novoTokenDoWebhook().token, zapi('W-4'), { canal })).status).toBe(401)
  })

  let primeiro = ''

  it('gerar o endereço: o novo abre, o antigo para NA HORA, e o banco só tem o resumo', async () => {
    const r = await gerarEnderecoDoWebhook(DONA_A, 'https://norte.app/')
    expect(r).toMatchObject({ ok: true, trocou: false })
    if (!r.ok) return
    expect(r.endereco).toMatch(/^https:\/\/norte\.app\/api\/whatsapp\/loja-a\/[A-Za-z0-9_-]{43}$/)
    primeiro = r.endereco.split('/').pop()!

    expect((await receberWebhook('loja-a', primeiro, zapi('W-5'), { canal })).status).toBe(200)
    expect((await receberWebhook('loja-a', tokenDoWebhook('loja-a')!, zapi('W-6'), { canal })).status).toBe(401)

    const tudo = await tudoDoBanco()
    expect(tudo).not.toContain(primeiro)
    expect(tudo).toContain(resumoDoToken(primeiro)) // na linha do agente, e só lá
    const livro = JSON.stringify((await db.query(`select * from auditoria where acao like 'agente.webhook.%'`)).rows)
    expect(livro).toContain('agente.webhook.gerou')
    expect(livro).not.toContain(resumoDoToken(primeiro))

    const e = await estadoDaConexao(DONA_A)
    expect(e.enderecoProprio).toBe(true)
    expect(e.segredoWebhook).toBe(true)
    expect(e.conectado).toBe(true)
  })

  it('trocar o endereço derruba o anterior', async () => {
    const r = await gerarEnderecoDoWebhook(DONA_A, 'https://norte.app')
    expect(r).toMatchObject({ ok: true, trocou: true })
    if (!r.ok) return
    const novo = r.endereco.split('/').pop()!
    expect((await receberWebhook('loja-a', primeiro, zapi('W-7'), { canal })).status).toBe(401)
    expect((await receberWebhook('loja-a', novo, zapi('W-8'), { canal })).status).toBe(200)
    expect(await tudoDoBanco()).toContain('agente.webhook.trocou')
  })

  it('o token de uma empresa não abre a porta da outra', async () => {
    const r = await gerarEnderecoDoWebhook(DONA_B, 'https://norte.app')
    if (!r.ok) throw new Error(r.erro)
    const daB = r.endereco.split('/').pop()!
    expect((await receberWebhook('vizinha-b', daB, zapi('W-9'), { canal })).status).toBe(200)
    expect((await receberWebhook('loja-a', daB, zapi('W-10'), { canal })).status).toBe(401)
  })

  it('desconectar fecha a porta mesmo com o token certo; reconectar reabre com o mesmo endereço', async () => {
    const r = await gerarEnderecoDoWebhook(DONA_A, 'https://norte.app')
    if (!r.ok) throw new Error(r.erro)
    const token = r.endereco.split('/').pop()!

    await desconectarCanal(DONA_A)
    const antes = await db.query(`select count(*)::int n from conversas_agente`)
    const p = await receberWebhook('loja-a', token, zapi('W-11'), { canal, buscar: undefined })
    expect(p.status).toBe(200)
    await p.trabalho!()
    expect((await db.query(`select count(*)::int n from conversas_agente`)).rows).toEqual(antes.rows)
    expect((await estadoDaConexao(DONA_A)).situacao).not.toBe('pronto')

    expect(await conectarCanal(DONA_A)).toEqual({ ok: true })
    expect((await estadoDaConexao(DONA_A)).conectado).toBe(true)
    expect((await receberWebhook('loja-a', token, zapi('W-12'), { canal })).status).toBe(200)
  })

  it('instância diferente da linha própria da empresa: ignorada', async () => {
    comChave()
    await salvarLinhaZapi(DONA_A, { instancia: 'INSTANCIA-DA-A', token: 'TokenDaA0000000000', clientToken: '' })
    const r = await gerarEnderecoDoWebhook(DONA_A, 'https://norte.app')
    if (!r.ok) throw new Error(r.erro)
    const token = r.endereco.split('/').pop()!
    const deOutra = await receberWebhook('loja-a', token, { ...zapi('W-13'), instanceId: 'OUTRA' }, { canal })
    expect(deOutra).toEqual({ status: 200 })
    const daPropria = await receberWebhook('loja-a', token, { ...zapi('W-14'), instanceId: 'INSTANCIA-DA-A' }, { canal })
    expect(daPropria.trabalho).toBeDefined()
  })
})

describe('o anúncio de onde a pessoa veio, pelo Z-API', () => {
  const doAnuncio = (ad: Record<string, unknown>) => ({ ...zapi('AD-1'), externalAdReply: ad })

  it('clique para o WhatsApp: o id do anúncio vai junto (externalAdReply na raiz)', () => {
    expect(lerZapi(doAnuncio({ sourceType: 'ad', sourceId: '23722824350495506', ctwaClid: 'Aff-x' }), null)).toMatchObject({
      tipo: 'mensagem',
      anuncioId: '23722824350495506',
    })
  })

  it('sem anúncio, ou com fonte que não é anúncio: sem id', () => {
    expect(lerZapi(zapi('AD-2'), null)).not.toHaveProperty('anuncioId')
    expect(lerZapi(doAnuncio({ sourceType: 'post', sourceId: '123' }), null)).not.toHaveProperty('anuncioId')
    expect(lerZapi(doAnuncio({ sourceType: 'ad', sourceId: 'com espaço' }), null)).not.toHaveProperty('anuncioId')
  })
})
