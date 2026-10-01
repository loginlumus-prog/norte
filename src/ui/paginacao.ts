// Lista grande em páginas.
//
// ── por que existe ───────────────────────────────────────────
// As telas de lista nasceram para a loja de bairro: duzentos produtos, cem
// clientes. Com o primeiro cliente de verdade (930 peças com 7 mil variações,
// 1.700 clientes, 8 mil parcelas de crediário) elas desenhavam TUDO: a tela de
// Estoque pesava 40 MB e levava mais de um minuto para abrir, e a de Produtos,
// 25 MB. E onde havia teto ele era mudo — os 500 primeiros clientes por ordem
// alfabética, e os números de cima ("devendo", "sumidos") contados só neles.
//
// A regra daqui: a CONTA é feita sobre a lista inteira (os números de cima
// continuam dizendo o quadro todo) e só o DESENHO é cortado em páginas. A
// página mora no endereço (`?pagina=3`), como todo filtro: dá para mandar o
// link, o F5 não perde, e trocar de filtro volta para a página 1 sozinho —
// porque o link do filtro não leva a página junto.
//
// Puro: sem banco e sem React, para o teste e para as duas pontas.

/** A página pedida no endereço. Qualquer coisa que não seja 1, 2, 3... vira 1. */
export function lerPagina(bruto: unknown): number {
  const s = Array.isArray(bruto) ? bruto[0] : bruto
  if (typeof s !== 'string' && typeof s !== 'number') return 1
  const n = Number(s)
  return Number.isSafeInteger(n) && n >= 1 ? n : 1
}

export type Pagina = {
  /** A página que vale (a pedida, presa entre 1 e a última). */
  pagina: number
  paginas: number
  total: number
  /** Posição do primeiro e do último item desta página, contando de 1. Zero quando vazia. */
  de: number
  ate: number
  /** Para o banco: quantos pular e quantos trazer. */
  pular: number
  trazer: number
}

/**
 * A página de uma lista de `total` itens. Pedir a página 40 de uma lista de 3
 * dá a última — o link velho (a lista encolheu depois de um filtro, ou de uma
 * venda) não pode abrir uma tela vazia dizendo "nada aqui".
 */
export function paginar(total: number, pedida: number, porPagina: number): Pagina {
  const tamanho = Math.max(1, Math.floor(porPagina))
  const t = Math.max(0, Math.floor(total))
  const paginas = Math.max(1, Math.ceil(t / tamanho))
  const pagina = Math.min(Math.max(1, Math.floor(pedida) || 1), paginas)
  const pular = (pagina - 1) * tamanho
  const ate = Math.min(pular + tamanho, t)
  return { pagina, paginas, total: t, de: t === 0 ? 0 : pular + 1, ate, pular, trazer: tamanho }
}

/** A lista já em memória, cortada na página pedida. */
export function fatiar<T>(lista: readonly T[], pedida: number, porPagina: number): Pagina & { itens: T[] } {
  const p = paginar(lista.length, pedida, porPagina)
  return { ...p, itens: lista.slice(p.pular, p.pular + p.trazer) }
}

/**
 * Os números de página que aparecem: a primeira, a última e duas de cada lado
 * da atual; `null` é o "…" entre eles. Com cem páginas, cem links seriam uma
 * parede — e ninguém pula da 3 para a 71 sem buscar.
 */
export function vizinhas(pagina: number, paginas: number): (number | null)[] {
  const quer = new Set([1, paginas, pagina - 2, pagina - 1, pagina, pagina + 1, pagina + 2].filter((n) => n >= 1 && n <= paginas))
  const ordem = [...quer].sort((a, b) => a - b)
  const saida: (number | null)[] = []
  for (const [i, n] of ordem.entries()) {
    if (i > 0 && n - ordem[i - 1]! > 1) saida.push(null)
    saida.push(n)
  }
  return saida
}
