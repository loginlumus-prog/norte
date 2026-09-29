'use server'

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { receberParcela } from '@/servidor/crediario'
import { DINHEIRO_ILEGIVEL, lerDinheiro } from '@/servidor/dinheiro'
import type { FormaPagamento } from '@prisma/client'

export type EstadoRecebimento = { erro?: string; ok?: string }

const FORMAS: FormaPagamento[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA']

export async function receberAcao(
  _anterior: EstadoRecebimento,
  form: FormData,
): Promise<EstadoRecebimento> {
  const slug = String(form.get('empresa') ?? '')
  const parcelaId = String(form.get('parcela') ?? '')
  // A régua de todo campo de dinheiro (`lerDinheiro`). O `Number` de antes
  // lia "1.234,56" como NaN, e o juro ilegível virava zero calado — a
  // parcela quitava sem o juro que a pessoa digitou.
  const valor = lerDinheiro(String(form.get('valor') ?? ''))
  if (valor === null) return { erro: `Valor recebido: ${DINHEIRO_ILEGIVEL}` }
  const jurosBruto = String(form.get('juros') ?? '').trim()
  const juros = jurosBruto ? lerDinheiro(jurosBruto) : 0
  if (juros === null) return { erro: `Juros: ${DINHEIRO_ILEGIVEL}` }
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
        mudou: 'Esta parcela mudou agora (outro recebimento ou uma devolução). Nada foi recebido: confira o valor e receba de novo.',
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
