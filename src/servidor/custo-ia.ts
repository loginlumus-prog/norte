// Quanto custa uma conversa com o agente.
//
// Puro de propósito, e num arquivo só dele: é o número que decide se a
// mensalidade fecha. Um cliente que conversa muito pode consumir mais IA do
// que paga, e sem medir isso ninguém percebe até o fim do trimestre.

/**
 * Preço por milhão de tokens, em centavos de real.
 *
 * Fica aqui, e não escondido no adaptador, porque é o número que decide se a
 * mensalidade fecha. Um cliente que conversa muito pode consumir mais do que
 * paga, e sem medir isso ninguém percebe até o fim do trimestre.
 *
 * Atualizar quando a tabela do fornecedor mudar ou o câmbio andar muito.
 */
export const PRECO_POR_MILHAO: Record<string, { entrada: number; saida: number }> = {
  'claude-sonnet-5': { entrada: 1800, saida: 9000 },
  'claude-haiku-4-5-20251001': { entrada: 500, saida: 2500 },
  'claude-opus-5': { entrada: 9000, saida: 45000 },
}

/** O que o fornecedor cobra da GENTE. É o custo, não o preço. */
export function custoEmCentavos(modelo: string, entrada: number, saida: number): number {
  const p = PRECO_POR_MILHAO[modelo] ?? PRECO_POR_MILHAO['claude-sonnet-5']!
  return Math.ceil((entrada * p.entrada + saida * p.saida) / 1_000_000)
}

// ─────────────────────────────────────────────────────────────
// O QUE A LOJA PAGA — que NÃO é o que o fornecedor cobra
// ─────────────────────────────────────────────────────────────
//
// Isto aqui é o número que faltava, e a falta dele fazia o sistema perder
// dinheiro em silêncio: a carteira do cliente era debitada pelo custo bruto
// da API, o que dá margem ZERO. E zero de margem é na verdade prejuízo,
// porque em cima disso ainda correm:
//
//   • a taxa do meio de pagamento em cada recarga
//   • chamada que falha e é repetida (paga duas vezes, cobra uma)
//   • o saldo que fica negativo na última chamada antes de acabar
//   • imposto sobre a receita
//
// ── por que multiplicador, e não preço próprio por modelo ────
// Tabela de preço própria por modelo é uma segunda tabela para manter em dia,
// e ela vai atrasar em relação à do fornecedor — é sempre o que acontece.
// Com multiplicador, atualizar o custo já atualiza o preço.
//
// ── e por que o custo continua guardado ──────────────────────
// As duas linhas ficam gravadas em cada chamada: o que o fornecedor cobrou e
// o que a loja pagou. Sem as duas, não dá para responder "quanto a gente
// ganha com IA?" — e essa é a pergunta que decide se o produto se sustenta.

/**
 * Quantas vezes o custo bruto. 3 é o piso saudável para revenda de API.
 *
 * NÚMERO COMERCIAL: quem decide é o dono do negócio, não o código. Está aqui
 * em um lugar só, com nome, para poder ser mudado sem procurar.
 */
export const MARGEM = 3

/** Mínimo por chamada, em centavos. Chamada de meio centavo não existe. */
export const MINIMO_POR_CHAMADA = 1

/** O que sai da carteira da loja. */
export function cobrancaEmCentavos(modelo: string, entrada: number, saida: number): number {
  const custo = custoEmCentavos(modelo, entrada, saida)
  if (custo <= 0) return 0
  return Math.max(MINIMO_POR_CHAMADA, Math.ceil(custo * MARGEM))
}
