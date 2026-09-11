// Qual preço vale: à vista, no cartão ou no crediário.
//
// O produto tem três preços desde o primeiro dia (`precoVista`, `precoCartao`,
// `precoCrediario`) e o balcão só olhava o primeiro. Quem vende no cartão com
// preço de à vista está pagando a taxa da maquininha do próprio bolso, todo
// dia, sem saber — é a diferença entre os três que paga a taxa.
//
// ── a regra ──────────────────────────────────────────────────
// A FORMA DE PAGAMENTO escolhe a tabela. Dinheiro, Pix, débito, transferência
// e vale são "à vista": o dinheiro entra inteiro e na hora. Crédito é
// "cartão": entra menos e depois. Crediário é "crediário": entra em parcelas
// e com risco. Venda paga em duas formas usa a tabela MAIS CARA presente — se
// metade foi no crédito, a loja já pagou a taxa daquela metade, e cobrar à
// vista tudo seria dar o desconto de quem pagou à vista para quem não pagou.
//
// Puro, sem I/O: a mesma função roda no navegador (para a tela mostrar o
// preço certo enquanto a pessoa escolhe) e no servidor (que é quem decide).

import type { FormaPagamento } from '@prisma/client'

export type Tabela = 'vista' | 'cartao' | 'crediario'

export const TABELA_DA_FORMA: Record<FormaPagamento, Tabela> = {
  DINHEIRO: 'vista',
  PIX: 'vista',
  DEBITO: 'vista',
  TRANSFERENCIA: 'vista',
  VALE: 'vista',
  CREDITO: 'cartao',
  CREDIARIO: 'crediario',
}

const PESO: Record<Tabela, number> = { vista: 0, cartao: 1, crediario: 2 }

export const ROTULO_TABELA: Record<Tabela, string> = {
  vista: 'à vista',
  cartao: 'no cartão',
  crediario: 'no crediário',
}

/** A tabela que vale para este conjunto de formas. Sem forma nenhuma, à vista. */
export function tabelaDe(formas: readonly string[]): Tabela {
  let escolhida: Tabela = 'vista'
  for (const f of formas) {
    const t = TABELA_DA_FORMA[f as FormaPagamento]
    if (t && PESO[t] > PESO[escolhida]) escolhida = t
  }
  return escolhida
}

/** Os três preços de um item, já em centavos. Nulo = a loja não preencheu. */
export type Precos = { vista: number; cartao: number | null; crediario: number | null }

/**
 * O preço de tabela para uma tabela.
 *
 * Quem não preencheu o preço do crediário cobra o do cartão; quem não
 * preencheu o do cartão cobra o à vista. Nunca o contrário: o preço nunca cai
 * por falta de cadastro, só sobe quando a loja mandou.
 */
export function precoNaTabela(p: Precos, t: Tabela): number {
  if (t === 'crediario') return p.crediario ?? p.cartao ?? p.vista
  if (t === 'cartao') return p.cartao ?? p.vista
  return p.vista
}

/** Os três preços preenchidos com a mesma regra — para a tela mostrar a escada. */
export function escada(p: Precos): Record<Tabela, number> {
  return {
    vista: precoNaTabela(p, 'vista'),
    cartao: precoNaTabela(p, 'cartao'),
    crediario: precoNaTabela(p, 'crediario'),
  }
}
