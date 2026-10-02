'use server'

// Configurar o catálogo de cada loja. Quem pode é conferido no serviço
// (src/servidor/catalogo.ts): ver é de quem vende; abrir, fechar e mudar é de
// quem responde pela empresa.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { salvarCatalogo, type DadosCatalogo } from '@/servidor/catalogo'

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
