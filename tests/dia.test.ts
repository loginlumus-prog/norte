import { describe, it, expect } from 'vitest'
import { colunaDoDia, diaDaColuna, diaEmSP, diasEntre, somarDias } from '../src/servidor/dia'

describe('o dia no calendário da loja', () => {
  it('hoje é o dia em São Paulo, não em Londres', () => {
    // 01:30 UTC do dia 26 ainda é 22:30 do dia 25 em São Paulo.
    expect(diaEmSP(new Date('2026-09-26T01:30:00Z'))).toBe('2026-09-25')
    expect(diaEmSP(new Date('2026-09-26T03:00:00Z'))).toBe('2026-09-26')
  })

  it('a coluna date é lida pela parte de data em UTC', () => {
    expect(diaDaColuna(new Date('2026-09-25T00:00:00Z'))).toBe('2026-09-25')
    expect(diaDaColuna(colunaDoDia('2026-02-28'))).toBe('2026-02-28')
  })

  it('soma e conta dias atravessando mês e ano', () => {
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01')
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(diasEntre('2026-09-25', '2026-10-05')).toBe(10)
    expect(diasEntre('2026-10-05', '2026-09-25')).toBe(-10)
  })

  it('texto no formato AAAA-MM-DD se compara direto', () => {
    expect('2026-09-24' < '2026-09-25').toBe(true)
    expect('2026-09-30' < '2026-10-01').toBe(true)
  })
})
