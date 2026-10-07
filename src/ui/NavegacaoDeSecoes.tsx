'use client'

// A fileira de atalhos de um formulário longo (a ficha do produto, a do
// cliente): "O que é · Quanto custa · Estoque · Vendido em · Como varia".
//
// Ela se monta sozinha: lê os títulos (h2) do pedaço de tela em que está,
// dá um endereço a cada um e vira uma faixa presa logo abaixo do cabeçalho.
// Tocar leva à seção; rolar acende a seção que está na tela. Nenhuma tela
// precisa listar as próprias seções — título novo entra sozinho.

import { useEffect, useRef, useState } from 'react'
import { cx } from './base'

const fatiar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export function NavegacaoDeSecoes({ seletor = 'h2' }: { seletor?: string }) {
  const raiz = useRef<HTMLElement>(null)
  const [secoes, setSecoes] = useState<{ id: string; titulo: string }[]>([])
  const [atual, setAtual] = useState<string | null>(null)

  useEffect(() => {
    const dono = raiz.current?.parentElement
    if (!dono) return
    const titulos = [...dono.querySelectorAll<HTMLElement>(seletor)].filter((h) => !raiz.current?.contains(h) && h.textContent?.trim())
    const lista = titulos.map((h, i) => {
      const titulo = h.textContent!.trim()
      const id = h.id || `secao-${fatiar(titulo) || i}`
      h.id = id
      h.style.scrollMarginTop = '8.5rem'
      return { id, titulo }
    })
    setSecoes(lista)
    if (lista.length === 0) return
    setAtual(lista[0]!.id)
    const o = new IntersectionObserver(
      (es) => {
        const visivel = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visivel) setAtual(visivel.target.id)
      },
      { rootMargin: '-140px 0px -65% 0px' },
    )
    titulos.forEach((h) => o.observe(h))
    return () => o.disconnect()
  }, [seletor])

  // Mantém a pílula acesa à vista quando a faixa rola de lado (celular).
  const faixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!atual) return
    faixa.current?.querySelector<HTMLElement>(`[data-secao="${atual}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [atual])

  return (
    <nav
      ref={raiz}
      aria-label="Seções"
      className={cx('sticky top-[4.25rem] z-20 -mx-1 rounded-2xl border border-borda/80 bg-superficie/85 p-1 shadow-[0_8px_24px_-18px_rgb(15_23_42/0.35)] backdrop-blur-xl', secoes.length < 2 && 'hidden')}
    >
      <div ref={faixa} className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {secoes.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-secao={s.id}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              setAtual(s.id)
            }}
            aria-current={atual === s.id ? 'true' : undefined}
            className={cx(
              'shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors',
              atual === s.id ? 'bg-[var(--cor-item,var(--marca))] text-white shadow-[0_6px_14px_-8px_var(--cor-item,var(--marca))]' : 'text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
            )}
          >
            {s.titulo}
          </a>
        ))}
      </div>
    </nav>
  )
}
