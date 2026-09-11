'use client'

// O botão de imprimir das telas de papel (etiqueta, comprovante).
//
// Some na impressão — a classe `nao-imprime` está no CSS global — e, quando
// a tela abre com `?imprimir=1`, chama a impressora sozinho: é o caminho do
// balcão, que clicou em "comprovante" e quer o papel, não uma tela.

import { useEffect } from 'react'

export function Imprimir({ automatico = false, rotulo = 'Imprimir' }: { automatico?: boolean; rotulo?: string }) {
  useEffect(() => {
    if (!automatico) return
    // Um respiro para as fontes e os SVGs terminarem de desenhar.
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [automatico])

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="nao-imprime botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta"
    >
      {rotulo}
    </button>
  )
}
