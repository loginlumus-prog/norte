'use client'

// Achar um item do catálogo para pôr no pedido (ou no material usado):
// nome, código da etiqueta ou código de barras. Espera a digitação parar
// antes de perguntar ao servidor, como a busca da encomenda.

import { useEffect, useState } from 'react'
import { Campo } from '@/ui/base'
import type { ItemParaComprar } from '@/servidor/compras'

export function BuscaItem({
  buscar,
  aoEscolher,
  mostrarCusto,
  rotulo = 'Adicionar item',
}: {
  buscar: (termo: string) => Promise<ItemParaComprar[]>
  aoEscolher: (i: ItemParaComprar) => void
  mostrarCusto: boolean
  rotulo?: string
}) {
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<ItemParaComprar[]>([])

  useEffect(() => {
    if (termo.trim().length < 2) {
      setAchados([])
      return
    }
    const t = setTimeout(() => {
      buscar(termo).then(setAchados).catch(() => setAchados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [termo, buscar])

  return (
    <div className="relative flex flex-col">
      <Campo
        rotulo={rotulo}
        name="busca-item"
        value={termo}
        onChange={(ev) => setTermo(ev.currentTarget.value)}
        autoComplete="off"
        placeholder="Nome ou código: esmalte, luva, acetona"
      />
      {achados.length > 0 && (
        <ul
          role="listbox"
          aria-label="Itens do catálogo"
          className="realce absolute top-full right-0 left-0 z-20 mt-1 flex max-h-72 flex-col overflow-y-auto rounded-norte border border-borda bg-superficie py-1"
        >
          {achados.map((i) => (
            <li key={i.variacaoId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  aoEscolher(i)
                  setTermo('')
                  setAchados([])
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-superficie-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-tinta">{i.descricao}</span>
                  <span className="text-xs text-tinta-3">
                    {i.codigo ?? 'sem código'} · tem {i.saldo.toLocaleString('pt-BR')}
                  </span>
                </span>
                {mostrarCusto && i.custo != null && (
                  <span className="numero shrink-0 text-xs text-tinta-2">
                    custo {i.custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
