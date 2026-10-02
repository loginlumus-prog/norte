'use server'

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { cancelarVenda } from '@/servidor/venda'
import { devolver } from '@/servidor/devolucao'
import { mostrarDiaDaColuna } from '@/servidor/dia'
import type { DestinoDevolucao } from '@prisma/client'
import { lerNumero } from '@/servidor/dinheiro'

export type EstadoDevolucao = {
  erro?: string
  /**
   * `valor` é o que vai para o cliente; `abatido`, o que apagou o fiado da
   * própria venda antes (ver `abaterDoFiado`). Numa venda no crediário ainda
   * em aberto, a devolução pode ser toda abatimento — e aí não sai dinheiro.
   */
  ok?: {
    valor: number
    /** Quanto de `valor` virou vale — com dinheiro ou estorno, a parte que a compra pagou com vale. */
    emVale: number
    destino: DestinoDevolucao
    abatido: number
    vale: { codigo: string; validade: string } | null
  }
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
  // A loja onde a devolução acontece (a do balcão). O servidor confere se a
  // pessoa vende nela; vazio é a loja da venda.
  const unidadeId = String(form.get('unidade') ?? '').trim() || null
  const motivo = String(form.get('motivo') ?? '')
  const destinoBruto = String(form.get('destino') ?? '')
  const destino: DestinoDevolucao | null =
    destinoBruto === 'VALE' || destinoBruto === 'DINHEIRO' || destinoBruto === 'ESTORNO' ? destinoBruto : null
  if (!destino) return { erro: 'Escolha para onde vai o valor.' }

  // Um campo por item. O formulário é do navegador: o mesmo `qtd-<id>` duas
  // vezes é pedido montado na mão, e é recusado aqui — o servidor recusa de
  // novo (`item_repetido`), porque esta ação não é a única porta.
  const itens: { vendaItemId: string; quantidade: number }[] = []
  const vistos = new Set<string>()
  for (const [chave, valor] of form.entries()) {
    if (!chave.startsWith('qtd-')) continue
    const id = chave.slice(4)
    if (vistos.has(id)) return { erro: 'O mesmo item veio duas vezes. Recarregue a tela e marque de novo.' }
    vistos.add(id)
    // Quantidade, não dinheiro: até três casas (0,350 kg). Vazio é "não volta".
    const t = String(valor).trim()
    const q = t ? lerNumero(t, 3) : 0
    if (q === null) return { erro: 'Uma das quantidades não deu para ler. Escreva assim: 2 ou 0,350.' }
    if (q > 0) itens.push({ vendaItemId: id, quantidade: q })
  }

  const sessao = await exigirSessao(slug)
  const r = await devolver(sessao, { vendaId, itens, destino, motivo, unidadeId })

  if (!r.ok) {
    return {
      erro: {
        nao_achada: 'Venda não encontrada.',
        cancelada: 'Esta venda foi cancelada — não há o que devolver.',
        saldo_importado: 'Este é o saldo de crediário trazido do sistema anterior: não tem peça para voltar. Receba ou acerte as parcelas no Crediário.',
        sem_itens: 'Marque quanto de cada item está voltando.',
        passa_do_vendido: 'Está devolvendo mais do que foi vendido.',
        sem_motivo: 'Diga o motivo. Ele vai para o livro.',
        caixa_fechado: 'Para devolver em dinheiro o caixa desta loja precisa estar aberto.',
        sem_permissao:
          'Sem permissão para devolver nesta loja. Devolver em dinheiro ou estorno é para quem pode cancelar venda; troca por vale, quem vende na loja pode.',
        item_repetido: 'O mesmo item veio duas vezes. Recarregue a tela e marque de novo.',
        quantidade_fracionada: 'Peça, par e caixa voltam inteiros: 1, 2, 3. Fração só em quilo, litro ou metro.',
        item_ajuste: 'A linha do sinal já pago é acerto de conta, não peça: não volta. Devolva os produtos.',
      }[r.motivo],
    }
  }

  revalidatePath(`/${slug}/vendas/${vendaId}`)
  revalidatePath(`/${slug}/vendas`)
  return {
    ok: {
      valor: r.valor,
      emVale: r.emVale,
      destino,
      abatido: r.abatido,
      vale: r.vale
        ? {
            codigo: r.vale.codigo,
            // Coluna `date`: formatada em UTC, senão o vale "valia até" o
            // dia anterior ao gravado — ver `mostrarDiaDaColuna`.
            validade: mostrarDiaDaColuna(r.vale.validade, 'longo'),
          }
        : null,
    },
  }
}

/** `precisaPin`: a empresa pede a assinatura de quem cancela — a tela mostra o campo do PIN. */
export type EstadoCancelamento = { erro?: string; ok?: string; precisaPin?: boolean }

export async function cancelarAcao(
  _anterior: EstadoCancelamento,
  form: FormData,
): Promise<EstadoCancelamento> {
  const slug = String(form.get('empresa') ?? '')
  const vendaId = String(form.get('venda') ?? '')
  const motivo = String(form.get('motivo') ?? '')
  const pin = String(form.get('pin') ?? '').replace(/\D/g, '') || null

  const sessao = await exigirSessao(slug)
  const r = await cancelarVenda(sessao, vendaId, motivo, pin)

  if (!r.ok && r.motivo === 'assinatura') return { erro: r.erro, precisaPin: true }
  if (!r.ok) {
    return {
      erro: {
        nao_achada: 'Venda não encontrada.',
        ja_cancelada: 'Esta venda já estava cancelada.',
        saldo_importado: 'Este é o saldo de crediário trazido do sistema anterior, e não se cancela: as parcelas são a dívida da pessoa.',
        sem_motivo: 'Diga o motivo. Ele vai para o livro, e é o que explica o dinheiro depois.',
        ja_devolvida:
          'Esta venda já teve devolução, e cancelar faria o estoque e os pontos voltarem de novo. Devolva o que falta.',
        crediario_recebido:
          'Esta venda no crediário já tem parcela mexida — recebida, com desconto, multa ou baixa de pagamento feito fora. Cancelar apagaria esse registro. Devolva os itens: o valor abate o que o cliente ainda deve.',
        caixa_fechado:
          'Esta venda foi em dinheiro num turno que já fechou, e o dinheiro volta ao cliente pela gaveta de agora. Abra o caixa desta loja para cancelar.',
      }[r.motivo],
    }
  }

  revalidatePath(`/${slug}/vendas/${vendaId}`)
  revalidatePath(`/${slug}/vendas`)
  revalidatePath(`/${slug}/balcao`)
  return {
    ok:
      `Venda ${r.numero} cancelada. O estoque e os pontos voltaram.` +
      (r.sangria > 0
        ? ` Saída de ${r.sangria.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} registrada no caixa aberto: é o dinheiro que volta ao cliente.`
        : ''),
  }
}
