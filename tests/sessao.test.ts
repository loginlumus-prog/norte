// A regra que decide se um cookie ainda vale.
//
// Ela existe porque o cookie é uma FOTOGRAFIA: carrega os papéis que a pessoa
// tinha na hora em que entrou. Sem esta regra, tirar o acesso de alguém só
// faz efeito quando o cookie expira — até 12 horas depois. Demitiu de manhã,
// continua vendendo à tarde.

import { describe, it, expect } from 'vitest'
import { sessaoAindaVale } from '../src/servidor/permissao'

const ONTEM = new Date('2026-09-06T10:00:00Z')
const HOJE = new Date('2026-09-07T10:00:00Z')
const AMANHA = new Date('2026-09-08T10:00:00Z')

describe('sessão ainda vale?', () => {
  it('sessão de hoje, conta ativa, sem corte: vale', () => {
    expect(sessaoAindaVale({ ativo: true, sessoesDesde: ONTEM }, HOJE)).toBe(true)
  })

  it('conta desativada derruba a sessão que já estava aberta', () => {
    // É o caso do funcionário demitido no meio do expediente.
    expect(sessaoAindaVale({ ativo: false, sessoesDesde: ONTEM }, HOJE)).toBe(false)
  })

  it('corte posterior à sessão a mata', () => {
    // Trocou o papel dele às 10h; o cookie das 9h não vale mais.
    expect(sessaoAindaVale({ ativo: true, sessoesDesde: AMANHA }, HOJE)).toBe(false)
  })

  it('corte no MESMO instante não mata — é quem trocou a própria senha', () => {
    expect(sessaoAindaVale({ ativo: true, sessoesDesde: HOJE }, HOJE)).toBe(true)
  })

  it('usuário que sumiu do banco não tem sessão', () => {
    expect(sessaoAindaVale(null, HOJE)).toBe(false)
  })

  it('cookie antigo, de antes do campo existir, nasce no zero e cai no corte', () => {
    // `desempacotar` devolve new Date(0) quando o cookie não tem `nasceu`.
    expect(sessaoAindaVale({ ativo: true, sessoesDesde: ONTEM }, new Date(0))).toBe(false)
  })
})
