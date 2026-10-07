'use client'

// O que aparece depois de gerar a cobrança no Asaas: o botão que abre a
// página de pagamento (Pix, boleto ou cartão). Abre sozinha numa aba nova
// uma vez; o botão fica, para quem fechou a aba ou teve a janela bloqueada.

import { useEffect, useRef } from 'react'
import type { EstadoAssinatura } from './acoes'

export function Pagamento({ estado }: { estado: EstadoAssinatura }) {
  const aberta = useRef<string | null>(null)
  useEffect(() => {
    if (!estado.pagar || aberta.current === estado.pagar) return
    aberta.current = estado.pagar
    window.open(estado.pagar, '_blank', 'noopener,noreferrer')
  }, [estado.pagar])

  if (!estado.pagar) return null
  return (
    <a
      href={estado.pagar}
      target="_blank"
      rel="noopener noreferrer"
      className="botao-marca inline-flex min-h-11 items-center justify-center self-start rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta"
    >
      Pagar agora: Pix, boleto ou cartão
    </a>
  )
}

/** O CPF ou CNPJ de quem paga — só aparece quando a empresa ainda não tem. */
export function CampoDocumento() {
  return (
    <label className="mb-2 flex flex-col gap-1 text-sm">
      <span className="font-medium text-tinta">CPF ou CNPJ de quem paga</span>
      <input
        name="documento"
        required
        inputMode="numeric"
        autoComplete="off"
        placeholder="Só os números"
        className="w-56 rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta"
      />
    </label>
  )
}
