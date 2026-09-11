import { describe, it, expect } from 'vitest'
import { tabelaDe, precoNaTabela, escada } from '../src/servidor/preco'

describe('qual tabela vale', () => {
  it('sem forma nenhuma é à vista', () => {
    expect(tabelaDe([])).toBe('vista')
  })

  it('dinheiro, pix, débito, transferência e vale são à vista', () => {
    for (const f of ['DINHEIRO', 'PIX', 'DEBITO', 'TRANSFERENCIA', 'VALE']) {
      expect(tabelaDe([f])).toBe('vista')
    }
  })

  it('crédito é cartão, crediário é crediário', () => {
    expect(tabelaDe(['CREDITO'])).toBe('cartao')
    expect(tabelaDe(['CREDIARIO'])).toBe('crediario')
  })

  it('duas formas: vale a mais cara', () => {
    expect(tabelaDe(['DINHEIRO', 'CREDITO'])).toBe('cartao')
    expect(tabelaDe(['CREDITO', 'CREDIARIO'])).toBe('crediario')
    expect(tabelaDe(['PIX', 'DINHEIRO'])).toBe('vista')
  })

  it('forma desconhecida não derruba nem sobe a tabela', () => {
    expect(tabelaDe(['CRIPTO', 'CREDITO'])).toBe('cartao')
    expect(tabelaDe(['CRIPTO'])).toBe('vista')
  })
})

describe('o preço na tabela', () => {
  const cheio = { vista: 10000, cartao: 10500, crediario: 11000 }

  it('cada tabela pega o seu', () => {
    expect(precoNaTabela(cheio, 'vista')).toBe(10000)
    expect(precoNaTabela(cheio, 'cartao')).toBe(10500)
    expect(precoNaTabela(cheio, 'crediario')).toBe(11000)
  })

  it('crediário sem preço cobra o do cartão; cartão sem preço cobra à vista', () => {
    expect(precoNaTabela({ vista: 10000, cartao: 10500, crediario: null }, 'crediario')).toBe(10500)
    expect(precoNaTabela({ vista: 10000, cartao: null, crediario: null }, 'crediario')).toBe(10000)
    expect(precoNaTabela({ vista: 10000, cartao: null, crediario: 11000 }, 'cartao')).toBe(10000)
  })

  it('o preço nunca cai por falta de cadastro', () => {
    // Crediário preenchido mais barato que à vista é erro de digitação da
    // loja, e não é este arquivo que corrige — mas cartão vazio jamais vira
    // "de graça".
    expect(precoNaTabela({ vista: 5000, cartao: null, crediario: null }, 'cartao')).toBe(5000)
  })

  it('a escada preenche os três com a mesma regra', () => {
    expect(escada({ vista: 100, cartao: null, crediario: 130 })).toEqual({
      vista: 100, cartao: 100, crediario: 130,
    })
  })
})
