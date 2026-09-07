// A grade e o código de etiqueta.
//
// As duas funções puras que decidem o cadastro de produto. A grade é o
// produto cartesiano dos eixos; o código é o que a pessoa digita no balcão
// quando o leitor não pega.

import { describe, it, expect } from 'vitest'
import { combinar, prefixoDe } from '../src/servidor/produto'

describe('a grade', () => {
  it('sem eixo nenhum, uma combinação vazia — que é a variação padrão', () => {
    // Devolver [] faria o produto nascer sem variação nenhuma, e aí não
    // haveria o que vender. O sorvete a granel depende disso.
    expect(combinar([])).toEqual([[]])
  })

  it('um eixo vira uma variação por opção', () => {
    expect(combinar([['P', 'M', 'G']])).toEqual([['P'], ['M'], ['G']])
  })

  it('dois eixos viram o produto cartesiano', () => {
    // 2 cores × 3 tamanhos = 6, e é isso que a camiseta do exemplo tem.
    const g = combinar([
      ['azul', 'preto'],
      ['P', 'M', 'G'],
    ])
    expect(g).toHaveLength(6)
    expect(g[0]).toEqual(['azul', 'P'])
    expect(g[5]).toEqual(['preto', 'G'])
  })

  it('a ordem dos eixos é a ordem que a pessoa lê na etiqueta', () => {
    // "Azul · P", não "P · Azul". A ordem vira o nome no balcão.
    const [primeira] = combinar([['azul'], ['P']])
    expect(primeira).toEqual(['azul', 'P'])
  })

  it('três eixos também funcionam', () => {
    // Sapataria com Cor × Numeração × Largura existe.
    expect(combinar([['a', 'b'], ['1', '2'], ['x', 'y']])).toHaveLength(8)
  })

  it('eixo com uma opção só não multiplica nada', () => {
    expect(combinar([['unica'], ['P', 'M']])).toEqual([
      ['unica', 'P'],
      ['unica', 'M'],
    ])
  })

  it('nenhuma combinação se repete', () => {
    const g = combinar([['azul', 'preto'], ['P', 'M', 'G']])
    const chaves = g.map((c) => c.join('|'))
    expect(new Set(chaves).size).toBe(g.length)
  })
})

describe('o código da etiqueta', () => {
  it('três letras do nome, em maiúscula', () => {
    expect(prefixoDe('Camiseta canelada')).toBe('CAM')
  })

  it('acento sai', () => {
    // Teclado de balcão e leitor de código de barras não concordam sobre
    // acento. O código precisa ser digitável nos dois.
    expect(prefixoDe('Óculos de sol')).toBe('OCU')
    expect(prefixoDe('Açaí')).toBe('ACA')
    expect(prefixoDe('Ração')).toBe('RAC')
  })

  it('número e símbolo saem, e as letras se juntam', () => {
    // "7up 2L" não vira "UPX": o número sai e o L do "2L" encosta no "up",
    // dando UPL. É o certo — o código quer três LETRAS, não três do começo.
    expect(prefixoDe('7up 2L')).toBe('UPL')
    expect(prefixoDe('Camiseta 100% algodão')).toBe('CAM')
  })

  it('nome curto completa com X', () => {
    expect(prefixoDe('Pá')).toBe('PAX')
    expect(prefixoDe('A')).toBe('AXX')
  })

  it('nome sem letra nenhuma não fica sem código', () => {
    expect(prefixoDe('123')).toBe('PRO')
    expect(prefixoDe('')).toBe('PRO')
  })

  it('sempre três caracteres, seja qual for o nome', () => {
    const nomes = ['Camiseta', 'Pá', '', '123', 'Óculos', 'A B C D', 'ção']
    for (const n of nomes) expect(prefixoDe(n), n).toHaveLength(3)
  })
})
