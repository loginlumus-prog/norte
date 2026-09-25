import { describe, it, expect } from 'vitest'
import { montarParcelas, diasDeAtraso, jurosDeAtraso } from '../src/servidor/crediario'

const hoje = new Date(2026, 8, 11) // 11/09/2026

describe('montar as parcelas', () => {
  it('divide igual quando divide certo', () => {
    const p = montarParcelas(30000, 3, hoje, 30)
    expect(p.map((x) => x.valorCent)).toEqual([10000, 10000, 10000])
    expect(p.map((x) => `${x.numero}/${x.de}`)).toEqual(['1/3', '2/3', '3/3'])
  })

  it('o centavo que sobra vai para as primeiras parcelas', () => {
    const p = montarParcelas(10000, 3, hoje, 30)
    expect(p.map((x) => x.valorCent)).toEqual([3334, 3333, 3333])
    expect(p.reduce((s, x) => s + x.valorCent, 0)).toBe(10000)
  })

  // O vencimento sai como a coluna `date` guarda: meia-noite UTC do dia.
  const dia = (d: string) => new Date(`${d}T00:00:00.000Z`)
  const meioDiaSP = new Date('2026-09-11T12:00:00-03:00')

  it('os vencimentos andam em dias de calendário a partir de hoje', () => {
    const p = montarParcelas(9000, 3, meioDiaSP, 30)
    expect(p[0]!.vencimento).toEqual(dia('2026-10-11'))
    expect(p[1]!.vencimento).toEqual(dia('2026-11-10'))
    expect(p[2]!.vencimento).toEqual(dia('2026-12-10'))
  })

  it('uma parcela só é o total inteiro, para daqui a N dias', () => {
    const p = montarParcelas(5990, 1, meioDiaSP, 15)
    expect(p).toHaveLength(1)
    expect(p[0]!.valorCent).toBe(5990)
    expect(p[0]!.vencimento).toEqual(dia('2026-09-26'))
  })

  // A venda das 22h em São Paulo já é o dia seguinte em UTC. O "hoje" da
  // parcela é o da loja — senão a primeira vencia um dia depois do combinado.
  it('a venda das 22h em São Paulo conta a partir do dia da loja', () => {
    const as22h = new Date('2026-09-11T22:00:00-03:00')
    expect(montarParcelas(1000, 1, as22h, 30)[0]!.vencimento).toEqual(dia('2026-10-11'))
  })

  it('total zero ou parcela zero não monta nada', () => {
    expect(montarParcelas(0, 3, hoje, 30)).toEqual([])
    expect(montarParcelas(1000, 0, hoje, 30)).toEqual([])
  })
})

describe('atraso', () => {
  it('o dia do vencimento ainda não é atraso', () => {
    expect(diasDeAtraso(new Date(2026, 8, 11), hoje)).toBe(0)
    expect(diasDeAtraso(new Date(2026, 8, 11, 23, 59), hoje)).toBe(0)
  })

  it('conta dias de calendário depois', () => {
    expect(diasDeAtraso(new Date(2026, 8, 1), hoje)).toBe(10)
    expect(diasDeAtraso(new Date(2026, 7, 11), hoje)).toBe(31)
  })

  it('a vencer não é negativo', () => {
    expect(diasDeAtraso(new Date(2026, 9, 1), hoje)).toBe(0)
  })
})

describe('juro de atraso', () => {
  it('3% ao mês sobre R$ 100, 30 dias, é R$ 3', () => {
    expect(jurosDeAtraso(10000, 30, 3)).toBe(300)
  })

  it('proporcional aos dias, para baixo', () => {
    expect(jurosDeAtraso(10000, 10, 3)).toBe(100)
    expect(jurosDeAtraso(10000, 1, 3)).toBe(10)
    expect(jurosDeAtraso(999, 1, 3)).toBe(0)
  })

  it('sem atraso, sem taxa ou sem resto: zero', () => {
    expect(jurosDeAtraso(10000, 0, 3)).toBe(0)
    expect(jurosDeAtraso(10000, 30, 0)).toBe(0)
    expect(jurosDeAtraso(0, 30, 3)).toBe(0)
  })
})

// ── o dia, do jeito que o banco devolve ─────────────────────
// Coluna `date` chega como meia-noite UTC. Os testes de cima montam datas no
// horário local e por isso não pegavam o defeito: a parcela que vence hoje
// aparecia vencida desde a madrugada, e o atraso contava um dia a mais.
describe('atraso com a data como vem do banco', () => {
  const coluna = (dia: string) => new Date(`${dia}T00:00:00.000Z`)
  const emSP = (iso: string) => new Date(`${iso}-03:00`)

  it('vence hoje não é atraso, de madrugada nem à noite', () => {
    expect(diasDeAtraso(coluna('2026-09-25'), emSP('2026-09-25T00:30:00'))).toBe(0)
    expect(diasDeAtraso(coluna('2026-09-25'), emSP('2026-09-25T23:30:00'))).toBe(0)
  })

  it('o dia seguinte é um dia de atraso, e não dois', () => {
    expect(diasDeAtraso(coluna('2026-09-25'), emSP('2026-09-26T00:10:00'))).toBe(1)
    expect(diasDeAtraso(coluna('2026-09-25'), emSP('2026-09-26T23:50:00'))).toBe(1)
  })

  it('atravessa o mês certo', () => {
    expect(diasDeAtraso(coluna('2026-08-31'), emSP('2026-09-30T12:00:00'))).toBe(30)
  })
})
