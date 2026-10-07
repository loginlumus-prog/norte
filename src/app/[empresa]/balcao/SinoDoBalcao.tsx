'use client'

// O sino do balcão (servidor/avisos-balcao.ts). Pergunta ao servidor a cada
// 45 segundos, e na hora em que a pessoa volta para a aba; acende com o
// número e, quando o número sobe, pulsa — é o "chegou coisa nova" de quem está
// atendendo de costas para a tela. Tocar abre a lista, cada aviso com o
// caminho para resolver. O pedido em montagem fica guardado no aparelho
// (guardar.ts): sair do balcão para ver a encomenda não perde nada.

import { tocar } from '@/ui/sons'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { cx } from '@/ui/base'
import { avisosAcao } from './acoes'
import type { AvisoDoBalcao } from '@/servidor/avisos-balcao'

const A_CADA_MS = 45_000

export function SinoDoBalcao({ slug, unidadeId }: { slug: string; unidadeId: string }) {
  const [avisos, setAvisos] = useState<AvisoDoBalcao[]>([])
  const [aberto, setAberto] = useState(false)
  const [novo, setNovo] = useState(false)
  const antes = useRef(0)
  const primeira = useRef(true)
  const caixa = useRef<HTMLDivElement>(null)

  const total = avisos.reduce((s, a) => s + a.n, 0)

  const buscar = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    try {
      const r = await avisosAcao(slug, unidadeId)
      const n = r.reduce((s, a) => s + a.n, 0)
      // Subiu: acende e toca o sino — menos na primeira olhada, ao abrir a tela.
      if (n > antes.current) {
        setNovo(true)
        if (!primeira.current) tocar('aviso')
      }
      primeira.current = false
      antes.current = n
      setAvisos(r)
    } catch {
      // sem resposta agora: tenta na próxima volta
    }
  }, [slug, unidadeId])

  useEffect(() => {
    void buscar()
    const relogio = setInterval(() => {
      if (document.visibilityState === 'visible') void buscar()
    }, A_CADA_MS)
    const voltou = () => {
      if (document.visibilityState === 'visible') void buscar()
    }
    document.addEventListener('visibilitychange', voltou)
    return () => {
      clearInterval(relogio)
      document.removeEventListener('visibilitychange', voltou)
    }
  }, [buscar])

  // Fecha ao tocar fora.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('pointerdown', fora)
    return () => document.removeEventListener('pointerdown', fora)
  }, [aberto])

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => {
          setAberto((a) => !a)
          setNovo(false)
        }}
        aria-expanded={aberto}
        aria-label={total > 0 ? `Avisos: ${total}` : 'Avisos: nenhum'}
        className={cx(
          'relative inline-flex size-10 items-center justify-center rounded-full border border-borda bg-superficie text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
          total > 0 && 'border-atencao-borda text-atencao',
          novo && 'pulsa pulsa-atencao',
        )}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {total > 0 && (
          <span className="numero absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-critico-vivo px-1 text-[12.5px] font-bold text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {aberto && (
        <div role="dialog" aria-label="Avisos" className="absolute top-12 right-0 z-40 w-72 rounded-2xl border border-borda bg-superficie p-2 shadow-lg">
          {avisos.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-tinta-2">Nada novo por aqui.</p>
          ) : (
            <ul className="flex flex-col">
              {avisos.map((a) => (
                <li key={a.tipo}>
                  <Link
                    href={a.href}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-tinta hover:bg-superficie-2"
                  >
                    <span>{a.texto}</span>
                    <span aria-hidden className="text-tinta-3">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
