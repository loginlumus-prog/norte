'use server'

// A foto do produto. Chega já reduzida pelo aparelho (ver FotoDoProduto.tsx);
// o servidor confere o tipo pelo conteúdo e o tamanho de novo.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { guardarFotoDoProduto, tirarFotoDoProduto } from '@/servidor/catalogo'
import { definirPrecoNaLoja } from '@/servidor/preco-loja'
import { definirComposicao, procurarComponentes } from '@/servidor/composicao'
import { lerDinheiro } from '@/servidor/dinheiro'

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
    const r = await tirarFotoDoProduto(sessao, produtoId)
    if (r.erro) return { erro: r.erro }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mudar este produto.' }
    return { erro: recadoDoErro(e, 'Não deu para tirar a foto.') }
  }
  revalidatePath(`/${slug}/produtos/${produtoId}`)
  return { ok: true }
}

/** O preço do produto numa loja ("1.250,00"), ou `null` para voltar ao geral. */
export async function precoNaLojaAcao(
  slug: string,
  produtoId: string,
  unidadeId: string,
  precos: { vista: string; cartao: string; crediario: string } | null,
): Promise<{ ok?: true; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!/^[\w-]{1,64}$/.test(produtoId) || !/^[\w-]{1,64}$/.test(unidadeId)) return { erro: 'Pedido inválido.' }
  let lidos: { vista: number; cartao: number | null; crediario: number | null } | null = null
  if (precos) {
    const vista = lerDinheiro(String(precos.vista ?? ''))
    if (vista === null) return { erro: 'O preço à vista não é um número. Use vírgula para os centavos: 12,90.' }
    const opcional = (t: string) => (String(t ?? '').trim() === '' ? null : lerDinheiro(String(t)))
    const cartao = opcional(precos.cartao)
    const crediario = opcional(precos.crediario)
    if (String(precos.cartao ?? '').trim() !== '' && cartao === null) return { erro: 'O preço no cartão não é um número.' }
    if (String(precos.crediario ?? '').trim() !== '' && crediario === null) return { erro: 'O preço no crediário não é um número.' }
    lidos = { vista, cartao, crediario }
  }
  try {
    await definirPrecoNaLoja(sessao, produtoId, unidadeId, lidos)
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não muda o preço desta loja.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar o preço.') }
  }
  revalidatePath(`/${slug}/produtos/${produtoId}`)
  return { ok: true }
}

/** O que o item leva do estoque (lista vazia = volta a ter estoque próprio). */
export async function composicaoAcao(
  slug: string,
  variacaoId: string,
  componentes: { componenteId: string; quantidade: number }[],
): Promise<{ ok?: true; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!/^[\w-]{1,64}$/.test(variacaoId)) return { erro: 'Item inválido.' }
  const lista = (Array.isArray(componentes) ? componentes : [])
    .filter((c) => c && typeof c.componenteId === 'string' && /^[\w-]{1,64}$/.test(c.componenteId))
    .map((c) => ({ componenteId: c.componenteId, quantidade: Number(c.quantidade) }))
  try {
    await definirComposicao(sessao, variacaoId, lista)
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mudar este produto.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
  revalidatePath(`/${slug}/produtos`, 'layout')
  return { ok: true }
}

export async function procurarComponentesAcao(slug: string, termo: string) {
  const sessao = await exigirSessao(slug)
  return procurarComponentes(sessao, String(termo ?? ''))
}
