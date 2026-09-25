import { describe, it, expect } from 'vitest'
import {
  aGerar,
  chaveDate,
  mesSeguinte,
  mesValido,
  primeiroVencimento,
  situacaoDoVencimento,
  validarRecorrente,
  vencimentoNoMes,
  type RecorrenteParaGerar,
} from '../src/servidor/recorrentes'

// A conta recorrente é a promessa de "você não precisa mais lembrar". Estes
// testes conferem o que, errado, vira multa (vencimento no dia errado),
// alarme falso (conta pausada ou encerrada que continua nascendo) ou conta em
// dobro (gerar duas vezes o mesmo mês).

const dia = (d: Date) => chaveDate(d)

const conta = (p: Partial<RecorrenteParaGerar> = {}): RecorrenteParaGerar => ({
  id: 'r1',
  ativo: true,
  diaVencimento: 10,
  ateEm: null,
  criadoEm: new Date('2026-01-01T12:00:00.000Z'),
  ...p,
})

describe('o vencimento no mês', () => {
  it('dia 31 em fevereiro cai no último dia — 28, ou 29 no bissexto', () => {
    expect(dia(vencimentoNoMes(31, 2027, 2))).toBe('2027-02-28')
    expect(dia(vencimentoNoMes(31, 2028, 2))).toBe('2028-02-29')
  })

  it('dia 30 e 29 em fevereiro também', () => {
    expect(dia(vencimentoNoMes(30, 2027, 2))).toBe('2027-02-28')
    expect(dia(vencimentoNoMes(29, 2027, 2))).toBe('2027-02-28')
    expect(dia(vencimentoNoMes(29, 2028, 2))).toBe('2028-02-29')
  })

  it('dia 31 em mês de 30 cai no 30; em mês de 31, no 31', () => {
    expect(dia(vencimentoNoMes(31, 2026, 4))).toBe('2026-04-30')
    expect(dia(vencimentoNoMes(31, 2026, 9))).toBe('2026-09-30')
    expect(dia(vencimentoNoMes(31, 2026, 10))).toBe('2026-10-31')
    expect(dia(vencimentoNoMes(31, 2026, 12))).toBe('2026-12-31')
  })

  it('é meia-noite UTC do dia — o formato de uma coluna DATE, em qualquer fuso do servidor', () => {
    expect(vencimentoNoMes(5, 2026, 10).toISOString()).toBe('2026-10-05T00:00:00.000Z')
  })

  it('o mês seguinte vira o ano', () => {
    expect(mesSeguinte('2026-12')).toBe('2027-01')
    expect(mesSeguinte('2026-09')).toBe('2026-10')
  })
})

describe('o que gerar', () => {
  it('gera a conta ativa com o vencimento do mês', () => {
    expect(aGerar([conta({ diaVencimento: 31 })], [], '2027-02')).toEqual([
      { recorrenteId: 'r1', vencimento: new Date('2027-02-28T00:00:00.000Z') },
    ])
  })

  it('conta pausada (inativa) não gera', () => {
    expect(aGerar([conta({ ativo: false })], [], '2026-10')).toEqual([])
  })

  it('respeita o "até quando": gera até o mês dele, e para depois', () => {
    const ate = conta({ diaVencimento: 10, ateEm: new Date('2027-03-10T00:00:00.000Z') })
    expect(aGerar([ate], [], '2027-03')).toHaveLength(1)
    expect(aGerar([ate], [], '2027-04')).toEqual([])
    // "até 05/03" e vencimento dia 10: março já passou do limite.
    const antes = conta({ diaVencimento: 10, ateEm: new Date('2027-03-05T00:00:00.000Z') })
    expect(aGerar([antes], [], '2027-03')).toEqual([])
    expect(aGerar([antes], [], '2027-02')).toHaveLength(1)
  })

  it('não inventa conta já vencida: vencimento antes do dia do cadastro não nasce', () => {
    // Cadastrada em 24/09 (em São Paulo), vence dia 10: setembro fica de fora, outubro entra.
    const nova = conta({ diaVencimento: 10, criadoEm: new Date('2026-09-24T15:00:00.000Z') })
    expect(aGerar([nova], [], '2026-09')).toEqual([])
    expect(aGerar([nova], [], '2026-10')).toHaveLength(1)
    // Vence dia 24 e foi cadastrada no dia 24: vence hoje, nasce.
    expect(aGerar([conta({ diaVencimento: 24, criadoEm: new Date('2026-09-24T15:00:00.000Z') })], [], '2026-09')).toHaveLength(1)
  })

  it('o dia do cadastro é o da loja: 23h de 24/09 em São Paulo ainda é 24/09', () => {
    // 02:00 UTC de 25/09 = 23:00 de 24/09 em São Paulo.
    const tarde = conta({ diaVencimento: 24, criadoEm: new Date('2026-09-25T02:00:00.000Z') })
    expect(aGerar([tarde], [], '2026-09')).toHaveLength(1)
  })

  it('idempotente: rodar de novo com o que já foi gerado não gera nada', () => {
    const contas = [conta({ id: 'aluguel', diaVencimento: 5 }), conta({ id: 'internet', diaVencimento: 31 })]
    const primeira = aGerar(contas, [], '2027-02')
    expect(primeira).toHaveLength(2)
    expect(aGerar(contas, primeira, '2027-02')).toEqual([])
  })

  it('o vínculo é conta + mês: o de janeiro não impede fevereiro, e o de outra conta não conta', () => {
    const contas = [conta({ id: 'aluguel' })]
    const janeiro = [{ recorrenteId: 'aluguel', vencimento: new Date('2027-01-10T00:00:00.000Z') }]
    expect(aGerar(contas, janeiro, '2027-02')).toHaveLength(1)
    const outra = [{ recorrenteId: 'internet', vencimento: new Date('2027-02-10T00:00:00.000Z') }]
    expect(aGerar(contas, outra, '2027-02')).toHaveLength(1)
    const lancadoAMao = [{ recorrenteId: null, vencimento: new Date('2027-02-10T00:00:00.000Z') }]
    expect(aGerar(contas, lancadoAMao, '2027-02')).toHaveLength(1)
  })

  it('mês inválido não gera nada', () => {
    expect(aGerar([conta()], [], '2027-13')).toEqual([])
    expect(aGerar([conta()], [], '2027-2')).toEqual([])
    expect(mesValido('2027-02')).toBe(true)
    expect(mesValido('2027-00')).toBe(false)
  })
})

describe('o primeiro vencimento de uma conta nova', () => {
  const agora = new Date('2026-09-24T15:00:00.000Z') // 12:00 de 24/09 em São Paulo
  it('dia que ainda vem neste mês: este mês', () => {
    expect(dia(primeiroVencimento(30, agora))).toBe('2026-09-30')
    expect(dia(primeiroVencimento(24, agora))).toBe('2026-09-24')
  })
  it('dia que já passou: o mês que vem', () => {
    expect(dia(primeiroVencimento(5, agora))).toBe('2026-10-05')
  })
})

describe('validar a conta', () => {
  const base = { descricao: 'Aluguel', categoriaId: 'cat-1', valor: 2500, diaVencimento: 5 }

  it('o caso comum passa', () => {
    expect(validarRecorrente(base).ok).toBe(true)
  })

  it('dia fora de 1 a 31, valor zero e descrição vazia são recusados', () => {
    expect(validarRecorrente({ ...base, diaVencimento: 0 }).ok).toBe(false)
    expect(validarRecorrente({ ...base, diaVencimento: 32 }).ok).toBe(false)
    expect(validarRecorrente({ ...base, diaVencimento: 5.5 }).ok).toBe(false)
    expect(validarRecorrente({ ...base, valor: 0 }).ok).toBe(false)
    expect(validarRecorrente({ ...base, valor: Number.NaN }).ok).toBe(false)
    expect(validarRecorrente({ ...base, descricao: '  ' }).ok).toBe(false)
    expect(validarRecorrente({ ...base, categoriaId: '' }).ok).toBe(false)
  })

  it('"até quando" vira DATE e data que não existe é recusada', () => {
    const r = validarRecorrente({ ...base, ateEm: '2027-03-31' })
    expect(r.ok && r.limpo.ateEm?.toISOString()).toBe('2027-03-31T00:00:00.000Z')
    expect(validarRecorrente({ ...base, ateEm: '2027-02-30' }).ok).toBe(false)
    expect(validarRecorrente({ ...base, ateEm: '' }).ok).toBe(true)
  })
})

describe('vencida, vence hoje ou a vencer — pelo dia da loja', () => {
  // Coluna DATE lida pelo Prisma: meia-noite UTC do dia.
  const venc = (dia: string) => new Date(`${dia}T00:00:00.000Z`)
  // 00:30 e 23:30 de 25/09 em São Paulo (UTC-3).
  const madrugada = new Date('2026-09-25T03:30:00.000Z')
  const noite = new Date('2026-09-26T02:30:00.000Z')

  it('a conta que vence hoje fica em "vence hoje" às 00:30 — não em "vencida"', () => {
    expect(situacaoDoVencimento(venc('2026-09-25'), madrugada)).toBe('hoje')
  })

  it('e continua "vence hoje" às 23:30, quando em UTC já é o dia seguinte', () => {
    expect(situacaoDoVencimento(venc('2026-09-25'), noite)).toBe('hoje')
  })

  it('ontem é vencida; amanhã é a vencer — nas duas horas', () => {
    for (const agora of [madrugada, noite]) {
      expect(situacaoDoVencimento(venc('2026-09-24'), agora)).toBe('vencida')
      expect(situacaoDoVencimento(venc('2026-09-26'), agora)).toBe('a vencer')
    }
  })

  it('o vencimento gerado pela recorrente cai na mesma régua', () => {
    expect(situacaoDoVencimento(vencimentoNoMes(25, 2026, 9), madrugada)).toBe('hoje')
    expect(situacaoDoVencimento(vencimentoNoMes(31, 2026, 9), noite)).toBe('a vencer')
  })
})
