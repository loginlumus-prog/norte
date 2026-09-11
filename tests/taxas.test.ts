import { describe, it, expect } from 'vitest'
import { taxaDe, taxaEmCentavos, type Taxa } from '../src/servidor/taxas'

const taxas: Taxa[] = [
  { forma: 'PIX', parcelas: 1, percentual: 0.99 },
  { forma: 'DEBITO', parcelas: 1, percentual: 1.5 },
  { forma: 'CREDITO', parcelas: 1, percentual: 3.2 },
  { forma: 'CREDITO', parcelas: 2, percentual: 4.5 },
]

describe('qual taxa vale', () => {
  it('cada forma pega a sua', () => {
    expect(taxaDe(taxas, 'PIX', 1)).toBe(0.99)
    expect(taxaDe(taxas, 'DEBITO', 1)).toBe(1.5)
    expect(taxaDe(taxas, 'CREDITO', 1)).toBe(3.2)
  })

  it('crédito em 2× ou mais é parcelado, em qualquer número de vezes', () => {
    expect(taxaDe(taxas, 'CREDITO', 2)).toBe(4.5)
    expect(taxaDe(taxas, 'CREDITO', 12)).toBe(4.5)
  })

  it('parcelado sem taxa própria usa a do crédito à vista', () => {
    const so = taxas.filter((t) => !(t.forma === 'CREDITO' && t.parcelas === 2))
    expect(taxaDe(so, 'CREDITO', 6)).toBe(3.2)
  })

  it('dinheiro, crediário e vale não têm taxa, nem forma sem cadastro', () => {
    expect(taxaDe(taxas, 'DINHEIRO', 1)).toBe(0)
    expect(taxaDe(taxas, 'CREDIARIO', 3)).toBe(0)
    expect(taxaDe([], 'CREDITO', 1)).toBe(0)
  })
})

describe('a taxa em centavos', () => {
  it('3,2% de R$ 100 é R$ 3,20', () => {
    expect(taxaEmCentavos(10000, 3.2)).toBe(320)
  })

  it('arredonda meio-para-cima, como a operadora', () => {
    expect(taxaEmCentavos(4990, 3.2)).toBe(160) // 159,68
    expect(taxaEmCentavos(1, 50)).toBe(1) // 0,5 → 1
  })

  it('zero quando não há taxa ou valor', () => {
    expect(taxaEmCentavos(10000, 0)).toBe(0)
    expect(taxaEmCentavos(0, 3)).toBe(0)
  })
})
