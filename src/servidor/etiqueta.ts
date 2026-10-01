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
  const exato = itens.find((i) => codigoExato(i.codigo, termo))
  if (exato) return { item: exato, varios: 0 }
  const grade = itens.filter((i) => daEtiqueta(i.codigo, termo))
  if (grade.length === 1) return { item: grade[0]!, varios: 0 }
  if (grade.length > 1) return { item: null, varios: grade.length }
  return { item: itens[0] ?? null, varios: 0 }
}
