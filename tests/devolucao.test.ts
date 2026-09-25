import { describe, it, expect } from 'vitest'
import {
  gerarCodigoDeVale,
  normalizarCodigo,
  restante,
  valorDevolvidoCent,
  venceu,
} from '../src/servidor/devolucao'

describe('o código do vale', () => {
  it('tem o formato VT-XXXXXX e nunca usa letra ambígua', () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigoDeVale()
      expect(c).toMatch(/^VT-[A-HJ-KM-NP-Z2-9]{6}$/)
      expect(c).not.toMatch(/[0OIL1]/)
    }
  })

  it('é determinístico dado o sorteio', () => {
    expect(gerarCodigoDeVale(() => 0)).toBe('VT-AAAAAA')
    expect(gerarCodigoDeVale(() => 0.999)).toBe('VT-999999')
  })

  it('aceita o que a pessoa digita lendo do papel', () => {
    expect(normalizarCodigo('vt-3f9k2a')).toBe('VT-3F9K2A')
    expect(normalizarCodigo(' vt 3F9K 2A ')).toBe('VT-3F9K2A')
    expect(normalizarCodigo('3F9K2A')).toBe('VT-3F9K2A')
    expect(normalizarCodigo('3F9K')).toBeNull()
    expect(normalizarCodigo('')).toBeNull()
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
