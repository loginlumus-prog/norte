import { describe, it, expect } from 'vitest'
import { lojasSugeridas, normalizarVendidoEm, soDaLoja, vendidoNaLoja } from '../src/servidor/catalogo-loja'
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

describe('lojasSugeridas — o produto novo nasce na loja do ramo da categoria', () => {
  const CAT = { roupa: ['Blusas', 'Calças'], sorveteria: ['Picolé', 'Açaí'] }
  const lojas = [
    { id: 'centro', ramo: null },
    { id: 'shopping', ramo: 'roupa' },
    { id: 'sorveteria', ramo: 'sorveteria' },
  ]
  it('categoria de sorveteria marca só a sorveteria, sem ligar para acento', () => {
    expect(lojasSugeridas('picole', lojas, 'roupa', CAT)).toEqual(['sorveteria'])
  })
  it('loja sem ramo vale pelo ramo da empresa', () => {
    expect(lojasSugeridas('Blusas', lojas, 'roupa', CAT)).toEqual(['centro', 'shopping'])
  })
  it('categoria de ramo nenhum, ou sem categoria, fica em todas', () => {
    expect(lojasSugeridas('Promoção', lojas, 'roupa', CAT)).toEqual([])
    expect(lojasSugeridas(null, lojas, 'roupa', CAT)).toEqual([])
  })
  it('quando todas as lojas são do ramo, não há o que separar', () => {
    expect(lojasSugeridas('Blusas', lojas.slice(0, 2), 'roupa', CAT)).toEqual([])
  })
})

// Auditoria de 25/09: "acabou" só do que a loja vende (ou do depósito).
import { contaComoFalta } from '../src/servidor/catalogo-loja'

describe('o que conta como falta na loja', () => {
  it('linha zerada de produto que a loja não vende não é "acabou"', () => {
    expect(contaComoFalta({ quantidade: 0, unidadeId: SORVETE, ehDeposito: false }, [ROUPA])).toBe(false)
  })
  it('com saldo entra sempre — é mercadoria de verdade, e precisa sair de lá', () => {
    expect(contaComoFalta({ quantidade: 3, unidadeId: SORVETE, ehDeposito: false }, [ROUPA])).toBe(true)
  })
  it('depósito conta sempre; loja que vende conta sempre', () => {
    expect(contaComoFalta({ quantidade: 0, unidadeId: 'dep', ehDeposito: true }, [ROUPA])).toBe(true)
    expect(contaComoFalta({ quantidade: 0, unidadeId: ROUPA, ehDeposito: false }, [ROUPA])).toBe(true)
    expect(contaComoFalta({ quantidade: 0, unidadeId: SORVETE, ehDeposito: false }, [])).toBe(true)
  })
})
