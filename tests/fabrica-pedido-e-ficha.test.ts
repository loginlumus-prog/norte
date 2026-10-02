// O pedido da loja à fábrica e a ficha técnica: quem pode, e para onde.
// Banco de verdade (PGlite com RLS).
//
//   • com duas fábricas, o pedido sem fábrica escolhida é recusado (antes ia
//     para a mais antiga);
//   • a gerente presa à loja dela enxerga as fábricas para onde pedir;
//   • a ficha técnica é de quem edita produto na fábrica ou pela empresa;
//   • a vendedora que mexe no estoque porque a empresa deixou assina o pedido.

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

const sessao = (usuarioId: string, acessos: { papel: Papel; unidadeId: string | null; capacidades?: string[] }[], balcaoAmpliado = false): Sessao => ({
  orgId: 'org-f2',
  usuarioId,
  nome: usuarioId,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
  balcaoAmpliado,
})
const DONO = sessao('usr-dono', [{ papel: 'DONO', unidadeId: null }])
const GER_LOJA = sessao('usr-ger', [{ papel: 'GERENTE', unidadeId: 'uni-loja' }])
const PRODUCAO = sessao('usr-prod', [
  { papel: 'CARGO', unidadeId: 'uni-fab1', capacidades: ['estoque.ver', 'estoque.ajustar', 'produto.ver', 'produto.editar'] },
])
const VENDEDORA = sessao('usr-vend', [{ papel: 'BALCAO', unidadeId: 'uni-loja' }], true)

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-f2', 'Gelados F2', 'gelados-f2', 'REDE', 'ATIVA', '{multiUnidade,fabrica}', now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, eh_fabrica, criada_em, atualizada_em) values
    ('uni-fab1', 'org-f2', 'Fábrica Norte', true, true, now() - interval '2 days', now()),
    ('uni-fab2', 'org-f2', 'Fábrica Sul', true, true, now() - interval '1 day', now()),
    ('uni-loja', 'org-f2', 'Loja', false, false, now(), now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dono', 'org-f2', 'Dono', 'dono@f2.com', now()),
    ('usr-ger', 'org-f2', 'Gerente', 'ger@f2.com', now()),
    ('usr-prod', 'org-f2', 'Produção', 'prod@f2.com', now()),
    ('usr-vend', 'org-f2', 'Vendedora', 'vend@f2.com', now());
  insert into produtos (id, org_id, nome, medida, preco_vista, uso_interno, vendido_em, atualizado_em) values
    ('p-pic', 'org-f2', 'Picolé', 'UN', 5, false, '{}', now()),
    ('p-lei', 'org-f2', 'Leite', 'L', 1, true, '{}', now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-pic', 'org-f2', 'p-pic', 'PIC', true),
    ('v-lei', 'org-f2', 'p-lei', 'LEI', true);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 59000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    fabrica: await import('../src/servidor/fabrica'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

describe('para qual fábrica', () => {
  it('a gerente da loja vê as duas fábricas para onde pedir, mesmo sem ver o estoque delas', async () => {
    const vistas = await m.fabrica.unidadesDaFabrica(GER_LOJA)
    expect(vistas.filter((u) => u.ehFabrica)).toEqual([])
    const destinos = await m.fabrica.fabricasParaPedir(GER_LOJA)
    expect(destinos.map((f) => f.nome)).toEqual(['Fábrica Norte', 'Fábrica Sul'])
  })

  it('com duas fábricas, o pedido sem fábrica escolhida é recusado; com a escolha, vai para ela', async () => {
    const itens = [{ variacaoId: 'v-pic', quantidade: 10 }]
    await expect(m.fabrica.criarPedido(GER_LOJA, { lojaId: 'uni-loja', itens })).rejects.toThrow(/Escolha para qual fábrica/)
    const p = await m.fabrica.criarPedido(GER_LOJA, { lojaId: 'uni-loja', fabricaId: 'uni-fab2', itens })
    const [lido] = (await db.query<{ fabrica_id: string }>(`select fabrica_id from pedidos_fabrica where id = $1`, [p.id])).rows
    expect(lido!.fabrica_id).toBe('uni-fab2')
  })

  it('a vendedora que pede porque a empresa deixou assina com o PIN', async () => {
    await expect(
      m.fabrica.criarPedido(VENDEDORA, { lojaId: 'uni-loja', fabricaId: 'uni-fab1', itens: [{ variacaoId: 'v-pic', quantidade: 1 }] }),
    ).rejects.toBeInstanceOf(m.fabrica.FabricaPedePin)
  })
})

describe('a ficha técnica', () => {
  const ficha = { variacaoId: 'v-pic', rendimento: 10, validadeDias: 30, itens: [{ insumoId: 'v-lei', quantidade: 1 }] }

  it('o gerente de uma loja não escreve a receita (ela decide o custo da rede)', async () => {
    await expect(m.fabrica.salvarReceita(GER_LOJA, ficha)).rejects.toThrow()
  })

  it('quem edita produto NA fábrica escreve; e apaga', async () => {
    const r = await m.fabrica.salvarReceita(PRODUCAO, ficha)
    expect(r.id).toBeTruthy()
    await expect(m.fabrica.apagarReceita(GER_LOJA, r.id)).rejects.toThrow()
    await m.fabrica.apagarReceita(PRODUCAO, r.id)
    expect((await db.query(`select id from receitas`)).rows).toHaveLength(0)
  })
})
