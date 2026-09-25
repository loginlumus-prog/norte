'use client'

// O balcão no modo simples.
//
// É o balcão que o dono pediu para a sorveteria: açaí, sorvete, picolé, e a
// moça do caixa tocando em cartões grandes, sem ler nada. Mas é o MESMO
// balcão do modo avançado por baixo — mesmo estado, mesmas regras, mesma
// conta (useVenda.ts e conta.ts) —, só com outra cara. As regras de quem fica
// em pé atrás do caixa, do topo do Balcao.tsx, valem aqui inteiras.
//
// ── a tela ───────────────────────────────────────────────────
// Do tablet deitado para cima (lg): produtos à esquerda, pedido à direita, e
// os dois cabem na altura da tela — cada lado rola por dentro, e o botão de
// concluir nunca sai da vista. Abaixo disso (celular, tablet em pé): os
// produtos ocupam tudo, e uma barra presa embaixo mostra quantos itens e
// quanto dá; tocar nela sobe o pedido inteiro.
//
// ── tela cheia ───────────────────────────────────────────────
// Um botão tira o menu e o cabeçalho do caminho e pede ao navegador a tela
// inteira (no tablet, isso some com a barra de endereço também). Fica
// lembrado NESTE aparelho: o tablet do balcão abre sempre assim. E sai com um
// toque, no mesmo botão — tela cheia que não se sabe desligar é armadilha.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Aviso, cx } from '@/ui/base'
import type { Programa } from '@/servidor/pontos'
import type { Vendedor } from '@/servidor/equipe'
import { faz } from './guardar'
import { VendaIncerta, AvisoFixo } from './VendaIncerta'
import { brl } from './conta'
import { useVenda, type Venda } from './useVenda'
import { Produtos } from './Produtos'
import { Itens, Total, Pagamento, Concluir, Sucesso } from './Pedido'
import { MaisOpcoes, opcoesEmUso } from './MaisOpcoes'
import { Folha } from './Folha'

const CHAVE_TELA_CHEIA = 'norte:balcao:tela-cheia'

export function BalcaoSimples({
  slug,
  unidadeId,
  usuarioId,
  caixaId,
  unidadeNome,
  programa,
  vendedores,
  podeAvulso,
  crediario,
  barra,
  colada = false,
}: {
  slug: string
  unidadeId: string
  usuarioId: string
  caixaId: string | null
  unidadeNome: string
  programa: Programa
  vendedores: Vendedor[] | null
  podeAvulso: boolean
  crediario: { maxParcelas: number } | null
  /** A barra do caixa, compacta. Vem de fora porque é do servidor que sai a conferência. */
  barra?: ReactNode
  /**
   * A moldura está recolhida (trilho de ícones, sem respiro em volta): o
   * balcão põe o próprio respiro, senão os cartões encostam na borda.
   */
  colada?: boolean
}) {
  const v = useVenda({ slug, unidadeId, unidadeNome, usuarioId, caixaId, programa, vendedores, crediario })

  const [telaCheia, setTelaCheia] = useState(false)
  const [pedidoAberto, setPedidoAberto] = useState(false)
  const [opcoes, setOpcoes] = useState<{ aberta: boolean; cliente: number; vendedor: boolean }>({
    aberta: false,
    cliente: 0,
    vendedor: false,
  })

  // A tela cheia lembrada neste aparelho. Lida depois de montar (o servidor
  // não sabe do localStorage) e sempre em try/catch — ver guardar.ts.
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_TELA_CHEIA) === '1') setTelaCheia(true)
    } catch {}
  }, [])

  function trocarTelaCheia() {
    const nova = !telaCheia
    setTelaCheia(nova)
    try {
      if (nova) localStorage.setItem(CHAVE_TELA_CHEIA, '1')
      else localStorage.removeItem(CHAVE_TELA_CHEIA)
    } catch {}
    // A tela inteira do navegador é um pedido, não uma ordem: o navegador pode
    // negar (iPhone não tem), e aí fica só a tela cheia da página — que já
    // resolve o que importa, que é tirar o menu do caminho.
    try {
      if (nova && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {})
      if (!nova && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    } catch {}
  }

  // Alt+N, crediário sem cliente: abre as opções já na busca de cliente.
  useEffect(() => {
    if (v.pedidoCliente > 0) setOpcoes({ aberta: true, cliente: v.pedidoCliente, vendedor: false })
  }, [v.pedidoCliente])
  // Alt+F: abre as opções com o foco no vendedor.
  useEffect(() => {
    if (v.pedidoVendedor > 0 && vendedores) setOpcoes({ aberta: true, cliente: 0, vendedor: true })
  }, [v.pedidoVendedor, vendedores])

  // ── o valor que acompanha o total ────────────────────────
  // Escolheu Pix e depois lançou mais um picolé: o Pix tem que subir junto.
  // Sem isto, a tela mostraria "falta R$ 6" e a pessoa acharia que errou. Só
  // acompanha o pagamento ÚNICO que cobria o total EXATO — dinheiro de R$ 100
  // numa venda de R$ 83 fica como está, e o troco é que diminui.
  const { pagos, setPagos, carrinho } = v
  const aPagar = v.conta.aPagarCent
  const antes = useRef(aPagar)
  useEffect(() => {
    const anterior = antes.current
    antes.current = aPagar
    if (anterior === aPagar) return
    const [so] = pagos
    if (pagos.length !== 1 || !so || so.forma === 'VALE') return
    if (Math.round(so.valor * 100) !== anterior || aPagar <= 0) return
    setPagos([{ ...so, valor: aPagar / 100 }])
  }, [aPagar, pagos, setPagos])

  // Pedido esvaziou item a item: a forma escolhida não tem mais o que pagar.
  useEffect(() => {
    if (carrinho.length === 0 && pagos.length > 0) setPagos([])
  }, [carrinho.length, pagos.length, setPagos])

  // ── a altura ─────────────────────────────────────────────
  // Do lg para cima, o balcão ocupa exatamente o que sobra da janela abaixo
  // dele: a página não rola, só as duas colunas rolam por dentro, e o botão de
  // concluir fica sempre no pé da tela. Medido, e não escrito aqui: a moldura
  // (Estrutura) pode ter cabeçalho ou não, respiro ou não, e um número fixo
  // esconderia o "Concluir" na primeira vez que a moldura mudasse.
  //
  // A mesma medida dá a esquerda da barra do pedido no celular e no tablet em
  // pé — ela começa onde o balcão começa, com menu lateral ou trilho ou nada.
  useLayoutEffect(() => {
    const medir = () => {
      const el = v.raiz.current
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--esquerda', `${Math.round(r.left)}px`)
      if (telaCheia || colada) return
      const topo = r.top + window.scrollY
      const main = el.closest('main')
      const respiro = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      el.style.setProperty('--altura', `${Math.max(Math.floor(window.innerHeight - topo - respiro), 520)}px`)
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  })

  const emUso = opcoesEmUso(v, usuarioId)
  const abrirOpcoes = () => setOpcoes({ aberta: true, cliente: 0, vendedor: false })
  const pedirCliente = () => setOpcoes((o) => ({ aberta: true, cliente: o.cliente + 1, vendedor: false }))

  function novaVenda() {
    v.setFechada(null)
    v.setRecado(null)
    setPedidoAberto(false)
    v.focarBusca()
  }

  // O anúncio para quem usa leitor de tela. Fica montado sempre — região viva
  // que nasce junto com o texto não é lida por todos os leitores.
  const anuncio = v.fechada
    ? `Venda ${v.fechada.numero} concluída, ${brl(v.fechada.total)}.${v.fechada.trocoCent > 0 ? ` Troco: ${brl(v.fechada.trocoCent / 100)}.` : ''}`
    : ''

  const pedido = (
    <PainelDoPedido
      v={v}
      caixaId={caixaId}
      crediario={crediario}
      unidadeNome={unidadeNome}
      emUso={emUso}
      aoOpcoes={abrirOpcoes}
      aoPedirCliente={pedirCliente}
      aoNova={novaVenda}
    />
  )

  return (
    <div
      ref={v.raiz}
      className={cx(
        'flex min-w-0 flex-col gap-3',
        // `relative` e `fixed` não podem ir juntos: no CSS gerado o relative
        // vem depois e ganha, e a "tela cheia" ficava presa dentro da moldura.
        telaCheia
          ? 'fixed inset-0 z-30 overflow-y-auto bg-fundo p-3 sm:p-4 lg:overflow-hidden'
          : colada
            ? // A moldura recolhida já tem a altura da janela e não rola: o
              // balcão ocupa tudo e rola por dentro (no celular, a vitrine;
              // do lg para cima, cada coluna).
              'relative min-h-0 flex-1 overflow-y-auto p-3 lg:overflow-hidden'
            : 'relative lg:h-[var(--altura,calc(100dvh-7rem))] lg:overflow-hidden',
      )}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {anuncio}
      </p>

      {/* Recuperar em silêncio seria pior que perder: diz o que aconteceu, de
          quando é, e deixa jogar fora num toque. */}
      {v.voltou !== null && v.carrinho.length > 0 && v.incerta && <VendaIncerta slug={slug} aoLimpar={v.limpar} />}
      {v.voltou !== null && v.carrinho.length > 0 && !v.incerta && (
        <Aviso nivel="atencao">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Recuperamos a venda que estava sendo montada {faz(v.voltou)}.</span>
            <button type="button" onClick={v.limpar} className="font-semibold underline underline-offset-2">
              Não é essa — começar do zero
            </button>
          </span>
        </Aviso>
      )}
      {v.alerta && <Aviso nivel="atencao">{v.alerta}</Aviso>}
      {v.aviso && <AvisoFixo texto={v.aviso} aoFechar={() => v.setAviso(null)} />}

      <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Produtos
          v={v}
          slug={slug}
          unidadeId={unidadeId}
          unidadeNome={unidadeNome}
          telaCheia={telaCheia}
          aoTelaCheia={trocarTelaCheia}
          barra={barra}
        />

        <aside aria-label="Pedido" className="hidden min-h-0 lg:flex">
          {pedido}
        </aside>
      </div>

      {/* ── celular e tablet em pé: a barra do pedido ──
          Presa no pé da tela (fixed), sempre no mesmo lugar, com o pedido
          vazio ou cheio — o polegar aprende onde ela fica. Do md para cima a
          moldura tem o menu lateral (Estrutura.tsx), e a barra começa depois
          dele — a esquerda é medida, ver "a altura". O canto direito fica
          livre para o botão do Guia. O espaço vazio embaixo impede que ela
          cubra a última fileira. */}
      <div aria-hidden className="h-20 lg:hidden" />
      <div className="fixed right-[4.5rem] bottom-3 left-[calc(var(--esquerda,0px)+0.75rem)] z-20 lg:hidden">
        <button
          type="button"
          onClick={() => setPedidoAberto(true)}
          className={cx(
            'botao-marca flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl px-4 text-marca-tinta',
            'touch-manipulation',
          )}
        >
          <span className="flex flex-col items-start leading-tight">
            <span className="text-xs font-semibold opacity-80">
              {v.fechada ? 'Venda concluída' : v.carrinho.length === 0 ? 'Pedido vazio' : `${v.itensNaVenda} ${v.itensNaVenda === 1 ? 'item' : 'itens'}`}
            </span>
            <span className="text-base font-bold">{v.fechada ? 'Ver o troco' : 'Ver pedido e pagar'}</span>
          </span>
          <span className="numero text-2xl font-extrabold">{brl(v.conta.aPagarCent / 100)}</span>
        </button>
      </div>

      <div className="lg:hidden">
        <Folha
          aberta={pedidoAberto}
          aoFechar={() => setPedidoAberto(false)}
          titulo={v.fechada ? 'Venda concluída' : 'Pedido'}
          inteira
          rodape={v.fechada ? undefined : <Concluir v={v} caixaId={caixaId} />}
        >
          {v.fechada ? (
            <Sucesso v={v} aoNova={novaVenda} />
          ) : (
            <div className="flex flex-col gap-4">
              <CabecaDoPedido v={v} emUso={emUso} aoOpcoes={abrirOpcoes} />
              <Itens v={v} />
              <div className="flex flex-col gap-4 border-t border-borda pt-4">
                <Total v={v} />
                <Pagamento v={v} crediario={crediario} aoPedirCliente={pedirCliente} />
              </div>
            </div>
          )}
        </Folha>
      </div>

      <MaisOpcoes
        v={v}
        aberta={opcoes.aberta}
        aoFechar={() => setOpcoes({ aberta: false, cliente: 0, vendedor: false })}
        slug={slug}
        usuarioId={usuarioId}
        vendedores={vendedores}
        podeAvulso={podeAvulso}
        pedidoCliente={opcoes.cliente}
        focarVendedor={opcoes.vendedor}
      />
    </div>
  )
}

/** "Mais opções" e as etiquetas do que está valendo. */
function CabecaDoPedido({
  v,
  emUso,
  aoOpcoes,
  titulo,
}: {
  v: Venda
  emUso: number
  aoOpcoes: () => void
  /** Na coluna, o título divide a linha com os botões — a altura é dos itens. */
  titulo?: ReactNode
}) {
  const etiqueta =
    'inline-flex min-h-8 items-center gap-1.5 rounded-full bg-superficie-2 pr-1 pl-3 text-xs font-semibold text-tinta-2'
  const tirar = 'flex size-6 items-center justify-center rounded-full text-tinta-3 hover:bg-superficie-3 hover:text-tinta'
  const temEtiqueta = !!v.cliente || v.desconto > 0 || v.observacoes.trim() !== ''
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {titulo}
        <span className={cx('flex items-center gap-1', !titulo && 'w-full justify-between')}>
        <button
          type="button"
          onClick={aoOpcoes}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-borda bg-superficie px-3 text-sm font-semibold whitespace-nowrap text-tinta hover:bg-superficie-2"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none">
            <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Mais opções
          {emUso > 0 && (
            <span className="numero flex h-5 min-w-5 items-center justify-center rounded-full bg-marca px-1.5 text-[11px] font-bold text-marca-tinta">
              {emUso}
              <span className="sr-only"> em uso</span>
            </span>
          )}
        </button>
        {v.carrinho.length > 0 && <Limpar aoLimpar={v.limpar} />}
        </span>
      </div>

      {/* O que está escondido e valendo aparece aqui, com o ✕ para desfazer. */}
      {temEtiqueta && (
        <div className="flex flex-wrap gap-1.5">
          {v.cliente && (
            <span className={etiqueta}>
              Cliente: <span className="text-tinta">{v.cliente.nome}</span>
              <button type="button" onClick={() => v.setCliente(null)} aria-label="Tirar o cliente" className={tirar}>
                ✕
              </button>
            </span>
          )}
          {v.desconto > 0 && (
            <span className={etiqueta}>
              Desconto <span className="numero text-tinta">{brl(v.desconto)}</span>
              <button type="button" onClick={() => v.setDesconto(0)} aria-label="Tirar o desconto" className={tirar}>
                ✕
              </button>
            </span>
          )}
          {v.observacoes.trim() !== '' && (
            <span className={cx(etiqueta, 'max-w-full')}>
              <span className="truncate">Obs.: {v.observacoes}</span>
              <button type="button" onClick={() => v.setObservacoes('')} aria-label="Tirar a observação" className={tirar}>
                ✕
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * "Limpar" pede um segundo toque. Um toque sem querer apagando um pedido de
 * oito itens com o cliente olhando é o tipo de erro que faz a pessoa voltar
 * para o caderno. O segundo toque tem que vir em 4 segundos.
 */
function Limpar({ aoLimpar }: { aoLimpar: () => void }) {
  const [certeza, setCerteza] = useState(false)
  useEffect(() => {
    if (!certeza) return
    const t = setTimeout(() => setCerteza(false), 4000)
    return () => clearTimeout(t)
  }, [certeza])
  return (
    <button
      type="button"
      onClick={() => {
        if (certeza) {
          setCerteza(false)
          aoLimpar()
        } else setCerteza(true)
      }}
      className={cx(
        'min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors',
        certeza ? 'bg-critico-fundo text-critico' : 'text-tinta-3 hover:bg-superficie-2 hover:text-critico',
      )}
    >
      {certeza ? 'Toque de novo para limpar' : 'Limpar'}
    </button>
  )
}

/** O pedido na coluna da direita (tablet deitado para cima). */
function PainelDoPedido({
  v,
  caixaId,
  crediario,
  unidadeNome,
  emUso,
  aoOpcoes,
  aoPedirCliente,
  aoNova,
}: {
  v: Venda
  caixaId: string | null
  crediario: { maxParcelas: number } | null
  unidadeNome: string
  emUso: number
  aoOpcoes: () => void
  aoPedirCliente: () => void
  aoNova: () => void
}) {
  return (
    // A coluna inteira rola, com o cabeçalho preso em cima e o pagamento preso
    // embaixo. Os itens ficam no meio e encolhem primeiro; se nem o pagamento
    // couber (tela baixa, desconto, cliente, pagamento dividido), a coluna
    // rola em vez de cortar — botão de concluir cortado é o pior defeito que
    // esta tela pode ter.
    <div className="realce relative flex min-h-0 w-full flex-col overflow-y-auto overscroll-contain rounded-2xl border border-borda bg-superficie">
      {v.fechada ? (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <Sucesso v={v} aoNova={aoNova} />
        </div>
      ) : (
        <>
          <header className="sticky top-0 z-10 shrink-0 border-b border-borda-suave bg-superficie px-4 py-2.5">
            <CabecaDoPedido
              v={v}
              emUso={emUso}
              aoOpcoes={aoOpcoes}
              titulo={
                <h2 className="flex min-w-0 items-baseline gap-2 text-lg font-bold">
                  Pedido
                  {v.itensNaVenda > 0 && (
                    <span className="numero text-sm font-semibold text-tinta-3">
                      {v.itensNaVenda} {v.itensNaVenda === 1 ? 'item' : 'itens'}
                    </span>
                  )}
                  <span className="sr-only"> — {unidadeNome}</span>
                </h2>
              }
            />
          </header>

          <div className="flex-1 px-4">
            <Itens v={v} />
          </div>

          <footer className="sticky bottom-0 z-10 flex shrink-0 flex-col gap-4 border-t border-borda bg-superficie px-4 pt-3 pb-4">
            <Total v={v} />
            <Pagamento v={v} crediario={crediario} aoPedirCliente={aoPedirCliente} />
            <Concluir v={v} caixaId={caixaId} />
            {/* As teclas, para quem usa teclado — e o espaço que deixa o botão
                redondo do Guia, no canto, sem cobrir o "Concluir". */}
            <p className="hidden truncate pr-14 text-xs text-tinta-3 [@media(pointer:fine)]:block">
              <kbd className="font-mono">F10</kbd> conclui · <kbd className="font-mono">Ctrl P</kbd> busca
            </p>
            <span aria-hidden className="block h-5 [@media(pointer:fine)]:hidden" />
          </footer>
        </>
      )}
    </div>
  )
}
