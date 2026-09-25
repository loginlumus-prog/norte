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
 * Esta linha de saldo entra na conta do que ACABOU e do que está no mínimo?
 *
 * Linha zerada de produto que a loja não vende, não: é a sobra de uma
 * transferência de volta, de um balanço, de um produto que deixou de ser
 * vendido ali — e avisar "acabou" do que a loja nem vende é alarme falso que
 * ensina a ignorar o alarme. Linha com saldo entra sempre (é mercadoria de
 * verdade, e precisa aparecer para alguém tirar de lá). Depósito entra
 * sempre: ele não vende, mas é de onde as lojas repõem.
 *
 * A mesma régua está no SQL de `pendencias.ts`.
 */
export function contaComoFalta(
  linha: { quantidade: number; unidadeId: string; ehDeposito: boolean },
  vendidoEm: readonly string[] | null | undefined,
): boolean {
  return linha.quantidade > 0 || linha.ehDeposito || vendidoNaLoja(vendidoEm, linha.unidadeId)
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

const chaveDoNome = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/**
 * Em que lojas um produto NOVO desta categoria deve nascer marcado.
 *
 * A categoria "Picolé" é do ramo sorveteria; numa empresa de roupa que abriu
 * uma sorveteria, o picolé novo nasce marcado só nela — e a camiseta nova, da
 * categoria "Blusas", só nas lojas de roupa. É sugestão: a pessoa desmarca ou
 * marca o que quiser antes de salvar.
 *
 * Devolve `[]` (= todas) quando a categoria não é de ramo nenhum, quando
 * nenhuma loja é do ramo dela ou quando todas são — nesses casos não há o que
 * separar. A loja sem ramo próprio vale pelo ramo da empresa.
 */
export function lojasSugeridas(
  nomeCategoria: string | null | undefined,
  lojas: { id: string; ramo: string | null }[],
  ramoDaEmpresa: string | null,
  categoriasDoRamo: Record<string, readonly string[]>,
): string[] {
  if (!nomeCategoria) return []
  const alvo = chaveDoNome(nomeCategoria)
  const donos = Object.entries(categoriasDoRamo)
    .filter(([, cats]) => cats.some((c) => chaveDoNome(c) === alvo))
    .map(([r]) => r)
  if (donos.length === 0) return []
  const marcadas = lojas.filter((l) => donos.includes(l.ramo ?? ramoDaEmpresa ?? '')).map((l) => l.id)
  return marcadas.length === 0 || marcadas.length === lojas.length ? [] : marcadas.sort()
}
