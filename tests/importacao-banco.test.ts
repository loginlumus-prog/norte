// Trazer produtos de outro sistema, com banco de verdade (PGlite exposto numa
// porta, tudo pelo comoOrg e pelo RLS):
//
//   1. o lote cria produto, grade, categoria nova e o saldo da loja escolhida
//      (balanço com o motivo da importação, e linha no livro);
//   2. mandar a MESMA planilha de novo não duplica: pula, ou atualiza preço e
//      estoque — e o estoque fica no número da planilha, não somado;
//   3. o produto cadastrado à mão antes casa pelo nome;
//   4. quem não cadastra produto é recusado; linha torta não derruba o lote.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import { SemPermissao, type Sessao } from '../src/servidor/permissao'
import type { ItemImportado } from '../src/servidor/importacao-planilha'

let db: PGlite
let servidor: PGLiteSocketServer
let m: { importacao: typeof import('../src/servidor/importacao'); banco: typeof import('../src/servidor/banco') }

const DONA: Sessao = { orgId: 'org-i', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const BALCAO: Sessao = { orgId: 'org-i', usuarioId: 'usr-bal', nome: 'Caixa', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-i', expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-i', 'Loja I', 'loja-i', 'BALCAO', 'ATIVA', '{}', now(), now()),
    ('org-v', 'Vizinha', 'vizinha', 'BALCAO', 'ATIVA', '{}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-i', 'org-i', 'Centro', now()),
    ('uni-v', 'org-v', 'Loja da vizinha', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-i', 'Dona', 'dona@i.com', now()),
    ('usr-bal', 'org-i', 'Caixa', 'caixa@i.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-i', 'usr-dona', null, 'DONO'),
    ('ac-bal', 'org-i', 'usr-bal', 'uni-i', 'BALCAO');
  insert into categorias (id, org_id, nome, ordem) values ('cat-roupas', 'org-i', 'Roupas', 0);
  -- cadastrado à mão antes da importação: etiqueta do Norte
  insert into produtos (id, org_id, nome, medida, preco_vista, ativo, atualizado_em) values
    ('p-cad', 'org-i', 'Caderno Espiral', 'UN', 15.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao, ativa) values ('v-cad', 'org-i', 'p-cad', 'CAD001', true, true);
  -- da vizinha, com o mesmo código: não pode casar (RLS)
  insert into produtos (id, org_id, nome, medida, preco_vista, ativo, atualizado_em) values
    ('p-viz', 'org-v', 'Camiseta', 'UN', 10.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao, ativa) values ('v-viz', 'org-v', 'p-viz', '001', true, true);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 44000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = { importacao: await import('../src/servidor/importacao'), banco: await import('../src/servidor/banco') }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const um = async <T>(sql: string, p: unknown[] = []) => (await linhas<T>(sql, p))[0]!

const item = (x: Partial<ItemImportado> & Pick<ItemImportado, 'linha' | 'nome' | 'precoVista'>): ItemImportado => ({
  codigo: null, codigoBarras: null, categoria: null, marca: null, medida: 'UN', precoCartao: null, custo: null, estoque: null, variacoes: [],
  ...x,
})

const PLANILHA: ItemImportado[] = [
  item({ linha: 2, nome: 'Camiseta Básica', codigo: '001', precoVista: 49.9, custo: 22, estoque: 3, categoria: 'roupas', codigoBarras: '7891234567895' }),
  item({ linha: 3, nome: 'Café 500 g', precoVista: 18.9, estoque: 24, categoria: 'Mercearia' }),
  item({
    linha: 4, nome: 'Vestido Midi', codigo: 'VES10', precoVista: 159.9, categoria: 'Roupas',
    variacoes: [
      { linha: 4, tamanho: 'P', cor: 'Preto', codigo: 'VES10-P-PRETO', codigoBarras: null, estoque: 2 },
      { linha: 5, tamanho: 'M', cor: 'Preto', codigo: 'VES10-M-PRETO', codigoBarras: null, estoque: 0 },
    ],
  }),
]

const saldoDe = async (codigo: string) =>
  Number(
    (
      await um<{ q: string | null }>(
        `select (select quantidade from estoque e where e.variacao_id = v.id and e.unidade_id = 'uni-i') q from variacoes v where v.org_id = 'org-i' and v.codigo = $1`,
        [codigo],
      )
    ).q ?? NaN,
  )

describe('o primeiro lote', () => {
  it('cria produtos, grade, categoria nova e o saldo na loja escolhida', async () => {
    const r = await m.importacao.importarLote(DONA, { unidadeId: 'uni-i', seJaExiste: 'pular', itens: PLANILHA })
    expect(r).toMatchObject({ ok: true, criados: 3, atualizados: 0, pulados: 0, erros: 0, categoriasNovas: ['Mercearia'] })

    // o código da planilha é a etiqueta que já está na peça: fica
    expect(await saldoDe('001')).toBe(3)
    // sem código, o Norte dá um, como no cadastro à mão
    const cafe = await um<{ codigo: string; q: string }>(
      `select v.codigo, e.quantidade q from variacoes v join produtos p on p.id = v.produto_id join estoque e on e.variacao_id = v.id where p.nome = 'Café 500 g'`,
    )
    expect(cafe.codigo).toBe('CAF001')
    expect(Number(cafe.q)).toBe(24)
    // "roupas" casou com a categoria "Roupas" que já existia
    expect((await um<{ n: number }>(`select count(*)::int n from categorias where org_id = 'org-i'`)).n).toBe(2)

    // a grade: cor e tamanho viram eixos, uma variação por linha
    const vestido = await linhas<{ codigo: string; opcoes: string }>(
      `select v.codigo, string_agg(o.valor, ' · ' order by o.valor) opcoes from variacoes v
         join produtos p on p.id = v.produto_id join variacao_opcoes vo on vo.variacao_id = v.id join opcoes o on o.id = vo.opcao_id
        where p.nome = 'Vestido Midi' group by v.codigo order by v.codigo`,
    )
    expect(vestido).toEqual([
      { codigo: 'VES10-M-PRETO', opcoes: 'M · Preto' },
      { codigo: 'VES10-P-PRETO', opcoes: 'P · Preto' },
    ])
    expect(await saldoDe('VES10-P-PRETO')).toBe(2)
    // zero na planilha e nada antes: não grava linha de saldo à toa
    expect(Number.isNaN(await saldoDe('VES10-M-PRETO'))).toBe(true)

    // balanço com o motivo, e o livro
    const mov = await linhas<{ tipo: string; motivo: string }>(`select tipo, motivo from movimentos_estoque where org_id = 'org-i'`)
    expect(mov).toHaveLength(3)
    expect(mov.every((x) => x.tipo === 'BALANCO' && x.motivo === 'Importado de outro sistema')).toBe(true)
    const livro = await linhas<{ acao: string; n: number }>(`select acao, count(*)::int n from auditoria where org_id = 'org-i' group by acao order by acao`)
    expect(livro).toEqual([
      { acao: 'estoque.ajustou', n: 3 },
      { acao: 'produto.criou', n: 3 },
      { acao: 'produto.importou', n: 1 },
    ])
  })
})

describe('a mesma planilha de novo', () => {
  it('"pular": nada novo, nada mexido', async () => {
    const r = await m.importacao.importarLote(DONA, { unidadeId: 'uni-i', seJaExiste: 'pular', itens: PLANILHA })
    expect(r).toMatchObject({ ok: true, criados: 0, pulados: 3 })
    expect((await um<{ n: number }>(`select count(*)::int n from produtos where org_id = 'org-i'`)).n).toBe(4)
    expect(await saldoDe('001')).toBe(3)
  })

  it('"atualizar": preço novo e o estoque da planilha — no número dela, não somado', async () => {
    const mudada = PLANILHA.map((i) =>
      i.codigo === '001' ? { ...i, precoVista: 54.9, estoque: 5 } : i.codigo === 'VES10' ? { ...i, variacoes: i.variacoes.map((v) => ({ ...v, estoque: 7 })) } : i,
    )
    const r = await m.importacao.importarLote(DONA, { unidadeId: 'uni-i', seJaExiste: 'atualizar', itens: mudada })
    expect(r).toMatchObject({ ok: true, criados: 0, atualizados: 3 })
    expect(await saldoDe('001')).toBe(5)
    expect(await saldoDe('VES10-P-PRETO')).toBe(7)
    expect(await saldoDe('VES10-M-PRETO')).toBe(7)
    expect(Number((await um<{ p: string }>(`select preco_vista p from produtos where nome = 'Camiseta Básica'`)).p)).toBe(54.9)
    // e de novo, igual: o saldo não anda
    await m.importacao.importarLote(DONA, { unidadeId: 'uni-i', seJaExiste: 'atualizar', itens: mudada })
    expect(await saldoDe('001')).toBe(5)
    expect((await um<{ n: number }>(`select count(*)::int n from produtos where org_id = 'org-i'`)).n).toBe(4)
  })

  it('o produto cadastrado à mão antes casa pelo nome (sem acento, sem caixa), mesmo com código novo na planilha', async () => {
    const r = await m.importacao.importarLote(DONA, {
      unidadeId: 'uni-i',
      seJaExiste: 'atualizar',
      itens: [item({ linha: 9, nome: 'CADERNO  espiral', codigo: 'X-77', precoVista: 15, estoque: 12 })],
    })
    expect(r).toMatchObject({ ok: true, criados: 0, atualizados: 1 })
    expect(await saldoDe('CAD001')).toBe(12)
  })

  it('a prévia diz o que já existe — e o código da vizinha não conta', async () => {
    const r = await m.importacao.conferirExistentes(DONA, { codigos: ['001', 'ves10-p-preto', 'NOVO-1', '7891234567895'], nomes: ['café 500 G', 'Bicicleta'] })
    expect(r.codigos.sort()).toEqual(['001', '7891234567895', 'VES10-P-PRETO'])
    expect(r.nomes).toEqual(['cafe 500 g'])
  })
})

describe('os primeiros passos do painel', () => {
  it('contados do banco, para o dono; a balconista não vê', async () => {
    const pp = await import('../src/servidor/primeiros-passos')
    const passos = await pp.primeirosPassos(DONA, { slug: 'loja-i', temAssistente: false })
    expect(passos?.map((p) => [p.chave, p.feito])).toEqual([
      ['produtos', true],
      ['estoque', true],
      ['catalogo', false],
      // dona e caixa: duas pessoas
      ['equipe', true],
    ])
    expect(passos?.[0]?.href).toBe('/loja-i/produtos/importar')
    expect(await pp.primeirosPassos(BALCAO, { slug: 'loja-i', temAssistente: true })).toBeNull()
  })
})

describe('quem pode e o que não entra', () => {
  it('o balcão sem a chave da empresa não cadastra produto', async () => {
    await expect(m.importacao.importarLote(BALCAO, { unidadeId: 'uni-i', seJaExiste: 'pular', itens: PLANILHA })).rejects.toBeInstanceOf(SemPermissao)
  })

  it('estoque sem loja é recusado; loja de outra empresa não existe', async () => {
    expect(await m.importacao.importarLote(DONA, { unidadeId: null, seJaExiste: 'pular', itens: PLANILHA })).toMatchObject({ ok: false })
    expect(await m.importacao.importarLote(DONA, { unidadeId: 'uni-v', seJaExiste: 'pular', itens: PLANILHA })).toMatchObject({
      ok: false,
      erro: 'Loja não encontrada nesta empresa.',
    })
  })

  it('a linha torta fica de fora com o motivo, e as outras entram', async () => {
    const r = await m.importacao.importarLote(DONA, {
      unidadeId: 'uni-i',
      seJaExiste: 'pular',
      itens: [
        { linha: 20, nome: 'Sem preço', precoVista: 0 },
        item({ linha: 21, nome: 'Garrafa térmica', precoVista: 79.9, codigoBarras: '7891234567895' }),
        item({ linha: 22, nome: 'Squeeze', precoVista: 29.9 }),
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.criados).toBe(1)
    expect(r.linhas.find((l) => l.linha === 20)).toMatchObject({ situacao: 'erro' })
    // o EAN já é da camiseta: a linha casa com ela e é pulada, não duplica
    expect(r.linhas.find((l) => l.linha === 21)).toMatchObject({ situacao: 'pulado' })
    expect(r.linhas.find((l) => l.linha === 22)).toMatchObject({ situacao: 'criado' })
  })
})
