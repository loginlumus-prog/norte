'use client'

// As peças das duas etapas do balcão (useVenda.ts, "as duas etapas"):
// quem vendeu, escolhido a cada venda, e o botão que leva ao pagamento. As
// duas caras do balcão (simples e avançado) usam as mesmas.

import type { Vendedor } from '@/servidor/equipe'
import { cx } from '@/ui/base'
import { brl } from './conta'
import type { Venda } from './useVenda'
import { usePalavras } from './palavras'

/** Quem vendeu: um toque por nome. Só aparece na loja com mais de um vendedor. */
export function EscolherVendedor({ v, vendedores, compacto = false }: { v: Venda; vendedores: Vendedor[] | null; compacto?: boolean }) {
  const p = usePalavras()
  if (!v.precisaVendedor || !vendedores) return null
  const falta = !v.vendedorEscolhido && v.carrinho.length > 0
  return (
    <div role="group" aria-label={p.Vendedor} data-escolher-vendedor className="flex flex-col gap-1.5">
      <span className={cx('text-xs font-semibold', falta ? 'text-atencao' : 'text-tinta-2')}>
        {falta ? `${p.Vendedor}: escolha antes de pagar` : p.Vendedor}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {vendedores.map((x) => {
          const ativo = v.vendedorEscolhido && v.vendedorId === x.id
          return (
            <button
              key={x.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => v.setVendedorId(x.id)}
              className={cx(
                'rounded-xl border px-3 font-semibold transition-colors',
                compacto ? 'min-h-9 text-xs' : 'min-h-11 text-sm',
                ativo ? 'border-marca bg-marca text-marca-tinta' : 'border-borda bg-superficie text-tinta hover:bg-superficie-2',
              )}
            >
              {x.nome.split(/\s+/)[0]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** "Ir para o pagamento", com o total — o único número da tela dos produtos. */
export function IrParaPagamento({ v, aoIr, className }: { v: Venda; aoIr?: () => void; className?: string }) {
  const vazio = v.carrinho.length === 0
  return (
    <button
      type="button"
      disabled={vazio}
      onClick={() => {
        if (v.irParaPagamento()) aoIr?.()
      }}
      className={cx(
        'botao-marca flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 text-marca-tinta',
        'touch-manipulation disabled:cursor-not-allowed disabled:opacity-50',
        !vazio && !v.podeIrParaPagamento && 'opacity-80',
        className,
      )}
    >
      <span className="flex flex-col items-start leading-tight">
        <span className="text-base font-bold">Ir para o pagamento</span>
        <span className="text-xs font-semibold opacity-80 [@media(pointer:coarse)]:hidden">F10</span>
      </span>
      <span className="numero text-2xl font-extrabold">{brl(v.conta.aPagarCent / 100)}</span>
    </button>
  )
}

/** A volta da tela de pagamento. */
export function VoltarAosProdutos({ v }: { v: Venda }) {
  return (
    <button
      type="button"
      onClick={v.voltarAosProdutos}
      className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-borda bg-superficie px-3 text-sm font-semibold text-tinta hover:bg-superficie-2"
    >
      <span aria-hidden>←</span> Voltar aos produtos <span className="text-xs text-tinta-3 [@media(pointer:coarse)]:hidden">Esc</span>
    </button>
  )
}
