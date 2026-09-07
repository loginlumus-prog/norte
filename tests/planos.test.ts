import { describe, it, expect } from 'vitest'
import { podeCriarUnidade, podeAdicionarUsuario, mensalidade, PLANOS } from '../src/servidor/planos'

describe('quem tem uma loja', () => {
  it('cria a primeira sem custo nenhum', () => {
    expect(podeCriarUnidade('BALCAO', 0)).toEqual({ pode: true, custoExtra: 0 })
  })

  it('e é barrado na segunda — com o caminho para onde ir', () => {
    const r = podeCriarUnidade('BALCAO', 1)
    expect(r.pode).toBe(false)
    if (!r.pode) {
      expect(r.sugestao).toBe('REDE')
      // A mensagem precisa dizer o porquê, não só "não pode"
      expect(r.motivo).toMatch(/1 unidade/)
    }
  })
})

describe('rede', () => {
  it('vai até cinco sem cobrar a mais', () => {
    for (let n = 0; n < 5; n++) {
      expect(podeCriarUnidade('REDE', n), `com ${n} lojas`).toEqual({ pode: true, custoExtra: 0 })
    }
  })

  it('da sexta em diante cobra, mas deixa criar', () => {
    const sexta = podeCriarUnidade('REDE', 5)
    expect(sexta.pode).toBe(true)
    if (sexta.pode && 'novoTotal' in sexta) {
      expect(sexta.custoExtra).toBe(249)
      expect(sexta.novoTotal).toBe(1497 + 249)
    }
  })

  it('e o valor avisado cresce com cada loja nova', () => {
    const sexta = podeCriarUnidade('REDE', 5)
    const setima = podeCriarUnidade('REDE', 6)
    if (sexta.pode && 'novoTotal' in sexta && setima.pode && 'novoTotal' in setima) {
      expect(setima.novoTotal - sexta.novoTotal).toBe(249)
    }
  })
})

describe('corporativo não tem teto', () => {
  it('cria quantas quiser', () => {
    expect(podeCriarUnidade('CORPORATIVO', 200)).toEqual({ pode: true, custoExtra: 0 })
    expect(podeAdicionarUsuario('CORPORATIVO', 500)).toEqual({ pode: true, custoExtra: 0 })
  })
})

describe('a conta do mês', () => {
  it('uma loja no Balcão é só a base', () => {
    expect(mensalidade('BALCAO', 1)).toMatchObject({ base: 349, extras: 0, total: 349 })
  })

  it('cinco lojas na Rede ainda é só a base', () => {
    expect(mensalidade('REDE', 5)).toMatchObject({ extras: 0, total: 1497 })
  })

  it('oito lojas na Rede: base mais três extras', () => {
    expect(mensalidade('REDE', 8)).toMatchObject({
      base: 1497,
      extras: 3,
      total: 1497 + 3 * 249,
    })
  })

  it('corporativo é sob consulta, não zero', () => {
    // Zero levaria a cobrar nada de quem paga mais — o total precisa ser nulo
    expect(mensalidade('CORPORATIVO', 40).total).toBeNull()
  })
})

describe('equipe', () => {
  it('o Balcão atende cinco pessoas', () => {
    expect(podeAdicionarUsuario('BALCAO', 4).pode).toBe(true)
    expect(podeAdicionarUsuario('BALCAO', 5).pode).toBe(false)
  })

  it('quem estoura a Rede vai para o Corporativo, não para a Rede de novo', () => {
    const r = podeAdicionarUsuario('REDE', 30)
    expect(r.pode).toBe(false)
    if (!r.pode) expect(r.sugestao).toBe('CORPORATIVO')
  })
})

describe('coerência da tabela', () => {
  it('todo plano com preço tem cota de unidade e de gente', () => {
    for (const [nome, p] of Object.entries(PLANOS)) {
      if (p.mensal !== null) {
        expect(p.unidades, `${nome} sem cota de unidade`).not.toBeUndefined()
        expect(p.usuarios, `${nome} sem cota de gente`).not.toBeUndefined()
      }
    }
  })

  it('só vende unidade extra quem tem cota definida', () => {
    for (const [nome, p] of Object.entries(PLANOS)) {
      if (p.porUnidadeExtra !== null) {
        expect(p.unidades, `${nome} vende extra sem ter cota`).not.toBeNull()
      }
    }
  })
})
