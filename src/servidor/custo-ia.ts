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

// ─────────────────────────────────────────────────────────────
// CACHE — o fator que decide se o agente e viavel
// ─────────────────────────────────────────────────────────────
//
// Numero medido em producao, num assistente do mesmo tipo: R$ 120 a R$ 150 de
// credito duravam de quatro a seis dias. Isso e R$ 25 a R$ 30 POR DIA, ou
// R$ 750 a R$ 900 por mes, de custo bruto, numa loja so.
//
// Custo assim quase nunca vem da RESPOSTA — vem da PERGUNTA. Cada mensagem
// reenvia a instrucao do agente, o catalogo, as regras da loja e o historico
// da conversa. Sao dezenas de milhares de tokens de entrada por turno, iguais
// aos do turno anterior, pagos de novo. A resposta tem duzentas palavras.
//
// O cache resolve exatamente esse pedaco: a parte que nao muda e gravada uma
// vez e relida por UM DECIMO do preco. Numa conversa de dez turnos, isso e a
// diferenca entre pagar dez vezes e pagar uma e meia.
//
// Por isso as tres entradas sao contadas separadas, e nao somadas numa so:
// somar esconde o unico numero que da para melhorar.
export const FATOR_CACHE = {
  /** Gravar no cache custa mais caro que ler normal — e o investimento. */
  escrita: 1.25,
  /** Reler custa um decimo. E aqui que o mes inteiro se decide. */
  leitura: 0.1,
} as const

export type Tokens = {
  entrada: number
  saida: number
  /** Tokens gravados no cache nesta chamada. */
  cacheEscrita?: number
  /** Tokens lidos do cache nesta chamada — os que nao foram cobrados cheios. */
  cacheLeitura?: number
}

/**
 * O que o fornecedor cobra da GENTE. É o custo, não o preço.
 *
 * Aceita o número solto de tokens (o jeito antigo) ou o detalhe com cache. O
 * primeiro continua valendo porque nem toda chamada usa cache.
 */
export function custoEmCentavos(
  modelo: string,
  entrada: number | Tokens,
  saida = 0,
): number {
  const p = PRECO_POR_MILHAO[modelo] ?? PRECO_POR_MILHAO['claude-sonnet-5']!
  const t: Tokens = typeof entrada === 'number' ? { entrada, saida } : entrada

  const bruto =
    t.entrada * p.entrada +
    t.saida * p.saida +
    (t.cacheEscrita ?? 0) * p.entrada * FATOR_CACHE.escrita +
    (t.cacheLeitura ?? 0) * p.entrada * FATOR_CACHE.leitura

  return Math.ceil(bruto / 1_000_000)
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
export function cobrancaEmCentavos(
  modelo: string,
  entrada: number | Tokens,
  saida = 0,
): number {
  const custo = custoEmCentavos(modelo, entrada, saida)
  if (custo <= 0) return 0
  return Math.max(MINIMO_POR_CHAMADA, Math.ceil(custo * MARGEM))
}
