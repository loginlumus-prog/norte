// A conta do recibo do crediário (pura): o atraso de cada parcela, o que o
// dinheiro abate e em que ordem, perdão e desconto, e a repartição nas formas.

import { describe, it, expect } from 'vitest'
import {
  contaDasMarcadas,
  encargosDeHoje,
  explicarRecusa,
  planejarRecebimento,
  repartirNasFormas,
  type ParcelaParaReceber,
} from '../src/servidor/recibos-conta'

const coluna = (d: string) => new Date(`${d}T00:00:00.000Z`)
const emSP = (iso: string) => new Date(`${iso}-03:00`)
const REGRA = { multaPct: 2, jurosMes: 3, carenciaDias: 0, arredondar: false }

describe('o atraso de hoje (decisão: multa 2% uma vez + 3% ao mês por dia)', () => {
  const agora = emSP('2026-10-10T12:00:00')

  it('R$ 100 com 30 dias: multa R$ 2 + juro R$ 3', () => {
    const e = encargosDeHoje({ restaC: 10000, vencimento: coluna('2026-09-10'), jurosAte: null, multaCobrada: false }, REGRA, agora)
    expect(e).toEqual({ dias: 30, diasJuros: 30, multaC: 200, jurosC: 300 })
  })

  it('a vencer, ou vencendo hoje, não rende nada', () => {
    expect(encargosDeHoje({ restaC: 10000, vencimento: coluna('2026-10-10'), jurosAte: null, multaCobrada: false }, REGRA, agora)).toMatchObject({ multaC: 0, jurosC: 0 })
    expect(encargosDeHoje({ restaC: 10000, vencimento: coluna('2026-11-10'), jurosAte: null, multaCobrada: false }, REGRA, agora)).toMatchObject({ multaC: 0, jurosC: 0 })
  })

  it('multa já resolvida não volta; juro conta só dos dias depois do último cobrado', () => {
    const e = encargosDeHoje({ restaC: 5000, vencimento: coluna('2026-09-10'), jurosAte: coluna('2026-10-03'), multaCobrada: true }, REGRA, agora)
    expect(e).toEqual({ dias: 30, diasJuros: 7, multaC: 0, jurosC: 35 })
  })

  it('carência: dentro dela nada; passou, conta os dias depois dela', () => {
    const regra = { ...REGRA, carenciaDias: 5 }
    expect(encargosDeHoje({ restaC: 10000, vencimento: coluna('2026-10-06'), jurosAte: null, multaCobrada: false }, regra, agora)).toMatchObject({ dias: 4, multaC: 0, jurosC: 0 })
    expect(encargosDeHoje({ restaC: 10000, vencimento: coluna('2026-09-10'), jurosAte: null, multaCobrada: false }, regra, agora)).toMatchObject({ diasJuros: 25, multaC: 200, jurosC: 250 })
  })

  it('a multa nunca passa de 2%, mesmo com a regra errada', () => {
    const e = encargosDeHoje({ restaC: 10000, vencimento: coluna('2026-09-10'), jurosAte: null, multaCobrada: false }, { ...REGRA, multaPct: 10 }, agora)
    expect(e.multaC).toBe(200)
  })
})

// Três parcelas de R$ 100: duas vencidas (com R$ 5 e R$ 3 de atraso) e uma a vencer.
const P: ParcelaParaReceber[] = [
  { id: 'a', restaC: 10000, multaC: 200, jurosC: 300 },
  { id: 'b', restaC: 10000, multaC: 200, jurosC: 100 },
  { id: 'c', restaC: 10000, multaC: 0, jurosC: 0 },
]

describe('o plano: o que o dinheiro abate', () => {
  it('marcou as duas vencidas e pagou o total: quita as duas, com o atraso', () => {
    const conta = contaDasMarcadas(P, ['a', 'b'], false)
    expect(conta).toMatchObject({ quantas: 2, principalC: 20000, multaC: 400, jurosC: 400, totalC: 20800 })
    const r = planejarRecebimento(P, { marcadas: ['a', 'b'], dinheiroC: 20800 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.linhas.map((l) => [l.id, l.principalC, l.multaC, l.jurosC, l.quita])).toEqual([
      ['a', 10000, 200, 300, true],
      ['b', 10000, 200, 100, true],
    ])
  })

  it('pagou menos: abate na ordem, a última fica parcial (com o atraso dela pago)', () => {
    const r = planejarRecebimento(P, { marcadas: ['a', 'b'], dinheiroC: 15000 })
    expect(r.ok && r.linhas.map((l) => [l.id, l.principalC, l.quita])).toEqual([
      ['a', 10000, true],
      ['b', 4200, false],
    ])
  })

  it('pagou mais que as marcadas: a sobra abate a mais antiga que falta', () => {
    const r = planejarRecebimento(P, { marcadas: ['b'], dinheiroC: 10300 + 5000 })
    expect(r.ok && r.linhas.map((l) => [l.id, l.principalC, l.multaC + l.jurosC])).toEqual([
      ['b', 10000, 300],
      ['a', 4500, 500],
    ])
  })

  it('valor livre sem marcar: das mais antigas', () => {
    const r = planejarRecebimento(P, { marcadas: [], dinheiroC: 11000 })
    expect(r.ok && r.linhas.map((l) => [l.id, l.principalC])).toEqual([
      ['a', 10000],
      ['b', 200],
    ])
  })

  it('dinheiro que não cobre nem o atraso da próxima é recusado, com o número que resolve', () => {
    const r = planejarRecebimento(P, { marcadas: [], dinheiroC: 10600 })
    expect(r).toMatchObject({ ok: false, motivo: 'nao_cobre_atraso', ateAquiC: 10500, minimoC: 10800 })
    if (!r.ok) expect(explicarRecusa(r, (c) => (c / 100).toFixed(2))).toMatch(/105\.00.*108\.00/)
  })

  it('mais que a dívida inteira é recusado (o que sobra em dinheiro é troco)', () => {
    expect(planejarRecebimento(P, { marcadas: [], dinheiroC: 40000 })).toMatchObject({ ok: false, motivo: 'passa_da_divida', maximoC: 30800 })
  })

  it('perdoar o atraso: só das marcadas, do juro primeiro; e fica registrado quanto', () => {
    const r = planejarRecebimento(P, { marcadas: ['a'], dinheiroC: 10000, perdoarAtraso: true })
    expect(r).toMatchObject({ ok: true, perdoadoC: 500, multaC: 0, jurosC: 0 })
    if (r.ok) expect(r.linhas[0]).toMatchObject({ principalC: 10000, quita: true, atrasoResolvido: true })
    const parte = planejarRecebimento(P, { marcadas: ['a'], dinheiroC: 10100, descontoAtrasoC: 400 })
    expect(parte).toMatchObject({ ok: true, perdoadoC: 400, jurosC: 0, multaC: 100 })
  })

  it('desconto no valor só para QUITAR as marcadas', () => {
    const ok = planejarRecebimento(P, { marcadas: ['a', 'b'], dinheiroC: 20800 - 1000, descontoC: 1000 })
    expect(ok).toMatchObject({ ok: true, descontoC: 1000 })
    if (ok.ok) expect(ok.linhas.every((l) => l.quita)).toBe(true)
    const parcial = planejarRecebimento(P, { marcadas: ['a', 'b'], dinheiroC: 15000, descontoC: 1000 })
    expect(parcial).toMatchObject({ ok: false, motivo: 'desconto_sem_quitar' })
    expect(planejarRecebimento(P, { marcadas: [], dinheiroC: 5000, descontoC: 100 })).toMatchObject({ ok: false, motivo: 'desconto_sem_marcar' })
  })

  it('arredondar: o atraso das marcadas sobe para os 10 centavos de cima, uma vez só', () => {
    const Q: ParcelaParaReceber[] = [
      { id: 'x', restaC: 5000, multaC: 100, jurosC: 47 },
      { id: 'y', restaC: 5000, multaC: 100, jurosC: 1 },
    ]
    const c = contaDasMarcadas(Q, ['x', 'y'], true)
    expect(c).toMatchObject({ arredondamentoC: 2, jurosC: 50, totalC: 10250 })
    const r = planejarRecebimento(Q, { marcadas: ['x', 'y'], dinheiroC: 10250, arredondar: true })
    expect(r.ok && r.linhas.map((l) => l.jurosC)).toEqual([47, 3])
  })

  it('baixa externa: o dinheiro abate só o valor, sem atraso e sem perdão', () => {
    const r = planejarRecebimento(P, { marcadas: ['a'], dinheiroC: 10000, semAtraso: true })
    expect(r).toMatchObject({ ok: true, multaC: 0, jurosC: 0, perdoadoC: 0 })
  })
})

describe('as formas: cada pedaço vira um recebimento', () => {
  it('metade no Pix, metade em dinheiro: a primeira forma paga as primeiras parcelas, atraso antes', () => {
    const r = planejarRecebimento(P, { marcadas: ['a', 'b'], dinheiroC: 20800 })
    if (!r.ok) throw new Error('plano')
    const pedacos = repartirNasFormas(r.linhas, [
      { forma: 'PIX', valorC: 12000, maquininha: 'Banco X' },
      { forma: 'DINHEIRO', valorC: 8800 },
    ])
    expect(pedacos.map((x) => [x.parcelaId, x.forma, x.valorC, x.multaC, x.jurosC])).toEqual([
      ['a', 'PIX', 10500, 200, 300],
      ['b', 'PIX', 1500, 200, 100],
      ['b', 'DINHEIRO', 8800, 0, 0],
    ])
    expect(pedacos.reduce((s, x) => s + x.valorC, 0)).toBe(20800)
  })

  it('parcela quitada só com desconto ganha um pedaço de valor zero, com o desconto', () => {
    const Q: ParcelaParaReceber[] = [
      { id: 'x', restaC: 5000, multaC: 0, jurosC: 0 },
      { id: 'y', restaC: 1000, multaC: 0, jurosC: 0 },
    ]
    const r = planejarRecebimento(Q, { marcadas: ['x', 'y'], dinheiroC: 1000, descontoC: 5000 })
    if (!r.ok) throw new Error('plano')
    const pedacos = repartirNasFormas(r.linhas, [{ forma: 'PIX', valorC: 1000 }])
    expect(pedacos.map((x) => [x.parcelaId, x.forma, x.valorC, x.descontoC])).toEqual([
      ['x', 'PIX', 0, 5000],
      ['y', 'PIX', 1000, 0],
    ])
  })
})
