// A conta da troca, pura: a tela mostra com a MESMA conta que o servidor grava.
//
// ── as quatro parcelas da conversa no balcão ─────────────────
//   volta     o que a cliente PAGOU pelas peças que voltaram (com o desconto
//             da compra, se houve — ver `valorDevolvidoCent`).
//   abatido   o que disso apaga o crediário em aberto DA PRÓPRIA COMPRA: peça
//             comprada fiado e ainda não paga não vira crédito, vira dívida a
//             menos (ver `abaterDoFiado` em devolucao.ts).
//   crédito   o que sobra para a troca: volta − abatido.
//   leva      o preço de hoje das peças novas, na tabela da forma de pagamento
//             da diferença (à vista quando o crédito cobre tudo).
//
// E o resultado é uma de três frases: "cliente paga R$ X", "vira vale R$ X"
// ou "sem diferença".
//
// Sem I/O e sem banco: este arquivo roda no navegador também.

import { multiplicar } from './dinheiro'
import { precoNaTabela, tabelaDe, type Precos, type Tabela } from './preco'

/**
 * O valor que volta por um item, em centavos: o preço pago × a quantidade,
 * ajustado pelo que a venda inteira teve de desconto. Para baixo, sempre — o
 * centavo quebrado fica com a loja, não vira vale.
 */
export function valorDevolvidoCent(precoUnitCent: number, quantidade: number, fatorPago: number): number {
  const cheio = multiplicar(precoUnitCent, quantidade)
  return Math.max(0, Math.floor(cheio * fatorPago))
}

/**
 * O valor que volta por uma linha da compra, em centavos: o que a linha
 * custou DEPOIS do desconto dado nela (o total do item, na proporção da
 * quantidade que volta), ajustado pelo desconto da compra inteira. Para
 * baixo, como `valorDevolvidoCent`.
 *
 * É esta, e não `valorDevolvidoCent` sobre o preço unitário, que a devolução
 * grava: o preço unitário é o de ANTES do desconto no item — a blusa de
 * R$ 100 vendida com R$ 20 de desconto na linha voltava R$ 100.
 */
export function valorDoItemCent(totalItemCent: number, vendido: number, quantidade: number, fatorPago: number): number {
  if (!(vendido > 0) || !(quantidade > 0) || !(totalItemCent > 0)) return 0
  // O epsilon segura o 8999,9999 que a vírgula flutuante faz de 9000.
  return Math.max(0, Math.floor(((totalItemCent * quantidade) / vendido) * fatorPago + 1e-6))
}

/**
 * Quanto de cada real das peças a cliente pagou: (total − juro − acréscimo) ÷
 * subtotal da compra, nunca mais que 1.
 *
 * O juro do crédito parcelado fica de fora — está no total, mas não é preço
 * de peça (quem estorna o parcelamento é a operadora). O ACRÉSCIMO também: ele
 * é de UMA peça (a etiqueta velha da blusa), mas a venda só guarda o total
 * dele, sem dizer de qual. Espalhado pelo fator, a saia de R$ 50 devolvida de
 * uma compra com R$ 30 de acréscimo na blusa voltava R$ 60 — a loja pagando
 * para receber a peça de volta. A regra: devolução nunca passa do que a peça
 * custou; o acréscimo fica com a loja (quem quer desfazer a compra inteira,
 * com o acréscimo, cancela a venda).
 */
export function fatorPago(subtotalCent: number, totalCent: number, jurosCent = 0, acrescimoCent = 0): number {
  if (!(subtotalCent > 0)) return 1
  return Math.max(0, Math.min(1, (totalCent - jurosCent - Math.max(0, acrescimoCent)) / subtotalCent))
}

/** A tabela de preço das peças novas: a da forma da diferença (o vale é à vista). */
export function tabelaDaTroca(formaDaDiferenca: string | null | undefined): Tabela {
  return tabelaDe(formaDaDiferenca ? ['VALE', formaDaDiferenca] : ['VALE'])
}

/** O preço de uma peça nova na tabela, já com o ajuste da variação. Centavos. */
export function precoDaPeca(precos: Precos, ajusteCent: number, tabela: Tabela): number {
  return precoNaTabela(precos, tabela) + ajusteCent
}

export type ContaDaTroca = {
  voltaCent: number
  abatidoCent: number
  creditoCent: number
  levaCent: number
  /** Quanto do crédito a venda nova usa. */
  usaCent: number
  /** O que a cliente paga além do crédito. */
  pagaCent: number
  /** O que sobra do crédito: o vale que ela leva no papel. */
  sobraCent: number
}

export function contaDaTroca(p: { voltaCent: number; fiadoAbertoCent: number; levaCent: number }): ContaDaTroca {
  const voltaCent = Math.max(0, Math.round(p.voltaCent))
  const abatidoCent = Math.min(Math.max(0, Math.round(p.fiadoAbertoCent)), voltaCent)
  const creditoCent = voltaCent - abatidoCent
  const levaCent = Math.max(0, Math.round(p.levaCent))
  const usaCent = Math.min(creditoCent, levaCent)
  return {
    voltaCent,
    abatidoCent,
    creditoCent,
    levaCent,
    usaCent,
    pagaCent: levaCent - usaCent,
    sobraCent: creditoCent - usaCent,
  }
}

/** A frase de baixo da conta. */
export function resultadoDaTroca(c: Pick<ContaDaTroca, 'pagaCent' | 'sobraCent'>): 'paga' | 'vale' | 'zero' {
  if (c.pagaCent > 0) return 'paga'
  if (c.sobraCent > 0) return 'vale'
  return 'zero'
}

/**
 * O preço digitado na troca sem a compra (a peça veio do sistema anterior)
 * pode virar vale? Só até a etiqueta MAIS CARA de hoje (vista, cartão ou
 * crediário, com o ajuste da variação). Antes o teto era cinco vezes ela —
 * contra o zero a mais —, e o preço digitado é dinheiro: R$ 500 por uma blusa
 * de R$ 129,90 virava R$ 500 de vale com a autorização de quem só viu o
 * número. Peça sem preço no cadastro não tem régua: recusa.
 */
export function precoSemCompraPareceErrado(digitadoCent: number, etiquetaMaisCaraCent: number): boolean {
  if (!(digitadoCent > 0)) return true
  if (!(etiquetaMaisCaraCent > 0)) return true
  return digitadoCent > etiquetaMaisCaraCent
}

/** Na troca sem a compra, quantas peças de um mesmo item voltam numa troca só. */
export const QTD_MAX_SEM_COMPRA = 20

/**
 * O crédito da troca sem a compra que uma pessoa autoriza sozinha (R$ 2.000).
 * Acima disto, o PIN tem de ser de OUTRA pessoa que pode autorizar — até a
 * dona: vale de R$ 5.000 sem compra nenhuma é dinheiro saindo sem lastro, e
 * pede dois pares de olhos.
 */
export const TETO_CREDITO_SEM_COMPRA_CENT = 200_000
