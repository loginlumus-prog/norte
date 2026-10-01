'use server'

// As chaves de assinatura e do balcão (livro-assinaturas.ts). A checagem
// inteira acontece lá: `empresa.configurar`, e a chave do PIN só liga com a
// equipe toda com PIN.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { mudarBalcaoAmpliado, mudarPinNasExcecoes } from '@/servidor/livro-assinaturas'

export type EstadoChave = { erro?: string; ok?: string }

export async function mudarPinNasExcecoesAcao(slug: string, ligar: boolean): Promise<EstadoChave> {
  try {
    const s = await exigirSessao(slug)
    const r = await mudarPinNasExcecoes(s, ligar)
    if (!r.ok) return { erro: r.erro }
    revalidatePath(`/${slug}/configuracoes`)
    return {
      ok: ligar
        ? 'Ligado: sangria, suprimento, cancelar venda, baixa de crediário pago fora, corrigir estoque e corrigir data pedem o PIN de quem faz.'
        : 'Desligado: as exceções não pedem PIN (juntar fichas continua pedindo).',
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Só quem configura a empresa muda isto.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar agora.') }
  }
}

export async function mudarBalcaoAmpliadoAcao(slug: string, ligar: boolean): Promise<EstadoChave> {
  try {
    const s = await exigirSessao(slug)
    await mudarBalcaoAmpliado(s, ligar)
    revalidatePath(`/${slug}/configuracoes`)
    return {
      ok: ligar
        ? 'Ligado: a vendedora corrige o estoque pelo contado e cadastra produto novo, assinando com o PIN dela. Preço depois de publicado continua com a gerência.'
        : 'Desligado: estoque e cadastro de produto voltam a ser só da gerência.',
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Só quem configura a empresa muda isto.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar agora.') }
  }
}
