'use server'

// A foto do produto. Chega já reduzida pelo aparelho (ver FotoDoProduto.tsx);
// o servidor confere o tipo pelo conteúdo e o tamanho de novo.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { guardarFotoDoProduto, tirarFotoDoProduto } from '@/servidor/catalogo'

export async function guardarFotoAcao(slug: string, produtoId: string, form: FormData): Promise<{ ok?: true; erro?: string }> {
  const sessao = await exigirSessao(slug)
  const arquivo = form.get('foto')
  if (!(arquivo instanceof Blob)) return { erro: 'Escolha uma foto.' }
  try {
    const r = await guardarFotoDoProduto(sessao, produtoId, new Uint8Array(await arquivo.arrayBuffer()))
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mudar este produto.' }
    return { erro: recadoDoErro(e, 'Não deu para guardar a foto.') }
  }
  revalidatePath(`/${slug}/produtos/${produtoId}`)
  return { ok: true }
}

export async function tirarFotoAcao(slug: string, produtoId: string): Promise<{ ok?: true; erro?: string }> {
  const sessao = await exigirSessao(slug)
  try {
    await tirarFotoDoProduto(sessao, produtoId)
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mudar este produto.' }
    return { erro: recadoDoErro(e, 'Não deu para tirar a foto.') }
  }
  revalidatePath(`/${slug}/produtos/${produtoId}`)
  return { ok: true }
}
