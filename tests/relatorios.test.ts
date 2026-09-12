import { describe, it, expect } from 'vitest'
import { classificarAbc, temAnaliseAvancada } from '../src/servidor/relatorios'

const classes = (receitas: number[]) =>
  classificarAbc(receitas.map((receita) => ({ receita }))).map((l) => l.classe)

describe('a curva ABC', () => {
  it('põe em A o que forma os primeiros 80%', () => {
    // 80 / 15 / 5 → acumulado 80, 95, 100
    expect(classes([80, 15, 5])).toEqual(['A', 'B', 'C'])
  })

  it('o item que CRUZA os 80% ainda é A — ele faz parte dos 80%', () => {
    // 70 / 20 / 10 → acumulado 70, 90, 100. Sem o segundo item não existem
    // 80%, então ele é A junto com o primeiro.
    expect(classes([70, 20, 10])).toEqual(['A', 'A', 'B'])
  })

  it('um carro-chefe sozinho não cai em B por passar dos 80%', () => {
    // 90% num item só: se o corte olhasse o acumulado DEPOIS, a classe A
    // ficaria vazia na loja inteira.
    // 90 / 6 / 4 → o primeiro abre em 0 e é A; o segundo abre em 90 e é B;
    // o terceiro abre em 96, já passado dos 95, e é C.
    expect(classes([900, 60, 40])).toEqual(['A', 'B', 'C'])
  })

  it('uma loja de um produto só tem esse produto em A', () => {
    expect(classes([500])).toEqual(['A'])
  })

  it('a cauda longa cai em C', () => {
    const r = classes([900, 40, 20, 10, 10, 10, 10])
    expect(r[0]).toBe('A')
    expect(r.at(-1)).toBe('C')
  })

  it('as fatias somam 100%', () => {
    const linhas = classificarAbc([{ receita: 33 }, { receita: 33 }, { receita: 34 }])
    expect(linhas.reduce((s, l) => s + l.fatiaPct, 0)).toBeCloseTo(100, 6)
    expect(linhas.at(-1)!.acumuladoPct).toBeCloseTo(100, 6)
  })

  it('não divide por zero quando ninguém vendeu', () => {
    const linhas = classificarAbc([{ receita: 0 }, { receita: 0 }])
    expect(linhas.every((l) => l.fatiaPct === 0)).toBe(true)
    expect(linhas.every((l) => l.classe === 'A')).toBe(true)
  })

  it('lista vazia não quebra', () => {
    expect(classificarAbc([])).toEqual([])
  })

  it('carrega o resto da linha junto', () => {
    const [a] = classificarAbc([{ receita: 10, nome: 'Camiseta' }])
    expect(a!.nome).toBe('Camiseta')
  })
})

describe('quem vê a análise avançada', () => {
  it('é do Rede para cima', () => {
    expect(temAnaliseAvancada('REDE')).toBe(true)
  })

  it('e não é dos planos abaixo', () => {
    expect(temAnaliseAvancada('GRATIS')).toBe(false)
    expect(temAnaliseAvancada('BALCAO')).toBe(false)
    expect(temAnaliseAvancada('BALCAO_AGENTE')).toBe(false)
  })
})
