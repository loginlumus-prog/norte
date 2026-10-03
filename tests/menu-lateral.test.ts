// A lateral recolhida ou aberta: o que vale quando a pessoa escolheu, e o que
// vale quando ninguém escolheu ainda (o padrão da tela).

import { describe, it, expect } from 'vitest'
import { menuRecolhidoDe } from '../src/servidor/menu-lateral'

describe('o menu da lateral', () => {
  it('sem escolha, vale o padrão da tela: o balcão recolhido, o resto aberto', () => {
    expect(menuRecolhidoDe(undefined, true)).toBe(true)
    expect(menuRecolhidoDe(undefined, false)).toBe(false)
    expect(menuRecolhidoDe(null, true)).toBe(true)
  })

  it('quem escolheu, escolheu para todas as telas — inclusive o balcão', () => {
    expect(menuRecolhidoDe('aberto', true)).toBe(false)
    expect(menuRecolhidoDe('recolhido', false)).toBe(true)
  })

  it('cookie estranho vale como "ninguém escolheu", e nunca quebra a tela', () => {
    for (const lixo of ['', 'true', '1', 'ABERTO', '<script>', 'recolhido ']) {
      expect(menuRecolhidoDe(lixo, false)).toBe(false)
      expect(menuRecolhidoDe(lixo, true)).toBe(true)
    }
  })
})
