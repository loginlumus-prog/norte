// Quem baixa qual planilha, e o que dos filtros vai para o livro.
// Ver src/servidor/exportacao.ts.

import { describe, it, expect } from 'vitest'
import { podeExportar, filtrosUsados, EXIGE, type Planilha } from '../src/servidor/exportacao'
import { ACOES } from '../src/servidor/auditoria'
import type { Papel, Sessao } from '../src/servidor/permissao'

const com = (papel: Papel): Sessao => ({
  orgId: 'org-a',
  usuarioId: `usr-${papel}`,
  nome: papel,
  acessos: [{ papel, unidadeId: null, expiraEm: null }],
})

describe('quem baixa a planilha de clientes', () => {
  it('quem cuida do negócio baixa', () => {
    for (const p of ['DONO', 'GERENTE', 'FINANCEIRO'] as const) expect(podeExportar(com(p), 'clientes')).toBe(true)
  })

  it('o balcão vê o cliente na tela, um por vez, mas não leva a carteira inteira', () => {
    expect(podeExportar(com('BALCAO'), 'clientes')).toBe(false)
    // o resto do que o balcão já baixava continua
    expect(podeExportar(com('BALCAO'), 'produtos')).toBe(true)
    expect(podeExportar(com('BALCAO'), 'estoque')).toBe(true)
  })

  it('o contador não vê cliente, então não baixa a lista; o financeiro, sim', () => {
    expect(podeExportar(com('CONTADOR'), 'clientes')).toBe(false)
    expect(podeExportar(com('CONTADOR'), 'financeiro')).toBe(true)
  })
})

describe('o rastro no livro', () => {
  it('leva o NOME do filtro, nunca o que foi digitado', () => {
    const f = filtrosUsados(new URLSearchParams('q=Rosa%20Lima&unidade=u1&tipo=&mes=2026-09'))
    expect(f).toEqual(['mes', 'q', 'unidade'])
    expect(f.join()).not.toContain('Rosa')
  })

  it('toda planilha tem frase no livro', () => {
    for (const p of Object.keys(EXIGE) as Planilha[]) expect(ACOES[`exportou.${p}`]).toBeTruthy()
  })
})
