'use server'

// Configurar o catálogo de cada loja. Quem pode é conferido no serviço
// (src/servidor/catalogo.ts): ver é de quem vende; abrir, fechar e mudar é de
// quem responde pela empresa.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { fotosQueFaltam, guardarFotoDoProduto, salvarCatalogo, type DadosCatalogo, type FotosQueFaltam } from '@/servidor/catalogo'

export async function salvarCatalogoAcao(
  slug: string,
  unidadeId: string,
  d: DadosCatalogo,
): Promise<{ ok: true; endereco: string } | { ok: false; erro: string }> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await salvarCatalogo(sessao, unidadeId, d)
    if (r.ok) revalidatePath(`/${slug}/catalogo`)
    return r
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, erro: 'Só quem responde pela empresa abre ou muda o catálogo.' }
    return { ok: false, erro: recadoDoErro(e, 'Não deu para salvar o catálogo.') }
  }
}

/** A próxima página dos produtos que faltam foto nesta loja. */
export async function maisSemFotoAcao(slug: string, unidadeId: string, pular: number): Promise<FotosQueFaltam | null> {
  const sessao = await exigirSessao(slug)
  try {
    return await fotosQueFaltam(sessao, String(unidadeId), Number(pular) || 0)
  } catch {
    return null
  }
}

/**
 * A foto tirada na lista "sem foto" do catálogo. O mesmo caminho da ficha do
 * produto (`guardarFotoDoProduto`): o servidor confere o tipo pelo conteúdo, o
 * tamanho e se quem tira alcança todas as lojas onde o produto é vendido.
 */
export async function fotoPeloCatalogoAcao(slug: string, produtoId: string, form: FormData): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await exigirSessao(slug)
  const arquivo = form.get('foto')
  if (!(arquivo instanceof Blob)) return { ok: false, erro: 'Escolha uma foto.' }
  try {
    const r = await guardarFotoDoProduto(sessao, String(produtoId), new Uint8Array(await arquivo.arrayBuffer()))
    if (!r.ok) return r
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, erro: 'Você não pode mudar este produto.' }
    return { ok: false, erro: recadoDoErro(e, 'Não deu para guardar a foto.') }
  }
  revalidatePath(`/${slug}/produtos/${produtoId}`)
  return { ok: true }
}
