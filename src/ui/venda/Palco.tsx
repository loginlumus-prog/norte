'use client'

// O palco do topo: a seção inteira, com a luz andando atrás.
//
// Existe por um motivo só: saber quando o topo está sendo visto. A luz e o
// fio de sol do título rodam em laço, e laço que ninguém vê é bateria gasta —
// então, fora da tela ou com a aba atrás, o palco põe `data-parado` e o CSS
// congela tudo onde está (ver "página de venda: vida" no globals.css).
//
// No servidor ele nasce parado: a primeira pintura é o quadro quieto, e o
// movimento acorda quando o navegador confirma que alguém está olhando. O que
// ENTRA na carga (as palavras do título) não é congelado — entrada presa no
// meio seria texto invisível esperando JavaScript.

import { useRef, type ReactNode } from 'react'
import { useVisivel } from './vivo'

export function Palco({
  id,
  className,
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  const alvo = useRef<HTMLElement>(null)
  const visivel = useVisivel(alvo, 0)

  return (
    <section ref={alvo} id={id} className={className} data-parado={visivel ? undefined : ''}>
      <div aria-hidden className="luz-palco">
        <i />
        <i />
        <i />
      </div>
      {children}
    </section>
  )
}
