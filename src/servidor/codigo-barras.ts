// Código de barras Code 128, em SVG.
//
// ── por que Code 128, e por que aqui ─────────────────────────
// A etiqueta interna da loja é "CAM003": letras e números. EAN-13 só aceita
// treze dígitos, e a maioria das peças de loja pequena não tem EAN — a loja
// inventa o código e imprime. Code 128 codifica qualquer texto ASCII, é o
// que todo leitor de balcão lê de fábrica, e cabe em 30 mm.
//
// Quando a peça TEM EAN (produto de indústria), a etiqueta imprime o EAN, e
// o balcão acha pelos dois — `codigo` e `codigoBarras`.
//
// Puro e sem dependência: a tabela de padrões é a da norma, e o dígito de
// verificação é a soma ponderada módulo 103. Testado contra códigos
// conhecidos. Nenhuma biblioteca de 200 KB para desenhar onze retângulos.

// Cada padrão é a largura de 6 elementos (barra, espaço, barra, espaço, barra, espaço),
// na ordem da tabela do Code 128. O símbolo 106 (STOP) tem 7 elementos.
const PADROES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const INICIO_B = 104
const INICIO_C = 105
const TROCA_B = 100
const TROCA_C = 99
const PARADA = 106

/**
 * Os símbolos (valores 0-106) de um texto, já com início, checksum e parada.
 *
 * Usa o conjunto C (pares de dígitos) quando há quatro ou mais dígitos
 * seguidos — é o que deixa "0056522" curto — e o conjunto B para o resto.
 * Texto fora do ASCII imprimível não tem como ir numa barra: vira "?".
 */
export function simbolosCode128(texto: string): number[] {
  const t = [...texto].map((c) => {
    const n = c.charCodeAt(0)
    return n >= 32 && n <= 126 ? c : '?'
  })
  if (t.length === 0) throw new Error('Não dá para codificar texto vazio.')

  const simbolos: number[] = []
  let i = 0
  let conjunto: 'B' | 'C' | null = null

  const digitosSeguidos = (de: number) => {
    let n = 0
    while (de + n < t.length && /\d/.test(t[de + n]!)) n++
    return n
  }

  while (i < t.length) {
    const seguidos = digitosSeguidos(i)
    // Vale a pena ir para C se há pelo menos 4 dígitos (ou 2 no fim exato).
    const querC = seguidos >= 4 || (seguidos >= 2 && i + seguidos === t.length && conjunto === 'C')
    if (querC) {
      if (conjunto === null) simbolos.push(INICIO_C)
      else if (conjunto !== 'C') simbolos.push(TROCA_C)
      conjunto = 'C'
      // Pares. Um dígito sobrando volta para B.
      const pares = Math.floor(seguidos / 2)
      for (let k = 0; k < pares; k++) {
        simbolos.push(Number(t[i]! + t[i + 1]!))
        i += 2
      }
      continue
    }
    if (conjunto === null) simbolos.push(INICIO_B)
    else if (conjunto !== 'B') simbolos.push(TROCA_B)
    conjunto = 'B'
    simbolos.push(t[i]!.charCodeAt(0) - 32)
    i++
  }

  // Checksum: o início vale 1×, cada símbolo seguinte vale a posição, módulo 103.
  const soma = simbolos.reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0)
  simbolos.push(soma % 103)
  simbolos.push(PARADA)
  return simbolos
}

/**
 * O SVG da barra. Largura em módulos (cada módulo = `modulo` unidades);
 * a altura é dada. Fundo transparente, barras na cor da tinta.
 */
export function svgCode128(texto: string, opcoes: { altura?: number; modulo?: number; margem?: number } = {}): string {
  const altura = opcoes.altura ?? 40
  const modulo = opcoes.modulo ?? 1
  const margem = opcoes.margem ?? 10 // "zona de silêncio": o leitor precisa dela
  const simbolos = simbolosCode128(texto)

  let x = margem
  const barras: string[] = []
  for (const s of simbolos) {
    const padrao = PADROES[s]!
    for (let k = 0; k < padrao.length; k++) {
      const largura = Number(padrao[k]) * modulo
      // Elementos pares são barras, ímpares são espaços.
      if (k % 2 === 0) barras.push(`<rect x="${x}" y="0" width="${largura}" height="${altura}"/>`)
      x += largura
    }
  }
  const larguraTotal = x + margem
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${larguraTotal} ${altura}" ` +
    `width="${larguraTotal}" height="${altura}" shape-rendering="crispEdges" fill="currentColor" ` +
    `role="img" aria-label="${texto.replace(/"/g, '&quot;')}">${barras.join('')}</svg>`
  )
}

/** Largura em módulos de um texto, para saber se cabe na etiqueta. */
export function larguraCode128(texto: string, modulo = 1, margem = 10): number {
  const simbolos = simbolosCode128(texto)
  const modulos = simbolos.reduce((s, v) => s + PADROES[v]!.split('').reduce((a, c) => a + Number(c), 0), 0)
  return modulos * modulo + margem * 2
}
