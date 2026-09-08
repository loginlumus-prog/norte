'use client'

// O texto que se escreve e se apaga sozinho.
//
// ── por que este é o único laço infinito da página ───────────
// A regra do sistema é que movimento acontece uma vez: laço vira ruído que a
// pessoa aprende a ignorar, e junto com ele ela ignora o que era para ser
// visto. Aqui a repetição É o conteúdo — a lista do que se pode definir no
// assistente é longa demais para caber numa linha, e o que a peça diz é
// justamente "tem mais coisa do que cabe aqui". Uma linha parada diria uma
// coisa só; o rodízio diz oito.
//
// ── nada nasce vazio ─────────────────────────────────────────
// O primeiro item começa INTEIRO na tela, e o rodízio começa apagando. Assim
// quem chega sem JavaScript, com movimento reduzido ligado ou no primeiro
// quadro da página lê uma frase completa, nunca um cursor sozinho.
//
// ── e o leitor de tela lê a lista, não a digitação ───────────
// A linha animada é `aria-hidden`; do lado dela mora a lista inteira em
// `sr-only`. Anunciar caractere por caractere seria insuportável, e a
// informação verdadeira é o conjunto.

import { useEffect, useState } from 'react'

const ESCREVE = 55 // ms por caractere na ida
const APAGA = 26 // a volta é mais rápida: apagar não se lê
const LEITURA = 1900 // parada com a frase inteira na tela
const TROCA = 260 // respiro entre uma frase e a próxima

export function Digitando({ itens, className }: { itens: string[]; className?: string }) {
  const [i, setI] = useState(0)
  // Começa com o primeiro item inteiro — ver "nada nasce vazio".
  const [n, setN] = useState(itens[0]?.length ?? 0)
  const [apagando, setApagando] = useState(false)
  const [anima, setAnima] = useState(false)

  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setAnima(true)
  }, [])

  useEffect(() => {
    if (!anima) return
    const alvo = itens[i] ?? ''

    const proximo = () => {
      if (!apagando) {
        if (n < alvo.length) return { espera: ESCREVE, faz: () => setN(n + 1) }
        return { espera: LEITURA, faz: () => setApagando(true) }
      }
      if (n > 0) return { espera: APAGA, faz: () => setN(n - 1) }
      return {
        espera: TROCA,
        faz: () => {
          setApagando(false)
          setI((k) => (k + 1) % itens.length)
        },
      }
    }

    const { espera, faz } = proximo()
    const t = setTimeout(faz, espera)
    return () => clearTimeout(t)
  }, [anima, i, n, apagando, itens])

  return (
    <span className={className}>
      <span aria-hidden>
        {(itens[i] ?? '').slice(0, n)}
        <span className="cursor-digita">|</span>
      </span>
      <span className="sr-only">{itens.join('; ')}.</span>
    </span>
  )
}
