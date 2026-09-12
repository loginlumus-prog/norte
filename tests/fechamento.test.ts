import { describe, it, expect } from 'vitest'
import { conferir, janelaDoMes, type FatosDoMes } from '../src/servidor/fechamento'

// Um mês limpo: tudo fechado, tudo pago, taxa escrita, resultado positivo.
const LIMPO: FatosDoMes = {
  caixasAbertos: 0,
  diferencaGaveta: 0,
  turnosFechados: 22,
  contasVencidas: 0,
  valorVencido: 0,
  parcelasVencidas: null,
  valorParcelasVencidas: 0,
  recebeuEmMaquina: true,
  temTaxa: true,
  receita: 50000,
  resultado: 8000,
}

const com = (mudanca: Partial<FatosDoMes>) => conferir({ ...LIMPO, ...mudanca }, 'loja')
const achar = (itens: ReturnType<typeof conferir>, chave: string) =>
  itens.find((i) => i.chave === chave)!

describe('o mês limpo', () => {
  it('não tem nenhuma pendência', () => {
    expect(com({}).every((i) => i.situacao === 'ok')).toBe(true)
  })

  it('não fala de crediário quando a loja não usa', () => {
    expect(com({}).some((i) => i.chave === 'crediario')).toBe(false)
  })

  it('e fala quando ela usa', () => {
    expect(com({ parcelasVencidas: 0 }).some((i) => i.chave === 'crediario')).toBe(true)
  })
})

describe('o caixa', () => {
  it('aberto trava o fechamento', () => {
    const i = achar(com({ caixasAbertos: 1 }), 'caixas')
    expect(i.situacao).toBe('pendente')
    expect(i.onde?.href).toBe('/loja/caixa')
  })

  it('diferença pequena é aviso, não pendência', () => {
    expect(achar(com({ diferencaGaveta: 12 }), 'gaveta').situacao).toBe('atencao')
  })

  it('diferença grande é pendência', () => {
    expect(achar(com({ diferencaGaveta: 350 }), 'gaveta').situacao).toBe('pendente')
  })

  it('mês sem turno fechado não acusa diferença', () => {
    expect(achar(com({ turnosFechados: 0, diferencaGaveta: 0 }), 'gaveta').situacao).toBe('ok')
  })
})

describe('a taxa da maquininha', () => {
  it('recebeu em máquina e não escreveu taxa é pendência', () => {
    const i = achar(com({ recebeuEmMaquina: true, temTaxa: false }), 'taxa')
    expect(i.situacao).toBe('pendente')
    expect(i.onde?.href).toBe('/loja/configuracoes')
  })

  it('não recebeu em máquina: não há taxa a cobrar', () => {
    expect(achar(com({ recebeuEmMaquina: false, temTaxa: false }), 'taxa').situacao).toBe('ok')
  })
})

describe('as contas e o fiado', () => {
  it('conta vencida é pendência', () => {
    expect(achar(com({ contasVencidas: 2, valorVencido: 3345 }), 'contas').situacao).toBe('pendente')
  })

  it('parcela vencida é aviso — ela não erra o resultado, atrasa o dinheiro', () => {
    expect(achar(com({ parcelasVencidas: 3, valorParcelasVencidas: 900 }), 'crediario').situacao).toBe('atencao')
  })
})

describe('o resultado', () => {
  it('negativo aparece como pendência', () => {
    expect(achar(com({ resultado: -1200 }), 'resultado').situacao).toBe('pendente')
  })

  it('mês sem venda nenhuma é aviso, não erro', () => {
    expect(achar(com({ receita: 0, resultado: 0 }), 'resultado').situacao).toBe('atencao')
  })

  it('leva sempre um caminho para o DRE', () => {
    expect(achar(com({}), 'resultado').onde?.href).toBe('/loja/financeiro')
  })
})

describe('a janela do mês', () => {
  it('vai do dia 1 ao dia 1 do mês seguinte', () => {
    const { de, ate } = janelaDoMes('2026-09')
    expect(de.getFullYear()).toBe(2026)
    expect(de.getMonth()).toBe(8)
    expect(de.getDate()).toBe(1)
    expect(ate.getMonth()).toBe(9)
    expect(ate.getDate()).toBe(1)
  })

  it('vira o ano em dezembro', () => {
    const { ate } = janelaDoMes('2026-12')
    expect(ate.getFullYear()).toBe(2027)
    expect(ate.getMonth()).toBe(0)
  })
})
