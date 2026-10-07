// A vitrine do catálogo além dos produtos: o tema, a logo, as postagens (mural
// e stories) e as avaliações de quem pediu.
//
// Quem mexe é quem responde pela empresa (`empresa.configurar`), como nos
// outros ajustes do catálogo. Quem lê é a página pública — e por ela sai só o
// que um cartaz mostraria: a postagem ativa, a avaliação não escondida, o
// primeiro nome de quem avaliou.
//
// A avaliação só nasce do link de acompanhar de um pedido do catálogo já
// ENTREGUE: o link é secreto (é a chave), e o pedido é único na tabela — uma
// avaliação por pedido, sem conta, sem senha, sem robô comentando.

import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { comoOrg, acharOrgPorSlug, type BancoDaOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { FOTO_MAX_BYTES, tipoDaImagem, fotoUrl } from './catalogo'
import { diaEmSP, inicioDoDiaEmSP } from './dia'
import { TEMAS, corValida, datasParaSugerir, fimDaData, temaDaVitrine, temaPronto, dataEspecial, type TemaNaTela } from './vitrine-tema'

// ─────────────────────────────────────────────────────────────
// O QUE A PÁGINA PÚBLICA MOSTRA
// ─────────────────────────────────────────────────────────────

export type PostagemNaVitrine = {
  id: string
  titulo: string
  texto: string | null
  foto: string | null
  produtoId: string | null
  criadaEm: string
}

export type AvaliacaoNaVitrine = { id: string; nota: number; texto: string | null; nome: string; resposta: string | null; criadaEm: string }

/** Um destaque (a bolinha do topo): o nome, a capa e o que tem dentro. */
export type DestaqueNaVitrine = { id: string; nome: string; capa: string | null; categoriaId: string | null; produtoIds: string[] }

export type ExtrasDaVitrine = {
  tema: TemaNaTela
  /** A foto da capa escolhida pela loja; nula = a cor do tema com a arte. */
  capa: string | null
  /** Os destaques montados pela loja. Vazio = as bolinhas saem das categorias. */
  destaques: DestaqueNaVitrine[]
  stories: PostagemNaVitrine[]
  mural: PostagemNaVitrine[]
  avaliacoes: { media: number | null; total: number; ultimas: AvaliacaoNaVitrine[] }
}

const NO_MURAL = 12
const NAS_AVALIACOES = 12

const postagemNaVitrine = (slug: string, p: { id: string; titulo: string; texto: string | null; midiaId: string | null; produtoId: string | null; criadaEm: Date }): PostagemNaVitrine => ({
  id: p.id,
  titulo: p.titulo,
  texto: p.texto,
  foto: fotoUrl(slug, p.midiaId),
  produtoId: p.produtoId,
  criadaEm: p.criadaEm.toISOString(),
})

/** Lido dentro da transação da vitrine (`lerVitrinePublica`). */
export async function extrasDaVitrine(
  db: BancoDaOrg,
  slug: string,
  catalogo: { id: string; tema: string | null; corTema: string | null; especial: string | null; especialAte: Date | null; capaId: string | null },
  corMarca: string | null,
  agora = new Date(),
): Promise<ExtrasDaVitrine> {
  const postagens = await db.postagemCatalogo.findMany({
    where: { catalogoId: catalogo.id, ativa: true },
    orderBy: { criadaEm: 'desc' },
    take: 40,
    select: { id: true, titulo: true, texto: true, midiaId: true, produtoId: true, criadaEm: true, nosStories: true, storiesAte: true },
  })
  const stories = postagens
    .filter((p) => p.nosStories && (!p.storiesAte || p.storiesAte > agora))
    .slice(0, 15)
    .map((p) => postagemNaVitrine(slug, p))
  const mural = postagens.slice(0, NO_MURAL).map((p) => postagemNaVitrine(slug, p))

  const visiveis = { catalogoId: catalogo.id, oculta: false }
  const resumo = await db.avaliacaoCatalogo.aggregate({ where: visiveis, _avg: { nota: true }, _count: { _all: true } })
  const ultimas = await db.avaliacaoCatalogo.findMany({
    where: visiveis,
    orderBy: { criadaEm: 'desc' },
    take: NAS_AVALIACOES,
    select: { id: true, nota: true, texto: true, nome: true, resposta: true, criadaEm: true },
  })
  const destaques = await db.destaqueCatalogo.findMany({
    where: { catalogoId: catalogo.id },
    orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
    take: 30,
    select: { id: true, nome: true, midiaId: true, categoriaId: true, produtoIds: true },
  })

  return {
    tema: temaDaVitrine(catalogo, corMarca, agora),
    capa: fotoUrl(slug, catalogo.capaId),
    destaques: destaques.map((d) => ({ id: d.id, nome: d.nome, capa: fotoUrl(slug, d.midiaId), categoriaId: d.categoriaId, produtoIds: d.produtoIds })),
    stories,
    mural,
    avaliacoes: {
      media: resumo._count._all > 0 ? Math.round((resumo._avg.nota ?? 0) * 10) / 10 : null,
      total: resumo._count._all,
      ultimas: ultimas.map((a) => ({ ...a, criadaEm: a.criadaEm.toISOString() })),
    },
  }
}

/**
 * A mídia que pode sair pelo link público além da foto de produto: a logo da
 * empresa e a foto de postagem ativa. Ver `lerFotoPublica`.
 */
export async function midiaDaVitrine(db: BancoDaOrg, slug: string, logoUrl: string | null, id: string): Promise<boolean> {
  if (logoUrl && logoUrl === fotoUrl(slug, id)) return true
  if (await db.postagemCatalogo.findFirst({ where: { midiaId: id, ativa: true }, select: { id: true } })) return true
  if (await db.catalogoLoja.findFirst({ where: { capaId: id, ativo: true }, select: { id: true } })) return true
  return !!(await db.destaqueCatalogo.findFirst({ where: { midiaId: id, catalogo: { ativo: true } }, select: { id: true } }))
}

// ─────────────────────────────────────────────────────────────
// O PAINEL DA LOJA
// ─────────────────────────────────────────────────────────────

export type PostagemNoPainel = PostagemNaVitrine & { nosStories: boolean; storiesAte: string | null; produto: string | null; quem: string }
export type AvaliacaoNoPainel = AvaliacaoNaVitrine & { oculta: boolean; ocultaMotivo: string | null; pedido: string }

export type DestaqueNoPainel = DestaqueNaVitrine & { conteudo: string }

export type AparenciaDaLoja = {
  unidadeId: string
  capa: string | null
  destaques: DestaqueNoPainel[]
  categorias: { id: string; nome: string }[]
  temas: typeof TEMAS
  tema: string | null
  corTema: string | null
  corMarca: string | null
  logoUrl: string | null
  especial: { chave: string; nome: string; ate: string } | null
  sugestoes: { chave: string; nome: string; cor: string; ate: string; jaComecou: boolean }[]
  postagens: PostagemNoPainel[]
  avaliacoes: AvaliacaoNoPainel[]
  media: number | null
}

async function catalogoDaLoja(db: BancoDaOrg, unidadeId: string) {
  const c = await db.catalogoLoja.findUnique({
    where: { unidadeId },
    select: { id: true, tema: true, corTema: true, especial: true, especialAte: true, unidade: { select: { nome: true } } },
  })
  if (!c) throw new VitrineRecusada('Abra o catálogo desta loja primeiro (o link e o WhatsApp).')
  return c
}

export class VitrineRecusada extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'VitrineRecusada'
  }
}

export async function aparenciaDaLoja(sessao: Sessao, unidadeId: string, agora = new Date()): Promise<AparenciaDaLoja | null> {
  exigir(sessao, 'empresa.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.catalogoLoja.findUnique({
      where: { unidadeId },
      select: { id: true, tema: true, corTema: true, especial: true, especialAte: true, capaId: true },
    })
    if (!c) return null
    const destaques = await db.destaqueCatalogo.findMany({
      where: { catalogoId: c.id },
      orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
      select: { id: true, nome: true, midiaId: true, categoriaId: true, produtoIds: true },
    })
    const categorias = await db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true } })
    const nomeCat = new Map(categorias.map((x) => [x.id, x.nome]))
    const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { slug: true, logoUrl: true, corMarca: true } })
    const postagens = await db.postagemCatalogo.findMany({
      where: { catalogoId: c.id, ativa: true },
      orderBy: { criadaEm: 'desc' },
      take: 30,
      select: { id: true, titulo: true, texto: true, midiaId: true, produtoId: true, criadaEm: true, nosStories: true, storiesAte: true, quem: true, produto: { select: { nome: true } } },
    })
    const avaliacoes = await db.avaliacaoCatalogo.findMany({
      where: { catalogoId: c.id },
      orderBy: { criadaEm: 'desc' },
      take: 50,
      select: { id: true, nota: true, texto: true, nome: true, resposta: true, criadaEm: true, oculta: true, ocultaMotivo: true, encomendaId: true },
    })
    const media = await db.avaliacaoCatalogo.aggregate({ where: { catalogoId: c.id, oculta: false }, _avg: { nota: true }, _count: { _all: true } })
    const slug = org?.slug ?? ''
    const esp = c.especial && c.especialAte && c.especialAte > agora ? dataEspecial(c.especial) : null
    return {
      unidadeId,
      capa: fotoUrl(slug, c.capaId),
      categorias,
      destaques: destaques.map((d) => ({
        id: d.id,
        nome: d.nome,
        capa: fotoUrl(slug, d.midiaId),
        categoriaId: d.categoriaId,
        produtoIds: d.produtoIds,
        conteudo: d.categoriaId
          ? `Categoria ${nomeCat.get(d.categoriaId) ?? '(apagada)'}`
          : `${d.produtoIds.length} ${d.produtoIds.length === 1 ? 'produto escolhido' : 'produtos escolhidos'}`,
      })),
      temas: TEMAS,
      tema: temaPronto(c.tema)?.chave ?? null,
      corTema: corValida(c.corTema),
      corMarca: corValida(org?.corMarca),
      logoUrl: org?.logoUrl ?? null,
      especial: esp ? { chave: esp.chave, nome: esp.nome, ate: c.especialAte!.toISOString() } : null,
      sugestoes: datasParaSugerir(diaEmSP(agora))
        .filter((s) => s.data.chave !== esp?.chave)
        .map((s) => ({ chave: s.data.chave, nome: s.data.nome, cor: s.data.cor, ate: s.ate, jaComecou: s.jaComecou })),
      postagens: postagens.map((p) => ({
        ...postagemNaVitrine(slug, p),
        nosStories: p.nosStories && (!p.storiesAte || p.storiesAte > agora),
        storiesAte: p.storiesAte?.toISOString() ?? null,
        produto: p.produto?.nome ?? null,
        quem: p.quem,
      })),
      avaliacoes: avaliacoes.map((a) => ({
        id: a.id, nota: a.nota, texto: a.texto, nome: a.nome, resposta: a.resposta, criadaEm: a.criadaEm.toISOString(),
        oculta: a.oculta, ocultaMotivo: a.ocultaMotivo, pedido: a.encomendaId.slice(-6).toUpperCase(),
      })),
      media: media._count._all > 0 ? Math.round((media._avg.nota ?? 0) * 10) / 10 : null,
    }
  })
}

const livro = (db: BancoDaOrg, sessao: Sessao, d: { unidadeId?: string | null; acao: string; alvoTipo: string; alvoId: string; alvoNome?: string | null; motivo?: string | null; depois?: Prisma.InputJsonValue }) =>
  db.auditoria.create({
    data: {
      orgId: sessao.orgId,
      unidadeId: d.unidadeId ?? null,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao: d.acao,
      alvoTipo: d.alvoTipo,
      alvoId: d.alvoId,
      alvoNome: d.alvoNome ?? null,
      motivo: d.motivo ?? null,
      ...(d.depois !== undefined ? { depois: d.depois } : {}),
    },
  })

/** O tema pronto (ou nulo, a cor da marca) e a cor à mão (ou nula). */
export async function salvarAparencia(sessao: Sessao, unidadeId: string, d: { tema: string | null; corTema: string | null }): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  const tema = d.tema ? (temaPronto(d.tema)?.chave ?? null) : null
  if (d.tema && !tema) throw new VitrineRecusada('Esse tema não existe.')
  const corTema = d.corTema ? corValida(d.corTema) : null
  if (d.corTema && !corTema) throw new VitrineRecusada('A cor vem como #rrggbb.')
  await comoOrg(sessao.orgId, async (db) => {
    const c = await catalogoDaLoja(db, unidadeId)
    await db.catalogoLoja.update({ where: { id: c.id }, data: { tema, corTema } })
    await livro(db, sessao, { unidadeId, acao: 'catalogo.aparencia', alvoTipo: 'catalogo', alvoId: unidadeId, alvoNome: c.unidade.nome, depois: { tema, corTema } })
  })
}

/** Liga o tema de uma data (até o último dia dela) ou desliga (`chave` nula). */
export async function ligarDataEspecial(sessao: Sessao, unidadeId: string, chave: string | null, agora = new Date()): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  let ate: Date | null = null
  if (chave) {
    const fim = fimDaData(chave, diaEmSP(agora))
    if (!fim) throw new VitrineRecusada('Esse tema só pode ser ligado perto da data.')
    // Até o fim do último dia, no relógio de São Paulo.
    ate = new Date(inicioDoDiaEmSP(fim).getTime() + 864e5)
  }
  await comoOrg(sessao.orgId, async (db) => {
    const c = await catalogoDaLoja(db, unidadeId)
    await db.catalogoLoja.update({ where: { id: c.id }, data: { especial: chave, especialAte: ate } })
    await livro(db, sessao, {
      unidadeId, acao: 'catalogo.aparencia', alvoTipo: 'catalogo', alvoId: unidadeId, alvoNome: c.unidade.nome,
      depois: { especial: chave, ate: ate?.toISOString() ?? null },
    })
  })
}

async function guardarImagem(db: BancoDaOrg, orgId: string, nome: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0 || bytes.length > FOTO_MAX_BYTES) throw new VitrineRecusada('A foto ficou grande demais. Tente outra.')
  const mime = tipoDaImagem(bytes)
  if (!mime) throw new VitrineRecusada('Esse arquivo não é uma foto (JPG, PNG ou WebP).')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const m = await db.midia.upsert({
    where: { orgId_sha256: { orgId, sha256 } },
    create: { orgId, nome, mime, tipo: 'imagem', tamanho: bytes.length, sha256, dados: Buffer.from(bytes) },
    update: {},
    select: { id: true },
  })
  return m.id
}

/** A logo da empresa: vale no catálogo de todas as lojas e no acompanhar pedido. `null` tira. */
export async function trocarLogo(sessao: Sessao, bytes: Uint8Array | null): Promise<string | null> {
  exigir(sessao, 'empresa.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { slug: true } })
    const logoUrl = bytes ? fotoUrl(org.slug, await guardarImagem(db, sessao.orgId, 'logo', bytes)) : null
    await db.org.update({ where: { id: sessao.orgId }, data: { logoUrl } })
    await livro(db, sessao, { acao: 'empresa.logo', alvoTipo: 'empresa', alvoId: sessao.orgId, motivo: logoUrl ? 'logo nova' : 'logo retirada' })
    return logoUrl
  })
}

export type NovaPostagem = {
  titulo: string
  texto: string | null
  produtoId: string | null
  /** Nas bolinhas do topo: por um dia, enquanto existir, ou não. */
  stories: 'dia' | 'sempre' | 'nao'
  foto: Uint8Array | null
}

export async function criarPostagem(sessao: Sessao, unidadeId: string, d: NovaPostagem, agora = new Date()): Promise<string> {
  exigir(sessao, 'empresa.configurar')
  const titulo = d.titulo.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (titulo.length < 2) throw new VitrineRecusada('Dê um título à postagem (ex.: "Sabor novo: pistache").')
  const texto = (d.texto ?? '').trim().slice(0, 400) || null
  if (!d.foto && !texto) throw new VitrineRecusada('Ponha uma foto ou escreva um texto.')
  return comoOrg(sessao.orgId, async (db) => {
    const c = await catalogoDaLoja(db, unidadeId)
    let produtoId: string | null = null
    if (d.produtoId) {
      const p = await db.produto.findFirst({ where: { id: d.produtoId, ativo: true }, select: { id: true } })
      if (!p) throw new VitrineRecusada('Esse produto não está mais à venda.')
      produtoId = p.id
    }
    const midiaId = d.foto ? await guardarImagem(db, sessao.orgId, 'postagem', d.foto) : null
    const nova = await db.postagemCatalogo.create({
      data: {
        orgId: sessao.orgId,
        catalogoId: c.id,
        midiaId,
        titulo,
        texto,
        produtoId,
        nosStories: d.stories !== 'nao',
        storiesAte: d.stories === 'dia' ? new Date(agora.getTime() + 864e5) : null,
        quem: sessao.nome,
      },
      select: { id: true },
    })
    await livro(db, sessao, { unidadeId, acao: 'catalogo.postou', alvoTipo: 'postagem', alvoId: nova.id, alvoNome: titulo })
    return nova.id
  })
}

export async function tirarPostagem(sessao: Sessao, postagemId: string): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const p = await db.postagemCatalogo.findUnique({ where: { id: postagemId }, select: { titulo: true, ativa: true, catalogo: { select: { unidadeId: true } } } })
    if (!p || !p.ativa) return
    await db.postagemCatalogo.update({ where: { id: postagemId }, data: { ativa: false } })
    await livro(db, sessao, { unidadeId: p.catalogo.unidadeId, acao: 'catalogo.tirou_postagem', alvoTipo: 'postagem', alvoId: postagemId, alvoNome: p.titulo })
  })
}

/** Esconde (com motivo) ou mostra de novo (`motivo` nulo) uma avaliação. */
export async function esconderAvaliacao(sessao: Sessao, avaliacaoId: string, motivo: string | null): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  const porque = motivo?.trim().replace(/\s+/g, ' ').slice(0, 200) || null
  if (motivo !== null && (!porque || porque.length < 3)) throw new VitrineRecusada('Diga por que esconder.')
  await comoOrg(sessao.orgId, async (db) => {
    const a = await db.avaliacaoCatalogo.findUnique({ where: { id: avaliacaoId }, select: { nome: true, nota: true, catalogo: { select: { unidadeId: true } } } })
    if (!a) throw new VitrineRecusada('Avaliação não encontrada.')
    await db.avaliacaoCatalogo.update({
      where: { id: avaliacaoId },
      data: porque ? { oculta: true, ocultaPor: sessao.nome, ocultaMotivo: porque } : { oculta: false, ocultaPor: null, ocultaMotivo: null },
    })
    await livro(db, sessao, {
      unidadeId: a.catalogo.unidadeId, acao: 'catalogo.avaliacao', alvoTipo: 'avaliacao', alvoId: avaliacaoId,
      alvoNome: `${a.nome} · ${a.nota} estrela${a.nota === 1 ? '' : 's'}`, motivo: porque ?? 'mostrou de novo',
    })
  })
}

/** A resposta da loja, que aparece embaixo da avaliação. Vazia tira. */
export async function responderAvaliacao(sessao: Sessao, avaliacaoId: string, resposta: string): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  const r = resposta.trim().slice(0, 300) || null
  await comoOrg(sessao.orgId, async (db) => {
    const a = await db.avaliacaoCatalogo.findUnique({ where: { id: avaliacaoId }, select: { nome: true, catalogo: { select: { unidadeId: true } } } })
    if (!a) throw new VitrineRecusada('Avaliação não encontrada.')
    await db.avaliacaoCatalogo.update({ where: { id: avaliacaoId }, data: { resposta: r } })
    await livro(db, sessao, { unidadeId: a.catalogo.unidadeId, acao: 'catalogo.avaliacao', alvoTipo: 'avaliacao', alvoId: avaliacaoId, alvoNome: a.nome, motivo: r ? 'respondeu' : 'tirou a resposta' })
  })
}

// ─────────────────────────────────────────────────────────────
// A CLIENTE AVALIA (pelo link de acompanhar)
// ─────────────────────────────────────────────────────────────

export type SituacaoDaAvaliacao =
  | { pode: false }
  | { pode: true; feita: { nota: number; texto: string | null } | null }

/** Lido junto com o acompanhar: pode avaliar este pedido? Já avaliou? */
export async function avaliacaoDoPedido(db: BancoDaOrg, encomendaId: string): Promise<SituacaoDaAvaliacao> {
  const e = await db.encomenda.findUnique({
    where: { id: encomendaId },
    select: { origem: true, situacao: true, unidade: { select: { catalogo: { select: { id: true } } } }, avaliacao: { select: { nota: true, texto: true } } },
  })
  if (!e || e.origem !== 'CATALOGO' || e.situacao !== 'ENTREGUE' || !e.unidade.catalogo) return { pode: false }
  return { pode: true, feita: e.avaliacao ? { nota: e.avaliacao.nota, texto: e.avaliacao.texto } : null }
}

export async function avaliarPedido(slug: string, token: string, d: { nota: number; texto: string | null }): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!/^[\w-]{16,64}$/.test(token)) return { ok: false, erro: 'Link inválido.' }
  const nota = Math.round(Number(d.nota))
  if (!(nota >= 1 && nota <= 5)) return { ok: false, erro: 'Escolha de 1 a 5 estrelas.' }
  const texto = (d.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) || null
  const org = await acharOrgPorSlug(slug)
  if (!org) return { ok: false, erro: 'Link inválido.' }
  return comoOrg(org.id, async (db) => {
    const e = await db.encomenda.findUnique({
      where: { acompanhamento: token },
      select: { id: true, orgId: true, origem: true, situacao: true, clienteNome: true, unidade: { select: { catalogo: { select: { id: true } } } }, avaliacao: { select: { id: true } } },
    })
    if (!e || e.orgId !== org.id || e.origem !== 'CATALOGO' || !e.unidade.catalogo) return { ok: false as const, erro: 'Link inválido.' }
    if (e.situacao !== 'ENTREGUE') return { ok: false as const, erro: 'Dá para avaliar depois que o pedido for entregue.' }
    if (e.avaliacao) return { ok: false as const, erro: 'Este pedido já foi avaliado. Obrigado!' }
    await db.avaliacaoCatalogo.create({
      data: {
        orgId: org.id,
        catalogoId: e.unidade.catalogo.id,
        encomendaId: e.id,
        nota,
        texto,
        nome: (e.clienteNome.trim().split(/\s+/)[0] ?? 'Cliente').slice(0, 30),
      },
    })
    return { ok: true as const }
  })
}

// ─────────────────────────────────────────────────────────────
// A CAPA E OS DESTAQUES
// ─────────────────────────────────────────────────────────────

/** A foto da capa deste catálogo. `null` volta para a cor do tema. */
export async function trocarCapa(sessao: Sessao, unidadeId: string, bytes: Uint8Array | null): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const c = await catalogoDaLoja(db, unidadeId)
    const capaId = bytes ? await guardarImagem(db, sessao.orgId, 'capa', bytes) : null
    await db.catalogoLoja.update({ where: { id: c.id }, data: { capaId } })
    await livro(db, sessao, { unidadeId, acao: 'catalogo.aparencia', alvoTipo: 'catalogo', alvoId: unidadeId, alvoNome: c.unidade.nome, motivo: capaId ? 'capa nova' : 'capa retirada' })
  })
}

export const MAX_DESTAQUES = 20
export const MAX_PRODUTOS_NO_DESTAQUE = 30

export type DadosDoDestaque = {
  /** Sem id, cria; com id, muda aquele. */
  id: string | null
  nome: string
  categoriaId: string | null
  produtoIds: string[]
  /** A capa: uma foto nova, `tirar`, ou `manter` a que já tem. */
  capa: Uint8Array | 'tirar' | 'manter'
}

export async function salvarDestaque(sessao: Sessao, unidadeId: string, d: DadosDoDestaque): Promise<string> {
  exigir(sessao, 'empresa.configurar')
  const nome = d.nome.trim().replace(/\s+/g, ' ').slice(0, 22)
  if (nome.length < 1) throw new VitrineRecusada('Dê um nome ao destaque (ex.: Promoções, Açaí, Novidades).')
  const ids = [...new Set(d.produtoIds.filter((x) => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)))].slice(0, MAX_PRODUTOS_NO_DESTAQUE)
  if (!d.categoriaId && ids.length === 0) throw new VitrineRecusada('Escolha uma categoria ou pelo menos um produto para o destaque.')
  return comoOrg(sessao.orgId, async (db) => {
    const c = await catalogoDaLoja(db, unidadeId)
    let categoriaId: string | null = null
    if (d.categoriaId) {
      const cat = await db.categoria.findUnique({ where: { id: d.categoriaId }, select: { id: true } })
      if (!cat) throw new VitrineRecusada('Essa categoria não existe mais.')
      categoriaId = cat.id
    }
    // Só produtos desta empresa (o RLS já garante) e ativos, na ordem escolhida.
    const existem = ids.length
      ? new Set((await db.produto.findMany({ where: { id: { in: ids }, ativo: true }, select: { id: true } })).map((p) => p.id))
      : new Set<string>()
    const produtoIds = categoriaId ? [] : ids.filter((x) => existem.has(x))
    if (!categoriaId && produtoIds.length === 0) throw new VitrineRecusada('Esses produtos não estão mais à venda.')

    const midia = d.capa instanceof Uint8Array ? await guardarImagem(db, sessao.orgId, 'destaque', d.capa) : d.capa === 'tirar' ? null : undefined
    let id = d.id
    if (id) {
      const ja = await db.destaqueCatalogo.findFirst({ where: { id, catalogoId: c.id }, select: { id: true } })
      if (!ja) throw new VitrineRecusada('Destaque não encontrado.')
      await db.destaqueCatalogo.update({ where: { id }, data: { nome, categoriaId, produtoIds, ...(midia !== undefined ? { midiaId: midia } : {}) } })
    } else {
      const total = await db.destaqueCatalogo.count({ where: { catalogoId: c.id } })
      if (total >= MAX_DESTAQUES) throw new VitrineRecusada(`São no máximo ${MAX_DESTAQUES} destaques. Tire um para pôr outro.`)
      const ultimo = await db.destaqueCatalogo.aggregate({ where: { catalogoId: c.id }, _max: { ordem: true } })
      id = (
        await db.destaqueCatalogo.create({
          data: { orgId: sessao.orgId, catalogoId: c.id, nome, categoriaId, produtoIds, midiaId: midia ?? null, ordem: (ultimo._max.ordem ?? -1) + 1 },
          select: { id: true },
        })
      ).id
    }
    await livro(db, sessao, { unidadeId, acao: 'catalogo.aparencia', alvoTipo: 'destaque', alvoId: id, alvoNome: nome, motivo: d.id ? 'mudou o destaque' : 'criou o destaque' })
    return id
  })
}

export async function tirarDestaque(sessao: Sessao, destaqueId: string): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const d = await db.destaqueCatalogo.findUnique({ where: { id: destaqueId }, select: { nome: true, catalogo: { select: { unidadeId: true } } } })
    if (!d) return
    await db.destaqueCatalogo.delete({ where: { id: destaqueId } })
    await livro(db, sessao, { unidadeId: d.catalogo.unidadeId, acao: 'catalogo.aparencia', alvoTipo: 'destaque', alvoId: destaqueId, alvoNome: d.nome, motivo: 'tirou o destaque' })
  })
}

/** Sobe (−1) ou desce (+1) um destaque na fileira. */
export async function moverDestaque(sessao: Sessao, destaqueId: string, sentido: -1 | 1): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const d = await db.destaqueCatalogo.findUnique({ where: { id: destaqueId }, select: { catalogoId: true } })
    if (!d) return
    const todos = await db.destaqueCatalogo.findMany({ where: { catalogoId: d.catalogoId }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], select: { id: true } })
    const i = todos.findIndex((x) => x.id === destaqueId)
    const j = i + sentido
    if (i < 0 || j < 0 || j >= todos.length) return
    ;[todos[i], todos[j]] = [todos[j]!, todos[i]!]
    for (let k = 0; k < todos.length; k++) await db.destaqueCatalogo.update({ where: { id: todos[k]!.id }, data: { ordem: k } })
  })
}

/** O ponto de partida: um destaque por categoria que tem produto à venda nesta loja. */
export async function destaquesDasCategorias(sessao: Sessao, unidadeId: string): Promise<number> {
  exigir(sessao, 'empresa.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const c = await catalogoDaLoja(db, unidadeId)
    if ((await db.destaqueCatalogo.count({ where: { catalogoId: c.id } })) > 0) throw new VitrineRecusada('Já há destaques. Crie um novo ou mude os que existem.')
    const usadas = await db.produto.groupBy({ by: ['categoriaId'], where: { ativo: true, categoriaId: { not: null } }, _count: { _all: true } })
    const cats = await db.categoria.findMany({ where: { id: { in: usadas.map((u) => u.categoriaId!) } }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true }, take: MAX_DESTAQUES })
    for (let k = 0; k < cats.length; k++) {
      await db.destaqueCatalogo.create({ data: { orgId: sessao.orgId, catalogoId: c.id, nome: cats[k]!.nome.slice(0, 22), categoriaId: cats[k]!.id, produtoIds: [], ordem: k } })
    }
    await livro(db, sessao, { unidadeId, acao: 'catalogo.aparencia', alvoTipo: 'catalogo', alvoId: unidadeId, alvoNome: c.unidade.nome, motivo: `criou ${cats.length} destaques pelas categorias` })
    return cats.length
  })
}
