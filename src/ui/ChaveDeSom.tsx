'use client'

// O alto-falante do cabeçalho: liga e desliga os sons do sistema (sons.ts)
// neste aparelho. Ao ligar, toca o "sucesso" — a pessoa ouve o que ligou.

import { useEffect, useState } from 'react'
import { EVENTO_SOM, ligarSons, sonsLigados, tocar } from './sons'
import { cx } from './base'

export function ChaveDeSom({ tom = 'papel' }: { tom?: 'papel' | 'lado' }) {
  const [ligado, setLigado] = useState(true)
  useEffect(() => {
    setLigado(sonsLigados())
    const mudou = () => setLigado(sonsLigados())
    window.addEventListener(EVENTO_SOM, mudou)
    return () => window.removeEventListener(EVENTO_SOM, mudou)
  }, [])
  return (
    <button
      type="button"
      onClick={() => {
        const novo = !ligado
        ligarSons(novo)
        setLigado(novo)
        if (novo) tocar('sucesso')
      }}
      aria-pressed={ligado}
      aria-label={ligado ? 'Desligar os sons' : 'Ligar os sons'}
      title={ligado ? 'Sons ligados' : 'Sons desligados'}
      className={cx(
        'grid size-8 place-items-center rounded-norte border transition-all active:scale-90',
        tom === 'lado'
          ? 'border-lado-borda text-lado-tinta-2 hover:bg-lado-2 hover:text-lado-tinta'
          : 'border-borda bg-superficie text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
      )}
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8v4h3l4 3.5v-11L6.5 8z" />
        {ligado ? (
          <>
            <path d="M13.5 7.5a3.5 3.5 0 0 1 0 5" />
            <path d="M15.6 5.5a6.5 6.5 0 0 1 0 9" />
          </>
        ) : (
          <path d="m13.5 8 4 4m0-4-4 4" />
        )}
      </svg>
    </button>
  )
}
