// AUDITORIA (estoque pelo WhatsApp) — prova de defeitos encontrados na
// entrada de mercadoria pelo assistente e no SIM/NÃO da conversa.
//
// Mesmo arranjo de assistente-loja-whatsapp.test.ts: PGlite com RLS, IA de
// mentira, canal de mentira. Os casos "CORRIGIDO" foram invertidos depois da
// correção e guardam o comportamento certo; os "BUG" que sobraram ainda
// descrevem o defeito (o teste quebra de propósito quando for corrigido).

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
import { responderProposta } from '../src/servidor/agente'
import { fechar } from '../src/servidor/banco'
import { codigoDaProposta } from '../src/servidor/assistente/propostas'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

const ANA = '5571999990001' // dona, todas as lojas
const SESSAO_ANA: Sessao = { orgId: 'org-a', usuarioId: 'usr-ana', nome: 'Ana Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const EMPRESA = { modulos: ['agente', 'multiUnidade'] }

// "Shopping Norte" nasce ANTES de "Shopping" (ordem física das linhas).
const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
    ('org-a', 'Açougue A', 'acougue-a', 'BALCAO_AGENTE', 'ATIVA', '{agente,multiUnidade}', 50000, now());

  insert into unidades (id, org_id, nome, eh_deposito, criada_em, atualizada_em) values
    ('uni-norte', 'org-a', 'Shopping Norte', false, now() - interval '1 day', now());
  insert into unidades (id, org_id, nome, eh_deposito, criada_em, atualizada_em) values
    ('uni-shop', 'org-a', 'Shopping', false, now(), now());

  insert into usuarios (id, org_id, nome, email, telefone, telefone_confirmado, telefone_confirmado_em, atualizado_em) values
    ('usr-ana', 'org-a', 'Ana Dona', 'ana@a.com', '(71) 99999-0001', '7199990001', now(), now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-ana', 'org-a', 'usr-ana', null, 'DONO');

  insert into agentes (id, org_id, nome, ativo, canal, poderes, valor_max_cent, gasto_dia_cent, mensagens_dia, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, 'ZAPI', '{ver.estoque,estoque.entrada,ajustar.estoque}', 100000, 100000, 300, now());

  insert into produtos (id, org_id, nome, medida, preco_vista, custo, atualizado_em) values
    ('prod-pic', 'org-a', 'Picanha', 'KG', 79.90, 35.00, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('var-pic', 'org-a', 'prod-pic', 'PIC001', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('est-pic-shop', 'org-a', 'var-pic', 'uni-shop', 4, now()),
    ('est-pic-norte', 'org-a', 'var-pic', 'uni-norte', 0, now());
`

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 52000 + Math.floor(Math.random() * 3000)
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
  await db.exec(`update estoque set quantidade = 4 where id = 'est-pic-shop'; update estoque set quantidade = 0 where id = 'est-pic-norte';`)
  await db.exec(`update produtos set custo = 35 where id = 'prod-pic'`)
})

type Corpo = { tools?: { name: string }[]; messages: { role: string; content: unknown }[] }
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
const ultimoResultado = (c: Corpo) => {
  const blocos = c.messages.at(-1)!.content as { type: string; content: string; is_error?: boolean }[]
  return blocos.find((b) => b.type === 'tool_result')!
}

let seq = 0
const msg = (texto: string): Entrada => ({ orgId: 'org-a', telefone: ANA, nome: null, texto, idExterno: `AUD${++seq}` })
const uma = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!
const saldo = async (id = 'est-pic-shop') => Number((await uma<{ q: string }>(`select quantidade q from estoque where id = $1`, [id])).q)
const aguardando = async () =>
  (await db.query<{ id: string; resumo: string }>(`select id, resumo from propostas_agente where situacao = 'AGUARDANDO' order by criada_em`)).rows

async function pedirEntrada(itens: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const api = apiFalsa(pede('estoque_entrada', { itens, ...extra }), diz('Confere? Responda SIM para lançar.'))
  await processarMensagem(msg('comprei mercadoria'), { canal: new CanalFalso(), buscar: api.buscar })
  return ultimoResultado(api.corpos[1]!)
}

describe('AUDITORIA — SIM/NÃO da entrada pelo WhatsApp', () => {
  it('CORRIGIDO: a proposta corrigida ("não, são 12 kg") aposenta a antiga — só a nova é confirmável', async () => {
    await pedirEntrada([{ produto: 'picanha', quantidade: 10, unidade: 'kg', custoUnit: 39.9 }], { loja: 'Shopping Norte' })
    const [velha] = await aguardando()
    // a pessoa corrige; o modelo monta outra proposta
    await pedirEntrada([{ produto: 'picanha', quantidade: 12, unidade: 'kg', custoUnit: 39.9 }], { loja: 'Shopping Norte' })
    const vivas = await aguardando()
    expect(vivas).toHaveLength(1)
    expect(vivas[0]!.resumo).toMatch(/12 kg Picanha/)

    // um "sim" só, e é a de 12
    await processarMensagem(msg('sim'), { canal: new CanalFalso(), buscar: apiFalsa(diz('x')).buscar })
    expect(await saldo('est-pic-norte')).toBe(12)

    // a de 10 kg não se confirma mais, nem pela tela
    const r = await responderProposta(SESSAO_ANA, EMPRESA, velha!.id, true)
    expect(r).toMatchObject({ ok: false, motivo: 'ja_respondida' })
    expect(await saldo('est-pic-norte')).toBe(12)
  })

  it('CORRIGIDO: cada proposta tem um código fixo — "sim <código A>" e depois "sim <código B>" executa A e B, e o número de lista não escolhe', async () => {
    await pedirEntrada([{ produto: 'picanha', quantidade: 1, unidade: 'kg' }], { loja: 'Shopping Norte' }) // A (entrada)
    const [a] = await aguardando()
    // B, de outro tipo (ajuste), não aposenta A
    await processarMensagem(msg('soma 2 kg de picanha no Norte'), {
      canal: new CanalFalso(),
      buscar: apiFalsa(pede('ajustar_estoque', { codigo: 'PIC001', quantidade: 2, loja: 'Shopping Norte', motivo: 'achei na câmara fria' }), diz('ok')).buscar,
    })
    // C, outra entrada esperando (gravada direto: pela ferramenta, aposentaria A).
    // Datas do lado do JS: a coluna é sem fuso, e o now() do banco de teste sai no fuso local.
    await db.query(
      `insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, situacao, expira_em, usuario_id, criada_em)
       values ('prop-c', 'org-a', 'ag-a', 'estoque.entrada', 'Entrada na Shopping Norte: 5 kg Picanha. Fornecedor: —.', $1, 'AGUARDANDO', $2, 'usr-ana', $3)`,
      [
        JSON.stringify({ unidadeId: 'uni-norte', fornecedor: '', documento: '', itens: [{ variacaoId: 'var-pic', nome: 'Picanha', medida: 'KG', quantidade: 5, custoUnit: null }] }),
        new Date(Date.now() + 864e5),
        new Date(),
      ],
    )
    const vivas = await aguardando()
    expect(vivas).toHaveLength(3)
    const b = vivas.find((p) => /^Somar/.test(p.resumo))!

    const canal = new CanalFalso()
    const api = apiFalsa(diz('não deveria ser chamado'))
    await processarMensagem(msg('sim'), { canal, buscar: api.buscar })
    for (const p of vivas) expect(canal.enviadas.at(-1)!.texto).toContain(`*${codigoDaProposta(p.id)}*`)

    await processarMensagem(msg('sim 2'), { canal, buscar: api.buscar }) // número de lista: só mostra os códigos
    expect(await saldo('est-pic-norte')).toBe(0)

    await processarMensagem(msg(`sim ${codigoDaProposta(a!.id)}`), { canal, buscar: api.buscar }) // A: +1
    await processarMensagem(msg(`sim ${codigoDaProposta(b.id)}`), { canal, buscar: api.buscar }) // B: +2 — o código não mudou
    expect(await saldo('est-pic-norte')).toBe(3)
    const resto = await aguardando()
    expect(resto).toHaveLength(1)
    expect(resto[0]!.id).toBe('prop-c')
    expect(api.corpos).toHaveLength(0)
  })

  it('CORRIGIDO: um "ok" para outra pergunta não confirma a entrada que ficou esperando — vai para o modelo', async () => {
    await pedirEntrada([{ produto: 'picanha', quantidade: 10, unidade: 'kg' }], { loja: 'Shopping Norte' })
    // conversa segue sobre outra coisa
    await processarMensagem(msg('quanto tem de picanha?'), { canal: new CanalFalso(), buscar: apiFalsa(diz('4 kg no Shopping. Quer que eu veja o Norte também?')).buscar })
    // "ok" era para a pergunta do modelo
    const r = await processarMensagem(msg('ok'), { canal: new CanalFalso(), buscar: apiFalsa(diz('O Norte está zerado.')).buscar })
    expect(r.tipo).toBe('respondida')
    expect(await saldo('est-pic-norte')).toBe(0)
    expect(await aguardando()).toHaveLength(1)
  })

  it('correto: o "ok" logo depois da proposta (a última mensagem dela, com o código) confirma', async () => {
    await pedirEntrada([{ produto: 'picanha', quantidade: 2, unidade: 'kg' }], { loja: 'Shopping Norte' })
    const r = await processarMensagem(msg('ok'), { canal: new CanalFalso(), buscar: apiFalsa(diz('x')).buscar })
    expect(r.tipo).toBe('atalho')
    expect(await saldo('est-pic-norte')).toBe(2)
  })

  it('correto: a mensagem leva o resumo DO SERVIDOR e o código, mesmo que o modelo descreva outra coisa', async () => {
    const api = apiFalsa(pede('estoque_entrada', { itens: [{ produto: 'picanha', quantidade: 12, unidade: 'kg' }], loja: 'Shopping Norte' }), diz('Lancei 10 kg, ok?'))
    const r = await processarMensagem(msg('chegaram 12 kg'), { canal: new CanalFalso(), buscar: api.buscar })
    const [p] = await aguardando()
    expect(r.tipo === 'respondida' && r.texto).toContain(`*Para confirmar:* ${p!.resumo}`)
    expect(r.tipo === 'respondida' && r.texto).toContain(`*SIM ${codigoDaProposta(p!.id)}*`)
  })

  it('correto: o segundo "sim" seguido não executa de novo', async () => {
    await pedirEntrada([{ produto: 'picanha', quantidade: 3, unidade: 'kg' }], { loja: 'Shopping Norte' })
    await processarMensagem(msg('sim'), { canal: new CanalFalso(), buscar: apiFalsa(diz('x')).buscar })
    const r2 = await processarMensagem(msg('sim'), { canal: new CanalFalso(), buscar: apiFalsa(diz('Já lancei.')).buscar })
    expect(r2.tipo).toBe('respondida') // vai ao modelo, sem proposta
    expect(await saldo('est-pic-norte')).toBe(3)
  })
})

describe('AUDITORIA — qual loja recebe', () => {
  it('CORRIGIDO: loja cujo nome está contido no de outra ("Shopping" x "Shopping Norte") é escolhida pelo nome exato', async () => {
    const r = await pedirEntrada([{ produto: 'picanha', quantidade: 1, unidade: 'kg' }], { loja: 'Shopping' })
    expect(r.is_error).toBeFalsy()
    const [p] = await aguardando()
    expect(p!.resumo).toMatch(/^Entrada na Shopping: 1 kg Picanha/)
  })

  it('CORRIGIDO: o ajuste pelo assistente usa a mesma régua — "Shopping" é a Shopping, não a Shopping Norte', async () => {
    const api = apiFalsa(pede('ajustar_estoque', { codigo: 'PIC001', quantidade: 2, loja: 'Shopping', motivo: 'achei na câmara fria' }), diz('ok'))
    await processarMensagem(msg('soma 2 kg de picanha no Shopping'), { canal: new CanalFalso(), buscar: api.buscar })
    const [p] = await aguardando()
    expect(p!.resumo).toMatch(/na Shopping\. Motivo/)
  })

  it('correto: pedaço de nome que serve a duas lojas vira pergunta', async () => {
    const r = await pedirEntrada([{ produto: 'picanha', quantidade: 1, unidade: 'kg' }], { loja: 'shop' })
    expect(r.is_error).toBe(true)
    expect(r.content).toMatch(/^Em qual loja\?/)
  })
})

describe('AUDITORIA — achar o produto', () => {
  it('CORRIGIDO: com mais de 120 variações parecidas, o produto que existe é achado — e não nasce em duplicata', async () => {
    // loja de roupa: "Camiseta Básica" com grade grande, e a "Camiseta Polo" que de fato chegou
    await db.exec(`
      insert into produtos (id, org_id, nome, medida, preco_vista, atualizado_em) values
        ('prod-bas', 'org-a', 'Camiseta Básica', 'UN', 39.90, now()),
        ('prod-polo', 'org-a', 'Camiseta Polo', 'UN', 89.90, now());
      insert into variacoes (id, org_id, produto_id, codigo)
        select 'var-bas-' || g, 'org-a', 'prod-bas', 'BAS' || g from generate_series(1, 130) g;
      insert into variacoes (id, org_id, produto_id, codigo, padrao) values ('var-polo', 'org-a', 'prod-polo', 'POLO1', true);
    `)
    const r = await pedirEntrada([{ produto: 'camiseta polo', quantidade: 10, unidade: 'un' }], { loja: 'Shopping Norte' })
    expect(r.is_error).toBeFalsy()
    expect(r.content).toMatch(/^Proposta c/)
    const [p] = await aguardando()
    expect(p!.resumo).toMatch(/Camiseta Polo/)
    // e pelo código exato também acha, mesmo atrás das 130 da Básica
    const porCodigo = await pedirEntrada([{ produto: 'POLO1', quantidade: 1, unidade: 'un' }], { loja: 'Shopping Norte' })
    expect(porCodigo.content).not.toMatch(/naoCadastrados/)
    expect(porCodigo.content).toMatch(/^Proposta c/)
    expect(Number((await uma<{ n: string }>(`select count(*) n from produtos where lower(nome) = 'camiseta polo'`)).n)).toBe(1)
  })
})

describe('AUDITORIA — custo dito numa unidade, quantidade em outra', () => {
  it('CORRIGIDO: "500 g de picanha a 39,90 o quilo" com a unidade do preço separada vira R$ 39,90/kg', async () => {
    await pedirEntrada([{ produto: 'picanha', quantidade: 500, unidade: 'g', custoUnit: 39.9, unidadeCusto: 'kg' }], { loja: 'Shopping Norte' })
    const [p] = await aguardando()
    expect(p!.resumo).toMatch(/0,5 kg Picanha \(R\$ 39,90\/kg = R\$ 19,95\)/)
    expect(p!.resumo).not.toMatch(/ATENÇÃO/)
  })

  it('CORRIGIDO: sem a unidade do preço, o custo 1.140 vezes o de hoje vai com ATENÇÃO no resumo que a pessoa confirma', async () => {
    const r = await pedirEntrada([{ produto: 'picanha', quantidade: 500, unidade: 'g', custoUnit: 39.9 }], { loja: 'Shopping Norte' })
    const [p] = await aguardando()
    expect(p!.resumo).toMatch(/0,5 kg Picanha \(R\$ 39\.?900,00\/kg/)
    expect(p!.resumo).toMatch(/ATENÇÃO, confira antes do SIM: Picanha sai a R\$ 39\.?900,00\/kg, 1140 vezes o custo de hoje \(R\$ 35,00\/kg\)/)
    expect(r.content).toMatch(/pergunte se a unidade do preço está certa/)
  })

  it('correto: "2 cx de 12 picolés" em produto por unidade não soma 2 — pergunta', async () => {
    const r = await pedirEntrada([{ produto: 'picanha', quantidade: 2, unidade: 'cx' }], { loja: 'Shopping Norte' })
    expect(r.is_error).toBe(true)
    expect(r.content).toMatch(/contado em kg/)
  })
})
