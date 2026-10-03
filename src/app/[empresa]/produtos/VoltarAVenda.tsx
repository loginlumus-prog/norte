'use client'

// "Reativar": pôr de volta no balcão o produto excluído ou tirado de venda.
//
// Sem pergunta de confirmação: voltar a vender não perde nada e se desfaz na
// própria ficha. O que precisa de cuidado é o contrário — tirar de venda —, e
// esse continua na ficha, com o aviso de que ele some do balcão.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { voltarAVenda } from './acoes'

export function VoltarAVenda({ slug, produtoId }: { slug: string; produtoId: string }) {
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={indo}
        aria-busy={indo || undefined}
        onClick={() =>
          comecar(async () => {
            setErro(null)
            const r = await voltarAVenda(slug, produtoId)
            if (r.erro) {
              setErro(r.erro)
              return
            }
            router.refresh()
          })
        }
        title="Volta ao balcão, com a grade e o saldo"
        className="rounded-norte border border-marca px-2.5 py-1 text-xs font-semibold text-marca hover:bg-marca-suave disabled:opacity-55"
      >
        {indo ? 'reativando…' : 'Reativar'}
      </button>
      {erro && <span className="font-medium text-critico">{erro}</span>}
    </span>
  )
}
