import { describe, it, expect } from 'vitest'
import { explicarSistema } from '../src/servidor/assistente/ferramentas'
import { ferramentasDe, PODERES, type AgenteConfig } from '../src/servidor/poderes'
import type { Sessao } from '../src/servidor/permissao'

// O dono pergunta pelo WhatsApp "como faço para…?" e recebe o Guia — mas só
// as telas que ELE abre. A balconista que pergunta de plano não recebe o
// caminho da Assinatura, que para ela é uma parede.

const sessao = (papel: 'DONO' | 'BALCAO'): Sessao => ({
  orgId: 'org',
  usuarioId: 'u',
  nome: 'Pessoa',
  acessos: [{ papel, unidadeId: papel === 'DONO' ? null : 'loja-1', expiraEm: null }],
})
const empresa = { modulos: ['agente'] }
const telas = (r: { texto: string }) =>
  (JSON.parse(r.texto) as { telas?: { tela: string }[] }).telas?.map((t) => t.tela) ?? []

describe('explicar o sistema pelo Guia', () => {
  it('está sempre na mesa, mesmo com nenhum poder ligado', () => {
    const agente = { poderes: [] } as unknown as AgenteConfig
    expect(ferramentasDe(agente, empresa)).toContain('explicar.sistema')
    expect(PODERES['explicar.sistema'].escreve).toBe(false)
  })

  it('o dono recebe a tela que responde, com os passos', () => {
    const r = explicarSistema(empresa, sessao('DONO'), 'como troco de plano')
    expect(r.erro).toBeFalsy()
    expect(telas(r)).toContain('Assinatura')
  })

  it('a balconista não recebe tela que não abre', () => {
    const r = explicarSistema(empresa, sessao('BALCAO'), 'como troco de plano')
    expect(telas(r)).not.toContain('Assinatura')
  })

  it('pergunta vazia é recusada', () => {
    expect(explicarSistema(empresa, sessao('DONO'), '').erro).toBe(true)
  })
})
