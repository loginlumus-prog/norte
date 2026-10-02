// Tocar a loja pelo WhatsApp, de ponta a ponta: banco de verdade (PGlite com
// RLS, como em assistente-fluxo.test.ts), IA de mentira, canal de mentira.
//
// O que está provado aqui:
//   • "comprei 10 kg de picanha a 39,90" vira PROPOSTA com o nome do
//     cadastro — e nada entra no estoque até o SIM
//   • o SIM de quem pediu, na conversa, lança a entrada pelo serviço da tela
//     (saldo, custo) e responde com o saldo de agora — sem chamar o modelo
//   • dois produtos parecidos viram pergunta; produto que não existe pede o
//     preço de venda, e com ele nasce junto no SIM; "500 g" de produto em
//     quilo entra como 0,5 kg
//   • o SIM de OUTRA pessoa não alcança a proposta; a permissão é conferida
//     de novo no sim; proposta vencida não executa; várias viram lista, e
//     "sim 2" escolhe; proposta sem quem pediu é só da tela
//   • o áudio da equipe vira texto (com o "Ouvi: …"), o de cliente nunca vai
//     para a transcrição, e sem chave fica o aviso de sempre
//   • as encomendas: a consulta mostra o pedido novo do catálogo só com o
//     primeiro nome; aceitar vira proposta; o aviso à equipe vai para dono e
//     gerente da loja (não para o balcão), uma vez; ACEITAR e PRONTO
//     respondidos no WhatsApp mudam a encomenda e avisam a cliente com o link

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
import { avisarClienteDaEncomenda, avisarEquipeDoPedido } from '../src/servidor/assistente/avisos-encomenda'
import { CanalFalso } from '../src/servidor/assistente/canal'
import { chaveTelefone } from '../src/servidor/assistente/telefone'
import { fechar } from '../src/servidor/banco'
import { codigoDaProposta } from '../src/servidor/assistente/propostas'

let db: PGlite
let servidor: PGLiteSocketServer

const ANA = '5571999990001' // dona
const BETO = '5571988880002' // balcão da loja
const GIL = '5571977770003' // gerente da loja
const CLIENTE = '5571955550009' // quem pediu pelo catálogo
const CLIENTE_DESCONHECIDO = '5571944440008'

// Amanhã no calendário de São Paulo, às 15h e às 17h de lá (18h e 20h UTC):
// "amanhã às 15h" em qualquer fuso em que o teste rodar.
const HOJE_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const AMANHA_SP = new Date(Date.parse(`${HOJE_SP}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)
const AMANHA_15H = `${AMANHA_SP}T18:00:00Z`
const AMANHA_17H = `${AMANHA_SP}T20:00:00Z`

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente,encomenda}', 5000, now()),
    ('org-b', 'Vizinha B', 'vizinha-b', 'BALCAO_AGENTE', 'ATIVA', '{agente,encomenda}', 5000, now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro A', false, now()),
    ('uni-a9', 'org-a', 'Depósito A', true, now()),
    ('uni-b1', 'org-b', 'Loja Sul B', false, now());

  insert into usuarios (id, org_id, nome, email, telefone, telefone_confirmado, telefone_confirmado_em, atualizado_em) values
    ('usr-ana',  'org-a', 'Ana Dona',     'ana@a.com',  '(71) 99999-0001', '7199990001', now(), now()),
    ('usr-beto', 'org-a', 'Beto Balcão',  'beto@a.com', '(71) 98888-0002', '7188880002', now(), now()),
    ('usr-gil',  'org-a', 'Gil Gerente',  'gil@a.com',  '(71) 97777-0003', '7177770003', now(), now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-ana',  'org-a', 'usr-ana',  null,     'DONO'),
    ('ac-beto', 'org-a', 'usr-beto', 'uni-a1', 'BALCAO'),
    ('ac-gil',  'org-a', 'usr-gil',  'uni-a1', 'GERENTE');

  insert into agentes (id, org_id, nome, ativo, canal, poderes, valor_max_cent, gasto_dia_cent, mensagens_dia, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, 'ZAPI',
      '{ver.estoque,estoque.entrada,encomendas.ver,encomenda.mudar}', 100000, 100000, 300, now()),
    ('ag-b', 'org-b', 'Bob', true, 'NENHUM', '{encomendas.ver}', 100000, 100000, 300, now());

  insert into produtos (id, org_id, nome, medida, preco_vista, custo, atualizado_em) values
    ('prod-pic', 'org-a', 'Picanha',            'KG', 79.90, 35.00, now()),
    ('prod-lt',  'org-a', 'Linguiça toscana',   'KG', 29.90, 15.00, now()),
    ('prod-lc',  'org-a', 'Linguiça calabresa', 'KG', 31.90, 16.00, now()),
    ('prod-b',   'org-b', 'Picanha da Vizinha', 'KG', 99.00, 50.00, now());

  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('var-pic', 'org-a', 'prod-pic', 'PIC001', true),
    ('var-lt',  'org-a', 'prod-lt',  'LIN001', true),
    ('var-lc',  'org-a', 'prod-lc',  'LIN002', true),
    ('var-b',   'org-b', 'prod-b',   'PIC001', true);

  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('est-pic', 'org-a', 'var-pic', 'uni-a1', 4, now());

  insert into encomendas (id, org_id, unidade_id, cliente_nome, telefone, descricao, valor, para, entrega, origem, acompanhamento, quem, atualizada_em) values
    ('encteste00abc123', 'org-a', 'uni-a1', 'Maria Exemplo Souza', '${CLIENTE}', 'Pedido do catálogo', 38.00, '${AMANHA_15H}', false, 'CATALOGO', 'tok-abc', 'Catálogo', now()),
    ('encteste00def456', 'org-a', 'uni-a1', 'Joana Exemplo', '${CLIENTE}', 'Pedido do catálogo', 20.00, '${AMANHA_17H}', true, 'CATALOGO', 'tok-def', 'Catálogo', now()),
    ('encteste00bal789', 'org-a', 'uni-a1', 'Cliente do Balcão', '${CLIENTE}', 'Bolo de chocolate 2 kg', 120.00, '${AMANHA_15H}', false, 'BALCAO', null, 'Ana Dona', now());

  insert into encomenda_itens (id, org_id, encomenda_id, descricao, quantidade, preco_unit, total) values
    ('ei-1', 'org-a', 'encteste00abc123', 'Picolé de morango', 2, 7.00, 14.00),
    ('ei-2', 'org-a', 'encteste00abc123', 'Pote 1L', 1, 24.00, 24.00),
    ('ei-3', 'org-a', 'encteste00def456', 'Pote 1L', 1, 20.00, 20.00);
`

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 59000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
}, 60_000)

afterAll(async () => {
  await fechar()
  const g = globalThis as { __prismaNorte?: unknown }
  delete g.__prismaNorte
  await servidor?.stop()
  await db?.close()
})

// Cada teste começa sem proposta esperando: o "sim" de um não pode achar a do outro.
beforeEach(async () => {
  await db.exec(`update propostas_agente set situacao = 'RECUSADA', respondida_em = now() where situacao = 'AGUARDANDO'`)
})

// ── a IA de mentira (o mesmo arranjo de assistente-fluxo.test.ts) ──

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
const ultimoResultado = (c: Corpo) => {
  const blocos = c.messages.at(-1)!.content as { type: string; content: string; is_error?: boolean }[]
  return blocos.find((b) => b.type === 'tool_result')!
}

let seq = 0
const msg = (telefone: string, texto: string, extra: Partial<Entrada> = {}): Entrada => ({
  orgId: 'org-a',
  telefone,
  nome: null,
  texto,
  idExterno: `L${++seq}`,
  ...extra,
})

const uma = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!
const conta = async (sql: string, p: unknown[] = []) => Number((await uma<{ n: string | number }>(sql, p)).n)
const saldoPicanha = async () => Number((await uma<{ q: string }>(`select quantidade q from estoque where id = 'est-pic'`)).q)
const ultimaProposta = () =>
  uma<{ id: string; poder: string; situacao: string; resumo: string; usuario_id: string | null; dados: Record<string, unknown> }>(
    `select id, poder, situacao, resumo, usuario_id, dados from propostas_agente where org_id = 'org-a' order by criada_em desc limit 1`,
  )

/** A dona pede a entrada pelo modelo (de mentira) e devolve o que o modelo leu da ferramenta. */
async function pedirEntrada(telefone: string, itens: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const api = apiFalsa(pede('estoque_entrada', { itens, ...extra }), diz('Confere? Responda SIM para lançar.'))
  const r = await processarMensagem(msg(telefone, 'comprei mercadoria'), { canal: new CanalFalso(), buscar: api.buscar })
  return { r, resultado: ultimoResultado(api.corpos[1]!), api }
}

// ─────────────────────────────────────────────────────────────

describe('a compra pelo WhatsApp: proposta e SIM', () => {
  it('"comprei 10 kg de picanha a 39,90": proposta com o nome do cadastro, e o estoque parado', async () => {
    const { r, resultado } = await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 10, unidade: 'kg', custoUnit: 39.9 }])
    expect(r.tipo === 'respondida' && r.propostas).toHaveLength(1)
    expect(resultado.is_error).toBeFalsy()
    const p = await ultimaProposta()
    expect(p).toMatchObject({ poder: 'estoque.entrada', situacao: 'AGUARDANDO', usuario_id: 'usr-ana' })
    expect(p.resumo).toBe('Entrada na Loja Centro A: 10 kg Picanha (R$ 39,90/kg = R$ 399,00). Fornecedor: —.')
    // O fecho é do servidor, não do modelo: o resumo da proposta e o código vão
    // no fim da mensagem, e a ferramenta diz ao modelo para não repetir.
    expect(resultado.content).toMatch(/anexados pelo sistema/)
    const c = codigoDaProposta(p.id)
    expect(r.tipo === 'respondida' && r.texto).toBe(
      `Confere? Responda SIM para lançar.

*Para confirmar:* ${p.resumo}
Responda *SIM ${c}* para confirmar ou *NÃO ${c}* para cancelar.`,
    )
    expect(await saldoPicanha()).toBe(4)
  })

  it('o SIM de quem pediu lança a entrada, sem chamar o modelo, e diz o saldo de agora', async () => {
    await pedirEntrada(ANA, [{ produto: 'PIC001', quantidade: 10, custoUnit: 39.9 }], { fornecedor: 'Frigorífico Exemplo' })
    const canal = new CanalFalso()
    const api = apiFalsa(diz('não deveria ser chamado'))
    const r = await processarMensagem(msg(ANA, 'Sim!'), { canal, buscar: api.buscar })

    expect(api.corpos).toHaveLength(0)
    expect(r).toMatchObject({ tipo: 'atalho', enviada: true })
    expect(canal.enviadas.at(-1)).toEqual({
      numero: ANA,
      texto: 'Feito: entrada de 10 kg de Picanha lançada na Loja Centro A. Saldo agora: 14 kg.',
    })
    expect(await saldoPicanha()).toBe(14)
    // O custo do produto é o MÉDIO (entrada.ts): 4 kg a R$ 35 + 10 kg a R$ 39,90.
    expect(Number((await uma<{ c: string }>(`select custo c from produtos where id = 'prod-pic'`)).c)).toBe(38.5)
    expect((await ultimaProposta()).situacao).toBe('CONFIRMADA')
    // o livro: a entrada em nome de quem confirmou, e a marca de que a ideia foi do assistente
    expect(await conta(`select count(*) n from auditoria where acao = 'estoque.entrada' and usuario_id = 'usr-ana'`)).toBe(1)
    expect(await conta(`select count(*) n from auditoria where acao = 'agente.proposta.confirmou'`)).toBeGreaterThan(0)
  })

  it('"500 g" de um produto em quilo entra como 0,5 kg — nunca 500', async () => {
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 500, unidade: 'g', custoUnit: 0.04 }])
    const p = await ultimaProposta()
    expect(p.resumo).toMatch(/^Entrada na Loja Centro A: 0,5 kg Picanha \(R\$ 40,00\/kg = R\$ 20,00\)/)
    expect(p.dados).toMatchObject({ itens: [{ variacaoId: 'var-pic', quantidade: 0.5, custoUnit: 40 }] })
  })

  it('NÃO recusa: nada entra', async () => {
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 3 }])
    const antes = await saldoPicanha()
    const canal = new CanalFalso()
    await processarMensagem(msg(ANA, 'não'), { canal, buscar: apiFalsa(diz('x')).buscar })
    expect(canal.enviadas.at(-1)!.texto).toMatch(/^Certo, cancelei\. Nada foi feito/)
    expect((await ultimaProposta()).situacao).toBe('RECUSADA')
    expect(await saldoPicanha()).toBe(antes)
  })

  it('dois produtos com o mesmo nome: volta pergunta, e nenhuma proposta nasce', async () => {
    const antes = await conta(`select count(*) n from propostas_agente`)
    const { resultado } = await pedirEntrada(ANA, [{ produto: 'linguiça', quantidade: 5, unidade: 'kg' }])
    expect(resultado.is_error).toBeFalsy()
    const j = JSON.parse(resultado.content) as { propostaCriada: boolean; escolherEntre: { opcoes: { produto: string }[] }[] }
    expect(j.propostaCriada).toBe(false)
    expect(j.escolherEntre[0]!.opcoes.map((o) => o.produto).sort()).toEqual(['Linguiça calabresa', 'Linguiça toscana'])
    expect(await conta(`select count(*) n from propostas_agente`)).toBe(antes)
  })

  it('o nome inteiro (ou o código) decide entre os parecidos', async () => {
    await pedirEntrada(ANA, [{ produto: 'linguica toscana', quantidade: 2, unidade: 'kg' }])
    expect((await ultimaProposta()).resumo).toMatch(/2 kg Linguiça toscana/)
  })

  it('a peça da outra empresa não aparece, nem procurando pelo nome dela', async () => {
    const { resultado } = await pedirEntrada(ANA, [{ produto: 'picanha da vizinha', quantidade: 1 }])
    expect(JSON.parse(resultado.content)).toMatchObject({ propostaCriada: false, naoCadastrados: ['picanha da vizinha'] })
    expect(resultado.content).not.toMatch(/var-b|99,00/)
  })

  it('produto que não existe: pede o preço de venda; com ele, nasce junto no SIM', async () => {
    const semPreco = await pedirEntrada(ANA, [{ produto: 'pão de queijo', quantidade: 30, unidade: 'un', custoUnit: 1.2 }])
    expect(JSON.parse(semPreco.resultado.content)).toMatchObject({ propostaCriada: false, naoCadastrados: ['pão de queijo'] })

    await pedirEntrada(ANA, [{ produto: 'pão de queijo', quantidade: 30, unidade: 'un', custoUnit: 1.2, precoVista: 3.5 }])
    const p = await ultimaProposta()
    expect(p.resumo).toMatch(/30 un Pão de queijo \(R\$ 1,20\/un = R\$ 36,00\) — produto novo, cadastrado com venda a R\$ 3,50\/un/)
    expect(await conta(`select count(*) n from produtos where nome = 'Pão de queijo'`)).toBe(0)

    const canal = new CanalFalso()
    await processarMensagem(msg(ANA, 'pode lançar'), { canal })
    expect(canal.enviadas.at(-1)!.texto).toMatch(/^Feito: entrada de 30 un de Pão de queijo lançada.*Saldo agora: 30 un\. Cadastrei o produto novo: Pão de queijo\./)
    const novo = await uma<{ medida: string; preco_vista: string; custo: string }>(`select medida, preco_vista, custo from produtos where nome = 'Pão de queijo'`)
    expect(novo).toMatchObject({ medida: 'UN' })
    expect(Number(novo.preco_vista)).toBe(3.5)
    expect(Number(novo.custo)).toBe(1.2)
  })

  it('o balcão não dá entrada: a ferramenta nem vai para a mesa dele', async () => {
    const api = apiFalsa(diz('Isso eu não consigo por aqui.'))
    await processarMensagem(msg(BETO, 'comprei 10 kg de picanha'), { canal: new CanalFalso(), buscar: api.buscar })
    expect(api.nomes(0)).not.toContain('estoque_entrada')
    expect(api.nomes(0)).toContain('encomendas_ver')
  })
})

describe('o SIM: quem, qual e com que permissão', () => {
  it('o SIM de outra pessoa da equipe não alcança a proposta: vai para o modelo', async () => {
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 1 }])
    const api = apiFalsa(diz('Sim o quê?'))
    const r = await processarMensagem(msg(GIL, 'sim'), { canal: new CanalFalso(), buscar: api.buscar })
    expect(r.tipo).toBe('respondida')
    expect(api.corpos).toHaveLength(1)
    expect((await ultimaProposta()).situacao).toBe('AGUARDANDO')
  })

  it('a permissão é a de AGORA: perdeu o acesso entre o pedido e o sim, não lança', async () => {
    await pedirEntrada(GIL, [{ produto: 'picanha', quantidade: 2 }])
    const antes = await saldoPicanha()
    await db.exec(`update acessos set papel = 'BALCAO' where id = 'ac-gil'`)
    try {
      const canal = new CanalFalso()
      const r = await processarMensagem(msg(GIL, 'confirmo'), { canal, buscar: apiFalsa(diz('x')).buscar })
      expect(r.tipo).toBe('atalho')
      expect(canal.enviadas.at(-1)!.texto).toMatch(/não é do seu acesso/)
      expect((await ultimaProposta()).situacao).toBe('AGUARDANDO')
      expect(await saldoPicanha()).toBe(antes)
    } finally {
      await db.exec(`update acessos set papel = 'GERENTE' where id = 'ac-gil'`)
    }
  })

  it('o gerente com acesso confirma a dele', async () => {
    await pedirEntrada(GIL, [{ produto: 'picanha', quantidade: 2 }])
    const antes = await saldoPicanha()
    await processarMensagem(msg(GIL, 'ok'), { canal: new CanalFalso() })
    expect(await saldoPicanha()).toBe(antes + 2)
  })

  it('proposta vencida não executa, e diz por quê', async () => {
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 1 }])
    await db.exec(`update propostas_agente set expira_em = now() - interval '1 minute' where situacao = 'AGUARDANDO'`)
    const antes = await saldoPicanha()
    const canal = new CanalFalso()
    await processarMensagem(msg(ANA, 'sim'), { canal })
    expect(canal.enviadas.at(-1)!.texto).toMatch(/venceu/)
    expect((await ultimaProposta()).situacao).toBe('EXPIRADA')
    expect(await saldoPicanha()).toBe(antes)
  })

  it('várias esperando: a lista mostra o CÓDIGO de cada uma, e "sim <código>" escolhe — o número de lista, não', async () => {
    await pedirEntrada(ANA, [{ produto: 'linguiça toscana', quantidade: 1 }])
    const a = await ultimaProposta()
    // Uma segunda entrada esperando, de outro pedido (a ferramenta aposentaria a
    // primeira; aqui as duas valem, como quando são de tipos diferentes).
    await db.query(
      `insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, situacao, expira_em, usuario_id, criada_em)
       values ('prop-b', 'org-a', 'ag-a', 'estoque.entrada', 'Entrada na Loja Centro A: 1 kg Picanha. Fornecedor: —.', $1,
               'AGUARDANDO', $2, 'usr-ana', $3)`,
      [
        JSON.stringify({ ...a.dados, itens: [{ variacaoId: 'var-pic', nome: 'Picanha', medida: 'KG', quantidade: 1, custoUnit: null }] }),
        // Datas do lado do JS: a coluna é sem fuso, e o now() do banco de teste sai no fuso local.
        new Date(Date.now() + 864e5),
        new Date(),
      ],
    )
    const [ca, cb] = [codigoDaProposta(a.id), codigoDaProposta('prop-b')]
    const antes = await saldoPicanha()
    const canal = new CanalFalso()
    const api = apiFalsa(diz('não deveria ser chamado'))

    await processarMensagem(msg(ANA, 'sim'), { canal, buscar: api.buscar })
    const lista = canal.enviadas.at(-1)!.texto
    expect(lista.startsWith(`Tem 2 propostas suas esperando:\n• *${ca}* — Entrada na Loja Centro A: 1 kg Linguiça toscana`)).toBe(true)
    expect(lista).toContain(`• *${cb}* — Entrada na Loja Centro A: 1 kg Picanha`)

    // "sim 2" (o número da lista) não escolhe: volta a lista com os códigos.
    await processarMensagem(msg(ANA, 'sim 2'), { canal, buscar: api.buscar })
    expect(canal.enviadas.at(-1)!.texto).toMatch(/^Tem 2 propostas/)
    expect(await saldoPicanha()).toBe(antes)

    await processarMensagem(msg(ANA, `sim ${cb}`), { canal, buscar: api.buscar })
    expect(await saldoPicanha()).toBe(antes + 1)
    // O código da outra continua o mesmo depois do primeiro sim.
    await processarMensagem(msg(ANA, `não ${ca.toLowerCase()}`), { canal, buscar: api.buscar })
    expect(await conta(`select count(*) n from propostas_agente where situacao = 'AGUARDANDO'`)).toBe(0)
    expect((await uma<{ s: string }>(`select situacao s from propostas_agente where id = $1`, [a.id])).s).toBe('RECUSADA')
    expect(api.corpos).toHaveLength(0)
  })

  it('a entrada corrigida ("não, são 12") aposenta a que estava esperando: só a nova vale', async () => {
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 10, unidade: 'kg' }])
    const velha = await ultimaProposta()
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 12, unidade: 'kg' }])
    const nova = await ultimaProposta()
    expect(nova.resumo).toMatch(/12 kg Picanha/)
    expect((await uma<{ s: string; e: string }>(`select situacao s, erro e from propostas_agente where id = $1`, [velha.id]))).toEqual({
      s: 'EXPIRADA',
      e: `Substituída pela proposta ${codigoDaProposta(nova.id)}.`,
    })
    expect(await conta(`select count(*) n from propostas_agente where situacao = 'AGUARDANDO'`)).toBe(1)
  })

  it('proposta sem quem pediu (a da rotina) é só da tela; e a de mais de uma hora também', async () => {
    await db.exec(`
      insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, situacao, expira_em) values
        ('prop-rotina', 'org-a', 'ag-a', 'estoque.entrada', 'Da rotina', '{}', 'AGUARDANDO', now() + interval '1 day')`)
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 1 }])
    await db.exec(`update propostas_agente set criada_em = now() - interval '61 minutes' where usuario_id = 'usr-ana' and situacao = 'AGUARDANDO'`)
    const api = apiFalsa(diz('Sim pra quê?'))
    const r = await processarMensagem(msg(ANA, 'sim'), { canal: new CanalFalso(), buscar: api.buscar })
    expect(r.tipo).toBe('respondida')
    expect(await conta(`select count(*) n from propostas_agente where situacao = 'AGUARDANDO'`)).toBe(2)
  })

  it('"sim, mas muda a quantidade" não é um sim: vai para o modelo', async () => {
    await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 1 }])
    const api = apiFalsa(diz('Quanto?'))
    const r = await processarMensagem(msg(ANA, 'sim, mas muda a quantidade para 3'), { canal: new CanalFalso(), buscar: api.buscar })
    expect(r.tipo).toBe('respondida')
    expect((await ultimaProposta()).situacao).toBe('AGUARDANDO')
  })
})

describe('o áudio', () => {
  const AVISO = '(a pessoa mandou um áudio, que o assistente ainda não consegue abrir — peça para escrever)'
  const audio = { base64: Buffer.from('OggS-de-mentira').toString('base64'), mime: 'audio/ogg; codecs=opus' }
  const transcricaoFalsa = (texto: string) => {
    const chamadas: string[] = []
    const buscar = (async (url: string) => {
      chamadas.push(String(url))
      return new Response(JSON.stringify({ text: texto }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    return { buscar, chamadas }
  }

  it('da equipe: vira o texto, segue como digitado, e a resposta começa com o que ouviu', async () => {
    process.env.TRANSCRICAO_CHAVE = 'chave-de-teste'
    try {
      const t = transcricaoFalsa('comprei agora 10 kg de picanha a 39,90 o quilo')
      const api = apiFalsa(diz('Vou montar a entrada.'))
      const canal = new CanalFalso()
      const e = msg(ANA, AVISO, { audio })
      await processarMensagem(e, { canal, buscar: api.buscar, buscarTranscricao: t.buscar })

      expect(t.chamadas).toEqual(['https://api.groq.com/openai/v1/audio/transcriptions'])
      expect(JSON.stringify(api.corpos[0]!.messages.at(-1))).toMatch(/comprei agora 10 kg de picanha/)
      expect(canal.enviadas.at(-1)!.texto).toBe('Ouvi: “comprei agora 10 kg de picanha a 39,90 o quilo”\n\nVou montar a entrada.')
      const gravada = await uma<{ texto: string; midia: string | null }>(
        `select texto, midia from mensagens_agente where de = 'PESSOA' order by criada_em desc limit 1`,
      )
      expect(gravada.texto).toBe('comprei agora 10 kg de picanha a 39,90 o quilo')
      expect(gravada.midia).toMatch(/^Áudio transcrito: comprei agora/)
    } finally {
      delete process.env.TRANSCRICAO_CHAVE
    }
  })

  it('"sim" falado confirma como o digitado', async () => {
    process.env.TRANSCRICAO_CHAVE = 'chave-de-teste'
    try {
      await pedirEntrada(ANA, [{ produto: 'picanha', quantidade: 1 }])
      const antes = await saldoPicanha()
      const canal = new CanalFalso()
      await processarMensagem(msg(ANA, AVISO, { audio }), { canal, buscarTranscricao: transcricaoFalsa('Sim.').buscar })
      expect(await saldoPicanha()).toBe(antes + 1)
      expect(canal.enviadas.at(-1)!.texto).toMatch(/^Ouvi: “Sim\.”\n\nFeito: entrada de 1 kg de Picanha/)
    } finally {
      delete process.env.TRANSCRICAO_CHAVE
    }
  })

  it('de cliente: nunca vai para a transcrição', async () => {
    process.env.TRANSCRICAO_CHAVE = 'chave-de-teste'
    try {
      const t = transcricaoFalsa('não deveria ser ouvido')
      const api = apiFalsa(diz('não deveria ser chamado'))
      await processarMensagem(msg(CLIENTE_DESCONHECIDO, AVISO, { audio }), { canal: new CanalFalso(), buscar: api.buscar, buscarTranscricao: t.buscar })
      expect(t.chamadas).toHaveLength(0)
      expect(api.corpos).toHaveLength(0)
    } finally {
      delete process.env.TRANSCRICAO_CHAVE
    }
  })

  it('sem a chave no servidor: o aviso de sempre vai para o modelo, e nada é chamado', async () => {
    const t = transcricaoFalsa('x')
    const api = apiFalsa(diz('Pode escrever?'))
    const canal = new CanalFalso()
    await processarMensagem(msg(ANA, AVISO, { audio }), { canal, buscar: api.buscar, buscarTranscricao: t.buscar })
    expect(t.chamadas).toHaveLength(0)
    expect(JSON.stringify(api.corpos[0]!.messages.at(-1))).toMatch(/mandou um áudio/)
    expect(canal.enviadas.at(-1)!.texto).toBe('Pode escrever?')
  })
})

describe('as encomendas pelo WhatsApp', () => {
  it('a consulta traz o pedido novo do catálogo primeiro, com o primeiro nome só', async () => {
    const api = apiFalsa(pede('encomendas_ver', {}), diz('Tem pedido novo.'))
    await processarMensagem(msg(ANA, 'chegou pedido?'), { canal: new CanalFalso(), buscar: api.buscar })
    const res = ultimoResultado(api.corpos[1]!)
    const j = JSON.parse(res.content) as { novosDoCatalogo: number; encomendas: Record<string, unknown>[] }
    expect(j.novosDoCatalogo).toBe(2)
    expect(j.encomendas[0]).toMatchObject({
      codigo: 'ENC-ABC123',
      novo: true,
      cliente: 'Maria',
      itens: '2x Picolé de morango, 1x Pote 1L',
      total: 'R$ 38,00',
    })
    expect(j.encomendas[0]!.quando).toBe('retirada amanhã às 15h')
    expect(res.content).not.toMatch(/Souza|55550009/)
    expect(j.encomendas.find((e) => e.codigo === 'ENC-BAL789')).toMatchObject({ itens: 'Bolo de chocolate 2 kg' })
  })

  it('o balcão não cancela pelo WhatsApp: a ferramenta recusa antes de propor', async () => {
    const antes = await conta(`select count(*) n from propostas_agente`)
    const api = apiFalsa(pede('encomenda_mudar', { codigo: 'ENC-BAL789', acao: 'cancelar', motivo: 'cliente desistiu' }), diz('Não posso.'))
    await processarMensagem(msg(BETO, 'cancela o bolo'), { canal: new CanalFalso(), buscar: api.buscar })
    expect(ultimoResultado(api.corpos[1]!)).toMatchObject({ is_error: true })
    expect(await conta(`select count(*) n from propostas_agente`)).toBe(antes)
  })

  it('aceitar pelo assistente: proposta, SIM, e a cliente avisada com o link', async () => {
    const api = apiFalsa(pede('encomenda_mudar', { codigo: 'ENC-DEF456', acao: 'aceitar' }), diz('Responda SIM para confirmar.'))
    await processarMensagem(msg(ANA, 'aceita o pedido da Joana'), { canal: new CanalFalso(), buscar: api.buscar })
    const p = await ultimaProposta()
    expect(p).toMatchObject({ poder: 'encomenda.mudar', usuario_id: 'usr-ana' })
    expect(p.resumo).toBe('Aceitar o pedido ENC-DEF456 de Joana (1x Pote 1L, R$ 20,00, entrega amanhã às 17h). A cliente recebe o aviso pelo WhatsApp.')

    const canal = new CanalFalso()
    // o aviso à cliente sai pelo canal da empresa (aqui, o falso global): a
    // resposta à dona sai pelo do teste.
    await processarMensagem(msg(ANA, 'sim'), { canal })
    expect(canal.enviadas.at(-1)!.texto).toBe('Feito: pedido ENC-DEF456 aceito.')
    expect((await uma<{ v: Date | null }>(`select vista_em v from encomendas where id = 'encteste00def456'`)).v).not.toBeNull()
    const paraCliente = await uma<{ texto: string }>(
      `select m.texto from mensagens_agente m join conversas_agente c on c.id = m.conversa_id
        where c.telefone = '${CLIENTE}' and m.de = 'AGENTE' order by m.criada_em desc limit 1`,
    )
    expect(paraCliente.texto).toMatch(/^Oi, Joana! A Loja A recebeu seu pedido ENC-DEF456 — entrega amanhã às 17h\./)
    expect(paraCliente.texto).toMatch(/https:\/\/norte\.exemplo\/loja-a\/pedido\/tok-def$/)
  })

  it('o aviso do pedido novo vai para a dona e o gerente da loja — não para o balcão — e uma vez só', async () => {
    const canal = new CanalFalso()
    await avisarEquipeDoPedido('org-a', 'encteste00abc123', { canal })
    await avisarEquipeDoPedido('org-a', 'encteste00abc123', { canal })
    expect(canal.enviadas.map((e) => e.numero).sort()).toEqual([GIL, ANA].sort())
    expect(canal.enviadas[0]!.texto).toMatch(
      /^Pedido novo pelo catálogo \(ENC-ABC123\): 2x Picolé de morango, 1x Pote 1L\. Total R\$ 38,00 — retirada amanhã às 15h\. Responda ACEITAR, PRONTO ou abra Encomendas\.$/,
    )
  })

  it('ACEITAR na conversa aceita o pedido avisado e avisa a cliente; PRONTO apronta', async () => {
    const canal = new CanalFalso()
    const api = apiFalsa(diz('não deveria ser chamado'))
    // O aviso à cliente usa o canal da empresa: aqui ela não tem um de
    // verdade (o falso global), então conferimos pelo histórico gravado.
    const r = await processarMensagem(msg(ANA, 'ACEITAR'), { canal, buscar: api.buscar })
    expect(r).toMatchObject({ tipo: 'atalho' })
    expect(api.corpos).toHaveLength(0)
    expect(canal.enviadas.at(-1)!.texto).toBe('Feito: pedido ENC-ABC123 aceito. A cliente recebe o aviso pelo WhatsApp.')
    expect(await conta(`select count(*) n from auditoria where acao = 'encomenda.aceitou' and alvo_id = 'encteste00abc123'`)).toBe(1)

    await processarMensagem(msg(ANA, 'pronto'), { canal, buscar: api.buscar })
    expect(canal.enviadas.at(-1)!.texto).toBe('Feito: encomenda ENC-ABC123 marcada como pronta. A cliente recebe o aviso pelo WhatsApp.')
    expect((await uma<{ s: string }>(`select situacao s from encomendas where id = 'encteste00abc123'`)).s).toBe('PRONTA')

    const avisos = (
      await db.query<{ texto: string }>(
        `select m.texto from mensagens_agente m join conversas_agente c on c.id = m.conversa_id
          where c.telefone = '${CLIENTE}' and m.de = 'AGENTE' and m.texto like '%ENC-ABC123%' order by m.criada_em`,
      )
    ).rows.map((x) => x.texto)
    expect(avisos).toHaveLength(2)
    expect(avisos[0]).toMatch(/recebeu seu pedido ENC-ABC123/)
    expect(avisos[1]).toMatch(/^Oi, Maria! Seu pedido ENC-ABC123 está pronto para retirar na loja\. Acompanhe por aqui: https:\/\/norte\.exemplo\/loja-a\/pedido\/tok-abc$/)

    // O mesmo aviso de novo não sai.
    const outra = new CanalFalso()
    await avisarClienteDaEncomenda('org-a', 'encteste00abc123', 'PRONTA', { canal: outra })
    expect(outra.enviadas).toHaveLength(0)
  })

  it('"pronto" sem pedido avisado na conversa é só uma palavra: vai para o modelo', async () => {
    const api = apiFalsa(diz('Pronto o quê?'))
    const r = await processarMensagem(msg(BETO, 'pronto'), { canal: new CanalFalso(), buscar: api.buscar })
    expect(r.tipo).toBe('respondida')
    // O Gil recebeu o aviso do ENC-ABC123, que já está pronto: ele ouve isso.
    const canal = new CanalFalso()
    const r2 = await processarMensagem(msg(GIL, 'pronto'), { canal, buscar: api.buscar })
    expect(r2.tipo).toBe('atalho')
    expect(canal.enviadas.at(-1)!.texto).toBe('Os pedidos que avisei já não estão a fazer.')
  })

  it('aviso à cliente: encomenda de balcão não, quem pediu para sair não, empresa sem WhatsApp não — e nunca lança', async () => {
    const canal = new CanalFalso()
    await avisarClienteDaEncomenda('org-a', 'encteste00bal789', 'PRONTA', { canal })
    expect(canal.enviadas).toHaveLength(0)

    await db.exec(`insert into optout_whatsapp (id, org_id, telefone, origem) values ('opt-1', 'org-a', '${chaveTelefone(CLIENTE)}', 'parar')`)
    try {
      await avisarClienteDaEncomenda('org-a', 'encteste00def456', 'CANCELADA', { canal })
      expect(canal.enviadas).toHaveLength(0)
    } finally {
      await db.exec(`delete from optout_whatsapp where id = 'opt-1'`)
    }

    await avisarEquipeDoPedido('org-b', 'qualquer', { canal })
    await expect(avisarClienteDaEncomenda('nao-existe', 'nada', 'ACEITA')).resolves.toBeUndefined()
    await expect(avisarEquipeDoPedido('nao-existe', 'nada')).resolves.toBeUndefined()
    expect(canal.enviadas).toHaveLength(0)
  })
})
