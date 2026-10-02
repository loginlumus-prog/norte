// A última loja escolhida, lembrada por empresa.
//
// O endereço continua mandando: `?unidade=` no link vale para quem abrir o
// link, do jeito que o gerente mandou para o dono. O que este arquivo resolve
// é o CLIQUE NO MENU. Os links do menu (e o "voltar à lista" de cada tela)
// não levam a loja, e cada clique caía de volta em "Todas as unidades": o
// dono escolhia a loja do shopping no Estoque, ia para Produtos e via a rede
// inteira. Sem nada no endereço, vale a última escolha feita no seletor.
//
// Mora num arquivo sem banco porque o seletor (no navegador) escreve e o
// servidor lê — os dois precisam do mesmo nome de cookie.

/** O valor que guarda "Todas as unidades": a escolha do consolidado também é lembrada. */
export const TODAS_AS_UNIDADES = 'todas'

/**
 * O nome do cookie. Ele já mora no caminho da empresa (`path=/exemplo`), como
 * o da sessão; o nome também leva o endereço para um cookie solto em `/` nunca
 * valer por outra empresa.
 */
export const cookieDaUnidade = (slug: string) => `norte_unidade_${slug}`

/** Um ano: é uma preferência do aparelho, não uma credencial. */
export const UNIDADE_LEMBRADA_SEG = 365 * 24 * 60 * 60

/**
 * O que a tela deve tentar abrir: o que veio no endereço; sem nada no
 * endereço, o que foi lembrado. A conferência de que a pessoa alcança essa
 * unidade é de quem chama (`escolherUnidade`) — o cookie é do navegador e
 * pode trazer qualquer coisa.
 */
export function pedidaOuLembrada(pedida: string | undefined, lembrada: string | undefined): string | undefined {
  if (pedida) return pedida
  if (!lembrada || lembrada.length > 64) return undefined
  return lembrada
}
