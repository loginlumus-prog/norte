'use client'

// A vitrine da loja no celular da cliente.
//
// Três momentos, e cada um cabe numa mão: OLHAR (categorias, busca, a grade
// com foto e preço), ESCOLHER (o "+" do cartão põe direto na sacola quando o
// produto não tem escolha; com tamanho/sabor, o produto abre por baixo) e
// PEDIR (a sacola, nome e WhatsApp, retirar ou receber, como paga). Depois do
// pedido, o botão grande manda tudo para o WhatsApp da loja — é ali que a
// conversa continua.
//
// A sacola e os dados da cliente ficam NESTE aparelho (localStorage), para
// quem fechou a aba sem querer voltar e achar tudo onde deixou. Nada disso vai
// para o servidor antes de "Enviar pedido".

import './vitrine.css'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { FormaPagamento } from '@prisma/client'
import type { ProdutoNoCatalogo, OpcaoNoCatalogo, VitrinePublica } from '@/servidor/catalogo'
import { maisProdutos, pedir, produtoDaVitrine } from './acoes'
import { ArteDaCapa } from './Arte'
import { Avaliacoes, Bolinhas, Estrelas, Mural, Visor, type Bolinha } from './Vitrine'
import { iconeDoProduto, linkPedirFoto, type IconeDoProduto } from './icone'
import { estiloDaMarca } from './marca'
import { Adiante, Alvo, Etiqueta, Fechar, Foto, Lixo, Lupa, MarcaDaLoja, Mais, Menos, Moto, Relogio, Sacola, Visto, Vitrine, Voltar, Zap } from './Pecas'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (q: number, medida: string) =>
  medida === 'UN' ? String(q) : `${q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${medida.toLowerCase()}`
const passoDe = (medida: string) => (medida === 'UN' ? 1 : medida === 'KG' ? 0.25 : 0.5)
/** Quanto entra no primeiro toque: 1 unidade, ou dois passos do que é pesado/medido. */
const inicialDe = (medida: string) => (medida === 'UN' ? 1 : passoDe(medida) * 2)
const arred = (n: number) => Math.round(n * 1000) / 1000
const ZAP_VERDE = 'bg-[#15803d] hover:bg-[#126c34]'
const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'

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

/** A única opção de um produto que não pede escolha — aí o "+" do cartão já põe na sacola. */
function opcaoUnica(p: ProdutoNoCatalogo): OpcaoNoCatalogo | null {
  const [o] = p.opcoes
  return p.opcoes.length === 1 && o?.disponivel ? o : null
}

function Passador({
  valor,
  medida,
  mudar,
  min = 0,
  nome,
  compacto,
}: {
  valor: number
  medida: string
  mudar: (n: number) => void
  min?: number
  nome?: string
  compacto?: boolean
}) {
  const passo = passoDe(medida)
  const botao = `flex ${compacto ? 'h-9 w-9' : 'h-11 w-11'} items-center justify-center rounded-full text-tinta transition-colors hover:bg-superficie-3 disabled:opacity-35 ${FOCO}`
  return (
    <div className="flex items-center rounded-full bg-superficie-2 p-0.5" role="group" aria-label={nome ? `Quantidade de ${nome}` : 'Quantidade'}>
      <button type="button" aria-label="Diminuir" disabled={valor - passo < min - 1e-9 && min > 0} onClick={() => mudar(arred(Math.max(min, valor - passo)))} className={botao}>
        <Menos />
      </button>
      <span className={`${compacto ? 'min-w-9' : 'min-w-12'} text-center text-[15px] font-bold tabular-nums`}>
        {qtd(valor, medida)}
      </span>
      <button type="button" aria-label="Aumentar" onClick={() => mudar(arred(Math.min(999, valor + passo)))} className={botao}>
        <Mais />
      </button>
    </div>
  )
}

/** A folha que sobe de baixo (no computador, uma janela no meio). */
function Folha({
  aberta,
  fechar,
  titulo,
  subtitulo,
  voltar,
  children,
  rodape,
}: {
  aberta: boolean
  fechar: () => void
  titulo: string
  subtitulo?: string
  voltar?: () => void
  children: React.ReactNode
  rodape?: React.ReactNode
}) {
  const painel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberta) return
    // Quem usa teclado ou leitor de tela entra na folha e, ao fechar, volta
    // para o botão de onde veio.
    const antesFoco = document.activeElement as HTMLElement | null
    painel.current?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return fechar()
      if (e.key !== 'Tab' || !painel.current) return
      const focaveis = [...painel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([tabindex="-1"]), textarea, select')]
      if (!focaveis.length) return
      const primeiro = focaveis[0]!
      const ultimo = focaveis[focaveis.length - 1]!
      if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === painel.current)) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    window.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', tecla)
      document.body.style.overflow = antes
      if (antesFoco?.isConnected) antesFoco.focus()
    }
  }, [aberta, fechar])
  if (!aberta) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={titulo}>
      <button type="button" aria-label="Fechar" tabIndex={-1} onClick={fechar} className="vt-fundo absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div
        ref={painel}
        tabIndex={-1}
        className="vt-folha relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-superficie shadow-[0_-12px_48px_-12px_rgb(0_0_0/0.35)] outline-none sm:max-h-[86dvh] sm:max-w-lg sm:rounded-[28px]"
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-borda sm:hidden" />
        <header className="flex items-center gap-2 px-4 pt-2 pb-3 sm:px-5 sm:pt-4">
          {voltar ? (
            <button type="button" onClick={voltar} aria-label="Voltar" className={`-ml-1 flex h-10 w-10 items-center justify-center rounded-full text-tinta-2 hover:bg-superficie-2 ${FOCO}`}>
              <Voltar />
            </button>
          ) : null}
          <div className="min-w-0 flex-1 px-1">
            {subtitulo ? <p className="text-[11px] font-bold tracking-[0.08em] text-tinta-3 uppercase">{subtitulo}</p> : null}
            <h2 className="truncate text-lg leading-tight font-extrabold tracking-tight text-titulo">{titulo}</h2>
          </div>
          <button type="button" onClick={fechar} aria-label="Fechar" className={`-mr-1 flex h-10 w-10 items-center justify-center rounded-full bg-superficie-2 text-tinta-2 hover:text-tinta ${FOCO}`}>
            <Fechar tamanho={18} />
          </button>
        </header>
        <div data-rolar className="flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5">
          {children}
        </div>
        {rodape ? (
          <footer className="border-t border-borda-suave bg-superficie px-4 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:rounded-b-[28px] sm:px-5">{rodape}</footer>
        ) : null}
      </div>
    </div>
  )
}

/** O botão principal das folhas: texto à esquerda, valor à direita. */
function BotaoGrande({
  children,
  valor,
  className = '',
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { valor?: string }) {
  return (
    <button
      type="button"
      {...resto}
      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-marca px-5 text-base font-bold text-marca-tinta shadow-[0_8px_20px_-10px_var(--marca)] transition-[filter,transform] hover:brightness-105 active:scale-[0.99] disabled:opacity-50 disabled:shadow-none ${FOCO} ${className}`}
    >
      <span>{children}</span>
      {valor ? <span className="tabular-nums">{valor}</span> : null}
    </button>
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
  // O que o leitor de tela anuncia quando a sacola muda (o total vem junto, já atualizado).
  const [mexido, setMexido] = useState<string | null>(null)

  const subtotal = useMemo(() => sacola.reduce((s, i) => s + Math.round(i.preco * 100 * i.quantidade), 0) / 100, [sacola])
  const itensNaSacola = sacola.reduce((s, i) => s + (i.medida === 'UN' ? i.quantidade : 1), 0)
  const taxa = dados.entrega && loja.taxaEntrega ? loja.taxaEntrega : 0
  const faltaMinimo = loja.pedidoMinimo && subtotal < loja.pedidoMinimo ? loja.pedidoMinimo - subtotal : 0
  /** Quanto de cada produto já está na sacola (somando tamanhos/sabores). */
  const porProduto = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of sacola) m.set(i.produtoId, arred((m.get(i.produtoId) ?? 0) + i.quantidade))
    return m
  }, [sacola])

  /** Põe (ou tira, com `delta` negativo) uma opção na sacola. */
  function somar(p: ProdutoNoCatalogo, o: OpcaoNoCatalogo, delta: number, observacao?: string) {
    mexerSacola((s) => {
      const ja = s.find((i) => i.variacaoId === o.variacaoId)
      if (ja) return s.map((i) => (i === ja ? { ...i, quantidade: arred(i.quantidade + delta), observacao: observacao || i.observacao } : i))
      if (delta <= 0) return s
      return [
        ...s,
        { variacaoId: o.variacaoId, produtoId: p.id, nome: p.nome, rotulo: o.rotulo, preco: o.preco, medida: p.medida, foto: p.foto, quantidade: delta, observacao: observacao ?? '' },
      ]
    })
    setMexido(delta > 0 ? `${p.nome} na sacola` : `${p.nome}: quantidade diminuída`)
  }

  // ── escolher um produto ──
  const [aberto, setAberto] = useState<ProdutoNoCatalogo | null>(null)
  const [opcao, setOpcao] = useState<OpcaoNoCatalogo | null>(null)
  const [quantidade, setQuantidade] = useState(1)
  const [obsItem, setObsItem] = useState('')
  function abrirProduto(p: ProdutoNoCatalogo) {
    setAberto(p)
    const disponiveis = p.opcoes.filter((o) => o.disponivel)
    setOpcao(disponiveis.length === 1 || p.opcoes.length === 1 ? (disponiveis[0] ?? null) : null)
    setQuantidade(inicialDe(p.medida))
    setObsItem('')
  }
  const fecharProduto = useCallback(() => setAberto(null), [])
  function adicionar() {
    if (!aberto || !opcao) return
    somar(aberto, opcao, quantidade, obsItem)
    setAberto(null)
  }
  /** O "+" do cartão: sem escolha a fazer, já entra; com escolha, abre o produto. */
  function maisUm(p: ProdutoNoCatalogo) {
    const o = opcaoUnica(p)
    if (!o) return abrirProduto(p)
    somar(p, o, porProduto.get(p.id) ? passoDe(p.medida) : inicialDe(p.medida))
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

  // A cor do tema da vitrine (o de data, o escolhido, ou a da marca).
  const { tema, capa, destaques: destaquesDaLoja, stories, mural, avaliacoes } = vitrine.extras
  const estilo = estiloDaMarca(tema.cor ?? empresa.corMarca)
  const subLoja = loja.nome && loja.nome !== empresa.nome ? loja.nome : null

  // ── as bolinhas (stories) ──
  const CHAVE_VISTOS = `norte:stories:${slug}:${enderecoCat}`
  const [visor, setVisor] = useState<number | null>(null)
  const fecharVisor = useCallback(() => setVisor(null), [])
  const nomeDaCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias])
  const bolinhas = useMemo<Bolinha[]>(() => {
    const capaDe = (id: string) => primeira.produtos.find((p) => (p.categoriaId ?? 'outros') === id && p.foto)?.foto ?? null
    // Os destaques que a loja montou; sem nenhum, um por categoria.
    const grupos: Bolinha[] = destaquesDaLoja.length
      ? destaquesDaLoja.map((d) => ({
          tipo: 'grupo',
          id: d.id,
          rotulo: d.nome,
          capa: d.capa ?? (d.categoriaId ? capaDe(d.categoriaId) : (primeira.produtos.find((p) => d.produtoIds.includes(p.id) && p.foto)?.foto ?? null)),
          icone: iconeDoProduto(d.nome, d.categoriaId ? nomeDaCategoria.get(d.categoriaId) : d.nome),
          categoriaId: d.categoriaId,
          produtoIds: d.produtoIds,
        }))
      : categorias.length > 1
        ? categorias.map((c) => ({ tipo: 'grupo', id: c.id, rotulo: c.nome, capa: capaDe(c.id), icone: iconeDoProduto(c.nome, c.nome), categoriaId: c.id, produtoIds: [] }))
        : []
    return [...stories.map((p): Bolinha => ({ tipo: 'postagem', id: p.id, rotulo: p.titulo, postagem: p })), ...grupos]
  }, [stories, categorias, primeira.produtos, destaquesDaLoja, nomeDaCategoria])
  const carregarGrupo = useCallback(
    async (b: Extract<Bolinha, { tipo: 'grupo' }>) => {
      if (b.categoriaId) return (await maisProdutos(slug, enderecoCat, { categoriaId: b.categoriaId, busca: '', pular: 0 }))?.produtos ?? []
      const ps = (await maisProdutos(slug, enderecoCat, { produtoIds: b.produtoIds, busca: '', pular: 0 }))?.produtos ?? []
      // Na ordem que a loja escolheu.
      return [...ps].sort((x, y) => b.produtoIds.indexOf(x.id) - b.produtoIds.indexOf(y.id))
    },
    [slug, enderecoCat],
  )
  /** O "Quero esse" de uma postagem: busca o produto e abre a escolha. */
  const queroEsse = useCallback(
    async (produtoId: string) => {
      setVisor(null)
      const p = await produtoDaVitrine(slug, enderecoCat, produtoId).catch(() => null)
      if (p) abrirProduto(p)
    },
    // abrirProduto só mexe em estado; não precisa entrar na lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug, enderecoCat],
  )

  // ── a aba que acende conforme a rolagem, e a página seguinte no fim ──
  const [naTela, setNaTela] = useState<string | null>(null)
  const sentinela = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (categoria !== null || busca.trim().length >= 2) return
    const secoes = [...document.querySelectorAll<HTMLElement>('[data-categoria]')]
    if (secoes.length === 0) return
    const o = new IntersectionObserver(
      (es) => {
        const visivel = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visivel) setNaTela(visivel.target.getAttribute('data-categoria'))
      },
      { rootMargin: '-140px 0px -60% 0px' },
    )
    secoes.forEach((x) => o.observe(x))
    return () => o.disconnect()
  }, [categoria, busca, lista.produtos.length])
  useEffect(() => {
    const el = sentinela.current
    if (!el || !lista.mais) return
    const o = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && !carregando) void carregar(null, '', lista.proximo)
    }, { rootMargin: '600px' })
    o.observe(el)
    return () => o.disconnect()
  }, [lista.mais, lista.proximo, carregando, carregar])

  // ── depois do pedido ──
  if (feito) {
    const zap = feito.whatsapp ? `https://wa.me/${feito.whatsapp}?text=${encodeURIComponent(feito.mensagem)}` : null
    return (
      <main style={estilo} className="relative flex min-h-dvh items-center justify-center bg-fundo px-4 py-10">
        <div aria-hidden className="vt-halo pointer-events-none absolute inset-x-0 top-0 h-72" />
        <div className="vt-folha relative flex w-full max-w-md flex-col items-center gap-6 rounded-[28px] border border-borda-suave bg-superficie p-6 text-center shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)] sm:p-8">
          <MarcaDaLoja nome={empresa.nome} logo={empresa.logoUrl} className="h-12 w-12 rounded-2xl text-base" />
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-bom-fundo text-bom ring-8 ring-bom-fundo/40">
            <Visto tamanho={30} />
          </span>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold tracking-[0.1em] text-tinta-3 uppercase">Pedido {feito.codigo}</p>
            <h1 className="text-2xl font-extrabold tracking-tight text-titulo text-balance">Pedido enviado!</h1>
            <p className="text-[15px] leading-relaxed text-tinta-2">
              Total de <strong className="text-tinta tabular-nums">{brl(feito.total)}</strong>.{' '}
              {zap
                ? 'Agora mande pelo WhatsApp: a loja confirma mais rápido e vocês combinam o que faltar por lá.'
                : 'A loja já recebeu e vai confirmar.'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5">
            {zap ? (
              <a
                href={zap}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 text-base font-bold text-white shadow-[0_10px_24px_-12px_#15803d] ${ZAP_VERDE} ${FOCO}`}
              >
                <Zap /> Enviar no WhatsApp
              </a>
            ) : null}
            <a
              href={`/${slug}/pedido/${feito.acompanhamento}`}
              className={`flex min-h-12 w-full items-center justify-center gap-1.5 rounded-2xl border border-borda bg-superficie px-5 text-[15px] font-semibold text-tinta hover:bg-superficie-2 ${FOCO}`}
            >
              Acompanhar o pedido <Adiante tamanho={16} />
            </a>
          </div>
          <button type="button" onClick={() => setFeito(null)} className={`rounded-lg px-2 py-1 text-sm font-medium text-tinta-2 underline-offset-4 hover:underline ${FOCO}`}>
            Voltar ao catálogo
          </button>
        </div>
      </main>
    )
  }

  const produtos = lista.produtos
  const valorItemAberto = opcao ? Math.round(opcao.preco * 100 * quantidade) / 100 : 0
  const buscando = busca.trim().length >= 2
  // Com foto na maioria, grade de fotos (o produto sem foto entra nela com o
  // desenho dele). Com pouca foto, a lista (como cardápio de delivery): o
  // desenho fica pequeno ao lado do nome, sem uma parede de azulejos.
  const comFoto = produtos.filter((p) => p.foto).length
  const emGrade = comFoto > 0 && comFoto * 2 >= produtos.length
  // Em "Tudo", sem busca, a lista vem por categoria: um título para cada uma.
  const nomeCategoria = new Map(categorias.map((c) => [c.id, c.nome]))
  const iconeDe = (nome: string, categoriaId: string | null | undefined): IconeDoProduto =>
    iconeDoProduto(nome, categoriaId ? nomeCategoria.get(categoriaId) : null)
  // Sem foto, a cliente pede a foto à loja: o WhatsApp DA LOJA, com o produto e o preço.
  const pedirFoto = (p: ProdutoNoCatalogo) => (p.foto ? null : linkPedirFoto(loja.whatsapp, p.nome, brl(p.preco)))
  const secoes: { id: string; nome: string | null; itens: ProdutoNoCatalogo[] }[] = []
  for (const p of produtos) {
    const agrupar = categoria === null && !buscando && categorias.length > 1
    const id = agrupar ? (p.categoriaId ?? 'outros') : 'tudo'
    const ultimaSecao = secoes[secoes.length - 1]
    if (ultimaSecao?.id === id) ultimaSecao.itens.push(p)
    else secoes.push({ id, nome: agrupar ? (nomeCategoria.get(id) ?? 'Outros') : null, itens: [p] })
  }
  const zapLoja = loja.whatsapp ? `https://wa.me/${loja.whatsapp}?text=${encodeURIComponent('Olá! Vim pelo catálogo.')}` : null
  // Sem busca e sem categoria escolhida, a vitrine é o CARDÁPIO, como nos
  // apps de delivery: uma seção por categoria, cada produto numa linha com a
  // foto à direita. As abas de categoria levam até a seção e acendem conforme
  // a rolagem.
  const emFeed = categoria === null && !buscando
  const destaques = emFeed ? produtos.filter((p) => p.foto && p.disponivel).slice(0, 10) : []

  return (
    <main style={estilo} className="min-h-dvh bg-fundo pb-32">
      {/* ── quem é a loja ── */}
      <header className="relative">
        {/* A capa: a cor do tema, com a arte da data (ou a trama de sempre). */}
        <div className="relative mx-auto max-w-5xl sm:px-4 sm:pt-4">
          <div className="relative h-32 overflow-hidden sm:h-40 sm:rounded-[28px]">
            <ArteDaCapa arte={tema.especial?.arte ?? null} foto={capa} />
            {tema.especial ? (
              <p className="absolute top-3 right-3 max-w-[78%] rounded-full bg-black/30 px-3 py-1.5 text-right text-[12.5px] leading-snug font-semibold text-white backdrop-blur-sm sm:top-4 sm:right-5 sm:text-sm">
                {tema.especial.saudacao}
              </p>
            ) : null}
          </div>
        </div>
        <div className="relative mx-auto flex max-w-5xl flex-col gap-4 px-4 pb-3 sm:px-8">
          <div className="-mt-10 flex items-end justify-between gap-3 sm:-mt-12">
            <MarcaDaLoja nome={empresa.nome} logo={empresa.logoUrl} className="h-[84px] w-[84px] rounded-[26px] text-3xl ring-4 ring-fundo sm:h-24 sm:w-24" />
            {zapLoja ? (
              <a
                href={zapLoja}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Falar com a loja no WhatsApp"
                className={`mb-1 flex h-11 shrink-0 items-center gap-2 rounded-full border border-borda bg-superficie px-3 text-sm font-semibold vt-zap shadow-sm hover:bg-superficie-2 sm:px-4 ${FOCO}`}
              >
                <Zap tamanho={20} />
                <span className="hidden sm:inline">WhatsApp</span>
              </a>
            ) : null}
          </div>
          <div className="-mt-1 min-w-0">
            <h1 className="truncate text-[22px] leading-tight font-extrabold tracking-tight text-titulo sm:text-[28px]">{empresa.nome}</h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-tinta-2">
              {subLoja ? <span className="truncate font-medium">{subLoja}</span> : <span className="truncate font-medium">Catálogo</span>}
              {loja.horario ? (
                <>
                  <span aria-hidden className="text-tinta-3">·</span>
                  <span className="flex min-w-0 items-center gap-1">
                    <Relogio tamanho={14} className="shrink-0 text-tinta-3" />
                    <span className="truncate">{loja.horario}</span>
                  </span>
                </>
              ) : null}
            </p>
          </div>

          {avaliacoes.total > 0 && avaliacoes.media !== null ? (
            <a href="#avaliacoes" className={`-mt-1 flex w-fit items-center gap-2 rounded-full text-sm text-tinta-2 hover:text-tinta ${FOCO}`}>
              <Estrelas nota={avaliacoes.media} />
              <span className="font-bold text-tinta tabular-nums">{avaliacoes.media.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</span>
              <span className="underline-offset-2 hover:underline">
                {avaliacoes.total} {avaliacoes.total === 1 ? 'avaliação' : 'avaliações'}
              </span>
            </a>
          ) : null}

          {loja.recado ? (
            <p className="rounded-2xl border border-[var(--marca-borda)]/40 bg-marca-suave px-4 py-3 text-sm leading-relaxed font-medium text-tinta">{loja.recado}</p>
          ) : null}

          <ul className="flex flex-wrap gap-2 text-[13px] font-semibold text-tinta-2" aria-label="Como funciona">
            {loja.retirada ? (
              <li className="flex items-center gap-1.5 rounded-full border border-borda-suave bg-superficie px-3 py-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
                <Vitrine tamanho={15} className="text-[var(--marca-texto)]" /> Retirada
              </li>
            ) : null}
            {loja.entrega ? (
              <li className="flex items-center gap-1.5 rounded-full border border-borda-suave bg-superficie px-3 py-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
                <Moto tamanho={15} className="text-[var(--marca-texto)]" /> Entrega
                <span className="font-bold text-tinta tabular-nums">{loja.taxaEntrega ? brl(loja.taxaEntrega) : 'grátis'}</span>
              </li>
            ) : null}
            {loja.pedidoMinimo ? (
              <li className="flex items-center gap-1.5 rounded-full border border-borda-suave bg-superficie px-3 py-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
                <Etiqueta tamanho={15} className="text-[var(--marca-texto)]" /> Mínimo
                <span className="font-bold text-tinta tabular-nums">{brl(loja.pedidoMinimo)}</span>
              </li>
            ) : null}
          </ul>
          {loja.endereco ? (
            <p className="-mt-1 flex items-start gap-1.5 text-[13px] text-tinta-2">
              <Alvo tamanho={15} className="mt-px shrink-0 text-tinta-3" />
              <span className="line-clamp-2">{loja.endereco}</span>
            </p>
          ) : null}
          {ultimo ? (
            <a
              href={`/${slug}/pedido/${ultimo}`}
              className={`flex items-center justify-between gap-3 rounded-2xl border border-borda-suave bg-superficie px-4 py-3 text-sm font-semibold text-tinta shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-borda sm:max-w-sm ${FOCO}`}
            >
              <span className="flex items-center gap-2.5">
                <span aria-hidden className="h-2 w-2 rounded-full bg-marca" />
                Acompanhar o meu último pedido
              </span>
              <Adiante tamanho={16} className="text-tinta-3" />
            </a>
          ) : null}

          <Bolinhas bolinhas={bolinhas} logo={empresa.logoUrl} nome={empresa.nome} chaveVistos={CHAVE_VISTOS} abrir={setVisor} />
        </div>
      </header>

      {/* ── procurar e categorias ── */}
      <div className="sticky top-0 z-30 border-b border-borda-suave/80 bg-fundo/85 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-5xl flex-col gap-2.5 px-4 py-2.5">
          <label className="flex h-12 items-center gap-2.5 rounded-full border border-borda bg-superficie px-4 text-tinta-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow focus-within:border-marca focus-within:ring-4 focus-within:ring-[var(--marca-anel)]">
            <Lupa />
            <span className="sr-only">Procurar no catálogo</span>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={`Procurar em ${empresa.nome}`}
              className="w-full min-w-0 bg-transparent text-base text-tinta outline-none placeholder:text-tinta-3 [&::-webkit-search-cancel-button]:hidden"
              enterKeyHint="search"
            />
            {busca ? (
              <button type="button" onClick={() => setBusca('')} aria-label="Limpar a busca" className={`-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-superficie-2 text-tinta-2 hover:text-tinta ${FOCO}`}>
                <Fechar tamanho={14} />
              </button>
            ) : null}
          </label>
          {categorias.length > 1 ? (
            <nav aria-label="Categorias" className="vt-sem-barra -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
              {[{ id: null as string | null, nome: 'Tudo', total: 0 }, ...categorias].map((c) => {
                const ativa = emFeed ? (c.id ?? null) === naTela : categoria === c.id
                return (
                  <button
                    key={c.id ?? 'tudo'}
                    type="button"
                    onClick={() => {
                      // No feed, a categoria é uma postagem: o botão leva até ela.
                      if (!buscando && categoria === null) {
                        const alvo = document.getElementById(c.id ? `cat-${c.id}` : 'vt-feed')
                        if (alvo) {
                          alvo.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          return
                        }
                      }
                      setBusca('')
                      setCategoria(c.id)
                    }}
                    aria-pressed={ativa}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors ${FOCO} ${
                      ativa ? 'bg-titulo text-fundo' : 'border border-borda-suave bg-superficie text-tinta-2 hover:border-borda hover:text-tinta'
                    }`}
                  >
                    {c.nome}
                    {c.total ? <span className={`text-xs tabular-nums ${ativa ? 'opacity-70' : 'text-tinta-3'}`}>{c.total}</span> : null}
                  </button>
                )
              })}
            </nav>
          ) : null}
        </div>
      </div>

      {/* ── os produtos ── */}
      <section className={`mx-auto max-w-5xl px-4 pt-5 transition-opacity ${carregando && lista.produtos.length ? 'opacity-60' : ''}`} aria-busy={carregando} aria-label="Produtos">
        {produtos.length === 0 && !carregando ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-marca-suave text-[var(--marca-texto)]">
              <Lupa tamanho={24} />
            </span>
            <p className="text-base font-bold text-titulo text-balance">
              {buscando ? `Nada encontrado para “${busca.trim()}”` : 'Nada disponível aqui agora'}
            </p>
            <p className="max-w-xs text-sm text-tinta-2">
              {buscando ? 'Confira a escrita ou tente outra palavra.' : 'Volte daqui a pouco ou fale com a loja.'}
            </p>
            {buscando || categoria ? (
              <button
                type="button"
                onClick={() => {
                  setBusca('')
                  setCategoria(null)
                }}
                className={`mt-1 rounded-full border border-borda bg-superficie px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2 ${FOCO}`}
              >
                Ver tudo
              </button>
            ) : null}
          </div>
        ) : emFeed ? (
          <div id="vt-feed" className="flex scroll-mt-36 flex-col gap-8">
            {/* Os destaques: os que têm foto, numa fileira que passa para o lado. */}
            {destaques.length >= 3 ? (
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-extrabold tracking-tight text-titulo">Destaques</h2>
                <ul className="vt-sem-barra -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
                  {destaques.map((p) => (
                    <li key={p.id} className="w-[150px] shrink-0 snap-start">
                      <button type="button" onClick={() => abrirProduto(p)} className={`flex w-full flex-col gap-2 text-left ${FOCO}`}>
                        <span className="relative aspect-square w-full overflow-hidden rounded-2xl border border-borda-suave">
                          <Foto src={p.foto} icone={iconeDe(p.nome, p.categoriaId)} tom={p.categoriaId} desenho={44} />
                        </span>
                        <span className="line-clamp-2 text-sm leading-snug font-semibold text-tinta">{p.nome}</span>
                        <span className="text-sm font-extrabold text-titulo tabular-nums">
                          {p.variavel ? <span className="mr-1 text-xs font-medium text-tinta-3">a partir de</span> : null}
                          {brl(p.preco)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {secoes.map((sec) => (
              <section key={sec.id} id={`cat-${sec.id}`} data-categoria={sec.id} className="flex scroll-mt-36 flex-col gap-3">
                {sec.nome ? <h2 className="text-lg font-extrabold tracking-tight text-titulo">{sec.nome}</h2> : null}
                <ul className="divide-y divide-borda-suave overflow-hidden rounded-3xl border border-borda-suave bg-superficie">
                  {sec.itens.map((p) => (
                    <Cartao
                      key={p.id}
                      p={p}
                      grade={false}
                      ifood
                      icone={iconeDe(p.nome, p.categoriaId)}
                      pedirFoto={null}
                      naSacola={porProduto.get(p.id) ?? 0}
                      abrir={() => abrirProduto(p)}
                      mais={() => maisUm(p)}
                      menos={() => {
                        const o = opcaoUnica(p)
                        if (o) somar(p, o, -passoDe(p.medida))
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {/* Chegando no fim, a próxima página entra sozinha. */}
            {lista.mais ? <div ref={sentinela} aria-hidden className="h-px" /> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {secoes.map((s) => (
              <div key={s.id} className="flex flex-col gap-3">
                {s.nome ? (
                  <h2 className="flex items-baseline gap-2 text-lg font-extrabold tracking-tight text-titulo">
                    {s.nome}
                    <span className="text-sm font-semibold text-tinta-3 tabular-nums">{s.itens.length}</span>
                  </h2>
                ) : null}
                <ul className={emGrade ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4' : 'grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3'}>
                  {s.itens.map((p) => (
                    <Cartao
                      key={p.id}
                      p={p}
                      grade={emGrade}
                      icone={iconeDe(p.nome, p.categoriaId)}
                      pedirFoto={pedirFoto(p)}
                      naSacola={porProduto.get(p.id) ?? 0}
                      abrir={() => abrirProduto(p)}
                      mais={() => maisUm(p)}
                      menos={() => {
                        const o = opcaoUnica(p)
                        if (o) somar(p, o, -passoDe(p.medida))
                      }}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {lista.mais ? (
          <div className="flex justify-center py-8">
            <button
              type="button"
              disabled={carregando}
              onClick={() => void carregar(categoria, buscando ? busca : '', lista.proximo)}
              className={`h-11 rounded-full border border-borda bg-superficie px-6 text-sm font-semibold text-tinta shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:bg-superficie-2 disabled:opacity-60 ${FOCO}`}
            >
              {carregando ? 'Carregando…' : 'Ver mais produtos'}
            </button>
          </div>
        ) : null}
      </section>

      <Mural
        mural={mural}
        abrir={(id) => {
          const i = bolinhas.findIndex((b) => b.tipo === 'postagem' && b.id === id)
          if (i >= 0) setVisor(i)
        }}
        queroEsse={(id) => void queroEsse(id)}
      />
      <Avaliacoes {...avaliacoes} />

      <p className="mx-auto max-w-5xl px-4 pt-10 text-center text-xs text-tinta-3">
        Preços para pagamento à vista ou Pix. O pagamento é combinado com a loja.
      </p>

      {/* O que o leitor de tela ouve quando a sacola muda. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {mexido ? `${mexido}. Sacola com ${Math.round(itensNaSacola)} ${itensNaSacola === 1 ? 'item' : 'itens'}, total ${brl(subtotal)}.` : ''}
      </p>

      {/* ── a barra da sacola ── */}
      {sacola.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-5">
          <button
            type="button"
            onClick={() => setEtapa('sacola')}
            aria-label={`Ver sacola: ${Math.round(itensNaSacola)} ${itensNaSacola === 1 ? 'item' : 'itens'}, ${brl(subtotal)}`}
            className={`vt-barra pointer-events-auto mx-auto flex min-h-[60px] w-full max-w-lg items-center gap-3 rounded-[20px] bg-marca py-2 pr-5 pl-2 text-marca-tinta shadow-[0_16px_40px_-14px_var(--marca),0_4px_12px_-4px_rgb(0_0_0/0.25)] transition-[filter] hover:brightness-105 ${FOCO}`}
          >
            <span key={`${itensNaSacola}-${subtotal}`} className="vt-pulo relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/15">
              <Sacola />
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-superficie px-1 text-[11px] font-extrabold text-titulo tabular-nums shadow">
                {Math.round(itensNaSacola)}
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
              <span className="text-base font-bold">Ver sacola</span>
              {faltaMinimo > 0 ? <span className="truncate text-xs font-medium opacity-85">Faltam {brl(faltaMinimo)} para o mínimo</span> : null}
            </span>
            <span className="text-base font-extrabold tabular-nums">{brl(subtotal)}</span>
          </button>
        </div>
      ) : null}

      {visor !== null ? (
        <Visor
          bolinhas={bolinhas}
          inicio={visor}
          fechar={fecharVisor}
          carregarGrupo={carregarGrupo}
          iconeDe={(nome, cat) => iconeDoProduto(nome, cat ? nomeDaCategoria.get(cat) : null)}
          escolher={(p) => {
            setVisor(null)
            abrirProduto(p)
          }}
          queroEsse={(id) => void queroEsse(id)}
          chaveVistos={CHAVE_VISTOS}
          loja={empresa.nome}
          logo={empresa.logoUrl}
        />
      ) : null}

      {/* ── o produto aberto ── */}
      <Folha
        aberta={!!aberto}
        fechar={fecharProduto}
        titulo={aberto?.nome ?? ''}
        rodape={
          aberto ? (
            <div className="flex items-center gap-3">
              <Passador
                valor={quantidade}
                medida={aberto.medida}
                nome={aberto.nome}
                mudar={(n) => setQuantidade(Math.max(passoDe(aberto.medida), n))}
                min={passoDe(aberto.medida)}
              />
              <BotaoGrande disabled={!opcao} onClick={adicionar} valor={opcao ? brl(valorItemAberto) : undefined} className="flex-1">
                {opcao ? 'Adicionar' : 'Escolha uma opção'}
              </BotaoGrande>
            </div>
          ) : null
        }
      >
        {aberto ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2.5">
              <div className={`w-full overflow-hidden rounded-2xl bg-superficie-2 ${aberto.foto ? 'aspect-[4/3]' : 'aspect-[16/9]'}`}>
                <Foto src={aberto.foto} icone={iconeDe(aberto.nome, aberto.categoriaId)} tom={aberto.categoriaId} desenho={72} />
              </div>
              {pedirFoto(aberto) ? (
                <a
                  href={pedirFoto(aberto)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border border-borda bg-superficie px-4 text-sm font-semibold vt-zap hover:bg-superficie-2 ${FOCO}`}
                >
                  <Zap tamanho={18} /> Pedir foto no WhatsApp
                </a>
              ) : null}
            </div>
            <div className="flex items-center gap-3.5">
              <p className="text-2xl font-extrabold tracking-tight text-titulo tabular-nums">
                {aberto.variavel ? <span className="mr-1 text-sm font-semibold text-tinta-3">a partir de</span> : null}
                {brl(aberto.preco)}
                {aberto.medida !== 'UN' ? <span className="text-sm font-semibold text-tinta-3"> /{aberto.medida.toLowerCase()}</span> : null}
              </p>
            </div>
            {aberto.descricao ? <p className="-mt-2 text-[15px] leading-relaxed text-tinta-2">{aberto.descricao}</p> : null}
            {aberto.opcoes.length > 1 || (aberto.opcoes[0]?.rotulo ?? '') !== '' ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 flex w-full items-center justify-between text-sm font-bold text-titulo">
                  Escolha uma opção
                  {!opcao ? <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-[11px] font-bold text-tinta-2">Obrigatório</span> : null}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {aberto.opcoes.map((o) => {
                    const sel = opcao?.variacaoId === o.variacaoId
                    return (
                      <button
                        key={o.variacaoId}
                        type="button"
                        disabled={!o.disponivel}
                        onClick={() => setOpcao(o)}
                        aria-pressed={sel}
                        className={`flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition-colors disabled:line-through disabled:opacity-45 ${FOCO} ${
                          sel ? 'border-marca bg-marca-suave text-titulo ring-1 ring-marca' : 'border-borda bg-superficie text-tinta-2 hover:border-tinta-3'
                        }`}
                      >
                        {sel ? <Visto tamanho={14} className="text-[var(--marca-texto)]" /> : null}
                        {o.rotulo || aberto.nome}
                        {aberto.variavel ? <span className="font-medium text-tinta-3 tabular-nums">{brl(o.preco)}</span> : null}
                        {!o.disponivel ? <span className="sr-only">(esgotado)</span> : null}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            ) : null}
            <label className="flex flex-col gap-1.5 text-sm font-bold text-titulo">
              <span>
                Alguma observação? <span className="font-normal text-tinta-3">(opcional)</span>
              </span>
              <input
                value={obsItem}
                onChange={(e) => setObsItem(e.target.value.slice(0, 200))}
                placeholder="Ex.: sem cobertura, para presente"
                className={CAMPO}
              />
            </label>
          </div>
        ) : null}
      </Folha>

      {/* ── a sacola ── */}
      <Folha
        aberta={etapa === 'sacola'}
        fechar={fecharEtapa}
        titulo="Sua sacola"
        subtitulo="Passo 1 de 2"
        rodape={
          <div className="flex flex-col gap-3">
            {loja.pedidoMinimo && sacola.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className={faltaMinimo > 0 ? 'text-atencao' : 'text-bom'}>
                    {faltaMinimo > 0 ? `Faltam ${brl(faltaMinimo)} para o pedido mínimo` : 'Pedido mínimo atingido'}
                  </span>
                  <span className="text-tinta-3 tabular-nums">{brl(loja.pedidoMinimo)}</span>
                </div>
                <span className="h-1.5 overflow-hidden rounded-full bg-superficie-3" aria-hidden>
                  <span className="block h-full rounded-full bg-marca transition-[width] duration-300" style={{ width: `${Math.min(100, (subtotal / loja.pedidoMinimo) * 100)}%` }} />
                </span>
              </div>
            ) : null}
            <BotaoGrande
              disabled={sacola.length === 0 || faltaMinimo > 0}
              onClick={() => {
                setErro(null)
                setEtapa('dados')
              }}
              valor={brl(subtotal)}
            >
              Continuar
            </BotaoGrande>
          </div>
        }
      >
        {sacola.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-marca-suave text-[var(--marca-texto)]">
              <Sacola tamanho={26} />
            </span>
            <p className="text-sm text-tinta-2">Sua sacola está vazia.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-borda-suave">
            {sacola.map((i) => (
              <li key={i.variacaoId} className="flex gap-3 py-3.5 first:pt-1">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                  <Foto
                    src={i.foto}
                    icone={iconeDe(i.nome, produtos.find((p) => p.id === i.produtoId)?.categoriaId)}
                    tom={produtos.find((p) => p.id === i.produtoId)?.categoriaId ?? null}
                    desenho={28}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[15px] leading-snug font-semibold text-tinta">{i.nome}</p>
                      {i.rotulo ? <p className="truncate text-xs font-medium text-tinta-2">{i.rotulo}</p> : null}
                      {i.observacao ? <p className="truncate text-xs text-tinta-3">“{i.observacao}”</p> : null}
                    </div>
                    <span className="shrink-0 text-[15px] font-bold text-titulo tabular-nums">{brl(Math.round(i.preco * 100 * i.quantidade) / 100)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Passador
                      compacto
                      valor={i.quantidade}
                      medida={i.medida}
                      nome={i.nome}
                      mudar={(n) => {
                        mexerSacola((s) => s.map((x) => (x.variacaoId === i.variacaoId ? { ...x, quantidade: n } : x)))
                        setMexido(n > 0 ? `${i.nome}: ${qtd(n, i.medida)}` : `${i.nome} saiu da sacola`)
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        mexerSacola((s) => s.filter((x) => x.variacaoId !== i.variacaoId))
                        setMexido(`${i.nome} saiu da sacola`)
                      }}
                      className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-tinta-3 hover:bg-critico-fundo hover:text-critico ${FOCO}`}
                    >
                      <Lixo tamanho={15} /> Tirar
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
        voltar={() => setEtapa('sacola')}
        titulo="Finalizar pedido"
        subtitulo="Passo 2 de 2"
        rodape={
          <div className="flex flex-col gap-2.5">
            {erro ? (
              <p role="alert" className="rounded-xl bg-critico-fundo px-3.5 py-2.5 text-sm font-medium text-critico">
                {erro}
              </p>
            ) : null}
            <BotaoGrande onClick={mandar} disabled={enviando} valor={brl(subtotal + taxa)}>
              {enviando ? 'Enviando…' : 'Enviar pedido'}
            </BotaoGrande>
            <p className="text-center text-xs text-tinta-3">Depois é só confirmar com a loja pelo WhatsApp.</p>
          </div>
        }
      >
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            mandar()
          }}
        >
          {/* gente não vê; robô preenche */}
          <input ref={site} name="site" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />

          <Grupo titulo="Seus dados">
            <Campo rotulo="Seu nome">
              <input value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} autoComplete="name" className={CAMPO} maxLength={80} />
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
          </Grupo>

          <Grupo titulo="Como quer receber?">
            {loja.retirada && loja.entrega ? (
              <Escolha
                oculto
                rotulo="Como quer receber?"
                valor={dados.entrega ? 'entrega' : 'retirada'}
                mudar={(v) => setDados({ ...dados, entrega: v === 'entrega' })}
                opcoes={[
                  { valor: 'retirada', rotulo: 'Retirar na loja', detalhe: 'Sem taxa', icone: <Vitrine tamanho={20} /> },
                  { valor: 'entrega', rotulo: 'Entrega', detalhe: loja.taxaEntrega ? `+ ${brl(loja.taxaEntrega)}` : 'Grátis', icone: <Moto tamanho={20} /> },
                ]}
              />
            ) : (
              <p className="flex items-center gap-2.5 rounded-xl bg-superficie-2 px-3.5 py-3 text-sm font-medium text-tinta">
                {loja.entrega ? <Moto tamanho={18} className="text-[var(--marca-texto)]" /> : <Vitrine tamanho={18} className="text-[var(--marca-texto)]" />}
                {loja.entrega ? 'Esta loja faz entrega.' : 'Retirada na loja.'}
              </p>
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

          </Grupo>

          <Grupo titulo="Para quando?">
            <Escolha
              oculto
              rotulo="Para quando?"
              valor={dados.quando}
              mudar={(v) => setDados({ ...dados, quando: v as Dados['quando'] })}
              opcoes={[
                { valor: 'logo', rotulo: 'O quanto antes' },
                { valor: 'agendar', rotulo: 'Agendar' },
              ]}
            />
            {dados.quando === 'agendar' ? (
              <input type="datetime-local" value={dados.para} onChange={(e) => setDados({ ...dados, para: e.target.value })} className={CAMPO} aria-label="Dia e hora" />
            ) : null}
          </Grupo>

          <Grupo titulo="Como vai pagar?">
            <Escolha
              oculto
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
              <textarea value={dados.observacao} onChange={(e) => setDados({ ...dados, observacao: e.target.value })} rows={2} className={CAMPO} maxLength={500} />
            </Campo>
          </Grupo>

          <dl className="flex flex-col gap-2 rounded-2xl border border-borda-suave bg-superficie-2 px-4 py-3.5 text-sm">
            <div className="flex justify-between text-tinta-2">
              <dt>
                Produtos <span className="text-tinta-3">({Math.round(itensNaSacola)})</span>
              </dt>
              <dd className="tabular-nums">{brl(subtotal)}</dd>
            </div>
            {dados.entrega ? (
              <div className="flex justify-between text-tinta-2">
                <dt>Entrega</dt>
                <dd className="tabular-nums">{taxa > 0 ? brl(taxa) : 'Grátis'}</dd>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-borda-suave pt-2.5 text-base font-extrabold text-titulo">
              <dt>Total</dt>
              <dd className="tabular-nums">{brl(subtotal + taxa)}</dd>
            </div>
          </dl>
          <p className="-mt-2 text-xs leading-relaxed text-tinta-3">Seu nome e WhatsApp vão só para a loja, para ela falar com você sobre este pedido.</p>
        </form>
      </Folha>
    </main>
  )
}

/** Um produto na vitrine: em grade (foto em cima) ou em lista (foto ao lado). Sem foto, o desenho e o "Pedir foto". */
function Cartao({
  p,
  grade,
  ifood,
  icone,
  pedirFoto,
  naSacola,
  abrir,
  mais,
  menos,
}: {
  p: ProdutoNoCatalogo
  grade: boolean
  /** A linha de cardápio do delivery: texto à esquerda, foto quadrada à direita. */
  ifood?: boolean
  icone: IconeDoProduto
  /** O link do WhatsApp da loja pedindo a foto; nulo quando tem foto (ou a loja não tem WhatsApp). */
  pedirFoto: string | null
  naSacola: number
  abrir: () => void
  mais: () => void
  menos: () => void
}) {
  const unica = opcaoUnica(p)
  const preco = (
    <span className="flex flex-wrap items-baseline gap-x-1 tabular-nums">
      {p.variavel ? <span className="text-xs font-medium text-tinta-3">a partir de</span> : null}
      <span className="text-base font-extrabold text-titulo">{brl(p.preco)}</span>
      {p.medida !== 'UN' ? <span className="text-xs font-medium text-tinta-3">/{p.medida.toLowerCase()}</span> : null}
    </span>
  )
  // O controle de quantidade: "+" redondo; depois de pôr, o passador (produto
  // sem escolha) ou o número na sacola com "+" (produto com tamanho/sabor).
  const controle = !p.disponivel ? null : naSacola > 0 && unica ? (
    <div className="flex items-center rounded-full bg-marca text-marca-tinta shadow-[0_6px_16px_-6px_var(--marca)]" role="group" aria-label={`Quantidade de ${p.nome}`}>
      <button type="button" onClick={menos} aria-label={`Diminuir ${p.nome}`} className={`flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/10 ${FOCO}`}>
        {naSacola - passoDe(p.medida) < 1e-9 ? <Lixo tamanho={15} /> : <Menos tamanho={16} />}
      </button>
      <span className="min-w-6 text-center text-sm font-extrabold tabular-nums">{p.medida === 'UN' ? naSacola : qtd(naSacola, p.medida)}</span>
      <button type="button" onClick={mais} aria-label={`Mais ${p.nome}`} className={`flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/10 ${FOCO}`}>
        <Mais tamanho={16} />
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={mais}
      aria-label={unica ? `Adicionar ${p.nome}` : `Escolher opção de ${p.nome}`}
      className={`relative flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-2 shadow-[0_4px_12px_-4px_rgb(0_0_0/0.3)] transition-transform active:scale-95 ${FOCO} ${
        naSacola > 0 ? 'bg-marca text-marca-tinta' : 'bg-superficie text-titulo ring-1 ring-borda'
      }`}
    >
      {naSacola > 0 ? <span className="pl-1 text-sm font-extrabold tabular-nums">{p.medida === 'UN' ? naSacola : qtd(naSacola, p.medida)}</span> : null}
      <Mais tamanho={18} />
    </button>
  )
  const esgotado = !p.disponivel ? (
    <span className="rounded-full bg-superficie/95 px-2.5 py-1 text-[11px] font-bold tracking-wide text-tinta-2 uppercase shadow-sm ring-1 ring-borda-suave">Esgotado</span>
  ) : null

  if (ifood) {
    return (
      <li className="relative">
        <button
          type="button"
          onClick={abrir}
          disabled={!p.disponivel}
          className={`flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-superficie-2/60 ${FOCO} focus-visible:-outline-offset-2 ${!p.disponivel ? 'opacity-60' : ''}`}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="line-clamp-2 text-[15px] leading-snug font-semibold text-tinta">{p.nome}</span>
            {p.descricao ? (
              <span className="line-clamp-2 text-[13px] leading-relaxed text-tinta-2">{p.descricao}</span>
            ) : p.opcoes.length > 1 ? (
              <span className="line-clamp-1 text-[13px] text-tinta-3">{p.opcoes.map((o) => o.rotulo).filter(Boolean).join(' · ')}</span>
            ) : null}
            <span className="mt-1 flex items-center gap-2">
              {preco}
              {esgotado}
            </span>
          </span>
          <span className={`relative h-[92px] w-[92px] shrink-0 overflow-hidden rounded-2xl border border-borda-suave ${!p.disponivel ? 'grayscale' : ''}`}>
            <Foto src={p.foto} icone={icone} tom={p.categoriaId} desenho={40} />
          </span>
        </button>
        {controle ? <div className="absolute right-2.5 bottom-2.5">{controle}</div> : null}
      </li>
    )
  }

  if (grade) {
    return (
      <li className="relative">
        <article className={`group flex h-full flex-col overflow-hidden rounded-[20px] border border-borda-suave bg-superficie shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow hover:shadow-[0_10px_28px_-14px_rgb(0_0_0/0.25)] ${!p.disponivel ? 'opacity-70' : ''}`}>
          <button type="button" onClick={abrir} disabled={!p.disponivel} className={`flex flex-1 flex-col text-left ${FOCO} focus-visible:-outline-offset-2`}>
            <div className={`relative aspect-square w-full overflow-hidden ${!p.disponivel ? 'grayscale' : ''}`}>
              <Foto src={p.foto} icone={icone} tom={p.categoriaId} desenho={52} className="transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
              {esgotado ? <span className="absolute top-2 left-2">{esgotado}</span> : null}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-3 pr-3">
              <span className="line-clamp-2 text-sm leading-snug font-semibold text-tinta">{p.nome}</span>
              <span className="mt-auto">{preco}</span>
            </div>
          </button>
          {pedirFoto ? <PedirFoto href={pedirFoto} className="mx-3 mb-3" /> : null}
        </article>
        {controle ? <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square"><div className="pointer-events-auto absolute right-2 bottom-2">{controle}</div></div> : null}
      </li>
    )
  }

  return (
    <li className="relative">
      <article
        className={`flex h-full flex-col overflow-hidden rounded-[20px] border border-borda-suave bg-superficie shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow hover:shadow-[0_10px_28px_-16px_rgb(0_0_0/0.25)] ${!p.disponivel ? 'opacity-70' : ''}`}
      >
        <button type="button" onClick={abrir} disabled={!p.disponivel} className={`flex min-w-0 flex-1 items-center gap-3.5 p-3 text-left ${FOCO} focus-visible:-outline-offset-2`}>
          <span className={`relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl ${!p.disponivel ? 'grayscale' : ''}`}>
            <Foto src={p.foto} icone={icone} tom={p.categoriaId} desenho={42} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1 pr-12">
            <span className="line-clamp-2 text-[15px] leading-snug font-semibold text-tinta">{p.nome}</span>
            {p.descricao ? <span className="line-clamp-1 text-[13px] text-tinta-2">{p.descricao}</span> : null}
            <span className="mt-0.5 flex items-center gap-2">
              {preco}
              {esgotado}
            </span>
          </span>
        </button>
        {pedirFoto ? <PedirFoto href={pedirFoto} className="mb-3 ml-[101px] mr-14 self-start" /> : null}
      </article>
      {controle ? <div className={`absolute right-3 ${pedirFoto ? 'top-[52px]' : 'bottom-3'}`}>{controle}</div> : null}
    </li>
  )
}

/** "Pedir foto no WhatsApp": fora do botão do cartão (link dentro de botão não vale). */
function PedirFoto({ href, className = '' }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-borda-suave bg-superficie px-2.5 py-1 text-[12px] leading-tight font-semibold vt-zap hover:bg-superficie-2 ${FOCO} ${className}`}
    >
      <Zap tamanho={14} className="shrink-0" />
      Pedir foto no WhatsApp
    </a>
  )
}

const CAMPO =
  'w-full min-h-12 rounded-xl border border-borda bg-superficie px-3.5 py-3 text-base font-normal text-tinta outline-none transition-shadow placeholder:text-tinta-3 focus:border-marca focus:ring-4 focus:ring-[var(--marca-anel)]'

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-extrabold tracking-tight text-titulo">{titulo}</h3>
      {children}
    </section>
  )
}

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
  oculto,
}: {
  rotulo: string
  /** A pergunta já está no título do grupo: a legenda fica só para o leitor de tela. */
  oculto?: boolean
  valor: string
  mudar: (v: string) => void
  opcoes: { valor: string; rotulo: string; detalhe?: string; icone?: React.ReactNode }[]
}) {
  return (
    <fieldset className="flex flex-col">
      <legend className={oculto ? 'sr-only' : 'mb-2 text-sm font-semibold text-tinta'}>{rotulo}</legend>
      <div className="grid grid-cols-2 gap-2">
        {opcoes.map((o) => {
          const sel = valor === o.valor
          return (
            <button
              key={o.valor}
              type="button"
              onClick={() => mudar(o.valor)}
              aria-pressed={sel}
              className={`relative flex min-h-12 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition-colors ${FOCO} ${
                sel ? 'border-marca bg-marca-suave text-titulo ring-1 ring-marca' : 'border-borda bg-superficie text-tinta-2 hover:border-tinta-3'
              } ${o.icone ? '' : 'justify-center text-center'}`}
            >
              {o.icone ? <span className={sel ? 'text-[var(--marca-texto)]' : 'text-tinta-3'}>{o.icone}</span> : null}
              <span className="flex min-w-0 flex-col leading-tight">
                {o.rotulo}
                {o.detalhe ? <span className="mt-0.5 text-xs font-medium text-tinta-3 tabular-nums">{o.detalhe}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
