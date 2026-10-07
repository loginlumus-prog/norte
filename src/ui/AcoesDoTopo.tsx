'use client'

// As ações do cabeçalho de cada tela.
//
// No computador elas ficam todas à vista, ao lado do título. No telefone,
// não cabem: a tela de Produtos empilhava cinco botões (450px) antes de
// mostrar o primeiro produto, e Clientes, Tarefas e Financeiro gastavam três
// linhas de cabeçalho. Então, abaixo de `sm`, fica à vista o título e UMA
// ação — a principal, que é o botão cheio (`botao-marca`) — e o resto entra
// atrás de um "Mais", que abre um painel logo abaixo do cabeçalho.
//
// ── por que descobrir no DOM, e não pedir às telas ───────────
// São mais de cem cabeçalhos, e cada um já entrega as ações num pedaço só
// (`acao`). Pedir a cada tela "qual é a principal" faria metade esquecer.
// A regra já existe no desenho: a principal é a única cheia. Daqui se lê
// isso, e marca-se o resto com `data-mais` — quem esconde é o CSS
// (globals.css, `.acoes-topo`), então nada muda de lugar no DOM e o React
// não se perde.
//
// Uma ação só (a assinatura mostra a situação; a encomenda, a loja) fica à
// vista como está: menu com um item dentro é um clique a mais à toa.
//
// Fecha no Esc (devolvendo o foco ao botão), ao tocar fora, ao trocar de tela
// e ao escolher algo lá dentro (um período, uma loja): o painel serviu.
// Sem `useSearchParams` de propósito — ele está na moldura de TODA tela, e
// esse gancho pede uma fronteira de Suspense em tela pré-renderizada.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cx } from './base'

const FOCAVEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'

/** As peças do cabeçalho: os filhos, abrindo o invólucro `flex` que as telas usam. */
function pecas(raiz: HTMLElement): HTMLElement[] {
  let itens = [...raiz.children] as HTMLElement[]
  for (let unico = itens[0]; itens.length === 1 && unico; unico = itens[0]) {
    if (unico.children.length < 2 || !/flex|contents/.test(getComputedStyle(unico).display)) break
    itens = [...unico.children] as HTMLElement[]
  }
  return itens
}

export function AcoesDoTopo({ children }: { children: ReactNode }) {
  const lista = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const [temMais, setTemMais] = useState(false)
  const [aberto, setAberto] = useState(false)
  const id = useId()

  const caminho = usePathname()
  useEffect(() => {
    setAberto(false)
  }, [caminho])

  // Marca o que vai para o "Mais". Refeito quando o conteúdo muda: a tela
  // troca as ações sem desmontar o cabeçalho (o filtro liga um botão novo).
  useEffect(() => {
    const el = lista.current
    if (!el) return
    const marcar = () => {
      const itens = pecas(el)
      const principal = itens.find((i) => i.matches('.botao-marca') || i.querySelector('.botao-marca'))
      // O seletor de loja e o de período ficam sempre à vista (`data-fixo`):
      // dizem DE ONDE são os números da tela.
      // No celular não: lá o período ocupa a largura toda e volta ao "Mais".
      const largo = window.matchMedia('(min-width: 40rem)').matches
      const fixo = (i: HTMLElement) => largo && (i.matches('[data-fixo]') || !!i.querySelector('[data-fixo]'))
      const mais = itens.length >= 2 ? itens.filter((i) => i !== principal && !fixo(i)) : []
      for (const i of el.querySelectorAll<HTMLElement>('[data-mais]')) if (!mais.includes(i)) i.removeAttribute('data-mais')
      for (const i of mais) if (!i.hasAttribute('data-mais')) i.setAttribute('data-mais', '')
      setTemMais(mais.length > 0)
    }
    marcar()
    const olho = new MutationObserver(marcar)
    olho.observe(el, { childList: true, subtree: true })
    window.addEventListener('resize', marcar)
    return () => {
      olho.disconnect()
      window.removeEventListener('resize', marcar)
    }
  }, [])

  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAberto(false)
      botao.current?.focus()
    }
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node
      if (!lista.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false)
    }
    document.addEventListener('keydown', esc)
    document.addEventListener('pointerdown', fora)
    // O foco vai para a primeira ação que estava escondida: quem abriu pelo
    // teclado continua dali.
    const primeiro = lista.current?.querySelector<HTMLElement>(`[data-mais]:is(${FOCAVEL}), [data-mais] :is(${FOCAVEL})`)
    primeiro?.focus()
    return () => {
      document.removeEventListener('keydown', esc)
      document.removeEventListener('pointerdown', fora)
    }
  }, [aberto])

  return (
    <>
      <div
        ref={lista}
        id={id}
        data-aberto={aberto || undefined}
        onClick={(e) => {
          if (aberto && (e.target as HTMLElement).closest('a[href], [role="option"]')) setAberto(false)
        }}
        // `flex-1`: quando as ações não cabem, elas quebram aqui dentro, e a
        // chave do modo e do tema continua na linha do título.
        className="acoes-topo flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 2xl:flex-nowrap"
      >
        {children}
      </div>
      {temMais && (
        <button
          ref={botao}
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-controls={id}
          className={cx(
            'botao-vivo flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-sm font-semibold 2xl:hidden',
            aberto
              ? 'border-marca/50 bg-marca-suave text-marca'
              : 'border-borda bg-superficie text-tinta hover:bg-superficie-2',
          )}
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
          Mais
        </button>
      )}
    </>
  )
}
