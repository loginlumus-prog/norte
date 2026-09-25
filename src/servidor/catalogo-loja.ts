// Que produto é vendido em que loja.
//
// ── o problema que isto resolve ──────────────────────────────
// A mesma empresa pode ter uma loja de roupa e uma sorveteria. O catálogo é
// da empresa (o cadastro é um só, o estoque é por loja), e até 25/09 o balcão
// da sorveteria mostrava camisa e o da loja de roupa mostrava picolé. Não é
// só feio: é venda lançada na loja errada, estoque baixando onde não existe,
// e a moça do balcão procurando o açaí no meio de trezentas peças de roupa.
//
// ── a regra ──────────────────────────────────────────────────
// `Produto.vendidoEm` é a lista de lojas onde ele é vendido. VAZIA = todas.
// O vazio é o padrão de propósito: quem tem uma loja só nunca vê a pergunta,
// e a rede de roupa que abre a quarta loja já nasce vendendo o catálogo
// inteiro, que é o que ela quer.
//
// Este arquivo é PURO — sem banco, sem I/O — porque a mesma pergunta é feita
// no servidor (que decide) e na tela do balcão (que só mostra o que pode).

/** Este produto é vendido nesta loja? */
export function vendidoNaLoja(vendidoEm: readonly string[] | null | undefined, unidadeId: string): boolean {
  return !vendidoEm || vendidoEm.length === 0 || vendidoEm.includes(unidadeId)
}

/**
 * O pedaço de `where` do Prisma que deixa só o que a loja vende.
 *
 *   db.produto.findMany({ where: { ativo: true, ...soDaLoja(unidadeId) } })
 *   db.variacao.findMany({ where: { produto: soDaLoja(unidadeId) } })
 */
export function soDaLoja(unidadeId: string) {
  return {
    OR: [{ vendidoEm: { isEmpty: true } }, { vendidoEm: { has: unidadeId } }],
  }
}

/**
 * O que gravar a partir do que a pessoa marcou na ficha.
 *
 * Marcar TODAS as lojas ativas grava vazio, e não a lista inteira: senão a loja
 * que abrir amanhã ficaria de fora de um produto que a dona queria em todas.
 * Ids que não são lojas da empresa são descartados — o formulário vem do
 * navegador, e o navegador é do usuário.
 */
export function normalizarVendidoEm(marcadas: readonly string[], lojasAtivas: readonly string[]): string[] {
  const validas = [...new Set(marcadas)].filter((id) => lojasAtivas.includes(id))
  if (validas.length === 0 || validas.length === lojasAtivas.length) return []
  return validas.sort()
}
