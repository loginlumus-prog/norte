// Telefone e CPF.
//
// As duas funções puras que decidem se a loja vai ter o mesmo cliente
// cadastrado quatro vezes, e se a nota fiscal vai ser recusada dias depois.

import { describe, it, expect } from 'vitest'
import { soDigitos, mostrarTelefone, cpfValido } from '../src/servidor/cliente'

describe('telefone', () => {
  it('a mesma pessoa digitada de três jeitos vira a mesma chave', () => {
    // É este teste que impede a loja de ter o mesmo cliente quatro vezes,
    // cada um com uma dívida separada.
    const jeitos = ['(71) 99999-0000', '71999990000', '71 9 9999-0000', '+55 71 99999-0000']
    const chaves = jeitos.map(soDigitos)
    // O +55 traz dois dígitos a mais — a comparação útil é dos 11 finais.
    expect(new Set(chaves.map((c) => c.slice(-11))).size).toBe(1)
  })

  it('celular sai formatado com nove dígitos', () => {
    expect(mostrarTelefone('71999990000')).toBe('(71) 99999-0000')
  })

  it('fixo sai formatado com oito', () => {
    expect(mostrarTelefone('7133334444')).toBe('(71) 3333-4444')
  })

  it('número estranho volta como veio, sem inventar formato', () => {
    // Melhor mostrar o que está no banco do que fingir um formato que não é.
    expect(mostrarTelefone('123')).toBe('123')
  })

  it('vazio não vira "(undefined)"', () => {
    expect(mostrarTelefone(null)).toBe('')
    expect(mostrarTelefone('')).toBe('')
  })
})

describe('CPF', () => {
  it('aceita um CPF válido, com ou sem pontuação', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('52998224725')).toBe(true)
  })

  it('recusa um dígito verificador errado', () => {
    // É o erro de digitação comum, e é o que a SEFAZ recusa dias depois —
    // quando ninguém lembra mais qual venda era.
    expect(cpfValido('529.982.247-26')).toBe(false)
  })

  it('recusa tamanho errado', () => {
    expect(cpfValido('5299822472')).toBe(false)
    expect(cpfValido('529982247251')).toBe(false)
    expect(cpfValido('')).toBe(false)
  })

  it('recusa os repetidos, que passam na conta e não existem', () => {
    for (const d of ['00000000000', '11111111111', '99999999999']) {
      expect(cpfValido(d), d).toBe(false)
    }
  })

  it('recusa letra no meio', () => {
    expect(cpfValido('529.98A.247-25')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// Quantidade com a medida e tempo falado (ui/texto.ts)
// ─────────────────────────────────────────────────────────────

import { duracao, quantidade } from '../src/ui/texto'

describe('quantidade com a medida', () => {
  it('sorvete a granel em quilo, camiseta em unidade', () => {
    expect(quantidade(1.857, 'KG')).toBe('1,857 kg')
    expect(quantidade(3, 'UN')).toBe('3 un')
    expect(quantidade(2, 'PAR')).toBe('2 par')
    expect(quantidade(4, null)).toBe('4 un')
  })
})

describe('duração falada', () => {
  it('minutos, horas, dias', () => {
    expect(duracao(40)).toBe('40 min')
    expect(duracao(60)).toBe('1 hora')
    expect(duracao(14 * 60)).toBe('14 horas')
    expect(duracao(286 * 60)).toBe('11 dias')
    expect(duracao(24 * 60)).toBe('1 dia')
  })
})
