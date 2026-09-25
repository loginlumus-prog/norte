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

// ─────────────────────────────────────────────────────────────
// QUEM PODE DECIDIR SOBRE O PRODUTO
// ─────────────────────────────────────────────────────────────
//
// ── o defeito que isto fecha ─────────────────────────────────
// O cadastro é um só para a empresa inteira. O gerente da loja Centro abria
// a camiseta vendida em TODAS as lojas, baixava o preço, desmarcava o
// Shopping — e o balcão do Shopping mudava sem ninguém de lá ter decidido.
// A capacidade `produto.preco` dele vale na loja dele; o produto não é só
// dela.
//
// ── a regra ──────────────────────────────────────────────────
// Mexer no que vale para todas as lojas onde o produto é vendido — preço,
// custo, "Vendido em", medida, situação e grade — exige alcançar CADA uma
// dessas lojas. `vendidoEm` vazio quer dizer "todas, inclusive as que
// abrirem", e isso só quem responde pela empresa inteira alcança (o dono).
// Nome, marca, descrição, categoria e prazo continuam com quem edita produto.

/** Onde a pessoa pode isso: 'todas' (acesso sem loja) ou a lista das lojas dela. */
export type Alcance = 'todas' | readonly string[]

/** O que as duas capacidades alcançam juntas — a ficha pede as duas. */
export function alcanceComum(a: Alcance, b: Alcance): Alcance {
  if (a === 'todas') return b
  if (b === 'todas') return a
  return a.filter((u) => b.includes(u))
}

/** Esta loja está ao alcance? */
export function alcancaLoja(alcance: Alcance, unidadeId: string): boolean {
  return alcance === 'todas' || alcance.includes(unidadeId)
}

/**
 * Quem tem este alcance pode decidir por TODAS as lojas onde o produto é
 * vendido? Vazio = todas, inclusive as futuras: só a empresa inteira alcança.
 */
export function alcancaOProduto(alcance: Alcance, vendidoEm: readonly string[] | null | undefined): boolean {
  if (alcance === 'todas') return true
  if (!vendidoEm || vendidoEm.length === 0) return false
  return vendidoEm.every((u) => alcance.includes(u))
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

/**
 * O "Vendido em" que a ficha pede, para quem NÃO responde pela empresa
 * inteira.
 *
 * As lojas fora do alcance ficam como estavam — a tela as mostra travadas, e
 * o que o navegador mandar sobre elas é ignorado. Nunca vira vazio ("todas"):
 * vazio incluiria as lojas que abrirem depois, e essas ninguém de uma loja só
 * alcança. Se o conjunto final é o mesmo de antes, devolve o valor de antes
 * intacto — assim "vendido em todas" continua vazio quando o gerente só
 * corrigiu o nome.
 *
 * `antes` nulo = produto novo.
 */
export function vendidoEmDoGerente(
  marcadas: readonly string[],
  antes: readonly string[] | null,
  lojasAtivas: readonly string[],
  alcance: readonly string[],
): string[] {
  const escolhidas = lojasAtivas.filter((u) =>
    alcance.includes(u) ? marcadas.includes(u) : antes !== null && vendidoNaLoja(antes, u),
  )
  if (antes !== null) {
    const antesEfetivo = lojasAtivas.filter((u) => vendidoNaLoja(antes, u))
    if (mesmaLista(escolhidas, antesEfetivo)) return [...antes]
    // Loja fechada que estava na lista continua nela: não é desta pessoa tirar.
    const fechadas = antes.filter((u) => !lojasAtivas.includes(u))
    return [...escolhidas, ...fechadas].sort()
  }
  return escolhidas.sort()
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
