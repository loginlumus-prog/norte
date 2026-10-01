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
 * Quanto de cada real da etiqueta a cliente pagou: total ÷ subtotal da
 * compra. O juro do crédito parcelado fica de fora — está no total, mas não é
 * preço de peça (quem estorna o parcelamento é a operadora).
 */
export function fatorPago(subtotalCent: number, totalCent: number, jurosCent = 0): number {
  return subtotalCent > 0 ? (totalCent - jurosCent) / subtotalCent : 1
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
 * parece dedo errado? Cinco vezes a etiqueta mais cara de hoje é o zero a
 * mais — R$ 1.299 numa blusa de R$ 129,90. A autorização com PIN vale para o
 * número que a gerente viu, mas não salva o número que ninguém conferiu.
 */
export function precoSemCompraPareceErrado(digitadoCent: number, etiquetaMaisCaraCent: number): boolean {
  if (!(digitadoCent > 0)) return true
  return etiquetaMaisCaraCent > 0 && digitadoCent > etiquetaMaisCaraCent * 5
}
