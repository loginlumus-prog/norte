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

// ─────────────────────────────────────────────────────────────
// Auditoria de 25/09: a régua também para instante e para a tela
// ─────────────────────────────────────────────────────────────

import { inicioDoDiaEmSP, mostrarDiaDaColuna, primeiroDoMes } from '../src/servidor/dia'

describe('o começo do dia em São Paulo, sem depender do fuso da máquina', () => {
  it('é 03:00 UTC do próprio dia', () => {
    expect(inicioDoDiaEmSP('2026-09-01').toISOString()).toBe('2026-09-01T03:00:00.000Z')
  })

  it('o primeiro do mês de um dia qualquer', () => {
    expect(primeiroDoMes('2026-09-25')).toBe('2026-09-01')
  })
})

describe('coluna `date` escrita para gente', () => {
  // O vencimento do dia 10 chega como 10/10 00:00 UTC — que em São Paulo é
  // 09/10 às 21h. A tela mostrava "vence 09/10".
  it('mostra o dia gravado, não o dia anterior', () => {
    const vencimento = colunaDoDia('2026-10-10')
    expect(mostrarDiaDaColuna(vencimento)).toBe('10/10')
    expect(mostrarDiaDaColuna(vencimento, 'curto')).toBe('10/10/26')
    expect(mostrarDiaDaColuna(vencimento, 'longo')).toBe('10/10/2026')
  })
})

// ─────────────────────────────────────────────────────────────
// O "hoje" do teto de IA e do teto da conversa (agente.ts, conversa.ts)
// ─────────────────────────────────────────────────────────────

import { inicioDeHojeEmSP } from '../src/servidor/dia'

describe('o começo de HOJE em São Paulo', () => {
  it('às 22h30 da loja, hoje ainda começou à meia-noite dela — não às 21h, que era a meia-noite UTC', () => {
    // `setHours(0, 0, 0, 0)` num servidor em UTC dava 2026-09-17T00:00Z (21h
    // do dia 16 em SP): o gasto das 21h às 22h30 sumia do teto do dia.
    expect(inicioDeHojeEmSP(new Date('2026-09-16T22:30:00-03:00')).toISOString()).toBe('2026-09-16T03:00:00.000Z')
  })

  it('logo depois da meia-noite da loja, já é o dia novo', () => {
    expect(inicioDeHojeEmSP(new Date('2026-09-17T00:05:00-03:00')).toISOString()).toBe('2026-09-17T03:00:00.000Z')
  })
})
