// A vitrine do balcão simples, sem tela: agrupar, escolher, dar cara.
//
// ── por que o simples mostra PRODUTO, e a grade avançada mostra variação ──
// A grade de antes põe um botão por variação: "Camiseta — P · Preta",
// "Camiseta — M · Preta"… Numa sorveteria isso não pesa (picolé não tem
// tamanho), mas numa loja de roupa vira sessenta botões quase iguais, e a
// pessoa lê em vez de tocar. No simples, o cartão é do PRODUTO; se ele varia,
// o toque abre a escolha — primeiro o tamanho, depois a cor, em cartões grandes.
// Um toque a mais só para quem varia, e a vitrine fica do tamanho do cardápio.
//
// Funções puras: os testes rodam este arquivo direto.

import type { Achado } from './acoes'
import type { Tabela } from '@/servidor/preco'
// Relativo, e não '@/': os testes rodam este arquivo direto, sem o atalho.
import { SEPARADOR_DA_ETIQUETA } from '../../../servidor/etiqueta'

export type OpcaoDaVariacao = {
  eixo: string
  /** A ordem do eixo na empresa: "Tamanho" antes de "Cor", se foi assim que ela cadastrou. */
  eixoOrdem: number
  valor: string
  ordem: number
  /** Cor de verdade da peça, quando o eixo é de cor. Vem do cadastro, não de nós. */
  hex: string | null
}

export type VariacaoNaVitrine = Achado & { opcoes: OpcaoDaVariacao[] }

export type ProdutoNaVitrine = {
  id: string
  nome: string
  medida: string
  categoriaId: string | null
  variacoes: VariacaoNaVitrine[]
}

export type Eixo = { nome: string; opcoes: { valor: string; hex: string | null }[] }

/** Os eixos que as variações usam, na ordem do cadastro, sem repetir opção. */
export function eixosDe(variacoes: VariacaoNaVitrine[]): Eixo[] {
  const mapa = new Map<string, { ordem: number; opcoes: Map<string, { ordem: number; hex: string | null }> }>()
  for (const v of variacoes) {
    for (const o of v.opcoes) {
      let e = mapa.get(o.eixo)
      if (!e) {
        e = { ordem: o.eixoOrdem, opcoes: new Map() }
        mapa.set(o.eixo, e)
      }
      if (!e.opcoes.has(o.valor)) e.opcoes.set(o.valor, { ordem: o.ordem, hex: o.hex })
    }
  }
  return [...mapa.entries()]
    .sort((a, b) => a[1].ordem - b[1].ordem || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([nome, e]) => ({
      nome,
      opcoes: [...e.opcoes.entries()]
        .sort((a, b) => a[1].ordem - b[1].ordem || a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
        .map(([valor, x]) => ({ valor, hex: x.hex })),
    }))
}

export type Escolhas = Record<string, string>

const combina = (v: VariacaoNaVitrine, escolhas: Escolhas) =>
  Object.entries(escolhas).every(([eixo, valor]) =>
    v.opcoes.some((o) => o.eixo === eixo && o.valor === valor),
  )

/**
 * Existe peça com esta opção, dado o que já foi escolhido?
 *
 * É o que apaga o "GG" quando a pessoa já tocou em "Rosa" e não existe GG
 * rosa. Opção que leva a lugar nenhum não pode ser tocável: é o erro que a
 * gente evita antes de acontecer, em vez de explicar depois.
 */
export function possivel(
  variacoes: VariacaoNaVitrine[],
  escolhas: Escolhas,
  eixo: string,
  valor: string,
): boolean {
  const com = { ...escolhas, [eixo]: valor }
  return variacoes.some((v) => combina(v, com))
}

/** A peça escolhida, quando todos os eixos têm resposta. Antes disso, nula. */
export function acharVariacao(
  variacoes: VariacaoNaVitrine[],
  escolhas: Escolhas,
): VariacaoNaVitrine | null {
  const eixos = eixosDe(variacoes)
  if (eixos.some((e) => !escolhas[e.nome])) return null
  return variacoes.find((v) => combina(v, escolhas)) ?? null
}

/**
 * Menor e maior preço entre as variações — o cartão diz "a partir de". Na
 * tabela da forma escolhida: tocou em Crédito, o cartão mostra o preço no
 * cartão, igual ao que a linha do pedido vai cobrar.
 */
export function faixaDePreco(variacoes: Achado[], tabela: Tabela = 'vista'): { de: number; ate: number } {
  if (variacoes.length === 0) return { de: 0, ate: 0 }
  const ps = variacoes.map((v) => v.precos?.[tabela] ?? v.preco)
  return { de: Math.min(...ps), ate: Math.max(...ps) }
}

export const saldoTotal = (variacoes: Achado[]) => variacoes.reduce((s, v) => s + Math.max(v.saldo, 0), 0)

/** "P · Preta", ou o nome inteiro quando a variação não tem opção. */
export const rotuloDaVariacao = (v: Achado & { opcoes?: OpcaoDaVariacao[] }) =>
  v.opcoes && v.opcoes.length > 0
    ? [...v.opcoes].sort((a, b) => a.eixoOrdem - b.eixoOrdem).map((o) => o.valor).join(' · ')
    : v.descricao

const MIUDAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'com', 'sem', 'no', 'na', 'em'])

/** As palavras que dão inicial: com letra, sem as miúdas, só as letras. "(P)" vira "P"; "+" e "800ml" saem. */
function palavrasDoNome(nome: string): string[] {
  return nome
    .trim()
    .split(/[\s\-—/]+/)
    .filter((p) => p && !MIUDAS.has(p.toLowerCase()))
    // Começa por número ("800ml", "2kg") é medida, não nome: "Copo 800ml"
    // virava "C8". Sem letra nenhuma ("+", "&", "(1)") também não serve.
    .filter((p) => /^[^\p{N}]*\p{L}/u.test(p))
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean)
}

/**
 * As iniciais do cartão sem foto: "Sorvete a granel" → "SG", "Açaí" → "AÇ".
 *
 * Duas letras e não uma: com uma só, "Picolé" e "Pote" viram o mesmo "P", e a
 * inicial deixa de servir para achar de longe. Só LETRAS: "Camiseta (P)"
 * dava "C(", e "Cabo + capa", "C+".
 */
export function iniciais(nome: string): string {
  return candidatasDeIniciais(nome)[0] ?? '?'
}

/** Da melhor para a pior: 1ª+2ª palavra, 1ª+3ª…, depois a 1ª com as letras de dentro. */
function candidatasDeIniciais(nome: string): string[] {
  const ps = palavrasDoNome(nome)
  const [a, ...resto] = ps
  if (!a) return []
  const up = (x: string) => x.toLocaleUpperCase('pt-BR')
  const saida: string[] = []
  if (resto.length === 0) saida.push(up(a.slice(0, 2)))
  for (const b of resto) saida.push(up(a.charAt(0) + b.charAt(0)))
  for (const b of resto) for (const ch of b.slice(1)) saida.push(up(a.charAt(0) + ch))
  for (const ch of a.slice(1)) saida.push(up(a.charAt(0) + ch))
  return [...new Set(saida)]
}

/**
 * As iniciais de uma grade inteira, sem repetir: dois cartões "AK" lado a
 * lado não se acham de longe. O primeiro fica com a melhor; quem empata
 * tenta a próxima candidata ("Água com gás" e "Água kids": AG, AK; "Açaí
 * kids" e "Açaí kiwi": AK, AI). Sem candidata livre, repete — melhor que
 * inventar letra que não está no nome.
 */
export function iniciaisDistintas(nomes: string[]): string[] {
  const usadas = new Set<string>()
  return nomes.map((nome) => {
    const cs = candidatasDeIniciais(nome)
    const livre = cs.find((c) => !usadas.has(c)) ?? cs[0] ?? '?'
    usadas.add(livre)
    return livre
  })
}

/**
 * O tom da categoria no cartão, pela ordem dela.
 *
 * O cadastro não tem cor de categoria nem foto de produto; o tom vem das
 * fichas do tema, então funciona no claro e no escuro, e é sempre o MESMO para
 * a mesma categoria — a pessoa aprende que "o laranja é picolé" sem ninguém
 * ensinar. Vermelho e verde ficam de fora: no balcão eles querem dizer
 * "acabou" e "concluído", e não podem virar enfeite.
 *
 * Nunca vai sozinho: o cartão tem as iniciais e o nome da categoria junto.
 */
export const TONS = ['--marca', '--sol', '--atencao-vivo', '--nav-3', '--marca-forte', '--sol-claro'] as const

export function tomDe(indice: number): (typeof TONS)[number] {
  if (indice < 0) return '--nav-3'
  return TONS[indice % TONS.length] ?? '--nav-3'
}

/**
 * Vende-se em pedaço? Quilo, litro, metro: aí o toque pergunta "quanto?"
 * antes de lançar, porque 1 kg de açaí por engano é o erro mais caro do balcão.
 * Unidade, par e caixa entram direto, um por toque.
 */
export const fracionado = (medida: string) => !['UN', 'PAR', 'CX'].includes(medida)

/** "kg", "l", "m" — o que vai do lado do número. */
export const UNIDADE: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'l', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

/** "Camiseta canelada — P · Preta" vira nome e detalhe, para a linha do pedido ter hierarquia. */
export function partesDaDescricao(descricao: string): { nome: string; detalhe: string | null } {
  const i = descricao.indexOf(' — ')
  if (i < 0) return { nome: descricao, detalhe: null }
  return { nome: descricao.slice(0, i), detalhe: descricao.slice(i + 3) }
}

export type MatrizDaGrade = {
  /** O primeiro eixo (Tamanho): uma linha por opção. */
  linhas: Eixo
  /** O segundo eixo (Cor): uma coluna por opção. */
  colunas: Eixo
  /** A peça de cada cruzamento; nulo onde a combinação não existe. */
  celulas: (VariacaoNaVitrine | null)[][]
}

/**
 * A grade de duas dimensões — tamanho nas linhas, cor nas colunas — com a peça
 * de cada cruzamento.
 *
 * É o jeito que a loja de roupa lê o estoque há décadas (a "grade" do
 * caderno): de uma olhada se vê que acabou o M preto e sobrou o M azul, antes
 * de tocar em nada. Só existe com DOIS eixos: com um, os botões já são a
 * grade; com três, a tabela não cabe numa folha de celular.
 */
export function matrizDaGrade(variacoes: VariacaoNaVitrine[]): MatrizDaGrade | null {
  const eixos = eixosDe(variacoes)
  if (eixos.length !== 2) return null
  // A cor vai nas colunas, com a bolinha no cabeçalho, e o tamanho nas
  // linhas — é como a grade de caderno se lê, seja qual for a ordem em que a
  // empresa cadastrou os eixos.
  const temCor = (e: Eixo) => e.opcoes.some((o) => o.hex)
  const [a, b] = eixos as [Eixo, Eixo]
  const [linhas, colunas] = temCor(a) && !temCor(b) ? [b, a] : [a, b]
  return {
    linhas,
    colunas,
    celulas: linhas.opcoes.map((l) =>
      colunas.opcoes.map(
        (c) => variacoes.find((v) => combina(v, { [linhas.nome]: l.valor, [colunas.nome]: c.valor })) ?? null,
      ),
    ),
  }
}

// ── a busca agrupada ─────────────────────────────────────────
// A busca acha VARIAÇÕES — 0056522 traz a bermuda no 36, no 38... no 48.
// Sete cartões "Bermuda Cargo — 36", "— 38" parecem sete produtos. A tela
// mostra o produto UMA vez, como a vitrine, e o tamanho se escolhe dentro.

export type BlocoDaBusca =
  | { tipo: 'peca'; achado: Achado }
  | { tipo: 'grade'; produto: ProdutoNaVitrine }

/**
 * Junta as variações do mesmo produto, na ordem em que a busca as trouxe (a
 * primeira de cada produto marca o lugar dele). Produto com uma variação só
 * achada continua cartão de peça — tocar já lança, sem folha de escolha.
 */
export function agruparAchados(achados: readonly Achado[]): BlocoDaBusca[] {
  const ordem: string[] = []
  const porProduto = new Map<string, Achado[]>()
  const soltos = new Map<string, Achado>()
  for (const a of achados) {
    const chave = a.grade?.produtoId ?? `peca:${a.id}`
    if (!porProduto.has(chave) && !soltos.has(chave)) ordem.push(chave)
    if (a.grade) porProduto.set(chave, [...(porProduto.get(chave) ?? []), a])
    else soltos.set(chave, a)
  }
  return ordem.map((chave): BlocoDaBusca => {
    const solto = soltos.get(chave)
    if (solto) return { tipo: 'peca', achado: solto }
    const grupo = porProduto.get(chave)!
    if (grupo.length === 1) return { tipo: 'peca', achado: grupo[0]! }
    const g = grupo[0]!.grade!
    return {
      tipo: 'grade',
      produto: {
        id: g.produtoId,
        nome: g.nome,
        medida: grupo[0]!.medida,
        categoriaId: g.categoriaId,
        variacoes: grupo.map((a) => ({ ...a, opcoes: a.grade?.opcoes ?? [] })),
      },
    }
  })
}

// ── o código no cartão ───────────────────────────────────────
// A vendedora tem a etiqueta na mão e o cartão na tela: o número igual nos
// dois é o que diz "é esta" sem ler o nome inteiro. Para a grade, é o número
// da ETIQUETA do produto (005990 de 005990-36, 005990-37 — ver
// servidor/etiqueta.ts), e não o de um tamanho qualquer.

/**
 * O código que o cartão mostra: o da peça, se é uma só; o da etiqueta comum,
 * se todas as variações começam pelo mesmo número antes do hífen. Códigos
 * soltos (SAP012, SAP013…) não têm etiqueta comum: o cartão não inventa uma.
 */
export function etiquetaDoProduto(codigos: readonly (string | null | undefined)[]): string | null {
  const limpos = codigos.map((c) => (c ?? '').trim()).filter(Boolean)
  // Variação sem código: a grade não tem etiqueta comum (e a peça única, nenhuma).
  if (limpos.length === 0 || limpos.length !== codigos.length) return null
  if (limpos.length === 1) return limpos[0]!
  const etiqueta = (c: string) => c.split(SEPARADOR_DA_ETIQUETA)[0]!.toUpperCase()
  const primeira = etiqueta(limpos[0]!)
  if (!primeira) return null
  return limpos.every((c) => etiqueta(c) === primeira) ? primeira : null
}

// ── tirar um do pedido ───────────────────────────────────────
// O clique direito no cartão (e o "−" no toque) desfaz o último toque naquele
// produto. Com P e M da mesma blusa no pedido, sai a última que ENTROU — é
// o "ih, não era esse" de quem tocou errado, e é ele que tem de ser desfeito.

type LinhaQueSai = { id: string; quantidade: number; medida: string; encomendaId?: string }

/**
 * O pedido com uma unidade a menos das peças `ids`, ou `null` se nenhuma
 * delas está no pedido. `recentes` são os ids na ordem em que foram lançados
 * (o mais novo por último); sem eles (pedido recuperado do aparelho), vale a
 * ordem do pedido. Peça a peso sai inteira: tirar "um quilo" de 0,350 kg não
 * existe. A encomenda nunca sai por aqui — ela não está na vitrine.
 */
export function tirarUmDoPedido<L extends LinhaQueSai>(
  carrinho: readonly L[],
  ids: readonly string[],
  recentes: readonly string[] = [],
): L[] | null {
  const alvo = new Set(ids)
  const candidatas = carrinho.filter((l) => alvo.has(l.id) && !l.encomendaId)
  if (candidatas.length === 0) return null
  const naOrdem = (id: string) => recentes.lastIndexOf(id)
  const linha = candidatas.reduce((ultima, l) => (naOrdem(l.id) >= naOrdem(ultima.id) ? l : ultima))
  if (fracionado(linha.medida) || linha.quantidade <= 1) return carrinho.filter((l) => l !== linha)
  return carrinho.map((l) => (l === linha ? { ...l, quantidade: l.quantidade - 1 } : l))
}
