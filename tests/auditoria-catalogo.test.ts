// AUDITORIA do catálogo público e do pedido que ele cria. Cada teste fixa o
// comportamento ENCONTRADO (o que hoje acontece). Os marcados "DEFEITO" são
// achados: o comportamento esperado está no comentário.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  cat: typeof import('../src/servidor/catalogo')
  enc: typeof import('../src/servidor/encomenda')
  venda: typeof import('../src/servidor/venda')
  vit: typeof import('../src/servidor/vitrine')
  banco: typeof import('../src/servidor/banco')
}

const DONO: Sessao = { orgId: 'org-a', usuarioId: 'usr-dono', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-a', 'Sorveteria A', 'sorveteria-a', 'BALCAO', 'ATIVA', '{encomenda}', now(), now()),
    ('org-b', 'Loja B', 'loja-b', 'BALCAO', 'ATIVA', '{encomenda}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-a', 'org-a', 'Centro', now()), ('uni-b', 'org-b', 'B', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-dono', 'org-a', 'Dona', 'd@a.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-dono', 'org-a', 'usr-dono', null, 'DONO');
  insert into produtos (id, org_id, nome, medida, preco_vista, ativo, uso_interno, atualizado_em) values
    ('p-casq', 'org-a', 'Casquinha', 'UN', 3.00, true, false, now()),
    ('p-combo', 'org-a', 'Casquinha + Agua', 'UN', 5.00, true, false, now()),
    ('p-pic', 'org-a', 'Picole', 'UN', 2.00, true, false, now()),
    ('p-kg', 'org-a', 'Acai a quilo', 'KG', 4.99, true, false, now()),
    ('p-b', 'org-b', 'Produto B', 'UN', 1.00, true, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('v-casq', 'org-a', 'p-casq', 'C1', true), ('v-combo', 'org-a', 'p-combo', 'C2', true),
    ('v-pic', 'org-a', 'p-pic', 'C3', true), ('v-kg', 'org-a', 'p-kg', 'C4', true),
    ('v-b', 'org-b', 'p-b', 'B1', true);
  -- A casquinha ACABOU; o combo não tem estoque próprio (é composto: baixa a casquinha).
  insert into composicoes (id, org_id, variacao_id, componente_id, quantidade) values ('co-1', 'org-a', 'v-combo', 'v-casq', 1);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-casq', 'org-a', 'v-casq', 'uni-a', 0, now()),
    ('e-pic', 'org-a', 'v-pic', 'uni-a', 50, now()),
    ('e-kg', 'org-a', 'v-kg', 'uni-a', 100, now()),
    ('e-b', 'org-b', 'v-b', 'uni-b', 10, now());
  insert into catalogos (id, org_id, unidade_id, ativo, endereco, whatsapp, retirada, entrega, atualizado_em) values
    ('cat-a', 'org-a', 'uni-a', true, 'centro', '5571999990000', true, false, now()),
    ('cat-b', 'org-b', 'uni-b', true, 'centro', '5571999990001', true, false, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-a', 'org-a', 'uni-a', 'Dona', 0);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.SEGREDO_SESSAO ??= 'x'.repeat(40)
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 2000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    cat: await import('../src/servidor/catalogo'),
    enc: await import('../src/servidor/encomenda'),
    venda: await import('../src/servidor/venda'),
    vit: await import('../src/servidor/vitrine'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
let tel = 0
const pedido = (itens: { variacaoId: string; quantidade: number }[], extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza',
  telefone: `7198888${String(1000 + tel++).slice(-4)}`,
  entrega: false,
  forma: 'PIX' as const,
  itens,
  ...extra,
})
let ip = 0
const pedir = (p: ReturnType<typeof pedido>) =>
  m.cat.fazerPedidoPeloCatalogo('sorveteria-a', 'centro', p as never, `10.1.1.${ip++}`, 'https://norte.test')

describe('1. item composto: o pedido confere o estoque dos componentes', () => {
  it('CORRIGIDO: combo sem casquinha — aparece esgotado na vitrine, e o pedido é recusado com o motivo', async () => {
    const vitrine = await m.cat.produtosDoCatalogo('sorveteria-a', 'centro', {})
    expect(vitrine!.produtos.find((p) => p.id === 'p-casq')).toBeUndefined()
    // Sem casquinha, o combo não monta: some da vitrine (ou aparece esgotado).
    expect(vitrine!.produtos.find((p) => p.id === 'p-combo')?.disponivel ?? false).toBe(false)
    const r = await pedir(pedido([{ variacaoId: 'v-combo', quantidade: 5 }]))
    expect(r).toMatchObject({ ok: false, mudou: true })
    expect(!r.ok && r.erro).toMatch(/Não dá para montar/)
  })
})

describe('2. o mesmo pedido mandado duas vezes é UM pedido', () => {
  it('CORRIGIDO: reenvio (resposta perdida) devolve o pedido que já entrou', async () => {
    const p = pedido([{ variacaoId: 'v-pic', quantidade: 2 }])
    const a = await m.cat.fazerPedidoPeloCatalogo('sorveteria-a', 'centro', p as never, '10.2.2.2', '')
    const b = await m.cat.fazerPedidoPeloCatalogo('sorveteria-a', 'centro', p as never, '10.2.2.2', '')
    expect(a.ok && b.ok).toBe(true)
    expect((a as { acompanhamento: string }).acompanhamento).toBe((b as { acompanhamento: string }).acompanhamento)
    expect('repetido' in b).toBe(true)
    const [linha] = await linhas<{ n: number }>(`select count(*)::int n from encomendas where telefone = $1`, [p.telefone.replace(/\D/g, '')])
    expect(linha!.n).toBe(1)
  })
})

describe('3. produto desativado depois do pedido: a encomenda ainda sai pelo balcão', () => {
  it('CORRIGIDO: o balcão aceita a linha do pedido mesmo com o produto fora de linha', async () => {
    await db.exec(`insert into produtos (id, org_id, nome, medida, preco_vista, ativo, uso_interno, atualizado_em) values ('p-sai', 'org-a', 'Sabor que saiu', 'UN', 4, true, false, now());
      insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('v-sai', 'org-a', 'p-sai', 'C9', true);
      insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values ('e-sai', 'org-a', 'v-sai', 'uni-a', 5, now());`)
    const r = await pedir(pedido([{ variacaoId: 'v-sai', quantidade: 1 }]))
    expect(r.ok).toBe(true)
    const encomendaId = (r as { encomendaId: string }).encomendaId
    await db.exec(`update produtos set ativo = false where id = 'p-sai'`)
    const v = await m.venda.registrarVenda(DONO, {
      unidadeId: 'uni-a', caixaId: 'cx-a', encomendaId,
      itens: [{ variacaoId: 'v-sai', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 4 }],
    })
    expect(v).toMatchObject({ ok: true })
    // Mas fora de um pedido, o item desativado continua recusado.
    const solta = await m.venda.registrarVenda(DONO, {
      unidadeId: 'uni-a', caixaId: 'cx-a',
      itens: [{ variacaoId: 'v-sai', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 4 }],
    })
    expect(solta).toMatchObject({ ok: false, motivo: 'item_inativo' })
  })
})

describe('4. o preço subiu entre a vitrine e o "Enviar": a cliente é avisada', () => {
  it('CORRIGIDO: viu R$ 2, agora é R$ 3 — recusa com "mudou" e o preço novo; com o novo, entra', async () => {
    await db.exec(`update produtos set preco_vista = 3 where id = 'p-pic'`)
    const r = await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 1, precoVisto: 2 } as never]))
    expect(r).toMatchObject({ ok: false, mudou: true, precos: { 'v-pic': 3 } })
    const r2 = await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 1, precoVisto: 3 } as never]))
    expect(r2).toMatchObject({ ok: true, totalC: 300 })
    // Baixou: entra pelo preço de agora, sem perguntar.
    await db.exec(`update produtos set preco_vista = 2 where id = 'p-pic'`)
    const r3 = await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 2, precoVisto: 3 } as never]))
    expect(r3).toMatchObject({ ok: true, totalC: 400 })
  })
})

describe('5. entrada malformada é recusada, não derruba a ação', () => {
  it('CORRIGIDO: nome numérico, observação não-texto: recusa limpa (ou ignora a observação)', async () => {
    expect(await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 1 }], { nome: 12345 }))).toMatchObject({ ok: false })
    expect((await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 3, observacao: 7 } as never]))).ok).toBe(true)
    expect((await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 4 }], { observacao: {} }))).ok).toBe(true)
  })
})

describe('6. item de R$ 0 pelo quilo', () => {
  it('CORRIGIDO: 0,001 kg de R$ 4,99 (R$ 0,00) é recusado', async () => {
    const r = await pedir(pedido([{ variacaoId: 'v-kg', quantidade: 0.001 }]))
    expect(r).toMatchObject({ ok: false })
  })
})

describe('7. avaliação de pedido cuja venda foi cancelada', () => {
  it('CORRIGIDO: a venda que entregou é cancelada, e a avaliação sai da vitrine', async () => {
    const r = await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 5 }]))
    const { encomendaId, acompanhamento } = r as { encomendaId: string; acompanhamento: string }
    const v = await m.venda.registrarVenda(DONO, {
      unidadeId: 'uni-a', caixaId: 'cx-a', encomendaId,
      itens: [{ variacaoId: 'v-pic', quantidade: 5 }],
      pagamentos: [{ forma: 'PIX', valor: 10 }],
    })
    expect(v.ok).toBe(true)
    expect(await m.vit.avaliarPedido('sorveteria-a', acompanhamento, { nota: 5, texto: 'otimo' })).toEqual({ ok: true })
    expect((await m.cat.lerVitrinePublica('sorveteria-a', 'centro'))!.extras.avaliacoes.total).toBe(1)
    expect((await m.venda.cancelarVenda(DONO, (v as { vendaId: string }).vendaId, 'lancei errado')).ok).toBe(true)
    const [e] = await linhas<{ situacao: string }>(`select situacao::text from encomendas where id = $1`, [encomendaId])
    expect(e!.situacao).not.toBe('ENTREGUE')
    expect((await m.cat.lerVitrinePublica('sorveteria-a', 'centro'))!.extras.avaliacoes.total).toBe(0)
  })
})

describe('8. isolamento entre empresas (verificado correto)', () => {
  it('variação de outra empresa não entra pelo catálogo desta; mesmo endereço "centro" abre a loja certa', async () => {
    const r = await pedir(pedido([{ variacaoId: 'v-b', quantidade: 1 }]))
    expect(r).toMatchObject({ ok: false, mudou: true })
    const a = await m.cat.produtosDoCatalogo('sorveteria-a', 'centro', {})
    expect(a!.produtos.some((p) => p.id === 'p-b')).toBe(false)
    const b = await m.cat.produtosDoCatalogo('loja-b', 'centro', {})
    expect(b!.produtos.map((p) => p.id)).toEqual(['p-b'])
    expect(await m.cat.produtosDoCatalogo('loja-b', 'centro', { produtoId: 'p-pic' })).toEqual({ produtos: [], mais: false, proximo: 0 })
  })
  it('quantidade negativa, zero, NaN, enorme e fracionada em UN são recusadas', async () => {
    for (const q of [-1, 0, Number.NaN, 1000, 1e9]) {
      expect((await pedir(pedido([{ variacaoId: 'v-pic', quantidade: q }]))).ok).toBe(false)
    }
    expect((await pedir(pedido([{ variacaoId: 'v-pic', quantidade: 1.5 }]))).ok).toBe(false)
  })
})
