'use client'

// Os três ganchos que decidem se a página de venda pode se mexer AGORA.
//
// ── a regra ──────────────────────────────────────────────────
// Movimento só roda quando alguém pode ver: a peça está na tela, a aba do
// navegador está na frente, e a pessoa não pediu menos movimento no sistema.
// Faltou qualquer um dos três, o relógio para — não gasta bateria de quem
// deixou a página aberta atrás de outra aba, e não anima o que ninguém lê.
//
// ── e o que o servidor vê ────────────────────────────────────
// No servidor e no primeiro quadro do navegador os três dizem "parado". A
// primeira pintura é sempre o quadro estático e completo; o movimento só
// começa depois de o navegador confirmar que pode.

import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * A pessoa pediu menos movimento? `null` enquanto o navegador não disse — no
 * servidor e no primeiro quadro. Quem decide mexer trata `null` como "ainda
 * não": nada roda antes da resposta.
 */
export function useMenosMovimento(): boolean | null {
  const [menos, setMenos] = useState<boolean | null>(null)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const ler = () => setMenos(m.matches)
    ler()
    m.addEventListener('change', ler)
    return () => m.removeEventListener('change', ler)
  }, [])
  return menos
}

/** A peça está na tela E a aba está na frente. */
export function useVisivel(alvo: RefObject<HTMLElement | null>, limiar = 0.15): boolean {
  const [naTela, setNaTela] = useState(false)
  const [aba, setAba] = useState(true)

  useEffect(() => {
    const el = alvo.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setNaTela(!!e?.isIntersecting), {
      threshold: limiar,
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [alvo, limiar])

  useEffect(() => {
    const ler = () => setAba(document.visibilityState === 'visible')
    ler()
    document.addEventListener('visibilitychange', ler)
    return () => document.removeEventListener('visibilitychange', ler)
  }, [])

  return naTela && aba
}

/**
 * O número que corre do valor antigo até o novo.
 *
 * Mostra o valor certo no servidor e no primeiro quadro. Quando `valor` muda
 * e `anima` é verdadeiro, corre em `duracao` ms com desaceleração no fim;
 * quando `anima` é falso (menos movimento, ou a virada do dia da vitrine),
 * pula direto.
 */
export function useCorrendo(valor: number, anima: boolean, duracao = 700): number {
  const [mostra, setMostra] = useState(valor)
  const atual = useRef(valor)

  useEffect(() => {
    const de = atual.current
    if (!anima || de === valor) {
      atual.current = valor
      setMostra(valor)
      return
    }
    let quadro = 0
    const inicio = performance.now()
    const passo = (agora: number) => {
      const t = Math.min((agora - inicio) / duracao, 1)
      const suave = 1 - Math.pow(1 - t, 3)
      const v = de + (valor - de) * suave
      atual.current = v
      setMostra(v)
      if (t < 1) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [valor, anima, duracao])

  return mostra
}
