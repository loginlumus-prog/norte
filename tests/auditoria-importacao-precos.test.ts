// AUDITORIA (lógica de negócio) — importação de produtos.
//
// Com banco de verdade (PGlite + comoOrg + RLS):
//   1. (corrigido) reimportar com preço NOVO ("atualizar") leva junto o preço
//      do cartão e o do crediário — antes ficavam no valor antigo, e o balcão
//      vendia no crediário MAIS BARATO que à vista;
//   2. (corrigido) a segunda loja: a planilha da loja B com "Pular o que já
//      existe" (o padrão da tela) lança o estoque da loja B do que a loja A
//      já trouxe — e o produto, que nasceu só na A, passa a ser vendido na B;
//   3. (puro) célula numérica do Excel perde o zero à esquerda do código e do
//      EAN sem aviso; preço "1,299" (milhar em inglês) vira R$ 1,30.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'
import type { ItemImportado } from '../src/servidor/importacao-planilha'
import { lerCodigo, lerEan, montarItens } from '../src/servidor/importacao-planilha'
import { precoNaTabela } from '../src/servidor/preco'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  importacao: typeof import('../src/servidor/importacao')
  venda: typeof import('../src/servidor/venda')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-aud', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, crediario_max_parcelas, credito_max_parcelas, atualizada_em, configurada_em) values
    ('org-aud', 'Loja Aud', 'loja-aud', 'REDE', 'ATIVA', '{crediario,multiUnidade}', 12, 12, now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a', 'org-aud', 'Loja A', now()),
    ('uni-b', 'org-aud', 'Loja B', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-aud', 'Dona', 'dona@aud.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-aud', 'usr-dona', null, 'DONO');
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a', 'org-aud', 'uni-a', 'Dona', 0);
  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-aud', 'Cliente Um', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 41000 + Math.floor(Math.random() * 2500)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    importacao: await import('../src/servidor/importacao'),
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

const um = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!

const item = (x: Partial<ItemImportado> & Pick<ItemImportado, 'linha' | 'nome' | 'precoVista'>): ItemImportado => ({
  codigo: null, codigoBarras: null, categoria: null, marca: null, medida: 'UN', precoCartao: null, custo: null, estoque: null, variacoes: [],
  ...x,
})

const precos = () =>
  um<{ vista: string; cartao: string; crediario: string }>(
    `select p.preco_vista vista, p.preco_cartao cartao, p.preco_crediario crediario
       from produtos p join variacoes v on v.produto_id = p.id where v.codigo = 'BV01'`,
  )

describe('1. reimportar com preço novo leva cartão e crediário junto', () => {
  it('à vista sobe para 120, e crediário e cartão sobem junto — o balcão não vende mais a 100', async () => {
    // Primeira importação (sem coluna de preço no cartão — o caso comum).
    const r1 = await m.importacao.importarLote(DONA, {
      unidadeId: 'uni-a', seJaExiste: 'pular',
      itens: [item({ linha: 2, nome: 'Blusa Viscose', codigo: 'BV01', precoVista: 100, estoque: 10 })],
    })
    expect(r1).toMatchObject({ ok: true, criados: 1 })
    expect(await precos()).toEqual({ vista: '100.00', cartao: '100.00', crediario: '100.00' })
    // Nasceu vendido só na loja da planilha, não em todas.
    expect((await um<{ v: string[] }>(`select vendido_em v from produtos where nome = 'Blusa Viscose'`)).v).toEqual(['uni-a'])

    // O sistema antigo reajustou para 120; a dona manda a planilha de novo, "atualizar".
    const r2 = await m.importacao.importarLote(DONA, {
      unidadeId: 'uni-a', seJaExiste: 'atualizar',
      itens: [item({ linha: 2, nome: 'Blusa Viscose', codigo: 'BV01', precoVista: 120, estoque: 10 })],
    })
    expect(r2).toMatchObject({ ok: true, atualizados: 1 })
    const p = await precos()
    console.log('[auditoria] depois de reimportar:', p)
    expect(Number(p.vista)).toBe(120)
    expect(Number(p.cartao)).toBe(120)
    expect(Number(p.crediario)).toBe(120)
    const pc = { vista: 12000, cartao: Number(p.cartao) * 100, crediario: Number(p.crediario) * 100 }
    expect(precoNaTabela(pc, 'crediario')).toBe(precoNaTabela(pc, 'vista'))

    // E o servidor recusa a venda no crediário a R$ 100 (o pagamento tem de
    // bater com o total que ELE calcula — 120).
    const v = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a', caixaId: 'cx-a', clienteId: 'cli-1',
      itens: [{ variacaoId: (await um<{ id: string }>(`select id from variacoes where codigo = 'BV01'`)).id, quantidade: 1 }],
      pagamentos: [{ forma: 'CREDIARIO', valor: 100, parcelas: 3 }],
    })
    console.log('[auditoria] venda no crediário a R$ 100 depois do reajuste para R$ 120:', v.ok ? 'ACEITA' : v)
    expect(v.ok).toBe(false)
  })

  it('cartão diferente do à vista acompanha na mesma proporção; a coluna da planilha manda quando existe', () => {
    // 100 / 110 / 110 → à vista 120: cartão 132, crediário (junto do cartão) 132.
    expect(m.importacao.precosDerivados({ vista: 100, cartao: 110, crediario: 110 }, 120, null)).toEqual({ cartao: 132, crediario: 132 })
    // Crediário próprio (115): acompanha o à vista na proporção dele.
    expect(m.importacao.precosDerivados({ vista: 100, cartao: 110, crediario: 115 }, 120, null)).toEqual({ cartao: 132, crediario: 138 })
    // A planilha traz o cartão: vale ele, e o crediário que andava junto vai junto.
    expect(m.importacao.precosDerivados({ vista: 100, cartao: 110, crediario: 110 }, 120, 125)).toEqual({ cartao: 125, crediario: 125 })
    // À vista igual: nada muda.
    expect(m.importacao.precosDerivados({ vista: 100, cartao: 110, crediario: 115 }, 100, null)).toEqual({ cartao: 110, crediario: 115 })
  })
})

describe('2. a segunda loja com "Pular o que já existe"', () => {
  it('o estoque da loja B entra para produto que a loja A já trouxe (e o produto passa a ser vendido na B)', async () => {
    const r = await m.importacao.importarLote(DONA, {
      unidadeId: 'uni-b', seJaExiste: 'pular',
      itens: [item({ linha: 2, nome: 'Blusa Viscose', codigo: 'BV01', precoVista: 120, estoque: 7 })],
    })
    console.log('[auditoria] planilha da loja B (pular):', r.ok ? r.linhas : r)
    expect(r).toMatchObject({ ok: true, pulados: 1 })
    const est = await db.query<{ q: string }>(
      `select e.quantidade q from estoque e join variacoes v on v.id = e.variacao_id where v.codigo = 'BV01' and e.unidade_id = 'uni-b'`,
    )
    expect(est.rows.map((x) => Number(x.q))).toEqual([7])
    expect((await um<{ v: string[] }>(`select vendido_em v from produtos where nome = 'Blusa Viscose'`)).v).toEqual(['uni-a', 'uni-b'])

    // De novo, com outro número: "pular" não mexe no que já foi contado.
    await m.importacao.importarLote(DONA, {
      unidadeId: 'uni-b', seJaExiste: 'pular',
      itens: [item({ linha: 2, nome: 'Blusa Viscose', codigo: 'BV01', precoVista: 120, estoque: 99 })],
    })
    const de2 = await db.query<{ q: string }>(
      `select e.quantidade q from estoque e join variacoes v on v.id = e.variacao_id where v.codigo = 'BV01' and e.unidade_id = 'uni-b'`,
    )
    expect(de2.rows.map((x) => Number(x.q))).toEqual([7])
  })

  it('"em todas as lojas": o produto novo nasce vendido em todas (vazio)', async () => {
    const r = await m.importacao.importarLote(DONA, {
      unidadeId: 'uni-a', vendidoEmTodas: true, seJaExiste: 'pular',
      itens: [item({ linha: 2, nome: 'Saia Midi', codigo: 'SM01', precoVista: 90, estoque: 2 })],
    })
    expect(r).toMatchObject({ ok: true, criados: 1 })
    expect((await um<{ v: string[] }>(`select vendido_em v from produtos where nome = 'Saia Midi'`)).v).toEqual([])
  })
})

describe('3. leitura (puro)', () => {
  it('célula numérica do Excel: código "00123" e EAN "0789123456789" perdem o zero sem aviso', () => {
    // read-excel-file entrega a célula numérica como number: 00123 → 123.
    expect(lerCodigo(123)).toEqual({ codigo: '123' })
    // EAN-13 que começa com 0, guardado como número: vira 12 dígitos, aceito sem aviso.
    expect(lerEan(789123456789)).toEqual({ ean: '789123456789' })
  })

  it('coluna de preço com milhar em inglês sem decimais ("1,299") vira R$ 1,30 sem aviso', () => {
    const g = [
      ['Nome', 'Preço'],
      ['Jaqueta couro', '1,299'],
      ['Casaco lã', '2,499'],
    ]
    const r = montarItens(g, 0, ['nome', 'precoVista'])
    console.log('[auditoria] "1,299" →', r.itens.map((i) => i.precoVista), 'avisos:', r.avisos)
    expect(r.itens.map((i) => i.precoVista)).toEqual([1.3, 2.5])
    expect(r.avisos).toHaveLength(0)
  })
})
