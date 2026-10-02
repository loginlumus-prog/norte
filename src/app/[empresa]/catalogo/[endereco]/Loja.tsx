'use client'

// A vitrine da loja no celular da cliente.
//
// Três momentos, e cada um cabe numa mão: OLHAR (categorias, busca, a grade
// com foto e preço), ESCOLHER (o produto abre por baixo: tamanho/sabor,
// quantidade, "adicionar") e PEDIR (a sacola, nome e WhatsApp, retirar ou
// receber, como paga). Depois do pedido, o botão grande manda tudo para o
// WhatsApp da loja — é ali que a conversa continua.
//
// A sacola e os dados da cliente ficam NESTE aparelho (localStorage), para
// quem fechou a aba sem querer voltar e achar tudo onde deixou. Nada disso vai
// para o servidor antes de "Fazer pedido".

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { FormaPagamento } from '@prisma/client'
import type { ProdutoNoCatalogo, OpcaoNoCatalogo, VitrinePublica } from '@/servidor/catalogo'
import { maisProdutos, pedir } from './acoes'
import { IconeFechar, IconeMais, IconeVisto } from '@/ui/Icones'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (q: number, medida: string) =>
  medida === 'UN' ? String(q) : `${q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${medida.toLowerCase()}`
const passoDe = (medida: string) => (medida === 'UN' ? 1 : medida === 'KG' ? 0.25 : 0.5)
const arred = (n: number) => Math.round(n * 1000) / 1000

type NaSacola = {
  variacaoId: string
  produtoId: string
  nome: string
  rotulo: string
  preco: number
  medida: string
  foto: string | null
  quantidade: number
  observacao: string
}

type Dados = {
  nome: string
  telefone: string
  entrega: boolean
  endereco: string
  quando: 'logo' | 'agendar'
  para: string
  forma: FormaPagamento | ''
  trocoPara: string
  observacao: string
}

const FORMAS: { forma: FormaPagamento; rotulo: string }[] = [
  { forma: 'PIX', rotulo: 'Pix' },
  { forma: 'DINHEIRO', rotulo: 'Dinheiro' },
  { forma: 'DEBITO', rotulo: 'Débito' },
  { forma: 'CREDITO', rotulo: 'Crédito' },
]

function ler<T>(chave: string, padrao: T): T {
  try {
    const c = localStorage.getItem(chave)
    return c ? (JSON.parse(c) as T) : padrao
  } catch {
    return padrao
  }
}
function gravar(chave: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(chave)
    else localStorage.setItem(chave, JSON.stringify(v))
  } catch {
    // Aparelho sem lugar: a sacola vive só enquanto a aba está aberta.
  }
}

/* ── desenhos pequenos (24, traço 1.8, cor de quem chama) ── */
const Lupa = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
)
const Sacola = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
    <path d="M5 8h14l-1.2 12H6.2z" />
    <path d="M9 10V6.5a3 3 0 0 1 6 0V10" strokeLinecap="round" />
  </svg>
)
const Menos = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M6 12h12" />
  </svg>
)
const Zap = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
    <path d="M12 2.2a9.7 9.7 0 0 0-8.4 14.6L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2Zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2c0 1.2.9 2.4 1 2.5.1.2 1.7 2.7 4.2 3.8 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.3Z" />
  </svg>
)

function Foto({ src, nome, className }: { src: string | null; nome: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${className ?? ''}`} />
  }
  return (
    <div aria-hidden className={`flex h-full w-full items-center justify-center bg-marca-suave text-2xl font-bold text-marca ${className ?? ''}`}>
      {nome.trim().charAt(0).toUpperCase()}
    </div>
  )
}

function Passador({ valor, medida, mudar, min = 0 }: { valor: number; medida: string; mudar: (n: number) => void; min?: number }) {
  const passo = passoDe(medida)
  return (
    <div className="flex items-center rounded-full border border-borda bg-superficie">
      <button
        type="button"
        aria-label="Diminuir"
        onClick={() => mudar(arred(Math.max(min, valor - passo)))}
        className="flex h-10 w-10 items-center justify-center rounded-full text-tinta-2 hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-marca"
      >
        <Menos />
      </button>
      <span className="min-w-14 text-center text-sm font-semibold tabular-nums">{qtd(valor, medida)}</span>
      <button
        type="button"
        aria-label="Aumentar"
        onClick={() => mudar(arred(Math.min(999, valor + passo)))}
        className="flex h-10 w-10 items-center justify-center rounded-full text-tinta-2 hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-marca"
      >
        <IconeMais tamanho={18} />
      </button>
    </div>
  )
}

/** A folha que sobe de baixo (no computador, uma janela no meio). */
function Folha({ aberta, fechar, titulo, children, rodape }: { aberta: boolean; fechar: () => void; titulo: string; children: React.ReactNode; rodape?: React.ReactNode }) {
  useEffect(() => {
    if (!aberta) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && fechar()
    window.addEventListener('keydown', esc)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = antes
    }
  }, [aberta, fechar])
  if (!aberta) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <button type="button" aria-label="Fechar" onClick={fechar} className="absolute inset-0 bg-black/45" />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-superficie shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <header className="flex items-center justify-between gap-3 border-b border-borda-suave px-5 py-3.5">
          <h2 className="text-base font-bold text-titulo">{titulo}</h2>
          <button type="button" onClick={fechar} aria-label="Fechar" className="-mr-2 rounded-full p-2 text-tinta-2 hover:bg-superficie-2">
            <IconeFechar tamanho={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {rodape ? <footer className="border-t border-borda-suave px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{rodape}</footer> : null}
      </div>
    </div>
  )
}

export function Loja({
  vitrine,
  primeira,
  carimbo,
}: {
  vitrine: VitrinePublica
  primeira: { produtos: ProdutoNoCatalogo[]; mais: boolean; proximo: number }
  carimbo: string
}) {
  const { empresa, loja, endereco: enderecoCat, categorias } = vitrine
  const slug = empresa.slug
  const CHAVE_SACOLA = `norte:sacola:${slug}:${enderecoCat}`
  const CHAVE_DADOS = `norte:cliente:${slug}`
  const CHAVE_ULTIMO = `norte:ultimo-pedido:${slug}:${enderecoCat}`

  // ── a vitrine ──
  const [categoria, setCategoria] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [lista, setLista] = useState(primeira)
  const [carregando, setCarregando] = useState(false)
  const pedidoAtual = useRef(0)

  const carregar = useCallback(
    async (cat: string | null, termo: string, pular: number) => {
      const meu = ++pedidoAtual.current
      setCarregando(true)
      try {
        const r = await maisProdutos(slug, enderecoCat, { categoriaId: cat, busca: termo, pular })
        if (meu !== pedidoAtual.current || !r) return
        setLista((l) => (pular === 0 ? r : { ...r, produtos: [...l.produtos, ...r.produtos] }))
      } catch {
        // Sem conexão: a vitrine fica como estava.
      } finally {
        if (meu === pedidoAtual.current) setCarregando(false)
      }
    },
    [slug, enderecoCat],
  )

  const primeiraVez = useRef(true)
  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false
      return
    }
    const t = setTimeout(() => void carregar(categoria, busca.trim().length >= 2 ? busca : '', 0), busca ? 300 : 0)
    return () => clearTimeout(t)
  }, [categoria, busca, carregar])

  // ── a sacola ──
  const [sacola, setSacola] = useState<NaSacola[]>([])
  const [dados, setDados] = useState<Dados>({
    nome: '',
    telefone: '',
    entrega: !loja.retirada && loja.entrega,
    endereco: '',
    quando: 'logo',
    para: '',
    forma: '',
    trocoPara: '',
    observacao: '',
  })
  const [ultimo, setUltimo] = useState<string | null>(null)
  useEffect(() => {
    setSacola(ler<NaSacola[]>(CHAVE_SACOLA, []))
    const d = ler<Partial<Dados>>(CHAVE_DADOS, {})
    setDados((x) => ({ ...x, nome: d.nome ?? '', telefone: d.telefone ?? '', endereco: d.endereco ?? '' }))
    setUltimo(ler<string | null>(CHAVE_ULTIMO, null))
  }, [CHAVE_SACOLA, CHAVE_DADOS, CHAVE_ULTIMO])
  const mexerSacola = (f: (s: NaSacola[]) => NaSacola[]) =>
    setSacola((s) => {
      const n = f(s).filter((i) => i.quantidade > 0)
      gravar(CHAVE_SACOLA, n.length ? n : null)
      return n
    })

  const subtotal = useMemo(() => sacola.reduce((s, i) => s + Math.round(i.preco * 100 * i.quantidade), 0) / 100, [sacola])
  const itensNaSacola = sacola.reduce((s, i) => s + (i.medida === 'UN' ? i.quantidade : 1), 0)
  const taxa = dados.entrega && loja.taxaEntrega ? loja.taxaEntrega : 0
  const faltaMinimo = loja.pedidoMinimo && subtotal < loja.pedidoMinimo ? loja.pedidoMinimo - subtotal : 0

  // ── escolher um produto ──
  const [aberto, setAberto] = useState<ProdutoNoCatalogo | null>(null)
  const [opcao, setOpcao] = useState<OpcaoNoCatalogo | null>(null)
  const [quantidade, setQuantidade] = useState(1)
  const [obsItem, setObsItem] = useState('')
  function abrirProduto(p: ProdutoNoCatalogo) {
    setAberto(p)
    const disponiveis = p.opcoes.filter((o) => o.disponivel)
    setOpcao(disponiveis.length === 1 || p.opcoes.length === 1 ? (disponiveis[0] ?? null) : null)
    setQuantidade(p.medida === 'UN' ? 1 : passoDe(p.medida) * 2)
    setObsItem('')
  }
  const fecharProduto = useCallback(() => setAberto(null), [])
  function adicionar() {
    if (!aberto || !opcao) return
    const p = aberto
    mexerSacola((s) => {
      const ja = s.find((i) => i.variacaoId === opcao.variacaoId)
      if (ja) return s.map((i) => (i === ja ? { ...i, quantidade: arred(i.quantidade + quantidade), observacao: obsItem || i.observacao } : i))
      return [
        ...s,
        { variacaoId: opcao.variacaoId, produtoId: p.id, nome: p.nome, rotulo: opcao.rotulo, preco: opcao.preco, medida: p.medida, foto: p.foto, quantidade, observacao: obsItem },
      ]
    })
    setAberto(null)
  }

  // ── pedir ──
  const [etapa, setEtapa] = useState<null | 'sacola' | 'dados'>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, comecar] = useTransition()
  const [feito, setFeito] = useState<null | { codigo: string; acompanhamento: string; whatsapp: string | null; mensagem: string; total: number }>(null)
  const site = useRef<HTMLInputElement>(null)
  const fecharEtapa = useCallback(() => setEtapa(null), [])

  function mandar() {
    setErro(null)
    if (!dados.forma) return setErro('Escolha como vai pagar.')
    if (dados.quando === 'agendar' && !dados.para) return setErro('Escolha o dia e a hora.')
    comecar(async () => {
      let r: Awaited<ReturnType<typeof pedir>>
      try {
        r = await pedir(
          slug,
          enderecoCat,
          {
            nome: dados.nome,
            telefone: dados.telefone,
            entrega: dados.entrega,
            endereco: dados.endereco,
            para: dados.quando === 'agendar' && dados.para ? new Date(dados.para).toISOString() : null,
            forma: dados.forma as FormaPagamento,
            trocoPara: dados.forma === 'DINHEIRO' ? Number(dados.trocoPara.replace(/\./g, '').replace(',', '.')) || null : null,
            observacao: dados.observacao,
            itens: sacola.map((i) => ({ variacaoId: i.variacaoId, quantidade: i.quantidade, observacao: i.observacao || null })),
          },
          carimbo,
          site.current?.value ?? '',
        )
      } catch {
        setErro('Sem conexão. Confira a internet e tente de novo — o pedido continua aqui.')
        return
      }
      if (!r.ok) {
        setErro(r.erro)
        // Algo acabou no meio: a vitrine se atualiza para mostrar.
        if (r.mudou) void carregar(categoria, '', 0)
        return
      }
      gravar(CHAVE_DADOS, { nome: dados.nome, telefone: dados.telefone, endereco: dados.endereco })
      gravar(CHAVE_SACOLA, null)
      gravar(CHAVE_ULTIMO, r.acompanhamento)
      setUltimo(r.acompanhamento)
      setSacola([])
      setEtapa(null)
      setFeito({ codigo: r.codigo, acompanhamento: r.acompanhamento, whatsapp: r.whatsapp, mensagem: r.mensagem, total: r.totalC / 100 })
    })
  }

  const corDaMarca = empresa.corMarca && /^#[0-9a-fA-F]{6}$/.test(empresa.corMarca) ? empresa.corMarca : null
  const estilo = corDaMarca ? ({ '--marca': corDaMarca, '--marca-forte': corDaMarca } as React.CSSProperties) : undefined

  // ── depois do pedido ──
  if (feito) {
    const zap = feito.whatsapp ? `https://wa.me/${feito.whatsapp}?text=${encodeURIComponent(feito.mensagem)}` : null
    return (
      <main style={estilo} className="flex min-h-dvh items-center justify-center bg-fundo px-4 py-10">
        <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border border-borda bg-superficie p-6 text-center shadow-sm">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-bom-fundo text-bom">
            <IconeVisto tamanho={28} />
          </span>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-extrabold text-titulo text-balance">Pedido {feito.codigo} enviado</h1>
            <p className="text-sm text-tinta-2">
              Total de <strong className="text-tinta">{brl(feito.total)}</strong>. Agora mande pelo WhatsApp: a loja confirma mais rápido e vocês
              combinam o que faltar por lá.
            </p>
          </div>
          {zap ? (
            <a
              href={zap}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1f9d55] px-5 py-3.5 text-base font-bold text-white shadow-sm hover:brightness-95"
            >
              <Zap /> Enviar no WhatsApp
            </a>
          ) : null}
          <a href={`/${slug}/pedido/${feito.acompanhamento}`} className="w-full rounded-2xl border border-borda px-5 py-3 text-sm font-semibold text-tinta hover:bg-superficie-2">
            Acompanhar o pedido
          </a>
          <button type="button" onClick={() => setFeito(null)} className="text-sm font-medium text-tinta-2 underline-offset-4 hover:underline">
            Voltar ao catálogo
          </button>
        </div>
      </main>
    )
  }

  const produtos = lista.produtos
  const valorItemAberto = opcao ? Math.round(opcao.preco * 100 * quantidade) / 100 : 0

  return (
    <main style={estilo} className="min-h-dvh bg-fundo pb-28">
      {/* ── quem é a loja ── */}
      <header className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-6 pb-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-marca text-xl font-extrabold text-marca-tinta shadow-sm">
            {empresa.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={empresa.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              empresa.nome.trim().charAt(0).toUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-titulo">{empresa.nome}</h1>
            <p className="truncate text-sm text-tinta-2">
              {loja.nome && loja.nome !== empresa.nome ? loja.nome : 'Catálogo'}
              {loja.horario ? ` · ${loja.horario}` : ''}
            </p>
          </div>
        </div>
        {loja.recado ? <p className="rounded-2xl bg-marca-suave px-4 py-3 text-sm font-medium text-tinta">{loja.recado}</p> : null}
        <ul className="flex flex-wrap gap-2 text-xs font-medium text-tinta-2">
          {loja.retirada ? <li className="rounded-full border border-borda bg-superficie px-3 py-1">Retirada na loja</li> : null}
          {loja.entrega ? (
            <li className="rounded-full border border-borda bg-superficie px-3 py-1">
              Entrega{loja.taxaEntrega ? ` · ${brl(loja.taxaEntrega)}` : ' grátis'}
            </li>
          ) : null}
          {loja.pedidoMinimo ? <li className="rounded-full border border-borda bg-superficie px-3 py-1">Pedido mínimo {brl(loja.pedidoMinimo)}</li> : null}
          {loja.endereco ? <li className="rounded-full border border-borda bg-superficie px-3 py-1">{loja.endereco}</li> : null}
        </ul>
        {ultimo ? (
          <a href={`/${slug}/pedido/${ultimo}`} className="self-start text-sm font-semibold text-marca underline-offset-4 hover:underline">
            Acompanhar o meu último pedido
          </a>
        ) : null}
      </header>

      {/* ── procurar e categorias ── */}
      <div className="sticky top-0 z-30 border-b border-borda-suave bg-fundo/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-2.5 px-4 py-3">
          <label className="flex items-center gap-2 rounded-2xl border border-borda bg-superficie px-3.5 py-2.5 text-tinta-3 focus-within:border-marca">
            <Lupa />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar no catálogo"
              className="w-full bg-transparent text-[15px] text-tinta outline-none placeholder:text-tinta-3"
              enterKeyHint="search"
            />
          </label>
          {categorias.length > 1 ? (
            <nav aria-label="Categorias" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              {[{ id: null as string | null, nome: 'Tudo' }, ...categorias].map((c) => (
                <button
                  key={c.id ?? 'tudo'}
                  type="button"
                  onClick={() => setCategoria(c.id)}
                  aria-pressed={categoria === c.id}
                  className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                    categoria === c.id ? 'border-transparent bg-marca text-marca-tinta' : 'border-borda bg-superficie text-tinta-2 hover:text-tinta'
                  }`}
                >
                  {c.nome}
                </button>
              ))}
            </nav>
          ) : null}
        </div>
      </div>

      {/* ── a grade ── */}
      <section className="mx-auto max-w-5xl px-4 pt-4" aria-busy={carregando}>
        {produtos.length === 0 && !carregando ? (
          <p className="py-16 text-center text-sm text-tinta-2">
            {busca.trim().length >= 2 ? `Nada encontrado para “${busca.trim()}”.` : 'Nada disponível aqui agora.'}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {produtos.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => abrirProduto(p)}
                  disabled={!p.disponivel}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-borda bg-superficie text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-marca disabled:opacity-60"
                >
                  <div className="relative aspect-square w-full overflow-hidden">
                    <Foto src={p.foto} nome={p.nome} className="transition-transform duration-300 group-hover:scale-[1.03]" />
                    {!p.disponivel ? (
                      <span className="absolute top-2 left-2 rounded-full bg-superficie/90 px-2.5 py-0.5 text-xs font-bold text-tinta-2">Esgotado</span>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <span className="line-clamp-2 text-sm leading-snug font-semibold text-tinta">{p.nome}</span>
                    <span className="mt-auto text-[15px] font-extrabold text-titulo tabular-nums">
                      {p.variavel ? <span className="text-xs font-medium text-tinta-3">a partir de </span> : null}
                      {brl(p.preco)}
                      {p.medida !== 'UN' ? <span className="text-xs font-medium text-tinta-3"> /{p.medida.toLowerCase()}</span> : null}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {lista.mais ? (
          <div className="flex justify-center py-6">
            <button
              type="button"
              disabled={carregando}
              onClick={() => void carregar(categoria, busca.trim().length >= 2 ? busca : '', lista.proximo)}
              className="rounded-full border border-borda bg-superficie px-5 py-2.5 text-sm font-semibold text-tinta hover:bg-superficie-2 disabled:opacity-60"
            >
              {carregando ? 'Carregando…' : 'Ver mais'}
            </button>
          </div>
        ) : null}
      </section>

      <p className="mx-auto max-w-5xl px-4 pt-10 text-center text-xs text-tinta-3">
        Preços para pagamento à vista ou Pix. O pagamento é combinado com a loja.
      </p>

      {/* ── a barra da sacola ── */}
      {sacola.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setEtapa('sacola')}
            className="mx-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-2xl bg-marca px-5 py-3.5 text-marca-tinta shadow-lg hover:brightness-105"
          >
            <span className="flex items-center gap-2.5 text-[15px] font-bold">
              <Sacola /> Ver pedido
              <span className="rounded-full bg-black/15 px-2 py-0.5 text-xs tabular-nums">{Math.round(itensNaSacola)}</span>
            </span>
            <span className="text-[15px] font-extrabold tabular-nums">{brl(subtotal)}</span>
          </button>
        </div>
      ) : null}

      {/* ── o produto aberto ── */}
      <Folha
        aberta={!!aberto}
        fechar={fecharProduto}
        titulo={aberto?.nome ?? ''}
        rodape={
          aberto ? (
            <div className="flex items-center gap-3">
              <Passador valor={quantidade} medida={aberto.medida} mudar={(n) => setQuantidade(Math.max(passoDe(aberto.medida), n))} min={passoDe(aberto.medida)} />
              <button
                type="button"
                disabled={!opcao}
                onClick={adicionar}
                className="flex flex-1 items-center justify-between gap-2 rounded-2xl bg-marca px-4 py-3 text-[15px] font-bold text-marca-tinta disabled:opacity-50"
              >
                <span>{opcao ? 'Adicionar' : 'Escolha uma opção'}</span>
                {opcao ? <span className="tabular-nums">{brl(valorItemAberto)}</span> : null}
              </button>
            </div>
          ) : null
        }
      >
        {aberto ? (
          <div className="flex flex-col gap-4">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
              <Foto src={aberto.foto} nome={aberto.nome} />
            </div>
            {aberto.descricao ? <p className="text-sm leading-relaxed text-tinta-2">{aberto.descricao}</p> : null}
            {aberto.opcoes.length > 1 || (aberto.opcoes[0]?.rotulo ?? '') !== '' ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold text-tinta">Escolha</legend>
                <div className="flex flex-wrap gap-2">
                  {aberto.opcoes.map((o) => (
                    <button
                      key={o.variacaoId}
                      type="button"
                      disabled={!o.disponivel}
                      onClick={() => setOpcao(o)}
                      aria-pressed={opcao?.variacaoId === o.variacaoId}
                      className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors disabled:line-through disabled:opacity-45 ${
                        opcao?.variacaoId === o.variacaoId ? 'border-marca bg-marca-suave text-tinta' : 'border-borda bg-superficie text-tinta-2 hover:border-tinta-3'
                      }`}
                    >
                      {o.rotulo || aberto.nome}
                      {aberto.variavel ? <span className="ml-1.5 font-medium text-tinta-3 tabular-nums">{brl(o.preco)}</span> : null}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="text-lg font-extrabold text-titulo tabular-nums">
                {brl(aberto.preco)}
                {aberto.medida !== 'UN' ? <span className="text-sm font-medium text-tinta-3"> /{aberto.medida.toLowerCase()}</span> : null}
              </p>
            )}
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-tinta">
              Alguma observação? <span className="font-normal text-tinta-3">(opcional)</span>
              <input
                value={obsItem}
                onChange={(e) => setObsItem(e.target.value.slice(0, 200))}
                placeholder="Ex.: sem cobertura, para presente"
                className="rounded-xl border border-borda bg-superficie px-3.5 py-2.5 text-[15px] font-normal outline-none focus:border-marca"
              />
            </label>
          </div>
        ) : null}
      </Folha>

      {/* ── a sacola ── */}
      <Folha
        aberta={etapa === 'sacola'}
        fechar={fecharEtapa}
        titulo="Seu pedido"
        rodape={
          <div className="flex flex-col gap-2">
            {faltaMinimo > 0 ? (
              <p className="text-center text-xs font-medium text-atencao">Faltam {brl(faltaMinimo)} para o pedido mínimo.</p>
            ) : null}
            <button
              type="button"
              disabled={sacola.length === 0 || faltaMinimo > 0}
              onClick={() => {
                setErro(null)
                setEtapa('dados')
              }}
              className="flex w-full items-center justify-between rounded-2xl bg-marca px-5 py-3.5 text-[15px] font-bold text-marca-tinta disabled:opacity-50"
            >
              <span>Continuar</span>
              <span className="tabular-nums">{brl(subtotal)}</span>
            </button>
          </div>
        }
      >
        {sacola.length === 0 ? (
          <p className="py-8 text-center text-sm text-tinta-2">Seu pedido está vazio.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-borda-suave">
            {sacola.map((i) => (
              <li key={i.variacaoId} className="flex gap-3 py-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                  <Foto src={i.foto} nome={i.nome} className="text-lg" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-tinta">{i.nome}</p>
                      {i.rotulo ? <p className="truncate text-xs text-tinta-2">{i.rotulo}</p> : null}
                      {i.observacao ? <p className="truncate text-xs text-tinta-3">“{i.observacao}”</p> : null}
                    </div>
                    <span className="text-sm font-bold text-titulo tabular-nums">{brl(Math.round(i.preco * 100 * i.quantidade) / 100)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Passador
                      valor={i.quantidade}
                      medida={i.medida}
                      mudar={(n) => mexerSacola((s) => s.map((x) => (x.variacaoId === i.variacaoId ? { ...x, quantidade: n } : x)))}
                    />
                    <button
                      type="button"
                      onClick={() => mexerSacola((s) => s.filter((x) => x.variacaoId !== i.variacaoId))}
                      className="text-xs font-semibold text-tinta-3 hover:text-critico"
                    >
                      Tirar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Folha>

      {/* ── os dados e o envio ── */}
      <Folha
        aberta={etapa === 'dados'}
        fechar={fecharEtapa}
        titulo="Finalizar pedido"
        rodape={
          <div className="flex flex-col gap-2">
            {erro ? (
              <p role="alert" className="rounded-xl bg-critico-fundo px-3 py-2 text-sm font-medium text-critico">
                {erro}
              </p>
            ) : null}
            <button
              type="button"
              onClick={mandar}
              disabled={enviando}
              className="flex w-full items-center justify-between rounded-2xl bg-marca px-5 py-3.5 text-[15px] font-bold text-marca-tinta disabled:opacity-60"
            >
              <span>{enviando ? 'Enviando…' : 'Fazer pedido'}</span>
              <span className="tabular-nums">{brl(subtotal + taxa)}</span>
            </button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            mandar()
          }}
        >
          {/* gente não vê; robô preenche */}
          <input ref={site} name="site" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />
          <Campo rotulo="Seu nome">
            <input
              value={dados.nome}
              onChange={(e) => setDados({ ...dados, nome: e.target.value })}
              autoComplete="name"
              className={CAMPO}
              maxLength={80}
            />
          </Campo>
          <Campo rotulo="Seu WhatsApp">
            <input
              value={dados.telefone}
              onChange={(e) => setDados({ ...dados, telefone: e.target.value })}
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(71) 99999-0000"
              className={CAMPO}
              maxLength={20}
            />
          </Campo>

          {loja.retirada && loja.entrega ? (
            <Escolha
              rotulo="Como quer receber?"
              valor={dados.entrega ? 'entrega' : 'retirada'}
              mudar={(v) => setDados({ ...dados, entrega: v === 'entrega' })}
              opcoes={[
                { valor: 'retirada', rotulo: 'Retirar na loja' },
                { valor: 'entrega', rotulo: `Entrega${loja.taxaEntrega ? ` (+${brl(loja.taxaEntrega)})` : ''}` },
              ]}
            />
          ) : (
            <p className="text-sm text-tinta-2">{loja.entrega ? 'Esta loja faz entrega.' : 'Retirada na loja.'}</p>
          )}
          {dados.entrega ? (
            <Campo rotulo="Endereço de entrega">
              <textarea
                value={dados.endereco}
                onChange={(e) => setDados({ ...dados, endereco: e.target.value })}
                autoComplete="street-address"
                rows={2}
                placeholder="Rua, número, bairro e um ponto de referência"
                className={CAMPO}
                maxLength={300}
              />
            </Campo>
          ) : null}

          <Escolha
            rotulo="Para quando?"
            valor={dados.quando}
            mudar={(v) => setDados({ ...dados, quando: v as Dados['quando'] })}
            opcoes={[
              { valor: 'logo', rotulo: 'O quanto antes' },
              { valor: 'agendar', rotulo: 'Agendar' },
            ]}
          />
          {dados.quando === 'agendar' ? (
            <input
              type="datetime-local"
              value={dados.para}
              onChange={(e) => setDados({ ...dados, para: e.target.value })}
              className={CAMPO}
              aria-label="Dia e hora"
            />
          ) : null}

          <Escolha
            rotulo="Como vai pagar?"
            valor={dados.forma}
            mudar={(v) => setDados({ ...dados, forma: v as FormaPagamento })}
            opcoes={FORMAS.map((f) => ({ valor: f.forma, rotulo: f.rotulo }))}
          />
          {dados.forma === 'DINHEIRO' ? (
            <Campo rotulo="Troco para quanto?">
              <input
                value={dados.trocoPara}
                onChange={(e) => setDados({ ...dados, trocoPara: e.target.value })}
                inputMode="decimal"
                placeholder="Ex.: 50 (deixe vazio se não precisa)"
                className={CAMPO}
                maxLength={10}
              />
            </Campo>
          ) : null}

          <Campo rotulo="Observação (opcional)">
            <textarea
              value={dados.observacao}
              onChange={(e) => setDados({ ...dados, observacao: e.target.value })}
              rows={2}
              className={CAMPO}
              maxLength={500}
            />
          </Campo>

          <dl className="flex flex-col gap-1 rounded-2xl bg-superficie-2 px-4 py-3 text-sm">
            <div className="flex justify-between text-tinta-2">
              <dt>Produtos</dt>
              <dd className="tabular-nums">{brl(subtotal)}</dd>
            </div>
            {taxa > 0 ? (
              <div className="flex justify-between text-tinta-2">
                <dt>Entrega</dt>
                <dd className="tabular-nums">{brl(taxa)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between font-bold text-titulo">
              <dt>Total</dt>
              <dd className="tabular-nums">{brl(subtotal + taxa)}</dd>
            </div>
          </dl>
          <p className="text-xs text-tinta-3">
            Seu nome e WhatsApp vão só para a loja, para ela falar com você sobre este pedido.
          </p>
        </form>
      </Folha>
    </main>
  )
}

const CAMPO =
  'w-full rounded-xl border border-borda bg-superficie px-3.5 py-2.5 text-[15px] text-tinta outline-none placeholder:text-tinta-3 focus:border-marca'

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-tinta">
      {rotulo}
      {children}
    </label>
  )
}

function Escolha({
  rotulo,
  valor,
  mudar,
  opcoes,
}: {
  rotulo: string
  valor: string
  mudar: (v: string) => void
  opcoes: { valor: string; rotulo: string }[]
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold text-tinta">{rotulo}</legend>
      <div className="grid grid-cols-2 gap-2">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => mudar(o.valor)}
            aria-pressed={valor === o.valor}
            className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
              valor === o.valor ? 'border-marca bg-marca-suave text-tinta' : 'border-borda bg-superficie text-tinta-2 hover:border-tinta-3'
            }`}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
