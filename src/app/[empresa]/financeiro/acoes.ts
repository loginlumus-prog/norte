'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// A capacidade `financeiro.lancar` é exigida lá dentro, em `lancar()` e
// `marcarPago()`, junto da unidade.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { lancar, marcarPago } from '@/servidor/financeiro'
import type { TipoLancamento } from '@prisma/client'

export type EstadoLanc = { erro?: string; ok?: string }

export async function novoLancamento(
  slug: string,
  _anterior: EstadoLanc,
  form: FormData,
): Promise<EstadoLanc> {
  const s = await exigirSessao(slug)

  const valor = Number(String(form.get('valor') ?? '').replace(',', '.'))
  const descricao = String(form.get('descricao') ?? '')
  const categoriaId = String(form.get('categoriaId') ?? '')
  const vencimento = String(form.get('vencimento') ?? '')

  if (!descricao.trim()) return { erro: 'Descreva o que é este lançamento.' }
  if (!categoriaId) return { erro: 'Escolha uma categoria.' }
  if (!valor || valor <= 0) return { erro: 'O valor precisa ser maior que zero.' }
  if (!vencimento) return { erro: 'Informe a data de vencimento.' }

  const jaPago = form.get('jaPago') === 'on'

  try {
    await lancar(s, {
      categoriaId,
      contaId: String(form.get('contaId') ?? '') || null,
      unidadeId: String(form.get('unidadeId') ?? '') || null,
      tipo: (String(form.get('tipo') ?? 'DESPESA') as TipoLancamento),
      descricao,
      valor,
      // 'T12:00' evita o pulo de dia por fuso: a data digitada é a data gravada.
      vencimento: new Date(`${vencimento}T12:00:00`),
      pagoEm: jaPago ? new Date(`${vencimento}T12:00:00`) : null,
      fornecedor: String(form.get('fornecedor') ?? ''),
      documento: String(form.get('documento') ?? ''),
    })
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não deu para lançar.' }
  }

  revalidatePath(`/${slug}/financeiro`)
  return { ok: 'Lançado.' }
}

export async function pagar(slug: string, id: string) {
  const s = await exigirSessao(slug)
  await marcarPago(s, id, new Date())
  revalidatePath(`/${slug}/financeiro`)
}
