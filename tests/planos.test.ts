import { describe, it, expect } from 'vitest'
import { podeCriarUnidade, podeAdicionarUsuario, mensalidade, PLANOS, mudanca, menorQueCabe, planoLibera } from '../src/servidor/planos'
import { TODOS } from '../src/servidor/modulos'

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

// ─────────────────────────────────────────────────────────────
// TROCAR DE PLANO
// ─────────────────────────────────────────────────────────────

describe('o que muda ao trocar de plano', () => {
  const pequeno = { unidades: 1, usuarios: 3 }

  it('subir mostra o que ganha, e a diferenca de preco', () => {
    const m = mudanca('BALCAO', 'BALCAO_AGENTE', pequeno)
    expect(m.sentido).toBe('subir')
    expect(m.diferenca).toBe(697 - 349)
    expect(m.ganha).toContain('agente')
    expect(m.perde).toEqual([])
  })

  // O caso que faz o cliente cancelar quando ninguem avisa.
  it('descer mostra o que PERDE, e nao so o desconto', () => {
    const m = mudanca('REDE', 'BALCAO', pequeno)
    expect(m.sentido).toBe('descer')
    expect(m.diferenca).toBe(349 - 1497)
    expect(m.perde).toContain('crediario')
    expect(m.perde).toContain('agente')
    expect(m.perde).toContain('multiUnidade')
  })

  it('trocar para o mesmo plano nao muda nada', () => {
    const m = mudanca('REDE', 'REDE', pequeno)
    expect(m.sentido).toBe('igual')
    expect(m.diferenca).toBe(0)
    expect(m.ganha).toEqual([])
    expect(m.perde).toEqual([])
  })

  it('para o Corporativo nao existe diferenca de preco: e sob consulta', () => {
    const m = mudanca('REDE', 'CORPORATIVO', pequeno)
    expect(m.novoMensal).toBeNull()
    expect(m.diferenca).toBeNull()
  })
})

describe('descer de plano com mais uso do que cabe e RECUSADO', () => {
  it('oito lojas nao cabem no plano de cinco, e a mensagem diz quantas tirar', () => {
    const m = mudanca('CORPORATIVO', 'REDE', { unidades: 8, usuarios: 10 })
    expect(m.impedimentos.length).toBe(1)
    expect(m.impedimentos[0]).toContain('8')
    expect(m.impedimentos[0]).toContain('Desative 3')
  })

  it('e gente demais tambem impede, separadamente', () => {
    const m = mudanca('REDE', 'BALCAO', { unidades: 1, usuarios: 12 })
    expect(m.impedimentos.length).toBe(1)
    expect(m.impedimentos[0]).toContain('Tire o acesso de 7')
  })

  it('os dois ao mesmo tempo geram os dois impedimentos', () => {
    const m = mudanca('REDE', 'BALCAO', { unidades: 4, usuarios: 12 })
    expect(m.impedimentos.length).toBe(2)
  })

  it('subir nunca impede', () => {
    for (const uso of [{ unidades: 1, usuarios: 3 }, { unidades: 40, usuarios: 90 }]) {
      expect(mudanca('BALCAO', 'CORPORATIVO', uso).impedimentos).toEqual([])
    }
  })
})

describe('o menor plano que cabe', () => {
  it('uma loja e tres pessoas cabem no Balcao', () =>
    expect(menorQueCabe({ unidades: 1, usuarios: 3 })).toBe('BALCAO'))
  it('duas lojas ja pedem Rede', () =>
    expect(menorQueCabe({ unidades: 2, usuarios: 3 })).toBe('REDE'))
  it('seis pessoas numa loja tambem pedem Rede', () =>
    expect(menorQueCabe({ unidades: 1, usuarios: 6 })).toBe('REDE'))
  it('trinta lojas so cabem no Corporativo', () =>
    expect(menorQueCabe({ unidades: 30, usuarios: 200 })).toBe('CORPORATIVO'))
})

describe('o plano decide quais modulos existem', () => {
  it('o Balcao nao tem agente nem crediario', () => {
    expect(planoLibera('BALCAO', 'agente')).toBe(false)
    expect(planoLibera('BALCAO', 'crediario')).toBe(false)
  })
  it('o Balcao + Assistente tem agente mas nao crediario', () => {
    expect(planoLibera('BALCAO_AGENTE', 'agente')).toBe(true)
    expect(planoLibera('BALCAO_AGENTE', 'crediario')).toBe(false)
  })
  it('todo plano com agente tem credito de IA incluso, e sem agente nao tem', () => {
    for (const p of ['BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO'] as const) {
      expect(PLANOS[p].creditoMensal > 0).toBe(planoLibera(p, 'agente'))
    }
  })
  it('nenhum plano libera modulo que nao existe', () => {
    for (const p of ['BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO'] as const) {
      for (const m of PLANOS[p].modulos) expect(TODOS).toContain(m)
    }
  })
})
