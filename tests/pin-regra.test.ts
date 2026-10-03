// A regra do PIN que a tela do balcão e o servidor dividem (src/servidor/pin-regra.ts).
import { describe, it, expect } from 'vitest'
import { problemaDoPin } from '../src/servidor/pin-regra'
import { problemaDoPin as doServidor } from '../src/servidor/autorizacao'

describe('problemaDoPin', () => {
  it('recusa repetido, escada e fora de 4 a 6 — a tela e o servidor com a mesma régua', () => {
    for (const fraco of ['0000', '1111', '1234', '4321', '123456', '9876']) expect(problemaDoPin(fraco)).not.toBeNull()
    expect(problemaDoPin('123')).toMatch(/de 4 a 6/)
    expect(problemaDoPin('1234567')).toMatch(/de 4 a 6/)
    expect(problemaDoPin('12a4')).toMatch(/só de números/)
    for (const bom of ['5829', '7395', '482613']) expect(problemaDoPin(bom)).toBeNull()
    expect(doServidor).toBe(problemaDoPin)
  })
})
