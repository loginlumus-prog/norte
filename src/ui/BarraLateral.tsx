'use client'

// A lateral do sistema, com o botão que a abre e a recolhe.
//
// As duas formas (a lista completa e o trilho de ícones) chegam PRONTAS do
// servidor, já filtradas pela permissão da pessoa e pelo modo da tela. Aqui
// só se escolhe qual mostrar — então o clique troca na hora, sem ir ao
// servidor, e a escolha vai para o cookie do aparelho (servidor/menu-lateral.ts)
// para a próxima tela já nascer do mesmo tamanho.
//
// Só aparece de `md` para cima. No celular o menu é a gaveta (Gaveta.tsx).

import { useState, type ReactNode } from 'react'
import { cx } from './base'

const COOKIE = 'menu'

export function BarraLateral({
  inicial,
  marcaCompleta,
  navegacao,
  rodape,
  marcaTrilho,
  trilho,
  rodapeTrilho,
}: {
  /** Como a barra nasce: recolhida ou aberta (o servidor leu o cookie). */
  inicial: boolean
  marcaCompleta: ReactNode
  navegacao: ReactNode
  rodape: ReactNode
  marcaTrilho: ReactNode
  trilho: ReactNode
  rodapeTrilho: ReactNode
}) {
  const [recolhida, setRecolhida] = useState(inicial)

  function alternar() {
    const novo = !recolhida
    setRecolhida(novo)
    try {
      // 1 ano, no site inteiro: é do aparelho, não de uma empresa.
      document.cookie = `${COOKIE}=${novo ? 'recolhido' : 'aberto'}; path=/; max-age=31536000; samesite=lax`
    } catch {
      // Sem cookie, a barra ainda troca nesta tela; só não lembra na próxima.
    }
  }

  const botao = (
    <button
      type="button"
      onClick={alternar}
      aria-expanded={!recolhida}
      aria-label={recolhida ? 'Abrir o menu' : 'Recolher o menu'}
      title={recolhida ? 'Abrir o menu' : 'Recolher o menu'}
      className={cx(
        'grid size-7 shrink-0 place-items-center rounded-md text-lado-tinta-2 transition-colors',
        'hover:bg-lado-2 hover:text-lado-tinta focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lado-ativo',
      )}
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none">
        {/* Uma barra e a seta: aponta para onde a lateral vai. */}
        <path d="M3.5 4v12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d={recolhida ? 'M8.5 6.5 12 10l-3.5 3.5' : 'M12 6.5 8.5 10l3.5 3.5'}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )

  if (recolhida) {
    return (
      <aside className="sticky top-0 z-40 hidden h-dvh w-[68px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-lado-borda bg-lado px-2 py-3 md:flex">
        <div className="flex flex-col items-center gap-2">
          {marcaTrilho}
          {botao}
        </div>
        {trilho}
        {rodapeTrilho}
      </aside>
    )
  }

  // Só a lista rola; a marca em cima e a pessoa embaixo ficam presas.
  // Antes a barra inteira rolava, e numa tela de 900px o dono (que vê tudo)
  // perdia Assinatura, Configurações e o "Sair" para baixo da dobra, sem
  // nenhum sinal de que havia mais.
  return (
    <aside className="sticky top-0 z-40 hidden h-dvh w-60 shrink-0 flex-col gap-0.5 border-r border-lado-borda bg-lado p-2.5 md:flex">
      <div className="relative shrink-0">
        {marcaCompleta}
        <span className="absolute top-0.5 right-0">{botao}</span>
      </div>
      <div className="lista-rola -mx-2.5 min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">{navegacao}</div>
      {rodape}
    </aside>
  )
}
