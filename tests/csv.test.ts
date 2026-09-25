import { describe, it, expect } from 'vitest'
import { celula } from '../src/servidor/csv'

// A planilha que o contador abre. Dois defeitos achados na auditoria de 25/09.

describe('datas na planilha', () => {
  // Coluna `date` chega como meia-noite UTC; no relógio de São Paulo isso é
  // 21h do dia anterior. O aniversário de 15/03 saía "14/03/1990 21:00".
  it('coluna de data sai com o dia gravado, sem hora', () => {
    expect(celula(new Date('1990-03-15T00:00:00.000Z'))).toBe('15/03/1990')
  })

  it('instante sai no relógio de São Paulo, qualquer que seja o fuso da máquina', () => {
    // 01:30 UTC do dia 1º é 22:30 do dia 30 em São Paulo.
    expect(celula(new Date('2026-10-01T01:30:00.000Z'))).toBe('30/09/2026 22:30')
  })
})

describe('texto que o Excel leria como fórmula', () => {
  it('ganha um apóstrofo e vira texto', () => {
    expect(celula('=HYPERLINK("http://x","clique")')).toBe(`"'=HYPERLINK(""http://x"",""clique"")"`)
    expect(celula('@SOMA(A1)')).toBe("'@SOMA(A1)")
  })

  it('número e telefone passam como estão', () => {
    expect(celula('-5')).toBe('-5')
    expect(celula('+55 71 99999-0001')).toBe('+55 71 99999-0001')
    expect(celula('Ana')).toBe('Ana')
  })
})
