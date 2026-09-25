'use client'

// A folha que sobe por cima do balcão simples: a escolha do tamanho, o peso,
// as opções da venda, e o pedido inteiro no celular.
//
// ── por que folha, se o balcão tem a regra "nada de modal para fechar" ──
// A regra é sobre FECHAR a venda: o pagamento vive sempre à vista, e continua.
// A folha aqui é para uma pergunta curta no meio do caminho ("qual tamanho?"),
// que sem ela viraria sessenta botões na vitrine. Ela abre com um toque e
// fecha sozinha quando a resposta vem.
//
// No celular sobe de baixo, onde o polegar está; do tablet para cima, fica no
// meio. Esc fecha, o foco entra nela ao abrir e volta para onde estava ao
// fechar, e o Tab não escapa para a tela de trás.

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '@/ui/base'

export function Folha({
  aberta,
  aoFechar,
  titulo,
  subtitulo,
  icone,
  larga = false,
  inteira = false,
  children,
  rodape,
}: {
  aberta: boolean
  aoFechar: () => void
  titulo: string
  subtitulo?: ReactNode
  icone?: ReactNode
  /** Mais larga no tablet — para grades de opção com muita coisa. */
  larga?: boolean
  /** Ocupa a tela toda no celular e no tablet em pé: é o pedido. */
  inteira?: boolean
  children: ReactNode
  rodape?: ReactNode
}) {
  const painel = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  const fechar = useRef(aoFechar)
  useEffect(() => {
    fechar.current = aoFechar
  })

  useEffect(() => {
    if (!aberta) return
    // O painel guardado AQUI, e não lido do ref na limpeza: na limpeza o ref
    // já pode ter sido desligado (o React desliga antes), e aí a folha não
    // reconheceria o próprio foco — e devolveria o foco para lugar nenhum.
    const el = painel.current
    const antes = document.activeElement as HTMLElement | null
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fechar.current()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const focaveis = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      if (!primeiro || !ultimo) return
      if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === el)) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    document.addEventListener('keydown', tecla)
    // A página de trás não rola com a folha aberta: o dedo que arrasta a
    // lista de tamanhos arrastaria a vitrine junto.
    const rolagem = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // O foco entra na folha. Vai direto num campo só quando a folha pede
    // (`data-foco-inicial`: o peso, que é a única coisa a fazer ali); senão
    // fica na própria folha — pôr o foco no primeiro tamanho faria o anel de
    // foco parecer "já escolhido". Se alguém lá dentro já pegou o foco (a
    // busca de cliente pega sozinha), fica com quem pegou.
    if (!el?.contains(document.activeElement)) {
      const alvo = el?.querySelector<HTMLElement>('[data-foco-inicial]') ?? el
      alvo?.focus()
    }
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = rolagem
      // Volta para onde estava, se aquilo ainda existe na tela — a não ser que
      // alguém já tenha levado o foco para outro lugar (o lançamento leva
      // para a busca, e é lá que ele tem que ficar).
      const agora = document.activeElement
      const solto = !agora || agora === document.body || !!el?.contains(agora)
      if (solto && antes && document.contains(antes)) antes.focus({ preventScroll: true })
    }
  }, [aberta])

  if (!aberta) return null

  return (
    // z-[45]: acima do botão redondo do Guia (40), que cobriria o "Concluir"
    // do pedido no celular; abaixo da tranca de inatividade (60).
    <div className="fixed inset-0 z-[45] flex items-end justify-center sm:items-center sm:p-6">
      <div aria-hidden onClick={aoFechar} className="absolute inset-0 bg-nav/45 backdrop-blur-[2px]" />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className={cx(
          'realce-alto relative outline-none flex w-full flex-col overflow-hidden border border-borda bg-superficie',
          inteira
            ? 'h-dvh sm:h-[min(100dvh-3rem,56rem)] sm:max-w-xl sm:rounded-2xl'
            : 'max-h-[88dvh] rounded-t-3xl sm:rounded-2xl',
          !inteira && (larga ? 'sm:max-w-2xl' : 'sm:max-w-lg'),
        )}
      >
        {/* A alça: no celular, é o que diz "isto desce". */}
        {!inteira && <span aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-superficie-3 sm:hidden" />}

        <header className="flex shrink-0 items-start gap-3 border-b border-borda-suave px-5 pt-4 pb-3">
          {icone}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id={idTitulo} className="text-xl leading-tight font-bold">
              {titulo}
            </h2>
            {subtitulo && <div className="text-sm text-tinta-2">{subtitulo}</div>}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div data-corpo className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {rodape && (
          <footer className="shrink-0 border-t border-borda-suave bg-superficie px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {rodape}
          </footer>
        )}
      </div>
    </div>
  )
}
