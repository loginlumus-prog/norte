'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Pedido em andamento: a página se atualiza sozinha a cada 30 segundos. */
export function Atualizar() {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, 30_000)
    return () => clearInterval(t)
  }, [router])
  return null
}

export function CopiarPix({ chave }: { chave: string }) {
  const [copiou, setCopiou] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-xl border border-borda bg-superficie-2 px-3 py-2">
      <code className="min-w-0 flex-1 truncate text-sm text-tinta">{chave}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(chave)
            setCopiou(true)
            setTimeout(() => setCopiou(false), 2000)
          } catch {
            // Sem permissão de copiar: a chave está à vista para copiar à mão.
          }
        }}
        className="shrink-0 rounded-lg bg-marca px-3 py-1.5 text-xs font-bold text-marca-tinta"
      >
        {copiou ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
