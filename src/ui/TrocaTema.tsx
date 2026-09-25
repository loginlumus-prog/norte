'use client'

// Claro, escuro ou o que o sistema mandar.
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

import { useEffect, useState } from 'react'
import { cx } from './base'

export type Tema = 'claro' | 'escuro' | 'sistema'

const OPCOES: { valor: Tema; titulo: string; icone: string }[] = [
  { valor: 'claro', titulo: 'Claro', icone: '☀' },
  { valor: 'escuro', titulo: 'Escuro', icone: '☾' },
  { valor: 'sistema', titulo: 'Do sistema', icone: '⌘' },
]

/** Sobre o azul-noite da barra, ou sobre o papel da página de venda. */
type Tom = 'nav' | 'papel' | 'lado'

const TOM: Record<Tom, { caixa: string; ativo: string; parado: string }> = {
  nav: {
    caixa: 'border-nav-borda bg-nav-2',
    ativo: 'bg-nav-tinta text-nav',
    parado: 'text-nav-tinta-2 hover:bg-nav-3 hover:text-nav-tinta',
  },
  // A barra lateral: branca no claro, azul-noite no escuro. Segue as fichas
  // dela em vez de fixar um dos dois lados.
  lado: {
    caixa: 'border-lado-borda bg-lado-2',
    ativo: 'bg-lado text-lado-ativo shadow-norte',
    parado: 'text-lado-tinta-2 hover:text-lado-tinta',
  },
  papel: {
    caixa: 'border-borda bg-superficie-2',
    ativo: 'bg-tinta text-superficie',
    parado: 'text-tinta-3 hover:bg-superficie hover:text-tinta',
  },
}

function doCookie(): Tema | undefined {
  const achado = document.cookie.match(/(?:^|;\s*)tema=(claro|escuro|sistema)/)
  return achado?.[1] as Tema | undefined
}

export function TrocaTema({ inicial, tom = 'nav' }: { inicial?: Tema; tom?: Tom }) {
  const [tema, setTema] = useState<Tema>(inicial ?? 'sistema')
  /** Só depois disto o componente pode escrever no <html> e no cookie. */
  const [sabe, setSabe] = useState(inicial !== undefined)

  useEffect(() => {
    if (inicial !== undefined) return
    setTema(doCookie() ?? 'sistema')
    setSabe(true)
  }, [inicial])

  useEffect(() => {
    if (!sabe) return
    const raiz = document.documentElement
    if (tema === 'sistema') raiz.removeAttribute('data-tema')
    else raiz.setAttribute('data-tema', tema)
    // 1 ano; é preferência, não sessão
    document.cookie = `tema=${tema}; path=/; max-age=31536000; samesite=lax`
  }, [tema, sabe])

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
          onClick={() => setTema(o.valor)}
          title={o.titulo}
          aria-label={o.titulo}
          aria-pressed={tema === o.valor}
          className={cx(
            'rounded px-1.5 py-0.5 text-xs transition-colors',
            tema === o.valor ? cores.ativo : cores.parado,
          )}
        >
          {o.icone}
        </button>
      ))}
    </div>
  )
}
