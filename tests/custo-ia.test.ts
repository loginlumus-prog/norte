import { describe, it, expect } from 'vitest'
import { custoEmCentavos, cobrancaEmCentavos, MARGEM } from '../src/servidor/custo-ia'

describe('o que a loja paga NAO e o que o fornecedor cobra', () => {
  it('a cobranca e o custo vezes a margem', () => {
    const custo = custoEmCentavos('claude-sonnet-5', 100_000, 20_000)
    expect(cobrancaEmCentavos('claude-sonnet-5', 100_000, 20_000)).toBe(Math.ceil(custo * MARGEM))
  })

  it('e a margem e maior que 1 — senao o produto perde dinheiro calado', () => {
    // Zero de margem e prejuizo: em cima dela ainda correm a taxa do meio de
    // pagamento, a chamada repetida e o imposto.
    expect(MARGEM).toBeGreaterThan(1)
  })

  it('chamada minuscula cobra pelo menos um centavo', () => {
    expect(cobrancaEmCentavos('claude-haiku-4-5-20251001', 10, 1)).toBeGreaterThanOrEqual(1)
  })

  it('chamada de tamanho zero nao cobra nada', () => {
    expect(cobrancaEmCentavos('claude-sonnet-5', 0, 0)).toBe(0)
  })

  it('a cobranca nunca fica abaixo do custo, em nenhum modelo ou tamanho', () => {
    for (const m of ['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5']) {
      for (const [e, s] of [[1, 1], [1000, 100], [200_000, 50_000], [2_000_000, 400_000]]) {
        expect(cobrancaEmCentavos(m, e!, s!)).toBeGreaterThanOrEqual(custoEmCentavos(m, e!, s!))
      }
    }
  })
})
