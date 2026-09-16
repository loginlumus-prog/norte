// A conta de preço.
//
// Margem e markup são os dois números que o varejo pequeno mais confunde, e
// a confusão não aparece na venda — aparece no fim do mês. Estes testes são
// a régua: custo 60 a preço 100 é margem 40 e markup 67, sempre.

import { describe, it, expect } from 'vitest'
import {
  analisarPreco,
  lerAlvo,
  resumirPrecos,
  ordenarPorUrgenciaDePreco,
  ALVO_PADRAO,
  type AnalisePreco,
} from '../src/servidor/precificacao'

describe('analisarPreco', () => {
  it('sem custo não tem conta nenhuma — e diz isso', () => {
    const a = analisarPreco({ custoCent: null, precoCent: 10000, alvoPct: 40 })
    expect(a.situacao).toBe('sem_custo')
    expect(a.margemPct).toBeNull()
    expect(a.markupPct).toBeNull()
    expect(a.sugeridoCent).toBeNull()
    expect(a.diferencaCent).toBeNull()
  })

  it('custo zero conta como sem custo', () => {
    // Zero é o que sobra do cadastro apressado. Tratar como custo daria
    // markup infinito e um produto "perfeito" que ninguém sabe quanto custou.
    expect(analisarPreco({ custoCent: 0, precoCent: 10000, alvoPct: 40 }).situacao).toBe('sem_custo')
  })

  it('custo 60 a preço 100: margem 40, markup 67', () => {
    const a = analisarPreco({ custoCent: 6000, precoCent: 10000, alvoPct: 40 })
    expect(a.margemPct).toBeCloseTo(40, 6)
    expect(a.markupPct).toBeCloseTo(66.6667, 3)
    expect(a.situacao).toBe('no_alvo')
  })

  it('preço abaixo do custo é prejuízo em cada venda', () => {
    const a = analisarPreco({ custoCent: 6000, precoCent: 5000, alvoPct: 40 })
    expect(a.situacao).toBe('abaixo_do_custo')
    expect(a.margemPct).toBeCloseTo(-20, 6)
    expect(a.markupPct).toBeCloseTo(-16.6667, 3)
    // sugerido 100,00 − preço 50,00 = precisa subir 50,00
    expect(a.diferencaCent).toBe(5000)
  })

  it('preço igual ao custo não é abaixo do custo — é margem zero', () => {
    const a = analisarPreco({ custoCent: 6000, precoCent: 6000, alvoPct: 40 })
    expect(a.situacao).toBe('abaixo_do_alvo')
    expect(a.margemPct).toBe(0)
  })

  it('abaixo do alvo quando a margem existe mas não chega', () => {
    // custo 60, preço 80 → margem 25%
    const a = analisarPreco({ custoCent: 6000, precoCent: 8000, alvoPct: 40 })
    expect(a.situacao).toBe('abaixo_do_alvo')
    expect(a.margemPct).toBeCloseTo(25, 6)
    expect(a.diferencaCent).toBe(2000)
  })

  it('a folga de um ponto: 39% está no alvo de 40, 38,9% não', () => {
    // 61,00 a 100,00 → 39% exatos
    expect(analisarPreco({ custoCent: 6100, precoCent: 10000, alvoPct: 40 }).situacao).toBe('no_alvo')
    // 61,10 a 100,00 → 38,9%
    expect(analisarPreco({ custoCent: 6110, precoCent: 10000, alvoPct: 40 }).situacao).toBe('abaixo_do_alvo')
  })

  it('alvo 40 com custo 60,00 sugere exatamente 100,00', () => {
    // A conta com 0,6 daria 10000,000000000002 e o teto viraria 100,01.
    expect(analisarPreco({ custoCent: 6000, precoCent: 9000, alvoPct: 40 }).sugeridoCent).toBe(10000)
  })

  it('o sugerido arredonda para cima ao centavo', () => {
    // custo 10,00 a 30% → 14,2857… → 14,29, nunca 14,28 (que não dá 30%)
    const a = analisarPreco({ custoCent: 1000, precoCent: 1000, alvoPct: 30 })
    expect(a.sugeridoCent).toBe(1429)
    // e o preço sugerido de fato entrega a margem pedida
    const conferida = analisarPreco({ custoCent: 1000, precoCent: 1429, alvoPct: 30 })
    expect(conferida.margemPct!).toBeGreaterThanOrEqual(30)
  })

  it('a diferença é sugerido menos preço, com sinal', () => {
    // já acima do alvo: diferença negativa (pode baixar, não precisa subir)
    const a = analisarPreco({ custoCent: 5000, precoCent: 10000, alvoPct: 40 })
    expect(a.sugeridoCent).toBe(8334)
    expect(a.diferencaCent).toBe(-1666)
    expect(a.situacao).toBe('no_alvo')
  })

  it('margem e markup são coerentes entre si', () => {
    // margem m e markup k do mesmo par obedecem k = m / (1 − m)
    const a = analisarPreco({ custoCent: 4490, precoCent: 7990, alvoPct: 40 })
    const m = a.margemPct! / 100
    const k = a.markupPct! / 100
    expect(k).toBeCloseTo(m / (1 - m), 9)
  })

  it('preço zero com custo não divide por zero', () => {
    const a = analisarPreco({ custoCent: 6000, precoCent: 0, alvoPct: 40 })
    expect(a.situacao).toBe('abaixo_do_custo')
    expect(a.margemPct).toBeNull()
    expect(Number.isFinite(a.markupPct!)).toBe(true)
  })
})

describe('lerAlvo', () => {
  it('vazio e ausente caem no padrão', () => {
    expect(lerAlvo(undefined)).toBe(ALVO_PADRAO)
    expect(lerAlvo('')).toBe(ALVO_PADRAO)
    expect(lerAlvo('   ')).toBe(ALVO_PADRAO)
  })

  it('lixo cai no padrão', () => {
    expect(lerAlvo('abc')).toBe(ALVO_PADRAO)
    expect(lerAlvo('40abc')).toBe(ALVO_PADRAO)
    expect(lerAlvo('-10')).toBe(ALVO_PADRAO)
    expect(lerAlvo('1e3')).toBe(ALVO_PADRAO)
  })

  it('número dentro da faixa passa inteiro', () => {
    expect(lerAlvo('35')).toBe(35)
    expect(lerAlvo(' 55 ')).toBe(55)
    expect(lerAlvo('5')).toBe(5)
    expect(lerAlvo('90')).toBe(90)
  })

  it('fora da faixa encosta na borda', () => {
    expect(lerAlvo('0')).toBe(5)
    expect(lerAlvo('2')).toBe(5)
    expect(lerAlvo('95')).toBe(90)
    expect(lerAlvo('1000')).toBe(90)
  })

  it('decimal vira inteiro', () => {
    expect(lerAlvo('40.6')).toBe(41)
    expect(lerAlvo('40,4')).toBe(40)
  })
})

describe('resumirPrecos', () => {
  const linha = (precoCent: number, custoCent: number | null, alvoPct = 40) => ({
    precoCent,
    analise: analisarPreco({ custoCent, precoCent, alvoPct }),
  })

  it('vazio dá zeros e média nula', () => {
    expect(resumirPrecos([])).toEqual({
      itens: 0, semCusto: 0, abaixoDoCusto: 0, abaixoDoAlvo: 0, noAlvo: 0, margemMedia: null,
    })
  })

  it('conta cada situação', () => {
    const r = resumirPrecos([
      linha(10000, 6000), // no alvo
      linha(8000, 6000), // abaixo do alvo
      linha(5000, 6000), // abaixo do custo
      linha(10000, null), // sem custo
      linha(10000, 5000), // no alvo
    ])
    expect(r.itens).toBe(5)
    expect(r.noAlvo).toBe(2)
    expect(r.abaixoDoAlvo).toBe(1)
    expect(r.abaixoDoCusto).toBe(1)
    expect(r.semCusto).toBe(1)
  })

  it('a média é ponderada pelo preço', () => {
    // pulseira de 10,00 com 50% e casaco de 90,00 com 10%: a média simples
    // diria 30%; ponderada pelo dinheiro que passa pelo caixa é 14%.
    const r = resumirPrecos([linha(1000, 500), linha(9000, 8100)])
    expect(r.margemMedia).toBeCloseTo(14, 6)
  })

  it('quem não tem custo não entra na média', () => {
    const r = resumirPrecos([linha(10000, 6000), linha(50000, null)])
    expect(r.margemMedia).toBeCloseTo(40, 6)
  })

  it('só sem custo: média nula, não zero', () => {
    expect(resumirPrecos([linha(10000, null)]).margemMedia).toBeNull()
  })
})

describe('ordenarPorUrgenciaDePreco', () => {
  const com = (nome: string, situacao: AnalisePreco['situacao'], diferencaCent: number | null) => ({
    nome,
    analise: { margemPct: null, markupPct: null, sugeridoCent: null, diferencaCent, situacao } as AnalisePreco,
  })

  it('prejuízo primeiro, depois abaixo do alvo, depois sem custo, depois no alvo', () => {
    const r = ordenarPorUrgenciaDePreco([
      com('d', 'no_alvo', -100),
      com('c', 'sem_custo', null),
      com('b', 'abaixo_do_alvo', 500),
      com('a', 'abaixo_do_custo', 5000),
    ])
    expect(r.map((l) => l.nome)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('dentro do grupo, a maior diferença primeiro; empate por nome', () => {
    const r = ordenarPorUrgenciaDePreco([
      com('z', 'abaixo_do_alvo', 100),
      com('a', 'abaixo_do_alvo', 100),
      com('m', 'abaixo_do_alvo', 900),
    ])
    expect(r.map((l) => l.nome)).toEqual(['m', 'a', 'z'])
  })

  it('não mexe na lista original', () => {
    const original = [com('b', 'no_alvo', 0), com('a', 'abaixo_do_custo', 1)]
    ordenarPorUrgenciaDePreco(original)
    expect(original[0]!.nome).toBe('b')
  })
})
