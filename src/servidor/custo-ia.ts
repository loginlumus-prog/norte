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

export function custoEmCentavos(modelo: string, entrada: number, saida: number): number {
  const p = PRECO_POR_MILHAO[modelo] ?? PRECO_POR_MILHAO['claude-sonnet-5']!
  return Math.ceil((entrada * p.entrada + saida * p.saida) / 1_000_000)
}
