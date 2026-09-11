'use server'

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { cancelarVenda } from '@/servidor/venda'
import { devolver } from '@/servidor/devolucao'
import type { DestinoDevolucao } from '@prisma/client'

export type EstadoDevolucao = {
  erro?: string
  ok?: { valor: number; vale: { codigo: string; validade: string } | null }
}

/**
 * Devolver parte da venda. Os campos `qtd-<itemId>` dizem quanto de cada item
 * volta; o resto é destino e motivo. Tudo é conferido de novo no servidor —
 * o formulário é do navegador.
 */
export async function devolverAcao(
  _anterior: EstadoDevolucao,
  form: FormData,
): Promise<EstadoDevolucao> {
  const slug = String(form.get('empresa') ?? '')
  const vendaId = String(form.get('venda') ?? '')
  const motivo = String(form.get('motivo') ?? '')
  const destinoBruto = String(form.get('destino') ?? '')
  const destino: DestinoDevolucao | null =
    destinoBruto === 'VALE' || destinoBruto === 'DINHEIRO' || destinoBruto === 'ESTORNO' ? destinoBruto : null
  if (!destino) return { erro: 'Escolha para onde vai o valor.' }

  const itens: { vendaItemId: string; quantidade: number }[] = []
  for (const [chave, valor] of form.entries()) {
    if (!chave.startsWith('qtd-')) continue
    const q = Number(String(valor).replace(',', '.'))
    if (q > 0) itens.push({ vendaItemId: chave.slice(4), quantidade: q })
  }

  const sessao = await exigirSessao(slug)
  const r = await devolver(sessao, { vendaId, itens, destino, motivo })

  if (!r.ok) {
    return {
      erro: {
        nao_achada: 'Venda não encontrada.',
        cancelada: 'Esta venda foi cancelada — não há o que devolver.',
        sem_itens: 'Marque quanto de cada item está voltando.',
        passa_do_vendido: 'Está devolvendo mais do que foi vendido.',
        sem_motivo: 'Diga o motivo. Ele vai para o livro.',
        caixa_fechado: 'Para devolver em dinheiro o caixa desta loja precisa estar aberto.',
        sem_permissao: 'Devolver em dinheiro ou estorno é para quem pode cancelar venda. Troca por vale, todo mundo pode.',
      }[r.motivo],
    }
  }

  revalidatePath(`/${slug}/vendas/${vendaId}`)
  revalidatePath(`/${slug}/vendas`)
  return {
    ok: {
      valor: r.valor,
      vale: r.vale
        ? {
            codigo: r.vale.codigo,
            validade: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(r.vale.validade),
          }
        : null,
    },
  }
}

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
