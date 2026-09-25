import { describe, it, expect } from 'vitest'
import { conferir, janelaDoMes, mesDeAgora, outroMes, soOQueAbre, type FatosDoMes } from '../src/servidor/fechamento'

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
  it('vai da meia-noite de São Paulo do dia 1 à do dia 1 do mês seguinte — seja qual for o fuso do servidor', () => {
    const { de, ate } = janelaDoMes('2026-09')
    expect(de.toISOString()).toBe('2026-09-01T03:00:00.000Z')
    expect(ate.toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })

  it('a venda das 22h30 do último dia fica no mês dela', () => {
    const venda = new Date('2026-08-31T22:30:00-03:00')
    const ago = janelaDoMes('2026-08')
    expect(venda >= ago.de && venda < ago.ate).toBe(true)
    expect(venda >= janelaDoMes('2026-09').de).toBe(false)
  })

  it('vira o ano em dezembro', () => {
    const { ate } = janelaDoMes('2026-12')
    expect(ate.toISOString()).toBe('2027-01-01T03:00:00.000Z')
    expect(outroMes('2026-12', 1)).toBe('2027-01')
    expect(outroMes('2026-01', -1)).toBe('2025-12')
  })

  it('o mês de agora é o de São Paulo', () => {
    expect(mesDeAgora(new Date('2026-09-30T22:30:00-03:00'))).toBe('2026-09')
  })
})

describe('texto e caminho de cada linha', () => {
  it('singular e plural de verdade, sem "(s)"', () => {
    const itens = com({ caixasAbertos: 1, contasVencidas: 2, valorVencido: 10, parcelasVencidas: 1 })
    expect(achar(itens, 'caixas').detalhe).toBe('1 caixa ainda aberto')
    expect(achar(itens, 'contas').detalhe).toMatch(/^2 vencidas, somando/)
    expect(achar(itens, 'crediario').detalhe).toMatch(/^1 parcela vencida,/)
    expect(itens.map((i) => i.detalhe).join(' ')).not.toMatch(/\(s\)/)
  })

  it('quem não abre a tela de destino recebe a frase de quem resolve, e não um link que dá 404', () => {
    const itens = com({ caixasAbertos: 1, recebeuEmMaquina: true, temTaxa: false })
    // o contador lê o financeiro e mais nada
    const doContador = soOQueAbre(itens, (c) => c === 'financeiro.ver')
    expect(achar(doContador, 'caixas').onde).toEqual({ texto: 'Isso se resolve em Caixa, com quem cuida do caixa.' })
    expect(achar(doContador, 'taxa').onde?.href).toBeUndefined()
    expect(achar(doContador, 'resultado').onde?.href).toBe('/loja/financeiro')
    // a dona abre tudo
    expect(achar(soOQueAbre(itens, () => true), 'taxa').onde?.href).toBe('/loja/configuracoes')
  })
})
