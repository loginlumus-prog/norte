'use server'

// Server Action é endereço público: quem pode e se a empresa contratou o
// Farol é conferido dentro de cada serviço (src/servidor/farol.ts).

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { FarolRecusou, arquivarMarca, atualizarPeca, gerarPeca, salvarMarca, TIPOS, type DadosDaMarca } from '@/servidor/farol'
import type { SituacaoPecaFarol, TipoPecaFarol } from '@prisma/client'

export type EstadoFarol = { ok?: string; erro?: string; id?: string }

const recado = (e: unknown, padrao: string): EstadoFarol => {
  if (e instanceof FarolRecusou) return { erro: e.message }
  if (e instanceof SemPermissao) return { erro: 'Só quem cuida da empresa mexe no Farol.' }
  return { erro: recadoDoErro(e, padrao) }
}

export async function salvarMarcaAcao(slug: string, id: string | null, d: DadosDaMarca): Promise<EstadoFarol> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await salvarMarca(sessao, id, d)
    revalidatePath(`/${slug}/farol`)
    return { ok: id ? 'Marca salva.' : 'Marca cadastrada. Comece pelo diagnóstico.', id: r.id }
  } catch (e) {
    return recado(e, 'Não deu para salvar a marca.')
  }
}

export async function arquivarMarcaAcao(slug: string, id: string): Promise<EstadoFarol> {
  const sessao = await exigirSessao(slug)
  try {
    await arquivarMarca(sessao, id)
    revalidatePath(`/${slug}/farol`)
    return { ok: 'Marca arquivada.' }
  } catch (e) {
    return recado(e, 'Não deu para arquivar.')
  }
}

export async function gerarAcao(
  slug: string,
  d: { marcaId: string; tipo: string; pedido?: string; para?: string | null },
): Promise<EstadoFarol> {
  const sessao = await exigirSessao(slug)
  if (!(d.tipo in TIPOS)) return { erro: 'Escolha o que o Farol vai escrever.' }
  try {
    const r = await gerarPeca(sessao, { marcaId: String(d.marcaId), tipo: d.tipo as TipoPecaFarol, pedido: d.pedido ?? null, para: d.para || null })
    revalidatePath(`/${slug}/farol`)
    return { ok: `Pronto: ${r.titulo}.`, id: r.id }
  } catch (e) {
    return recado(e, 'O Farol não conseguiu escrever agora. Tente de novo em instantes.')
  }
}

const SITUACOES: SituacaoPecaFarol[] = ['RASCUNHO', 'APROVADA', 'PUBLICADA', 'ARQUIVADA']

export async function atualizarPecaAcao(
  slug: string,
  id: string,
  d: { conteudo?: string; situacao?: string; para?: string | null },
): Promise<EstadoFarol> {
  const sessao = await exigirSessao(slug)
  if (d.situacao && !SITUACOES.includes(d.situacao as SituacaoPecaFarol)) return { erro: 'Situação inválida.' }
  try {
    await atualizarPeca(sessao, String(id), {
      conteudo: d.conteudo,
      situacao: d.situacao as SituacaoPecaFarol | undefined,
      para: d.para,
    })
    revalidatePath(`/${slug}/farol`)
    return { ok: 'Salvo.' }
  } catch (e) {
    return recado(e, 'Não deu para salvar.')
  }
}
