// O WhatsApp OFICIAL com banco de verdade (PGlite exposto numa porta, como em
// `whatsapp-empresa.test.ts`) e a Meta de mentira (um `fetch` que responde).
//
// O que está provado aqui:
//   • a portaria do número: `org_do_numero_meta` acha a empresa pelo id EXATO
//     do número, e o papel da aplicação (app_norte) nem consegue chamá-la;
//   • o webhook alimenta o MESMO caminho das outras portas: a mensagem do
//     cliente é gravada (e a segunda entrega é 'duplicada'), o eco do app
//     WhatsApp Business cala o automático, e número de empresa desconectada
//     ou de ninguém é descartado;
//   • a janela sai do banco: quem acabou de escrever está dentro, quem nunca
//     escreveu está fora;
//   • conectar pelo cadastro incorporado: troca o código, inscreve o app,
//     registra o número, cria os dois modelos do Norte, guarda o token
//     CIFRADO, liga o canal — e nem o banco nem o livro de auditoria têm o
//     token; o mesmo número não entra em duas empresas;
//   • a mensagem de teste, fora da janela, sai pelo modelo `norte_aviso`;
//   • desconectar esquece tudo e desinscreve o app.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco, comoApp } from './banco'

const CHAVE = Buffer.alloc(32, 5).toString('base64')
const SEGREDO_APP = 'segredo-do-app-da-meta-0123456789abcdef'
const TOKEN_A = 'EAAtokenDaLojaAqueNaoPodeAparecerEmLugarNenhum0001'
const TOKEN_NOVO = 'EAAtokenNovoDaLojaCqueNaoPodeAparecerEmLugarNenhum2'
const PNID_A = '100000000000001'
const PNID_B = '200000000000002'
const PNID_C = '300000000000003'
const WABA_C = '399999999999999'

vi.hoisted(() => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  for (const k of ['ZAPI_INSTANCIA', 'ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN', 'ZAPI_EMPRESA', 'CONECTOR_URL', 'CONECTOR_SEGREDO', 'META_GRAPH_VERSION']) delete process.env[k]
})

import { cifrar } from '../src/servidor/cifra'
import { contextoDoToken, CanalFalso } from '../src/servidor/assistente/canal'
import { CanalMeta, ultimaEntradaDe } from '../src/servidor/assistente/meta'
import { processarEventos } from '../src/servidor/assistente/meta-webhook'
import { lerWebhookMeta } from '../src/servidor/assistente/meta-regras'
import { empresaDoNumeroMeta, fecharPortariaRotinas } from '../src/servidor/assistente/portaria'
import { conectarPelaMeta, desconectarMeta, estadoMeta } from '../src/servidor/assistente/meta-conexao'
import { mensagemDeTeste } from '../src/servidor/assistente/conexao'
import { fechar } from '../src/servidor/banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

const sessao = (orgId: string, usuarioId: string): Sessao =>
  ({ orgId, usuarioId, nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }) as Sessao

const DONA_C = sessao('org-c', 'usr-cida')
const CLIENTE = '5571988887777'

const comMeta = () => {
  process.env.META_APP_ID = '1234567890'
  process.env.META_APP_SECRET = SEGREDO_APP
  process.env.META_CONFIG_ID = '9876543210'
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verificar-o-webhook-do-norte-123'
  process.env.NORTE_CIFRA = CHAVE
}

beforeAll(async () => {
  process.env.NORTE_CIFRA = CHAVE
  db = await subirBanco()
  await db.exec(`
    insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
      ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now()),
      ('org-b', 'Vizinha B', 'vizinha-b', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now()),
      ('org-c', 'Loja C', 'loja-c', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 5000, now());
    insert into unidades (id, org_id, nome, atualizada_em) values
      ('uni-a1', 'org-a', 'Centro A', now()), ('uni-c1', 'org-c', 'Centro C', now());
    insert into usuarios (id, org_id, nome, email, telefone, atualizado_em) values
      ('usr-ana', 'org-a', 'Ana Dona', 'ana@a.com', '(71) 99999-0001', now()),
      ('usr-cida', 'org-c', 'Cida Dona', 'cida@c.com', '(71) 97777-0003', now());
    insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
      ('ac-ana', 'org-a', 'usr-ana', null, 'DONO'),
      ('ac-cida', 'org-c', 'usr-cida', null, 'DONO');
  `)
  await db.query(
    `insert into agentes (id, org_id, nome, ativo, canal, meta_phone_number_id, meta_waba_id, meta_token_cifrado, atualizado_em) values
       ('ag-a', 'org-a', 'Nina', true, 'META', $1, '111', $2, now()),
       ('ag-b', 'org-b', 'Bob', true, 'NENHUM', $3, '222', $4, now()),
       ('ag-c', 'org-c', 'Cora', true, 'NENHUM', null, null, null, now())`,
    [PNID_A, cifrar(TOKEN_A, contextoDoToken('org-a', 'meta_token')), PNID_B, cifrar(TOKEN_A, contextoDoToken('org-b', 'meta_token'))],
  )
  const porta = 53000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
}, 60_000)

afterAll(async () => {
  await fechar()
  await fecharPortariaRotinas()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_CONFIG_ID', 'META_WEBHOOK_VERIFY_TOKEN']) delete process.env[k]
})

/** A Meta de mentira: responde por caminho e grava cada pedido. */
function metaFalsa(extra: (url: URL, metodo: string) => { status: number; json: unknown } | null = () => null) {
  const pedidos: { url: string; metodo: string; corpo: unknown; auth: string | undefined }[] = []
  const buscar = (async (endereco: string, init: RequestInit) => {
    const url = new URL(endereco)
    const metodo = String(init.method)
    const corpo = typeof init.body === 'string' ? JSON.parse(init.body) : null
    pedidos.push({ url: endereco, metodo, corpo, auth: (init.headers as Record<string, string>)?.Authorization })
    const x = extra(url, metodo)
    const r =
      x ??
      (url.pathname.endsWith('/oauth/access_token')
        ? { status: 200, json: { access_token: TOKEN_NOVO, token_type: 'bearer' } }
        : url.pathname.endsWith('/messages')
          ? { status: 200, json: { messages: [{ id: 'wamid.saiu' }] } }
          : url.pathname.endsWith('/message_templates') && metodo === 'GET'
            ? { status: 200, json: { data: [] } }
            : url.pathname.endsWith('/message_templates')
              ? { status: 200, json: { id: '77', status: 'PENDING', category: 'UTILITY' } }
              : /\/\d+$/.test(url.pathname) && metodo === 'GET'
                ? { status: 200, json: { display_phone_number: '+55 71 3333-0003', verified_name: 'Loja C', platform_type: 'NOT_APPLICABLE' } }
                : { status: 200, json: { success: true } })
    return new Response(JSON.stringify(r.json), { status: r.status })
  }) as unknown as typeof fetch
  return { pedidos, buscar }
}

const envelope = (pnid: string, value: Record<string, unknown>, field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { phone_number_id: pnid }, ...value } }] }],
})
const mensagem = (pnid: string, id: string, de = CLIENTE, texto = 'oi, tem a blusa azul?') =>
  lerWebhookMeta(envelope(pnid, { contacts: [{ profile: { name: 'Rita' }, wa_id: de }], messages: [{ from: de, id, type: 'text', text: { body: texto } }] }))

// ─────────────────────────────────────────────────────────────

describe('a portaria do número oficial', () => {
  it('acha a empresa pelo id exato do número — e só por ele', async () => {
    expect(await empresaDoNumeroMeta(PNID_A)).toEqual({ id: 'org-a', slug: 'loja-a' })
    expect(await empresaDoNumeroMeta('999')).toBeNull()
    expect(await empresaDoNumeroMeta("1' or '1'='1")).toBeNull()
    expect(await empresaDoNumeroMeta('')).toBeNull()
  })

  it('o papel da aplicação não consegue chamar a função (nenhuma leitura entre empresas)', async () => {
    await expect(comoApp(db, 'org-c', (tx) => tx.query(`select * from public.org_do_numero_meta($1)`, [PNID_A]))).rejects.toThrow(/permission denied/i)
  })
})

describe('o webhook no caminho de sempre', () => {
  it('mensagem de cliente é gravada; a segunda entrega do mesmo id é "duplicada"', async () => {
    const canal = new CanalFalso()
    const r = await processarEventos(mensagem(PNID_A, 'wamid.C1'), { canal })
    expect(r.mensagens).toBe(1)
    expect(r.desfechos[0]!.tipo).toBe('silencio') // cliente fora de campanha: a loja responde
    expect(canal.enviadas).toEqual([])
    const linhas = await db.query<{ de: string; texto: string }>(`select de, texto from mensagens_agente where org_id = 'org-a'`)
    expect(linhas.rows).toEqual([{ de: 'PESSOA', texto: 'oi, tem a blusa azul?' }])

    const de_novo = await processarEventos(mensagem(PNID_A, 'wamid.C1'), { canal })
    expect(de_novo.desfechos[0]!.tipo).toBe('duplicada')
  })

  it('o eco do app WhatsApp Business marca "alguém da loja está conversando"', async () => {
    const r = await processarEventos(
      lerWebhookMeta(envelope(PNID_A, { message_echoes: [{ from: '557133330000', to: CLIENTE, id: 'wamid.E1', type: 'text', text: { body: 'já te respondo' } }] }, 'smb_message_echoes')),
      { canal: new CanalFalso() },
    )
    expect(r.ecos).toBe(1)
    const c = await db.query<{ humano_ate: Date | null }>(`select humano_ate from conversas_agente where org_id = 'org-a' and telefone like '%88887777'`)
    expect(c.rows[0]!.humano_ate).not.toBeNull()
    expect(new Date(c.rows[0]!.humano_ate!).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000)
  })

  it('número de empresa desconectada (canal fora do oficial) ou de ninguém: descartado', async () => {
    const r = await processarEventos([...mensagem(PNID_B, 'wamid.B1'), ...mensagem('555555555555555', 'wamid.X1')], { canal: new CanalFalso() })
    expect(r.mensagens).toBe(0)
    expect(r.descartados).toBe(2)
    const b = await db.query(`select 1 from mensagens_agente where org_id = 'org-b'`)
    expect(b.rows).toHaveLength(0)
  })
})

describe('a janela, do banco', () => {
  it('quem acabou de escrever está dentro; quem nunca escreveu, fora', async () => {
    const ultima = await ultimaEntradaDe('org-a', '(71) 98888-7777')
    expect(ultima).not.toBeNull()
    expect(Date.now() - ultima!.getTime()).toBeLessThan(60_000)
    expect(await ultimaEntradaDe('org-a', '71912340000')).toBeNull()
    // a mesma pessoa em OUTRA empresa não abre janela nenhuma aqui
    expect(await ultimaEntradaDe('org-c', CLIENTE)).toBeNull()

    const { pedidos, buscar } = metaFalsa()
    const canal = new CanalMeta('org-a', { phoneNumberId: PNID_A, token: TOKEN_A, versao: 'v25.0' }, { buscar })
    expect(await canal.enviar(CLIENTE, 'Temos sim!')).toMatchObject({ ok: true })
    expect(await canal.enviar('71912340000', 'oi')).toMatchObject({ ok: false, codigo: 'janela_fechada' })
    expect(pedidos).toHaveLength(1)
  })
})

describe('conectar pelo cadastro incorporado', () => {
  it('sem a Meta no servidor: recusa, sem chamar ninguém', async () => {
    const { pedidos, buscar } = metaFalsa()
    const r = await conectarPelaMeta(DONA_C, { code: 'c', wabaId: WABA_C, phoneNumberId: PNID_C, coexistencia: false, pin: '123456' }, { buscar })
    expect(r).toMatchObject({ ok: false })
    expect(pedidos).toHaveLength(0)
  })

  it('número novo sem PIN: pede o PIN antes de registrar', async () => {
    comMeta()
    const { buscar, pedidos } = metaFalsa()
    const r = await conectarPelaMeta(DONA_C, { code: 'c', wabaId: WABA_C, phoneNumberId: PNID_C, coexistencia: false }, { buscar, dormir: async () => {} } as never)
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.erro).toMatch(/PIN/)
    expect(pedidos.some((p) => p.url.includes('/register'))).toBe(false)
  })

  it('o caminho inteiro: token cifrado, app inscrito, número registrado, modelos criados, canal META', async () => {
    comMeta()
    const { pedidos, buscar } = metaFalsa()
    const r = await conectarPelaMeta(DONA_C, { code: 'CODIGO-30S', wabaId: WABA_C, phoneNumberId: PNID_C, coexistencia: false, pin: '123456' }, { buscar })
    expect(r).toMatchObject({ ok: true })

    const caminhos = pedidos.map((p) => `${p.metodo} ${new URL(p.url).pathname}`)
    expect(caminhos[0]).toBe('GET /v25.0/oauth/access_token')
    expect(caminhos).toContain(`POST /v25.0/${WABA_C}/subscribed_apps`)
    expect(caminhos).toContain(`POST /v25.0/${PNID_C}/register`)
    expect(pedidos.find((p) => p.url.endsWith('/register'))!.corpo).toEqual({ messaging_product: 'whatsapp', pin: '123456' })
    const criados = pedidos.filter((p) => p.metodo === 'POST' && p.url.endsWith('/message_templates')).map((p) => (p.corpo as { name: string }).name)
    expect(criados).toEqual(['norte_relatorio_dia', 'norte_aviso'])
    // depois da troca, o token vai no cabeçalho — nunca na URL
    expect(pedidos.slice(1).every((p) => p.auth === `Bearer ${TOKEN_NOVO}` && !p.url.includes(TOKEN_NOVO))).toBe(true)

    const ag = (await db.query<Record<string, unknown>>(`select * from agentes where id = 'ag-c'`)).rows[0]!
    expect(ag).toMatchObject({ canal: 'META', meta_phone_number_id: PNID_C, meta_waba_id: WABA_C, meta_numero_exibicao: '(71) 3····-0003' })
    expect(String(ag.meta_token_cifrado)).toMatch(/^v1\./)
    const tudo = JSON.stringify([(await db.query(`select * from agentes`)).rows, (await db.query(`select * from auditoria`)).rows])
    expect(tudo).not.toContain(TOKEN_NOVO)
    expect(tudo).not.toContain('123456')
    expect(tudo).toContain('agente.meta.conectou')

    const e = await estadoMeta(DONA_C)
    expect(e).toMatchObject({ disponivel: true, ligado: true, numero: '(71) 3····-0003', tokenAbre: true })
    expect(JSON.stringify(e)).not.toContain(TOKEN_NOVO)
  })

  it('o mesmo número não entra em duas empresas', async () => {
    comMeta()
    const { buscar } = metaFalsa()
    const r = await conectarPelaMeta(sessao('org-a', 'usr-ana'), { code: 'c', wabaId: WABA_C, phoneNumberId: PNID_C, coexistencia: true }, { buscar })
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.erro).toMatch(/outra conta do Norte/)
  })

  it('a mensagem de teste, fora da janela, sai pelo modelo norte_aviso', async () => {
    comMeta()
    const { pedidos, buscar } = metaFalsa()
    vi.stubGlobal('fetch', buscar)
    const r = await mensagemDeTeste(DONA_C)
    expect(r).toMatchObject({ ok: true })
    expect(r.ok && r.recado).toMatch(/modelo aprovado/)
    const enviado = pedidos.find((p) => p.url.endsWith(`/${PNID_C}/messages`))!
    expect(enviado.corpo).toMatchObject({ type: 'template', to: '5571977770003', template: { name: 'norte_aviso', language: { code: 'pt_BR' } } })
  })

  it('desconectar: desinscreve o app, esquece ids e token, e o canal volta a NENHUM', async () => {
    comMeta()
    const { pedidos, buscar } = metaFalsa()
    const r = await desconectarMeta(DONA_C, { buscar })
    expect(r).toEqual({ ok: true })
    expect(pedidos.map((p) => `${p.metodo} ${new URL(p.url).pathname}`)).toEqual([`DELETE /v25.0/${WABA_C}/subscribed_apps`])
    const ag = (await db.query<Record<string, unknown>>(`select * from agentes where id = 'ag-c'`)).rows[0]!
    expect(ag).toMatchObject({ canal: 'NENHUM', meta_phone_number_id: null, meta_token_cifrado: null, meta_waba_id: null })
  })
})
