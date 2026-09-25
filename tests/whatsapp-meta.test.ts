// O WhatsApp OFICIAL (Meta, Cloud API), sem internet e sem banco.
//
// Tudo o que chega ou sai da Meta aqui passa por um `fetch` de mentira. O que
// está provado:
//   • a assinatura do webhook (válida, chave errada, corpo mexido, vazia) e a
//     verificação do endereço (GET com o desafio) — inclusive pela rota;
//   • a leitura do que a Meta entrega: texto, botão, lista, mídia, anúncio,
//     eco do app WhatsApp Business (coexistência), status, modelo;
//   • a janela de 24 horas, e o canal oficial recusando texto fora dela SEM
//     chamar a Meta — e o modelo saindo no lugar quando há um;
//   • a ordem da escolha do canal: oficial > QR > Z-API própria > global > mentira;
//   • o que vai em cada variável de um modelo (campanha e rotinas);
//   • os erros da Graph API em português, sem token, e as novas tentativas;
//   • o token cifrado preso à empresa: colado noutra, não abre;
//   • o motor da campanha terminando em 'janela_fechada' quando não há modelo.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.hoisted(() => {
  for (const k of [
    'META_APP_ID',
    'META_APP_SECRET',
    'META_CONFIG_ID',
    'META_WEBHOOK_VERIFY_TOKEN',
    'META_GRAPH_VERSION',
    'ZAPI_INSTANCIA',
    'ZAPI_TOKEN',
    'ZAPI_CLIENT_TOKEN',
    'ZAPI_EMPRESA',
    'NORTE_CIFRA',
    'CONECTOR_URL',
    'CONECTOR_SEGREDO',
  ])
    delete process.env[k]
})

import {
  VERSAO_PADRAO,
  assinaturaConfere,
  corpoDeModelo,
  corpoDeMidia,
  janelaAberta,
  lerConfigMeta,
  lerErroGraph,
  lerWebhookMeta,
  modeloDeAviso,
  modeloDoRelatorio,
  montarModelo,
  paraVariavel,
  respostaDoDesafio,
  semSegredo,
  JANELA_ATENDIMENTO_MS,
} from '../src/servidor/assistente/meta-regras'
import { lerFimDoCadastro, origemDaMeta } from '../src/servidor/assistente/meta-cadastro'
import { CanalMeta, Graph, trocarCodigo } from '../src/servidor/assistente/meta'
import { CanalFalso, CanalProprio, CanalZapi, contextoDoToken, enviarOuModelo, escolherCanal, linhaMeta } from '../src/servidor/assistente/canal'
import { cifrar } from '../src/servidor/cifra'
import { textoDoRelatorio } from '../src/servidor/assistente/rotinas'
import { variaveisDoModelo, lerGrafo } from '../src/servidor/campanhas/grafo'
import { rodar, type Deps, type EstadoExecucao } from '../src/servidor/campanhas/motor'
import type { Grafo } from '../src/servidor/campanhas/tipos'
// A rota (src/app/api/whatsapp-meta/route.ts) só embrulha estas duas em
// Request/Response; o vitest daqui não resolve o "@/" das rotas, então a
// porta é provada por elas.
import { receberWebhookMeta, verificarWebhookMeta } from '../src/servidor/assistente/meta-webhook'

const SEGREDO_APP = 'segredo-do-app-da-meta-0123456789abcdef'
const VERIFY = 'verificar-o-webhook-do-norte-123'
const TOKEN_LOJA = 'EAAGm0PX4ZCpsBAKtokenDaLojaQueNuncaPodeVazar1234567890'
const CHAVE = Buffer.alloc(32, 9).toString('base64')

const comMeta = () => {
  process.env.META_APP_ID = '1234567890'
  process.env.META_APP_SECRET = SEGREDO_APP
  process.env.META_CONFIG_ID = '9876543210'
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY
}

afterEach(() => {
  for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_CONFIG_ID', 'META_WEBHOOK_VERIFY_TOKEN', 'META_GRAPH_VERSION', 'NORTE_CIFRA', 'ZAPI_INSTANCIA', 'ZAPI_TOKEN', 'ZAPI_EMPRESA', 'CONECTOR_URL', 'CONECTOR_SEGREDO'])
    delete process.env[k]
})

const assinar = (corpo: string, chave = SEGREDO_APP) => `sha256=${createHmac('sha256', chave).update(corpo).digest('hex')}`

/** Um fetch de mentira: grava cada pedido e responde o que a fila mandar (o último se repete). */
function metaFalsa(respostas: { status: number; json?: unknown; headers?: Record<string, string> }[] = [{ status: 200, json: { messages: [{ id: 'wamid.1' }] } }]) {
  const pedidos: { url: string; metodo: string; headers: Record<string, string>; corpo: unknown }[] = []
  let i = 0
  const buscar = (async (url: string, init: RequestInit) => {
    pedidos.push({
      url,
      metodo: String(init.method),
      headers: (init.headers ?? {}) as Record<string, string>,
      corpo: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    })
    const r = respostas[Math.min(i++, respostas.length - 1)]!
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status: r.status, headers: r.headers })
  }) as unknown as typeof fetch
  return { pedidos, buscar }
}

// ─────────────────────────────────────────────────────────────
// O INTERRUPTOR
// ─────────────────────────────────────────────────────────────

describe('a configuração do app da Meta', () => {
  it('sem as quatro variáveis, a Meta está desligada', () => {
    expect(lerConfigMeta()).toBeNull()
    process.env.META_APP_ID = '1234567890'
    process.env.META_APP_SECRET = SEGREDO_APP
    process.env.META_CONFIG_ID = '9876543210'
    expect(lerConfigMeta()).toBeNull() // falta o verify token
  })

  it('com as quatro, liga — na versão padrão, ou na pedida se o formato servir', () => {
    comMeta()
    expect(lerConfigMeta()?.versao).toBe(VERSAO_PADRAO)
    process.env.META_GRAPH_VERSION = 'v26.0'
    expect(lerConfigMeta()?.versao).toBe('v26.0')
    process.env.META_GRAPH_VERSION = '../v1'
    expect(lerConfigMeta()?.versao).toBe(VERSAO_PADRAO)
  })
})

// ─────────────────────────────────────────────────────────────
// A PORTA: assinatura e desafio
// ─────────────────────────────────────────────────────────────

describe('a assinatura do webhook (X-Hub-Signature-256)', () => {
  const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

  it('válida: HMAC-SHA256 do corpo cru com a chave do app', () => {
    expect(assinaturaConfere(corpo, assinar(corpo), SEGREDO_APP)).toBe(true)
    // hexa em maiúscula também é a mesma assinatura
    expect(assinaturaConfere(corpo, assinar(corpo).replace(/[a-f]/g, (c) => c.toUpperCase()).replace('SHA256', 'sha256'), SEGREDO_APP)).toBe(true)
  })

  it('chave errada, corpo mexido, cabeçalho vazio ou fora do formato: não', () => {
    expect(assinaturaConfere(corpo, assinar(corpo, 'outra-chave-qualquer-de-app-000000'), SEGREDO_APP)).toBe(false)
    expect(assinaturaConfere(corpo + ' ', assinar(corpo), SEGREDO_APP)).toBe(false)
    expect(assinaturaConfere(corpo.replace('[]', '[{}]'), assinar(corpo), SEGREDO_APP)).toBe(false)
    expect(assinaturaConfere(corpo, '', SEGREDO_APP)).toBe(false)
    expect(assinaturaConfere(corpo, null, SEGREDO_APP)).toBe(false)
    expect(assinaturaConfere(corpo, 'sha1=abc', SEGREDO_APP)).toBe(false)
    expect(assinaturaConfere(corpo, assinar(corpo).slice(0, -2), SEGREDO_APP)).toBe(false)
    // sem chave configurada, nada confere — nem assinatura "vazia"
    expect(assinaturaConfere(corpo, `sha256=${createHmac('sha256', '').update(corpo).digest('hex')}`, '')).toBe(false)
  })

  it('a porta: sem a Meta 404; assinatura errada 401; certa 200 com trabalho', () => {
    expect(receberWebhookMeta(corpo, assinar(corpo)).status).toBe(404)
    comMeta()
    expect(receberWebhookMeta(corpo, assinar(corpo, 'chave-de-quem-tenta-forjar-000000')).status).toBe(401)
    expect(receberWebhookMeta(corpo, null).status).toBe(401)
    expect(receberWebhookMeta('{nao é json', assinar('{nao é json')).status).toBe(400)
    const ok = receberWebhookMeta(corpo, assinar(corpo))
    expect(ok.status).toBe(200)
    expect(typeof ok.trabalho).toBe('function')
  })

  it('a assinatura é conferida sobre o corpo CRU: o mesmo JSON reformatado não passa', () => {
    comMeta()
    const reformatado = JSON.stringify(JSON.parse(corpo), null, 2)
    expect(receberWebhookMeta(reformatado, assinar(corpo)).status).toBe(401)
  })
})

describe('a verificação do endereço (GET)', () => {
  const params = (p: Record<string, string>) => new URLSearchParams(p)

  it('token certo: devolve o desafio; errado, modo errado ou sem configuração: nulo', () => {
    expect(respostaDoDesafio(params({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444' }), VERIFY)).toBe('1158201444')
    expect(respostaDoDesafio(params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '1' }), VERIFY)).toBeNull()
    expect(respostaDoDesafio(params({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1' }), VERIFY)).toBeNull()
    expect(respostaDoDesafio(params({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), '')).toBeNull()
    // o desafio não vira injeção na nossa resposta
    expect(respostaDoDesafio(params({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '<script>' }), VERIFY)).toBeNull()
  })

  it('a porta do GET: 200 com o desafio puro, 403 com token errado, 404 com a Meta desligada', () => {
    const q = (t: string) => params({ 'hub.mode': 'subscribe', 'hub.verify_token': t, 'hub.challenge': '424242' })
    expect(verificarWebhookMeta(q(VERIFY)).status).toBe(404)
    comMeta()
    expect(verificarWebhookMeta(q(VERIFY))).toEqual({ status: 200, corpo: '424242' })
    expect(verificarWebhookMeta(q('chute'))).toEqual({ status: 403, corpo: '' })
  })
})

// ─────────────────────────────────────────────────────────────
// O QUE A META ENTREGA
// ─────────────────────────────────────────────────────────────

const PNID = '106540352242922'
const envelope = (field: string, value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '102290129340398', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '557133330000', phone_number_id: PNID }, ...value } }] }],
})

describe('a leitura do webhook', () => {
  it('texto, com o nome do perfil', () => {
    const ev = lerWebhookMeta(
      envelope('messages', {
        contacts: [{ profile: { name: 'Carla Souza' }, wa_id: '5571999990001' }],
        messages: [{ from: '5571999990001', id: 'wamid.A', timestamp: '1', type: 'text', text: { body: 'quero o catálogo' } }],
      }),
    )
    expect(ev).toEqual([
      { tipo: 'mensagem', phoneNumberId: PNID, telefone: '5571999990001', nome: 'Carla Souza', texto: 'quero o catálogo', idExterno: 'wamid.A', anuncioId: null },
    ])
  })

  it('botão de modelo, resposta de botão e de lista viram o texto que a pessoa tocou', () => {
    const ev = lerWebhookMeta(
      envelope('messages', {
        messages: [
          { from: '5571999990001', id: 'w1', type: 'button', button: { payload: 'QUERO', text: 'Quero ver' } },
          { from: '5571999990001', id: 'w2', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Sim' } } },
          { from: '5571999990001', id: 'w3', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'l1', title: 'Tamanho M' } } },
        ],
      }),
    )
    expect(ev.map((e) => (e.tipo === 'mensagem' ? e.texto : e.tipo))).toEqual(['Quero ver', 'Sim', 'Tamanho M'])
  })

  it('imagem e áudio viram uma nota de "(mídia)"; a legenda da imagem vem junto', () => {
    const ev = lerWebhookMeta(
      envelope('messages', {
        messages: [
          { from: '5571999990001', id: 'w1', type: 'image', image: { id: 'm1', caption: 'tem esse?' } },
          { from: '5571999990001', id: 'w2', type: 'audio', audio: { id: 'm2' } },
        ],
      }),
    )
    const textos = ev.map((e) => (e.tipo === 'mensagem' ? e.texto : ''))
    expect(textos[0]).toMatch(/^tem esse\?\n\(mídia: a pessoa mandou uma imagem/)
    expect(textos[1]).toMatch(/^\(mídia: a pessoa mandou um áudio/)
  })

  it('o anúncio de clique para o WhatsApp vira anuncioId; post orgânico não', () => {
    const ev = lerWebhookMeta(
      envelope('messages', {
        messages: [
          { from: '5571999990001', id: 'w1', type: 'text', text: { body: 'oi' }, referral: { source_type: 'ad', source_id: '120210000000123', source_url: 'https://fb.me/x', ctwa_clid: 'abc' } },
          { from: '5571999990001', id: 'w2', type: 'text', text: { body: 'oi' }, referral: { source_type: 'post', source_id: '999' } },
          { from: '5571999990001', id: 'w3', type: 'text', text: { body: 'oi' }, referral: { source_type: 'ad', source_id: 'id com espaço' } },
        ],
      }),
    )
    expect(ev.map((e) => (e.tipo === 'mensagem' ? e.anuncioId : 'x'))).toEqual(['120210000000123', null, null])
  })

  it('o eco do app WhatsApp Business (coexistência) é "alguém da loja escreveu"', () => {
    const ev = lerWebhookMeta(
      envelope('smb_message_echoes', {
        message_echoes: [{ from: '557133330000', to: '5571999990001', id: 'wamid.E', timestamp: '1', type: 'text', text: { body: 'já te respondo' } }],
      }),
    )
    expect(ev).toEqual([{ tipo: 'humano', phoneNumberId: PNID, telefone: '5571999990001', idExterno: 'wamid.E' }])
  })

  it('status: entregue e falhou (com o código), o número sai mascarado', () => {
    const ev = lerWebhookMeta(
      envelope('messages', {
        statuses: [
          { id: 'wamid.S1', status: 'delivered', recipient_id: '5571999990001', timestamp: '1' },
          { id: 'wamid.S2', status: 'failed', recipient_id: '5571999990001', errors: [{ code: 131047, title: 'Re-engagement message' }] },
        ],
      }),
    )
    expect(ev[0]).toMatchObject({ tipo: 'status', status: 'delivered', erro: null })
    expect(ev[1]).toMatchObject({ tipo: 'status', status: 'failed', erro: { codigo: 131047, titulo: 'Re-engagement message' } })
    expect(JSON.stringify(ev)).not.toContain('999990001')
  })

  it('modelo aprovado/recusado e aviso de conta viram rastro', () => {
    const ev = lerWebhookMeta({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            { field: 'message_template_status_update', value: { event: 'REJECTED', message_template_name: 'oferta', message_template_language: 'pt_BR', reason: 'PROMOTIONAL' } },
            { field: 'account_update', value: { event: 'PARTNER_REMOVED' } },
          ],
        },
      ],
    })
    expect(ev).toEqual([
      { tipo: 'modelo', wabaId: '102290129340398', nome: 'oferta', idioma: 'pt_BR', evento: 'REJECTED', motivo: 'PROMOTIONAL' },
      { tipo: 'conta', wabaId: '102290129340398', evento: 'PARTNER_REMOVED' },
    ])
  })

  it('sem número (só o id por empresa "BR.xxx"), reação, histórico e lixo: ignorados sem quebrar', () => {
    const ev = lerWebhookMeta(
      envelope('messages', {
        messages: [
          { from_user_id: 'BR.1A2B3C', id: 'w1', type: 'text', text: { body: 'oi' } },
          { from: '5571999990001', id: 'w2', type: 'reaction', reaction: { emoji: '👍' } },
          null,
        ],
      }),
    )
    expect(ev.every((e) => e.tipo === 'ignorar')).toBe(true)
    expect(lerWebhookMeta(envelope('history', { history: [] }))[0]!.tipo).toBe('ignorar')
    expect(lerWebhookMeta({ object: 'page' })[0]!.tipo).toBe('ignorar')
    expect(lerWebhookMeta(null)[0]!.tipo).toBe('ignorar')
  })
})

// ─────────────────────────────────────────────────────────────
// A JANELA DE 24 HORAS
// ─────────────────────────────────────────────────────────────

describe('a janela de 24 horas', () => {
  const agora = new Date('2026-09-25T15:00:00Z')
  const antes = (ms: number) => new Date(agora.getTime() - ms)

  it('aberta até 24 h depois da última mensagem DA PESSOA; quem nunca escreveu está fora', () => {
    expect(janelaAberta(null, agora)).toBe(false)
    expect(janelaAberta(antes(60_000), agora)).toBe(true)
    expect(janelaAberta(antes(23 * 3_600_000), agora)).toBe(true)
    // a beirada fica do lado do modelo: melhor usar modelo do que ver o texto recusado
    expect(janelaAberta(antes(JANELA_ATENDIMENTO_MS - 30_000), agora)).toBe(false)
    expect(janelaAberta(antes(JANELA_ATENDIMENTO_MS + 1), agora)).toBe(false)
  })

  it('o canal oficial recusa texto fora da janela SEM chamar a Meta', async () => {
    const { pedidos, buscar } = metaFalsa()
    const canal = new CanalMeta('org-a', { phoneNumberId: PNID, token: TOKEN_LOJA, versao: 'v25.0' }, { buscar, ultimaEntrada: async () => antes(25 * 3_600_000), agora: () => agora })
    const r = await canal.enviar('71999990001', 'oi')
    expect(r).toMatchObject({ ok: false, codigo: 'janela_fechada' })
    const m = await canal.enviarMidia('71999990001', { tipo: 'imagem', url: 'https://norte.app/api/midia/x', legenda: 'olha' })
    expect(m).toMatchObject({ ok: false, codigo: 'janela_fechada' })
    expect(pedidos).toHaveLength(0)
  })

  it('dentro da janela: texto pela Cloud API, com o token no cabeçalho e nunca na URL', async () => {
    const { pedidos, buscar } = metaFalsa()
    const canal = new CanalMeta('org-a', { phoneNumberId: PNID, token: TOKEN_LOJA, versao: 'v25.0' }, { buscar, ultimaEntrada: async () => antes(3_600_000), agora: () => agora })
    expect(await canal.enviar('(71) 99999-0001', 'Olá!')).toEqual({ ok: true, id: 'wamid.1' })
    expect(pedidos[0]!.url).toBe(`https://graph.facebook.com/v25.0/${PNID}/messages`)
    expect(pedidos[0]!.url).not.toContain(TOKEN_LOJA)
    expect(pedidos[0]!.headers.Authorization).toBe(`Bearer ${TOKEN_LOJA}`)
    expect(pedidos[0]!.corpo).toMatchObject({ messaging_product: 'whatsapp', to: '5571999990001', type: 'text', text: { body: 'Olá!' } })
  })

  it('fora da janela, com modelo: `enviarOuModelo` manda o modelo; sem modelo, a falha volta como veio', async () => {
    const { pedidos, buscar } = metaFalsa()
    const canal = new CanalMeta('org-a', { phoneNumberId: PNID, token: TOKEN_LOJA, versao: 'v25.0' }, { buscar, ultimaEntrada: async () => null, agora: () => agora })
    const semModelo = await enviarOuModelo(canal, '5571999990001', 'Bom dia')
    expect(semModelo).toMatchObject({ ok: false, codigo: 'janela_fechada' })
    const comModelo = await enviarOuModelo(canal, '5571999990001', 'Bom dia', modeloDeAviso('Loja Centro', 'linha 1\nlinha 2'))
    expect(comModelo).toMatchObject({ ok: true, porModelo: true })
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]!.corpo).toMatchObject({
      type: 'template',
      template: {
        name: 'norte_aviso',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Loja Centro' }, { type: 'text', text: 'linha 1 · linha 2' }] }],
      },
    })
  })

  it('canais sem janela (Z-API, QR, mentira) ignoram o modelo', async () => {
    const falso = new CanalFalso()
    const r = await enviarOuModelo(falso, '5571999990001', 'oi', modeloDeAviso('Loja', 'x'))
    expect(r).toMatchObject({ ok: true })
    expect(falso.enviadas).toEqual([{ numero: '5571999990001', texto: 'oi' }])
  })
})

// ─────────────────────────────────────────────────────────────
// A ESCOLHA DO CANAL
// ─────────────────────────────────────────────────────────────

describe('a escolha do canal: oficial > QR > Z-API própria > global > mentira', () => {
  const org = { id: 'org-a', slug: 'loja-a' }
  const linhaCompleta = () => ({
    canal: 'META' as const,
    zapiInstancia: 'INSTANCIA-A',
    zapiTokenCifrado: cifrar('TOKEN-ZAPI-A', contextoDoToken('org-a', 'zapi_token')),
    zapiClientTokenCifrado: null,
    metaPhoneNumberId: PNID,
    metaWabaId: '102290129340398',
    metaTokenCifrado: cifrar(TOKEN_LOJA, contextoDoToken('org-a', 'meta_token')),
  })
  const tudoLigado = () => {
    comMeta()
    process.env.NORTE_CIFRA = CHAVE
    process.env.CONECTOR_URL = 'http://conector.interno:3200'
    process.env.CONECTOR_SEGREDO = 'segredo-do-conector-com-mais-de-32-caracteres'
    process.env.ZAPI_INSTANCIA = 'GLOBAL'
    process.env.ZAPI_TOKEN = 'TOKEN-GLOBAL'
    process.env.ZAPI_EMPRESA = 'loja-a'
  }

  it('canal META com a Meta no servidor: o oficial vem primeiro', () => {
    tudoLigado()
    const r = escolherCanal(org, linhaCompleta())
    expect(r.origem).toBe('meta')
    expect(r.canal).toBeInstanceOf(CanalMeta)
  })

  it('a Meta desligada no servidor: cai para a linha própria no Z-API — nada quebra', () => {
    tudoLigado()
    delete process.env.META_APP_SECRET
    const r = escolherCanal(org, linhaCompleta())
    expect(r.origem).toBe('propria')
    expect(r.canal).toBeInstanceOf(CanalZapi)
  })

  it('canal PROPRIO continua no QR, mesmo com número oficial guardado', () => {
    tudoLigado()
    const r = escolherCanal(org, { ...linhaCompleta(), canal: 'PROPRIO' })
    expect(r.origem).toBe('qr')
    expect(r.canal).toBeInstanceOf(CanalProprio)
  })

  it('sem linha própria: a global (só a do piloto); sem nada: mentira', () => {
    tudoLigado()
    const semLinhas = { canal: 'ZAPI' as const, zapiInstancia: null, zapiTokenCifrado: null, zapiClientTokenCifrado: null }
    expect(escolherCanal(org, semLinhas).origem).toBe('global')
    expect(escolherCanal({ id: 'org-b', slug: 'vizinha' }, semLinhas).origem).toBe('nenhuma')
  })

  it('o token oficial da empresa A, colado na linha da B, não abre — e a B não fala pelo número da A', () => {
    tudoLigado()
    const daA = linhaCompleta()
    expect(linhaMeta('org-a', daA)?.token).toBe(TOKEN_LOJA)
    expect(linhaMeta('org-b', daA)).toBeNull()
    const r = escolherCanal({ id: 'org-b', slug: 'vizinha' }, { ...daA, zapiTokenCifrado: null })
    expect(r.origem).toBe('nenhuma')
    // e trocar de campo também não abre (o token do Z-API na coluna da Meta)
    expect(linhaMeta('org-a', { ...daA, metaTokenCifrado: daA.zapiTokenCifrado })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// OS MODELOS: variáveis e criação
// ─────────────────────────────────────────────────────────────

describe('o que vai em cada variável', () => {
  it('campanha: os coringas trocados pelo que o roteiro sabe; vazio vira "cliente" ou "-"', () => {
    const m = { nome: 'volta_loja', idioma: 'pt_BR', variaveis: ['{primeiro_nome}', '{resposta}', 'cupom VOLTA10'] }
    expect(variaveisDoModelo(m, { nome: 'Carla Souza', resposta: 'M' })).toEqual(['Carla', 'M', 'cupom VOLTA10'])
    expect(variaveisDoModelo(m, { nome: null })).toEqual(['cliente', '-', 'cupom VOLTA10'])
  })

  it('o modelo do bloco sobrevive à leitura do desenho; um nome fora do formato some', () => {
    const g = lerGrafo({
      nodes: [
        { id: 'm1', tipo: 'mensagem', x: 0, y: 0, dados: { textos: ['oi'], digitandoSeg: 0, modelo: { nome: 'volta_loja', idioma: 'pt_BR', variaveis: ['{nome}'] } } },
        { id: 'm2', tipo: 'mensagem', x: 0, y: 0, dados: { textos: ['oi'], digitandoSeg: 0, modelo: { nome: 'Volta Loja!', idioma: 'pt_BR', variaveis: [] } } },
        { id: 'm3', tipo: 'mensagem', x: 0, y: 0, dados: { textos: ['oi'], digitandoSeg: 0 } },
      ],
      edges: [],
    })
    expect(g.nodes[0]!.dados).toEqual({ textos: ['oi'], digitandoSeg: 0, modelo: { nome: 'volta_loja', idioma: 'pt_BR', variaveis: ['{nome}'] } })
    expect(g.nodes[1]!.dados).toEqual({ textos: ['oi'], digitandoSeg: 0 })
    expect(g.nodes[2]!.dados).toEqual({ textos: ['oi'], digitandoSeg: 0 })
  })

  it('variável de modelo: sem quebra de linha, sem tabulação, sem espaço em fila, com teto', () => {
    expect(paraVariavel('a\n\n b\t c     d')).toBe('a · b c d')
    expect(paraVariavel('')).toBe('-')
    expect(paraVariavel('x'.repeat(2000)).length).toBeLessThanOrEqual(900)
    const corpo = corpoDeModelo('5571999990001', { nome: 'x', idioma: 'pt_BR', variaveis: ['linha\nnova'] })
    expect(JSON.stringify(corpo)).not.toContain('\\n')
  })

  it('o relatório das 8h como modelo: nome, "ontem", e o resumo numa linha', () => {
    const texto = textoDoRelatorio({
      nome: 'Ana Dona',
      quando: 'manha',
      resumo: {
        atual: { total: 1250, vendas: 14, ticket: 89.29 },
        anterior: { total: 1000, vendas: 10, ticket: 100 },
        maisVendidos: [{ descricao: 'Camiseta básica', quantidade: 6 }],
        porUnidade: [],
      } as never,
    })
    const m = modeloDoRelatorio('Ana Dona', 'manha', texto)
    expect(m.nome).toBe('norte_relatorio_dia')
    expect(m.variaveis[0]).toBe('Ana')
    expect(m.variaveis[1]).toBe('ontem')
    expect(m.variaveis[2]).toContain('R$')
    expect(m.variaveis[2]).not.toContain('Bom dia')
    expect(m.variaveis[2]).not.toContain('\n')
  })

  it('criar modelo: formato da Meta conferido antes de ir para lá', () => {
    const base = { nome: 'Oferta de Verão', categoria: 'MARKETING', corpo: 'Oi, {{1}}! Separamos {{2}} de desconto para você.', exemplos: ['Ana', '10%'], botoes: ['Quero ver', ''] }
    expect(montarModelo(base).ok).toBe(false) // "ã" no nome
    const ok = montarModelo({ ...base, nome: 'oferta de verao' })
    expect(ok.ok && ok.corpo).toMatchObject({
      name: 'oferta_de_verao',
      category: 'MARKETING',
      language: 'pt_BR',
      components: [
        { type: 'BODY', text: base.corpo, example: { body_text: [['Ana', '10%']] } },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quero ver' }] },
      ],
    })
    expect(montarModelo({ ...base, nome: 'x', corpo: 'Oi {{1}} e {{3}}.', exemplos: ['a', 'b'] }).ok).toBe(false) // pulou o 2
    expect(montarModelo({ ...base, nome: 'x', corpo: '{{1}}, chegou!', exemplos: ['a'] }).ok).toBe(false) // começa com variável
    expect(montarModelo({ ...base, nome: 'x', corpo: 'Chegou, {{1}}', exemplos: ['a'] }).ok).toBe(false) // termina com variável
    expect(montarModelo({ ...base, nome: 'x', exemplos: ['Ana'] }).ok).toBe(false) // falta exemplo
    expect(montarModelo({ ...base, nome: 'norte_aviso' }).ok).toBe(false) // nome reservado
    expect(montarModelo({ ...base, nome: 'x', botoes: ['a', 'b', 'c', 'd'] }).ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// OS ERROS DA GRAPH API
// ─────────────────────────────────────────────────────────────

describe('os erros da Meta, em português e sem segredo', () => {
  const erroCom = (code: number, message = `Erro com o token ${TOKEN_LOJA} dentro`) => ({ error: { message, type: 'OAuthException', code, fbtrace_id: 'x' } })

  it('os códigos conhecidos viram frase nossa, com o número da Meta e nada do texto dela', () => {
    const j = lerErroGraph(400, erroCom(131047))
    expect(j).toMatchObject({ codigo: 'janela_fechada', repetir: false, codigoMeta: 131047 })
    expect(j.mensagem).toContain('24 horas')
    expect(j.mensagem).toContain('131047')
    expect(lerErroGraph(401, erroCom(190))).toMatchObject({ codigo: 'credencial' })
    expect(lerErroGraph(400, erroCom(132001))).toMatchObject({ codigo: 'modelo' })
    expect(lerErroGraph(400, erroCom(130429))).toMatchObject({ codigo: 'limite', repetir: true })
    for (const c of [131047, 190, 132001, 130429, 100, 123456]) {
      expect(lerErroGraph(400, erroCom(c)).mensagem).not.toContain(TOKEN_LOJA)
    }
  })

  it('sem código: 429 e 5xx repetem; 4xx não', () => {
    expect(lerErroGraph(429, null)).toMatchObject({ codigo: 'limite', repetir: true })
    expect(lerErroGraph(503, 'fora')).toMatchObject({ codigo: 'fornecedor', repetir: true })
    expect(lerErroGraph(404, {})).toMatchObject({ repetir: false })
  })

  it('a última barreira do log apaga cara de token', () => {
    const t = semSegredo(`GET /oauth/access_token?client_id=1&client_secret=abc123&code=XYZ Authorization: Bearer ${TOKEN_LOJA} e ${TOKEN_LOJA}`)
    expect(t).not.toContain('abc123')
    expect(t).not.toContain('XYZ')
    expect(t).not.toContain(TOKEN_LOJA)
  })

  it('o cliente tenta de novo em 429 (esperando) e desiste em 400 na hora', async () => {
    const esperas: number[] = []
    const { pedidos, buscar } = metaFalsa([
      { status: 429, json: erroCom(130429), headers: { 'retry-after': '1' } },
      { status: 200, json: { messages: [{ id: 'wamid.2' }] } },
    ])
    const g = new Graph('v25.0', TOKEN_LOJA, { buscar, dormir: async (ms) => void esperas.push(ms) })
    const r = await g.pedir('POST', `${PNID}/messages`, { corpo: {} })
    expect(r.ok).toBe(true)
    expect(pedidos).toHaveLength(2)
    expect(esperas).toEqual([1000])

    const falso2 = metaFalsa([{ status: 400, json: erroCom(131026) }])
    const g2 = new Graph('v25.0', TOKEN_LOJA, { buscar: falso2.buscar, dormir: async () => {} })
    const r2 = await g2.pedir('POST', `${PNID}/messages`, { corpo: {} })
    expect(r2.ok).toBe(false)
    expect(falso2.pedidos).toHaveLength(1)
    expect(!r2.ok && r2.erro.mensagem).not.toContain(TOKEN_LOJA)
  })

  it('queda de rede: GET tenta de novo; POST de mensagem não (podia ter chegado)', async () => {
    let chamadas = 0
    const caiu = (async () => {
      chamadas++
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const g = new Graph('v25.0', TOKEN_LOJA, { buscar: caiu, dormir: async () => {} })
    expect((await g.pedir('POST', `${PNID}/messages`, { corpo: {} })).ok).toBe(false)
    expect(chamadas).toBe(1)
    expect((await g.pedir('GET', `${PNID}`)).ok).toBe(false)
    expect(chamadas).toBe(4)
  })

  it('a troca do código: a chave do app vai só para a Meta, e o erro não a repete', async () => {
    comMeta()
    const cfg = lerConfigMeta()!
    const ok = metaFalsa([{ status: 200, json: { access_token: TOKEN_LOJA, token_type: 'bearer' } }])
    const r = await trocarCodigo(cfg, 'CODIGO-DE-30-SEGUNDOS', { buscar: ok.buscar })
    expect(r).toEqual({ ok: true, dados: TOKEN_LOJA })
    const u = new URL(ok.pedidos[0]!.url)
    expect(u.pathname).toBe('/v25.0/oauth/access_token')
    expect(u.searchParams.get('client_id')).toBe('1234567890')
    expect(u.searchParams.get('code')).toBe('CODIGO-DE-30-SEGUNDOS')

    const ruim = metaFalsa([{ status: 400, json: { error: { code: 100, message: `invalid code; client_secret=${SEGREDO_APP}` } } }])
    const r2 = await trocarCodigo(cfg, 'CODIGO', { buscar: ruim.buscar })
    expect(r2.ok).toBe(false)
    expect(JSON.stringify(r2)).not.toContain(SEGREDO_APP)
  })
})

// ─────────────────────────────────────────────────────────────
// O CORPO DA MÍDIA E O CADASTRO INCORPORADO
// ─────────────────────────────────────────────────────────────

describe('mídia por link e o recado do cadastro', () => {
  it('imagem com legenda; áudio sem legenda (a Cloud API não aceita)', () => {
    expect(corpoDeMidia('55719', { tipo: 'imagem', url: 'https://n/x', legenda: 'olha' })).toMatchObject({ type: 'image', image: { link: 'https://n/x', caption: 'olha' } })
    const a = corpoDeMidia('55719', { tipo: 'audio', url: 'https://n/a', legenda: 'ouve' }) as Record<string, Record<string, unknown>>
    expect(a.audio).toEqual({ link: 'https://n/a' })
  })

  it('o fim do cadastro: ids no FINISH, coexistência no FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING, e o cancelamento', () => {
    expect(lerFimDoCadastro(JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '111', waba_id: '222', business_id: '333' } }))).toEqual({
      tipo: 'fim',
      evento: 'FINISH',
      wabaId: '222',
      phoneNumberId: '111',
      coexistencia: false,
    })
    expect(lerFimDoCadastro({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '222' } })).toMatchObject({
      tipo: 'fim',
      phoneNumberId: null,
      coexistencia: true,
    })
    expect(lerFimDoCadastro({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } })).toEqual({ tipo: 'cancelado', passo: 'PHONE_NUMBER_SETUP', erro: null })
    expect(lerFimDoCadastro({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '../x' } }).tipo).toBe('outro')
    expect(lerFimDoCadastro('não é json').tipo).toBe('outro')
  })

  it('só aceita recado vindo da Meta', () => {
    expect(origemDaMeta('https://www.facebook.com')).toBe(true)
    expect(origemDaMeta('https://web.facebook.com')).toBe(true)
    expect(origemDaMeta('https://facebook.com.golpe.com')).toBe(false)
    expect(origemDaMeta('http://www.facebook.com')).toBe(false)
    expect(origemDaMeta('https://notfacebook.com')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// A CAMPANHA FORA DA JANELA
// ─────────────────────────────────────────────────────────────

describe('o motor da campanha fora da janela', () => {
  const grafo = (modelo?: unknown): Grafo =>
    lerGrafo({
      nodes: [
        { id: 'inicio', tipo: 'inicio', x: 0, y: 0, dados: {} },
        { id: 'm1', tipo: 'mensagem', x: 0, y: 0, dados: { textos: ['Oi, {primeiro_nome}!'], digitandoSeg: 0, ...(modelo ? { modelo } : {}) } },
        { id: 'f1', tipo: 'fim', x: 0, y: 0, dados: { texto: '' } },
      ],
      edges: [
        { id: 'e1', de: 'inicio', saida: 'saida', para: 'm1' },
        { id: 'e2', de: 'm1', saida: 'saida', para: 'f1' },
      ],
    })
  const estado = (): EstadoExecucao => ({
    id: 'x1',
    campanhaId: 'c1',
    nodeId: 'inicio',
    status: 'rodando',
    proximoEm: null,
    vars: { nome: 'Carla Souza' },
    teste: false,
    semente: '7199990001',
    motivoFim: null,
  })
  const deps = (enviarTexto: Deps['enviarTexto']) => {
    const diario: { nodeId: string; saida?: string | null }[] = []
    const d: Deps = {
      agora: () => new Date('2026-09-25T15:00:00Z'),
      dormir: async () => {},
      enviarTexto,
      enviarMidia: async () => 'ok',
      passarParaPessoa: async () => 0,
      horario: null,
      registrar: async (p) => void diario.push({ nodeId: p.nodeId, saida: p.saida }),
      salvar: async () => true,
    }
    return { d, diario }
  }

  it('sem modelo no bloco: a execução termina em "janela_fechada", e o diário diz onde', async () => {
    const { d, diario } = deps(async () => 'janela')
    const r = await rodar(grafo(), estado(), { tipo: 'iniciar' }, d)
    expect(r.estado).toMatchObject({ status: 'erro', motivoFim: 'janela_fechada' })
    expect(diario).toContainEqual({ nodeId: 'm1', saida: 'janela_fechada' })
  })

  it('com modelo: o motor entrega o modelo com as variáveis desta pessoa', async () => {
    const vistos: unknown[] = []
    const { d } = deps(async (_t, m) => {
      vistos.push(m)
      return 'ok'
    })
    const r = await rodar(grafo({ nome: 'volta_loja', idioma: 'pt_BR', variaveis: ['{primeiro_nome}'] }), estado(), { tipo: 'iniciar' }, d)
    expect(r.estado.status).toBe('concluida')
    expect(vistos).toEqual([{ nome: 'volta_loja', idioma: 'pt_BR', variaveis: ['Carla'] }])
  })
})
