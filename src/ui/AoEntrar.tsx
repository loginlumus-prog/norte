'use client'

// O movimento das peças da página de venda.
//
// ── a regra que decide o desenho ─────────────────────────────
// NADA NASCE INVISÍVEL. O jeito comum de fazer isto é pôr o bloco em
// `opacity: 0` e acender quando ele entra na tela — e aí três coisas quebram
// de uma vez: quem rola rápido vê buraco, quem tem JavaScript bloqueado vê
// página vazia, e o buscador indexa uma página em branco.
//
// Aqui é o contrário: a peça já está legível parada. A animação é aplicada
// SÓ quando o bloco entra, e um `@keyframes` só existe enquanto roda — antes e
// depois, o elemento está no estado final. Se o JavaScript nunca rodar, a
// página inteira continua certa; só não se mexe.
//
// ── e por que uma vez só ─────────────────────────────────────
// Movimento chama atenção uma vez. Repetir em laço vira ruído que a pessoa
// aprende a ignorar — e junto com ele ela ignora o que era para ser visto. A
// única exceção do sistema é a proposta do assistente, que respira porque
// espera resposta.

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Marca o bloco com `data-entrou` quando ele aparece na tela, uma vez.
 *
 * O CSS pendura as animações nesse atributo. Quem pediu menos movimento no
 * sistema operacional recebe o atributo do mesmo jeito — quem desliga o
 * movimento é o `prefers-reduced-motion` lá no globals.css, num lugar só.
 */
export function AoEntrar({
  children,
  className,
  atraso = 0,
}: {
  children: ReactNode
  className?: string
  /** Segundos de espera depois de aparecer. Para escalonar peças vizinhas. */
  atraso?: number
}) {
  const alvo = useRef<HTMLDivElement>(null)
  const [entrou, setEntrou] = useState(false)

  useEffect(() => {
    const el = alvo.current
    if (!el) return

    // Já está na tela no primeiro quadro (topo da página): anima sem esperar
    // observador, senão a peça de cima é a única que nunca se mexe.
    const observador = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setEntrou(true)
          observador.disconnect()
        }
      },
      // 18% dentro: anima quando a peça já está sendo lida, não quando a
      // primeira linha dela raspa a borda de baixo.
      { threshold: 0.18 },
    )

    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  return (
    <div
      ref={alvo}
      className={className}
      data-entrou={entrou ? '' : undefined}
      style={atraso ? ({ '--atraso': `${atraso}s` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  )
}

/**
 * Número que conta até o valor.
 *
 * Começa mostrando o valor FINAL — a mesma regra de cima. Quando a peça entra,
 * ele volta ao início e corre até o fim. Assim quem chega com a animação já
 * passada lê o número certo, e quem chega a tempo vê a conta acontecer.
 */
export function Contando({
  ate,
  de = 0,
  duracao = 500,
  formatar,
  className,
}: {
  ate: number
  de?: number
  duracao?: number
  formatar: (v: number) => string
  className?: string
}) {
  const [valor, setValor] = useState(ate)
  const alvo = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = alvo.current
    if (!el) return

    // Quem pediu menos movimento não vê a contagem: o número já está certo.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const observador = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return
        observador.disconnect()

        const inicio = performance.now()
        const passo = (agora: number) => {
          const t = Math.min((agora - inicio) / duracao, 1)
          // Desacelera no fim: número que para de repente parece defeito.
          const suave = 1 - Math.pow(1 - t, 3)
          setValor(de + (ate - de) * suave)
          if (t < 1) requestAnimationFrame(passo)
          else setValor(ate)
        }
        setValor(de)
        requestAnimationFrame(passo)
      },
      { threshold: 0.4 },
    )

    observador.observe(el)
    return () => observador.disconnect()
  }, [ate, de, duracao])

  return (
    <span ref={alvo} className={className}>
      {formatar(valor)}
    </span>
  )
}
