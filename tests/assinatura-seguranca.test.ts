// Travas pequenas que não podem afrouxar no deploy.
//
//   • NORTE_ASSINATURA_LIVRE (o clique direto de plano e crédito, para o
//     laptop) é IGNORADA em produção — esquecida no painel, daria plano e
//     crédito de IA de graça a qualquer dono;
//   • a planilha exportada não deixa fórmula passar: nem com espaço na frente,
//     nem escondida depois de uma vírgula (o programa que separa por vírgula
//     partia a célula, e a segunda metade começava com "=").

import { describe, it, expect, vi, afterEach } from 'vitest'
import { assinaturaLivre } from '../src/servidor/assinatura'
import { celula } from '../src/servidor/csv'

describe('assinatura livre', () => {
  const antes = { ...process.env }
  afterEach(() => {
    process.env = { ...antes }
  })

  it('vale no laptop, nunca em produção', () => {
    process.env.NORTE_ASSINATURA_LIVRE = '1'
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    expect(assinaturaLivre()).toBe(true)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    expect(assinaturaLivre()).toBe(false)
    expect(erro).toHaveBeenCalledWith(expect.stringMatching(/IGNORADA/))
    erro.mockRestore()
  })
})

describe('planilha: fórmula não passa', () => {
  it('espaço antes do = ainda é fórmula', () => {
    expect(celula(' =1+1')).toBe("' =1+1")
    expect(celula('\t=1+1')).toBe("'\t=1+1")
  })

  it('texto com vírgula vai entre aspas: a célula fica inteira em qualquer separador', () => {
    expect(celula('Ana,=HYPERLINK("http://x")')).toBe('"Ana,=HYPERLINK(""http://x"")"')
    expect(celula('Rua A, 12')).toBe('"Rua A, 12"')
  })

  it('número, telefone e texto comum continuam como estão', () => {
    expect(celula(12.5)).toBe('12,50')
    expect(celula('-5')).toBe('-5')
    expect(celula(' -5')).toBe(' -5')
    expect(celula('+55 71 99999-0001')).toBe('+55 71 99999-0001')
    expect(celula('Ana')).toBe('Ana')
  })
})
