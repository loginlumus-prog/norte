// A equipe pede, o dono aprova — e o assistente ajuda em tudo, menos a venda.
//
// Banco de verdade (PGlite com RLS), IA de mentira, canal de mentira, como em
// assistente-loja-whatsapp.test.ts. O que está provado aqui:
//
//   • SÓ O DONO APROVA: pela tela (`responderProposta`) e pelo WhatsApp. O
//     gerente não confirma nem o que pediu; quem pediu pode desistir do
//     próprio pedido, e não do alheio.
//   • O PEDIDO DA EQUIPE VAI AO DONO: a balconista pede, a dona recebe o
//     pedido com quem pediu, o resumo do servidor e o código; o "sim" da
//     balconista não executa; o "sim" da dona (com ou sem código, logo depois
//     do pedido) executa; quem pediu é avisado do desfecho. Sem dono com
//     telefone confirmado, o pedido fica na tela, e quem pediu fica sabendo.
//   • O CÓDIGO alcança qualquer proposta da empresa — até a da rotina.
//   • OS PODERES NOVOS, de ponta a ponta: pedir → a dona aprova → o efeito
//     está no banco, pelo serviço da tela (cliente, produto, estoque, receita,
//     baixa, encomenda, crediário) — e a recusa da tela volta em frase.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

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
import { fechar } from '../src/servidor/banco'
import { codigoDaProposta } from '../src/servidor/assistente/propostas'
import { responderProposta } from '../src/servidor/agente'
import { prepararFinanceiro, lancar } from '../src/servidor/financeiro'
import { abrirCaixa } from '../src/servidor/caixa'
import { ehDono, sessaoDoPedido } from '../src/servidor/poderes'
import { pode } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

const ANA = '5571999990001' // dona
const BETO = '5571988880002' // balcão da Loja Centro
const GIL = '5571977770003' // gerente da Loja Centro

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-ana', nome: 'Ana Dona', acessos: [{ papel: 'DONO', unidadeId: null }] }
const GERENTE: Sessao = { orgId: 'org-a', usuarioId: 'usr-gil', nome: 'Gil Gerente', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-a1' }] }
const BALCAO: Sessao = { orgId: 'org-a', usuarioId: 'usr-beto', nome: 'Beto Balcão', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a1' }] }
const EMPRESA = { modulos: ['agente', 'encomenda', 'crediario', 'multiUnidade', 'compras', 'fabrica'] }

const HOJE_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const AMANHA_SP = new Date(Date.parse(`${HOJE_SP}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)

const PODERES_LIGADOS = [
  'ver.estoque', 'estoque.entrada', 'ajustar.estoque', 'lancar.despesa',
  'cliente.cadastrar', 'cliente.editar', 'produto.cadastrar', 'produto.editar',
  'estoque.perda', 'estoque.contagem', 'estoque.transferir',
  'lancar.receita', 'conta.pagar', 'encomenda.criar', 'crediario.receber',
  'compras.pedido', 'fabrica.pedir', 'catalogo.postar', 'catalogo.ajustar',
]

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente,encomenda,crediario,multiUnidade,compras,fabrica}', 100000, now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, now()),
    ('uni-a2', 'org-a', 'Loja Praia', false, now()),
    ('uni-a9', 'org-a', 'Depósito', true, now());
  insert into unidades (id, org_id, nome, eh_fabrica, atualizada_em) values
    ('uni-fab', 'org-a', 'Fábrica Central', true, now());

  insert into fornecedores (id, org_id, nome, atualizado_em) values
    ('forn-1', 'org-a', 'Frigorífico Bom Corte', now());

  insert into catalogos (id, org_id, unidade_id, ativo, endereco, whatsapp, retirada, entrega, taxa_entrega, chave_pix, atualizado_em) values
    ('cat-a1', 'org-a', 'uni-a1', false, 'centro', '71999990001', true, true, 5.00, 'pix@loja.com', now());

  insert into usuarios (id, org_id, nome, email, telefone, telefone_confirmado, telefone_confirmado_em, atualizado_em) values
    ('usr-ana',  'org-a', 'Ana Dona',    'ana@a.com',  '(71) 99999-0001', '7199990001', now(), now()),
    ('usr-beto', 'org-a', 'Beto Balcão', 'beto@a.com', '(71) 98888-0002', '7188880002', now(), now()),
    ('usr-gil',  'org-a', 'Gil Gerente', 'gil@a.com',  '(71) 97777-0003', '7177770003', now(), now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-ana',  'org-a', 'usr-ana',  null,     'DONO'),
    ('ac-beto', 'org-a', 'usr-beto', 'uni-a1', 'BALCAO'),
    ('ac-gil',  'org-a', 'usr-gil',  'uni-a1', 'GERENTE');

  insert into agentes (id, org_id, nome, ativo, canal, poderes, valor_max_cent, gasto_dia_cent, mensagens_dia, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, 'ZAPI', '{${PODERES_LIGADOS.join(',')}}', 500000, 500000, 5000, now());

  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, custo, atualizado_em) values
    ('prod-pic', 'org-a', 'Picanha',         'KG', 79.90, 79.90, 35.00, now()),
    ('prod-cam', 'org-a', 'Camiseta básica', 'UN', 49.90, 49.90, 20.00, now()),
    ('prod-bon', 'org-a', 'Boné',            'UN', 30.00, 30.00, 10.00, now());

  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('var-pic', 'org-a', 'prod-pic', 'PIC001', true),
    ('var-cam', 'org-a', 'prod-cam', 'CAM001', true),
    ('var-bon', 'org-a', 'prod-bon', 'BON001', true);

  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('est-pic', 'org-a', 'var-pic', 'uni-a1', 10, now()),
    ('est-cam', 'org-a', 'var-cam', 'uni-a1', 20, now()),
    ('est-bon', 'org-a', 'var-bon', 'uni-a1', 5, now());

  insert into clientes (id, org_id, nome, telefone, documento, cidade, atualizado_em) values
    ('cli-joana', 'org-a', 'Joana Lima', '71988887777', '52998224725', 'Salvador', now());

  insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id) values
    ('v-1', 'org-a', 'uni-a1', 1, 'CONCLUIDA', 200, 'cli-joana');
  insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
    ('par-1', 'org-a', 'v-1', 'cli-joana', 'uni-a1', 1, 2, '2099-01-10', 100),
    ('par-2', 'org-a', 'v-1', 'cli-joana', 'uni-a1', 2, 2, '2099-02-10', 100);
`

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 56000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  await prepararFinanceiro(DONA)
  const categoria = await db.query<{ id: string }>(`select id from categorias_financeiras where tipo = 'DESPESA' order by ordem limit 1`)
  await lancar(DONA, {
    categoriaId: categoria.rows[0]!.id,
    unidadeId: 'uni-a1',
    tipo: 'DESPESA',
    descricao: 'Conta de luz de setembro',
    valor: 189.9,
    vencimento: new Date('2026-10-10T12:00:00'),
    fornecedor: 'Companhia de Luz',
  })
  expect((await abrirCaixa(DONA, 'uni-a1', 100)).ok).toBe(true)
}, 60_000)

afterAll(async () => {
  await fechar()
  const g = globalThis as { __prismaNorte?: unknown }
  delete g.__prismaNorte
  await servidor?.stop()
  await db?.close()
})

// Cada teste começa sem proposta esperando e sem histórico: o "sim" de um não
// acha a do outro, e o teto de respostas por conversa não chega.
beforeEach(async () => {
  await db.exec(`update propostas_agente set situacao = 'RECUSADA', respondida_em = now() where situacao = 'AGUARDANDO'`)
  await db.exec(`delete from mensagens_agente`)
})

// ── a IA de mentira ──

type Corpo = { tools?: { name: string }[]; messages: { role: string; content: unknown }[] }
type Passo = (corpo: Corpo) => Record<string, unknown>
const USO = { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
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
  return { buscar, corpos, nomes: (i = 0) => (corpos[i]?.tools ?? []).map((t) => t.name) }
}
const resultadoDa = (c: Corpo) => {
  const blocos = c.messages.at(-1)!.content as { type: string; content: string; is_error?: boolean }[]
  return blocos.find((b) => b.type === 'tool_result')!
}

let seq = 0
const msg = (telefone: string, texto: string): Entrada => ({ orgId: 'org-a', telefone, nome: null, texto, idExterno: `AP${++seq}` })

const uma = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!
const saldo = async (variacao: string, unidade: string) =>
  Number((await db.query<{ q: string }>(`select quantidade q from estoque where variacao_id = $1 and unidade_id = $2`, [variacao, unidade])).rows[0]?.q ?? 0)
type Proposta = { id: string; poder: string; situacao: string; resumo: string; usuario_id: string | null; erro: string | null }
const ultimaProposta = () =>
  uma<Proposta>(`select id, poder, situacao, resumo, usuario_id, erro from propostas_agente where org_id = 'org-a' order by criada_em desc limit 1`)

/** Alguém da equipe pede pelo modelo (de mentira): a ferramenta é chamada com `input`. */
async function pedir(telefone: string, ferramenta: string, input: Record<string, unknown>, canal = new CanalFalso()) {
  const api = apiFalsa(pede(ferramenta, input), diz('Montei o pedido.'))
  const r = await processarMensagem(msg(telefone, 'um pedido'), { canal, buscar: api.buscar })
  const resultado = resultadoDa(api.corpos[1]!)
  return { r, resultado, canal, api }
}

/** Pede e espera que vire proposta; devolve a proposta e o código. */
async function pedirProposta(telefone: string, ferramenta: string, input: Record<string, unknown>) {
  const x = await pedir(telefone, ferramenta, input)
  expect(x.resultado.is_error, x.resultado.content).toBeFalsy()
  const p = await ultimaProposta()
  expect(p.situacao).toBe('AGUARDANDO')
  return { ...x, proposta: p, codigo: codigoDaProposta(p.id) }
}

/** A dona responde "sim <código>" no WhatsApp; devolve a frase que ela recebeu. */
async function aprovar(codigo: string, canal = new CanalFalso(), palavra = 'sim') {
  await processarMensagem(msg(ANA, `${palavra} ${codigo}`), { canal, buscar: apiFalsa(diz('não deveria ser chamado')).buscar })
  return canal.enviadas.filter((m) => m.numero === ANA).at(-1)!.texto
}

// ─────────────────────────────────────────────────────────────

describe('quem é dono, e a sessão do pedido (puro)', () => {
  it('dono é o papel DONO valendo agora — cargo com tudo não é dono', () => {
    expect(ehDono(DONA)).toBe(true)
    expect(ehDono(GERENTE)).toBe(false)
    expect(ehDono({ acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: new Date(Date.now() - 1000) }] })).toBe(false)
    expect(ehDono({ acessos: [{ papel: 'CARGO', unidadeId: null, capacidades: ['produto.preco'] }] })).toBe(false)
  })

  it('a sessão do pedido vê quem pede como gerente e financeiro SÓ nas lojas dela', () => {
    const s = sessaoDoPedido(BALCAO)
    expect(pode(BALCAO, 'produto.cadastrar')).toBe(false)
    expect(pode(s, 'produto.cadastrar', 'uni-a1')).toBe(true)
    expect(pode(s, 'financeiro.lancar', 'uni-a1')).toBe(true)
    expect(pode(s, 'estoque.ajustar', 'uni-a2')).toBe(false)
    expect(pode(s, 'empresa.configurar')).toBe(false)
    expect(sessaoDoPedido(DONA)).toBe(DONA)
  })
})

describe('só o dono aprova — pela tela', () => {
  async function propostaDe(usuarioId: string | null) {
    const id = `prop-${++seq}`
    await db.query(
      `insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, situacao, expira_em, usuario_id, criada_em)
       values ($1, 'org-a', 'ag-a', 'ajustar.estoque', 'Somar 2 bonés', $2, 'AGUARDANDO', $3, $4, $5)`,
      [id, JSON.stringify({ variacaoId: 'var-bon', unidadeId: 'uni-a1', quantidade: 2, motivo: 'achou no fundo' }), new Date(Date.now() + 864e5), usuarioId, new Date()],
    )
    return id
  }

  it('o gerente não confirma — nem o que ele mesmo pediu; a dona confirma', async () => {
    const id = await propostaDe('usr-gil')
    const antes = await saldo('var-bon', 'uni-a1')
    expect(await responderProposta(GERENTE, EMPRESA, id, true)).toEqual({ ok: false, motivo: 'so_o_dono' })
    expect(await saldo('var-bon', 'uni-a1')).toBe(antes)
    expect((await uma<{ s: string }>(`select situacao s from propostas_agente where id = $1`, [id])).s).toBe('AGUARDANDO')
    expect(await responderProposta(DONA, EMPRESA, id, true)).toMatchObject({ ok: true })
    expect(await saldo('var-bon', 'uni-a1')).toBe(antes + 2)
  })

  it('quem pediu pode desistir do próprio pedido; do pedido alheio, não', async () => {
    const minha = await propostaDe('usr-beto')
    const alheia = await propostaDe('usr-gil')
    expect(await responderProposta(BALCAO, EMPRESA, alheia, false)).toEqual({ ok: false, motivo: 'so_o_dono' })
    expect(await responderProposta(BALCAO, EMPRESA, minha, false)).toEqual({ ok: true })
    expect((await uma<{ s: string }>(`select situacao s from propostas_agente where id = $1`, [minha])).s).toBe('RECUSADA')
  })

  it('a proposta da rotina (sem quem pediu) também é só do dono', async () => {
    const id = await propostaDe(null)
    expect(await responderProposta(GERENTE, EMPRESA, id, false)).toEqual({ ok: false, motivo: 'so_o_dono' })
    expect(await responderProposta(DONA, EMPRESA, id, false)).toEqual({ ok: true })
  })
})

describe('o pedido da equipe vai para a dona, pelo WhatsApp', () => {
  it('a balconista pede: a dona recebe com quem pediu, o resumo e o código; o "sim" da balconista não executa', async () => {
    const antes = await saldo('var-cam', 'uni-a1')
    const { r, canal, proposta, codigo } = await pedirProposta(BETO, 'estoque_perda', { produto: 'camiseta', quantidade: 2, motivo: 'rasgou no provador' })
    expect(proposta).toMatchObject({ poder: 'estoque.perda', usuario_id: 'usr-beto' })
    const paraDona = canal.enviadas.filter((m) => m.numero === ANA)
    expect(paraDona).toHaveLength(1)
    expect(paraDona[0]!.texto).toBe(
      `*Pedido para aprovar* — Beto Balcão pediu pelo assistente:\n${proposta.resumo}\nResponda *SIM ${codigo}* para aprovar ou *NÃO ${codigo}* para recusar.`,
    )
    expect(r.tipo === 'respondida' && r.texto).toContain(`*Pedido para o dono aprovar:* ${proposta.resumo}\nCódigo *${codigo}*. Só o dono aprova: mandei para ele`)

    for (const tentativa of ['sim', `sim ${codigo}`, 'ok']) {
      const c = new CanalFalso()
      const api = apiFalsa(diz('x'))
      await processarMensagem(msg(BETO, tentativa), { canal: c, buscar: api.buscar })
      expect(c.enviadas.at(-1)!.texto, tentativa).toMatch(/esperando a aprovação do dono/)
      expect(api.corpos).toHaveLength(0)
    }
    expect(await saldo('var-cam', 'uni-a1')).toBe(antes)
    expect((await ultimaProposta()).situacao).toBe('AGUARDANDO')
  })

  it('o "sim" sem código da dona, logo depois do pedido, aprova — e a balconista é avisada', async () => {
    const antes = await saldo('var-cam', 'uni-a1')
    const { codigo } = await pedirProposta(BETO, 'estoque_perda', { produto: 'CAM001', quantidade: 1, motivo: 'manchou' })
    const canal = new CanalFalso()
    await processarMensagem(msg(ANA, 'sim'), { canal, buscar: apiFalsa(diz('x')).buscar })
    expect(await saldo('var-cam', 'uni-a1')).toBe(antes - 1)
    expect(canal.enviadas.find((m) => m.numero === ANA)!.texto).toBe(
      `Feito: perda de 1 un de Camiseta básica lançada na Loja Centro. Saldo agora: ${antes - 1} un.`,
    )
    expect(canal.enviadas.find((m) => m.numero === BETO)!.texto).toMatch(new RegExp(`^Ana Dona aprovou o seu pedido \\*${codigo}\\*\\. Feito: perda de 1 un`))
    // o livro: a perda em nome de quem APROVOU
    expect(Number((await uma<{ n: string }>(`select count(*) n from auditoria where acao = 'estoque.perda' and usuario_id = 'usr-ana'`)).n)).toBeGreaterThan(0)
  })

  it('o NÃO da dona recusa, nada muda, e a balconista fica sabendo', async () => {
    const antes = await saldo('var-cam', 'uni-a1')
    const { codigo } = await pedirProposta(BETO, 'estoque_perda', { produto: 'camiseta', quantidade: 1, motivo: 'sumiu' })
    const canal = new CanalFalso()
    expect(await aprovar(codigo, canal, 'não')).toMatch(/^Certo, cancelei\. Nada foi feito/)
    expect(canal.enviadas.find((m) => m.numero === BETO)!.texto).toMatch(new RegExp(`^Ana Dona recusou o seu pedido \\*${codigo}\\*`))
    expect((await ultimaProposta()).situacao).toBe('RECUSADA')
    expect(await saldo('var-cam', 'uni-a1')).toBe(antes)
  })

  it('a balconista desiste do próprio pedido com NÃO e o código', async () => {
    const { codigo } = await pedirProposta(BETO, 'estoque_perda', { produto: 'camiseta', quantidade: 1, motivo: 'engano' })
    const canal = new CanalFalso()
    await processarMensagem(msg(BETO, `não ${codigo}`), { canal })
    expect(canal.enviadas.at(-1)!.texto).toMatch(new RegExp(`^Certo, desisti do pedido \\*${codigo}\\*`))
    expect((await ultimaProposta()).situacao).toBe('RECUSADA')
  })

  it('o gerente não aprova o pedido da balconista, nem com o código', async () => {
    const { codigo } = await pedirProposta(BETO, 'estoque_perda', { produto: 'camiseta', quantidade: 1, motivo: 'furou' })
    const canal = new CanalFalso()
    await processarMensagem(msg(GIL, `sim ${codigo}`), { canal })
    expect(canal.enviadas.at(-1)!.texto).toBe('Só o dono aprova o que o assistente propõe.')
    expect((await ultimaProposta()).situacao).toBe('AGUARDANDO')
  })

  it('sem dono com telefone confirmado, o pedido fica na tela — e quem pediu fica sabendo', async () => {
    await db.exec(`update usuarios set telefone_confirmado_em = null where id = 'usr-ana'`)
    try {
      const { r, canal } = await pedirProposta(BETO, 'estoque_perda', { produto: 'camiseta', quantidade: 1, motivo: 'molhou' })
      expect(canal.enviadas.some((m) => m.numero === ANA)).toBe(false)
      expect(r.tipo === 'respondida' && r.texto).toMatch(/nenhum dono recebe pelo WhatsApp agora: ele aprova na tela do assistente/)
    } finally {
      await db.exec(`update usuarios set telefone_confirmado_em = now() where id = 'usr-ana'`)
    }
  })

  it('pelo código, a dona alcança qualquer proposta da empresa — até a da rotina', async () => {
    await db.query(
      `insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, situacao, expira_em, criada_em)
       values ('prop-rotina-x', 'org-a', 'ag-a', 'ajustar.estoque', 'Somar 1 boné', $1, 'AGUARDANDO', $2, $3)`,
      [JSON.stringify({ variacaoId: 'var-bon', unidadeId: 'uni-a1', quantidade: 1, motivo: 'rotina' }), new Date(Date.now() + 864e5), new Date(Date.now() - 3 * 3600_000)],
    )
    const antes = await saldo('var-bon', 'uni-a1')
    // "sim" sem código não alcança (não foi pedida nem encaminhada aqui)...
    const api = apiFalsa(diz('Sim para quê?'))
    await processarMensagem(msg(ANA, 'sim'), { canal: new CanalFalso(), buscar: api.buscar })
    expect(api.corpos).toHaveLength(1)
    // ...e o código, sim.
    expect(await aprovar(codigoDaProposta('prop-rotina-x'))).toMatch(/^Feito/)
    expect(await saldo('var-bon', 'uni-a1')).toBe(antes + 1)
  })

  it('o assistente da balconista oferece as ferramentas de pedir, mas não as de ler o que ela não vê', async () => {
    const api = apiFalsa(diz('oi'))
    await processarMensagem(msg(BETO, 'oi'), { canal: new CanalFalso(), buscar: api.buscar })
    const nomes = api.nomes(0)
    for (const n of ['produto_editar', 'conta_pagar', 'lancar_receita', 'crediario_receber', 'estoque_transferir']) expect(nomes).toContain(n)
    expect(nomes).not.toContain('ver_contas')
    const sistema = JSON.stringify((api.corpos[0] as unknown as { system: unknown }).system)
    expect(sistema).toMatch(/NÃO é dono/)
    expect(sistema).toMatch(/MENOS lançar venda no balcão/)
  })
})

// ─────────────────────────────────────────────────────────────

describe('os poderes novos, de ponta a ponta', () => {
  it('cliente.cadastrar: a ficha nasce no SIM, com o telefone em dígitos e o CPF conferido', async () => {
    const recusa = await pedir(BETO, 'cliente_cadastrar', { nome: 'Maria Souza', cpf: '111.111.111-11' })
    expect(recusa.resultado).toMatchObject({ is_error: true, content: expect.stringMatching(/CPF não confere/) })

    const { proposta, codigo } = await pedirProposta(BETO, 'cliente_cadastrar', {
      nome: 'Maria Souza', telefone: '(71) 99123-4567', cpf: '390.533.447-05', nascimento: '1990-05-20', bairro: 'Barra',
    })
    expect(proposta.resumo).toBe('Cadastrar cliente: Maria Souza — telefone (71) 99123-4567; CPF final 05; nascimento 20/05/1990; bairro: Barra.')
    expect(Number((await uma<{ n: string }>(`select count(*) n from clientes where nome = 'Maria Souza'`)).n)).toBe(0)
    expect(await aprovar(codigo)).toBe('Feito: ficha de Maria Souza criada.')
    const c = await uma<{ telefone: string; documento: string; bairro: string; nascimento: Date }>(
      `select telefone, documento, bairro, nascimento from clientes where nome = 'Maria Souza'`,
    )
    expect(c).toMatchObject({ telefone: '71991234567', documento: '39053344705', bairro: 'Barra' })
    expect(new Date(c.nascimento).toISOString().slice(0, 10)).toBe('1990-05-20')

    // o mesmo telefone de novo: pergunta, não duplica
    const repetido = await pedir(BETO, 'cliente_cadastrar', { nome: 'Maria S.', telefone: '71991234567' })
    expect(repetido.resultado.content).toMatch(/Já existe cliente com esse telefone: Maria Souza/)
  })

  it('cliente.editar: só o que foi pedido muda — o resto da ficha fica', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'cliente_editar', { cliente: 'joana', telefone: '71 98111-2222', observacoes: 'Prefere Pix' })
    expect(proposta.resumo).toBe('Corrigir a ficha de Joana Lima: telefone (71) 98111-2222; observações: Prefere Pix.')
    expect(await aprovar(codigo)).toBe('Feito: ficha de Joana Lima atualizada.')
    const c = await uma<{ telefone: string; documento: string; cidade: string; observacoes: string }>(
      `select telefone, documento, cidade, observacoes from clientes where id = 'cli-joana'`,
    )
    expect(c).toEqual({ telefone: '71981112222', documento: '52998224725', cidade: 'Salvador', observacoes: 'Prefere Pix' })
  })

  it('produto.cadastrar: o produto nasce no SIM, com o preço e as lojas; o que já existe vira pergunta', async () => {
    const existe = await pedir(BETO, 'produto_cadastrar', { nome: 'picanha', precoVista: 80 })
    expect(existe.resultado.content).toMatch(/Já existe "Picanha"/)

    const { proposta, codigo } = await pedirProposta(BETO, 'produto_cadastrar', {
      nome: 'Brigadeiro gourmet', precoVista: 4.5, precoCartao: 5, custo: 1.8, lojas: ['Praia'],
    })
    expect(proposta.resumo).toBe('Cadastrar produto: Brigadeiro gourmet — R$ 4,50/un à vista, R$ 5,00 no cartão, custo R$ 1,80, vendido em Loja Praia.')
    expect(await aprovar(codigo)).toMatch(/^Feito: produto Brigadeiro gourmet cadastrado \(cód\. BRI\d+\)\.$/)
    const p = await uma<{ preco_vista: string; preco_cartao: string; custo: string; vendido_em: string[] }>(
      `select preco_vista, preco_cartao, custo, vendido_em from produtos where nome = 'Brigadeiro gourmet'`,
    )
    expect([Number(p.preco_vista), Number(p.preco_cartao), Number(p.custo)]).toEqual([4.5, 5, 1.8])
    expect(p.vendido_em).toEqual(['uni-a2'])
  })

  it('produto.editar: o preço muda no SIM, e o mínimo da loja junto', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'produto_editar', { produto: 'picanha', precoVista: 84.9, estoqueMinimo: 3 })
    expect(proposta.resumo).toBe('Mudar o produto Picanha (cód. PIC001): à vista R$ 79,90 → R$ 84,90; estoque mínimo na Loja Centro: 3 kg.')
    expect(await aprovar(codigo)).toBe('Feito: ficha de Picanha atualizada; estoque mínimo de Picanha na Loja Centro: 3 kg.')
    expect(Number((await uma<{ p: string }>(`select preco_vista p from produtos where id = 'prod-pic'`)).p)).toBe(84.9)
    expect(Number((await uma<{ m: string }>(`select minimo m from estoque where id = 'est-pic'`)).m)).toBe(3)
    expect(Number((await uma<{ n: string }>(`select count(*) n from auditoria where acao = 'produto.preco.alterou' and usuario_id = 'usr-ana'`)).n)).toBe(1)
  })

  it('produto.editar: a recusa da tela volta em frase — tirar de venda com estoque não passa', async () => {
    const { codigo } = await pedirProposta(BETO, 'produto_editar', { produto: 'boné', ativo: false })
    expect(await aprovar(codigo)).toMatch(/^Não deu: Ainda tem saldo deste produto \(Loja Centro: \d+\)/)
    expect((await uma<{ a: boolean }>(`select ativo a from produtos where id = 'prod-bon'`)).a).toBe(true)
    expect((await ultimaProposta()).situacao).toBe('FALHOU')
  })

  it('estoque.contagem: corrige pelo contado, com a diferença no resumo', async () => {
    const atual = await saldo('var-pic', 'uni-a1')
    const { proposta, codigo } = await pedirProposta(ANA, 'estoque_contagem', { produto: 'PIC001', contado: 8500, unidade: 'g', loja: 'Centro' })
    const br = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
    expect(proposta.resumo).toContain(`o sistema diz ${br(atual)} kg, contado 8,5 kg (−${br(atual - 8.5)} kg)`)
    expect(await aprovar(codigo)).toBe(`Feito: estoque de Picanha na Loja Centro corrigido: era ${br(atual)} kg, agora 8,5 kg.`)
    expect(await saldo('var-pic', 'uni-a1')).toBe(8.5)
  })

  it('estoque.contagem: se uma venda mexeu no saldo depois do pedido, o SIM recusa', async () => {
    const { codigo } = await pedirProposta(ANA, 'estoque_contagem', { produto: 'boné', contado: 2, loja: 'Loja Centro' })
    await db.exec(`update estoque set quantidade = quantidade - 1 where id = 'est-bon'`)
    expect(await aprovar(codigo)).toMatch(/^Não deu: O estoque mudou enquanto você contava/)
    await db.exec(`update estoque set quantidade = quantidade + 1 where id = 'est-bon'`)
  })

  it('estoque.transferir: tira de uma loja e põe na outra; para quem não vende, pergunta antes', async () => {
    const antesCentro = await saldo('var-cam', 'uni-a1')
    const { proposta, codigo } = await pedirProposta(ANA, 'estoque_transferir', { produto: 'camiseta', quantidade: 2, de: 'Centro', para: 'Praia' })
    expect(proposta.resumo).toBe(`Transferir 2 un de Camiseta básica (cód. CAM001) da Loja Centro para a Loja Praia. Saldo hoje na Loja Centro: ${antesCentro} un.`)
    expect(await aprovar(codigo)).toMatch(/^Feito: 2 un de Camiseta básica transferidos da Loja Centro para a Loja Praia\./)
    expect(await saldo('var-cam', 'uni-a1')).toBe(antesCentro - 2)
    expect(await saldo('var-cam', 'uni-a2')).toBe(2)

    await db.exec(`update produtos set vendido_em = '{uni-a1}' where id = 'prod-bon'`)
    try {
      const recusa = await pedir(ANA, 'estoque_transferir', { produto: 'boné', quantidade: 1, de: 'Centro', para: 'Praia' })
      expect(recusa.resultado).toMatchObject({ is_error: true, content: expect.stringMatching(/A Loja Praia não vende Boné/) })
    } finally {
      await db.exec(`update produtos set vendido_em = '{}' where id = 'prod-bon'`)
    }
  })

  it('lancar.receita: a receita já recebida entra com o dia do recebimento', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'lancar_receita', { descricao: 'Aluguel do espaço da vitrine', valor: 350, vencimento: HOJE_SP, recebido: true })
    expect(proposta.resumo).toMatch(/^Lançar receita: "Aluguel do espaço da vitrine" — R\$ 350,00, recebida em .* \(Outras receitas\), da Loja Centro\.$/)
    expect(await aprovar(codigo)).toMatch(/^Feito: receita "Aluguel do espaço da vitrine" de R\$ 350,00 lançada como recebida em/)
    const l = await uma<{ tipo: string; valor: string; pago_em: Date; unidade_id: string }>(
      `select tipo, valor, pago_em, unidade_id from lancamentos where descricao = 'Aluguel do espaço da vitrine'`,
    )
    expect(l).toMatchObject({ tipo: 'RECEITA', unidade_id: 'uni-a1' })
    expect(Number(l.valor)).toBe(350)
    expect(new Date(l.pago_em).toISOString().slice(0, 10)).toBe(HOJE_SP)
  })

  it('conta.pagar: acha a conta em aberto pelo nome e dá baixa no dia dito', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'conta_pagar', { conta: 'luz', pagoEm: HOJE_SP })
    expect(proposta.resumo).toMatch(/^Dar baixa: "Conta de luz de setembro" — R\$ 189,90, vencimento 10\/10\/2026, da Loja Centro — paga em/)
    expect(await aprovar(codigo)).toMatch(/^Feito: Conta de luz de setembro \(R\$ 189,90\) marcada como paga em/)
    const l = await uma<{ pago_em: Date }>(`select pago_em from lancamentos where descricao = 'Conta de luz de setembro'`)
    expect(new Date(l.pago_em).toISOString().slice(0, 10)).toBe(HOJE_SP)
    // já paga: não acha mais para pagar
    expect((await pedir(BETO, 'conta_pagar', { conta: 'luz' })).resultado.content).toMatch(/Não achei conta em aberto/)
  })

  it('encomenda.criar: a encomenda nasce no SIM, com o sinal no financeiro', async () => {
    const passada = await pedir(BETO, 'encomenda_criar', { cliente: 'Lia', descricao: 'Bolo', valor: 100, dia: '2020-01-01', hora: '10:00' })
    expect(passada.resultado.content).toMatch(/já passaram/)

    const { proposta, codigo } = await pedirProposta(BETO, 'encomenda_criar', {
      cliente: 'Lia Mendes', telefone: '71 99876-5432', descricao: 'Bolo de chocolate 2 kg', valor: 120, sinal: 50, formaSinal: 'pix', dia: AMANHA_SP, hora: '15:00',
    })
    expect(proposta.resumo).toMatch(/^Anotar encomenda na Loja Centro para Lia Mendes \(\(71\) 98765-4321|^Anotar encomenda na Loja Centro para Lia Mendes/)
    expect(proposta.resumo).toMatch(/Bolo de chocolate 2 kg — R\$ 120,00, sinal de R\$ 50,00 em Pix \(falta R\$ 70,00\), retirada em .* às 15:00\.$/)
    expect(await aprovar(codigo)).toMatch(/^Feito: encomenda ENC-[A-Z0-9]{6} anotada para Lia Mendes\.$/)
    const e = await uma<{ valor: string; sinal: string; sinal_forma: string; quem: string }>(
      `select valor, sinal, sinal_forma, quem from encomendas where cliente_nome = 'Lia Mendes'`,
    )
    expect([Number(e.valor), Number(e.sinal), e.sinal_forma, e.quem]).toEqual([120, 50, 'PIX', 'Ana Dona'])
  })

  it('crediario.receber: a parcela mais antiga recebe no SIM; o que passa da parcela vira pergunta', async () => {
    const demais = await pedir(BETO, 'crediario_receber', { cliente: 'Joana', valor: 150, forma: 'pix' })
    expect(demais.resultado.content).toMatch(/passa do que falta na parcela mais antiga/)

    const { proposta, codigo } = await pedirProposta(BETO, 'crediario_receber', { cliente: 'Joana', valor: 40, forma: 'pix' })
    expect(proposta.resumo).toBe('Receber R$ 40,00 de Joana Lima em Pix: parcela 1/2 da Loja Centro, vence 10/01/2099. Fica faltando R$ 60,00 nesta parcela.')
    expect(await aprovar(codigo)).toBe('Feito: recebi R$ 40,00 de Joana Lima (parcela 1/2). Ainda falta R$ 60,00 nesta parcela.')
    expect(Number((await uma<{ p: string }>(`select pago p from parcelas where id = 'par-1'`)).p)).toBe(40)

    // sem valor: o resto da parcela, e ela quita
    const resto = await pedirProposta(BETO, 'crediario_receber', { cliente: 'joana lima', forma: 'dinheiro' })
    expect(resto.proposta.resumo).toMatch(/^Receber R\$ 60,00 de Joana Lima em Dinheiro: parcela 1\/2 .* Quita a parcela\.$/)
    expect(await aprovar(resto.codigo)).toMatch(/Parcela quitada\.$/)
    expect((await uma<{ q: Date | null }>(`select quitada_em q from parcelas where id = 'par-1'`)).q).not.toBeNull()
  })
  it('compras.pedido: o pedido nasce rascunho no SIM, com o custo do cadastro e o fornecedor', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'compras_pedido', {
      itens: [{ produto: 'picanha', quantidade: 10 }, { produto: 'BON001', quantidade: 5, custoUnit: 9 }], fornecedor: 'bom corte',
    })
    expect(proposta.resumo).toBe(
      'Montar pedido de compra para a Loja Centro, fornecedor Frigorífico Bom Corte: 10 kg Picanha; 5 un Boné (R$ 9,00/un). ' +
        'Total estimado: R$ 395,00. Fica como rascunho, para mandar ao fornecedor pela tela de Compras.',
    )
    expect(await aprovar(codigo)).toMatch(/^Feito: pedido de compra COMP-[A-Z0-9]{6} montado \(rascunho\)/)
    const pc = await uma<{ id: string; situacao: string; fornecedor_id: string; quem: string }>(`select id, situacao, fornecedor_id, quem from pedidos_compra order by criado_em desc limit 1`)
    expect(pc).toMatchObject({ situacao: 'RASCUNHO', fornecedor_id: 'forn-1', quem: 'Ana Dona' })
    expect(Number((await uma<{ n: string }>(`select count(*) n from itens_compra where pedido_id = $1`, [pc.id])).n)).toBe(2)
  })

  it('compras.pedido: acima do teto de valor do assistente, nem vira proposta', async () => {
    await db.exec(`update agentes set valor_max_cent = 10000 where id = 'ag-a'`)
    try {
      const r = await pedir(BETO, 'compras_pedido', { itens: [{ produto: 'picanha', quantidade: 10 }] })
      expect(r.resultado).toMatchObject({ is_error: true, content: expect.stringMatching(/passa do teto/) })
    } finally {
      await db.exec(`update agentes set valor_max_cent = 500000 where id = 'ag-a'`)
    }
  })

  it('fabrica.pedir: o pedido à fábrica nasce no SIM', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'fabrica_pedir', { itens: [{ produto: 'camiseta', quantidade: 12 }] })
    expect(proposta.resumo).toBe('Pedir à Fábrica Central para a Loja Centro: 12 un Camiseta básica.')
    expect(await aprovar(codigo)).toMatch(/^Feito: pedido nº \d+ feito à Fábrica Central\.$/)
    const pf = await uma<{ loja_id: string; fabrica_id: string; pedido_por: string }>(`select loja_id, fabrica_id, pedido_por from pedidos_fabrica order by criado_em desc limit 1`)
    expect(pf).toEqual({ loja_id: 'uni-a1', fabrica_id: 'uni-fab', pedido_por: 'Ana Dona' })
  })

  it('catalogo.ajustar: abre o catálogo e muda a taxa, e o resto do catálogo fica', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'catalogo_ajustar', { aberto: true, taxaEntrega: 7, pedidoMinimo: 30 })
    expect(proposta.resumo).toBe('Ajustar o catálogo da Loja Centro: abrir o catálogo; taxa de entrega R$ 5,00 → R$ 7,00; pedido mínimo R$ 30,00.')
    expect(await aprovar(codigo)).toBe('Feito: catálogo da Loja Centro ajustado.')
    const c = await uma<{ ativo: boolean; taxa_entrega: string; pedido_minimo: string; chave_pix: string; endereco: string }>(
      `select ativo, taxa_entrega, pedido_minimo, chave_pix, endereco from catalogos where id = 'cat-a1'`,
    )
    expect([c.ativo, Number(c.taxa_entrega), Number(c.pedido_minimo), c.chave_pix, c.endereco]).toEqual([true, 7, 30, 'pix@loja.com', 'centro'])
  })

  it('catalogo.postar: a postagem de texto nasce no SIM, ligada ao produto', async () => {
    const { proposta, codigo } = await pedirProposta(BETO, 'catalogo_postar', { titulo: 'Picanha nova', texto: 'Chegou picanha fresquinha!', produto: 'picanha' })
    expect(proposta.resumo).toBe('Postar no catálogo da Loja Centro: "Picanha nova" — Chegou picanha fresquinha! (ligado a Picanha).')
    expect(await aprovar(codigo)).toBe('Feito: postagem "Picanha nova" publicada no catálogo da Loja Centro.')
    expect(await uma<{ titulo: string; produto_id: string }>(`select titulo, produto_id from postagens_catalogo order by criada_em desc limit 1`)).toEqual({
      titulo: 'Picanha nova',
      produto_id: 'prod-pic',
    })
  })
})
