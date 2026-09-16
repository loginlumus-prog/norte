// A conta das estrelas, conferida.
//
// É a única parte do desempenho que pode sair errada de um jeito que ninguém
// nota: meia estrela a menos não parece defeito, parece opinião — e vira
// conversa difícil na loja. Por isso cada regra tem o seu caso aqui.

import { describe, it, expect } from 'vitest'
import { estrelas, NIVEL, PESOS, TETO_DIAS, diasDoMesAte, semDados, ultimosMeses, type Insumos } from '../src/servidor/desempenho'

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

describe('só a presença', () => {
  it('é a fração dos dias, arredondada ao meio', () => {
    // 18/20 = 0,9 → 4,5
    const n = estrelas(so({ presenca: { dias: 18, de: 20 } }))
    expect(n.estrelas).toBe(4.5)
    expect(n.pesos).toEqual({ presenca: 1 })
    expect(n.motivos).toEqual(['faltou 2 dias'])
  })

  it('todo dia presente é cinco, e entrar mais que o teto não passa de 1', () => {
    expect(estrelas(so({ presenca: { dias: 26, de: 26 } })).estrelas).toBe(5)
    expect(estrelas(so({ presenca: { dias: 30, de: 26 } })).notas.presenca).toBe(1)
    expect(estrelas(so({ presenca: { dias: 26, de: 26 } })).motivos).toEqual(['sem falta em 26 dias'])
  })

  it('um dia de falta fala no singular', () => {
    expect(estrelas(so({ presenca: { dias: 19, de: 20 } })).motivos).toEqual(['faltou 1 dia'])
  })

  it('mês sem dia contado tira a presença da conta', () => {
    const n = estrelas(so({ presenca: { dias: 0, de: 0 } }))
    expect(semDados(n)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// JUNTANDO
// ─────────────────────────────────────────────────────────────

describe('os três juntos', () => {
  const tudo = (meta: number, tarefas: number, presenca: number): Insumos => ({
    meta,
    tarefas: { atribuidas: 10, feitas: Math.round(tarefas * 10), noPrazo: Math.round(tarefas * 10), atrasadasAbertas: 0 },
    presenca: { dias: Math.round(presenca * 20), de: 20 },
  })

  it('tudo perfeito é cinco estrelas', () => {
    const n = estrelas(tudo(1, 1, 1))
    expect(n.estrelas).toBe(5)
    expect(n.pesos).toEqual(PESOS)
  })

  it('soma peso × nota: meta 0,5 + tarefas 0,15 + presença 0,2 = 0,85 → 4,5', () => {
    const n = estrelas(tudo(1, 0.5, 1))
    expect(n.estrelas).toBe(4.5)
  })

  it('a meta pesa mais que as outras duas somadas', () => {
    expect(estrelas(tudo(1, 0, 0)).estrelas).toBe(2.5)
    expect(estrelas(tudo(0, 1, 1)).estrelas).toBe(2.5)
  })

  it('os motivos vêm na ordem meta, tarefas, presença', () => {
    expect(estrelas(tudo(1.1, 0.8, 0.9)).motivos).toEqual(['bateu 110% da meta', '8 de 10 tarefas no prazo', 'faltou 2 dias'])
  })
})

describe('quem falta sai dos pesos', () => {
  it('sem presença: meta 0,625 e tarefas 0,375', () => {
    const n = estrelas(so({ meta: 1, tarefas: { atribuidas: 4, feitas: 0, noPrazo: 0, atrasadasAbertas: 0 } }))
    expect(n.pesos.meta).toBeCloseTo(0.625)
    expect(n.pesos.tarefas).toBeCloseTo(0.375)
    expect(n.pesos.presenca).toBeUndefined()
    // 0,625 → 6,25 → 6 → 3
    expect(n.estrelas).toBe(3)
  })

  it('sem meta: tarefas 0,6 e presença 0,4', () => {
    const n = estrelas(so({ tarefas: { atribuidas: 5, feitas: 5, noPrazo: 5, atrasadasAbertas: 0 }, presenca: { dias: 10, de: 20 } }))
    expect(n.pesos.tarefas).toBeCloseTo(0.6)
    expect(n.pesos.presenca).toBeCloseTo(0.4)
    // 0,6 + 0,2 = 0,8 → 4
    expect(n.estrelas).toBe(4)
  })

  it('sem tarefas: meta e presença dividem 5 para 2', () => {
    const n = estrelas(so({ meta: 0.5, presenca: { dias: 20, de: 20 } }))
    expect(n.pesos.meta).toBeCloseTo(5 / 7)
    expect(n.pesos.presenca).toBeCloseTo(2 / 7)
  })

  it('os pesos que ficam sempre somam 1', () => {
    const casos: Insumos[] = [
      so({ meta: 0.3 }),
      so({ meta: 0.3, presenca: { dias: 1, de: 2 } }),
      so({ tarefas: { atribuidas: 1, feitas: 1, noPrazo: 0, atrasadasAbertas: 0 }, presenca: { dias: 1, de: 2 } }),
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
  it('no mês corrente, os dias corridos até hoje', () => {
    expect(diasDoMesAte(new Date(2026, 8, 16), '2026-09')).toBe(16)
    expect(diasDoMesAte(new Date(2026, 8, 1), '2026-09')).toBe(1)
  })

  it('com teto de 26, mesmo no dia 30', () => {
    expect(TETO_DIAS).toBe(26)
    expect(diasDoMesAte(new Date(2026, 8, 30), '2026-09')).toBe(26)
  })

  it('mês passado conta inteiro, também com teto', () => {
    expect(diasDoMesAte(new Date(2026, 8, 16), '2026-08')).toBe(26)
    expect(diasDoMesAte(new Date(2026, 8, 16), '2026-02')).toBe(26)
    expect(diasDoMesAte(new Date(2027, 0, 5), '2026-12')).toBe(26)
  })

  it('mês futuro é zero: ninguém entrou ainda', () => {
    expect(diasDoMesAte(new Date(2026, 8, 16), '2026-10')).toBe(0)
    expect(diasDoMesAte(new Date(2026, 8, 16), '2027-01')).toBe(0)
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
