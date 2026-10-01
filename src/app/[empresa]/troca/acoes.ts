'use server'

// As ações da tela de troca. Server Action é endereço público: cada uma
// repete a checagem inteira (sessão, capacidade, loja) — o servidor/troca.ts
// confere de novo tudo o que importa.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import {
  compraParaTroca,
  procurarCompras,
  trocar,
  type CompraAchada,
  type CompraParaTroca,
  type PedidoTroca,
  type ResultadoTroca,
} from '@/servidor/troca'
import type { FormaPagamento } from '@prisma/client'

const ID = /^[\w-]{1,64}$/

export async function procurarComprasAcao(
  slug: string,
  unidadeId: string,
  dias: number,
  q: string,
): Promise<{ ok: true; compras: CompraAchada[] } | { ok: false; erro: string }> {
  try {
    const s = await exigirSessao(slug)
    if (!ID.test(unidadeId)) return { ok: false, erro: 'Loja inválida. Recarregue a tela.' }
    return { ok: true, compras: await procurarCompras(s, { unidadeId, dias: Number(dias), q: String(q ?? '').slice(0, 120) }) }
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, erro: 'Você não pode fazer troca nesta loja.' }
    return { ok: false, erro: recadoDoErro(e, 'Não deu para buscar as compras. Tente de novo.') }
  }
}

export async function abrirCompraAcao(slug: string, vendaId: string): Promise<CompraParaTroca | null> {
  const s = await exigirSessao(slug)
  if (!ID.test(vendaId)) return null
  return compraParaTroca(s, vendaId)
}

/** O pedido como a tela manda. Tudo é conferido de novo no servidor. */
export type PedidoDaTela = {
  unidadeId: string
  vendaId: string | null
  voltam: { vendaItemId: string; quantidade: number; variacaoId?: string | null }[]
  semCompra: { variacaoId: string; quantidade: number; precoUnit: number }[]
  leva: { variacaoId: string; quantidade: number }[]
  diferenca: {
    forma: string
    valor: number
    parcelas?: number
    maquininha?: string | null
    primeiroVencimento?: string | null
  } | null
  clienteId: string | null
  clienteCpf?: string | null
  motivo: string
  pin?: string | null
  troco?: number
}

const FORMAS_DA_DIFERENCA = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'CREDIARIO', 'TRANSFERENCIA'] as const

export async function trocarAcao(slug: string, d: PedidoDaTela): Promise<ResultadoTroca> {
  try {
    const s = await exigirSessao(slug)
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
    const forma = d.diferenca && (FORMAS_DA_DIFERENCA as readonly string[]).includes(d.diferenca.forma) ? (d.diferenca.forma as FormaPagamento) : null
    if (d.diferenca && !forma) return { ok: false, motivo: 'pagamento_recusado', recado: 'Escolha como a cliente paga a diferença.' }
    if (!ID.test(String(d.unidadeId ?? ''))) return { ok: false, motivo: 'loja', recado: 'Loja inválida. Recarregue a tela.' }

    const pedido: PedidoTroca = {
      unidadeId: d.unidadeId,
      vendaId: typeof d.vendaId === 'string' && ID.test(d.vendaId) ? d.vendaId : null,
      voltam: (Array.isArray(d.voltam) ? d.voltam : [])
        .slice(0, 100)
        .filter((i) => ID.test(String(i?.vendaItemId ?? '')))
        .map((i) => ({
          vendaItemId: i.vendaItemId,
          quantidade: num(i.quantidade),
          variacaoId: typeof i.variacaoId === 'string' && ID.test(i.variacaoId) ? i.variacaoId : null,
        })),
      semCompra: (Array.isArray(d.semCompra) ? d.semCompra : [])
        .slice(0, 50)
        .filter((i) => ID.test(String(i?.variacaoId ?? '')))
        .map((i) => ({ variacaoId: i.variacaoId, quantidade: num(i.quantidade), precoUnit: num(i.precoUnit) })),
      leva: (Array.isArray(d.leva) ? d.leva : [])
        .slice(0, 100)
        .filter((i) => ID.test(String(i?.variacaoId ?? '')))
        .map((i) => ({ variacaoId: i.variacaoId, quantidade: num(i.quantidade) })),
      diferenca:
        d.diferenca && forma
          ? {
              forma,
              valor: num(d.diferenca.valor),
              parcelas: Number.isInteger(d.diferenca.parcelas) ? d.diferenca.parcelas : undefined,
              maquininha: typeof d.diferenca.maquininha === 'string' ? d.diferenca.maquininha.slice(0, 60) : null,
              primeiroVencimento:
                typeof d.diferenca.primeiroVencimento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.diferenca.primeiroVencimento)
                  ? d.diferenca.primeiroVencimento
                  : null,
            }
          : null,
      clienteId: typeof d.clienteId === 'string' && ID.test(d.clienteId) ? d.clienteId : null,
      clienteCpf: typeof d.clienteCpf === 'string' && d.clienteCpf.trim() ? d.clienteCpf.trim().slice(0, 20) : null,
      motivo: String(d.motivo ?? '').slice(0, 200),
      pin: typeof d.pin === 'string' && d.pin.trim() ? d.pin.replace(/\D/g, '').slice(0, 12) : null,
      troco: Number(d.troco) || 0,
    }

    const r = await trocar(s, pedido)
    if (r.ok) {
      revalidatePath(`/${slug}/balcao`)
      revalidatePath(`/${slug}/vendas`)
      if (pedido.vendaId) revalidatePath(`/${slug}/vendas/${pedido.vendaId}`)
    }
    return r
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, motivo: 'sem_permissao', recado: 'Você não pode fazer troca nesta loja. Nada foi gravado.' }
    return { ok: false, motivo: 'erro', recado: recadoDoErro(e, 'Não deu para fazer a troca, e nada foi gravado. Tente de novo.') }
  }
}
