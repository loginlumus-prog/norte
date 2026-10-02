// O produto e as lojas: quem edita o quê, e o que não pode ficar preso numa
// loja que deixa de vender. Banco de verdade (PGlite com RLS).
//
//   • o gerente de uma loja não mexe na ficha do produto que só OUTRA loja
//     vende (nem no nome) — `produto.editar` sem loja deixava;
//   • tirar uma loja do "Vendido em" com saldo nela é recusado, com o saldo
//     a transferir na frase;
//   • o custo digitado na ficha vale para o produto inteiro: o custo próprio
//     das variações sai.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  produto: typeof import('../src/servidor/produto')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-p', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const GER_ROUPA: Sessao = { orgId: 'org-p', usuarioId: 'usr-ger', nome: 'Gerente', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-roupa', expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-p', 'Loja P', 'loja-p', 'REDE', 'ATIVA', '{multiUnidade}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-roupa', 'org-p', 'Roupa', now()),
    ('uni-sorvete', 'org-p', 'Sorveteria', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-p', 'Dona', 'd@p.com', now()),
    ('usr-ger', 'org-p', 'Gerente', 'g@p.com', now());
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, vendido_em, atualizado_em) values
    ('p-picole', 'org-p', 'Picolé', 'UN', 5, 1, '{uni-sorvete}', now()),
    ('p-blusa', 'org-p', 'Blusa', 'UN', 80, 30, '{uni-roupa}', now()),
    ('p-meia', 'org-p', 'Meia', 'UN', 10, 3, '{}', now()),
    ('p-bone', 'org-p', 'Boné', 'UN', 40, 15, '{uni-roupa,uni-sorvete}', now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao, custo) values
    ('v-picole', 'org-p', 'p-picole', 'PIC1', true, null),
    ('v-blusa', 'org-p', 'p-blusa', 'BLU1', true, null),
    ('v-meia', 'org-p', 'p-meia', 'MEI1', true, null),
    ('v-bone-p', 'org-p', 'p-bone', 'BON-P', false, 14),
    ('v-bone-g', 'org-p', 'p-bone', 'BON-G', false, 16);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-bone', 'org-p', 'v-bone-g', 'uni-sorvete', 3, now());
  insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, quem) values
    ('m-bone', 'org-p', 'v-bone-g', 'uni-sorvete', 'ENTRADA', 3, 3, 'Dona');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 53000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    produto: await import('../src/servidor/produto'),
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

describe('quem edita a ficha', () => {
  it('o gerente da loja de roupa não renomeia o picolé que só a sorveteria vende', async () => {
    const r = await m.produto.editarProduto(GER_ROUPA, 'p-picole', { nome: 'Picolé de limão', descricao: 'mudou' })
    expect(r).toEqual({ ok: false, motivo: m.produto.MOTIVO_DE_OUTRA_LOJA })
    expect((await um<{ nome: string }>(`select nome from produtos where id = 'p-picole'`)).nome).toBe('Picolé')
  })

  it('nem o produto de todas as lojas (vazio inclui as que abrirem): esse é de quem responde pela empresa', async () => {
    const r = await m.produto.editarProduto(GER_ROUPA, 'p-meia', { nome: 'Meia soquete' })
    expect(r.ok).toBe(false)
  })

  it('o produto da loja dele, ele edita', async () => {
    const r = await m.produto.editarProduto(GER_ROUPA, 'p-blusa', { nome: 'Blusa de linho' })
    expect(r.ok).toBe(true)
  })
})

describe('"Vendido em" e o saldo', () => {
  it('tirar a sorveteria do boné com 3 lá é recusado, e a frase diz onde está o saldo', async () => {
    const r = await m.produto.editarProduto(DONA, 'p-bone', { vendidoEm: ['uni-roupa'] })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toMatch(/Sorveteria/)
    expect(!r.ok && r.motivo).toMatch(/Transfira/)
    expect((await um<{ v: string[] }>(`select vendido_em v from produtos where id = 'p-bone'`)).v).toEqual(['uni-roupa', 'uni-sorvete'])
  })

  it('tirar a loja que não tem saldo passa', async () => {
    const r = await m.produto.editarProduto(DONA, 'p-bone', { vendidoEm: ['uni-sorvete'] })
    expect(r.ok).toBe(true)
  })

  it('"todas" para uma loja só também confere o saldo das que saem', async () => {
    await db.exec(`
      insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values ('e-meia', 'org-p', 'v-meia', 'uni-sorvete', 2, now());
      insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, quem) values ('m-meia', 'org-p', 'v-meia', 'uni-sorvete', 'ENTRADA', 2, 2, 'Dona');
    `)
    const r = await m.produto.editarProduto(DONA, 'p-meia', { vendidoEm: ['uni-roupa'] })
    expect(r.ok).toBe(false)
  })
})

describe('o custo da ficha', () => {
  it('custo com quatro casas, e o digitado na ficha tira o custo próprio das variações', async () => {
    const r = await m.produto.editarProduto(DONA, 'p-bone', { custo: 15.1234 })
    expect(r.ok).toBe(true)
    expect(Number((await um<{ c: string }>(`select custo c from produtos where id = 'p-bone'`)).c)).toBe(15.1234)
    expect(Number((await um<{ n: string }>(`select count(*) n from variacoes where produto_id = 'p-bone' and custo is not null`)).n)).toBe(0)
  })

  it('o mesmo custo de novo não é mudança (não escreve "alterou o preço" no livro)', async () => {
    const antes = Number((await um<{ n: string }>(`select count(*) n from auditoria where alvo_id = 'p-bone' and acao = 'produto.preco.alterou'`)).n)
    await m.produto.editarProduto(DONA, 'p-bone', { custo: 15.1234, nome: 'Boné' })
    const depois = Number((await um<{ n: string }>(`select count(*) n from auditoria where alvo_id = 'p-bone' and acao = 'produto.preco.alterou'`)).n)
    expect(depois).toBe(antes)
  })
})
