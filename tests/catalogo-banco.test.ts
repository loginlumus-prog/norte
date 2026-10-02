// O catálogo da loja com banco de verdade: abrir, a vitrine pública, o pedido
// (preço lido do cadastro, esgotado recusado, freio) e receber no balcão — os
// itens viram linhas de verdade e baixam o estoque.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  cat: typeof import('../src/servidor/catalogo')
  venda: typeof import('../src/servidor/venda')
  banco: typeof import('../src/servidor/banco')
}

const DONO: Sessao = { orgId: 'org-c', usuarioId: 'usr-dono', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const BALCAO: Sessao = { orgId: 'org-c', usuarioId: 'usr-bal', nome: 'Caixa', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-c', expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-c', 'Sorveteria C', 'sorveteria-c', 'BALCAO', 'ATIVA', '{}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-c', 'org-c', 'Centro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dono', 'org-c', 'Dona', 'd@c.com', now()), ('usr-bal', 'org-c', 'Caixa', 'c@c.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dono', 'org-c', 'usr-dono', null, 'DONO'), ('ac-bal', 'org-c', 'usr-bal', 'uni-c', 'BALCAO');
  insert into categorias (id, org_id, nome) values ('cat-pic', 'org-c', 'Picolés');
  insert into produtos (id, org_id, nome, medida, preco_vista, categoria_id, ativo, uso_interno, atualizado_em) values
    ('p-pic', 'org-c', 'Picolé de morango', 'UN', 2.00, 'cat-pic', true, false, now()),
    ('p-esg', 'org-c', 'Picolé de uva', 'UN', 2.50, 'cat-pic', true, false, now()),
    ('p-uso', 'org-c', 'Palito', 'UN', 0.10, null, true, true, now()),
    ('p-sem', 'org-c', 'Picolé de coco', 'UN', 3.00, 'cat-pic', true, false, now()),
    ('p-sem-esg', 'org-c', 'Picolé de limão', 'UN', 3.00, 'cat-pic', true, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('v-pic', 'org-c', 'p-pic', 'PIC1', true), ('v-esg', 'org-c', 'p-esg', 'PIC2', true), ('v-uso', 'org-c', 'p-uso', 'PAL', true),
    ('v-sem', 'org-c', 'p-sem', 'PIC3', true), ('v-sem-esg', 'org-c', 'p-sem-esg', 'PIC4', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-pic', 'org-c', 'v-pic', 'uni-c', 10, now()), ('e-esg', 'org-c', 'v-esg', 'uni-c', 0, now()),
    ('e-sem', 'org-c', 'v-sem', 'uni-c', 4, now()), ('e-sem-esg', 'org-c', 'v-sem-esg', 'uni-c', 0, now());
  -- Morango, uva e palito com foto; coco e limão sem (aparecem com o ícone).
  insert into midias (id, org_id, nome, mime, tipo, tamanho, sha256, dados) values
    ('mid-1', 'org-c', 'foto', 'image/webp', 'imagem', 4, 'sha-1', decode('52494646', 'hex'));
  update produtos set foto_id = 'mid-1' where id in ('p-pic', 'p-esg', 'p-uso');
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-c', 'org-c', 'uni-c', 'Caixa', 0);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.SEGREDO_SESSAO ??= 'x'.repeat(40)
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 44000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    cat: await import('../src/servidor/catalogo'),
    venda: await import('../src/servidor/venda'),
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
const saldo = async (id: string) => Number((await linhas<{ q: string }>(`select quantidade q from estoque where id = $1`, [id]))[0]!.q)

const AJUSTES = {
  ativo: true,
  endereco: 'centro',
  whatsapp: '(71) 99999-0000',
  recado: null,
  retirada: true,
  entrega: true,
  taxaEntrega: 5,
  pedidoMinimo: null,
  chavePix: 'pix@sorveteria.com',
  mostrarEsgotado: false,
}
const pedido = (extra: Partial<import('../src/servidor/catalogo').PedidoDoCatalogo> = {}) => ({
  nome: 'Ana Souza',
  telefone: '(71) 98888-7777',
  entrega: false,
  forma: 'PIX' as const,
  itens: [{ variacaoId: 'v-pic', quantidade: 3 }],
  ...extra,
})

let token = ''
let encomendaId = ''

describe('abrir o catálogo', () => {
  it('quem vende não abre; a dona abre, e as encomendas ligam junto', async () => {
    await expect(m.cat.salvarCatalogo(BALCAO, 'uni-c', AJUSTES)).rejects.toThrow()
    const r = await m.cat.salvarCatalogo(DONO, 'uni-c', AJUSTES)
    expect(r).toEqual({ ok: true, endereco: 'centro' })
    const [o] = await linhas<{ modulos: string[] }>(`select modulos from orgs where id = 'org-c'`)
    expect(o!.modulos).toContain('encomenda')
    const [c] = await linhas<{ whatsapp: string }>(`select whatsapp from catalogos where unidade_id = 'uni-c'`)
    expect(c!.whatsapp).toBe('5571999990000')
  })
})

describe('a vitrine pública', () => {
  it('mostra o que tem, com categoria; esconde esgotado e material de uso', async () => {
    const v = await m.cat.lerVitrinePublica('sorveteria-c', 'centro')
    expect(v?.loja.nome).toBe('Centro')
    expect(v?.categorias.map((c) => c.nome)).toEqual(['Picolés'])
    const p = await m.cat.produtosDoCatalogo('sorveteria-c', 'centro', {})
    // o coco não tem foto e aparece do mesmo jeito (com o ícone, na tela)
    expect(p?.produtos.map((x) => x.nome)).toEqual(['Picolé de coco', 'Picolé de morango'])
    // nada de saldo exato nem custo no que sai
    expect(JSON.stringify(p)).not.toMatch(/custo|quantidade|saldo/)
  })
  it('link errado ou empresa errada não abre', async () => {
    expect(await m.cat.lerVitrinePublica('sorveteria-c', 'outra')).toBeNull()
    expect(await m.cat.lerVitrinePublica('nao-existe', 'centro')).toBeNull()
  })
})

describe('produto sem foto continua no catálogo', () => {
  it('aparece na lista e na contagem das categorias, sem foto', async () => {
    const v = await m.cat.lerVitrinePublica('sorveteria-c', 'centro')
    // morango, uva, coco e limão (esgotado conta na categoria; a lista é que o esconde)
    expect(v?.categorias).toEqual([{ id: 'cat-pic', nome: 'Picolés', total: 4 }])
    const p = await m.cat.produtosDoCatalogo('sorveteria-c', 'centro', { busca: 'coco' })
    expect(p?.produtos).toMatchObject([{ nome: 'Picolé de coco', foto: null, disponivel: true }])
  })

  it('o pedido com produto sem foto passa', async () => {
    const r = await m.cat.fazerPedidoPeloCatalogo('sorveteria-c', 'centro', pedido({ itens: [{ variacaoId: 'v-sem', quantidade: 1 }], telefone: '71955554444' }), '10.0.0.5', '')
    expect(r.ok).toBe(true)
    expect(r.ok && r.totalC).toBe(300)
  })

  it('a tela do catálogo conta quem aparece e lista quem está sem foto (com a régua do estoque)', async () => {
    const { lojas } = await m.cat.listarCatalogos(DONO)
    const l = lojas.find((x) => x.unidadeId === 'uni-c')!
    // morango (com foto) e coco (sem): uva e limão estão esgotados e a loja esconde o esgotado
    expect(l.aparecendo).toBe(2)
    expect(l.semFoto).toEqual({ total: 1, mais: false, produtos: [{ id: 'p-sem', nome: 'Picolé de coco', preco: 3, estoque: 4 }] })
    expect(await m.cat.fotosQueFaltam(DONO, 'uni-c', 0)).toEqual(l.semFoto)
  })

  it('com a foto, o produto sai da lista "sem foto" e a vitrine mostra a foto', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4])
    expect((await m.cat.guardarFotoDoProduto(DONO, 'p-sem', jpeg)).ok).toBe(true)
    const { lojas } = await m.cat.listarCatalogos(DONO)
    const l = lojas.find((x) => x.unidadeId === 'uni-c')!
    expect(l.aparecendo).toBe(2)
    expect(l.semFoto.total).toBe(0)
    const p = await m.cat.produtosDoCatalogo('sorveteria-c', 'centro', {})
    expect(p?.produtos.map((x) => x.nome)).toEqual(['Picolé de coco', 'Picolé de morango'])
    expect(p?.produtos.every((x) => x.foto?.startsWith('/sorveteria-c/foto/'))).toBe(true)
  })
})

describe('o pedido', () => {
  it('grava a encomenda com os itens e o preço do cadastro', async () => {
    const r = await m.cat.fazerPedidoPeloCatalogo('sorveteria-c', 'centro', pedido(), '10.0.0.1', 'https://norte.test')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.totalC).toBe(600)
    expect(r.whatsapp).toBe('5571999990000')
    expect(r.mensagem).toContain(`https://norte.test/sorveteria-c/pedido/${r.acompanhamento}`)
    token = r.acompanhamento
    encomendaId = r.encomendaId!
    const [e] = await linhas<{ origem: string; valor: string; telefone: string; quem: string }>(
      `select origem::text, valor, telefone, quem from encomendas where id = $1`,
      [encomendaId],
    )
    expect(e).toMatchObject({ origem: 'CATALOGO', telefone: '71988887777', quem: 'Catálogo' })
    expect(Number(e!.valor)).toBe(6)
    const itens = await linhas<{ variacao_id: string; preco_unit: string }>(`select variacao_id, preco_unit from encomenda_itens where encomenda_id = $1`, [encomendaId])
    expect(itens).toHaveLength(1)
    expect(Number(itens[0]!.preco_unit)).toBe(2)
  })

  it('item esgotado ou de uso interno é recusado, e a página sabe que mudou', async () => {
    const r = await m.cat.fazerPedidoPeloCatalogo('sorveteria-c', 'centro', pedido({ itens: [{ variacaoId: 'v-esg', quantidade: 1 }] }), '10.0.0.2', '')
    expect(r).toMatchObject({ ok: false, mudou: true })
    const u = await m.cat.fazerPedidoPeloCatalogo('sorveteria-c', 'centro', pedido({ itens: [{ variacaoId: 'v-uso', quantidade: 1 }] }), '10.0.0.2', '')
    expect(u.ok).toBe(false)
  })

  it('entrega soma a taxa', async () => {
    const r = await m.cat.fazerPedidoPeloCatalogo(
      'sorveteria-c',
      'centro',
      pedido({ entrega: true, endereco: 'Rua das Flores, 10 — Centro', telefone: '71977776666' }),
      '10.0.0.3',
      '',
    )
    expect(r.ok && r.totalC).toBe(1100)
  })

  it('acompanhar mostra só o primeiro nome e a situação', async () => {
    const a = await m.cat.acompanharPedido('sorveteria-c', token)
    expect(a?.primeiroNome).toBe('Ana')
    expect(a?.situacao.titulo).toBe('Pedido enviado')
    expect(a?.chavePix).toBe('pix@sorveteria.com')
    expect(JSON.stringify(a)).not.toContain('98888')
    expect(await m.cat.acompanharPedido('outra-empresa', token)).toBeNull()
  })
})

describe('receber no balcão', () => {
  it('sem os produtos no pedido, a encomenda do catálogo não sai', async () => {
    const r = await m.venda.registrarVenda(BALCAO, {
      unidadeId: 'uni-c',
      caixaId: 'cx-c',
      encomendaId,
      itens: [],
      pagamentos: [{ forma: 'PIX', valor: 6 }],
    })
    expect(r).toMatchObject({ ok: false, motivo: 'encomenda_recusada' })
  })

  it('com os produtos: baixa o estoque e a encomenda sai entregue', async () => {
    const r = await m.venda.registrarVenda(BALCAO, {
      unidadeId: 'uni-c',
      caixaId: 'cx-c',
      encomendaId,
      itens: [{ variacaoId: 'v-pic', quantidade: 3 }],
      pagamentos: [{ forma: 'PIX', valor: 6 }],
    })
    expect(r.ok).toBe(true)
    expect(await saldo('e-pic')).toBe(7)
    const [e] = await linhas<{ situacao: string }>(`select situacao::text from encomendas where id = $1`, [encomendaId])
    expect(e!.situacao).toBe('ENTREGUE')
    const a = await m.cat.acompanharPedido('sorveteria-c', token)
    expect(a?.situacao.passo).toBe(3)
  })
})

describe('o freio', () => {
  it('o mesmo aparelho não manda pedido sem fim', async () => {
    const r: boolean[] = []
    for (let i = 0; i < 7; i++) {
      const x = await m.cat.fazerPedidoPeloCatalogo('sorveteria-c', 'centro', pedido({ telefone: `7196666000${i}` }), '10.9.9.9', '')
      r.push(x.ok)
    }
    expect(r.slice(0, 6).every(Boolean)).toBe(true)
    expect(r[6]).toBe(false)
  })
})

describe('fechar', () => {
  it('fechado, o link deixa de abrir', async () => {
    await m.cat.salvarCatalogo(DONO, 'uni-c', { ...AJUSTES, ativo: false })
    expect(await m.cat.lerVitrinePublica('sorveteria-c', 'centro')).toBeNull()
    const r = await m.cat.fazerPedidoPeloCatalogo('sorveteria-c', 'centro', pedido(), '10.0.0.8', '')
    expect(r.ok).toBe(false)
  })
})
