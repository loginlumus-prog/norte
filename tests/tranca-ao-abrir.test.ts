// A tela trancada continua trancada depois do F5.
//
// O relógio da tranca vivia só no navegador e nascia de novo a cada
// carregamento: trancada, bastava apertar F5 (ou abrir outra aba) e a tela
// voltava aberta, sem senha. Agora a tela grava o último toque de verdade num
// cookie do aparelho, e a moldura decide, ao abrir, se já nasce trancada.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TRANCA_MIN, trancadaAoAbrir } from '../src/servidor/presenca'

const pote = vi.hoisted(() => ({
  cookies: new Map<string, { valor: string; opcoes: Record<string, unknown> }>(),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (nome: string, valor: string, opcoes: Record<string, unknown>) => pote.cookies.set(nome, { valor, opcoes }),
    get: (nome: string) => {
      const v = pote.cookies.get(nome)
      return v === undefined ? undefined : { name: nome, value: v.valor }
    },
  }),
  headers: async () => ({ get: () => null, has: () => false }),
}))

const AGORA = new Date('2026-10-02T15:00:00-03:00')
const atras = (min: number) => new Date(AGORA.getTime() - min * 60_000)

describe('trancadaAoAbrir', () => {
  it('parada há TRANCA_MIN ou mais, já abre trancada', () => {
    expect(trancadaAoAbrir(AGORA, atras(TRANCA_MIN), atras(120))).toBe(true)
    expect(trancadaAoAbrir(AGORA, atras(TRANCA_MIN + 45), atras(120))).toBe(true)
  })

  it('mexeu há pouco, abre normal', () => {
    expect(trancadaAoAbrir(AGORA, atras(TRANCA_MIN - 1), atras(120))).toBe(false)
    expect(trancadaAoAbrir(AGORA, atras(0), atras(120))).toBe(false)
  })

  it('entrar de novo conta como mexer: o toque velho de outra sessão não tranca', () => {
    expect(trancadaAoAbrir(AGORA, atras(300), atras(2))).toBe(false)
  })

  it('sem toque registrado (aparelho de antes do cookie), não tranca', () => {
    expect(trancadaAoAbrir(AGORA, null, atras(300))).toBe(false)
  })

  it('toque no futuro (relógio torto) não tranca', () => {
    expect(trancadaAoAbrir(AGORA, new Date(AGORA.getTime() + 60_000), null)).toBe(false)
  })
})

describe('o cookie do toque', () => {
  beforeEach(() => pote.cookies.clear())

  it('ida e volta: o que a rota grava é o que a moldura lê', async () => {
    const s = await import('../src/servidor/sessao')
    await s.marcarToque('loja-t', atras(40).getTime())
    const lido = await s.ultimoToque('loja-t')
    expect(lido?.getTime()).toBe(atras(40).getTime())
    expect(trancadaAoAbrir(AGORA, lido, atras(120))).toBe(true)

    const gravado = pote.cookies.get('norte_toque_loja-t')!
    // JavaScript da página não finge que mexeu; e o cookie mora na empresa.
    expect(gravado.opcoes.httpOnly).toBe(true)
    expect(gravado.opcoes.path).toBe('/loja-t')
  })

  it('valor estragado não vale como toque', async () => {
    const s = await import('../src/servidor/sessao')
    expect(s.lerToque(undefined)).toBeNull()
    expect(s.lerToque('')).toBeNull()
    expect(s.lerToque('abc')).toBeNull()
    expect(s.lerToque('-5')).toBeNull()
    expect(s.lerToque('0')).toBeNull()
    expect(s.lerToque('1759428000000')?.getTime()).toBe(1759428000000)
  })

  it('cada empresa tem o seu', async () => {
    const s = await import('../src/servidor/sessao')
    await s.marcarToque('loja-t', atras(1).getTime())
    expect(await s.ultimoToque('outra')).toBeNull()
  })
})
