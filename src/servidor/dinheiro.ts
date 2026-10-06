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
 *
 * Com vírgula, o ponto só vale como milhar de verdade, de três em três:
 * "12.34,56" é dedo que escorregou, não mil duzentos e trinta e quatro.
 * Sem vírgula e com DOIS pontos ou mais ("1.234.567") não há dúvida: é
 * milhar, porque número com dois pontos decimais não existe.
 *
 * É a régua de todo campo de dinheiro digitado — preço, custo, meta,
 * lançamento. A ficha do produto já leu "49.90" como 4.990 reais porque
 * tirava todo ponto antes de olhar; aqui "49.90" é quarenta e nove e noventa.
 */
export function lerDinheiro(bruto: string): number | null {
  return lerDecimal(String(bruto ?? '').trim().replace(/^R\$\s*/i, ''), 2)
}

/**
 * Um número digitado que NÃO é dinheiro — porcentagem, juro ao mês,
 * quantidade — com a mesma régua de `lerDinheiro`: vírgula decimal, ponto de
 * milhar de três em três, e recusa em vez de adivinhar.
 *
 * `casas` é quantas casas depois da vírgula valem: 2 para porcentagem, 3
 * para quilo e litro. "1.234" continua recusado mesmo com 3 casas: pode ser
 * mil duzentos e trinta e quatro unidades ou um quilo e 234 gramas, e errar
 * aqui é baixar mil vezes o estoque. O "%" no fim é aceito e ignorado.
 */
export function lerNumero(bruto: string, casas = 2): number | null {
  return lerDecimal(String(bruto ?? '').trim().replace(/\s*%$/, ''), casas)
}

function lerDecimal(t: string, casas: number): number | null {
  if (!t) return null
  // Um ponto e três algarismos, sem vírgula: milhar ou decimal? Não dá para saber.
  if (/^\d{1,3}\.\d{3}$/.test(t)) return null
  let normal: string
  if (t.includes(',')) {
    const [inteiro = '', ...resto] = t.split(',')
    if (resto.length !== 1) return null
    if (inteiro.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(inteiro)) return null
    normal = `${inteiro.replace(/\./g, '')}.${resto[0]}`
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) {
    normal = t.replace(/\./g, '')
  } else {
    normal = t
  }
  if (!/^\d+(\.\d+)?$/.test(normal) || (normal.split('.')[1]?.length ?? 0) > casas) return null
  return Number(normal)
}

/** A frase que o campo de dinheiro mostra quando `lerDinheiro` recusa. */
export const DINHEIRO_ILEGIVEL = 'Não deu para ler este valor. Escreva assim: 49,90 ou 1.234,56.'

/** A frase do campo de número (porcentagem, juro, quantidade) que `lerNumero` recusa. */
export const NUMERO_ILEGIVEL = 'Não deu para ler este número. Escreva assim: 2,5 ou 10.'

/**
 * O custo como a pessoa escreve: "4,50" (reais, até quatro casas — o
 * mililitro de calda) ou "35%" (do preço à vista). O "%" é para quem não sabe
 * quanto custa o quilo do açaí, mas sabe que é mais ou menos um terço do
 * preço. Antes o "%" era jogado fora e "35%" virava R$ 35 de custo.
 *
 * Vazio é `null`. O custo em % sem o preço à vista é erro (não há base).
 */
export function lerCusto(bruto: string, precoVista: number | null | undefined): { valor: number } | { erro: string } | null {
  const t = String(bruto ?? '').trim().replace(/^R\$\s*/i, '')
  if (!t) return null
  if (/%\s*$/.test(t)) {
    const pct = lerDecimal(t.replace(/\s*%\s*$/, ''), 2)
    if (pct === null || pct <= 0 || pct > 100) return { erro: 'O custo em % vai de 1% a 100% do preço (ex.: 35%).' }
    if (!(precoVista && precoVista > 0)) return { erro: 'Para o custo em %, informe o preço à vista.' }
    return { valor: Math.round(precoVista * pct * 100) / 10000 }
  }
  const v = lerDecimal(t, 4)
  return v === null ? { erro: DINHEIRO_ILEGIVEL } : { valor: v }
}
