'use client'

// O que a vitrine tem além da grade de produtos: as bolinhas do topo (os
// stories), o visor em tela cheia, o mural de novidades e as avaliações.
//
// ── as bolinhas ──────────────────────────────────────────────
// Primeiro as postagens da loja (a novidade, a promoção do dia), depois uma
// por categoria. Tocar abre o visor: cada postagem é uma tela; cada categoria
// passa os produtos dela, um por tela, com o botão de pedir. Toque na direita
// avança, na esquerda volta, segurar pausa, arrastar para baixo fecha — o
// gesto que todo mundo já sabe do Instagram.
//
// O que já foi visto fica com o anel cinza, guardado NESTE aparelho.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProdutoNoCatalogo } from '@/servidor/catalogo'
import type { AvaliacaoNaVitrine, PostagemNaVitrine } from '@/servidor/vitrine'
import type { IconeDoProduto } from './icone'
import { Adiante, Fechar, Foto, MarcaDaLoja } from './Pecas'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const TEMPO_MS = 6000

export type Bolinha =
  | { tipo: 'postagem'; id: string; rotulo: string; postagem: PostagemNaVitrine }
  /** Um grupo de produtos: o destaque montado pela loja, ou uma categoria (quando a loja não montou nenhum). */
  | { tipo: 'grupo'; id: string; rotulo: string; capa: string | null; icone: IconeDoProduto; categoriaId: string | null; produtoIds: string[] }

type Tela =
  | { tipo: 'postagem'; postagem: PostagemNaVitrine }
  | { tipo: 'produto'; produto: ProdutoNoCatalogo }
  | { tipo: 'carregando' }
  | { tipo: 'vazio'; rotulo: string }

function lerVistos(chave: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(chave) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

// ─────────────────────────────────────────────────────────────
// A FILEIRA DE BOLINHAS
// ─────────────────────────────────────────────────────────────

export function Bolinhas({
  bolinhas,
  logo,
  nome,
  chaveVistos,
  abrir,
}: {
  bolinhas: Bolinha[]
  logo: string | null
  nome: string
  chaveVistos: string
  abrir: (indice: number) => void
}) {
  const [vistos, setVistos] = useState<Set<string>>(new Set())
  useEffect(() => {
    setVistos(lerVistos(chaveVistos))
    const atualizar = () => setVistos(lerVistos(chaveVistos))
    window.addEventListener('vt-vistos', atualizar)
    return () => window.removeEventListener('vt-vistos', atualizar)
  }, [chaveVistos])
  if (bolinhas.length === 0) return null
  return (
    <nav aria-label="Novidades e categorias" className="vt-sem-barra -mx-4 flex gap-3.5 overflow-x-auto px-4 pt-1 pb-2">
      {bolinhas.map((b, i) => {
        const visto = b.tipo === 'postagem' && vistos.has(b.id)
        return (
          <button
            key={`${b.tipo}-${b.id}`}
            type="button"
            onClick={() => abrir(i)}
            className={`group flex w-[74px] shrink-0 flex-col items-center gap-1.5 rounded-2xl ${FOCO}`}
          >
            <span className={`flex h-[70px] w-[70px] items-center justify-center rounded-full p-[3px] ${visto ? 'vt-anel-visto' : 'vt-anel'}`}>
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-[3px] border-fundo bg-superficie-2 transition-transform group-active:scale-95">
                {b.tipo === 'postagem' ? (
                  b.postagem.foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.postagem.foto} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <MarcaDaLoja nome={nome} logo={logo} className="h-full w-full rounded-full text-lg" />
                  )
                ) : (
                  <Foto src={b.capa} icone={b.icone} tom={b.id} desenho={30} />
                )}
              </span>
            </span>
            <span className={`line-clamp-1 w-full text-center text-[11.5px] leading-tight ${visto ? 'text-tinta-3' : 'font-semibold text-tinta'}`}>{b.rotulo}</span>
          </button>
        )
      })}
    </nav>
  )
}

// ─────────────────────────────────────────────────────────────
// O VISOR (tela cheia)
// ─────────────────────────────────────────────────────────────

export function Visor({
  bolinhas,
  inicio,
  fechar,
  carregarGrupo,
  iconeDe,
  escolher,
  queroEsse,
  chaveVistos,
  loja,
  logo,
}: {
  bolinhas: Bolinha[]
  inicio: number
  fechar: () => void
  carregarGrupo: (b: Extract<Bolinha, { tipo: 'grupo' }>) => Promise<ProdutoNoCatalogo[]>
  iconeDe: (nome: string, categoriaId: string | null) => IconeDoProduto
  /** Abre o produto (para escolher o tamanho, a quantidade) e fecha o visor. */
  escolher: (p: ProdutoNoCatalogo) => void
  /** O "Quero esse" da postagem: busca o produto e abre. */
  queroEsse: (produtoId: string) => void
  chaveVistos: string
  loja: string
  logo: string | null
}) {
  const [bolinha, setBolinha] = useState(inicio)
  const [telas, setTelas] = useState<Tela[]>([{ tipo: 'carregando' }])
  const [tela, setTela] = useState(0)
  const [pausado, setPausado] = useState(false)
  const toque = useRef<{ x: number; y: number; t: number } | null>(null)
  const atual = bolinhas[bolinha]

  // As telas da bolinha: a postagem é uma; a categoria, um produto por tela.
  useEffect(() => {
    let vivo = true
    const b = bolinhas[bolinha]
    if (!b) return
    setTela(0)
    if (b.tipo === 'postagem') {
      setTelas([{ tipo: 'postagem', postagem: b.postagem }])
      try {
        const v = lerVistos(chaveVistos)
        v.add(b.id)
        localStorage.setItem(chaveVistos, JSON.stringify([...v].slice(-200)))
        window.dispatchEvent(new Event('vt-vistos'))
      } catch {
        // aparelho sem armazenamento: só não lembra
      }
      return
    }
    setTelas([{ tipo: 'carregando' }])
    carregarGrupo(b)
      .then((ps) => {
        if (!vivo) return
        setTelas(ps.length ? ps.slice(0, 12).map((p) => ({ tipo: 'produto' as const, produto: p })) : [{ tipo: 'vazio', rotulo: b.rotulo }])
      })
      .catch(() => vivo && setTelas([{ tipo: 'vazio', rotulo: b.rotulo }]))
    return () => {
      vivo = false
    }
  }, [bolinha, bolinhas, carregarGrupo, chaveVistos])

  const avancar = useCallback(() => {
    if (tela < telas.length - 1) return setTela((t) => t + 1)
    if (bolinha < bolinhas.length - 1) return setBolinha((b) => b + 1)
    fechar()
  }, [tela, telas.length, bolinha, bolinhas.length, fechar])
  const voltar = useCallback(() => {
    if (tela > 0) return setTela((t) => t - 1)
    if (bolinha > 0) setBolinha((b) => b - 1)
  }, [tela, bolinha])

  // O relógio de cada tela. Carregando não conta.
  const agora = telas[tela]
  useEffect(() => {
    if (pausado || !agora || agora.tipo === 'carregando') return
    const t = setTimeout(avancar, TEMPO_MS)
    return () => clearTimeout(t)
  }, [pausado, agora, avancar, tela, bolinha])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
      else if (e.key === 'ArrowRight') avancar()
      else if (e.key === 'ArrowLeft') voltar()
    }
    window.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', tecla)
      document.body.style.overflow = antes
    }
  }, [fechar, avancar, voltar])

  if (!atual) return null
  const rotuloTopo = atual.tipo === 'postagem' ? loja : atual.rotulo

  return (
    <div role="dialog" aria-modal="true" aria-label={`Stories: ${rotuloTopo}`} className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
      <div
        className="relative h-full w-full max-w-md overflow-hidden bg-neutral-900 text-white select-none sm:h-[92dvh] sm:rounded-3xl"
        onPointerDown={(e) => {
          toque.current = { x: e.clientX, y: e.clientY, t: Date.now() }
          setPausado(true)
        }}
        onPointerUp={(e) => {
          setPausado(false)
          const t = toque.current
          toque.current = null
          if (!t) return
          const dy = e.clientY - t.y
          if (dy > 90) return fechar()
          // Segurou: era pausa, não toque.
          if (Date.now() - t.t > 350) return
          const alvo = e.target as HTMLElement
          if (alvo.closest('button, a')) return
          const caixa = e.currentTarget.getBoundingClientRect()
          if (e.clientX - caixa.left < caixa.width * 0.32) voltar()
          else avancar()
        }}
        onPointerCancel={() => setPausado(false)}
      >
        {/* As barrinhas, uma por tela desta bolinha. */}
        <div className="absolute inset-x-0 top-0 z-20 flex gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {telas.map((_, i) => (
            <span key={`${bolinha}-${i}`} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              {i < tela ? <span className="block h-full w-full bg-white" /> : null}
              {i === tela && agora?.tipo !== 'carregando' ? (
                <span key={`${bolinha}-${tela}`} data-pausado={pausado ? '1' : '0'} className="vt-encher block h-full w-full bg-white" style={{ animationDuration: `${TEMPO_MS}ms` }} />
              ) : null}
            </span>
          ))}
        </div>
        <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2.5 px-3 pt-[max(1.6rem,calc(env(safe-area-inset-top)+0.85rem))]">
          <MarcaDaLoja nome={loja} logo={logo} className="h-8 w-8 rounded-full text-xs ring-2 ring-white/70" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold drop-shadow">{rotuloTopo}</p>
          <button type="button" onClick={fechar} aria-label="Fechar" className="flex h-10 w-10 items-center justify-center rounded-full bg-black/25 backdrop-blur-sm">
            <Fechar tamanho={18} />
          </button>
        </div>

        {agora?.tipo === 'carregando' ? (
          <div className="flex h-full items-center justify-center">
            <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-label="Carregando" />
          </div>
        ) : agora?.tipo === 'vazio' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-lg font-bold">{agora.rotulo}</p>
            <p className="text-sm text-white/70">Nada disponível aqui agora.</p>
          </div>
        ) : agora?.tipo === 'postagem' ? (
          <TelaDaPostagem p={agora.postagem} queroEsse={queroEsse} />
        ) : agora?.tipo === 'produto' ? (
          <TelaDoProduto p={agora.produto} icone={iconeDe(agora.produto.nome, agora.produto.categoriaId)} escolher={escolher} />
        ) : null}
      </div>
    </div>
  )
}

function TelaDaPostagem({ p, queroEsse }: { p: PostagemNaVitrine; queroEsse: (id: string) => void }) {
  return (
    <div key={p.id} className="vt-story relative h-full w-full">
      {p.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.foto} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(160deg,var(--marca),var(--marca-forte,var(--marca)))]" />
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-5 pt-24 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h2 className="text-2xl leading-tight font-extrabold text-balance text-white drop-shadow">{p.titulo}</h2>
        {p.texto ? <p className="text-[15px] leading-relaxed whitespace-pre-line text-white/90">{p.texto}</p> : null}
        {p.produtoId ? (
          <button
            type="button"
            onClick={() => queroEsse(p.produtoId!)}
            className="mt-1 flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-base font-bold text-neutral-900 shadow-lg active:scale-[0.99]"
          >
            Quero esse <Adiante tamanho={16} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function TelaDoProduto({ p, icone, escolher }: { p: ProdutoNoCatalogo; icone: IconeDoProduto; escolher: (p: ProdutoNoCatalogo) => void }) {
  return (
    <div key={p.id} className="vt-story relative flex h-full w-full flex-col">
      <div className="relative flex-1">
        <div className="absolute inset-0">
          <Foto src={p.foto} icone={icone} tom={p.categoriaId} desenho={120} />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pt-28 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h2 className="text-2xl leading-tight font-extrabold text-balance text-white drop-shadow">{p.nome}</h2>
        {p.descricao ? <p className="line-clamp-3 text-[15px] leading-relaxed text-white/85">{p.descricao}</p> : null}
        <p className="text-xl font-extrabold tabular-nums">
          {p.variavel ? <span className="mr-1 text-sm font-semibold text-white/70">a partir de</span> : null}
          {brl(p.preco)}
          {p.medida !== 'UN' ? <span className="text-sm font-semibold text-white/70"> /{p.medida.toLowerCase()}</span> : null}
        </p>
        <button
          type="button"
          disabled={!p.disponivel}
          onClick={() => escolher(p)}
          className="mt-1 flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-base font-bold text-neutral-900 shadow-lg active:scale-[0.99] disabled:opacity-60"
        >
          {p.disponivel ? 'Pedir este' : 'Esgotado'} {p.disponivel ? <Adiante tamanho={16} /> : null}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// O MURAL DE NOVIDADES
// ─────────────────────────────────────────────────────────────

export function Mural({ mural, abrir, queroEsse }: { mural: PostagemNaVitrine[]; abrir: (id: string) => void; queroEsse: (id: string) => void }) {
  if (mural.length === 0) return null
  return (
    <section aria-labelledby="vt-novidades" className="mx-auto max-w-5xl px-4 pt-10">
      <h2 id="vt-novidades" className="mb-3 text-lg font-extrabold tracking-tight text-titulo">
        Novidades
      </h2>
      <ul className="vt-sem-barra -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
        {mural.map((p) => (
          <li key={p.id} className="w-[244px] shrink-0 snap-start">
            <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-borda-suave bg-superficie shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
              <button type="button" onClick={() => abrir(p.id)} className={`relative aspect-[4/5] w-full overflow-hidden bg-superficie-2 ${FOCO}`} aria-label={`Ver ${p.titulo}`}>
                {p.foto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.foto} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-end bg-[linear-gradient(160deg,var(--marca),var(--marca-forte,var(--marca)))] p-4 text-left">
                    <span className="text-xl leading-tight font-extrabold text-marca-tinta">{p.titulo}</span>
                  </div>
                )}
              </button>
              <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                <h3 className="line-clamp-2 text-[15px] leading-snug font-bold text-titulo">{p.titulo}</h3>
                {p.texto ? <p className="line-clamp-3 text-[13px] leading-relaxed text-tinta-2">{p.texto}</p> : null}
                <p className="mt-auto pt-1 text-[11px] text-tinta-3">{haQuanto(p.criadaEm)}</p>
                {p.produtoId ? (
                  <button
                    type="button"
                    onClick={() => queroEsse(p.produtoId!)}
                    className={`mt-1 flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-marca-suave px-3 text-sm font-bold text-[var(--marca-texto)] hover:brightness-95 ${FOCO}`}
                  >
                    Quero esse <Adiante tamanho={14} />
                  </button>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function haQuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return min <= 1 ? 'agora' : `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return d === 1 ? 'ontem' : `há ${d} dias`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// ─────────────────────────────────────────────────────────────
// AS AVALIAÇÕES
// ─────────────────────────────────────────────────────────────

export function Estrelas({ nota, tamanho = 14, className = '' }: { nota: number; tamanho?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={`${nota.toLocaleString('pt-BR')} de 5 estrelas`} role="img">
      {[1, 2, 3, 4, 5].map((i) => {
        const cheio = Math.max(0, Math.min(1, nota - (i - 1)))
        return (
          <svg key={i} viewBox="0 0 20 20" width={tamanho} height={tamanho} aria-hidden>
            <defs>
              <linearGradient id={`vt-e-${i}-${Math.round(cheio * 100)}`}>
                <stop offset={`${cheio * 100}%`} stopColor="#f5a524" />
                <stop offset={`${cheio * 100}%`} stopColor="var(--borda)" />
              </linearGradient>
            </defs>
            <path
              d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z"
              fill={`url(#vt-e-${i}-${Math.round(cheio * 100)})`}
            />
          </svg>
        )
      })}
    </span>
  )
}

export function Avaliacoes({ media, total, ultimas }: { media: number | null; total: number; ultimas: AvaliacaoNaVitrine[] }) {
  if (total === 0 || media === null) return null
  return (
    <section id="avaliacoes" aria-labelledby="vt-avaliacoes" className="mx-auto max-w-5xl scroll-mt-28 px-4 pt-10">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 id="vt-avaliacoes" className="text-lg font-extrabold tracking-tight text-titulo">
          O que dizem de nós
        </h2>
      </div>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex shrink-0 items-center gap-4 rounded-3xl border border-borda-suave bg-superficie p-5 md:w-56 md:flex-col md:items-start">
          <p className="text-5xl leading-none font-extrabold tracking-tight text-titulo tabular-nums">{media.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</p>
          <div className="flex flex-col gap-1">
            <Estrelas nota={media} tamanho={18} />
            <p className="text-sm text-tinta-2">
              {total} {total === 1 ? 'avaliação' : 'avaliações'} de quem pediu
            </p>
          </div>
        </div>
        <ul className="grid flex-1 gap-3 sm:grid-cols-2">
          {ultimas.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-3xl border border-borda-suave bg-superficie p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-marca-suave text-sm font-bold text-[var(--marca-texto)]">
                    {a.nome.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-tinta">{a.nome}</span>
                </span>
                <span className="text-[11px] text-tinta-3">{haQuanto(a.criadaEm)}</span>
              </div>
              <Estrelas nota={a.nota} />
              {a.texto ? <p className="text-sm leading-relaxed text-tinta-2">{a.texto}</p> : null}
              {a.resposta ? (
                <p className="rounded-2xl bg-superficie-2 px-3 py-2 text-[13px] leading-relaxed text-tinta-2">
                  <span className="font-semibold text-tinta">Resposta da loja: </span>
                  {a.resposta}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
