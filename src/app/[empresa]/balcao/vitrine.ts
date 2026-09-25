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

/**
 * As iniciais do cartão sem foto: "Sorvete a granel" → "SG", "Açaí" → "AÇ".
 *
 * Duas letras e não uma: com uma só, "Picolé" e "Pote" viram o mesmo "P", e a
 * inicial deixa de servir para achar de longe.
 */
export function iniciais(nome: string): string {
  const palavras = nome
    .trim()
    .split(/[\s\-—/]+/)
    .filter((p) => p && !MIUDAS.has(p.toLowerCase()))
  const [a, b] = palavras
  if (!a) return '?'
  if (!b) return a.slice(0, 2).toLocaleUpperCase('pt-BR')
  return (a.charAt(0) + b.charAt(0)).toLocaleUpperCase('pt-BR')
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
