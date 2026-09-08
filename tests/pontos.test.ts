import { describe, it, expect } from 'vitest'
import {
  DESLIGADO,
  pontosGanhos,
  valorEmCentavos,
  oferecer,
  conferirUso,
  quantoCusta,
  type Programa,
} from '../src/servidor/pontos'

// O programa comum: 1 ponto por real, R$ 0,03 o ponto (R$ 3 a cada 100),
// mínimo de 100 para usar. Devolve 3% — é o desenho que a maioria escolhe.
const COMUM: Programa = { ativo: true, porReal: 1, pontoVale: 0.03, minimo: 100 }
// O quebrado, que é onde a conta erra: R$ 0,025 o ponto.
const QUEBRADO: Programa = { ativo: true, porReal: 1, pontoVale: 0.025, minimo: 0 }

describe('desligado não faz nada', () => {
  it('não pontua', () => expect(pontosGanhos(100_00, DESLIGADO)).toBe(0))
  it('não vale nada', () => expect(valorEmCentavos(5000, DESLIGADO)).toBe(0))
  it('não oferece', () => expect(oferecer(5000, 100_00, DESLIGADO).pode).toBe(false))
  it('e recusa uso', () =>
    expect(conferirUso(10, 5000, 100_00, DESLIGADO)).toEqual({
      ok: false,
      motivo: 'programa_desligado',
    }))
})

describe('quantos pontos a venda gera', () => {
  it('R$ 100 a 1 por real dá 100', () => expect(pontosGanhos(100_00, COMUM)).toBe(100))
  it('centavo não vira ponto quebrado', () => expect(pontosGanhos(99_99, COMUM)).toBe(99))
  it('R$ 0,99 não gera nada', () => expect(pontosGanhos(99, COMUM)).toBe(0))
  it('dobro por real dobra', () =>
    expect(pontosGanhos(100_00, { ...COMUM, porReal: 2 })).toBe(200))
  it('meio ponto por real arredonda para baixo', () =>
    expect(pontosGanhos(99_00, { ...COMUM, porReal: 0.5 })).toBe(49))
  it('venda zerada não gera', () => expect(pontosGanhos(0, COMUM)).toBe(0))
})

describe('o que os pontos valem', () => {
  it('100 pontos a R$ 0,03 valem R$ 3,00', () =>
    expect(valorEmCentavos(100, COMUM)).toBe(300))

  // Esta é a razão de a conta ser em milicentavo.
  it('1 ponto a R$ 0,025 vale 2 centavos — e 100 valem R$ 2,50, não R$ 2,00', () => {
    expect(valorEmCentavos(1, QUEBRADO)).toBe(2) // 2,5 cai para 2
    expect(valorEmCentavos(100, QUEBRADO)).toBe(250) // e o total NAO perde a metade
  })

  it('a sobra fica com a loja, nunca ao contrário', () => {
    // 41 pontos × 2,5 centavos = 102,5 centavos. Vira 102, não 103.
    expect(valorEmCentavos(41, QUEBRADO)).toBe(102)
  })

  it('e é por isso que a conta é feita de uma vez, não parcela por parcela', () => {
    // O erro clássico: arredondar cada pedaço e somar. 100 pontos avaliados um
    // a um dariam R$ 2,00 — cinquenta centavos do cliente sumindo no piso.
    let umPorUm = 0
    for (let i = 0; i < 100; i++) umPorUm += valorEmCentavos(1, QUEBRADO)
    expect(umPorUm).toBe(200)
    expect(valorEmCentavos(100, QUEBRADO)).toBe(250)
  })
})

describe('o que dá para oferecer no balcão', () => {
  it('quem tem 500 pontos numa venda de R$ 200 usa os 500 (R$ 15)', () => {
    const o = oferecer(500, 200_00, COMUM)
    expect(o.pode).toBe(true)
    expect(o.pontos).toBe(500)
    expect(o.centavos).toBe(1500)
  })

  // O teto que mais se esquece.
  it('numa venda de R$ 10, quem tem 5.000 pontos usa só o que cabe', () => {
    const o = oferecer(5000, 10_00, COMUM)
    expect(o.pode).toBe(true)
    expect(o.centavos).toBeLessThanOrEqual(10_00)
    expect(o.pontos).toBe(333) // 333 × 3 centavos = R$ 9,99
    expect(o.centavos).toBe(999)
  })

  it('nunca deixa a venda negativa, em nenhum valor', () => {
    for (let venda = 1; venda <= 5000; venda += 7) {
      const o = oferecer(999_999, venda, COMUM)
      expect(o.centavos).toBeLessThanOrEqual(venda)
    }
  })

  it('abaixo do mínimo não oferece, e explica', () => {
    const o = oferecer(80, 200_00, COMUM)
    expect(o.pode).toBe(false)
    expect(o.recado).toContain('80')
    expect(o.recado).toContain('100')
  })

  it('sem saldo não fala nada — não é erro, é o normal', () => {
    const o = oferecer(0, 200_00, COMUM)
    expect(o.pode).toBe(false)
    expect(o.recado).toBeNull()
  })

  it('venda zerada não oferece', () => expect(oferecer(500, 0, COMUM).pode).toBe(false))

  it('ponto que não vale nada não vira oferta', () =>
    expect(oferecer(500, 200_00, { ...COMUM, pontoVale: 0 }).pode).toBe(false))
})

describe('a trava do servidor: o número da tela é pedido, não ordem', () => {
  it('não deixa usar mais do que tem', () =>
    expect(conferirUso(501, 500, 200_00, COMUM)).toEqual({
      ok: false,
      motivo: 'saldo_insuficiente',
    }))

  it('não deixa usar número negativo para GANHAR desconto ao contrário', () =>
    expect(conferirUso(-100, 500, 200_00, COMUM)).toEqual({
      ok: false,
      motivo: 'saldo_insuficiente',
    }))

  it('não deixa passar do valor da venda', () =>
    expect(conferirUso(500, 500, 10_00, COMUM)).toEqual({
      ok: false,
      motivo: 'passa_da_venda',
    }))

  it('respeita o mínimo mesmo quando o pedido é pequeno', () =>
    expect(conferirUso(10, 80, 200_00, COMUM)).toEqual({
      ok: false,
      motivo: 'abaixo_do_minimo',
    }))

  it('o que a oferta propõe, a trava aceita — sempre', () => {
    for (const saldo of [100, 333, 1000, 87_654]) {
      for (const venda of [5_00, 49_90, 200_00, 1_999_00]) {
        const o = oferecer(saldo, venda, COMUM)
        if (!o.pode) continue
        const r = conferirUso(o.pontos, saldo, venda, COMUM)
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.centavos).toBe(o.centavos)
      }
    }
  })
})

describe('quanto o programa custa à loja', () => {
  it('1 por real a R$ 0,03 devolve 3%', () => expect(quantoCusta(COMUM)).toBeCloseTo(3))
  it('1 por real a R$ 0,10 devolve 10% — come a margem', () =>
    expect(quantoCusta({ ...COMUM, pontoVale: 0.1 })).toBeCloseTo(10))
  it('2 por real a R$ 0,03 devolve 6%', () =>
    expect(quantoCusta({ ...COMUM, porReal: 2 })).toBeCloseTo(6))
  it('desligado não custa nada', () => expect(quantoCusta(DESLIGADO)).toBe(0))
})

describe('a rodada inteira: ganha, junta, usa', () => {
  it('quem gasta R$ 1.000 junta 1.000 pontos e abate R$ 30 na próxima', () => {
    let saldo = 0
    for (let i = 0; i < 10; i++) saldo += pontosGanhos(100_00, COMUM)
    expect(saldo).toBe(1000)

    const o = oferecer(saldo, 89_90, COMUM)
    expect(o.pontos).toBe(1000)
    expect(o.centavos).toBe(3000)

    // E a venda seguinte pontua em cima do que sobrou de verdade.
    const pagou = 89_90 - o.centavos
    expect(pontosGanhos(pagou, COMUM)).toBe(59)
  })
})
