'use client'

// Trocar de loja.
//
// Já foi uma listinha que descia do cabeçalho, igual à de período — e trocar
// de loja não é filtrar uma tabela: é mudar de lugar. O dono da rede escolhe
// a loja do shopping e TUDO passa a ser dela (vendas, estoque, caixa,
// relatório). Por isso agora é uma tela própria, por cima de tudo:
//
//   • cada loja num cartão, com a cor e as iniciais dela, o bairro, se o
//     caixa está aberto e quanto já vendeu hoje (para quem vê esse número);
//   • a escolhida "abre" a partir do cartão tocado — a cor da loja cobre a
//     tela com o nome dela, e a tela volta já na loja. A pessoa SENTE que
//     mudou de lugar, em vez de ter que conferir um rótulo;
//   • 1 a 9 no teclado escolhem direto; Esc fecha.
//
// A escolha continua indo para o mesmo lugar de antes: o cookie da empresa
// (unidade-lembrada.ts), que toda tela lê quando o endereço não traz loja.
// O servidor confere de novo a cada leitura — o cookie só sugere.

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { cx } from './base'
import { corDoNome, iniciaisDe } from './premium'
import { tocar } from './sons'
import type { UnidadeVisivel } from '@/servidor/unidade'
import { TODAS_AS_UNIDADES, UNIDADE_LEMBRADA_SEG, cookieDaUnidade } from '@/servidor/unidade-lembrada'
import { pulsoDasLojasAcao, type PulsoDaLoja } from '@/app/[empresa]/acoes'

const COM_BUSCA = 8

function lembrar(slug: string, id: string | null) {
  const seguro = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie =
    `${cookieDaUnidade(slug)}=${encodeURIComponent(id ?? TODAS_AS_UNIDADES)}` +
    `; path=/${slug}; max-age=${UNIDADE_LEMBRADA_SEG}; samesite=lax${seguro}`
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v >= 1000 ? 0 : 2 })

/** O azulejo da loja: as iniciais na cor dela. `null` = a rede inteira. */
export function AzulejoDaLoja({ loja, tamanho = 32, todas }: { loja?: UnidadeVisivel | null; tamanho?: number; todas?: UnidadeVisivel[] }) {
  if (!loja) {
    // A rede: os quadradinhos das lojas, em mosaico.
    const cores = (todas ?? []).slice(0, 4).map((l) => corDoNome(l.nome))
    while (cores.length < 4) cores.push(cores[cores.length % Math.max(1, cores.length)] ?? '#6366f1')
    return (
      <span
        aria-hidden
        className="grid shrink-0 grid-cols-2 gap-[2px] overflow-hidden rounded-[30%] p-[3px]"
        style={{ width: tamanho, height: tamanho, background: 'var(--superficie-2)', boxShadow: 'inset 0 0 0 1px var(--borda)' }}
      >
        {cores.map((c, i) => (
          <span key={i} className="rounded-[3px]" style={{ background: `linear-gradient(140deg, color-mix(in oklab, ${c} 70%, white), ${c})` }} />
        ))}
      </span>
    )
  }
  const cor = corDoNome(loja.nome)
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[30%] font-extrabold tracking-tight text-white"
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: Math.round(tamanho * 0.38),
        background: `linear-gradient(140deg, color-mix(in oklab, ${cor} 70%, white), ${cor} 60%, color-mix(in oklab, ${cor} 80%, black))`,
        boxShadow: `0 6px 14px -8px ${cor}, inset 0 1px 0 rgb(255 255 255 / .3)`,
      }}
    >
      {iniciaisDe(loja.nome)}
    </span>
  )
}

const IconeTrocar = ({ className }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h11l-3-3M16 13H5l3 3" />
  </svg>
)

export function TrocaDeLoja({
  slug,
  opcoes,
  atual: doServidor,
  jeito,
}: {
  slug: string
  opcoes: UnidadeVisivel[]
  /** A loja que o servidor resolveu para esta tela (null = todas). */
  atual: string | null
  /** `lado`: o cartão da barra lateral. `trilho`: só o azulejo. `topo`: a cápsula do cabeçalho. */
  jeito: 'lado' | 'trilho' | 'topo'
}) {
  const router = useRouter()
  const caminho = usePathname()
  const busca = useSearchParams()

  // A barra lateral não sabe a loja do endereço (`?unidade=` de um link que
  // o gerente mandou): ele manda, se for uma loja desta lista.
  const doEndereco = busca.get('unidade')
  const atual = doEndereco && opcoes.some((u) => u.id === doEndereco) ? doEndereco : doServidor

  const [aberto, setAberto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [pulso, setPulso] = useState<Record<string, PulsoDaLoja> | null>(null)
  const [fabrica, setFabrica] = useState<{ liberada: boolean; liberarEm: string | null } | null>(null)
  const [indo, setIndo] = useState<{ loja: UnidadeVisivel | null; x: number; y: number } | null>(null)
  const [pendente, comecar] = useTransition()
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  // O vivo de cada loja só quando a tela abre: é uma consulta por loja, e
  // ninguém precisa dela em cada tela que abre.
  useEffect(() => {
    if (!aberto) return
    let vivo = true
    pulsoDasLojasAcao(slug)
      .then((p) => {
        if (!vivo) return
        setPulso(p.lojas)
        setFabrica(p.fabrica)
      })
      .catch(() => vivo && setPulso({}))
    return () => {
      vivo = false
    }
  }, [aberto, slug])

  const lista = useMemo(
    () => (filtro ? opcoes.filter((u) => u.nome.toLowerCase().includes(filtro.toLowerCase())) : opcoes),
    [filtro, opcoes],
  )

  function entrar(loja: UnidadeVisivel | null, ev?: { clientX: number; clientY: number }) {
    const id = loja?.id ?? null
    setAberto(false)
    setFiltro('')
    if (id === atual) return
    tocar('clique')
    setIndo({ loja, x: ev?.clientX ?? window.innerWidth / 2, y: ev?.clientY ?? window.innerHeight / 2 })
    lembrar(slug, id)
    // Tira a loja do endereço (a lembrada passa a valer) e mantém o resto:
    // o período e a busca continuam os mesmos, na loja nova.
    const p = new URLSearchParams(busca.toString())
    p.delete('unidade')
    p.delete('pagina')
    // Entrar na fábrica abre a Produção (o Painel, as vendas e o balcão não
    // são de lá); sair dela, de dentro das telas da fábrica, abre o Painel.
    const daFabrica = caminho.startsWith(`/${slug}/fabrica`) && !caminho.startsWith(`/${slug}/fabrica/pedir`)
    const destino = loja?.ehFabrica
      ? `/${slug}/fabrica`
      : daFabrica
        ? `/${slug}`
        : `${caminho}${p.size ? `?${p}` : ''}`
    // Um instante para a cor cobrir a tela antes de a nova chegar.
    window.setTimeout(() => {
      comecar(() => {
        router.push(destino)
        router.refresh()
      })
    }, 380)
  }

  // A cortina sai quando a tela nova chegou (e nunca antes de se ver o nome).
  useEffect(() => {
    if (!indo || pendente) return
    const t = window.setTimeout(() => setIndo(null), 900)
    return () => window.clearTimeout(t)
  }, [indo, pendente])

  // Teclado: Esc fecha; 1–9 entram na loja daquele número (0 = todas).
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setAberto(false)
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === '0') return entrar(null)
      const n = Number(e.key)
      if (n >= 1 && n <= 9 && lista[n - 1]) entrar(lista[n - 1]!)
    }
    document.addEventListener('keydown', tecla)
    const rolar = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tecla)
      document.documentElement.style.overflow = rolar
    }
  }, [aberto, lista])

  const escolhida = atual ? (opcoes.find((u) => u.id === atual) ?? null) : null
  const nome = escolhida?.nome ?? 'Todas as lojas'

  const gatilho =
    jeito === 'trilho' ? (
      <button
        type="button"
        onClick={() => setAberto(true)}
        title={`Loja: ${nome} · trocar`}
        aria-label={`Loja: ${nome}. Trocar de loja`}
        className="mx-auto mb-1 grid place-items-center rounded-xl p-0.5 transition-transform hover:scale-105 active:scale-95"
      >
        <AzulejoDaLoja loja={escolhida} todas={opcoes} tamanho={30} />
      </button>
    ) : jeito === 'lado' ? (
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Loja: ${nome}. Trocar de loja`}
        className="loja-lado group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left"
        style={{ '--loja': escolhida ? corDoNome(escolhida.nome) : 'var(--marca)' } as CSSProperties}
      >
        <AzulejoDaLoja loja={escolhida} todas={opcoes} tamanho={32} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] leading-tight font-bold tracking-[0.12em] text-lado-tinta-2 uppercase">{escolhida?.ehFabrica ? 'Você está na fábrica' : escolhida ? 'Você está na loja' : 'Vendo a rede'}</span>
          <span className="truncate text-[13px] leading-tight font-bold text-lado-tinta">{nome}</span>
        </span>
        <span className="grid size-6 shrink-0 place-items-center rounded-lg text-lado-tinta-2 transition-colors group-hover:bg-lado-3 group-hover:text-lado-tinta">
          <IconeTrocar className="size-3.5" />
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Loja: ${nome}. Trocar de loja`}
        className="loja-topo botao-vivo flex h-9 max-w-[15rem] items-center gap-2 rounded-full pr-3 pl-1 text-sm font-semibold text-tinta"
        style={{ '--loja': escolhida ? corDoNome(escolhida.nome) : 'var(--marca)' } as CSSProperties}
      >
        <AzulejoDaLoja loja={escolhida} todas={opcoes} tamanho={26} />
        <span className="truncate">{nome}</span>
        <IconeTrocar className="size-3.5 shrink-0 text-tinta-3" />
      </button>
    )

  const cartao = (loja: UnidadeVisivel | null, i: number) => {
    // A fábrica sem contrato: o cartão aparece, com o cadeado, e leva a quem
    // liga o módulo — entrar nela sem a Fábrica seria um galpão vazio.
    if (loja?.ehFabrica && fabrica && !fabrica.liberada) {
      const miolo = (
        <>
          <span className="flex items-start gap-3">
            <span className="relative">
              <AzulejoDaLoja loja={loja} tamanho={48} />
              <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full bg-tinta text-superficie ring-2 ring-superficie">
                <svg aria-hidden viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4.5" y="9" width="11" height="8" rx="2" />
                  <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
                </svg>
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col pt-0.5">
              <span className="truncate text-[15px] leading-tight font-extrabold tracking-tight text-tinta">{loja.nome}</span>
              <span className="text-xs text-tinta-3">A Fábrica ainda não está contratada</span>
            </span>
          </span>
          <span className="text-xs text-tinta-2">Produção com ficha técnica, lote e o pedido das lojas — com ela, as lojas pedem à fábrica pelo Estoque.</span>
          <span className="loja-liberar inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-white">
            {fabrica.liberarEm ? 'Liberar a Fábrica' : 'Peça a quem responde pela empresa'}
            {fabrica.liberarEm ? (
              <svg aria-hidden viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m8 5 5 5-5 5" />
              </svg>
            ) : null}
          </span>
        </>
      )
      const estilo = { '--loja': corDoNome(loja.nome), animationDelay: `${Math.min(i, 10) * 35}ms` } as CSSProperties
      return fabrica.liberarEm ? (
        <a key={loja.id} href={fabrica.liberarEm} style={estilo} className="loja-cartao loja-trancada group relative flex min-w-0 flex-col gap-3 rounded-2xl p-4 text-left">
          {miolo}
        </a>
      ) : (
        <div key={loja.id} style={estilo} className="loja-cartao loja-trancada relative flex min-w-0 flex-col gap-3 rounded-2xl p-4 text-left">
          {miolo}
        </div>
      )
    }
    const aqui = (loja?.id ?? null) === atual
    const cor = loja ? corDoNome(loja.nome) : 'var(--marca)'
    const p = loja ? pulso?.[loja.id] : null
    const rede = !loja && pulso ? Object.values(pulso) : null
    const lugar = loja ? [loja.bairro, loja.cidade].filter(Boolean).join(' · ') : `${opcoes.filter((u) => !u.ehFabrica).length} lojas somadas`
    const tipo = loja?.ehFabrica ? 'fábrica' : loja?.ehDeposito ? 'depósito' : null
    return (
      <button
        key={loja?.id ?? 'todas'}
        type="button"
        onClick={(e) => entrar(loja, e)}
        aria-current={aqui ? 'true' : undefined}
        style={{ '--loja': cor, animationDelay: `${Math.min(i, 10) * 35}ms` } as CSSProperties}
        className="loja-cartao group relative flex min-w-0 flex-col gap-3 rounded-2xl p-4 text-left"
      >
        <span className="flex items-start gap-3">
          <AzulejoDaLoja loja={loja} todas={opcoes} tamanho={48} />
          <span className="flex min-w-0 flex-1 flex-col pt-0.5">
            <span className="truncate text-[15px] leading-tight font-extrabold tracking-tight text-tinta">{loja?.nome ?? 'Todas as lojas'}</span>
            <span className="truncate text-xs text-tinta-3">{lugar || (loja?.ehFabrica ? 'produção, fichas e pedidos das lojas' : 'loja')}</span>
          </span>
          <kbd className="hidden rounded-md border border-borda bg-superficie-2 px-1.5 py-px font-sans text-[11.5px] font-bold text-tinta-3 sm:block">{loja ? i : 0}</kbd>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
          {aqui ? <span className="loja-aqui rounded-full px-2 py-0.5 text-white">Você está aqui</span> : null}
          {tipo ? <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-tinta-2">{tipo}</span> : null}
          {loja && p && !loja.ehFabrica ? (
            <>
              {p.caixa !== null ? (
                <span className={cx('flex items-center gap-1 rounded-full px-2 py-0.5', p.caixa ? 'bg-bom-fundo text-bom' : 'bg-superficie-2 text-tinta-3')}>
                  <span className={cx('size-1.5 rounded-full', p.caixa ? 'respira bg-bom-vivo' : 'bg-tinta-3')} />
                  {p.caixa ? 'caixa aberto' : 'caixa fechado'}
                </span>
              ) : null}
              <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-tinta-2">
                <span className="numero">{p.vendas}</span> {p.vendas === 1 ? 'venda' : 'vendas'} hoje
              </span>
              {p.total !== null ? <span className="numero rounded-full bg-superficie-2 px-2 py-0.5 text-tinta">{brl(p.total)}</span> : null}
            </>
          ) : rede && rede.length ? (
            <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-tinta-2">
              <span className="numero">{rede.reduce((s, x) => s + x.vendas, 0)}</span> vendas hoje na rede
            </span>
          ) : loja && !pulso && !loja.ehFabrica ? (
            <span className="loja-carregando h-5 w-28 rounded-full" />
          ) : null}
        </span>
      </button>
    )
  }

  const palco =
    aberto &&
    createPortal(
      <div
        className="loja-fundo fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setAberto(false)
        }}
      >
        <div role="dialog" aria-modal="true" aria-label="Trocar de loja" className="loja-palco relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl">
          <div className="loja-palco-topo relative flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] font-bold tracking-[0.14em] text-tinta-3 uppercase">Trocar de loja</span>
              <h2 className="text-xl leading-tight font-extrabold tracking-[-0.02em] text-balance text-tinta sm:text-2xl">Em qual loja você quer trabalhar?</h2>
              <p className="max-w-md text-sm text-tinta-2">Vendas, estoque, caixa e relatórios passam a mostrar só a loja escolhida — até você trocar de novo.</p>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-superficie-2 text-tinta-2 transition-colors hover:bg-borda hover:text-tinta"
            >
              <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
          {opcoes.length > COM_BUSCA && (
            <div className="px-5 pb-3 sm:px-7">
              <input
                autoFocus
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Procurar loja..."
                className="h-11 w-full rounded-2xl border border-borda bg-superficie px-4 text-sm text-tinta placeholder:text-tinta-3"
              />
            </div>
          )}
          <div className="grid gap-3 overflow-y-auto px-5 pt-1 pb-6 sm:grid-cols-2 sm:px-7">
            {!filtro && cartao(null, 0)}
            {lista.filter((u) => !u.ehFabrica).map((u) => cartao(u, lista.indexOf(u) + 1))}
            {lista.some((u) => u.ehFabrica) && (
              <span className="col-span-full mt-2 flex items-center gap-2 text-[11.5px] font-bold tracking-[0.12em] text-tinta-3 uppercase">
                Fábrica
                <span aria-hidden className="h-px flex-1 bg-borda-suave" />
              </span>
            )}
            {lista.filter((u) => u.ehFabrica).map((u) => cartao(u, lista.indexOf(u) + 1))}
            {lista.length === 0 && <p className="col-span-full py-6 text-center text-sm text-tinta-3">Nenhuma loja com esse nome.</p>}
          </div>
        </div>
      </div>,
      document.body,
    )

  // A cortina: a cor da loja sai do ponto tocado e cobre a tela, com o nome.
  const cortina =
    indo &&
    montado &&
    createPortal(
      <div
        aria-live="polite"
        className="loja-cortina fixed inset-0 z-[95] grid place-items-center"
        style={
          {
            '--loja': indo.loja ? corDoNome(indo.loja.nome) : 'var(--marca)',
            '--x': `${indo.x}px`,
            '--y': `${indo.y}px`,
          } as CSSProperties
        }
      >
        <div className="loja-cortina-miolo flex flex-col items-center gap-4 px-6 text-center text-white">
          <span className="loja-cortina-azulejo grid size-20 place-items-center rounded-[30%] bg-white/18 text-3xl font-extrabold ring-1 ring-white/30 backdrop-blur">
            {indo.loja ? iniciaisDe(indo.loja.nome) : '★'}
          </span>
          <span className="text-xs font-bold tracking-[0.2em] uppercase opacity-80">{indo.loja?.ehFabrica ? 'Entrando na fábrica' : indo.loja ? 'Entrando na loja' : 'Abrindo a rede'}</span>
          <span className="text-3xl leading-tight font-extrabold tracking-[-0.02em] sm:text-4xl">{indo.loja?.nome ?? 'Todas as lojas'}</span>
          <span className="loja-cortina-barra mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/25">
            <span className="block h-full w-1/3 rounded-full bg-white" />
          </span>
        </div>
      </div>,
      document.body,
    )

  return (
    <>
      <div data-fixo="" className={jeito === 'lado' ? 'w-full' : undefined}>
        {gatilho}
      </div>
      {montado && palco}
      {cortina}
    </>
  )
}
