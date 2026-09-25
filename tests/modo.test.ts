import { describe, it, expect, vi } from 'vitest'

// `modo.ts` importa `next/headers`, que só existe dentro do servidor do Next.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const { modoDe, MODO_PADRAO } = await import('../src/servidor/modo')

describe('o modo da tela', () => {
  it('lê os dois valores válidos', () => {
    expect(modoDe('simples')).toBe('simples')
    expect(modoDe('avancado')).toBe('avancado')
  })

  it('qualquer outra coisa vira o padrão, que é o simples', () => {
    expect(MODO_PADRAO).toBe('simples')
    for (const v of [undefined, null, '', 'AVANCADO', 'avançado', 'x']) expect(modoDe(v)).toBe('simples')
  })
})
