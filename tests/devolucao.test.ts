import { describe, it, expect } from 'vitest'
import {
  gerarCodigoDeVale,
  normalizarCodigo,
  restante,
  valorDevolvidoCent,
  venceu,
} from '../src/servidor/devolucao'
import { fatorPago, valorDoItemCent } from '../src/servidor/troca-conta'

describe('o código do vale', () => {
  it('tem o formato VT-XXXXX-XXXXX (dez símbolos) e nunca usa letra ambígua', () => {
    const vistos = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigoDeVale()
      expect(c).toMatch(/^VT-[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/)
      expect(c).not.toMatch(/[0OIL1]/)
      vistos.add(c)
    }
    // Sorteio do sistema (crypto), não um gerador previsível: 200 códigos, 200 diferentes.
    expect(vistos.size).toBe(200)
  })

  it('é determinístico dado o sorteio', () => {
    expect(gerarCodigoDeVale(() => 0)).toBe('VT-AAAAA-AAAAA')
    expect(gerarCodigoDeVale(() => 0.999)).toBe('VT-99999-99999')
  })

  it('aceita o que a pessoa digita lendo do papel', () => {
    expect(normalizarCodigo('vt-3f9k2a')).toBe('VT-3F9K2A')
    expect(normalizarCodigo(' vt 3F9K 2A ')).toBe('VT-3F9K2A')
    expect(normalizarCodigo('3F9K2A')).toBe('VT-3F9K2A')
    expect(normalizarCodigo('3F9K')).toBeNull()
    expect(normalizarCodigo('')).toBeNull()
    // O código novo, de dez, com ou sem o traço do meio — e o de seis continua valendo.
    expect(normalizarCodigo('vt-k3m9p-2qxrt')).toBe('VT-K3M9P-2QXRT')
    expect(normalizarCodigo('K3M9P2QXRT')).toBe('VT-K3M9P-2QXRT')
    expect(normalizarCodigo('VT K3M9P 2QXRT')).toBe('VT-K3M9P-2QXRT')
    expect(normalizarCodigo('VT-ABCDEF')).toBe('VT-ABCDEF')
    expect(normalizarCodigo('K3M9P2QX')).toBeNull()
  })
})

describe('quanto pode voltar', () => {
  it('o vendido menos o já devolvido, nunca negativo', () => {
    expect(restante(3, 0)).toBe(3)
    expect(restante(3, 2)).toBe(1)
    expect(restante(3, 3)).toBe(0)
    expect(restante(3, 5)).toBe(0)
  })

  it('funciona com peso', () => {
    expect(restante(0.75, 0.25)).toBe(0.5)
    expect(restante(1, 0.999)).toBe(0.001)
  })
})

describe('o valor que volta', () => {
  it('sem desconto na venda, é o preço vezes a quantidade', () => {
    expect(valorDevolvidoCent(4990, 2, 1)).toBe(9980)
  })

  it('com 10% de desconto na venda, volta 90% do preço', () => {
    // A blusa de R$ 100 foi paga por R$ 90. Devolver R$ 100 seria a loja
    // pagar para receber a peça de volta.
    expect(valorDevolvidoCent(10000, 1, 0.9)).toBe(9000)
  })

  it('arredonda para baixo: a sobra fica com a loja', () => {
    expect(valorDevolvidoCent(999, 1, 0.5)).toBe(499)
  })

  it('peso quebrado também', () => {
    expect(valorDevolvidoCent(4490, 0.75, 1)).toBe(3368)
  })

  it('o desconto dado NA LINHA também fica: volta o total da linha, na proporção', () => {
    // Duas blusas de R$ 100 com R$ 20 de desconto na linha (total 180): uma volta por 90.
    expect(valorDoItemCent(18000, 2, 1, 1)).toBe(9000)
    expect(valorDoItemCent(18000, 2, 2, 0.9)).toBe(16200)
    expect(valorDoItemCent(0, 1, 1, 1)).toBe(0)
  })

  it('o acréscimo não entra no fator, e o fator nunca passa de 1', () => {
    // Blusa 100 + Saia 50, R$ 30 de acréscimo: total 180, subtotal 150. A saia volta 50.
    expect(fatorPago(15000, 18000, 0, 3000)).toBe(1)
    expect(valorDoItemCent(5000, 1, 1, fatorPago(15000, 18000, 0, 3000))).toBe(5000)
    // Com desconto de 10% E acréscimo: o desconto vale, o acréscimo não.
    expect(fatorPago(15000, 16500, 0, 3000)).toBeCloseTo(0.9, 10)
    // Mesmo sem dizer o acréscimo, nunca devolve mais que a peça.
    expect(fatorPago(15000, 18000)).toBe(1)
  })
})

describe('validade', () => {
  it('vale o dia inteiro da validade, e vence no dia seguinte', () => {
    const validade = new Date(2026, 8, 30)
    expect(venceu(validade, new Date(2026, 8, 30, 23, 59))).toBe(false)
    expect(venceu(validade, new Date(2026, 9, 1, 0, 0))).toBe(true)
    expect(venceu(validade, new Date(2026, 8, 1))).toBe(false)
  })
})

describe('validade do vale com a data como vem do banco', () => {
  const coluna = (dia: string) => new Date(`${dia}T00:00:00.000Z`)
  const emSP = (iso: string) => new Date(`${iso}-03:00`)
  it('o último dia inteiro ainda vale, e o seguinte não', () => {
    expect(venceu(coluna('2026-09-25'), emSP('2026-09-25T09:00:00'))).toBe(false)
    expect(venceu(coluna('2026-09-25'), emSP('2026-09-25T23:59:00'))).toBe(false)
    expect(venceu(coluna('2026-09-25'), emSP('2026-09-26T00:01:00'))).toBe(true)
  })
})
