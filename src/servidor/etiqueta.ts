// A etiqueta do PRODUTO, e não de cada tamanho.
//
// O Norte nasceu com um código por variação (CAM001 é a camiseta azul M), e a
// etiqueta impressa pelo Norte é assim. Mas muita loja chega de outro sistema
// com a etiqueta já pregada na peça e UM número para a grade inteira: a
// sandália 005990 em todos os números, o vestido 004410 em todos os tamanhos —
// o tamanho a vendedora vê na peça. Bipar 005990 tinha de achar a sandália.
//
// O jeito, sem mudar o banco: a variação leva o código da etiqueta seguido de
// hífen e do que a distingue — 005990-36, 005990-37, 004410-M-PRETO. O código
// da variação continua único (é ele que o leitor acha quando a etiqueta é por
// tamanho), e a etiqueta do produto acha todas as variações dele.
//
// Puro: o balcão (no navegador) e a busca (no servidor) usam as mesmas regras.

import type { Prisma } from '@prisma/client'

/** O que separa a etiqueta do produto do resto do código da variação. */
export const SEPARADOR_DA_ETIQUETA = '-'

const limpo = (s: string | null | undefined) => (s ?? '').trim().toUpperCase()

/** O código bate exatamente com o que foi digitado ou bipado (sem caixa). */
export function codigoExato(codigo: string | null | undefined, termo: string): boolean {
  const t = limpo(termo)
  return t.length > 0 && limpo(codigo) === t
}

/** A variação é da grade cuja etiqueta foi bipada: "005990-37" para "005990". */
export function daEtiqueta(codigo: string | null | undefined, termo: string): boolean {
  const t = limpo(termo)
  return t.length > 0 && limpo(codigo).startsWith(t + SEPARADOR_DA_ETIQUETA)
}

/**
 * O que o Enter da busca (ou o bipe do leitor) lança.
 *
 * - código exato: aquele item, como sempre foi;
 * - etiqueta de um produto com UMA variação à venda: ela;
 * - etiqueta de um produto com várias (o tamanho e a cor): NADA — lançar o
 *   primeiro da lista seria vender o 34 para quem levou o 37. A tela mostra a
 *   grade e a vendedora toca no certo; `varios` diz quantos;
 * - nada disso: o primeiro achado pelo nome, como antes.
 */
export function escolhaDoEnter<T extends { codigo: string | null }>(termo: string, itens: readonly T[]): { item: T | null; varios: number } {
  // Com o final AV/CA/CR da etiqueta antiga também (ver `termosDeCodigo`).
  const exato = itens.find((i) => proximidade(i.codigo, termo) === 0)
  if (exato) return { item: exato, varios: 0 }
  const grade = itens.filter((i) => proximidade(i.codigo, termo) === 1)
  if (grade.length === 1) return { item: grade[0]!, varios: 0 }
  if (grade.length > 1) return { item: null, varios: grade.length }
  return { item: itens[0] ?? null, varios: 0 }
}

// ── o código pela metade, e o final do sistema antigo ────────
// No balcão de onde a loja veio, a vendedora acha a peça digitando um PEDAÇO
// da etiqueta ("56522" acha 0056522) ou a referência do fornecedor que está na
// caixa. E algumas etiquetas antigas têm o tipo de preço grudado no fim —
// 0056522AV (à vista), CA (cartão), CR (crediário). O Norte acha igual.

/** O final que o sistema antigo pregava na etiqueta para dizer o preço. */
const FINAL_DO_PRECO = /^(.*\d)\s*(AV|CA|CR)$/i

/** Os códigos a procurar: o digitado e, se ele termina em AV/CA/CR, ele sem o final. */
export function termosDeCodigo(termo: string): string[] {
  const t = limpo(termo)
  if (!t) return []
  const semFinal = FINAL_DO_PRECO.exec(t)?.[1]
  return semFinal ? [t, semFinal] : [t]
}

/**
 * Pedaço que vale procurar DENTRO do código: 3 caracteres ou mais e com algum
 * número. "cal" é começo de nome (calça), não de etiqueta — e procurar "12"
 * dentro de todos os códigos traria meio catálogo.
 */
export function pedacoDeCodigo(termo: string): boolean {
  const t = limpo(termo)
  return t.length >= 3 && /\d/.test(t)
}

/** Quão perto o código está do digitado: 0 exato, 1 da grade, 2 começa, 3 contém, null não bate. */
export function proximidade(codigo: string | null | undefined, termo: string): number | null {
  const c = limpo(codigo)
  if (!c) return null
  let melhor: number | null = null
  for (const t of termosDeCodigo(termo)) {
    const p =
      c === t ? 0
      : c.startsWith(t + SEPARADOR_DA_ETIQUETA) ? 1
      : pedacoDeCodigo(t) && c.startsWith(t) ? 2
      : pedacoDeCodigo(t) && c.includes(t) ? 3
      : null
    if (p !== null && (melhor === null || p < melhor)) melhor = p
  }
  return melhor
}

/** O código bate com o digitado de algum dos jeitos acima. */
export function codigoBate(codigo: string | null | undefined, termo: string): boolean {
  return proximidade(codigo, termo) !== null
}

/**
 * O mesmo, como filtro do banco para a VARIAÇÃO. `estrito` fica só no exato,
 * no de barras e na grade da etiqueta — é a primeira passada do balcão, que
 * não pode ser engolida por cem códigos que só CONTÊM o pedaço.
 */
export function ondeOCodigo(termo: string, estrito = false) {
  const ou: Prisma.VariacaoWhereInput[] = []
  for (const t of termosDeCodigo(termo)) {
    ou.push(
      { codigo: { equals: t, mode: 'insensitive' as const } },
      { codigoBarras: t },
      { codigo: { startsWith: t + SEPARADOR_DA_ETIQUETA, mode: 'insensitive' as const } },
    )
    if (!estrito && pedacoDeCodigo(t)) ou.push({ codigo: { contains: t, mode: 'insensitive' as const } })
  }
  return ou
}
