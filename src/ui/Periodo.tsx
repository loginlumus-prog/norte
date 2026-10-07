'use client'

// O seletor de período do painel.
//
// ── por que vive no endereço ─────────────────────────────────
// O período escolhido vira `?periodo=90d`. Guardado em estado escondido, o
// link que a pessoa manda para o contador abre com OUTRO recorte, e os dois
// discutem números diferentes achando que são os mesmos. No endereço, o link
// é a pergunta inteira — e voltar no navegador desfaz a escolha, que é o que
// qualquer pessoa espera do botão de voltar.
//
// ── por que um botão que abre, e não a fileira ───────────────
// Já foi uma fileira de sete opções com contorno, sempre à vista. No
// cabeçalho ela ocupava meia barra e empurrava as ações para o "Mais", e o
// contorno azul em volta do escolhido parecia campo de formulário. Agora é um
// botão só, com o calendário e o nome do período ("Últimos 30 dias"), que
// abre a lista — cada opção com os dias que ela cobre, os atalhos que o dono
// pediu (anteontem, 3 e 5 dias) e o calendário para qualquer outro.
//
// ── por que Link e não botão ─────────────────────────────────
// Cada opção é uma navegação de verdade: funciona sem JavaScript, abre em
// nova aba com o meio do mouse, e o Next já traz o dado antes do clique.

'use no memo'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { PERIODOS, diasEscolhidos, janela, type Periodo } from '@/servidor/periodo'
import { diaEmSP, somarDias } from '@/servidor/dia'
import { cx } from './base'

const curto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

const LONGO: Record<string, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  mes: 'Este mês',
  'mes-passado': 'Mês passado',
}

/** Os dias que a janela cobre, escritos: "07/09 – 06/10", ou "06/10" quando é um só. */
function dias(p: Periodo): string {
  const j = janela(p)
  const de = diaEmSP(j.de)
  const ate = diaEmSP(new Date(j.ate.getTime() - 1))
  return de === ate ? curto(de) : `${curto(de)} – ${curto(ate)}`
}

function nomeDe(p: Periodo, hoje: string): string {
  const e = diasEscolhidos(p)
  if (!e) return LONGO[p] ?? p
  if (e.de === e.ate) return e.de === somarDias(hoje, -2) ? 'Anteontem' : curto(e.de)
  if (e.ate === hoje) {
    const n = Math.round((Date.parse(e.ate) - Date.parse(e.de)) / 86_400_000) + 1
    return `Últimos ${n} dias`
  }
  return `${curto(e.de)} – ${curto(e.ate)}`
}

export function SeletorPeriodo({ atual }: { atual: Periodo }) {
  const caminho = usePathname()
  const busca = useSearchParams()
  const router = useRouter()
  const escolhidos = diasEscolhidos(atual)
  const hoje = diaEmSP()
  const [aberto, setAberto] = useState(false)
  const [de, setDe] = useState(escolhidos?.de ?? hoje)
  const [ate, setAte] = useState(escolhidos?.ate ?? hoje)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  // Preserva o resto do endereço: trocar o período não pode desfazer a
  // unidade que a pessoa escolheu dois cliques atrás.
  const enderecoDe = (p: Periodo) => {
    const q = new URLSearchParams(busca.toString())
    q.set('periodo', p)
    q.delete('pagina')
    return `${caminho}?${q.toString()}`
  }

  // Os atalhos do dono da sorveteria: "anteontem", "três dias", "cinco dias".
  const atalhos: { chave: Periodo; nome: string }[] = [
    { chave: `dias:${somarDias(hoje, -2)}`, nome: 'Anteontem' },
    { chave: `dias:${somarDias(hoje, -2)}:${hoje}`, nome: 'Últimos 3 dias' },
    { chave: `dias:${somarDias(hoje, -4)}:${hoje}`, nome: 'Últimos 5 dias' },
  ]

  const opcao = (chave: Periodo, nome: string) => {
    const aceso = chave === atual
    return (
      <Link
        key={chave}
        href={enderecoDe(chave)}
        onClick={() => setAberto(false)}
        aria-current={aceso ? 'page' : undefined}
        className={cx(
          'periodo-opcao flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm',
          aceso ? 'font-bold' : 'font-medium text-tinta',
        )}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="periodo-marca grid size-4 place-items-center rounded-full">
            {aceso ? (
              <svg viewBox="0 0 20 20" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 10.5 3.2 3L15 6.5" />
              </svg>
            ) : null}
          </span>
          {nome}
        </span>
        <span className="numero text-[12.5px] font-medium text-tinta-3">{dias(chave)}</span>
      </Link>
    )
  }

  return (
    // `data-fixo`: no cabeçalho, nunca vai para o "Mais" (AcoesDoTopo).
    <div ref={caixa} data-fixo="" className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        className="periodo-botao botao-vivo flex h-9 items-center gap-2 rounded-full pr-3 pl-1.5 text-sm font-semibold text-tinta"
      >
        <span aria-hidden className="periodo-icone grid size-6 place-items-center rounded-full">
          <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
            <path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" />
          </svg>
        </span>
        <span className="whitespace-nowrap">{nomeDe(atual, hoje)}</span>
        <svg aria-hidden viewBox="0 0 20 20" className={cx('size-3.5 text-tinta-3 transition-transform', aberto && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Escolher o período"
          className="periodo-caixa absolute right-0 z-40 mt-2 flex w-[21.5rem] max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-2xl p-2"
        >
          <span className="px-3 pt-1 pb-0.5 text-[11.5px] font-bold tracking-[0.12em] text-tinta-3 uppercase">Período</span>
          {PERIODOS.map((p) => opcao(p.chave, LONGO[p.chave] ?? p.curto))}
          <span aria-hidden className="mx-2 my-1 h-px bg-borda-suave" />
          <span className="px-3 pt-0.5 pb-0.5 text-[11.5px] font-bold tracking-[0.12em] text-tinta-3 uppercase">Atalhos</span>
          {atalhos.map((a) => opcao(a.chave, a.nome))}
          <span aria-hidden className="mx-2 my-1 h-px bg-borda-suave" />
          {/* Um dia qualquer (a sexta passada) ou de um dia a outro. */}
          <form
            className="flex flex-col gap-2 px-2 pb-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (!de) return
              const fim = ate || de
              setAberto(false)
              router.push(enderecoDe(`dias:${de}${fim !== de ? `:${fim}` : ''}`))
            }}
          >
            <span className="px-1 text-[11.5px] font-bold tracking-[0.12em] text-tinta-3 uppercase">Escolher dias</span>
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px] font-medium text-tinta-2">
                De
                <input type="date" value={de} max={hoje} onChange={(e) => setDe(e.target.value)} required className="h-9 rounded-xl border border-borda bg-superficie px-2 text-sm text-tinta" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px] font-medium text-tinta-2">
                Até
                <input type="date" value={ate} max={hoje} onChange={(e) => setAte(e.target.value)} className="h-9 rounded-xl border border-borda bg-superficie px-2 text-sm text-tinta" />
              </label>
              <button type="submit" className="botao-vivo periodo-ver h-9 shrink-0 rounded-xl px-3.5 text-sm font-bold text-white">
                Ver
              </button>
            </div>
            <span className="px-1 text-[12.5px] text-tinta-3">Um dia só: deixe as duas datas iguais. Até um ano de cada vez.</span>
          </form>
        </div>
      )}
    </div>
  )
}
