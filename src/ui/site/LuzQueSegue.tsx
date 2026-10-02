'use client'

// A luz do bento que segue o mouse: um ouvinte só na grade, que escreve a
// posição do ponteiro (--x, --y) no bloco embaixo dele. O desenho é CSS
// (`.site-bloco::before`); sem JavaScript, o bloco só não ganha a luz.

import { useRef, type ReactNode } from 'react'

export function LuzQueSegue({ children, className }: { children: ReactNode; className?: string }) {
  const raiz = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={raiz}
      className={className}
      onPointerMove={(e) => {
        const bloco = (e.target as HTMLElement).closest<HTMLElement>('.site-bloco')
        if (!bloco || !raiz.current?.contains(bloco)) return
        const r = bloco.getBoundingClientRect()
        bloco.style.setProperty('--x', `${e.clientX - r.left}px`)
        bloco.style.setProperty('--y', `${e.clientY - r.top}px`)
      }}
    >
      {children}
    </div>
  )
}
