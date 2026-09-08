import { describe, it, expect } from 'vitest'
import { janela, lerPeriodo, PERIODOS, type Periodo } from '../src/servidor/periodo'

// Uma quarta-feira comum, 15h30. A hora importa: janela não pode depender dela.
const AGORA = new Date(2026, 8, 9, 15, 30, 12, 345) // 09/09/2026

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

describe('o que chega do endereço', () => {
  it('vazio vira 30 dias', () => expect(lerPeriodo(undefined)).toBe('30d'))
  it('lixo vira 30 dias', () => expect(lerPeriodo('; drop table')).toBe('30d'))
  it('o que vale passa', () => expect(lerPeriodo('mes-passado')).toBe('mes-passado'))
})

describe('toda janela começa e termina à meia-noite', () => {
  it('a hora em que a tela abriu não muda o recorte', () => {
    for (const { chave } of PERIODOS) {
      const cedo = janela(chave, new Date(2026, 8, 9, 0, 0, 1))
      const tarde = janela(chave, new Date(2026, 8, 9, 23, 59, 59))
      expect(iso(cedo.de)).toBe(iso(tarde.de))
      expect(iso(cedo.ate)).toBe(iso(tarde.ate))
    }
  })

  it('e nenhuma ponta carrega hora', () => {
    for (const { chave } of PERIODOS) {
      const j = janela(chave, AGORA)
      for (const d of [j.de, j.ate, j.deAnterior, j.ateAnterior]) {
        expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([
          0, 0, 0, 0,
        ])
      }
    }
  })
})

describe('o fim é EXCLUSIVO — a venda das 23h50 de hoje entra', () => {
  it('hoje vai de hoje 00:00 até amanhã 00:00', () => {
    const j = janela('hoje', AGORA)
    expect(iso(j.de)).toBe('2026-09-09 00:00')
    expect(iso(j.ate)).toBe('2026-09-10 00:00')
  })

  it('a venda das 23h50 de hoje está dentro', () => {
    const j = janela('hoje', AGORA)
    const venda = new Date(2026, 8, 9, 23, 50)
    expect(venda >= j.de && venda < j.ate).toBe(true)
  })

  it('e a de 00h01 de amanhã está fora', () => {
    const j = janela('hoje', AGORA)
    const venda = new Date(2026, 8, 10, 0, 1)
    expect(venda >= j.de && venda < j.ate).toBe(false)
  })
})

describe('a janela de comparação tem o MESMO tamanho', () => {
  it('em todos os períodos de dias corridos', () => {
    for (const chave of ['hoje', '7d', '30d', '90d'] as Periodo[]) {
      const j = janela(chave, AGORA)
      const atual = (j.ate.getTime() - j.de.getTime()) / 864e5
      const antes = (j.ateAnterior.getTime() - j.deAnterior.getTime()) / 864e5
      expect(antes).toBe(atual)
    }
  })

  it('e ela encosta imediatamente antes, sem buraco nem sobreposição', () => {
    for (const chave of ['hoje', '7d', '30d', '90d', 'mes-passado'] as Periodo[]) {
      const j = janela(chave, AGORA)
      expect(j.ateAnterior.getTime()).toBe(j.de.getTime())
    }
  })
})

describe('30 dias inclui hoje e conta 30, não 31', () => {
  it('de 11/08 a 09/09', () => {
    const j = janela('30d', AGORA)
    expect(iso(j.de)).toBe('2026-08-11 00:00')
    expect(iso(j.ate)).toBe('2026-09-10 00:00')
    expect(j.dias).toBe(30)
  })

  it('7 dias conta 7', () => expect(janela('7d', AGORA).dias).toBe(7))
  it('e hoje conta 1', () => expect(janela('hoje', AGORA).dias).toBe(1))
})

describe('o mês em curso termina hoje, não no dia 31', () => {
  // Este é o erro que faz o painel anunciar queda todo dia 2 do mês.
  it('vai do dia 1 até amanhã', () => {
    const j = janela('mes', AGORA)
    expect(iso(j.de)).toBe('2026-09-01 00:00')
    expect(iso(j.ate)).toBe('2026-09-10 00:00')
  })

  it('e a comparação é o MESMO pedaço do mês passado, não 30 dias atrás', () => {
    const j = janela('mes', AGORA)
    expect(iso(j.deAnterior)).toBe('2026-08-01 00:00')
    // 9 dias corridos de agosto, para bater com os 9 de setembro.
    expect(iso(j.ateAnterior)).toBe('2026-08-10 00:00')
  })

  it('no dia 1 o mês tem um dia só', () => {
    const j = janela('mes', new Date(2026, 8, 1, 10, 0))
    expect(j.dias).toBe(1)
    expect(iso(j.deAnterior)).toBe('2026-08-01 00:00')
    expect(iso(j.ateAnterior)).toBe('2026-08-02 00:00')
  })
})

describe('mês passado é o mês fechado', () => {
  it('agosto inteiro, e a comparação é julho inteiro', () => {
    const j = janela('mes-passado', AGORA)
    expect(iso(j.de)).toBe('2026-08-01 00:00')
    expect(iso(j.ate)).toBe('2026-09-01 00:00')
    expect(iso(j.deAnterior)).toBe('2026-07-01 00:00')
    expect(iso(j.ateAnterior)).toBe('2026-08-01 00:00')
  })

  it('em janeiro, o mês passado é dezembro do ano anterior', () => {
    const j = janela('mes-passado', new Date(2026, 0, 15))
    expect(iso(j.de)).toBe('2025-12-01 00:00')
    expect(iso(j.ate)).toBe('2026-01-01 00:00')
    expect(iso(j.deAnterior)).toBe('2025-11-01 00:00')
  })

  it('e fevereiro de ano bissexto tem 29 dias', () => {
    const j = janela('mes-passado', new Date(2028, 2, 10))
    expect(j.dias).toBe(29)
  })
})

describe('a virada do ano não quebra nada', () => {
  it('30 dias em 5 de janeiro atravessa para dezembro', () => {
    const j = janela('30d', new Date(2026, 0, 5, 12, 0))
    expect(iso(j.de)).toBe('2025-12-07 00:00')
    expect(iso(j.ate)).toBe('2026-01-06 00:00')
    expect(j.dias).toBe(30)
  })
})

describe('gráfico por dia', () => {
  it('não faz sentido num dia só', () => expect(janela('hoje', AGORA).temGrafico).toBe(false))
  it('faz nos outros', () => {
    for (const chave of ['7d', '30d', '90d', 'mes-passado'] as Periodo[]) {
      expect(janela(chave, AGORA).temGrafico).toBe(true)
    }
  })
})
