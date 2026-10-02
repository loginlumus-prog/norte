// AUDITORIA (fábrica): cada `it` aqui provava um defeito de regra de negócio
// encontrado em src/servidor/fabrica.ts. Os corrigidos (02/10/2026) agora
// conferem o comportamento certo; os que continuam descrevendo o desenho de
// hoje (F3, F10, F11) dizem no comentário o que falta.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  fabrica: typeof import('../src/servidor/fabrica')
  estoque: typeof import('../src/servidor/estoque')
  lojas: typeof import('../src/servidor/lojas')
  permissao: typeof import('../src/servidor/permissao')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null; capacidades?: string[] }[]): Sessao => ({
  orgId: 'org-a',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONO = sessao('usr-dono', 'Dono', [{ papel: 'DONO', unidadeId: null }])
const GER_A = sessao('usr-ga', 'Gerente A', [{ papel: 'GERENTE', unidadeId: 'uni-a' }])
// O cargo "Produção da fábrica" que o próprio fabrica.ts sugere: SEM produto.preco.
const PRODUCAO = sessao('usr-prod', 'Produção', [
  { papel: 'CARGO', unidadeId: 'uni-fab', capacidades: ['estoque.ver', 'estoque.ajustar', 'estoque.consumir', 'produto.ver'] },
])

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-a', 'Gelados Aud', 'gelados-aud', 'BALCAO', 'ATIVA', '{multiUnidade,fabrica}', now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, eh_fabrica, atualizada_em) values
    ('uni-fab', 'org-a', 'Fábrica', true, true, now()),
    ('uni-fab2', 'org-a', 'Fábrica 2', true, true, now()),
    ('uni-a', 'org-a', 'Loja A', false, false, now()),
    ('uni-b', 'org-a', 'Loja B', false, false, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dono', 'org-a', 'Dono', 'dono@a.com', now()),
    ('usr-ga', 'org-a', 'Gerente A', 'ga@a.com', now()),
    ('usr-prod', 'org-a', 'Produção', 'prod@a.com', now());
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, uso_interno, vendido_em, atualizado_em) values
    -- Picolé com os SABORES como variações (o eixo Sabor da sorveteria)
    ('p-pic', 'org-a', 'Picolé', 'UN', 5.00, null, false, '{}', now()),
    ('p-bom', 'org-a', 'Bombom', 'UN', 3.00, null, false, '{}', now()),
    ('p-cal', 'org-a', 'Calda base', 'ML', 1, null, true, '{}', now()),
    ('p-lei', 'org-a', 'Leite', 'L', 1, 5.00, true, '{}', now()),
    ('p-acu', 'org-a', 'Açúcar', 'KG', 1, 4.00, true, '{}', now()),
    ('p-cac', 'org-a', 'Cacau', 'KG', 1, 40.00, true, '{}', now()),
    ('p-pal', 'org-a', 'Palito', 'UN', 1, 0.05, true, '{}', now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-coco', 'org-a', 'p-pic', 'PIC-COCO', true),
    ('v-choc', 'org-a', 'p-pic', 'PIC-CHOC', false),
    ('v-bom', 'org-a', 'p-bom', 'BOM', true),
    ('v-cal', 'org-a', 'p-cal', 'CAL', true),
    ('v-lei', 'org-a', 'p-lei', 'LEI', true),
    ('v-acu', 'org-a', 'p-acu', 'ACU', true),
    ('v-cac', 'org-a', 'p-cac', 'CAC', true),
    ('v-pal', 'org-a', 'p-pal', 'PAL', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-lei', 'org-a', 'v-lei', 'uni-fab', 1000, now()),
    ('e-acu', 'org-a', 'v-acu', 'uni-fab', 1000, now()),
    ('e-cac', 'org-a', 'v-cac', 'uni-fab', 1000, now()),
    ('e-pal', 'org-a', 'v-pal', 'uni-fab', 10000, now());
  insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, quem) values
    ('m-lei', 'org-a', 'v-lei', 'uni-fab', 'ENTRADA', 1000, 1000, 'Compra'),
    ('m-acu', 'org-a', 'v-acu', 'uni-fab', 'ENTRADA', 1000, 1000, 'Compra'),
    ('m-cac', 'org-a', 'v-cac', 'uni-fab', 'ENTRADA', 1000, 1000, 'Compra'),
    ('m-pal', 'org-a', 'v-pal', 'uni-fab', 'ENTRADA', 10000, 10000, 'Compra');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 50000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    fabrica: await import('../src/servidor/fabrica'),
    estoque: await import('../src/servidor/estoque'),
    lojas: await import('../src/servidor/lojas'),
    permissao: await import('../src/servidor/permissao'),
    banco: await import('../src/servidor/banco'),
  }
  // Receitas: coco = 4 L leite + 40 palitos, rende 40 → (20 + 2) / 40 = 0,55
  //           choc = 4 L leite + 1 kg cacau + 40 palitos, rende 40 → 62 / 40 = 1,55
  await m.fabrica.salvarReceita(DONO, { variacaoId: 'v-coco', rendimento: 40, validadeDias: 180, itens: [{ insumoId: 'v-lei', quantidade: 4 }, { insumoId: 'v-pal', quantidade: 40 }] })
  await m.fabrica.salvarReceita(DONO, {
    variacaoId: 'v-choc', rendimento: 40, validadeDias: 180,
    itens: [{ insumoId: 'v-lei', quantidade: 4 }, { insumoId: 'v-cac', quantidade: 1 }, { insumoId: 'v-pal', quantidade: 40 }],
  })
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
const custo = async (p: string) => {
  const c = (await linhas<{ c: string | null }>(`select custo c from produtos where id = $1`, [p]))[0]!.c
  return c === null ? null : Number(c)
}
const custoVar = async (v: string) => {
  const c = (await linhas<{ c: string | null }>(`select custo c from variacoes where id = $1`, [v]))[0]!.c
  return c === null ? null : Number(c)
}
const produzir = async (s: Sessao, variacaoId: string, bateladas: number, produzida: number, extra: Partial<import('../src/servidor/fabrica').Encerramento> = {}) => {
  const o = await m.fabrica.abrirOrdem(s, { unidadeId: 'uni-fab', variacaoId, bateladas })
  const r = await m.fabrica.encerrarOrdem(s, o.id, { produzida, ...extra })
  return { ...o, ...r }
}

describe('custo do pronto', () => {
  it('[F1] corrigido: cada sabor guarda o próprio custo; o produto fica com a média dos dois', async () => {
    await produzir(DONO, 'v-coco', 1, 40)
    expect(await custoVar('v-coco')).toBe(0.55)
    expect(await custo('p-pic')).toBe(0.55)
    await produzir(DONO, 'v-choc', 1, 40)
    // O lote de chocolate não reescreve o coco.
    expect(await custoVar('v-coco')).toBe(0.55)
    expect(await custoVar('v-choc')).toBe(1.55)
    // 40 de coco a 0,55 + 40 de chocolate a 1,55.
    expect(await custo('p-pic')).toBe(1.05)
  })

  it('[F2] corrigido: quem não tem produto.preco registra a produção, mas o custo fica como estava — como na entrada', async () => {
    expect(m.permissao.pode(PRODUCAO, 'produto.preco')).toBe(false)
    const antes = await custo('p-pic')
    const antesCoco = await custoVar('v-coco')
    const r = await produzir(PRODUCAO, 'v-coco', 1, 40)
    expect(r.custoAtualizado).toBe(false)
    expect(r.custoUnitario).toBe(0.55)
    expect(await custo('p-pic')).toBe(antes)
    expect(await custoVar('v-coco')).toBe(antesCoco)
  })

  it('[F3] digitou 400 em vez de 40: estoque +400 e não há estorno da OP encerrada (o custo, ao menos, só muda com produto.preco)', async () => {
    const antes = await custo('p-pic')
    const r = await produzir(PRODUCAO, 'v-coco', 1, 400)
    expect(await custo('p-pic')).toBe(antes) // o cargo de produção não mexe no custo
    await expect(m.fabrica.cancelarOrdem(DONO, r.id, 'digitei errado')).rejects.toThrow(/Só ordem aberta/)
    // Nenhum aviso de "produzida 10× a prevista", e nenhum estorno: só balanço manual,
    // e o custo errado fica até a próxima OP do produto.
  })

  it('[F4] corrigido: produto em ML/G guarda o custo com 4 casas — a calda a 0,0028/ml custa o bombom de verdade', async () => {
    // Calda: 2 kg açúcar (8) + 4 L leite (20) = 28 → rende 10.000 ml → 0,0028/ml
    await m.fabrica.salvarReceita(DONO, { variacaoId: 'v-cal', rendimento: 10000, validadeDias: 10, itens: [{ insumoId: 'v-acu', quantidade: 2 }, { insumoId: 'v-lei', quantidade: 4 }] })
    const r = await produzir(DONO, 'v-cal', 1, 10000)
    expect(r.custoUnitario).toBeCloseTo(0.0028, 6)
    expect(await custo('p-cal')).toBe(0.0028)
    // Bombom: 2000 ml de calda + 20 palitos, rende 20 → real (5,6 + 1) / 20 = 0,33
    await m.fabrica.salvarReceita(DONO, { variacaoId: 'v-bom', rendimento: 20, validadeDias: 30, itens: [{ insumoId: 'v-cal', quantidade: 2000 }, { insumoId: 'v-pal', quantidade: 20 }] })
    const b = await produzir(DONO, 'v-bom', 1, 20)
    expect(b.faltouCusto).toBe(false)
    expect(await custo('p-bom')).toBe(0.33)
  })
})

describe('ordem de produção', () => {
  it('[F5] corrigido: renomear o lote ao encerrar não faz a próxima OP do dia repetir o lote de outra', async () => {
    const a = await m.fabrica.abrirOrdem(DONO, { unidadeId: 'uni-fab', variacaoId: 'v-coco', bateladas: 1 })
    const b = await m.fabrica.abrirOrdem(DONO, { unidadeId: 'uni-fab', variacaoId: 'v-coco', bateladas: 1 })
    await m.fabrica.encerrarOrdem(DONO, a.id, { produzida: 40, lote: 'ESPECIAL-NATAL' })
    const c = await m.fabrica.abrirOrdem(DONO, { unidadeId: 'uni-fab', variacaoId: 'v-choc', bateladas: 1 })
    expect(c.lote).not.toBe(b.lote)
    // E o lote escrito à mão não pode ser o de outra ordem.
    await expect(m.fabrica.encerrarOrdem(DONO, c.id, { produzida: 40, lote: b.lote })).rejects.toThrow(/já é da OP/)
    await m.fabrica.cancelarOrdem(DONO, b.id, 'limpeza')
    await m.fabrica.cancelarOrdem(DONO, c.id, 'limpeza')
  })

  it('[F6] corrigido: insumo usado fora da receita baixa do estoque, entra na ordem e no custo, e o resultado avisa', async () => {
    const antes = await saldo('v-cac', 'uni-fab')
    const r = await produzir(DONO, 'v-coco', 1, 40, { consumos: [{ insumoId: 'v-cac', usado: 2 }] })
    expect(await saldo('v-cac', 'uni-fab')).toBe(antes - 2)
    expect(r.foraDaReceita).toBe(1)
    // 4 L de leite (20) + 40 palitos (2) + 2 kg de cacau (80) = 102 / 40
    expect(r.custoUnitario).toBe(2.55)
    const [linha] = await linhas<{ previsto: string; usado: string }>(
      `select previsto, usado from ordem_consumos where ordem_id = $1 and insumo_id = 'v-cac'`, [r.id],
    )
    expect(Number(linha!.previsto)).toBe(0)
    expect(Number(linha!.usado)).toBe(2)
  })

  it('[F7] corrigido: a OP aberta impede fechar a fábrica; e fábrica fechada (por fora) não recebe produção', async () => {
    const o = await m.fabrica.abrirOrdem(DONO, { unidadeId: 'uni-fab2', variacaoId: 'v-coco', bateladas: 1 })
    // Fábrica 2 sem saldo nenhum: os insumos negativariam; uso só a OP "sem consumo" de outro jeito:
    const pend = await m.banco.comoOrg('org-a', (tx) => m.lojas.pendenciasParaFechar(tx, 'uni-fab2'))
    expect(pend).toEqual([expect.stringMatching(/1 ordem de produção aberta/)])
    await expect(m.lojas.mudarSituacaoLoja(DONO, 'uni-fab2', false)).rejects.toThrow(/ordem de produção aberta/)
    // Fechada por outro caminho (dado antigo, banco mexido): o encerramento recusa.
    await db.exec(`update unidades set ativa = false where id = 'uni-fab2'`)
    await expect(m.fabrica.encerrarOrdem(DONO, o.id, { produzida: 40 })).rejects.toThrow(/fechada/)
    expect(await saldo('v-coco', 'uni-fab2')).toBe(0)
    expect(await saldo('v-pal', 'uni-fab2')).toBe(0)
  })
})

describe('pedido da loja', () => {
  const pedir = async (q: number) => {
    const p = await m.fabrica.criarPedido(GER_A, { lojaId: 'uni-a', fabricaId: 'uni-fab', itens: [{ variacaoId: 'v-coco', quantidade: q }] })
    const lido = (await m.fabrica.listarPedidos(DONO)).find((x) => x.id === p.id)!
    return { id: p.id, itemId: lido.itens[0]!.id }
  }

  it('[F8] corrigido: envio parcial deixa o pedido aberto; o resto vai depois, e nunca mais que o pedido', async () => {
    const p = await pedir(50)
    const r1 = await m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId: p.itemId, enviada: 20 }])
    expect(r1.fechou).toBe(false)
    const [aberto] = await linhas<{ situacao: string }>(`select situacao from pedidos_fabrica where id = $1`, [p.id])
    expect(aberto!.situacao).toBe('ABERTO')
    // Parte já foi: o pedido não se cancela.
    await expect(m.fabrica.cancelarPedido(GER_A, p.id)).rejects.toThrow(/já foi mandada/)
    // Mais do que falta (30) é recusado.
    await expect(m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId: p.itemId, enviada: 31 }])).rejects.toThrow(/no máximo 30/)
    const r2 = await m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId: p.itemId, enviada: 30 }])
    expect(r2.fechou).toBe(true)
    const [it] = await linhas<{ enviada: string }>(`select enviada from pedido_fabrica_itens where id = $1`, [p.itemId])
    expect(Number(it!.enviada)).toBe(50)
    await m.fabrica.receberPedido(GER_A, p.id, [{ itemId: p.itemId, recebida: 50 }])
  })

  it('[F8b] a fábrica pode dizer que o resto não vai: o pedido fecha com o que foi', async () => {
    const p = await pedir(40)
    const r = await m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId: p.itemId, enviada: 25 }], { encerrar: true })
    expect(r.fechou).toBe(true)
    await m.fabrica.receberPedido(GER_A, p.id, [{ itemId: p.itemId, recebida: 25 }])
  })

  it('[F9] corrigido: chegou A MAIS — a conferência registra o que chegou, e a diferença sai da fábrica e entra na loja', async () => {
    const p = await pedir(10)
    const fab0 = await saldo('v-coco', 'uni-fab')
    const loja0 = await saldo('v-coco', 'uni-a')
    await m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId: p.itemId, enviada: 10 }])
    await m.fabrica.receberPedido(GER_A, p.id, [{ itemId: p.itemId, recebida: 12 }])
    const [it] = await linhas<{ recebida: string }>(`select recebida from pedido_fabrica_itens where id = $1`, [p.itemId])
    expect(Number(it!.recebida)).toBe(12)
    expect(await saldo('v-coco', 'uni-a')).toBe(loja0 + 12)
    expect(await saldo('v-coco', 'uni-fab')).toBe(fab0 - 12)
  })

  it('[F10] chegou A MENOS: a falta vira PERDA da LOJA, e a fábrica nunca recebe de volta o que não saiu', async () => {
    const p = await pedir(10)
    const fab0 = await saldo('v-coco', 'uni-fab')
    await m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId: p.itemId, enviada: 10 }])
    await m.fabrica.receberPedido(GER_A, p.id, [{ itemId: p.itemId, recebida: 6 }])
    const perdas = await linhas<{ q: string }>(`select quantidade q from movimentos_estoque where referencia = $1 and tipo = 'PERDA' and unidade_id = 'uni-a'`, [p.id])
    expect(perdas.map((x) => Number(x.q))).toEqual([-4])
    expect(await saldo('v-coco', 'uni-fab')).toBe(fab0 - 10) // se as 4 ficaram no freezer da fábrica, ela está 4 abaixo
  })

  it('[F11] mercadoria "em trânsito" já é da loja: o balanço feito antes de o caminhão chegar apaga a remessa', async () => {
    const p = await m.fabrica.criarPedido(DONO, { lojaId: 'uni-b', fabricaId: 'uni-fab', itens: [{ variacaoId: 'v-coco', quantidade: 30 }] })
    const itemId = (await m.fabrica.listarPedidos(DONO)).find((x) => x.id === p.id)!.itens[0]!.id
    await m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId, enviada: 30 }])
    expect(await saldo('v-coco', 'uni-b')).toBe(30) // ainda no caminhão
    // A loja B conta a prateleira (0) enquanto o caminhão vem:
    const c = await m.estoque.corrigirPeloContado(DONO, { variacaoId: 'v-coco', unidadeId: 'uni-b', contado: 0, motivo: 'contagem da noite' })
    expect(c.ok).toBe(true)
    // Chega tudo, confere 30 de 30 — nenhum movimento:
    await m.fabrica.receberPedido(DONO, p.id, [{ itemId, recebida: 30 }])
    expect(await saldo('v-coco', 'uni-b')).toBe(0) // prateleira com 30, sistema com 0
    const venda = await m.estoque.mexerEstoque(DONO, { variacaoId: 'v-coco', unidadeId: 'uni-b', tipo: 'VENDA', quantidade: 1 })
    expect(venda.ok).toBe(false) // o balcão recusa vender o picolé que está no freezer
  })

  it('[F12] corrigido: o lote que vai no pedido é o MAIS ANTIGO que ainda tem o que mandar (o que vence primeiro)', async () => {
    const velho = await produzir(DONO, 'v-choc', 1, 40)
    const novo = await produzir(DONO, 'v-choc', 1, 40)
    // O mais antigo de chocolate com saldo é o do [F1] (nunca mandado); o
    // [F12] produziu mais dois depois dele.
    const [maisAntigo] = await linhas<{ lote: string }>(
      `select lote from ordens_producao where variacao_id = 'v-choc' and situacao = 'ENCERRADA' order by fabricada_em, numero limit 1`,
    )
    const p = await m.fabrica.criarPedido(GER_A, { lojaId: 'uni-a', fabricaId: 'uni-fab', itens: [{ variacaoId: 'v-choc', quantidade: 10 }] })
    const itemId = (await m.fabrica.listarPedidos(DONO)).find((x) => x.id === p.id)!.itens[0]!.id
    await m.fabrica.enviarPedido(PRODUCAO, p.id, [{ itemId, enviada: 10 }])
    const [it] = await linhas<{ lote: string }>(`select lote from pedido_fabrica_itens where id = $1`, [itemId])
    expect(it!.lote).toBe(maisAntigo!.lote)
    expect(it!.lote).not.toBe(novo.lote)
    expect(velho.lote).not.toBe(novo.lote)
  })
})
