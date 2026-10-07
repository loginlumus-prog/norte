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
import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { PERIODOS, diasEscolhidos, type Periodo } from '@/servidor/periodo'
import { diaEmSP } from '@/servidor/dia'

const ITEM =
  'rounded-[5px] px-2.5 py-1.5 text-center text-xs font-semibold whitespace-nowrap transition-colors sm:py-1 '
const ACESO = 'bg-marca text-marca-tinta'
const APAGADO = 'text-tinta-2 hover:bg-superficie-2 hover:text-tinta'

const curto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

export function SeletorPeriodo({ atual }: { atual: Periodo }) {
  const caminho = usePathname()
  const busca = useSearchParams()
  const router = useRouter()
  const escolhidos = diasEscolhidos(atual)
  const hoje = diaEmSP()
  const [abrir, setAbrir] = useState(false)
  const [de, setDe] = useState(escolhidos?.de ?? hoje)
  const [ate, setAte] = useState(escolhidos?.ate ?? hoje)

  // Preserva o resto do endereço: trocar o período não pode desfazer a
  // unidade que a pessoa escolheu dois cliques atrás.
  const enderecoDe = (p: Periodo) => {
    const q = new URLSearchParams(busca.toString())
    q.set('periodo', p)
    q.delete('pagina')
    return `${caminho}?${q.toString()}`
  }

  // No celular, grade de 4 colunas em vez de fileira que quebra: as opções
  // não cabem em 343px, e a fileira quebrada deixava uma sozinha numa
  // segunda linha, com cara de defeito. Do `sm` para cima volta a ser fileira.
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto">
      <nav
        aria-label="Período"
        className="grid w-full grid-cols-4 gap-0.5 rounded-norte border border-borda bg-superficie p-0.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center"
      >
        {PERIODOS.map((p) => {
          const aceso = p.chave === atual
          return (
            <Link key={p.chave} href={enderecoDe(p.chave)} aria-current={aceso ? 'page' : undefined} className={ITEM + (aceso ? ACESO : APAGADO)}>
              {p.curto}
            </Link>
          )
        })}
        {/* Um dia qualquer (anteontem, a sexta passada) ou de um dia a outro. */}
        <button
          type="button"
          onClick={() => setAbrir((a) => !a)}
          aria-expanded={abrir}
          aria-current={escolhidos ? 'page' : undefined}
          className={ITEM + (escolhidos ? ACESO : APAGADO)}
        >
          {escolhidos ? (escolhidos.de === escolhidos.ate ? curto(escolhidos.de) : `${curto(escolhidos.de)}–${curto(escolhidos.ate)}`) : 'Escolher dias'}
        </button>
      </nav>
      {abrir && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-norte border border-borda bg-superficie p-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault()
            if (!de) return
            const fim = ate || de
            setAbrir(false)
            router.push(enderecoDe(`dias:${de}${fim !== de ? `:${fim}` : ''}`))
          }}
        >
          <label className="flex flex-col gap-0.5 text-tinta-2">
            De
            <input type="date" value={de} max={hoje} onChange={(e) => setDe(e.target.value)} required className="rounded-[5px] border border-borda bg-superficie px-2 py-1 text-sm text-tinta" />
          </label>
          <label className="flex flex-col gap-0.5 text-tinta-2">
            Até
            <input type="date" value={ate} max={hoje} onChange={(e) => setAte(e.target.value)} className="rounded-[5px] border border-borda bg-superficie px-2 py-1 text-sm text-tinta" />
          </label>
          <button type="submit" className="botao-marca rounded-[5px] px-3 py-1.5 text-xs font-semibold text-marca-tinta">
            Ver
          </button>
          <span className="w-full text-tinta-3">Um dia só: deixe as duas datas iguais. Até um ano de cada vez.</span>
        </form>
      )}
    </div>
  )
}
