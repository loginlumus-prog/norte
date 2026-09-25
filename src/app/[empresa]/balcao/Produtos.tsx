'use client'

// A vitrine do balcão simples: a busca em cima, as categorias como abas, os
// produtos como cartões grandes.
//
// ── as decisões ──────────────────────────────────────────────
// 1. A BUSCA FICA EM CIMA DE TUDO, SEMPRE. É por ela que o leitor de código
//    de barras entra, e é ela que salva a loja de quatrocentos produtos: a
//    vitrine mostra de 36 em 36, a busca acha o que está na página 9.
// 2. O CARTÃO TEM 160px DE ALTURA, não 88. O mínimo de alvo para o dedo é
//    uns 44px; 88 é o piso que se pediu; mas o nome precisa caber em duas
//    linhas GRANDES, o preço precisa ser lido de longe, de pé, com o cliente
//    falando, e o bloco de cor em cima é o que o olho acha antes de ler. O
//    que sobra é a margem de erro do dedo apressado.
// 3. SEM FOTO, A INICIAL NA COR DA CATEGORIA. O cadastro ainda não tem foto
//    de produto; as duas letras em cima do tom da categoria deixam os
//    cartões diferentes entre si sem virar carnaval — e a cor nunca vai
//    sozinha: tem as letras, o nome e, em "Todos", o nome da categoria.
// 4. ACABOU, NÃO TOCA. Produto sem estoque fica apagado, com "acabou"
//    escrito. O servidor recusaria a venda no fim; aqui ela nem começa.
// 5. O TOQUE RESPONDE. O cartão pisca a borda e ganha a bolinha com quantos
//    já estão no pedido: quem tocou sabe que entrou sem olhar para o lado.
// 6. O RAMO MUDA OS ATALHOS, NÃO A REGRA (ver ramo.ts). Na sorveteria, o copo
//    de açaí puxa os complementos para um toque; o peso tem as teclas do
//    tamanho de copo da casa; a loja de roupa vê a grade inteira, tamanho por
//    cor, com o saldo de cada peça. A venda por baixo é a mesma.

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Botao, Situacao, cx } from '@/ui/base'
import { vitrine, type Achado, type Vitrine } from './acoes'
import { brl, precoDe, linhaCent } from './conta'
import type { Venda } from './useVenda'
import {
  acharVariacao,
  eixosDe,
  faixaDePreco,
  fracionado,
  iniciais,
  possivel,
  rotuloDaVariacao,
  saldoTotal,
  tomDe,
  UNIDADE,
  type Escolhas,
  type ProdutoNaVitrine,
  type VariacaoNaVitrine,
} from './vitrine'
import { Folha } from './Folha'
import { LerBalanca } from './Balanca'
import {
  digitarNoPeso,
  ehComplemento,
  numeroNoCampo,
  pedeComplemento,
  pesoNoCampo,
  teclasDePeso,
} from './ramo'
import { matrizDaGrade } from './vitrine'

type Categoria = { id: string; nome: string; quantos: number }

/** O que a folha de escolha pergunta: a variação, o quanto, ou os dois. */
type Escolha = {
  titulo: string
  tom: string
  medida: string
  /** Nulo quando a peça já está decidida (veio da busca, ou o produto não varia). */
  variacoes: VariacaoNaVitrine[] | null
  peca: Achado | null
  /** A categoria do produto — é ela que diz se o item pede complemento. */
  categoriaId: string | null
}

/** O tom da categoria como estilo: fundo claro da cor, letra forte da mesma cor. */
const estiloDoTom = (tom: string): CSSProperties => ({
  background: `color-mix(in srgb, var(${tom}) 15%, var(--superficie))`,
  color: `color-mix(in srgb, var(${tom}) 80%, var(--tinta))`,
})

export function Produtos({
  v,
  slug,
  unidadeId,
  unidadeNome,
  ramo = null,
  telaCheia,
  aoTelaCheia,
  barra,
}: {
  v: Venda
  slug: string
  unidadeId: string
  unidadeNome: string
  /** O ramo da loja: teclas de peso e complementos (ver ramo.ts). */
  ramo?: string | null
  /** A barra do caixa, numa linha, no topo da coluna dos produtos. */
  barra?: ReactNode
  telaCheia: boolean
  aoTelaCheia: () => void
}) {
  const [categoriaId, setCategoriaId] = useState<string | null>(null)
  const [categorias, setCategorias] = useState<Categoria[] | null>(null)
  // A página é guardada com a chave de quem a pediu. "Carregando" é a chave
  // pedida não bater com a guardada — sem um estado a mais para esquecer de
  // desligar.
  const [pagina, setPagina] = useState<{ chave: string; produtos: ProdutoNaVitrine[]; mais: boolean } | null>(null)
  const [falhou, setFalhou] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [maisIndo, setMaisIndo] = useState(false)
  const [escolha, setEscolha] = useState<Escolha | null>(null)
  const [piscou, setPiscou] = useState<string | null>(null)
  // Os complementos da loja (a aba "Complementos"), e o item que acabou de
  // entrar e pede um — "Vai granola no açaí?".
  const [complementos, setComplementos] = useState<{ chave: string; produtos: ProdutoNaVitrine[] } | null>(null)
  const [sugestao, setSugestao] = useState<string | null>(null)

  // A loja entra na chave: trocar de loja no seletor é trocar de catálogo
  // (cada loja só vende o que é dela), e a vitrine velha não pode ficar na
  // tela fingindo ser a nova enquanto a outra chega.
  const chave = `${unidadeId}:${categoriaId ?? '*'}`
  const carregando = pagina?.chave !== chave && falhou !== chave

  useEffect(() => {
    let vivo = true
    const k = `${unidadeId}:${categoriaId ?? '*'}`
    vitrine(slug, unidadeId, categoriaId, 0)
      .then((r: Vitrine) => {
        if (!vivo) return
        if (r.categorias) {
          setCategorias(r.categorias)
          // A aba escolhida não existe na loja nova: volta para "Todos".
          if (categoriaId && !r.categorias.some((c) => c.id === categoriaId)) setCategoriaId(null)
        }
        setPagina({ chave: k, produtos: r.produtos, mais: r.mais })
        setFalhou(null)
      })
      .catch(() => vivo && setFalhou(k))
    return () => {
      vivo = false
    }
  }, [slug, unidadeId, categoriaId, tentativa])

  async function mostrarMais() {
    if (!pagina || maisIndo) return
    setMaisIndo(true)
    try {
      const r = await vitrine(slug, unidadeId, categoriaId, pagina.produtos.length)
      setPagina((p) =>
        p && p.chave === chave ? { chave, produtos: [...p.produtos, ...r.produtos], mais: r.mais } : p,
      )
    } finally {
      setMaisIndo(false)
    }
  }

  // A bolinha acende e apaga: é resposta ao toque, não estado.
  useEffect(() => {
    if (!piscou) return
    const t = setTimeout(() => setPiscou(null), 450)
    return () => clearTimeout(t)
  }, [piscou])

  const indiceDaCategoria = useMemo(() => {
    const m = new Map<string, number>()
    categorias?.forEach((c, i) => m.set(c.id, i))
    return m
  }, [categorias])
  const tomDoProduto = (p: { categoriaId: string | null }) =>
    tomDe(p.categoriaId ? (indiceDaCategoria.get(p.categoriaId) ?? -1) : -1)
  const nomeDaCategoria = (id: string | null) => categorias?.find((c) => c.id === id)?.nome ?? null

  // ── complementos ───────────────────────────────────────────
  // Só na sorveteria, e só se a loja tem a aba de complementos com produto
  // (é uma consulta a mais, uma vez por loja). Sem a aba, nada aparece: a
  // sugestão sai do cadastro da loja, não de uma lista nossa.
  const abaComplemento = ramo === 'sorveteria' ? categorias?.find((c) => ehComplemento(c.nome)) : undefined
  const idComplemento = abaComplemento?.id ?? null
  const chaveComplemento = idComplemento ? `${unidadeId}:${idComplemento}` : null
  useEffect(() => {
    if (!idComplemento) return
    let vivo = true
    const k = `${unidadeId}:${idComplemento}`
    vitrine(slug, unidadeId, idComplemento, 0)
      .then((r) => {
        if (vivo) setComplementos({ chave: k, produtos: r.produtos })
      })
      // Sem complementos a venda segue igual: a sugestão só não aparece.
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [slug, unidadeId, idComplemento])
  const complementosDaLoja = complementos && complementos.chave === chaveComplemento ? complementos.produtos : []

  // O pedido esvaziou (venda concluída, "Limpar"): a sugestão era daquele pedido.
  useEffect(() => {
    if (v.carrinho.length === 0) setSugestao(null)
  }, [v.carrinho.length])

  // Quantos de cada peça já estão no pedido — para a bolinha do cartão.
  const noPedido = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of v.carrinho) m.set(l.id, (m.get(l.id) ?? 0) + (l.medida === 'UN' ? l.quantidade : 1))
    return m
  }, [v.carrinho])

  function lancar(a: Achado, quantidade?: number, marca?: string, origem?: { categoriaId: string | null; nome: string }) {
    v.lancar(a, quantidade)
    setPiscou(marca ?? a.id)
    // O copo entrou: os complementos sobem para um toque. Complemento que
    // entra não mexe na sugestão — a pessoa pode querer granola E leite
    // condensado.
    if (origem && complementosDaLoja.length > 0 && pedeComplemento(ramo, nomeDaCategoria(origem.categoriaId), origem.nome)) {
      setSugestao(origem.nome)
    }
  }

  function tocarProduto(p: ProdutoNaVitrine) {
    const [unica] = p.variacoes
    const tom = tomDoProduto(p)
    const categoriaId = p.categoriaId
    if (p.variacoes.length === 1 && unica) {
      if (fracionado(p.medida)) setEscolha({ titulo: p.nome, tom, medida: p.medida, variacoes: null, peca: unica, categoriaId })
      else lancar(unica, 1, p.id, { categoriaId, nome: p.nome })
      return
    }
    setEscolha({ titulo: p.nome, tom, medida: p.medida, variacoes: p.variacoes, peca: null, categoriaId })
  }

  function tocarAchado(a: Achado) {
    // Etiqueta de outra loja: nem pergunta o peso — o lançamento explica e recusa.
    if (a.foraDaLoja) {
      v.lancar(a)
      return
    }
    if (fracionado(a.medida)) {
      setEscolha({ titulo: a.descricao, tom: tomDe(-1), medida: a.medida, variacoes: null, peca: a, categoriaId: null })
      return
    }
    lancar(a, 1)
    v.setTermo('')
  }

  const buscando = v.termo.trim().length >= 2
  // Cada loja só mostra o que é dela. O código de outra loja não vira cartão:
  // vira uma frase dizendo de quem é, para a pessoa não achar que o leitor
  // falhou.
  const daLoja = v.achados.filter((a) => !a.foraDaLoja)
  const deFora = v.achados.find((a) => a.foraDaLoja)

  return (
    <section aria-label="Produtos" className="flex min-h-0 min-w-0 flex-col gap-3">
      {barra}
      {/* ── a busca ── */}
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-tinta-3"
            fill="none"
          >
            <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.8" />
            <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={v.busca}
            value={v.termo}
            onChange={(e) => v.setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void v.enterNaBusca().then((a) => a && tocarAchado(a))
              }
              if (e.key === 'Escape') {
                v.setTermo('')
                v.setAchados([])
              }
            }}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Buscar ou bipar o código"
            aria-label="Buscar produto ou bipar o código (Ctrl+P)"
            className={cx(
              'h-14 w-full rounded-2xl border border-borda bg-superficie pr-4 pl-12 text-lg text-tinta shadow-norte',
              'placeholder:text-tinta-3 focus:border-marca focus:outline-none sm:pr-20',
              '[&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {v.termo ? (
            <button
              type="button"
              onClick={() => {
                v.setTermo('')
                v.setAchados([])
                v.busca.current?.focus()
              }}
              aria-label="Limpar a busca"
              className="absolute top-1/2 right-2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-tinta-3 hover:bg-superficie-2 hover:text-tinta"
            >
              <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 rounded border border-borda bg-superficie-2 px-1.5 py-px font-mono text-[11px] font-semibold text-tinta-3 sm:block">
              Ctrl P
            </kbd>
          )}
        </div>

        {/* Tela cheia: some o menu, some o cabeçalho, fica a venda. É o modo
            do tablet no balcão da sorveteria — e sai com um toque. */}
        <button
          type="button"
          onClick={aoTelaCheia}
          aria-pressed={telaCheia}
          title={telaCheia ? 'Sair da tela cheia' : 'Tela cheia: só a venda na tela'}
          className="flex h-14 shrink-0 items-center gap-2 rounded-2xl border border-borda bg-superficie px-4 text-sm font-semibold text-tinta-2 shadow-norte hover:bg-superficie-2 hover:text-tinta"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
            {telaCheia ? (
              <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
          <span className="hidden xl:inline">{telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}</span>
        </button>
      </div>

      {/* ── as categorias ──
          Rolam de lado quando não cabem, em vez de quebrar em três linhas que
          empurram os produtos para baixo. A aba escolhida é escura e tem
          aria-pressed; a cor da categoria vai na bolinha, junto do nome. */}
      {!buscando && categorias && categorias.length > 0 && (
        <div
          role="group"
          aria-label="Categorias"
          className="relative -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
        >
          {[{ id: null as string | null, nome: 'Todos', quantos: 0 }, ...categorias].map((c) => {
            const ativa = categoriaId === c.id
            return (
              <button
                key={c.id ?? 'todos'}
                type="button"
                onClick={() => setCategoriaId(c.id)}
                aria-pressed={ativa}
                className={cx(
                  'flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-5 text-base font-semibold whitespace-nowrap transition-colors',
                  ativa
                    ? 'border-tinta bg-tinta text-superficie'
                    : 'border-borda bg-superficie text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
                )}
              >
                {c.id && (
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{ background: `var(${tomDe(indiceDaCategoria.get(c.id) ?? -1)})` }}
                  />
                )}
                {c.nome}
                {c.id && <span className={cx('numero text-sm', ativa ? 'opacity-70' : 'text-tinta-3')}>{c.quantos}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* ── os complementos ──
          Logo abaixo das abas, no caminho do olho, e só depois de o copo
          entrar. Tocar num complemento lança (e pergunta o peso, se for a
          quilo); o ✕ dispensa. Some sozinho quando o pedido esvazia. */}
      {sugestao && !buscando && complementosDaLoja.length > 0 && (
        <div
          role="group"
          aria-label={`Complementos para ${sugestao}`}
          className="flex flex-col gap-2 rounded-2xl border border-marca/30 bg-marca-suave p-3 pl-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-tinta">
              Vai complemento no {sugestao}?
            </span>
            <button
              type="button"
              onClick={() => setSugestao(null)}
              className="-my-1 flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-tinta-2 hover:bg-superficie hover:text-tinta"
            >
              Sem complemento
              <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {complementosDaLoja.map((p) => {
              const saldo = saldoTotal(p.variacoes)
              const unica = p.variacoes.length === 1 ? p.variacoes[0] : undefined
              const qtd = p.variacoes.reduce((s, x) => s + (noPedido.get(x.id) ?? 0), 0)
              const preco = unica
                ? precoDe({ ...unica, quantidade: 1 }, v.conta.tabela)
                : faixaDePreco(p.variacoes, v.conta.tabela).de
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={saldo <= 0}
                  onClick={() => tocarProduto(p)}
                  className={cx(
                    'flex min-h-11 shrink-0 touch-manipulation items-center gap-2 rounded-full border bg-superficie px-4 text-sm font-semibold whitespace-nowrap text-tinta transition',
                    'border-borda hover:border-marca/50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45',
                    qtd > 0 && 'border-marca',
                  )}
                >
                  {p.nome}
                  <span className="numero text-xs font-medium text-tinta-3">
                    {saldo <= 0 ? 'acabou' : `+${brl(preco)}`}
                  </span>
                  {qtd > 0 && (
                    <span className="numero flex h-5 min-w-5 items-center justify-center rounded-full bg-marca px-1.5 text-[11px] font-bold text-marca-tinta">
                      {Number.isInteger(qtd) ? qtd : qtd.toLocaleString('pt-BR')}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── os cartões ── */}
      <div className="relative min-h-0 flex-1 lg:overflow-y-auto lg:pr-1 lg:pb-2">
        {buscando ? (
          daLoja.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-borda px-6 py-12 text-center">
              {deFora ? (
                <>
                  <p className="text-base font-semibold text-tinta">
                    {deFora.descricao} não é vendido na {unidadeNome}.
                  </p>
                  <p className="max-w-sm text-sm text-tinta-2">
                    O código existe, mas é de outra loja da empresa. Aqui ele não entra no pedido.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold text-tinta">Nada com “{v.termo.trim()}” nesta loja.</p>
                  <p className="max-w-sm text-sm text-tinta-2">
                    Confira o código da etiqueta, ou digite um pedaço do nome. Esc limpa a busca.
                  </p>
                </>
              )}
            </div>
          ) : (
            <Grade>
              {daLoja.map((a, i) => (
                <Cartao
                  key={a.id}
                  nome={a.descricao}
                  preco={precoDe({ ...a, quantidade: 1 }, v.conta.tabela)}
                  medida={a.medida}
                  estilo={estiloDoTom(tomDe(-1))}
                  saldo={a.saldo}
                  acabou={a.saldo <= 0}
                  detalhe={a.codigo}
                  enter={i === 0}
                  noPedido={noPedido.get(a.id) ?? 0}
                  piscou={piscou === a.id}
                  aoTocar={() => tocarAchado(a)}
                />
              ))}
            </Grade>
          )
        ) : carregando ? (
          <Grade>
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} aria-hidden className="h-40 animate-pulse rounded-2xl bg-superficie-2" />
            ))}
          </Grade>
        ) : falhou === chave ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-borda px-6 py-12 text-center">
            <p className="text-base font-semibold text-tinta">Não deu para trazer os produtos agora.</p>
            <p className="text-sm text-tinta-2">A busca continua funcionando. Tente de novo em instantes.</p>
            <Botao
              tom="secundario"
              onClick={() => {
                setFalhou(null)
                setTentativa((n) => n + 1)
              }}
            >
              Tentar de novo
            </Botao>
          </div>
        ) : pagina && pagina.produtos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-borda px-6 py-12 text-center">
            <p className="text-base font-semibold text-tinta">
              {categoriaId ? 'Nenhum produto ativo nesta categoria.' : 'Ainda não há produto ativo para vender.'}
            </p>
            <a href={`/${slug}/produtos`} className="text-sm font-semibold text-marca underline-offset-2 hover:underline">
              Cadastrar produtos
            </a>
          </div>
        ) : (
          <>
            <Grade>
              {pagina?.produtos.map((p) => {
                const faixa = faixaDePreco(p.variacoes, v.conta.tabela)
                const saldo = saldoTotal(p.variacoes)
                const qtd = p.variacoes.reduce((s, x) => s + (noPedido.get(x.id) ?? 0), 0)
                const unica = p.variacoes.length === 1 ? p.variacoes[0] : undefined
                return (
                  <Cartao
                    key={p.id}
                    nome={p.nome}
                    preco={unica ? precoDe({ ...unica, quantidade: 1 }, v.conta.tabela) : faixa.de}
                    aPartirDe={!unica && faixa.de !== faixa.ate}
                    medida={p.medida}
                    estilo={estiloDoTom(tomDoProduto(p))}
                    saldo={saldo}
                    acabou={saldo <= 0}
                    detalhe={
                      p.variacoes.length > 1
                        ? `${p.variacoes.length} opções`
                        : categoriaId === null
                          ? nomeDaCategoria(p.categoriaId)
                          : null
                    }
                    noPedido={qtd}
                    piscou={piscou === p.id || p.variacoes.some((x) => x.id === piscou)}
                    aoTocar={() => tocarProduto(p)}
                  />
                )
              })}
            </Grade>
            {pagina?.mais && (
              <div className="flex justify-center pt-4">
                <Botao tom="secundario" onClick={mostrarMais} carregando={maisIndo} className="min-h-12 px-6 text-base">
                  Mostrar mais produtos
                </Botao>
              </div>
            )}
          </>
        )}
      </div>

      {escolha && (
        <EscolhaFolha
          key={`${escolha.titulo}-${escolha.peca?.id ?? ''}`}
          escolha={escolha}
          ramo={ramo}
          tabela={v.conta.tabela}
          aoFechar={() => setEscolha(null)}
          aoLancar={(peca, q) => {
            lancar(peca, q, undefined, { categoriaId: escolha.categoriaId, nome: escolha.titulo })
            if (buscando) v.setTermo('')
            setEscolha(null)
          }}
        />
      )}
    </section>
  )
}

function Grade({ children }: { children: ReactNode }) {
  // Pela largura da COLUNA, não da tela: com o pedido do lado, a mesma tela
  // de 1.280px dá quatro cartões; em tela cheia, cinco ou seis. No celular,
  // dois lado a lado, sempre — um só por linha vira lista, e lista se lê.
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]">{children}</div>
  )
}

function Cartao({
  nome,
  preco,
  aPartirDe = false,
  medida,
  estilo,
  saldo,
  acabou,
  detalhe,
  enter = false,
  noPedido,
  piscou,
  aoTocar,
}: {
  nome: string
  preco: number
  aPartirDe?: boolean
  medida: string
  estilo: CSSProperties
  saldo: number
  acabou: boolean
  detalhe?: string | null
  enter?: boolean
  noPedido: number
  piscou: boolean
  aoTocar: () => void
}) {
  const un = medida !== 'UN' ? `/${UNIDADE[medida] ?? medida.toLowerCase()}` : ''
  const falado = [
    nome,
    `${aPartirDe ? 'a partir de ' : ''}${brl(preco)}${un ? ` por ${UNIDADE[medida] ?? medida}` : ''}`,
    detalhe,
    acabou ? 'acabou' : null,
    noPedido > 0 ? `${noPedido} no pedido` : null,
  ]
    .filter(Boolean)
    .join(', ')

  // O cartão tem duas partes, como nos PDVs de balcão de hoje: em cima, o
  // bloco de cor da categoria com as iniciais grandes (é o que o olho acha de
  // longe, antes de ler); embaixo, o nome e o preço, em letra de ler de pé.
  // O toque afunda o cartão (scale) e acende a borda: resposta sem som.
  return (
    <button
      type="button"
      onClick={aoTocar}
      disabled={acabou}
      aria-label={falado}
      className={cx(
        'group relative flex min-h-[10rem] flex-col overflow-hidden rounded-2xl border bg-superficie text-left transition',
        'touch-manipulation select-none',
        acabou
          ? 'cursor-not-allowed border-borda-suave opacity-55'
          : 'border-borda shadow-norte hover:-translate-y-0.5 hover:border-marca/40 hover:shadow-norte-alta active:translate-y-0 active:scale-[0.97]',
        piscou && 'border-marca ring-2 ring-marca/40',
      )}
    >
      <span aria-hidden style={estilo} className="flex h-[4.25rem] shrink-0 items-center justify-between px-3.5">
        <span className="text-[1.625rem] leading-none font-extrabold tracking-tight">{iniciais(nome)}</span>
        {enter && noPedido === 0 && (
          <kbd className="rounded border border-current/20 bg-superficie/70 px-1.5 py-px font-mono text-[10px] font-semibold">
            Enter
          </kbd>
        )}
      </span>

      {noPedido > 0 && (
        <span
          aria-hidden
          className="numero absolute top-2.5 right-2.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-marca px-2 text-sm font-bold text-marca-tinta shadow-norte"
        >
          {Number.isInteger(noPedido) ? noPedido : noPedido.toLocaleString('pt-BR')}
        </span>
      )}

      <span className="flex flex-1 flex-col gap-1 px-3.5 pt-2.5 pb-3">
        <span className="line-clamp-2 text-[15px] leading-snug font-semibold text-tinta">{nome}</span>
        <span className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1 pt-1">
          <span className="flex min-w-0 flex-col">
            {aPartirDe && <span className="text-[11px] leading-none text-tinta-3">a partir de</span>}
            <span className="numero text-lg leading-tight font-bold text-tinta">
              {brl(preco)}
              {un && <span className="text-sm font-semibold text-tinta-3">{un}</span>}
            </span>
          </span>
          {acabou ? (
            <Situacao nivel="critico">acabou</Situacao>
          ) : detalhe ? (
            <span className="truncate text-xs text-tinta-3">{detalhe}</span>
          ) : saldo > 0 && saldo <= 3 && medida === 'UN' ? (
            <span className="numero text-xs font-semibold text-atencao">só {saldo}</span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

/**
 * A pergunta do meio do caminho: qual variação, e quanto.
 *
 * Um eixo só (o sabor, o tamanho): um toque escolhe e lança. Dois eixos
 * (tamanho E cor): escolhe os dois, e o botão de baixo diz o que vai entrar,
 * com o preço, antes de entrar. Peso: pergunta quanto pesou, mostra quanto dá.
 */
function EscolhaFolha({
  escolha,
  ramo,
  tabela,
  aoFechar,
  aoLancar,
}: {
  escolha: Escolha
  ramo: string | null
  tabela: Venda['conta']['tabela']
  aoFechar: () => void
  aoLancar: (peca: Achado, quantidade: number) => void
}) {
  const [escolhas, setEscolhas] = useState<Escolhas>({})
  const [peca, setPeca] = useState<Achado | null>(escolha.peca)
  const [quanto, setQuanto] = useState('')

  const variacoes = escolha.variacoes ?? []
  const eixos = useMemo(() => eixosDe(variacoes), [variacoes])
  const pedeQuanto = fracionado(escolha.medida)
  const un = UNIDADE[escolha.medida] ?? escolha.medida.toLowerCase()
  const quantidade = Number(quanto.replace(',', '.'))
  const quantoOk = quantidade > 0 && Number.isFinite(quantidade)
  const teclas = pedeQuanto ? teclasDePeso(ramo, escolha.medida) : []
  const pesa = escolha.medida === 'KG' || escolha.medida === 'G'

  // Tela de toque (tablet, celular): o teclado grande no lugar do teclado do
  // sistema, que cobre metade da folha e esconde o "Adicionar". Descoberto
  // depois de montar — o servidor não sabe que tela é esta.
  const [toque, setToque] = useState(false)
  useEffect(() => {
    try {
      setToque(window.matchMedia('(pointer: coarse)').matches)
    } catch {}
  }, [])

  // A grade tamanho × cor, quando o produto tem os dois eixos e ela cabe na
  // folha. Mais que seis colunas não cabe num celular em pé: aí ficam os
  // botões por eixo, que quebram linha.
  const matriz = useMemo(() => (pedeQuanto ? null : matrizDaGrade(variacoes)), [pedeQuanto, variacoes])
  const usaMatriz = !!matriz && matriz.colunas.opcoes.length <= 6 && matriz.linhas.opcoes.length <= 12

  function escolher(eixo: string, valor: string) {
    // Tocar de novo no que está marcado desmarca. É a saída de quem escolheu
    // "Rosa" e agora quer o GG que só existe em preto: desmarca a cor, e o GG
    // volta a ser tocável.
    const novas = { ...escolhas }
    if (novas[eixo] === valor) delete novas[eixo]
    else novas[eixo] = valor
    setEscolhas(novas)
    const achada = acharVariacao(variacoes, novas)
    if (!achada) return
    // Um eixo só e vendido por unidade: o toque já é a decisão.
    if (eixos.length === 1 && !pedeQuanto) {
      if (achada.saldo > 0) aoLancar(achada, 1)
      return
    }
    if (pedeQuanto) setPeca(achada)
  }

  const achada = peca ?? acharVariacao(variacoes, escolhas)
  const precoUnit = achada ? precoDe({ ...achada, quantidade: 1 }, tabela) : null

  // Variações sem eixo nenhum (duas "padrão", cadastro antigo): viram uma
  // lista simples pelo nome, para ainda dar para vender.
  const semEixo = variacoes.length > 0 && eixos.length === 0

  const podeAdicionar = !!achada && achada.saldo > 0 && (!pedeQuanto || quantoOk)

  function adicionar() {
    if (!achada || !podeAdicionar) return
    aoLancar(achada, pedeQuanto ? quantidade : 1)
  }

  const mostrarRodape = pedeQuanto ? !!achada : eixos.length > 1

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={escolha.titulo}
      larga={eixos.some((e) => e.opcoes.length > 6) || (!!matriz && usaMatriz && matriz.colunas.opcoes.length > 3)}
      icone={
        <span
          aria-hidden
          style={estiloDoTom(escolha.tom)}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-extrabold"
        >
          {iniciais(escolha.titulo)}
        </span>
      }
      subtitulo={
        pedeQuanto && achada ? (
          <span className="numero">
            {brl(precoUnit ?? 0)} por {un}
          </span>
        ) : eixos.length > 0 ? (
          `Escolha ${eixos.map((e) => e.nome.toLowerCase()).join(' e ')}`
        ) : null
      }
      rodape={
        mostrarRodape ? (
          <Botao
            largo
            onClick={adicionar}
            disabled={!podeAdicionar}
            className="min-h-14 rounded-xl text-base"
          >
            {!achada
              ? `Escolha ${eixos.filter((e) => !escolhas[e.nome]).map((e) => e.nome.toLowerCase()).join(' e ')}`
              : achada.saldo <= 0
                ? 'Esta acabou'
                : pedeQuanto
                  ? quantoOk
                    ? `Adicionar · ${brl(linhaCent({ ...achada, quantidade }, tabela) / 100)}`
                    : `Diga quanto (${un})`
                  : `Adicionar ${rotuloDaVariacao(achada)} · ${brl(precoUnit ?? 0)}`}
          </Botao>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {/* A grade inteira: linha é o primeiro eixo, coluna o segundo, e cada
            cruzamento diz quanto tem. Um toque escolhe os dois de uma vez. */}
        {matriz && usaMatriz && (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-separate border-spacing-1.5 text-center">
              <caption className="sr-only">
                Saldo na loja por {matriz.linhas.nome.toLowerCase()} e {matriz.colunas.nome.toLowerCase()}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-14 text-left text-xs font-semibold tracking-wide text-tinta-3 uppercase">
                    {matriz.linhas.nome}
                  </th>
                  {matriz.colunas.opcoes.map((c) => (
                    <th key={c.valor} scope="col" className="px-1 pb-1 text-sm font-semibold text-tinta-2">
                      <span className="inline-flex items-center gap-1.5">
                        {c.hex && (
                          <span aria-hidden className="size-3 shrink-0 rounded-full border border-borda" style={{ background: c.hex }} />
                        )}
                        {c.valor}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matriz.linhas.opcoes.map((l, i) => (
                  <tr key={l.valor}>
                    <th scope="row" className="text-left text-base font-bold text-tinta">
                      {l.valor}
                    </th>
                    {(matriz.celulas[i] ?? []).map((x, j) => {
                      const c = matriz.colunas.opcoes[j]!
                      if (!x) {
                        return (
                          <td key={c.valor} className="text-sm text-tinta-3">
                            <span aria-hidden>—</span>
                            <span className="sr-only">não existe</span>
                          </td>
                        )
                      }
                      const marcada = escolhas[matriz.linhas.nome] === l.valor && escolhas[matriz.colunas.nome] === c.valor
                      const acabou = x.saldo <= 0
                      return (
                        <td key={c.valor} className="p-0">
                          <button
                            type="button"
                            disabled={acabou}
                            aria-pressed={marcada}
                            aria-label={`${l.valor} ${c.valor}: ${acabou ? 'acabou' : `${x.saldo} na loja`}`}
                            onClick={() => setEscolhas({ [matriz.linhas.nome]: l.valor, [matriz.colunas.nome]: c.valor })}
                            className={cx(
                              'numero flex min-h-12 w-full min-w-12 items-center justify-center rounded-lg border-2 px-1 text-base font-bold transition-colors',
                              marcada
                                ? 'border-marca bg-marca-suave text-tinta'
                                : acabou
                                  ? 'cursor-not-allowed border-dashed border-borda text-xs font-semibold text-critico'
                                  : x.saldo <= 2
                                    ? 'border-borda bg-superficie text-atencao hover:border-marca/50'
                                    : 'border-borda bg-superficie text-tinta hover:border-marca/50',
                            )}
                          >
                            {acabou ? 'acabou' : x.saldo.toLocaleString('pt-BR')}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-1 text-xs text-tinta-3">O número é quanto tem nesta loja. Toque para escolher.</p>
          </div>
        )}

        {/* A escolha da variação — some quando ela já está feita e falta o peso. */}
        {!(pedeQuanto && peca) &&
          !usaMatriz &&
          eixos.map((e) => (
            <fieldset key={e.nome} className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold tracking-wide text-tinta-2 uppercase">{e.nome}</legend>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
                {e.opcoes.map((o) => {
                  // Tocável se existe peça com ela, dado o que se escolheu NOS
                  // OUTROS eixos — o próprio eixo pode trocar à vontade.
                  const outras = Object.fromEntries(Object.entries(escolhas).filter(([k]) => k !== e.nome))
                  const pode = possivel(variacoes, outras, e.nome, o.valor)
                  // Quando os OUTROS eixos já estão escolhidos (ou só existe
                  // este), o botão já é uma peça: mostra o preço e diz
                  // "acabou" antes do toque, e não depois.
                  const peca1 = acharVariacao(variacoes, { ...outras, [e.nome]: o.valor }) ?? undefined
                  const esgotada = peca1 ? peca1.saldo <= 0 : false
                  const marcada = escolhas[e.nome] === o.valor
                  return (
                    <button
                      key={o.valor}
                      type="button"
                      disabled={!pode || esgotada}
                      aria-pressed={marcada}
                      onClick={() => escolher(e.nome, o.valor)}
                      className={cx(
                        'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-center transition-colors',
                        marcada
                          ? 'border-marca bg-marca-suave text-tinta'
                          : 'border-borda bg-superficie text-tinta hover:border-marca/50 hover:bg-superficie-2',
                        'disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-45',
                      )}
                    >
                      <span className="flex items-center gap-2 text-base font-semibold">
                        {o.hex && (
                          <span
                            aria-hidden
                            className="size-4 shrink-0 rounded-full border border-borda"
                            style={{ background: o.hex }}
                          />
                        )}
                        {o.valor}
                        {marcada && (
                          <svg aria-hidden viewBox="0 0 16 16" className="size-4 text-marca" fill="none">
                            <path d="M3 8.5l3.2 3L13 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      {peca1 && (
                        <span className="numero text-xs text-tinta-3">
                          {esgotada ? 'acabou' : brl(precoDe({ ...peca1, quantidade: 1 }, tabela))}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}

        {semEixo && !peca && (
          <div className="grid gap-2">
            {variacoes.map((x) => (
              <button
                key={x.id}
                type="button"
                disabled={x.saldo <= 0}
                onClick={() => (pedeQuanto ? setPeca(x) : aoLancar(x, 1))}
                className="flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-borda px-4 text-left hover:border-marca/50 disabled:opacity-45"
              >
                <span className="font-semibold text-tinta">{x.descricao}</span>
                <span className="numero font-bold">{brl(precoDe({ ...x, quantidade: 1 }, tabela))}</span>
              </button>
            ))}
          </div>
        )}

        {/* O peso. O campo pega o foco sozinho — é a única coisa a fazer aqui —
            e Enter adiciona. */}
        {pedeQuanto && achada && (peca || variacoes.length === 0) && (
          <div className="flex flex-col gap-3">
            {peca && escolha.variacoes && escolha.variacoes.length > 1 && (
              <p className="text-sm text-tinta-2">
                <span className="font-semibold text-tinta">{rotuloDaVariacao(peca)}</span>{' '}
                <button type="button" onClick={() => setPeca(null)} className="font-semibold text-marca underline-offset-2 hover:underline">
                  trocar
                </button>
              </p>
            )}
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold tracking-wide text-tinta-2 uppercase">
                {escolha.medida === 'KG' || escolha.medida === 'G' ? 'Quanto pesou?' : 'Quanto?'}
              </span>
              <span className="flex items-center gap-3 rounded-2xl border-2 border-borda bg-superficie px-4 focus-within:border-marca">
                <input
                  data-foco-inicial
                  // No toque, o teclado grande de baixo é o teclado: o do
                  // sistema subiria por cima do "Adicionar".
                  inputMode={toque ? 'none' : 'decimal'}
                  value={quanto}
                  onChange={(e) => setQuanto(e.target.value.replace(/[^\d.,]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      adicionar()
                    }
                  }}
                  autoComplete="off"
                  placeholder={escolha.medida === 'KG' ? '0,350' : '0'}
                  aria-label={`Quantidade em ${un}`}
                  className="numero h-16 min-w-0 flex-1 bg-transparent text-3xl font-bold text-tinta placeholder:text-tinta-3/60 focus:outline-none focus-visible:outline-none!"
                />
                <span className="text-xl font-semibold text-tinta-3">{un}</span>
              </span>
            </label>

            {/* Os tamanhos da casa, num toque: o copo de 300 g da sorveteria,
                o quarto de quilo da padaria. Põe no campo — não lança: o
                "Adicionar" continua sendo a decisão. */}
            {teclas.length > 0 && (
              <div role="group" aria-label="Pesos prontos" className="grid grid-cols-4 gap-2">
                {teclas.map((t) => {
                  const valor = numeroNoCampo(t.valor)
                  return (
                    <button
                      key={t.rotulo}
                      type="button"
                      aria-pressed={quanto === valor}
                      onClick={() => setQuanto(valor)}
                      className={cx(
                        'numero min-h-12 touch-manipulation rounded-xl border-2 px-1 text-base font-semibold transition-colors',
                        quanto === valor
                          ? 'border-marca bg-marca-suave text-tinta'
                          : 'border-borda bg-superficie text-tinta hover:border-marca/50 hover:bg-superficie-2',
                      )}
                    >
                      {t.rotulo}
                    </button>
                  )
                })}
              </div>
            )}

            {toque && (
              <div role="group" aria-label="Teclado" className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'apagar'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setQuanto((q) => digitarNoPeso(q, k))}
                    aria-label={k === 'apagar' ? 'Apagar' : k === ',' ? 'Vírgula' : k}
                    className="numero flex min-h-14 touch-manipulation items-center justify-center rounded-xl bg-superficie-2 text-2xl font-bold text-tinta select-none active:scale-[0.97] active:bg-superficie-3"
                  >
                    {k === 'apagar' ? (
                      <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none">
                        <path
                          d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6 5-6ZM12 10l4 4M16 10l-4 4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      k
                    )}
                  </button>
                ))}
              </div>
            )}

            {pesa && <LerBalanca aoPesar={(kg) => setQuanto(pesoNoCampo(kg, escolha.medida))} />}
            {achada.saldo <= 0 && <Situacao nivel="critico">acabou nesta loja</Situacao>}
          </div>
        )}
      </div>
    </Folha>
  )
}
