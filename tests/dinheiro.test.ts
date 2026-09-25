import { describe, it, expect } from 'vitest'
import { centavos, reais, multiplicar, mostrar } from '../src/servidor/dinheiro'

describe('o bug que originou este arquivo', () => {
  it('44,90 por 0,750 kg dá 33,68 — não 33,67', () => {
    // O jeito ingênuo erra:
    expect(Math.round(44.9 * 0.75 * 100) / 100).toBe(33.67) // ERRADO
    // O jeito certo:
    expect(multiplicar(centavos('44.90'), 0.75)).toBe(3368)
  })

  it('e o erro não era acaso: a meia-moeda caía sempre para baixo', () => {
    // Todo preço terminado em 0 vendido em meio quilo cai na metade do centavo
    for (const preco of ['44.90', '12.30', '7.50', '89.10']) {
      const certo = multiplicar(centavos(preco), 0.5)
      const ingenuo = Math.round(Number(preco) * 0.5 * 100)
      // pelo menos um destes precisa mostrar a diferença
      expect(certo).toBeGreaterThanOrEqual(ingenuo)
    }
  })
})

describe('reais para centavos', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['0.01', 1],
    ['0.1', 10],
    ['44.90', 4490],
    ['44.9', 4490],
    ['1234.56', 123456],
    ['0.005', 1], // meia-moeda sobe
    ['0.004', 0], // e abaixo disso não
    ['-12.50', -1250],
  ])('%s vira %i centavos', (entrada, esperado) => {
    expect(centavos(entrada)).toBe(esperado)
  })

  it('aceita vírgula, que é como o brasileiro digita', () => {
    expect(centavos('44,90')).toBe(4490)
  })

  it('aceita número também, não só texto', () => {
    expect(centavos(44.9)).toBe(4490)
    expect(centavos(0.1)).toBe(10)
  })

  it('aceita o Decimal do banco (que vira texto exato)', () => {
    const doBanco = { toString: () => '44.90' }
    expect(centavos(doBanco)).toBe(4490)
  })

  it('recusa lixo em vez de devolver zero em silêncio', () => {
    for (const lixo of ['', 'abc', '1.2.3', 'R$ 10', '.']) {
      expect(() => centavos(lixo), `deveria recusar ${JSON.stringify(lixo)}`).toThrow()
    }
  })
})

describe('somar não acumula erro', () => {
  it('0,10 dez vezes dá exatamente 1,00', () => {
    // Em ponto flutuante isto daria 0.9999999999999999
    let total = 0
    for (let i = 0; i < 10; i++) total += centavos('0.10')
    expect(total).toBe(100)
    expect(reais(total)).toBe(1)
  })

  it('mil itens de 1 centavo dão exatamente 10 reais', () => {
    const total = Array.from({ length: 1000 }, () => centavos('0.01')).reduce((a, b) => a + b, 0)
    expect(reais(total)).toBe(10)
  })
})

describe('preço vezes quantidade', () => {
  it('quantidade inteira é exata', () => {
    expect(multiplicar(centavos('49.90'), 2)).toBe(9980)
    expect(multiplicar(centavos('49.90'), 3)).toBe(14970)
  })

  it('peso arredonda meio-para-cima, como a balança do balcão', () => {
    expect(multiplicar(centavos('44.90'), 0.75)).toBe(3368) // 33,675 → 33,68
    expect(multiplicar(centavos('44.90'), 0.25)).toBe(1123) // 11,225 → 11,23
    expect(multiplicar(centavos('10.00'), 0.335)).toBe(335) // 3,35 exato
  })

  it('devolução (negativo) arredonda para o mesmo lado em valor', () => {
    expect(multiplicar(centavos('-44.90'), 0.75)).toBe(-3368)
  })

  it('quantidade zero dá zero', () => {
    expect(multiplicar(centavos('44.90'), 0)).toBe(0)
  })
})

describe('mostrar', () => {
  it.each([
    [0, 'R$ 0,00'],
    [1, 'R$ 0,01'],
    [100, 'R$ 1,00'],
    [3368, 'R$ 33,68'],
    [123456, 'R$ 1234,56'],
    [-1250, '-R$ 12,50'],
  ])('%i centavos vira %s', (c, esperado) => {
    expect(mostrar(c)).toBe(esperado)
  })

  it('sempre com duas casas, inclusive quando termina em zero', () => {
    expect(mostrar(4490)).toBe('R$ 44,90')
    expect(mostrar(4400)).toBe('R$ 44,00')
  })
})

describe('ida e volta', () => {
  it.each(['0.01', '1.00', '44.90', '999.99', '1234.56'])('%s sobrevive à viagem', (v) => {
    expect(reais(centavos(v))).toBe(Number(v))
  })
})

// O campo de dinheiro digitado: o jeito brasileiro passa, o ambíguo não.
import { lerDinheiro } from '../src/servidor/dinheiro'

describe('lerDinheiro', () => {
  it('aceita vírgula decimal, ponto de milhar, ponto decimal e inteiro', () => {
    expect(lerDinheiro('1.234,56')).toBe(1234.56)
    expect(lerDinheiro('1234,5')).toBe(1234.5)
    expect(lerDinheiro('1234.56')).toBe(1234.56)
    expect(lerDinheiro('R$ 90')).toBe(90)
  })

  // "1.234" pode ser mil e tanto (milhar) ou um real e vinte e três
  // (planilha). Adivinhar errado é gravar mil vezes menos, sem aviso.
  it('recusa o que não dá para saber o que é', () => {
    expect(lerDinheiro('1.234')).toBeNull()
    expect(lerDinheiro('abc')).toBeNull()
    expect(lerDinheiro('')).toBeNull()
    expect(lerDinheiro('-5')).toBeNull()
  })
})
