'use client'

// Claro ou escuro. O claro é o padrão.
//
// "Do sistema" saiu em 25/09: com ele, quem tinha o computador no escuro
// abria o Norte preto sem ter escolhido — e o produto é branco. Agora o
// escuro é sempre uma escolha. Cookie velho com `sistema` vale como claro.
//
// Troca sem recarregar a página e sem piscar: mexe direto no <html> e grava o
// cookie para o servidor já mandar certo na próxima visita. O balcão pega sol
// na cara de manhã e o escritório trabalha no escuro à noite — é o mesmo
// cliente, no mesmo dia.
//
// ── por que `inicial` é opcional ─────────────────────────────
// Dentro do sistema quem manda o valor é o servidor: ele já leu o cookie para
// carimbar o <html>, e passar adiante não custa nada. Na página de venda o
// componente se vira sozinho, e aí a página não precisa saber que existe um
// cookie de tema nem carregar um valor de andar em andar só para acender o
// botão certo.
//
// Sem `inicial`, a ordem importa: enquanto ele não leu o cookie, NÃO escreve
// nada. Aplicar o palpite antes de ler apagaria a escolha da pessoa — o <html>
// já vem certo do servidor, e o primeiro efeito o desfaria.

import { useEffect, useState, type ReactNode } from 'react'
import { cx } from './base'

export type Tema = 'claro' | 'escuro' | 'sistema'

// Desenhados, e não "☀"/"☾": o caractere vinha da fonte do aparelho, cada um
// de um tamanho, e a lua apagada mal se via. Mesma grade (24) e mesmo traço
// dos ícones de interface (`Icones.tsx`), pintados pela cor de quem chama.
const traco = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const Sol = () => (
  <svg aria-hidden focusable="false" width="14" height="14" viewBox="0 0 24 24" {...traco}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
)

const Lua = () => (
  <svg aria-hidden focusable="false" width="14" height="14" viewBox="0 0 24 24" {...traco}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </svg>
)

const OPCOES: { valor: Tema; titulo: string; icone: ReactNode }[] = [
  { valor: 'claro', titulo: 'Claro', icone: <Sol /> },
  { valor: 'escuro', titulo: 'Escuro', icone: <Lua /> },
]

/** Avisa as outras chaves da tela (a do cabeçalho e a da gaveta do celular). */
const EVENTO = 'norte:tema'

/** O que vale de fato: tudo que não for escuro é claro. */
export const temaDe = (t: string | undefined | null): 'claro' | 'escuro' =>
  t === 'escuro' ? 'escuro' : 'claro'

/** Sobre o azul-noite da barra, ou sobre o papel da página de venda. */
type Tom = 'nav' | 'papel' | 'lado'

const TOM: Record<Tom, { caixa: string; ativo: string; parado: string }> = {
  nav: {
    caixa: 'border-nav-borda bg-nav-2',
    ativo: 'bg-nav-tinta text-nav',
    parado: 'text-nav-tinta-2 hover:bg-nav-3 hover:text-nav-tinta',
  },
  // A barra lateral: branca no claro, azul-noite no escuro. Segue as fichas
  // dela em vez de fixar um dos dois lados. Igual à chave do modo (`lado`).
  lado: {
    caixa: 'border-lado-borda bg-lado-2',
    ativo: 'bg-lado text-lado-ativo shadow-norte',
    parado: 'text-lado-tinta-2 hover:text-lado-tinta',
  },
  // O cabeçalho: a mesma chave segmentada do Simples/Avançado (`topo` em
  // TrocaModo.tsx). Antes o aceso era um bloco preto, e as duas chaves lado a
  // lado pareciam de sistemas diferentes.
  papel: {
    caixa: 'border-borda bg-superficie-2',
    ativo: 'bg-superficie text-marca shadow-norte',
    parado: 'text-tinta-3 hover:text-tinta',
  },
}

function doCookie(): Tema | undefined {
  const achado = document.cookie.match(/(?:^|;\s*)tema=(claro|escuro|sistema)/)
  return achado?.[1] as Tema | undefined
}

export function TrocaTema({ inicial, tom = 'nav' }: { inicial?: Tema; tom?: Tom }) {
  const [tema, setTema] = useState<Tema>(temaDe(inicial))
  /** Só depois disto o componente pode escrever no <html> e no cookie. */
  const [sabe, setSabe] = useState(inicial !== undefined)

  useEffect(() => {
    if (inicial !== undefined) return
    setTema(temaDe(doCookie()))
    setSabe(true)
  }, [inicial])

  useEffect(() => {
    if (!sabe) return
    const raiz = document.documentElement
    raiz.setAttribute('data-tema', temaDe(tema))
    // 1 ano; é preferência, não sessão
    document.cookie = `tema=${tema}; path=/; max-age=31536000; samesite=lax`
  }, [tema, sabe])

  // Duas chaves na mesma tela (cabeçalho e gaveta): a que não foi tocada
  // acende o lado certo também.
  useEffect(() => {
    const ouvir = (e: Event) => setTema(temaDe((e as CustomEvent<string>).detail))
    window.addEventListener(EVENTO, ouvir)
    return () => window.removeEventListener(EVENTO, ouvir)
  }, [])

  function escolher(t: Tema) {
    setTema(t)
    setSabe(true)
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: t }))
  }

  const cores = TOM[tom]

  return (
    <div
      role="group"
      aria-label="Tema da tela"
      className={cx(
        'inline-flex w-fit items-center gap-0.5 rounded-norte border p-0.5',
        cores.caixa,
      )}
    >
      {OPCOES.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => escolher(o.valor)}
          title={o.titulo}
          aria-label={o.titulo}
          aria-pressed={tema === o.valor}
          className={cx(
            // A altura da chave do modo (py-1 + 16px), para as duas
            // ficarem do mesmo tamanho lado a lado.
            'grid h-6 w-7 place-items-center rounded transition-colors',
            tema === o.valor ? cores.ativo : cores.parado,
          )}
        >
          {o.icone}
        </button>
      ))}
    </div>
  )
}
