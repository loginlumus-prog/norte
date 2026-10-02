// A venda que não duplica e a venda feita sem internet, com banco de verdade.
//
// A chave é gerada pelo balcão antes de mandar: a mesma venda mandada duas
// vezes (a rede caiu, a fila subiu de novo) volta como a primeira. A venda
// da fila de quando estava sem internet grava com a hora de verdade, não
// trava por estoque (a peça já saiu) e entra no caixa aberto se o turno dela
// fechou — mas desconto acima do teto continua pedindo autorização.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: { venda: typeof import('../src/servidor/venda'); banco: typeof import('../src/servidor/banco') }

const BALCAO: Sessao = { orgId: 'org-o', usuarioId: 'usr-bal', nome: 'Caixa', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-o', expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, atualizada_em, configurada_em) values
    ('org-o', 'Loja O', 'loja-o', 'BALCAO', 'ATIVA', '{}', 10, now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-o', 'org-o', 'Centro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-bal', 'org-o', 'Caixa', 'c@o.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-bal', 'org-o', 'usr-bal', 'uni-o', 'BALCAO');
  insert into produtos (id, org_id, nome, medida, preco_vista, ativo, atualizado_em) values
    ('p-pic', 'org-o', 'Picolé', 'UN', 2.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('v-pic', 'org-o', 'p-pic', 'PIC001', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values ('e-pic', 'org-o', 'v-pic', 'uni-o', 3, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura, aberto_em) values ('cx-1', 'org-o', 'uni-o', 'Caixa', 50, now() - interval '3 hours');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 41000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = { venda: await import('../src/servidor/venda'), banco: await import('../src/servidor/banco') }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const saldo = async () => Number((await linhas<{ q: string }>(`select quantidade q from estoque where id = 'e-pic'`))[0]!.q)

const pedido = (qtd: number, extra: Partial<Parameters<typeof import('../src/servidor/venda').registrarVenda>[1]> = {}) => ({
  unidadeId: 'uni-o',
  caixaId: 'cx-1',
  itens: [{ variacaoId: 'v-pic', quantidade: qtd }],
  pagamentos: [{ forma: 'DINHEIRO' as const, valor: 2 * qtd }],
  ...extra,
})

describe('a mesma venda mandada duas vezes', () => {
  it('a segunda volta como a primeira, sem gravar outra nem baixar estoque de novo', async () => {
    const a = await m.venda.registrarVenda(BALCAO, pedido(1, { chave: 'chave-aaaa-0001' }))
    const b = await m.venda.registrarVenda(BALCAO, pedido(1, { chave: 'chave-aaaa-0001' }))
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(b.vendaId).toBe(a.vendaId)
      expect(b.numero).toBe(a.numero)
    }
    expect((await linhas<{ n: number }>(`select count(*)::int n from vendas where chave = 'chave-aaaa-0001'`))[0]!.n).toBe(1)
    expect(await saldo()).toBe(2)
  })

  it('chave estranha é ignorada (a venda entra, sem chave)', async () => {
    const r = await m.venda.registrarVenda(BALCAO, pedido(1, { chave: "x'; drop table vendas; --" }))
    expect(r.ok).toBe(true)
    expect(await saldo()).toBe(1)
  })
})

describe('a venda que subiu da fila de sem internet', () => {
  it('online, faltar estoque trava; sem internet, passa e o saldo fica negativo', async () => {
    const online = await m.venda.registrarVenda(BALCAO, pedido(5, { chave: 'chave-bbbb-0002' }))
    expect(online).toMatchObject({ ok: false, motivo: 'sem_estoque' })
    const quando = new Date(Date.now() - 40 * 60_000)
    const off = await m.venda.registrarVenda(BALCAO, pedido(5, { chave: 'chave-bbbb-0002', offline: { quando } }))
    expect(off.ok).toBe(true)
    expect(await saldo()).toBe(-4)
    // grava com a hora de verdade da venda
    // Lida como o sistema lê (Prisma, em UTC), e não pela leitura crua do teste.
    const lida = await m.banco.comoOrg('org-o', (tx) => tx.venda.findFirst({ where: { chave: 'chave-bbbb-0002' }, select: { criadaEm: true } }))
    expect(Math.abs(lida!.criadaEm.getTime() - quando.getTime())).toBeLessThan(2000)
  })

  it('o turno dela fechou: entra no caixa aberto da loja', async () => {
    await db.exec(`update caixas set aberto = false, fechado_em = now(), fechado_por = 'Caixa', saldo_contado = 50 where id = 'cx-1';
                   insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-2', 'org-o', 'uni-o', 'Caixa', 0);
                   update estoque set quantidade = 100 where id = 'e-pic';`)
    const online = await m.venda.registrarVenda(BALCAO, pedido(1, { chave: 'chave-cccc-0003' }))
    expect(online).toMatchObject({ ok: false, motivo: 'caixa_fechado' })
    const off = await m.venda.registrarVenda(BALCAO, pedido(1, { chave: 'chave-cccc-0003', offline: { quando: new Date(Date.now() - 60_000) } }))
    expect(off.ok).toBe(true)
    const [v] = await linhas<{ caixa_id: string }>(`select caixa_id from vendas where chave = 'chave-cccc-0003'`)
    expect(v!.caixa_id).toBe('cx-2')
  })

  it('sem internet não é atalho: desconto acima do teto continua pedindo autorização', async () => {
    const r = await m.venda.registrarVenda(BALCAO, {
      ...pedido(1, { chave: 'chave-dddd-0004', offline: { quando: new Date() } }),
      caixaId: 'cx-2',
      desconto: 1,
      pagamentos: [{ forma: 'DINHEIRO', valor: 1 }],
    })
    expect(r).toMatchObject({ ok: false, motivo: 'desconto_acima_do_teto' })
  })

  it('a hora do aparelho não vai para antes do turno aberto; a venda fica marcada no livro como sem internet', async () => {
    // cx-2 abriu agora há pouco: a venda "de dois dias atrás" entra com a hora de abertura dele.
    // Lida pelo Prisma (UTC), como a venda lê — não pela leitura crua do teste.
    const cx = await m.banco.comoOrg('org-o', (tx) => tx.caixa.findUnique({ where: { id: 'cx-2' }, select: { abertoEm: true } }))
    const r = await m.venda.registrarVenda(BALCAO, { ...pedido(1, { chave: 'chave-ffff-0006', offline: { quando: new Date(Date.now() - 2 * 864e5) } }), caixaId: 'cx-2' })
    expect(r.ok).toBe(true)
    const lida = await m.banco.comoOrg('org-o', (tx) => tx.venda.findFirst({ where: { chave: 'chave-ffff-0006' }, select: { id: true, criadaEm: true } }))
    expect(Math.abs(lida!.criadaEm.getTime() - cx!.abertoEm.getTime())).toBeLessThan(2000)
    const [aud] = await linhas<{ motivo: string; depois: { semInternet?: { horaDoAparelho: string } } }>(
      `select motivo, depois from auditoria where acao = 'venda.registrou' and alvo_id = $1`, [lida!.id],
    )
    expect(aud!.motivo).toMatch(/sem internet/)
    expect(aud!.depois.semInternet?.horaDoAparelho).toBeTruthy()
  })

  it('hora de mais de 7 dias não vale como sem internet', async () => {
    const r = await m.venda.registrarVenda(BALCAO, { ...pedido(500, { chave: 'chave-eeee-0005', offline: { quando: new Date(Date.now() - 8 * 864e5) } }), caixaId: 'cx-2' })
    expect(r).toMatchObject({ ok: false, motivo: 'sem_estoque' })
  })
})
