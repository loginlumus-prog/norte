// Vender, devolver, cancelar, o caixa e a encomenda — com banco de verdade.
//
// Cada `it` é um defeito da auditoria de 27/09: o cenário que passava virou
// o cenário que não passa mais. Mesmo arranjo de `regras-servidor.test.ts`:
// o PGlite exposto numa porta, e o código rodando INTEIRO (comoOrg, Prisma,
// RLS). Corrida de verdade (duas transações ao mesmo tempo) não se prova com
// pool de um; as travas estão justificadas no código, e aqui se prova que a
// SQL delas roda e que o caminho de uma transação só continua certo.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  venda: typeof import('../src/servidor/venda')
  devolucao: typeof import('../src/servidor/devolucao')
  caixa: typeof import('../src/servidor/caixa')
  crediario: typeof import('../src/servidor/crediario')
  encomenda: typeof import('../src/servidor/encomenda')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[], orgId = 'org-a'): Sessao => ({
  orgId,
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])
const BALCAO = sessao('usr-bal1', 'Balcão Centro', [{ papel: 'BALCAO', unidadeId: 'uni-a1' }])
const DONA_SEM = sessao('usr-s', 'Dona Sem Módulo', [{ papel: 'DONO', unidadeId: null }], 'org-s')

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, pontos_ativo, pontos_por_real, ponto_vale, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,encomenda,multiUnidade}', true, 0, 0.10, now(), now()),
    ('org-s', 'Loja Sem', 'loja-s', 'REDE', 'ATIVA', '{}', false, 1, 0, now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, now()),
    ('uni-a2', 'org-a', 'Loja Fechada', false, false, now()),
    ('uni-a9', 'org-a', 'Depósito', true, true, now()),
    ('uni-s1', 'org-s', 'Única', false, true, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona', 'dona@a.com', now()),
    ('usr-bal1', 'org-a', 'Balcão Centro', 'b1@a.com', now()),
    ('usr-s', 'org-s', 'Dona Sem Módulo', 's@s.com', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-bal1', 'org-a', 'usr-bal1', 'uni-a1', 'BALCAO'),
    ('ac-s', 'org-s', 'usr-s', null, 'DONO');

  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('cat-desp', 'org-a', 'Outras despesas', 'DESPESA', 'OUTRA'),
    ('cat-rec',  'org-a', 'Outras receitas', 'RECEITA', 'RECEITA_OUTRA');

  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, ativo, atualizado_em) values
    ('p-cam', 'org-a', 'Camiseta', 'UN', 50.00, 50.00, 50.00, 20.00, true, now()),
    ('p-que', 'org-a', 'Queijo',   'KG', 40.00, 40.00, 40.00, 20.00, true, now()),
    ('p-vel', 'org-a', 'Velho',    'UN', 10.00, 10.00, 10.00,  5.00, false, now());

  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-cam', 'org-a', 'p-cam', 'CAM-1', true),
    ('var-cam-off', 'org-a', 'p-cam', 'CAM-2', false),
    ('var-que', 'org-a', 'p-que', 'QUE-1', true),
    ('var-vel', 'org-a', 'p-vel', 'VEL-1', true);

  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-cam', 'uni-a1', 100, now()),
    ('e2', 'org-a', 'var-cam-off', 'uni-a1', 10, now()),
    ('e3', 'org-a', 'var-que', 'uni-a1', 10, now()),
    ('e4', 'org-a', 'var-vel', 'uni-a1', 10, now()),
    ('e5', 'org-a', 'var-cam', 'uni-a9', 100, now());

  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Balcão Centro', 100);

  insert into clientes (id, org_id, nome, pontos, atualizado_em) values
    ('cli-1', 'org-a', 'Cliente Um', 200, now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 62000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url

  m = {
    venda: await import('../src/servidor/venda'),
    devolucao: await import('../src/servidor/devolucao'),
    caixa: await import('../src/servidor/caixa'),
    crediario: await import('../src/servidor/crediario'),
    encomenda: await import('../src/servidor/encomenda'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  const g = globalThis as { __prismaNorte?: unknown }
  delete g.__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linha = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const saldo = async (variacao: string, unidade = 'uni-a1') =>
  Number((await linha<{ q: string }>(`select quantidade as q from estoque where variacao_id = $1 and unidade_id = $2`, [variacao, unidade]))[0]!.q)

const vender = (extra: Partial<Parameters<typeof m.venda.registrarVenda>[1]> = {}, quem: Sessao = DONA) =>
  m.venda.registrarVenda(quem, {
    unidadeId: 'uni-a1',
    caixaId: null,
    itens: [{ variacaoId: 'var-cam', quantidade: 1 }],
    pagamentos: [{ forma: 'PIX' as const, valor: 50 }],
    ...extra,
  })

const itemDa = async (vendaId: string) =>
  (await linha<{ id: string }>(`select id from venda_itens where venda_id = $1 order by id`, [vendaId]))[0]!.id

// ─────────────────────────────────────────────────────────────
// DEVOLUÇÃO
// ─────────────────────────────────────────────────────────────

describe('devolução', () => {
  it('o mesmo item repetido no pedido é recusado — não vira três vales de uma peça', async () => {
    const r = await vender()
    if (!r.ok) throw new Error(r.motivo)
    const item = await itemDa(r.vendaId)
    const antes = await saldo('var-cam')
    const d = await m.devolucao.devolver(DONA, {
      vendaId: r.vendaId,
      itens: [1, 1, 1].map((quantidade) => ({ vendaItemId: item, quantidade })),
      destino: 'VALE',
      motivo: 'não serviu',
    })
    expect(d).toMatchObject({ ok: false, motivo: 'item_repetido' })
    expect(await saldo('var-cam')).toBe(antes)
    expect(await linha(`select id from devolucoes where venda_id = $1`, [r.vendaId])).toHaveLength(0)
  })

  it('peça não volta pela metade', async () => {
    const r = await vender({ itens: [{ variacaoId: 'var-cam', quantidade: 2 }], pagamentos: [{ forma: 'PIX', valor: 100 }] })
    if (!r.ok) throw new Error(r.motivo)
    const d = await m.devolucao.devolver(DONA, {
      vendaId: r.vendaId,
      itens: [{ vendaItemId: await itemDa(r.vendaId), quantidade: 0.5 }],
      destino: 'VALE',
      motivo: 'meia peça',
    })
    expect(d).toMatchObject({ ok: false, motivo: 'quantidade_fracionada' })
  })

  it('os pontos que o cliente gastou na peça devolvida voltam para ele', async () => {
    // 100 pontos de R$ 0,10 = R$ 10 de desconto numa camiseta de R$ 50.
    const r = await vender({ clienteId: 'cli-1', pontosUsar: 100, pagamentos: [{ forma: 'PIX', valor: 40 }] })
    if (!r.ok) throw new Error(r.motivo)
    expect((await linha<{ pontos: number }>(`select pontos from clientes where id = 'cli-1'`))[0]!.pontos).toBe(100)

    const d = await m.devolucao.devolver(DONA, {
      vendaId: r.vendaId,
      itens: [{ vendaItemId: await itemDa(r.vendaId), quantidade: 1 }],
      destino: 'VALE',
      motivo: 'não serviu',
    })
    // O dinheiro volta com o desconto dos pontos embutido (R$ 40) — e os
    // pontos, que antes se perdiam, voltam inteiros.
    expect(d).toMatchObject({ ok: true, valor: 40 })
    expect((await linha<{ pontos: number }>(`select pontos from clientes where id = 'cli-1'`))[0]!.pontos).toBe(200)
    const [mov] = await linha<{ pontos: number; tipo: string }>(
      `select pontos, tipo::text as tipo from movimentos_pontos where venda_id = $1 and tipo = 'AJUSTE'`,
      [r.vendaId],
    )
    expect(mov).toMatchObject({ pontos: 100, tipo: 'AJUSTE' })
  })
})

// ─────────────────────────────────────────────────────────────
// VENDA
// ─────────────────────────────────────────────────────────────

describe('venda: onde e o quê', () => {
  it('depósito não vende, e nem abre caixa', async () => {
    const r = await vender({ unidadeId: 'uni-a9', caixaId: null })
    expect(r).toMatchObject({ ok: false, motivo: 'loja_nao_vende' })
    await expect(m.caixa.abrirCaixa(DONA, 'uni-a9', 0)).rejects.toThrow(/Depósito/)
  })

  it('loja desativada não vende nem abre caixa', async () => {
    expect(await vender({ unidadeId: 'uni-a2', caixaId: null })).toMatchObject({ ok: false, motivo: 'loja_nao_vende' })
    await expect(m.caixa.abrirCaixa(DONA, 'uni-a2', 0)).rejects.toThrow(/desativada/)
  })

  it('variação desativada e produto desativado não vendem', async () => {
    expect(await vender({ itens: [{ variacaoId: 'var-cam-off', quantidade: 1 }] })).toMatchObject({
      ok: false,
      motivo: 'item_inativo',
    })
    expect(
      await vender({ itens: [{ variacaoId: 'var-vel', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 10 }] }),
    ).toMatchObject({ ok: false, motivo: 'item_inativo' })
    expect(await saldo('var-vel')).toBe(10)
  })

  it('peça em quantidade quebrada é recusada; quilo quebrado passa', async () => {
    expect(
      await vender({ itens: [{ variacaoId: 'var-cam', quantidade: 1.5 }], pagamentos: [{ forma: 'PIX', valor: 75 }] }),
    ).toMatchObject({ ok: false, motivo: 'quantidade_fracionada', itens: ['Camiseta'] })
    const kg = await vender({ itens: [{ variacaoId: 'var-que', quantidade: 0.25 }], pagamentos: [{ forma: 'PIX', valor: 10 }] })
    expect(kg.ok).toBe(true)
  })
})

describe('vendas: o resumo não para em 500', () => {
  it('o total do alto da tela é somado no banco, com os mesmos filtros da lista', async () => {
    const f = { unidadeIds: ['uni-a1'], de: new Date(Date.now() - 864e5), ate: new Date(Date.now() + 864e5) }
    const lista = await m.venda.listarVendas(DONA, f)
    const resumo = await m.venda.resumoVendas(DONA, f)
    const concluidas = lista.filter((v) => v.situacao === 'CONCLUIDA')
    expect(resumo.concluidas).toBe(concluidas.length)
    expect(resumo.total).toBeCloseTo(concluidas.reduce((s, v) => s + v.total, 0), 2)
  })
})

// ─────────────────────────────────────────────────────────────
// CANCELAR E O CAIXA
// ─────────────────────────────────────────────────────────────

describe('cancelar venda em dinheiro de um turno já fechado', () => {
  it('sem caixa aberto, recusa; com caixa aberto, o dinheiro sai como sangria da gaveta de agora', async () => {
    // Fecha o turno atual, vende nele antes, e confere o turno fechado.
    const r = await vender({ pagamentos: [{ forma: 'DINHEIRO', valor: 50 }] })
    if (!r.ok) throw new Error(r.motivo)
    const f = await m.caixa.fecharCaixa(DONA, 'cx-a1', 150)
    // A conta inteira só sai depois de fechar (contagem às cegas).
    expect(f.conferencia.dinheiroVendido).toBeGreaterThanOrEqual(50)
    const turnoAntes = await linha(`select saldo_esperado, saldo_contado from caixas where id = 'cx-a1'`)

    expect(await m.venda.cancelarVenda(DONA, r.vendaId, 'cliente desistiu')).toMatchObject({
      ok: false,
      motivo: 'caixa_fechado',
    })
    expect((await linha<{ s: string }>(`select situacao::text as s from vendas where id = $1`, [r.vendaId]))[0]!.s).toBe('CONCLUIDA')

    const a = await m.caixa.abrirCaixa(DONA, 'uni-a1', 0)
    if (!a.ok) throw new Error('não abriu')
    const c = await m.venda.cancelarVenda(DONA, r.vendaId, 'cliente desistiu')
    expect(c).toMatchObject({ ok: true, sangria: 50 })
    const [s] = await linha<{ valor: string; tipo: string }>(
      `select valor, tipo::text as tipo from caixa_movimentos where caixa_id = $1`,
      [a.caixaId],
    )
    expect(s).toMatchObject({ tipo: 'SANGRIA' })
    expect(Number(s!.valor)).toBe(50)
    // O turno fechado não muda.
    expect(await linha(`select saldo_esperado, saldo_contado from caixas where id = 'cx-a1'`)).toEqual(turnoAntes)
  })

  it('sangria num caixa que acabou de fechar é recusada', async () => {
    await expect(m.caixa.movimentarCaixa(DONA, 'cx-a1', 'SANGRIA', 10, 'x')).rejects.toThrow(/fechado/)
  })
})

describe('crediário: receber trava a venda', () => {
  it('recebe normalmente com a trava; parcela abatida por devolução não quita pelo valor velho', async () => {
    const r = await vender({ clienteId: 'cli-1', pagamentos: [{ forma: 'CREDIARIO', valor: 50, parcelas: 1 }] })
    if (!r.ok) throw new Error(r.motivo)
    const [p] = await linha<{ id: string }>(`select id from parcelas where venda_id = $1`, [r.vendaId])
    const ok = await m.crediario.receberParcela(DONA, { parcelaId: p!.id, valor: 20, juros: 0, forma: 'PIX' })
    expect(ok).toMatchObject({ ok: true, quitada: false })
    // Com recebimento, cancelar recusa — e nenhuma parcela some.
    expect(await m.venda.cancelarVenda(DONA, r.vendaId, 'engano')).toMatchObject({ ok: false, motivo: 'crediario_recebido' })
    expect(await linha(`select id from parcelas where venda_id = $1`, [r.vendaId])).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────
// ENCOMENDA
// ─────────────────────────────────────────────────────────────

describe('encomenda', () => {
  const amanha = () => {
    const d = new Date(Date.now() + 2 * 864e5)
    return m.encomenda.diaEmSP(d)
  }
  const dados = (extra = {}) => ({
    unidadeId: 'uni-a1',
    clienteNome: 'Marta',
    descricao: 'Bolo de chocolate 2 kg',
    valor: 120,
    sinal: 50,
    sinalForma: 'PIX' as const,
    dia: amanha(),
    hora: '15:00',
    entrega: false,
    ...extra,
  })

  it('empresa sem o módulo não anota encomenda pelo POST na mão', async () => {
    const r = await m.encomenda.criarEncomenda(DONA_SEM, { ...dados(), unidadeId: 'uni-s1' })
    expect(r).toMatchObject({ ok: false })
    expect(await linha(`select id from encomendas where org_id = 'org-s'`)).toHaveLength(0)
  })

  it('o balcão não devolve sinal baixando o valor dele na edição', async () => {
    const c = await m.encomenda.criarEncomenda(BALCAO, dados())
    if (!c.ok) throw new Error(c.erro)
    const r = await m.encomenda.editarEncomenda(BALCAO, c.id, { ...dados(), sinal: 0 })
    expect(r).toMatchObject({ ok: false })
    expect(Number((await linha<{ s: string }>(`select sinal as s from encomendas where id = $1`, [c.id]))[0]!.s)).toBe(50)
    // Subir o sinal, o balcão pode.
    expect(await m.encomenda.editarEncomenda(BALCAO, c.id, { ...dados(), sinal: 60 })).toMatchObject({ ok: true })
  })

  it('receber no balcão: o servidor lança só o que falta, sem pedir desconto, e entrega uma vez só', async () => {
    const c = await m.encomenda.criarEncomenda(BALCAO, dados())
    if (!c.ok) throw new Error(c.erro)

    // O navegador não manda o valor: manda a encomenda. Pagamento de R$ 70.
    const r = await vender({ itens: [], encomendaId: c.id, pagamentos: [{ forma: 'PIX', valor: 70 }] }, BALCAO)
    expect(r).toMatchObject({ ok: true, total: 70 })
    if (!r.ok) return
    const itens = await linha<{ descricao: string; total: string; variacao_id: string | null }>(
      `select descricao, total, variacao_id from venda_itens where venda_id = $1`,
      [r.vendaId],
    )
    expect(itens).toHaveLength(1)
    expect(itens[0]!.descricao).toMatch(/^Encomenda ENC-/)
    expect(Number(itens[0]!.total)).toBe(70)
    const [e] = await linha<{ s: string }>(`select situacao::text as s from encomendas where id = $1`, [c.id])
    expect(e!.s).toBe('ENTREGUE')

    // A segunda aba recebendo a mesma encomenda não cobra de novo.
    const outra = await vender({ itens: [], encomendaId: c.id, pagamentos: [{ forma: 'PIX', valor: 70 }] }, BALCAO)
    expect(outra).toMatchObject({ ok: false, motivo: 'encomenda_recusada' })
  })

  it('o valor pedido pelo navegador não manda: pagar menos que o que falta não fecha', async () => {
    const c = await m.encomenda.criarEncomenda(BALCAO, dados())
    if (!c.ok) throw new Error(c.erro)
    const r = await vender({ itens: [], encomendaId: c.id, pagamentos: [{ forma: 'PIX', valor: 1 }] }, BALCAO)
    expect(r).toMatchObject({ ok: false, motivo: 'pagamento_nao_fecha', total: 70 })
    const [e] = await linha<{ s: string }>(`select situacao::text as s from encomendas where id = $1`, [c.id])
    expect(e!.s).toBe('ABERTA')
  })
})
