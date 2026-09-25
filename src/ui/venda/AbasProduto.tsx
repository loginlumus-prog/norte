'use client'

// "O sistema por dentro": as abas que trocam a tela mostrada.
//
// ── o padrão, e por que ele serve aqui ───────────────────────
// É o desenho das ferramentas que o dono citou: uma fileira de abas com os
// módulos, e embaixo a tela daquele módulo, grande. Serve porque responde a
// pergunta que a pessoa tem ("e o estoque, como é?") sem obrigá-la a rolar
// por seis seções para achar — ela escolhe, e a página muda no lugar.
//
// ── as telas chegam PRONTAS do servidor ──────────────────────
// Este componente não desenha tela nenhuma: recebe as seis já montadas (ver
// `Telas.tsx`) e decide qual fica à vista. As outras continuam no HTML com
// `hidden` — o buscador lê as seis, e trocar de aba é instantâneo.
//
// ── nada nasce invisível ─────────────────────────────────────
// A primeira aba já vem aberta do servidor. A animação de troca só existe
// depois do primeiro clique: na carga, a tela está lá, parada.
//
// ── teclado ──────────────────────────────────────────────────
// Padrão de abas do WAI: setas andam e já trocam, Home e End vão às pontas,
// só a aba ativa entra no Tab. As abas têm `id="tela-…"`: o painel "Produto"
// da barra aponta para elas, o navegador rola até a aba sozinho, e aqui o
// endereço abre a aba certa.
//
// ── sem troca automática ─────────────────────────────────────
// As referências trocam de aba sozinhas a cada poucos segundos. Aqui não: a
// pessoa está lendo as três frases ao lado, e a tela mudar debaixo dela é o
// jeito mais rápido de fazê-la perder a linha. Quem troca é quem lê.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconeVisto } from '../Icones'

export type Aba = {
  id: string
  titulo: string
  icone: ReactNode
  /** O título grande ao lado da tela. */
  chamada: string
  /** Exatamente três: o que a tela faz. */
  frases: [string, string, string]
  /** Em que plano isto existe — lido da tabela de planos, nunca à mão. */
  plano: string
  tela: ReactNode
}

export function AbasProduto({ abas }: { abas: Aba[] }) {
  const [ativa, setAtiva] = useState(abas[0]!.id)
  const [mexeu, setMexeu] = useState(false)
  const botoes = useRef<Map<string, HTMLButtonElement>>(new Map())

  useEffect(() => {
    const ler = () => {
      const h = window.location.hash.replace('#tela-', '')
      if (abas.some((a) => a.id === h)) {
        setAtiva(h)
        setMexeu(true)
      }
    }
    ler()
    window.addEventListener('hashchange', ler)
    return () => window.removeEventListener('hashchange', ler)
  }, [abas])

  function escolher(id: string, focar = false) {
    setAtiva(id)
    setMexeu(true)
    const b = botoes.current.get(id)
    if (focar) b?.focus()
    // A aba escolhida pelo teclado pode estar fora da fileira no celular.
    b?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function teclas(e: React.KeyboardEvent, id: string) {
    const i = abas.findIndex((a) => a.id === id)
    const n = abas.length
    const alvo =
      e.key === 'ArrowRight'
        ? abas[(i + 1) % n]
        : e.key === 'ArrowLeft'
          ? abas[(i - 1 + n) % n]
          : e.key === 'Home'
            ? abas[0]
            : e.key === 'End'
              ? abas[n - 1]
              : undefined
    if (!alvo) return
    e.preventDefault()
    escolher(alvo.id, true)
  }

  return (
    <div className="flex flex-col gap-8">
      {/* A fileira. No celular ela rola de lado DENTRO dela — a página nunca.
          `relative` porque é caixa que rola: qualquer peça absoluta lá
          dentro fica presa nela em vez de esticar a página. */}
      <div className="relative -mx-4 sm:mx-0">
        <div
          role="tablist"
          aria-label="Telas do Norte"
          className="sem-barra flex gap-1.5 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0"
        >
          {abas.map((a) => {
            const sim = a.id === ativa
            return (
              <button
                key={a.id}
                id={`tela-${a.id}`}
                ref={(el) => {
                  if (el) botoes.current.set(a.id, el)
                }}
                type="button"
                role="tab"
                aria-selected={sim}
                aria-controls={`painel-${a.id}`}
                tabIndex={sim ? 0 : -1}
                onClick={() => escolher(a.id)}
                onKeyDown={(e) => teclas(e, a.id)}
                className={
                  'flex shrink-0 scroll-mt-28 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors ' +
                  (sim
                    ? 'border-transparent bg-tinta text-superficie shadow-norte'
                    : 'border-borda bg-superficie text-tinta-2 hover:border-tinta-3 hover:text-tinta')
                }
              >
                <span aria-hidden className={sim ? 'text-superficie' : 'text-marca'}>
                  {a.icone}
                </span>
                {a.titulo}
              </button>
            )
          })}
        </div>
      </div>

      {abas.map((a) => {
        const sim = a.id === ativa
        return (
          <div
            key={a.id}
            id={`painel-${a.id}`}
            role="tabpanel"
            aria-labelledby={`tela-${a.id}`}
            hidden={!sim}
            className={
              'grid items-center gap-8 rounded-3xl border border-borda-suave bg-fundo p-5 sm:p-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)] lg:gap-12 lg:p-10 ' +
              (mexeu && sim ? 'aba-entra' : '')
            }
          >
            <div className="flex flex-col gap-5">
              <h3 className="text-[1.75rem] leading-[1.1] text-balance sm:text-[2rem]">{a.chamada}</h3>
              <ul className="flex flex-col gap-3.5">
                {a.frases.map((f) => (
                  <li key={f} className="flex gap-3 text-[15px] leading-relaxed text-tinta-2 sm:text-base">
                    <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-marca-suave text-marca">
                      <IconeVisto tamanho={12} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-tinta-3">{a.plano}</p>
            </div>
            <div className="min-w-0">{a.tela}</div>
          </div>
        )
      })}
    </div>
  )
}
