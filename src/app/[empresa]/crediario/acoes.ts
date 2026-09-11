'use server'

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { receberParcela } from '@/servidor/crediario'
import type { FormaPagamento } from '@prisma/client'

export type EstadoRecebimento = { erro?: string; ok?: string }

const FORMAS: FormaPagamento[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA']

export async function receberAcao(
  _anterior: EstadoRecebimento,
  form: FormData,
): Promise<EstadoRecebimento> {
  const slug = String(form.get('empresa') ?? '')
  const parcelaId = String(form.get('parcela') ?? '')
  const valor = Number(String(form.get('valor') ?? '').replace(',', '.'))
  const juros = Number(String(form.get('juros') ?? '0').replace(',', '.')) || 0
  const formaBruta = String(form.get('forma') ?? '')
  const forma = FORMAS.find((f) => f === formaBruta)
  if (!forma) return { erro: 'Escolha como recebeu.' }

  const sessao = await exigirSessao(slug)
  const r = await receberParcela(sessao, { parcelaId, valor, juros, forma })

  if (!r.ok) {
    return {
      erro: {
        nao_achada: 'Parcela não encontrada.',
        ja_quitada: 'Esta parcela já estava quitada.',
        valor_invalido: 'O valor precisa ser maior que os juros.',
        passa_do_resto: 'Está recebendo mais do que a parcela deve.',
        caixa_fechado: 'Para receber em dinheiro o caixa desta loja precisa estar aberto.',
      }[r.motivo],
    }
  }

  revalidatePath(`/${slug}/crediario`)
  revalidatePath(`/${slug}/balcao`)
  return {
    ok: r.quitada
      ? `Parcela quitada${r.juros > 0 ? `, com ${r.juros.toFixed(2).replace('.', ',')} de juros` : ''}.`
      : `Recebido. Ainda restam R$ ${r.restante.toFixed(2).replace('.', ',')} desta parcela.`,
  }
}
