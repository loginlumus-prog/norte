// O que sai do estoque sem venda, e quem assina. Banco de verdade (PGlite).
//
//   • consumo interno só de MATERIAL DE USO, com cada item no livro, e com
//     o PIN quando a empresa assina as exceções;
//   • a vendedora que mexe no estoque porque a empresa deixou assina a
//     transferência e o "já conferi";
//   • a conferência histórico × saldo obedece às lojas pedidas.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  estoque: typeof import('../src/servidor/estoque')
  compras: typeof import('../src/servidor/compras')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-c', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const GER_A: Sessao = { orgId: 'org-c', usuarioId: 'usr-ger', nome: 'Gerente A', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-a', expiraEm: null }] }
const VENDEDORA: Sessao = {
  orgId: 'org-c', usuarioId: 'usr-vend', nome: 'Vendedora',
  acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a', expiraEm: null }],
  balcaoAmpliado: true,
}

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-c', 'Salão C', 'salao-c', 'REDE', 'ATIVA', '{multiUnidade,compras}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a', 'org-c', 'Loja A', now()),
    ('uni-b', 'org-c', 'Loja B', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-c', 'Dona', 'd@c.com', now()),
    ('usr-ger', 'org-c', 'Gerente A', 'g@c.com', now()),
    ('usr-vend', 'org-c', 'Vendedora', 'v@c.com', now());
  insert into produtos (id, org_id, nome, medida, preco_vista, uso_interno, atualizado_em) values
    ('p-luva', 'org-c', 'Luva', 'UN', 1, true, now()),
    ('p-blusa', 'org-c', 'Blusa', 'UN', 80, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-luva', 'org-c', 'p-luva', 'LUV1', true),
    ('v-blusa', 'org-c', 'p-blusa', 'BLU1', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-luva', 'org-c', 'v-luva', 'uni-a', 100, now()),
    ('e-blusa', 'org-c', 'v-blusa', 'uni-a', 10, now()),
    ('e-blusa-b', 'org-c', 'v-blusa', 'uni-b', 7, now());
  insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, quem) values
    ('m-luva', 'org-c', 'v-luva', 'uni-a', 'ENTRADA', 100, 100, 'Dona'),
    ('m-blusa', 'org-c', 'v-blusa', 'uni-a', 'ENTRADA', 10, 10, 'Dona');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 56000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    estoque: await import('../src/servidor/estoque'),
    compras: await import('../src/servidor/compras'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const um = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!
const saldo = async (v: string, u: string) =>
  Number((await um<{ q: string }>(`select coalesce((select quantidade from estoque where variacao_id = $1 and unidade_id = $2), 0) q`, [v, u])).q)

describe('consumo interno', () => {
  it('mercadoria da vitrine não sai como consumo — é perda, com motivo, na tela de Estoque', async () => {
    const r = await m.compras.registrarConsumo(GER_A, { unidadeId: 'uni-a', itens: [{ variacaoId: 'v-blusa', quantidade: 1 }] })
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.erro).toMatch(/não é material de uso/)
    expect(await saldo('v-blusa', 'uni-a')).toBe(10)
  })

  it('a busca do consumo só oferece material de uso', async () => {
    const achados = await m.compras.buscarParaConsumo(GER_A, 'uni-a', 'lu')
    expect(achados.map((a) => a.variacaoId)).toEqual(['v-luva'])
    expect(await m.compras.buscarParaConsumo(GER_A, 'uni-a', 'blusa')).toEqual([])
  })

  it('material de uso sai, e o livro diz o que e quanto', async () => {
    const r = await m.compras.registrarConsumo(GER_A, { unidadeId: 'uni-a', itens: [{ variacaoId: 'v-luva', quantidade: 20 }], motivo: 'atendimentos' })
    expect(r).toEqual({ ok: true, itens: 1 })
    expect(await saldo('v-luva', 'uni-a')).toBe(80)
    const l = await um<{ depois: { linhas: { variacaoId: string; quantidade: number }[] } }>(
      `select depois from auditoria where acao = 'estoque.consumo' order by criado_em desc limit 1`,
    )
    expect(l.depois.linhas).toMatchObject([{ variacaoId: 'v-luva', quantidade: 20 }])
  })

  it('com o PIN nas exceções ligado, o consumo pede a assinatura', async () => {
    await db.exec(`update orgs set pin_nas_excecoes = true where id = 'org-c'`)
    const r = await m.compras.registrarConsumo(GER_A, { unidadeId: 'uni-a', itens: [{ variacaoId: 'v-luva', quantidade: 1 }] })
    expect(r).toMatchObject({ ok: false, precisaPin: true })
    expect(await saldo('v-luva', 'uni-a')).toBe(80)
    await db.exec(`update orgs set pin_nas_excecoes = false where id = 'org-c'`)
  })
})

describe('a vendedora que mexe no estoque porque a empresa deixou', () => {
  it('transfere só com o PIN', async () => {
    // Ela alcança a loja A; para a B a dona dá o mesmo extra.
    const vendAB: Sessao = { ...VENDEDORA, acessos: [...VENDEDORA.acessos, { papel: 'BALCAO', unidadeId: 'uni-b', expiraEm: null }] }
    const r = await m.estoque.transferir(vendAB, { variacaoId: 'v-blusa', deUnidadeId: 'uni-a', paraUnidadeId: 'uni-b', quantidade: 1 })
    expect(r).toMatchObject({ ok: false, motivo: 'assinatura' })
    expect(await saldo('v-blusa', 'uni-a')).toBe(10)
  })

  it('a gerente transfere sem PIN (transferir não é exceção)', async () => {
    const dona = await m.estoque.transferir(DONA, { variacaoId: 'v-blusa', deUnidadeId: 'uni-a', paraUnidadeId: 'uni-b', quantidade: 1 })
    expect(dona).toMatchObject({ ok: true, saldoOrigem: 9, saldoDestino: 8 })
  })

  it('quantidade absurda numa transferência é recusada', async () => {
    const r = await m.estoque.transferir(DONA, { variacaoId: 'v-blusa', deUnidadeId: 'uni-a', paraUnidadeId: 'uni-b', quantidade: 5_000_000 })
    expect(r).toMatchObject({ ok: false, motivo: 'quantidade' })
  })
})

describe('histórico × saldo', () => {
  it('confere só as lojas pedidas; a loja que o gerente não vê sai da conta', async () => {
    // A linha da loja B foi semeada sem movimento: diverge.
    expect((await m.estoque.conferirSaldos(DONA)).map((d) => d.unidade_id)).toContain('uni-b')
    expect(await m.estoque.conferirSaldos(DONA, ['uni-a'])).toEqual([])
    expect(await m.estoque.conferirSaldos(GER_A, ['uni-a', 'uni-b'])).toEqual([])
    // A empresa inteira (sem lojas) é de quem vê todas.
    await expect(m.estoque.conferirSaldos(GER_A)).rejects.toThrow()
  })
})
