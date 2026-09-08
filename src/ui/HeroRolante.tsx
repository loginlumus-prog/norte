'use client'

// A frase que troca sozinha no topo da página.
//
// ── por que virou UMA linha, e não oito ──────────────────────
// A primeira versão empilhava as oito frases e acendia uma por vez. Duas
// coisas davam errado: sete oitavos da coluna ficavam apagados (o que é feio e
// desperdiça o lugar mais nobre da página), e a pilha competia com o título —
// dois blocos de texto grande lado a lado, e o olho não sabe qual ler.
//
// Uma linha só resolve os dois: o título manda, e embaixo dele passa a
// promessa, uma de cada vez, no lugar onde a pessoa já está olhando.
//
// ── por que a fonte aqui é a de TEXTO, não a de título ───────
// São frases curtas de interface, não manchete. Em serifada leve elas ficavam
// finas e ornamentadas — bonito no título, errado numa lista de promessas. Em
// Manrope, peso médio, elas soam como afirmação.
//
// ── nada nasce invisível ─────────────────────────────────────
// As oito frases existem no HTML o tempo todo; só uma fica visível por vez, e
// as outras saem por `hidden`, não por opacidade. Leitor de tela lê a lista
// inteira; sem JavaScript, aparece a primeira — que já é uma frase completa.

import { useEffect, useState } from 'react'

const FRASES = [
  'Fechar o caixa sem calculadora',
  'Saber o que não está vendendo',
  'Responder cliente às 22h',
  'Descobrir a peça que vai faltar antes de faltar',
  'Ver as duas lojas na mesma tela',
  'Saber quanto sobrou de verdade no mês',
  'Cobrar quem sumiu, sem constranger',
  'Dar acesso sem dar a sua senha',
]

const TROCA = 2800

export function HeroRolante() {
  const [ativa, setAtiva] = useState(0)

  useEffect(() => {
    const menos = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (menos.matches) return

    const t = setInterval(() => setAtiva((i) => (i + 1) % FRASES.length), TROCA)

    // Ouve a preferência depois de montar também: quem liga "menos movimento"
    // com a página aberta ficava com o rodízio girando para sempre.
    const parar = () => menos.matches && clearInterval(t)
    menos.addEventListener('change', parar)

    return () => {
      clearInterval(t)
      menos.removeEventListener('change', parar)
    }
  }, [])

  return (
    <div className="flex items-center gap-3 border-t border-white/15 pt-5">
      <span
        aria-hidden
        className="shrink-0 text-[11px] text-sol-claro"
        style={{ transform: 'translateY(-1px)' }}
      >
        ▶
      </span>
      {/* Altura fixa: sem ela a página inteira pula quando entra uma frase de
          duas linhas. */}
      <span className="relative flex min-h-[3.25rem] flex-1 items-center sm:min-h-[2.5rem]">
        {FRASES.map((f, i) => (
          <span
            key={f}
            hidden={i !== ativa}
            className="font-[family-name:var(--font-sans)] text-lg leading-snug font-semibold tracking-tight text-nav-tinta text-balance sm:text-xl"
          >
            {f}
          </span>
        ))}
      </span>
    </div>
  )
}
