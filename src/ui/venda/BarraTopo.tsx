'use client'

// A barra do topo da página de venda.
//
// ── o desenho ────────────────────────────────────────────────
// Branca, fixa e baixa (64px), no padrão das ferramentas de trabalho de 2026:
// a marca à esquerda, "Produto ▾" abrindo o mapa do sistema inteiro, três
// links soltos, e à direita o tema, "Entrar" e o único botão cheio da barra.
//
// Entrar e Começar são coisas diferentes e não podem ter o mesmo peso: quem
// já é cliente procura "Entrar" e não pode competir com a chamada de venda.
// Texto para um, botão azul para o outro.
//
// ── por que o painel abre no CLIQUE, e não ao passar o mouse ─
// Abrir no passar do mouse é o que as referências fazem, e é também o que
// abre o painel por acidente quando a pessoa só está indo até "Planos" — e
// fecha quando ela desce o mouse na diagonal até o item que queria. Clique é
// uma intenção só, funciona igual no toque e no teclado, e o `aria-expanded`
// diz a verdade o tempo todo.
//
// ── teclado ──────────────────────────────────────────────────
// Esc fecha o painel e a gaveta e devolve o foco a quem abriu. A gaveta do
// celular prende o Tab dentro dela enquanto está aberta — senão o foco passa
// para a página escondida atrás, e quem navega por teclado se perde.
//
// ── por que a gaveta mora FORA do <header> ───────────────────
// A barra tem `backdrop-filter` (o vidro fosco). Isso transforma o <header>
// no bloco de referência de qualquer filho `position: fixed` — a gaveta de
// "tela inteira" teria 64px de altura, a da própria barra. Irmã do header,
// ela volta a ser relativa à tela.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Marca } from '../Marca'
import { TrocaTema } from '../TrocaTema'
import { IconeAbaixo, IconeAdiante, IconeFechar, IconeMenu } from '../Icones'
import { COMECAR, ENTRAR, LINKS_BARRA, MAPA } from './mapa'

export function BarraTopo() {
  const [painel, setPainel] = useState(false)
  const [gaveta, setGaveta] = useState(false)
  const barra = useRef<HTMLElement>(null)
  const botaoProduto = useRef<HTMLButtonElement>(null)
  const botaoGaveta = useRef<HTMLButtonElement>(null)
  const caixaGaveta = useRef<HTMLDivElement>(null)

  const fecharPainel = useCallback((devolverFoco = false) => {
    setPainel(false)
    if (devolverFoco) botaoProduto.current?.focus()
  }, [])

  const fecharGaveta = useCallback((devolverFoco = false) => {
    setGaveta(false)
    if (devolverFoco) botaoGaveta.current?.focus()
  }, [])

  // Esc fecha o que estiver aberto; clique fora fecha o painel.
  useEffect(() => {
    if (!painel && !gaveta) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (gaveta) fecharGaveta(true)
      else fecharPainel(true)
    }
    const fora = (e: PointerEvent) => {
      if (painel && barra.current && !barra.current.contains(e.target as Node)) fecharPainel()
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', fora)
    return () => {
      document.removeEventListener('keydown', tecla)
      document.removeEventListener('pointerdown', fora)
    }
  }, [painel, gaveta, fecharPainel, fecharGaveta])

  // Com a gaveta aberta a página de trás não rola, e o foco vai para o
  // primeiro link — quem abriu pelo teclado continua de onde está.
  useEffect(() => {
    if (!gaveta) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    caixaGaveta.current?.querySelector<HTMLElement>('a, button')?.focus()
    return () => {
      document.body.style.overflow = antes
    }
  }, [gaveta])

  // Passou para a largura de computador com a gaveta aberta: ela não existe
  // mais nessa largura, e o `overflow: hidden` do corpo ficaria preso.
  useEffect(() => {
    const largo = window.matchMedia('(min-width: 1024px)')
    const muda = () => largo.matches && setGaveta(false)
    largo.addEventListener('change', muda)
    return () => largo.removeEventListener('change', muda)
  }, [])

  function prenderTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !caixaGaveta.current) return
    const focaveis = Array.from(
      caixaGaveta.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    )
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]
    if (!primeiro || !ultimo) return
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  return (
    <>
      <header
        ref={barra}
        className="sticky top-0 z-40 border-b border-borda-suave bg-superficie/85 backdrop-blur-md"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <a href="#topo" aria-label="Norte — voltar ao começo da página" className="shrink-0 rounded-md">
            <Marca tamanho={28} id="barra-sol" />
          </a>

          <nav aria-label="Principal" className="hidden items-center gap-1 lg:flex">
            <button
              ref={botaoProduto}
              type="button"
              aria-expanded={painel}
              aria-controls="painel-produto"
              onClick={() => setPainel((v) => !v)}
              className={
                'flex items-center gap-1 rounded-md px-3 py-2 text-[15px] font-medium transition-colors ' +
                (painel ? 'bg-superficie-2 text-tinta' : 'text-tinta-2 hover:bg-superficie-2 hover:text-tinta')
              }
            >
              Produto
              <IconeAbaixo
                tamanho={14}
                className={'transition-transform duration-300 ' + (painel ? 'rotate-180' : '')}
              />
            </button>
            {LINKS_BARRA.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => fecharPainel()}
                className="rounded-md px-3 py-2 text-[15px] font-medium text-tinta-2 transition-colors hover:bg-superficie-2 hover:text-tinta"
              >
                {l.nome}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* O tema mora aqui e não só dentro do sistema: descobrir que o
                produto tem os dois temas ANTES de assinar é argumento, não
                configuração escondida. */}
            <span className="hidden md:block">
              <TrocaTema tom="papel" />
            </span>
            <a
              href={ENTRAR}
              className="hidden rounded-md px-2 py-2 text-[15px] font-medium text-tinta-2 hover:text-tinta sm:inline-block"
            >
              Entrar
            </a>
            <a
              href={COMECAR}
              className="botao-marca hidden rounded-norte px-4 py-2 text-sm font-semibold whitespace-nowrap text-marca-tinta sm:inline-block"
            >
              Começar grátis
            </a>
            <button
              ref={botaoGaveta}
              type="button"
              aria-expanded={gaveta}
              aria-controls="gaveta-menu"
              aria-label={gaveta ? 'Fechar o menu' : 'Abrir o menu'}
              onClick={() => setGaveta((v) => !v)}
              className="grid size-10 place-items-center rounded-md text-tinta hover:bg-superficie-2 lg:hidden"
            >
              {gaveta ? <IconeFechar /> : <IconeMenu />}
            </button>
          </div>
        </div>

        {/* ── o painel "Produto" ──
            Cinco colunas, uma por grupo do menu real, e uma faixa embaixo
            com o diferencial de facilidade. Mora dentro do header (é filho
            `absolute`, não `fixed`) para o clique-fora saber que clicar
            nele não é fora. */}
        <div
          id="painel-produto"
          hidden={!painel}
          className="abre-painel absolute inset-x-0 top-full hidden border-b border-borda bg-superficie shadow-norte-alta lg:block"
        >
          <div className="mx-auto max-w-7xl px-6 pt-7 pb-6">
            <div className="grid grid-cols-5 gap-6">
              {MAPA.map((g) => (
                <div key={g.nome} className="flex flex-col gap-3">
                  <p className="flex items-center gap-2.5">
                    <span className="grid size-9 place-items-center rounded-lg bg-marca-suave text-marca">
                      <g.Icone tamanho={22} />
                    </span>
                    <span className="text-[13px] font-bold tracking-wide text-tinta">{g.nome}</span>
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {g.itens.map((i) => (
                      <li key={i.nome}>
                        <a
                          href={i.href}
                          onClick={() => fecharPainel()}
                          className="group -mx-2 flex flex-col rounded-md px-2 py-1.5 hover:bg-superficie-2"
                        >
                          <span className="text-sm font-semibold text-tinta group-hover:text-marca">
                            {i.nome}
                          </span>
                          <span className="text-[12.5px] leading-snug text-tinta-3">{i.linha}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <a
              href="#modos"
              onClick={() => fecharPainel()}
              className="group mt-6 flex items-center justify-between gap-4 rounded-lg bg-fundo px-4 py-3 text-sm"
            >
              <span>
                <span className="font-semibold text-tinta">Simples ou avançado.</span>{' '}
                <span className="text-tinta-2">
                  O balcão vê o essencial com botões grandes; o dono vê todas as telas.
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 font-semibold text-marca">
                Ver os dois modos
                <IconeAdiante tamanho={14} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </a>
          </div>
        </div>
      </header>

      {/* Véu atrás do painel: diz que o resto da página está em segundo plano
          e dá onde clicar para fechar. */}
      {painel && (
        <div
          aria-hidden
          className="fixed inset-0 top-16 z-30 hidden bg-tinta/10 lg:block"
          onClick={() => fecharPainel()}
        />
      )}

      {/* ── a gaveta do celular e do tablet ── */}
      <div
        id="gaveta-menu"
        ref={caixaGaveta}
        hidden={!gaveta}
        onKeyDown={prenderTab}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="abre-painel fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-borda bg-superficie lg:hidden"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-7 px-4 pt-5 pb-10 sm:px-6">
          <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
            {MAPA.map((g) => (
              <div key={g.nome} className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-tinta-3 uppercase">
                  <g.Icone tamanho={18} className="text-marca" />
                  {g.nome}
                </p>
                <ul className="flex flex-col">
                  {g.itens.map((i) => (
                    <li key={i.nome}>
                      <a
                        href={i.href}
                        onClick={() => fecharGaveta()}
                        className="flex flex-col rounded-md py-1.5"
                      >
                        <span className="text-[15px] font-semibold text-tinta">{i.nome}</span>
                        <span className="text-[13px] leading-snug text-tinta-3">{i.linha}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <ul className="flex flex-col border-t border-borda">
            {[...LINKS_BARRA, { nome: 'Simples ou avançado', href: '#modos' }].map((l) => (
              <li key={l.href + l.nome} className="border-b border-borda-suave">
                <a
                  href={l.href}
                  onClick={() => fecharGaveta()}
                  className="flex items-center justify-between py-3.5 text-base font-semibold text-tinta"
                >
                  {l.nome}
                  <IconeAdiante tamanho={16} className="text-tinta-3" />
                </a>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3">
            <a
              href={COMECAR}
              onClick={() => fecharGaveta()}
              className="botao-marca rounded-norte px-5 py-3 text-center text-[15px] font-semibold text-marca-tinta"
            >
              Começar grátis
            </a>
            <a
              href={ENTRAR}
              className="rounded-norte border border-borda px-5 py-3 text-center text-[15px] font-semibold text-tinta"
            >
              Entrar
            </a>
            <div className="flex items-center justify-between pt-2 text-sm text-tinta-2">
              Tema da tela
              <TrocaTema tom="papel" />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
