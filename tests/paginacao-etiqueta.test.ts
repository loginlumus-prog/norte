// As duas regras puras que a primeira loja de verdade pediu: lista grande em
// páginas (ui/paginacao.ts) e a etiqueta do PRODUTO no balcão (servidor/etiqueta.ts).

import { describe, it, expect } from 'vitest'
import { fatiar, lerPagina, paginar, vizinhas } from '../src/ui/paginacao'
import { codigoExato, daEtiqueta, escolhaDoEnter } from '../src/servidor/etiqueta'

describe('paginação', () => {
  it('lê a página do endereço e recusa o que não é 1, 2, 3...', () => {
    expect(lerPagina('3')).toBe(3)
    expect(lerPagina(['2', '9'])).toBe(2)
    for (const ruim of [undefined, null, '', '0', '-1', '2.5', 'abc', '1e400', {}]) expect(lerPagina(ruim)).toBe(1)
  })

  it('corta na página e diz de onde a onde', () => {
    const lista = Array.from({ length: 929 }, (_, i) => i + 1)
    const p = fatiar(lista, 3, 40)
    expect(p.itens[0]).toBe(81)
    expect(p.itens.length).toBe(40)
    expect(p).toMatchObject({ pagina: 3, paginas: 24, total: 929, de: 81, ate: 120 })
    const ultima = fatiar(lista, 24, 40)
    expect(ultima.itens.length).toBe(9)
    expect(ultima).toMatchObject({ de: 921, ate: 929 })
  })

  it('página além do fim vira a última, e lista vazia é uma página vazia', () => {
    expect(paginar(30, 99, 100)).toMatchObject({ pagina: 1, paginas: 1, de: 1, ate: 30 })
    expect(paginar(250, 99, 100)).toMatchObject({ pagina: 3, pular: 200, de: 201, ate: 250 })
    expect(paginar(0, 5, 100)).toMatchObject({ pagina: 1, paginas: 1, de: 0, ate: 0 })
  })

  it('mostra a primeira, a última e as vizinhas da atual, com reticências no meio', () => {
    expect(vizinhas(1, 1)).toEqual([1])
    expect(vizinhas(1, 5)).toEqual([1, 2, 3, null, 5])
    expect(vizinhas(10, 24)).toEqual([1, null, 8, 9, 10, 11, 12, null, 24])
    expect(vizinhas(24, 24)).toEqual([1, null, 22, 23, 24])
  })
})

describe('a etiqueta do produto no balcão', () => {
  const grade = [
    { codigo: '005990-35' },
    { codigo: '005990-36' },
    { codigo: '005990-37' },
  ]

  it('casa a grade pela etiqueta, sem confundir com outro número que começa igual', () => {
    expect(daEtiqueta('005990-36', '005990')).toBe(true)
    expect(daEtiqueta('005990-M-PRETO', '005990')).toBe(true)
    expect(daEtiqueta('0059901', '005990')).toBe(false)
    expect(daEtiqueta('005990', '005990')).toBe(false)
    expect(daEtiqueta('cam001', '')).toBe(false)
    expect(codigoExato('cam001', ' CAM001 ')).toBe(true)
  })

  it('o código exato lança aquele item, como sempre', () => {
    expect(escolhaDoEnter('005990-36', grade)).toEqual({ item: grade[1], varios: 0 })
  })

  it('a etiqueta de uma grade com vários tamanhos NÃO lança o primeiro — pede o tamanho', () => {
    expect(escolhaDoEnter('005990', grade)).toEqual({ item: null, varios: 3 })
  })

  it('a etiqueta de um produto com uma variação só lança ela', () => {
    expect(escolhaDoEnter('004410', [{ codigo: '004410-UNICO' }, { codigo: 'BLU001' }])).toEqual({ item: { codigo: '004410-UNICO' }, varios: 0 })
  })

  it('sem código nenhum, vale o primeiro achado pelo nome', () => {
    expect(escolhaDoEnter('sandalia', [{ codigo: 'SAN001' }, { codigo: 'SAN002' }])).toEqual({ item: { codigo: 'SAN001' }, varios: 0 })
    expect(escolhaDoEnter('nada', [])).toEqual({ item: null, varios: 0 })
  })
})
