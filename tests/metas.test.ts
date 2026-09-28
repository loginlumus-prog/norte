import { describe, it, expect } from 'vitest'
import { calcularComissao, mesChave, mesValido, nomeDoMes } from '../src/servidor/metas'

describe('comissão', () => {
  it('é a porcentagem sobre o líquido, para baixo', () => {
    expect(calcularComissao(100000, 5)).toBe(5000)
    expect(calcularComissao(4999, 3)).toBe(149) // 149,97 → 149
  })

  it('zero sem venda, sem taxa ou com líquido negativo', () => {
    expect(calcularComissao(0, 5)).toBe(0)
    expect(calcularComissao(100000, 0)).toBe(0)
    expect(calcularComissao(-100, 5)).toBe(0)
  })
})

describe('o mês', () => {
  it('a chave é AAAA-MM', () => {
    expect(mesChave(new Date('2026-09-11T12:00:00-03:00'))).toBe('2026-09')
    expect(mesChave(new Date('2026-01-01T00:00:00-03:00'))).toBe('2026-01')
    // 22h30 do dia 30 em São Paulo já é dia 1º em UTC — e ainda é setembro.
    expect(mesChave(new Date('2026-09-30T22:30:00-03:00'))).toBe('2026-09')
  })

  it('só aceita mês de verdade', () => {
    expect(mesValido('2026-09')).toBe(true)
    expect(mesValido('2026-13')).toBe(false)
    expect(mesValido('2026-9')).toBe(false)
    expect(mesValido('')).toBe(false)
    expect(mesValido(undefined)).toBe(false)
  })

  it('tem nome', () => {
    expect(nomeDoMes('2026-09')).toBe('setembro de 2026')
  })
})
