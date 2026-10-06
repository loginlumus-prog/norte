// O balcão sem internet.
//
// Sorveteria no pico não pode parar porque a internet caiu. O que este
// arquivo guarda NO APARELHO, para a tela que já está aberta seguir vendendo:
//
// 1. O CATÁLOGO da loja (IndexedDB): baixado em segundo plano quando há
//    internet, a cada meia hora no máximo. Sem internet, a vitrine e a busca
//    saem dele — com o preço e o saldo de quando foi baixado.
//
// 2. A FILA de vendas feitas sem internet (localStorage): cada venda com a
//    chave que o servidor usa para não gravar duas vezes (ver `Venda.chave`),
//    a hora em que aconteceu e o pedido inteiro. Quando a conexão volta, a
//    fila sobe sozinha, venda por venda, como "offline" — o servidor grava com
//    a hora de verdade, não trava por estoque (a peça já saiu) e confere o
//    resto como sempre. Venda que o servidor recusar fica na fila, à vista,
//    com o motivo, até alguém resolver.
//
// O que NÃO vai para a fila: crediário, vale, pontos, PIN, encomenda e
// horário da agenda. Todos dependem de conferir no servidor NA HORA (o saldo
// do vale, a ficha da cliente, o PIN) — prometer isso sem internet seria
// prometer o que pode voltar recusado com a cliente já longe.

import type { Achado } from './acoes'
import type { ProdutoNaVitrine } from './vitrine'

// ─────────────────────────────────────────────────────────────
// A FILA
// ─────────────────────────────────────────────────────────────

export type VendaNaFila = {
  chave: string
  unidadeId: string
  /** Quando aconteceu (ms). */
  quando: number
  total: number
  /** "3 itens · Dinheiro" — o que a tela mostra na fila. */
  resumo: string
  /** O pedido como `fecharVenda` recebe (sem chave nem offline — vão na hora de subir). */
  dados: Record<string, unknown>
  /** O servidor recusou: o motivo, para alguém resolver. */
  erro?: string
}

const chaveDaFila = (slug: string) => `norte:fila:${slug}`

/** O servidor disse que um preço mudou: a vitrine aberta se renova. */
export const EVENTO_CATALOGO_MUDOU = 'norte:catalogo-mudou'

export function lerFila(slug: string): VendaNaFila[] {
  try {
    const cru = localStorage.getItem(chaveDaFila(slug))
    const l = cru ? (JSON.parse(cru) as VendaNaFila[]) : []
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}

function gravarFila(slug: string, l: VendaNaFila[]) {
  try {
    if (l.length === 0) localStorage.removeItem(chaveDaFila(slug))
    else localStorage.setItem(chaveDaFila(slug), JSON.stringify(l))
  } catch {
    // Sem onde guardar não há fila: a tela avisa ao tentar pôr (ver `porNaFila`).
  }
}

/** Põe na fila. Devolve false se o aparelho não deixou guardar. */
export function porNaFila(slug: string, v: VendaNaFila): boolean {
  const l = lerFila(slug).filter((x) => x.chave !== v.chave)
  l.push(v)
  gravarFila(slug, l)
  return lerFila(slug).some((x) => x.chave === v.chave)
}

export function tirarDaFila(slug: string, chave: string) {
  gravarFila(slug, lerFila(slug).filter((x) => x.chave !== chave))
}

export function marcarErro(slug: string, chave: string, erro: string | undefined) {
  gravarFila(slug, lerFila(slug).map((x) => (x.chave === chave ? { ...x, erro } : x)))
}

/** As formas que vendem sem internet: as que não dependem de conferir nada no servidor. */
export const FORMAS_SEM_INTERNET = new Set(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'])

export function podeIrParaFila(p: {
  pagamentos: { forma: string }[]
  pontosUsar?: number
  pin?: string | null
  encomendaId?: string | null
  agendamentoId?: string | null
}): boolean {
  return (
    p.pagamentos.length > 0 &&
    p.pagamentos.every((x) => FORMAS_SEM_INTERNET.has(x.forma)) &&
    !p.pontosUsar &&
    !p.pin &&
    !p.encomendaId &&
    !p.agendamentoId
  )
}

/** Uma chave nova para uma venda. */
export function novaChave(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

/** O erro foi de rede (sem internet, servidor fora), e não uma recusa do servidor? */
export function semConexao(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// ─────────────────────────────────────────────────────────────
// O CATÁLOGO NO APARELHO
// ─────────────────────────────────────────────────────────────

type Guardado = {
  salvoEm: number
  categorias: { id: string; nome: string }[] | null
  produtos: ProdutoNaVitrine[]
}

const BANCO = 'norte-balcao'
const LOJA = 'catalogo'

function abrir(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open(BANCO, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(LOJA)
      r.onsuccess = () => ok(r.result)
      r.onerror = () => ok(null)
    } catch {
      ok(null)
    }
  })
}

async function lerCatalogo(chave: string): Promise<Guardado | null> {
  const db = await abrir()
  if (!db) return null
  return new Promise((ok) => {
    try {
      const r = db.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave)
      r.onsuccess = () => ok((r.result as Guardado | undefined) ?? null)
      r.onerror = () => ok(null)
    } catch {
      ok(null)
    }
  })
}

async function gravarCatalogo(chave: string, g: Guardado) {
  const db = await abrir()
  if (!db) return
  await new Promise<void>((ok) => {
    try {
      const t = db.transaction(LOJA, 'readwrite')
      t.objectStore(LOJA).put(g, chave)
      t.oncomplete = () => ok()
      t.onerror = () => ok()
    } catch {
      ok()
    }
  })
}

const chaveDoCatalogo = (slug: string, unidadeId: string) => `${slug}:${unidadeId}`
const MEIA_HORA = 30 * 60_000
const baixando = new Set<string>()

/**
 * Baixa o catálogo inteiro da loja, em segundo plano, se o guardado tem mais
 * de meia hora. Página por página, pela MESMA vitrine da tela.
 */
export async function baixarCatalogo(
  slug: string,
  unidadeId: string,
  vitrine: (pular: number) => Promise<{ categorias: { id: string; nome: string }[] | null; produtos: ProdutoNaVitrine[]; mais: boolean }>,
  forcar = false,
) {
  const k = chaveDoCatalogo(slug, unidadeId)
  if (baixando.has(k)) return
  const ja = await lerCatalogo(k)
  if (!forcar && ja && Date.now() - ja.salvoEm < MEIA_HORA) return
  baixando.add(k)
  try {
    const produtos: ProdutoNaVitrine[] = []
    let categorias: Guardado['categorias'] = null
    for (let pagina = 0; pagina < 200; pagina++) {
      const r = await vitrine(produtos.length)
      if (pagina === 0) categorias = r.categorias
      produtos.push(...r.produtos)
      if (!r.mais) break
    }
    await gravarCatalogo(k, { salvoEm: Date.now(), categorias, produtos })
  } catch {
    // Caiu no meio: fica o que já estava guardado.
  } finally {
    baixando.delete(k)
  }
}

/** A vitrine pelo catálogo guardado. Nulo = não há nada guardado desta loja. */
export async function vitrineGuardada(
  slug: string,
  unidadeId: string,
  categoriaId: string | null,
  pular: number,
): Promise<{ categorias: { id: string; nome: string }[] | null; produtos: ProdutoNaVitrine[]; mais: boolean } | null> {
  const g = await lerCatalogo(chaveDoCatalogo(slug, unidadeId))
  if (!g) return null
  const todos = categoriaId ? g.produtos.filter((p) => p.categoriaId === categoriaId) : g.produtos
  const POR_PAGINA = 36
  return { categorias: pular === 0 ? g.categorias : null, produtos: todos.slice(pular, pular + POR_PAGINA), mais: todos.length > pular + POR_PAGINA }
}

const solto = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * A busca pelo catálogo guardado: pelo código (inteiro ou um pedaço com
 * número) e pelo nome (todas as palavras). Mais simples que a do servidor,
 * e basta para achar o picolé sem internet.
 */
export async function procurarGuardado(slug: string, unidadeId: string, termo: string): Promise<Achado[] | null> {
  const g = await lerCatalogo(chaveDoCatalogo(slug, unidadeId))
  if (!g) return null
  const t = solto(termo.trim())
  if (t.length < 2) return []
  const palavras = t.split(/\s+/).filter(Boolean)
  const temNumero = /\d/.test(t)
  const achados: { a: Achado; nota: number }[] = []
  for (const p of g.produtos) {
    const nome = solto(p.nome)
    for (const v of p.variacoes) {
      const codigo = solto(v.codigo ?? '')
      const nota =
        codigo && codigo === t ? 0
        : codigo && temNumero && codigo.startsWith(t) ? 1
        : codigo && temNumero && codigo.includes(t) ? 2
        : palavras.every((w) => nome.includes(w) || solto(v.descricao).includes(w)) ? 3
        : -1
      if (nota >= 0) {
        const { opcoes: _o, ...achado } = v
        achados.push({ a: achado as Achado, nota })
      }
    }
  }
  return achados.sort((x, y) => x.nota - y.nota).slice(0, 40).map((x) => x.a)
}
