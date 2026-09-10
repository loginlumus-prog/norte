'use server'

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { cancelarVenda } from '@/servidor/venda'

export type EstadoCancelamento = { erro?: string; ok?: string }

export async function cancelarAcao(
  _anterior: EstadoCancelamento,
  form: FormData,
): Promise<EstadoCancelamento> {
  const slug = String(form.get('empresa') ?? '')
  const vendaId = String(form.get('venda') ?? '')
  const motivo = String(form.get('motivo') ?? '')

  const sessao = await exigirSessao(slug)
  const r = await cancelarVenda(sessao, vendaId, motivo)

  if (!r.ok) {
    return {
      erro: {
        nao_achada: 'Venda não encontrada.',
        ja_cancelada: 'Esta venda já estava cancelada.',
        sem_motivo: 'Diga o motivo. Ele vai para o livro, e é o que explica o dinheiro depois.',
      }[r.motivo],
    }
  }

  revalidatePath(`/${slug}/vendas/${vendaId}`)
  revalidatePath(`/${slug}/vendas`)
  return { ok: `Venda ${r.numero} cancelada. O estoque e os pontos voltaram.` }
}
