'use server'

// Corrigir a data da venda. Server Action é endereço público: quem pode, a
// venda, a data e o motivo são conferidos de novo em `corrigirDataDaVenda`.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { corrigirDataDaVenda } from '@/servidor/venda-data'

/**
 * `avisos`: a correção mexe num mês que já passou — a tela mostra e pede a
 * confirmação. `precisaPin`: a empresa pede a assinatura de quem corrige.
 */
export type EstadoData = { erro?: string; ok?: string; precisaPin?: boolean; avisos?: string[] }

export async function corrigirDataAcao(_anterior: EstadoData, form: FormData): Promise<EstadoData> {
  const slug = String(form.get('empresa') ?? '')
  const vendaId = String(form.get('venda') ?? '')
  try {
    const sessao = await exigirSessao(slug)
    const r = await corrigirDataDaVenda(sessao, {
      vendaId,
      dia: String(form.get('dia') ?? ''),
      motivo: String(form.get('motivo') ?? ''),
      confirmado: form.get('confirmado') === '1',
      pin: String(form.get('pin') ?? '').replace(/\D/g, '') || null,
    })
    if (!r.ok) {
      if ('precisaConfirmar' in r) return { erro: r.erro, avisos: r.avisos }
      return { erro: r.erro, precisaPin: r.precisaPin }
    }
    if (r.semMudanca) return { ok: 'A venda já está nesse dia. Nada mudou.' }
    revalidatePath(`/${slug}/vendas/${vendaId}`)
    revalidatePath(`/${slug}/vendas`)
    return { ok: `Data corrigida: de ${r.de.split('-').reverse().join('/')} para ${r.para.split('-').reverse().join('/')}. O caixa continua o do turno em que o dinheiro entrou.` }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Corrigir a data da venda é de quem pode cancelar venda nesta loja (gerente ou dona).' }
    throw e
  }
}
