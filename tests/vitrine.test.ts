// A vitrine nova do catálogo (vitrine-tema.ts e vitrine.ts), com banco de
// verdade: o tema que vale, as datas, as postagens (e os stories que vencem),
// os destaques, a capa e as avaliações — só de quem recebeu o pedido, uma vez.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'
import { DATAS, datasParaSugerir, pascoa, temaDaVitrine } from '../src/servidor/vitrine-tema'

let db: PGlite
let servidor: PGLiteSocketServer
let v: typeof import('../src/servidor/vitrine')
let cat: typeof import('../src/servidor/catalogo')
let banco: typeof import('../src/servidor/banco')

const DONA: Sessao = { orgId: 'org-v', usuarioId: 'usr-d', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const CAIXA: Sessao = { orgId: 'org-v', usuarioId: 'usr-c', nome: 'Caixa', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-v', expiraEm: null }] }
// Um PNG de 1×1: o começo do arquivo é o que decide que é foto.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3])

const linha = async <T>(sql: string) => (await db.query<T>(sql)).rows

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(`
    insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em) values
      ('org-v', 'Sorveteria', 'sorveteria-v', 'BALCAO_AGENTE', 'ATIVA', '{encomenda}', now());
    insert into unidades (id, org_id, nome, eh_deposito, eh_fabrica, ativa, atualizada_em) values ('uni-v', 'org-v', 'Centro', false, false, true, now());
    insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-d', 'org-v', 'Dona', 'd@v.com', now()), ('usr-c', 'org-v', 'Caixa', 'c@v.com', now());
    insert into categorias (id, org_id, nome) values ('cat-a', 'org-v', 'Açaí');
    insert into produtos (id, org_id, nome, medida, preco_vista, categoria_id, atualizado_em) values
      ('p-1', 'org-v', 'Açaí 500', 'UN', 15, 'cat-a', now()), ('p-2', 'org-v', 'Açaí 1 litro', 'UN', 25, 'cat-a', now());
    insert into variacoes (id, org_id, produto_id, codigo, padrao) values ('v-1', 'org-v', 'p-1', 'A1', true), ('v-2', 'org-v', 'p-2', 'A2', true);
    insert into catalogos (id, org_id, unidade_id, ativo, endereco, whatsapp, atualizado_em) values ('catl', 'org-v', 'uni-v', true, 'centro', '5571999990000', now());
    insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, para, quem, situacao, origem, acompanhamento, atualizada_em) values
      ('enc-ok', 'org-v', 'uni-v', 'Ana Souza', 'açaí', now(), 'Catálogo', 'ENTREGUE', 'CATALOGO', 'tokenentregue000000001', now()),
      ('enc-ab', 'org-v', 'uni-v', 'Bia', 'açaí', now(), 'Catálogo', 'ABERTA', 'CATALOGO', 'tokenaberto00000000001', now());
  `)
  const porta = 56000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  v = await import('../src/servidor/vitrine')
  cat = await import('../src/servidor/catalogo')
  banco = await import('../src/servidor/banco')
}, 60_000)

afterAll(async () => {
  await banco?.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  delete (globalThis as { __prismaPortaria?: unknown }).__prismaPortaria
  await servidor?.stop()
  await db?.close()
})

describe('o tema (sem banco)', () => {
  it('a Páscoa e as datas que mudam todo ano', () => {
    expect(pascoa(2026)).toBe('2026-04-05')
    expect(pascoa(2027)).toBe('2027-03-28')
    expect(DATAS.find((d) => d.chave === 'carnaval')!.janela(2026)).toEqual({ de: '2026-02-13', ate: '2026-02-18' })
    expect(DATAS.find((d) => d.chave === 'maes')!.janela(2026).ate).toBe('2026-05-10')
  })

  it('sugere uma semana antes e até o último dia; o Ano Novo atravessa o ano', () => {
    expect(datasParaSugerir('2026-10-07').map((s) => s.data.chave)).toEqual(['criancas'])
    expect(datasParaSugerir('2026-10-08').map((s) => s.data.chave)).toContain('halloween')
    expect(datasParaSugerir('2027-01-02').map((s) => [s.data.chave, s.ate])).toEqual([['anonovo', '2027-01-02']])
  })

  it('quem manda: a data ligada, a cor à mão, o tema pronto, a cor da marca', () => {
    const agora = new Date('2026-10-20T12:00:00Z')
    const base = { tema: 'menta', corTema: null, especial: null, especialAte: null }
    expect(temaDaVitrine(base, '#123456', agora).cor).toBe('#0f9b77')
    expect(temaDaVitrine({ ...base, corTema: '#ABCDEF' }, null, agora).cor).toBe('#abcdef')
    expect(temaDaVitrine({ ...base, tema: null }, '#123456', agora).cor).toBe('#123456')
    const hall = temaDaVitrine({ ...base, especial: 'halloween', especialAte: new Date('2026-11-01T03:00:00Z') }, null, agora)
    expect(hall.especial?.arte).toBe('morcegos')
    // Passou do fim: some sozinho.
    expect(temaDaVitrine({ ...base, especial: 'halloween', especialAte: new Date('2026-10-01T00:00:00Z') }, null, agora).especial).toBeNull()
  })
})

describe('a vitrine no banco', () => {
  it('só quem responde pela empresa mexe; data fora de época é recusada', async () => {
    await expect(v.salvarAparencia(CAIXA, 'uni-v', { tema: 'menta', corTema: null })).rejects.toThrow()
    await expect(v.salvarAparencia(DONA, 'uni-v', { tema: 'nao-existe', corTema: null })).rejects.toThrow('não existe')
    await v.salvarAparencia(DONA, 'uni-v', { tema: 'acai', corTema: null })
    await expect(v.ligarDataEspecial(DONA, 'uni-v', 'natal', new Date('2026-07-01T12:00:00Z'))).rejects.toThrow('perto da data')
    await v.ligarDataEspecial(DONA, 'uni-v', 'natal', new Date('2026-12-10T12:00:00Z'))
    const [c] = await linha<{ tema: string; especial: string }>(`select tema, especial from catalogos where id = 'catl'`)
    expect(c).toEqual({ tema: 'acai', especial: 'natal' })
    await v.ligarDataEspecial(DONA, 'uni-v', null)
  })

  it('postagem: nas bolinhas por um dia, depois só no mural; a foto sai pelo link público só enquanto ativa', async () => {
    const ontem = new Date(Date.now() - 2 * 864e5)
    const velha = await v.criarPostagem(DONA, 'uni-v', { titulo: 'Velha', texto: 'de anteontem', produtoId: null, stories: 'dia', foto: null }, ontem)
    const nova = await v.criarPostagem(DONA, 'uni-v', { titulo: 'Sabor novo', texto: null, produtoId: 'p-1', stories: 'sempre', foto: PNG })
    await expect(v.criarPostagem(DONA, 'uni-v', { titulo: 'x', texto: null, produtoId: null, stories: 'dia', foto: null })).rejects.toThrow()

    const vit = await cat.lerVitrinePublica('sorveteria-v', 'centro')
    expect(vit!.extras.stories.map((p) => p.id)).toEqual([nova])
    expect(vit!.extras.mural.map((p) => p.id)).toEqual([nova, velha])
    const foto = vit!.extras.stories[0]!.foto!.split('/').pop()!
    expect(await cat.lerFotoPublica('sorveteria-v', foto)).not.toBeNull()
    await v.tirarPostagem(DONA, nova)
    expect(await cat.lerFotoPublica('sorveteria-v', foto)).toBeNull()
  })

  it('destaques: pelas categorias, depois à mão, na ordem; a capa sai no link público', async () => {
    expect(await v.destaquesDasCategorias(DONA, 'uni-v')).toBe(1)
    const id = await v.salvarDestaque(DONA, 'uni-v', { id: null, nome: 'Promoções', categoriaId: null, produtoIds: ['p-2', 'p-1', 'p-de-outro'], capa: PNG })
    await expect(v.salvarDestaque(DONA, 'uni-v', { id: null, nome: 'Vazio', categoriaId: null, produtoIds: [], capa: 'manter' })).rejects.toThrow()
    await v.moverDestaque(DONA, id, -1)
    await v.trocarCapa(DONA, 'uni-v', PNG)

    const vit = await cat.lerVitrinePublica('sorveteria-v', 'centro')
    expect(vit!.extras.destaques.map((d) => d.nome)).toEqual(['Promoções', 'Açaí'])
    expect(vit!.extras.destaques[0]!.produtoIds).toEqual(['p-2', 'p-1'])
    expect(vit!.extras.capa).toMatch(/^\/sorveteria-v\/foto\//)
    expect(await cat.lerFotoPublica('sorveteria-v', vit!.extras.capa!.split('/').pop()!)).not.toBeNull()

    // Os produtos do destaque, pela página pública.
    const ps = await cat.produtosDoCatalogo('sorveteria-v', 'centro', { produtoIds: ['p-2', 'p-1'] })
    expect(ps!.produtos.map((p) => p.id).sort()).toEqual(['p-1', 'p-2'])
  })

  it('avaliação: só do pedido entregue, uma vez; escondida some da vitrine', async () => {
    expect(await v.avaliarPedido('sorveteria-v', 'tokenaberto00000000001', { nota: 5, texto: 'ótimo' })).toMatchObject({ ok: false })
    expect(await v.avaliarPedido('sorveteria-v', 'tokenentregue000000001', { nota: 9, texto: null })).toMatchObject({ ok: false })
    expect(await v.avaliarPedido('sorveteria-v', 'tokenentregue000000001', { nota: 4, texto: '  Muito   bom  ' })).toEqual({ ok: true })
    expect(await v.avaliarPedido('sorveteria-v', 'tokenentregue000000001', { nota: 1, texto: 'de novo' })).toMatchObject({ ok: false })

    let vit = await cat.lerVitrinePublica('sorveteria-v', 'centro')
    expect(vit!.extras.avaliacoes).toMatchObject({ media: 4, total: 1 })
    expect(vit!.extras.avaliacoes.ultimas[0]).toMatchObject({ nome: 'Ana', texto: 'Muito bom' })
    const acompanhar = await cat.acompanharPedido('sorveteria-v', 'tokenentregue000000001')
    expect(acompanhar!.avaliacao).toEqual({ pode: true, feita: { nota: 4, texto: 'Muito bom' } })

    const id = vit!.extras.avaliacoes.ultimas[0]!.id
    await v.responderAvaliacao(DONA, id, 'Obrigada!')
    await expect(v.esconderAvaliacao(DONA, id, '')).rejects.toThrow()
    await v.esconderAvaliacao(DONA, id, 'teste interno')
    vit = await cat.lerVitrinePublica('sorveteria-v', 'centro')
    expect(vit!.extras.avaliacoes.total).toBe(0)
    const [a] = await linha<{ oculta_por: string; resposta: string }>(`select oculta_por, resposta from avaliacoes_catalogo where id = '${id}'`)
    expect(a).toEqual({ oculta_por: 'Dona', resposta: 'Obrigada!' })
  })
})
