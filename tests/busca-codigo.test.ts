// A busca por código como no balcão de onde a loja veio: o código inteiro,
// um pedaço dele, o final AV/CA/CR da etiqueta antiga — e a grade de um
// produto num cartão só.
import { describe, it, expect } from 'vitest'
import { proximidade, codigoBate, termosDeCodigo, pedacoDeCodigo, escolhaDoEnter } from '../src/servidor/etiqueta'
import { agruparAchados } from '../src/app/[empresa]/balcao/vitrine'
import type { Achado } from '../src/app/[empresa]/balcao/acoes'

describe('código da etiqueta', () => {
  it('exato, grade, começo e pedaço, nessa ordem', () => {
    expect(proximidade('0056522', '0056522')).toBe(0)
    expect(proximidade('0056522-38', '0056522')).toBe(1)
    expect(proximidade('0056522-38', '00565')).toBe(2)
    expect(proximidade('0056522-38', '56522')).toBe(3)
    expect(proximidade('005652', '0056522')).toBeNull()
  })

  it('o final AV/CA/CR da etiqueta antiga acha o produto', () => {
    expect(termosDeCodigo('0056522AV')).toEqual(['0056522AV', '0056522'])
    expect(proximidade('0056522-38', '0056522cr')).toBe(1)
    expect(termosDeCodigo('CAMISA')).toEqual(['CAMISA'])
  })

  it('pedaço só com número e 3 caracteres ou mais — "cal" é nome, não etiqueta', () => {
    expect(pedacoDeCodigo('cal')).toBe(false)
    expect(pedacoDeCodigo('12')).toBe(false)
    expect(pedacoDeCodigo('522')).toBe(true)
    expect(codigoBate('CAL001', 'cal')).toBe(false)
  })

  it('Enter com o final AV ainda lança o item exato', () => {
    const itens = [{ codigo: '0056522' }, { codigo: '0056523' }]
    expect(escolhaDoEnter('0056522AV', itens).item).toEqual({ codigo: '0056522' })
  })
})

describe('a grade num cartão só', () => {
  const achado = (id: string, produtoId: string | null, tam: string): Achado => ({
    id, codigo: `X-${tam}`, descricao: `Bermuda — ${tam}`, medida: 'UN', preco: 85.49,
    precos: { vista: 85.49, cartao: 89.99, crediario: 94.99 }, saldo: 1,
    ...(produtoId ? { grade: { produtoId, nome: 'Bermuda', categoriaId: null, opcoes: [{ eixo: 'Tamanho', eixoOrdem: 0, valor: tam, ordem: 0, hex: null }] } } : {}),
  })

  it('tamanhos do mesmo produto viram um produto com as variações', () => {
    const blocos = agruparAchados([achado('a', 'p1', '36'), achado('b', 'p1', '38'), achado('c', 'p2', 'M')])
    expect(blocos.map((b) => b.tipo)).toEqual(['grade', 'peca'])
    const g = blocos[0]!
    expect(g.tipo === 'grade' && g.produto.variacoes.map((v) => v.id)).toEqual(['a', 'b'])
    expect(g.tipo === 'grade' && g.produto.nome).toBe('Bermuda')
  })

  it('achado sem grade (de outra versão do servidor) continua cartão de peça', () => {
    expect(agruparAchados([achado('a', null, '36')]).map((b) => b.tipo)).toEqual(['peca'])
  })
})
