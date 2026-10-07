'use server'

// A aparência do catálogo: tema, logo, postagens e avaliações. As regras e
// quem pode (quem responde pela empresa) moram em src/servidor/vitrine.ts.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import {
  VitrineRecusada,
  criarPostagem,
  esconderAvaliacao,
  ligarDataEspecial,
  responderAvaliacao,
  salvarAparencia,
  tirarPostagem,
  trocarLogo,
  trocarCapa,
  salvarDestaque,
  tirarDestaque,
  moverDestaque,
  destaquesDasCategorias,
} from '@/servidor/vitrine'

type Resposta = { ok: true } | { ok: false; erro: string }

async function fazer(slug: string, f: (s: Awaited<ReturnType<typeof exigirSessao>>) => Promise<unknown>): Promise<Resposta> {
  const s = await exigirSessao(slug)
  try {
    await f(s)
  } catch (e) {
    if (e instanceof VitrineRecusada) return { ok: false, erro: e.message }
    if (e instanceof SemPermissao) return { ok: false, erro: 'Só quem responde pela empresa muda o catálogo.' }
    return { ok: false, erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
  revalidatePath(`/${slug}/catalogo/aparencia`)
  return { ok: true }
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')

export async function temaAcao(slug: string, unidadeId: string, tema: string | null, corTema: string | null) {
  return fazer(slug, (s) => salvarAparencia(s, texto(unidadeId), { tema: tema ? texto(tema) : null, corTema: corTema ? texto(corTema) : null }))
}

export async function dataAcao(slug: string, unidadeId: string, chave: string | null) {
  return fazer(slug, (s) => ligarDataEspecial(s, texto(unidadeId), chave ? texto(chave) : null))
}

export async function logoAcao(slug: string, form: FormData) {
  const arquivo = form.get('logo')
  const tirar = form.get('tirar') === '1'
  if (!tirar && !(arquivo instanceof Blob)) return { ok: false as const, erro: 'Escolha uma imagem.' }
  return fazer(slug, async (s) => trocarLogo(s, tirar ? null : new Uint8Array(await (arquivo as Blob).arrayBuffer())))
}

export async function postarAcao(slug: string, unidadeId: string, form: FormData) {
  const foto = form.get('foto')
  const stories = texto(form.get('stories'))
  return fazer(slug, async (s) =>
    criarPostagem(s, texto(unidadeId), {
      titulo: texto(form.get('titulo')),
      texto: texto(form.get('texto')) || null,
      produtoId: texto(form.get('produtoId')) || null,
      stories: stories === 'sempre' || stories === 'nao' ? stories : 'dia',
      foto: foto instanceof Blob && foto.size > 0 ? new Uint8Array(await foto.arrayBuffer()) : null,
    }),
  )
}

export async function tirarPostagemAcao(slug: string, postagemId: string) {
  return fazer(slug, (s) => tirarPostagem(s, texto(postagemId)))
}

export async function esconderAvaliacaoAcao(slug: string, avaliacaoId: string, motivo: string | null) {
  return fazer(slug, (s) => esconderAvaliacao(s, texto(avaliacaoId), motivo === null ? null : texto(motivo)))
}

export async function responderAvaliacaoAcao(slug: string, avaliacaoId: string, resposta: string) {
  return fazer(slug, (s) => responderAvaliacao(s, texto(avaliacaoId), texto(resposta)))
}

export async function capaAcao(slug: string, unidadeId: string, form: FormData) {
  const arquivo = form.get('capa')
  const tirar = form.get('tirar') === '1'
  if (!tirar && !(arquivo instanceof Blob)) return { ok: false as const, erro: 'Escolha uma imagem.' }
  return fazer(slug, async (s) => trocarCapa(s, texto(unidadeId), tirar ? null : new Uint8Array(await (arquivo as Blob).arrayBuffer())))
}

export async function destaqueAcao(slug: string, unidadeId: string, form: FormData) {
  let produtoIds: string[] = []
  try {
    const lido = JSON.parse(texto(form.get('produtoIds')) || '[]')
    if (Array.isArray(lido)) produtoIds = lido.filter((x): x is string => typeof x === 'string')
  } catch {
    produtoIds = []
  }
  const capa = form.get('capa')
  return fazer(slug, async (s) =>
    salvarDestaque(s, texto(unidadeId), {
      id: texto(form.get('id')) || null,
      nome: texto(form.get('nome')),
      categoriaId: texto(form.get('categoriaId')) || null,
      produtoIds,
      capa: capa instanceof Blob && capa.size > 0 ? new Uint8Array(await capa.arrayBuffer()) : form.get('tirarCapa') === '1' ? 'tirar' : 'manter',
    }),
  )
}

export async function tirarDestaqueAcao(slug: string, destaqueId: string) {
  return fazer(slug, (s) => tirarDestaque(s, texto(destaqueId)))
}

export async function moverDestaqueAcao(slug: string, destaqueId: string, sentido: number) {
  return fazer(slug, (s) => moverDestaque(s, texto(destaqueId), sentido < 0 ? -1 : 1))
}

export async function destaquesDasCategoriasAcao(slug: string, unidadeId: string) {
  return fazer(slug, (s) => destaquesDasCategorias(s, texto(unidadeId)))
}
