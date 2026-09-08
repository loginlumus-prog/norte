'use client'

// O seletor de período do painel.
//
// ── por que ele vive no endereço ─────────────────────────────
// O período escolhido vira `?periodo=90d`. Guardado em estado escondido, o
// link que a pessoa manda para o contador abre com OUTRO recorte, e os dois
// discutem números diferentes achando que são os mesmos. No endereço, o link
// é a pergunta inteira — e voltar no navegador desfaz a escolha, que é o que
// qualquer pessoa espera do botão de voltar.
//
// ── por que Link e não botão ─────────────────────────────────
// Cada opção é uma navegação de verdade: funciona sem JavaScript, abre em
// nova aba com o meio do mouse, e o Next já traz o dado antes do clique.

'use no memo'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { PERIODOS, type Periodo } from '@/servidor/periodo'

export function SeletorPeriodo({ atual }: { atual: Periodo }) {
  const caminho = usePathname()
  const busca = useSearchParams()

  // Preserva o resto do endereço: trocar o período não pode desfazer a
  // unidade que a pessoa escolheu dois cliques atrás.
  const enderecoDe = (p: Periodo) => {
    const q = new URLSearchParams(busca.toString())
    q.set('periodo', p)
    return `${caminho}?${q.toString()}`
  }

  return (
    <nav
      aria-label="Período"
      className="flex flex-wrap items-center gap-0.5 rounded-norte border border-borda bg-superficie p-0.5"
    >
      {PERIODOS.map((p) => {
        const aceso = p.chave === atual
        return (
          <Link
            key={p.chave}
            href={enderecoDe(p.chave)}
            aria-current={aceso ? 'page' : undefined}
            className={
              'rounded-[5px] px-2.5 py-1 text-xs font-semibold transition-colors ' +
              (aceso
                ? 'bg-marca text-marca-tinta'
                : 'text-tinta-2 hover:bg-superficie-2 hover:text-tinta')
            }
          >
            {p.curto}
          </Link>
        )
      })}
    </nav>
  )
}
