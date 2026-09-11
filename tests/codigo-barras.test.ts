import { describe, it, expect } from 'vitest'
import { simbolosCode128, svgCode128, larguraCode128 } from '../src/servidor/codigo-barras'

describe('Code 128', () => {
  it('codifica texto no conjunto B com o checksum da norma', () => {
    // Exemplo clássico: "Wikipedia" → StartB, W,i,k,i,p,e,d,i,a, check 88, Stop.
    const s = simbolosCode128('Wikipedia')
    expect(s[0]).toBe(104)
    expect(s[s.length - 1]).toBe(106)
    expect(s[s.length - 2]).toBe(88)
  })

  it('usa o conjunto C para uma fileira de dígitos', () => {
    // "0056522" tem 7 dígitos: 3 pares em C e o último volta para B.
    const s = simbolosCode128('0056522')
    expect(s[0]).toBe(105) // início C
    expect(s.slice(1, 4)).toEqual([0, 56, 52])
    expect(s[4]).toBe(100) // troca para B
    expect(s[5]).toBe('2'.charCodeAt(0) - 32)
  })

  it('uma etiqueta CAM003 mistura letras e números e fecha certo', () => {
    const s = simbolosCode128('CAM003')
    expect(s[0]).toBe(104)
    // C, A, M no B; "003" tem 3 dígitos — menos que 4 — fica no B também.
    expect(s.length).toBe(1 + 6 + 1 + 1)
    const soma = s.slice(0, -2).reduce((a, v, k) => a + v * (k === 0 ? 1 : k), 0)
    expect(s[s.length - 2]).toBe(soma % 103)
  })

  it('caractere fora do ASCII vira interrogação, e vazio recusa', () => {
    expect(simbolosCode128('aç')[2]).toBe('?'.charCodeAt(0) - 32)
    expect(() => simbolosCode128('')).toThrow()
  })

  it('desenha um SVG com barras e zona de silêncio', () => {
    const svg = svgCode128('CAM003', { altura: 30 })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('<rect')
    expect(svg).toContain('aria-label="CAM003"')
    expect(larguraCode128('CAM003')).toBeGreaterThan(20)
  })
})
