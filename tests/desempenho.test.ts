// A conta das estrelas, conferida.
//
// É a única parte do desempenho que pode sair errada de um jeito que ninguém
// nota: meia estrela a menos não parece defeito, parece opinião — e vira
// conversa difícil na loja. Por isso cada regra tem o seu caso aqui.

import { describe, it, expect } from 'vitest'
import { estrelas, NIVEL, PESOS, TETO_DIAS, diasDoMesAte, janelaDoMes, semDados, ultimosMeses, type Insumos } from '../src/servidor/desempenho'

const so = (parte: Partial<Insumos>): Insumos => ({ meta: null, tarefas: null, presenca: null, ...parte })

// ─────────────────────────────────────────────────────────────
// UM COMPONENTE SÓ
// ─────────────────────────────────────────────────────────────

describe('só a meta', () => {
  it('bater a meta é cinco estrelas, e passar não dá mais', () => {
    expect(estrelas(so({ meta: 1 })).estrelas).toBe(5)
    expect(estrelas(so({ meta: 1.04 })).estrelas).toBe(5)
    expect(estrelas(so({ meta: 1.04 })).notas.meta).toBe(1)
    expect(estrelas(so({ meta: 2 })).notas.meta).toBe(1)
  })

  it('metade da meta é duas estrelas e meia; nada é zero', () => {
    expect(estrelas(so({ meta: 0.5 })).estrelas).toBe(2.5)
    expect(estrelas(so({ meta: 0 })).estrelas).toBe(0)
  })

  it('o peso todo vai para a meta', () => {
    const n = estrelas(so({ meta: 0.8 }))
    expect(n.pesos).toEqual({ meta: 1 })
    expect(n.estrelas).toBe(4)
  })

  it('explica em porcento, com o verbo certo', () => {
    expect(estrelas(so({ meta: 1.04 })).motivos).toEqual(['bateu 104% da meta'])
    expect(estrelas(so({ meta: 0.72 })).motivos).toEqual(['fez 72% da meta'])
  })
})

describe('só as tarefas', () => {
  it('tudo no prazo é cinco estrelas', () => {
    const n = estrelas(so({ tarefas: { atribuidas: 9, feitas: 9, noPrazo: 9, atrasadasAbertas: 0 } }))
    expect(n.estrelas).toBe(5)
    expect(n.pesos).toEqual({ tarefas: 1 })
    expect(n.motivos).toEqual(['9 de 9 tarefas no prazo'])
  })

  it('feita fora do prazo vale meio', () => {
    // 3 no prazo + 0,5 × 1 fora = 3,5 de 8 → 0,4375 → 4,4 → 2 estrelas
    const n = estrelas(so({ tarefas: { atribuidas: 8, feitas: 4, noPrazo: 3, atrasadasAbertas: 0 } }))
    expect(n.notas.tarefas).toBeCloseTo(0.4375)
    expect(n.estrelas).toBe(2)
    expect(n.motivos).toEqual(['3 de 8 tarefas no prazo', '1 fora do prazo'])
  })

  it('cada atrasada em aberto desconta 0,1', () => {
    const sem = estrelas(so({ tarefas: { atribuidas: 10, feitas: 8, noPrazo: 8, atrasadasAbertas: 0 } }))
    const com = estrelas(so({ tarefas: { atribuidas: 10, feitas: 8, noPrazo: 8, atrasadasAbertas: 2 } }))
    expect(sem.notas.tarefas).toBeCloseTo(0.8)
    expect(com.notas.tarefas).toBeCloseTo(0.6)
    expect(com.motivos).toContain('2 atrasadas em aberto')
    expect(estrelas(so({ tarefas: { atribuidas: 10, feitas: 8, noPrazo: 8, atrasadasAbertas: 1 } })).motivos).toContain('1 atrasada em aberto')
  })

  it('o desconto tem piso zero', () => {
    const n = estrelas(so({ tarefas: { atribuidas: 2, feitas: 0, noPrazo: 0, atrasadasAbertas: 3 } }))
    expect(n.notas.tarefas).toBe(0)
    expect(n.estrelas).toBe(0)
    expect(semDados(n)).toBe(false)
  })

  it('sem tarefa atribuída, o componente sai da conta', () => {
    const n = estrelas(so({ tarefas: { atribuidas: 0, feitas: 0, noPrazo: 0, atrasadasAbertas: 0 } }))
    expect(semDados(n)).toBe(true)
    expect(n.motivos).toEqual(['sem dados no mês'])
  })

  it('uma tarefa só fala no singular', () => {
    expect(estrelas(so({ tarefas: { atribuidas: 1, feitas: 1, noPrazo: 1, atrasadasAbertas: 0 } })).motivos).toEqual(['1 de 1 tarefa no prazo'])
  })
})

describe('entrar no sistema não é presença', () => {
  // A dona logada a semana inteira no computador da loja levava "faltou 21
  // dias". Login não é ponto: as entradas aparecem na tela e não na nota.
  it('não entra na nota, nem nos motivos', () => {
    const n = estrelas(so({ meta: 1, presenca: { dias: 5, de: 26 } }))
    expect(n.estrelas).toBe(5)
    expect(n.pesos).toEqual({ meta: 1 })
    expect(n.motivos).toEqual(['bateu 100% da meta'])
    expect(n.motivos.join(' ')).not.toMatch(/faltou/)
  })

  it('sozinha não dá nota', () => {
    expect(semDados(estrelas(so({ presenca: { dias: 18, de: 20 } })))).toBe(true)
  })
})

describe('vendeu sem ter meta', () => {
  // O Carlos vendeu R$ 2.394,20 (a seção de metas mostrava) e o desempenho
  // dizia "sem dados no mês".
  it('fica sem nota, mas diz quanto vendeu', () => {
    const n = estrelas(so({ vendido: 2394.2 }))
    expect(semDados(n)).toBe(true)
    expect(n.motivos).toEqual(['vendeu R$ 2.394,20 no mês, sem meta para comparar'])
  })

  it('com tarefa, a nota é das tarefas e a venda é dita', () => {
    const n = estrelas(so({ vendido: 100, tarefas: { atribuidas: 2, feitas: 2, noPrazo: 2, atrasadasAbertas: 0 } }))
    expect(n.estrelas).toBe(5)
    expect(n.motivos).toContain('2 de 2 tarefas no prazo')
    expect(n.motivos.some((m) => m.startsWith('vendeu'))).toBe(true)
  })

  it('com meta, a venda já está no porcento', () => {
    expect(estrelas(so({ meta: 0.5, vendido: 500 })).motivos).toEqual(['fez 50% da meta'])
  })
})

// ─────────────────────────────────────────────────────────────
// JUNTANDO
// ─────────────────────────────────────────────────────────────

describe('meta e tarefas juntas', () => {
  const tudo = (meta: number, tarefas: number): Insumos => ({
    meta,
    tarefas: { atribuidas: 10, feitas: Math.round(tarefas * 10), noPrazo: Math.round(tarefas * 10), atrasadasAbertas: 0 },
    presenca: { dias: 3, de: 20 },
  })

  it('tudo perfeito é cinco estrelas, com os pesos de partida', () => {
    const n = estrelas(tudo(1, 1))
    expect(n.estrelas).toBe(5)
    expect(n.pesos).toEqual(PESOS)
  })

  it('soma peso × nota: meta 0,6 + tarefas 0,2 = 0,8 → 4', () => {
    expect(estrelas(tudo(1, 0.5)).estrelas).toBe(4)
  })

  it('a meta pesa mais que as tarefas', () => {
    expect(estrelas(tudo(1, 0)).estrelas).toBe(3)
    expect(estrelas(tudo(0, 1)).estrelas).toBe(2)
  })

  it('os motivos vêm na ordem meta, tarefas', () => {
    expect(estrelas(tudo(1.1, 0.8)).motivos).toEqual(['bateu 110% da meta', '8 de 10 tarefas no prazo'])
  })

  it('os pesos que ficam sempre somam 1', () => {
    const casos: Insumos[] = [
      so({ meta: 0.3 }),
      so({ tarefas: { atribuidas: 1, feitas: 1, noPrazo: 0, atrasadasAbertas: 0 } }),
      tudo(0.4, 0.7),
    ]
    for (const c of casos) {
      const soma = Object.values(estrelas(c).pesos).reduce((s, p) => s + p, 0)
      expect(soma).toBeCloseTo(1)
    }
  })
})

describe('arredonda ao meio de estrela mais próximo', () => {
  // Com a meta sozinha, a fração é a própria nota: dá para mirar.
  it.each([
    [0.87, 4.5],
    [0.92, 4.5],
    [0.94, 4.5],
    [0.96, 5],
    [0.65, 3.5], // fronteira exata: 0,65 sobe
    [0.64, 3],
    [0.04, 0],
    [0.05, 0.5],
  ])('%s → %s estrelas', (meta, esperado) => {
    expect(estrelas(so({ meta })).estrelas).toBe(esperado)
  })

  it('só sai em meios', () => {
    for (let m = 0; m <= 1.0001; m += 0.01) {
      const e = estrelas(so({ meta: m })).estrelas
      expect(e * 2, `meta ${m}`).toBe(Math.round(e * 2))
      expect(e).toBeGreaterThanOrEqual(0)
      expect(e).toBeLessThanOrEqual(5)
    }
  })
})

describe('sem dados', () => {
  it('sem insumo nenhum é zero estrela e diz que não há dado', () => {
    const n = estrelas(so({}))
    expect(n).toEqual({ estrelas: 0, notas: {}, pesos: {}, motivos: ['sem dados no mês'] })
    expect(semDados(n)).toBe(true)
  })

  it('zero de verdade não é "sem dados"', () => {
    expect(semDados(estrelas(so({ meta: 0 })))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// A RÉGUA E O CALENDÁRIO
// ─────────────────────────────────────────────────────────────

describe('o nível', () => {
  it('quatro para cima é bom', () => {
    expect(NIVEL(5)).toBe('bom')
    expect(NIVEL(4)).toBe('bom')
  })
  it('de duas e meia a três e meia é atenção', () => {
    expect(NIVEL(3.5)).toBe('atencao')
    expect(NIVEL(2.5)).toBe('atencao')
  })
  it('abaixo de duas e meia é crítico', () => {
    expect(NIVEL(2)).toBe('critico')
    expect(NIVEL(0)).toBe('critico')
  })
})

describe('quantos dias do mês contam', () => {
  // "Hoje" é um instante lido no calendário de São Paulo, não no da máquina.
  const emSP = (dia: string, hora = '12:00') => new Date(`${dia}T${hora}:00-03:00`)

  it('no mês corrente, os dias corridos até hoje', () => {
    expect(diasDoMesAte(emSP('2026-09-16'), '2026-09')).toBe(16)
    expect(diasDoMesAte(emSP('2026-09-01'), '2026-09')).toBe(1)
  })

  it('às 22h30 do dia 1º em São Paulo o mês ainda é o dia 1º — com o servidor em UTC já seria o dia 2', () => {
    expect(diasDoMesAte(emSP('2026-09-01', '22:30'), '2026-09')).toBe(1)
    // e às 22h30 do dia 31/08 ainda é agosto: setembro é futuro
    expect(diasDoMesAte(emSP('2026-08-31', '22:30'), '2026-09')).toBe(0)
  })

  it('com teto de 26, mesmo no dia 30', () => {
    expect(TETO_DIAS).toBe(26)
    expect(diasDoMesAte(emSP('2026-09-30'), '2026-09')).toBe(26)
  })

  it('mês passado conta inteiro, também com teto', () => {
    expect(diasDoMesAte(emSP('2026-09-16'), '2026-08')).toBe(26)
    expect(diasDoMesAte(emSP('2026-09-16'), '2026-02')).toBe(26)
    expect(diasDoMesAte(emSP('2027-01-05'), '2026-12')).toBe(26)
  })

  it('mês futuro é zero: ninguém entrou ainda', () => {
    expect(diasDoMesAte(emSP('2026-09-16'), '2026-10')).toBe(0)
    expect(diasDoMesAte(emSP('2026-09-16'), '2027-01')).toBe(0)
  })
})

describe('a janela do mês', () => {
  it('abre e fecha à meia-noite de São Paulo — a mesma janela das metas', () => {
    const j = janelaDoMes('2026-09')
    expect(j.de.toISOString()).toBe('2026-09-01T03:00:00.000Z')
    expect(j.ate.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect([j.deDia, j.ateDia]).toEqual(['2026-09-01', '2026-10-01'])
    expect(janelaDoMes('2026-12').ateDia).toBe('2027-01-01')
  })
})

describe('os últimos meses', () => {
  it('terminam no mês pedido', () => {
    expect(ultimosMeses('2026-09', 3)).toEqual(['2026-07', '2026-08', '2026-09'])
  })
  it('atravessam o ano', () => {
    expect(ultimosMeses('2026-01', 3)).toEqual(['2025-11', '2025-12', '2026-01'])
  })
  it('um mês só é ele mesmo', () => {
    expect(ultimosMeses('2026-09', 1)).toEqual(['2026-09'])
  })
})
