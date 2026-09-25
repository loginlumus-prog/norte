// Dinheiro em centavos inteiros.
//
// ── por que não usar número quebrado ─────────────────────────
// O computador não guarda 0,1 exatamente, do mesmo jeito que a gente não
// escreve 1/3 exatamente em decimal. Some erro suficiente e a conta erra:
//
//     44,90 × 0,750            = 33,675   (certo)
//     33.675 * 100             = 3367.4999999999995   (o que a máquina tem)
//     Math.round(...) / 100    = 33,67    (um centavo a menos, SEMPRE)
//
// Não é um centavo por acaso: é um centavo que some toda vez que a conta cai
// na metade. Numa loja que vende a granel, isso é sangria diária silenciosa.
//
// ── a regra ──────────────────────────────────────────────────
// Toda conta de dinheiro acontece em CENTAVOS INTEIROS. Reais quebrados só
// existem em duas beiradas: o que chega da tela e o que vai para o banco.
//
// E arredondamento de comércio é meio-para-cima: 0,5 centavo vira 1 centavo.
// É o que a calculadora do balcão faz, e o cliente confere na nota.

/**
 * Reais → centavos, sem passar por ponto flutuante.
 *
 * Lê o número como TEXTO e separa antes e depois da vírgula. Assim "44.90"
 * vira 4490 exatamente, em vez de 4489,999...
 */
export function centavos(valor: number | string | { toString(): string }): number {
  const texto = typeof valor === 'string' ? valor : String(valor)
  const limpo = texto.trim().replace(',', '.')

  if (!/^-?\d*\.?\d*$/.test(limpo) || limpo === '' || limpo === '.') {
    throw new Error(`Valor de dinheiro inválido: ${texto}`)
  }

  const negativo = limpo.startsWith('-')
  const [inteiro = '0', decimal = ''] = limpo.replace('-', '').split('.')

  // Três casas ou mais: arredonda a terceira, meio-para-cima.
  const dois = decimal.slice(0, 2).padEnd(2, '0')
  const terceira = Number(decimal[2] ?? '0')
  let total = Number(inteiro) * 100 + Number(dois) + (terceira >= 5 ? 1 : 0)

  return negativo ? -total : total
}

/** Centavos → reais, para gravar e mostrar. */
export const reais = (cent: number): number => cent / 100

/**
 * Preço × quantidade, em centavos.
 *
 * A quantidade pode ser quebrada (0,750 kg), então aqui existe arredondamento
 * de verdade — e ele é meio-para-cima, como no balcão.
 */
export function multiplicar(precoCentavos: number, quantidade: number): number {
  const bruto = precoCentavos * quantidade
  // Math.round já é meio-para-cima em positivo. Em negativo ele vai para cima
  // também (-0,5 → -0), que não é o que se quer em devolução.
  return bruto < 0 ? -Math.round(-bruto) : Math.round(bruto)
}

/** "R$ 33,68" */
export function mostrar(cent: number): string {
  const sinal = cent < 0 ? '-' : ''
  const abs = Math.abs(cent)
  return `${sinal}R$ ${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * O que a pessoa digitou num campo de dinheiro, em reais — ou `null` quando
 * não dá para saber o que ela quis dizer.
 *
 * Aceita "1.234,56", "1234,56", "1234.56" e "1234". RECUSA "1.234": pode ser
 * mil duzentos e trinta e quatro (ponto de milhar, como se escreve aqui) ou
 * um real e vinte e três (ponto decimal, como vem de planilha). Adivinhar
 * errado é gravar um valor mil vezes menor sem aviso; recusar é pedir para a
 * pessoa escrever de novo.
 */
export function lerDinheiro(bruto: string): number | null {
  const t = bruto.trim().replace(/^R\$\s*/i, '')
  if (!t) return null
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null
  return Number(normal)
}
