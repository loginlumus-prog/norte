import { describe, it, expect } from 'vitest'
import { normalizarVendidoEm, soDaLoja, vendidoNaLoja } from '../src/servidor/catalogo-loja'
import { limparLoja, LojaRecusada } from '../src/servidor/lojas'

// A sorveteria não vende camisa. Estes testes são a regra escrita: o que cada
// loja vende, e o que a tela de Lojas aceita guardar.

const ROUPA = 'loja-roupa'
const SORVETE = 'loja-sorvete'

describe('o que cada loja vende', () => {
  it('vazio quer dizer todas', () => {
    expect(vendidoNaLoja([], ROUPA)).toBe(true)
    expect(vendidoNaLoja(null, SORVETE)).toBe(true)
  })

  it('com lista, só as lojas da lista', () => {
    expect(vendidoNaLoja([SORVETE], SORVETE)).toBe(true)
    expect(vendidoNaLoja([SORVETE], ROUPA)).toBe(false)
  })

  it('o filtro do banco pede lista vazia OU a loja', () => {
    expect(soDaLoja(ROUPA)).toEqual({ OR: [{ vendidoEm: { isEmpty: true } }, { vendidoEm: { has: ROUPA } }] })
  })
})

describe('o que se grava a partir da ficha', () => {
  const abertas = [ROUPA, SORVETE, 'loja-3']

  it('todas marcadas vira vazio, para a loja que abrir depois também vender', () => {
    expect(normalizarVendidoEm([ROUPA, SORVETE, 'loja-3'], abertas)).toEqual([])
  })

  it('parte marcada fica a lista, sem repetição e em ordem', () => {
    expect(normalizarVendidoEm([SORVETE, SORVETE], abertas)).toEqual([SORVETE])
  })

  it('id que não é loja desta empresa é descartado', () => {
    expect(normalizarVendidoEm(['loja-de-outra-empresa', SORVETE], abertas)).toEqual([SORVETE])
    expect(normalizarVendidoEm(['loja-de-outra-empresa'], abertas)).toEqual([])
  })
})

describe('os dados da loja', () => {
  it('sem nome não passa', () => {
    expect(() => limparLoja({ nome: '   ' })).toThrow(LojaRecusada)
  })

  it('ramo que não existe vira nulo, e o que existe fica', () => {
    expect(limparLoja({ nome: 'A', ramo: 'nave-espacial' }).ramo).toBeNull()
    expect(limparLoja({ nome: 'A', ramo: 'toString' }).ramo).toBeNull()
    expect(limparLoja({ nome: 'A', ramo: 'sorveteria' }).ramo).toBe('sorveteria')
  })

  it('apara, corta no tamanho e põe a UF em maiúscula', () => {
    const d = limparLoja({ nome: '  Sorveteria da Praça  ', estado: 'ba', cep: '  ', horario: 'x'.repeat(500) })
    expect(d.nome).toBe('Sorveteria da Praça')
    expect(d.estado).toBe('BA')
    expect(d.cep).toBeNull()
    expect(d.horario!.length).toBe(120)
  })
})
