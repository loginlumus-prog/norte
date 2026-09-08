'use client'

// A lista de capacidades que passa sozinha no topo da página.
//
// ── por que uma lista que se move, e não um parágrafo ────────
// Quem chega na página tem uma pergunta só: "isso serve pra mim?". Parágrafo
// exige leitura; a lista rolando entrega oito respostas em oito segundos, e a
// pessoa só precisa reconhecer UMA para continuar descendo.
//
// ── e por que são frases do dono, não recursos ───────────────
// "Controle de estoque" é o que o vendedor de software diz. "Saber o que não
// está vendendo" é o que o dono da loja pensa às onze da noite. A lista fala a
// segunda língua — cada linha é uma frase que ele já disse em voz alta.
//
// ── acessibilidade ──────────────────────────────────────────
// Todas as frases existem no HTML o tempo todo, empilhadas. O que muda é o
// destaque visual, não a presença: leitor de tela lê a lista inteira de uma
// vez, e quem pediu menos movimento vê todas paradas.

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

const TROCA = 2600

export function HeroRolante() {
  const [ativa, setAtiva] = useState(0)
  // Enquanto for falso, TODAS as frases aparecem legíveis e nenhuma é apagada.
  // É isso que cumpre a regra "nada nasce invisível": sem JavaScript, com o
  // JavaScript ainda carregando, ou com movimento reduzido, a lista inteira se
  // lê. O rodízio é um acréscimo, não a condição de existir.
  const [rodando, setRodando] = useState(false)

  useEffect(() => {
    const menos = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (menos.matches) return

    setRodando(true)
    const t = setInterval(() => setAtiva((i) => (i + 1) % FRASES.length), TROCA)

    // Ouve a preferência DEPOIS de montar também: quem liga "menos movimento"
    // com a página aberta tinha o carrossel continuando para sempre.
    const parar = () => {
      if (menos.matches) {
        clearInterval(t)
        setRodando(false)
      }
    }
    menos.addEventListener('change', parar)

    return () => {
      clearInterval(t)
      menos.removeEventListener('change', parar)
    }
  }, [])

  return (
    <ul className="flex flex-col gap-1.5 sm:gap-2">
      {FRASES.map((f, i) => {
        // Só apaga as outras quando o rodízio está de fato rodando.
        const acesa = !rodando || i === ativa
        return (
          <li
            key={f}
            className="flex items-center gap-2.5 transition-[opacity,transform] duration-500 sm:gap-3"
            style={{
              opacity: acesa ? 1 : 0.3,
              transform: acesa ? 'translateX(0)' : 'translateX(-4px)',
            }}
          >
            {/* O marcador existe sempre — o que muda é a cor, nunca a
                presença. Transparente seria "nasce invisível" de novo, só que
                num pedaço pequeno. Triângulo e não bolinha: bolinha lê como
                item de lista, seta lê como "é esta". */}
            <span
              aria-hidden
              className="shrink-0 text-[10px] transition-colors duration-500"
              style={{ color: rodando && i !== ativa ? 'var(--nav-borda)' : 'var(--sol-claro)' }}
            >
              ▶
            </span>
            <span
              className="text-lg leading-tight font-semibold tracking-tight text-nav-tinta text-balance sm:text-xl md:text-2xl"
              style={{ color: acesa ? undefined : 'var(--nav-tinta-2)' }}
            >
              {f}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
