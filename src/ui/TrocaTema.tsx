'use client'

// Claro, escuro ou o que o sistema mandar.
//
// Troca sem recarregar a página e sem piscar: mexe direto no <html> e grava o
// cookie para o servidor já mandar certo na próxima visita. O balcão pega sol
// na cara de manhã e o escritório trabalha no escuro à noite — é o mesmo
// cliente, no mesmo dia.

import { useEffect, useState } from 'react'
import { cx } from './base'

export type Tema = 'claro' | 'escuro' | 'sistema'

const OPCOES: { valor: Tema; titulo: string; icone: string }[] = [
  { valor: 'claro', titulo: 'Claro', icone: '☀' },
  { valor: 'escuro', titulo: 'Escuro', icone: '☾' },
  { valor: 'sistema', titulo: 'Do sistema', icone: '⌘' },
]

export function TrocaTema({ inicial }: { inicial: Tema }) {
  const [tema, setTema] = useState<Tema>(inicial)

  useEffect(() => {
    const raiz = document.documentElement
    if (tema === 'sistema') raiz.removeAttribute('data-tema')
    else raiz.setAttribute('data-tema', tema)
    // 1 ano; é preferência, não sessão
    document.cookie = `tema=${tema}; path=/; max-age=31536000; samesite=lax`
  }, [tema])

  return (
    <div
      role="group"
      aria-label="Tema da tela"
      className="inline-flex w-fit items-center gap-0.5 rounded-norte border border-nav-borda bg-nav-2 p-0.5"
    >
      {OPCOES.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => setTema(o.valor)}
          title={o.titulo}
          aria-label={o.titulo}
          aria-pressed={tema === o.valor}
          className={cx(
            'rounded px-1.5 py-0.5 text-xs transition-colors',
            tema === o.valor
              ? 'bg-nav-tinta text-nav'
              : 'text-nav-tinta-2 hover:bg-nav-3 hover:text-nav-tinta',
          )}
        >
          {o.icone}
        </button>
      ))}
    </div>
  )
}
