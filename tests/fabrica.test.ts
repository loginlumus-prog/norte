// A fábrica, com banco de verdade: receita, produção com lote e custo, e o
// pedido da loja do envio à conferência. O estoque tem de continuar sendo a
// soma dos movimentos em cada passo.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  fabrica: typeof import('../src/servidor/fabrica')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null; capacidades?: string[] }[]): Sessao => ({
  orgId: 'org-f',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONO = sessao('usr-dono', 'Dono', [{ papel: 'DONO', unidadeId: null }])
const GER_LOJA = sessao('usr-ger', 'Gerente Praia', [{ papel: 'GERENTE', unidadeId: 'uni-praia' }])
const PRODUCAO = sessao('usr-prod', 'Produção', [
  { papel: 'CARGO', unidadeId: 'uni-fab', capacidades: ['estoque.ver', 'estoque.ajustar', 'estoque.consumir', 'produto.ver'] },
])

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-f', 'Gelados', 'gelados', 'BALCAO', 'ATIVA', '{multiUnidade,fabrica}', now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, eh_fabrica, atualizada_em) values
    ('uni-fab', 'org-f', 'Fábrica', true, true, now()),
    ('uni-praia', 'org-f', 'Praia', false, false, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dono', 'org-f', 'Dono', 'dono@f.com', now()),
    ('usr-ger', 'org-f', 'Gerente Praia', 'ger@f.com', now()),
    ('usr-prod', 'org-f', 'Produção', 'prod@f.com', now());
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, uso_interno, vendido_em, atualizado_em) values
    ('p-pic', 'org-f', 'Picolé de coco', 'UN', 2.00, null, false, '{}', now()),
    ('p-lei', 'org-f', 'Leite', 'L', 1, 5.00, true, '{}', now()),
    ('p-acu', 'org-f', 'Açúcar', 'KG', 1, 4.00, true, '{}', now()),
    ('p-pal', 'org-f', 'Palito', 'UN', 1, 0.05, true, '{}', now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-pic', 'org-f', 'p-pic', 'PIC001', true),
    ('v-lei', 'org-f', 'p-lei', 'LEI001', true),
    ('v-acu', 'org-f', 'p-acu', 'ACU001', true),
    ('v-pal', 'org-f', 'p-pal', 'PAL001', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-lei', 'org-f', 'v-lei', 'uni-fab', 20, now()),
    ('e-acu', 'org-f', 'v-acu', 'uni-fab', 10, now());
  insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, quem) values
    ('m-lei', 'org-f', 'v-lei', 'uni-fab', 'ENTRADA', 20, 20, 'Compra'),
    ('m-acu', 'org-f', 'v-acu', 'uni-fab', 'ENTRADA', 10, 10, 'Compra');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = { fabrica: await import('../src/servidor/fabrica'), banco: await import('../src/servidor/banco') }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const saldo = async (v: string, u: string) =>
  Number((await linhas<{ q: string }>(`select quantidade q from estoque where variacao_id = $1 and unidade_id = $2`, [v, u]))[0]?.q ?? 0)
const somaMov = async (v: string, u: string) =>
  Number((await linhas<{ q: string }>(`select coalesce(sum(quantidade), 0) q from movimentos_estoque where variacao_id = $1 and unidade_id = $2`, [v, u]))[0]!.q)

describe('a ficha técnica', () => {
  it('guarda rendimento, validade e insumos, e diz o custo da batelada e da unidade', async () => {
    await m.fabrica.salvarReceita(DONO, {
      variacaoId: 'v-pic', rendimento: 40, validadeDias: 180,
      itens: [
        { insumoId: 'v-lei', quantidade: 4 },
        { insumoId: 'v-acu', quantidade: 1 },
        { insumoId: 'v-pal', quantidade: 40 },
      ],
    })
    const [r] = await m.fabrica.listarReceitas(DONO)
    expect(r).toMatchObject({ produto: 'Picolé de coco', rendimento: 40, validadeDias: 180 })
    // 4 × 5 + 1 × 4 + 40 × 0,05 = 26 por batelada; 0,65 por picolé
    expect(r!.custoBatelada).toBe(26)
    expect(r!.custoUnidade).toBe(0.65)
  })

  it('recusa o produto como insumo dele mesmo, e insumo repetido', async () => {
    await expect(m.fabrica.salvarReceita(DONO, { variacaoId: 'v-pic', rendimento: 1, validadeDias: null, itens: [{ insumoId: 'v-pic', quantidade: 1 }] })).rejects.toThrow(/dele mesmo/)
    await expect(
      m.fabrica.salvarReceita(DONO, { variacaoId: 'v-pic', rendimento: 1, validadeDias: null, itens: [{ insumoId: 'v-lei', quantidade: 1 }, { insumoId: 'v-lei', quantidade: 2 }] }),
    ).rejects.toThrow(/duas vezes/)
  })
})

describe('a ordem de produção', () => {
  let ordemId = ''

  it('abre com o previsto pela receita e um lote do dia', async () => {
    const o = await m.fabrica.abrirOrdem(PRODUCAO, { unidadeId: 'uni-fab', variacaoId: 'v-pic', bateladas: 2 })
    ordemId = o.id
    expect(o.numero).toBe(1)
    expect(o.lote).toMatch(/^L\d{6}-1$/)
    const [ab] = await m.fabrica.listarOrdens(DONO, { situacao: 'ABERTA' })
    expect(ab).toMatchObject({ prevista: 80, situacao: 'ABERTA' })
    expect(ab!.consumos.find((c) => c.insumoId === 'v-lei')!.previsto).toBe(8)
  })

  it('não abre fora da fábrica, nem por quem não mexe no estoque dela', async () => {
    await expect(m.fabrica.abrirOrdem(DONO, { unidadeId: 'uni-praia', variacaoId: 'v-pic', bateladas: 1 })).rejects.toThrow(/não está marcada como fábrica/)
    await expect(m.fabrica.abrirOrdem(GER_LOJA, { unidadeId: 'uni-fab', variacaoId: 'v-pic', bateladas: 1 })).rejects.toThrow()
  })

  it('encerrar baixa o USADO, dá entrada no que saiu e apura o custo (o do produto só muda com produto.preco)', async () => {
    // usou 9 L de leite (previsto 8); açúcar e palito como previsto; saíram 78.
    const r = await m.fabrica.encerrarOrdem(PRODUCAO, ordemId, { produzida: 78, consumos: [{ insumoId: 'v-lei', usado: 9 }] })
    expect(await saldo('v-pic', 'uni-fab')).toBe(78)
    expect(await saldo('v-lei', 'uni-fab')).toBe(11)
    expect(await saldo('v-acu', 'uni-fab')).toBe(8)
    // palito sem estoque lançado: não trava a produção, fica negativo
    expect(await saldo('v-pal', 'uni-fab')).toBe(-80)
    // 9×5 + 2×4 + 80×0,05 = 57 → 57 / 78, com quatro casas (o custo guarda 4)
    expect(r.custoUnitario).toBe(0.7308)
    // O cargo de produção não tem `produto.preco`: registra a produção e o
    // custo apurado fica na ordem, mas o custo do produto (o CMV das lojas)
    // fica com quem decide preço — a mesma régua da entrada de mercadoria.
    expect(r.custoAtualizado).toBe(false)
    const [p] = await linhas<{ custo: string | null }>(`select custo from produtos where id = 'p-pic'`)
    expect(p!.custo).toBeNull()
    for (const v of ['v-pic', 'v-lei', 'v-acu', 'v-pal']) expect(await somaMov(v, 'uni-fab'), v).toBe(await saldo(v, 'uni-fab'))
    // validade pela receita: 180 dias
    const [o] = await m.fabrica.listarOrdens(DONO, { situacao: 'ENCERRADA' })
    expect(o!.validade).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('encerrar duas vezes não dá entrada duas vezes', async () => {
    await expect(m.fabrica.encerrarOrdem(PRODUCAO, ordemId, { produzida: 78 })).rejects.toThrow(/já está encerrada/)
    expect(await saldo('v-pic', 'uni-fab')).toBe(78)
  })
})

describe('o pedido da loja à fábrica', () => {
  let pedidoId = ''

  it('a loja pede o que vende', async () => {
    const p = await m.fabrica.criarPedido(GER_LOJA, { lojaId: 'uni-praia', itens: [{ variacaoId: 'v-pic', quantidade: 50 }] })
    pedidoId = p.id
    expect(p.numero).toBe(1)
    const [lido] = await m.fabrica.listarPedidos(DONO)
    expect(lido).toMatchObject({ situacao: 'ABERTO', loja: 'Praia', fabrica: 'Fábrica' })
    expect(lido!.itens[0]).toMatchObject({ pedida: 50, saldoNaFabrica: 78 })
  })

  it('a loja não manda o pedido por conta própria — quem manda é a fábrica', async () => {
    await expect(m.fabrica.enviarPedido(GER_LOJA, pedidoId, [])).rejects.toThrow()
  })

  it('não manda mais do que a loja pediu', async () => {
    const [it] = (await m.fabrica.listarPedidos(DONO))[0]!.itens
    await expect(m.fabrica.enviarPedido(PRODUCAO, pedidoId, [{ itemId: it!.id, enviada: 500 }])).rejects.toThrow(/no máximo 50/)
    expect(await saldo('v-pic', 'uni-fab')).toBe(78)
  })

  it('a fábrica manda: sai da fábrica, entra na loja, com o lote da produção', async () => {
    const [it] = (await m.fabrica.listarPedidos(DONO))[0]!.itens
    // Manda 48 dos 50 e diz que o resto não vai: o pedido segue para a loja
    // conferir (sem `encerrar`, ficaria aberto esperando os 2 — ver a
    // auditoria [F8]).
    await m.fabrica.enviarPedido(PRODUCAO, pedidoId, [{ itemId: it!.id, enviada: 48 }], { encerrar: true })
    expect(await saldo('v-pic', 'uni-fab')).toBe(30)
    expect(await saldo('v-pic', 'uni-praia')).toBe(48)
    const [lido] = await m.fabrica.listarPedidos(DONO)
    expect(lido!.situacao).toBe('ENVIADO')
    expect(lido!.itens[0]!.lote).toMatch(/^L\d{6}-1$/)
    // as duas pernas no mesmo id de transferência
    const t = await linhas<{ n: number }>(
      `select count(distinct transferencia_id)::int n from movimentos_estoque where referencia = $1 and transferencia_id is not null`,
      [pedidoId],
    )
    expect(t[0]!.n).toBe(1)
  })

  it('a loja confere: o que faltou sai como perda na loja, e o pedido fecha', async () => {
    const [it] = (await m.fabrica.listarPedidos(DONO))[0]!.itens
    const r = await m.fabrica.receberPedido(GER_LOJA, pedidoId, [{ itemId: it!.id, recebida: 46 }])
    expect(r.faltas).toBe(1)
    expect(await saldo('v-pic', 'uni-praia')).toBe(46)
    expect(await somaMov('v-pic', 'uni-praia')).toBe(46)
    expect((await m.fabrica.listarPedidos(DONO))[0]!.situacao).toBe('RECEBIDO')
    await expect(m.fabrica.receberPedido(GER_LOJA, pedidoId, [])).rejects.toThrow(/já foi conferido/)
  })
})
