// As lojas de quem fala, nas ferramentas do assistente.
//
// A vendedora da loja A não responde ao cliente com o "tem" da loja B, nem
// oferece o que a loja dela não vende. A conta que alguém só de uma loja
// manda lançar é da loja dela (sem loja, seria da empresa inteira — e o sim
// dela seria recusado). E quem só lança em duas lojas precisa dizer qual.
//
// Mesmo arranjo de assistente-loja-whatsapp.test.ts: PGlite com RLS, IA de
// mentira, canal de mentira.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'

vi.hoisted(() => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste'
  process.env.NORTE_URL = 'https://norte.exemplo'
  delete process.env.TRANSCRICAO_CHAVE
  delete process.env.ZAPI_INSTANCIA
})

vi.mock('../src/servidor/campanhas/entrada', () => ({
  receberDeCliente: async () => ({ tratou: false }),
  testeVivo: async () => false,
}))

import { processarMensagem, type Entrada } from '../src/servidor/assistente/conversa'
import { CanalFalso } from '../src/servidor/assistente/canal'
import { escolherLoja } from '../src/servidor/assistente/ferramentas-loja'
import { fechar } from '../src/servidor/banco'

let db: PGlite
let servidor: PGLiteSocketServer

const BIA = '5571999990002' // dona presa à loja Centro
const CAIO = '5571999990003' // dono preso a Centro e Praia

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
    ('org-e', 'Rede E', 'rede-e', 'BALCAO_AGENTE', 'ATIVA', '{agente,multiUnidade}', 50000, now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('u-centro', 'org-e', 'Centro', false, now()),
    ('u-praia', 'org-e', 'Praia', false, now()),
    ('u-norte', 'org-e', 'Norte', false, now());

  insert into usuarios (id, org_id, nome, email, telefone, telefone_confirmado, telefone_confirmado_em, atualizado_em) values
    ('usr-bia', 'org-e', 'Bia', 'bia@e.com', '(71) 99999-0002', '7199990002', now(), now()),
    ('usr-caio', 'org-e', 'Caio', 'caio@e.com', '(71) 99999-0003', '7199990003', now(), now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-bia', 'org-e', 'usr-bia', 'u-centro', 'DONO'),
    ('ac-caio1', 'org-e', 'usr-caio', 'u-centro', 'DONO'),
    ('ac-caio2', 'org-e', 'usr-caio', 'u-praia', 'DONO');

  insert into agentes (id, org_id, nome, ativo, canal, poderes, valor_max_cent, gasto_dia_cent, mensagens_dia, atualizado_em) values
    ('ag-e', 'org-e', 'Nina', true, 'ZAPI', '{consultar.produto,lancar.despesa}', 100000, 100000, 300, now());

  insert into categorias_financeiras (id, org_id, nome, tipo, grupo, ordem) values
    ('cat-out', 'org-e', 'Outras despesas', 'DESPESA', 'OCUPACAO', 0);

  -- vendida em todas, com saldo SÓ na Norte (que a Bia não vê)
  insert into produtos (id, org_id, nome, medida, preco_vista, atualizado_em) values
    ('p-blusa', 'org-e', 'Blusa Linho', 'UN', 99.90, now());
  -- vendida só na Praia
  insert into produtos (id, org_id, nome, medida, preco_vista, vendido_em, atualizado_em) values
    ('p-saia', 'org-e', 'Saia Praia', 'UN', 79.90, '{u-praia}', now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-blusa', 'org-e', 'p-blusa', 'BL01', true),
    ('v-saia', 'org-e', 'p-saia', 'SA01', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-blusa-norte', 'org-e', 'v-blusa', 'u-norte', 5, now()),
    ('e-blusa-centro', 'org-e', 'v-blusa', 'u-centro', 0, now());
`

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 50000 + Math.floor(Math.random() * 2000)
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

beforeEach(async () => {
  await db.exec(`update propostas_agente set situacao = 'RECUSADA', respondida_em = now() where situacao = 'AGUARDANDO'`)
})

type Corpo = { messages: { role: string; content: unknown }[] }
type Passo = (corpo: Corpo) => Record<string, unknown>
const USO = { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const diz = (texto: string): Passo => () => ({ content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage: USO })
const pede = (name: string, input: Record<string, unknown>): Passo => () => ({
  content: [{ type: 'tool_use', id: `toolu_${name}`, name, input }],
  stop_reason: 'tool_use',
  model: 'claude-sonnet-5',
  usage: USO,
})
function apiFalsa(...passos: Passo[]) {
  const corpos: Corpo[] = []
  const buscar = (async (_url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body)) as Corpo
    corpos.push(corpo)
    const passo = passos[Math.min(corpos.length - 1, passos.length - 1)]!
    return new Response(JSON.stringify(passo(corpo)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { buscar, corpos }
}
const resultado = (c: Corpo) =>
  (c.messages.at(-1)!.content as { type: string; content: string; is_error?: boolean }[]).find((b) => b.type === 'tool_result')!

let seq = 0
const msg = (telefone: string, texto: string): Entrada => ({ orgId: 'org-e', telefone, nome: null, texto, idExterno: `ESC${++seq}` })

async function ferramenta(telefone: string, nome: string, entrada: Record<string, unknown>) {
  const api = apiFalsa(pede(nome, entrada), diz('ok'))
  await processarMensagem(msg(telefone, 'pergunta'), { canal: new CanalFalso(), buscar: api.buscar })
  return resultado(api.corpos[1]!)
}

describe('escolher a loja pelo nome', () => {
  const lojas = [{ nome: 'Shopping Norte' }, { nome: 'Shopping' }, { nome: 'Centro' }]
  it('o nome exato vence o que o contém; pedaço só se uma loja só tiver', () => {
    expect(escolherLoja(lojas, 'shopping')).toEqual({ nome: 'Shopping' })
    expect(escolherLoja(lojas, 'Shopping Norte')).toEqual({ nome: 'Shopping Norte' })
    expect(escolherLoja(lojas, 'norte')).toEqual({ nome: 'Shopping Norte' })
    expect(escolherLoja(lojas, 'shop')).toBeNull()
    expect(escolherLoja(lojas, 'centrô')).toEqual({ nome: 'Centro' })
    expect(escolherLoja(lojas, '')).toBeNull()
  })
})

describe('consultar.produto: só as lojas de quem pergunta', () => {
  it('o "tem" é das lojas dela — saldo de loja que ela não vê não conta', async () => {
    const r = await ferramenta(BIA, 'consultar_produto', { busca: 'blusa' })
    const j = JSON.parse(r.content) as { itens: { peca: string; disponivel: boolean }[] }
    expect(j.itens).toEqual([expect.objectContaining({ peca: 'Blusa Linho', disponivel: false })])
  })

  it('produto que nenhuma loja dela vende não aparece', async () => {
    const r = await ferramenta(BIA, 'consultar_produto', { busca: 'saia' })
    expect(JSON.parse(r.content)).toMatchObject({ achados: 0 })
    // quem vê a Praia acha
    const r2 = await ferramenta(CAIO, 'consultar_produto', { busca: 'saia' })
    expect(JSON.parse(r2.content).itens).toEqual([expect.objectContaining({ peca: 'Saia Praia' })])
  })
})

describe('lancar.despesa: a conta é da loja de quem pede', () => {
  const conta = { descricao: 'Conta de luz', valor: 189.9, vencimento: '2026-10-20' }

  it('quem só lança numa loja: a conta nasce nela, e o resumo diz', async () => {
    const r = await ferramenta(BIA, 'lancar_despesa', conta)
    expect(r.is_error).toBeFalsy()
    const [p] = (await db.query<{ resumo: string; dados: { unidadeId: string | null } }>(
      `select resumo, dados from propostas_agente where situacao = 'AGUARDANDO' and usuario_id = 'usr-bia'`,
    )).rows
    expect(p!.dados.unidadeId).toBe('u-centro')
    expect(p!.resumo).toMatch(/, da Centro\.$/)
  })

  it('quem lança em duas lojas sem dizer qual: pergunta, e nada nasce', async () => {
    const r = await ferramenta(CAIO, 'lancar_despesa', conta)
    expect(r.is_error).toBe(true)
    expect(r.content).toBe('De qual loja é a conta? Centro, Praia.')
    const r2 = await ferramenta(CAIO, 'lancar_despesa', { ...conta, loja: 'praia' })
    expect(r2.is_error).toBeFalsy()
    const [p] = (await db.query<{ dados: { unidadeId: string | null } }>(
      `select dados from propostas_agente where situacao = 'AGUARDANDO' and usuario_id = 'usr-caio'`,
    )).rows
    expect(p!.dados.unidadeId).toBe('u-praia')
  })

  it('loja que não é dela não é escolhida', async () => {
    const r = await ferramenta(CAIO, 'lancar_despesa', { ...conta, loja: 'Norte' })
    expect(r.is_error).toBe(true)
  })
})
