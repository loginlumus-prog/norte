// O "Precisa de você" do painel simples.
//
// A lista é a primeira coisa que o dono lê de manhã, e ela só vale se for
// exata nas três coisas que ele não confere: o NÚMERO dentro da frase, a
// ORDEM (o que já custa dinheiro primeiro) e o LINK (que tem de abrir a
// lista prometida, na loja que ele estava olhando). E o silêncio também é
// regra: assunto que a pessoa não vê não entra, e zero não vira linha.

import { describe, it, expect } from 'vitest'
import {
  montarPendencias,
  plural,
  saudacao,
  primeiroNome,
  diaPorExtenso,
  mesmoDiaPassado,
  noRelogio,
  horaMinuto,
  type Contagens,
} from '../src/servidor/pendencias'

// O Intl escreve moeda com espaço não separável; compara sem ele.
const limpo = (s: string) => s.replace(/\s/g, ' ')

describe('plural', () => {
  it('põe o número junto e escolhe a palavra', () => {
    expect(plural(1, 'produto', 'produtos')).toBe('1 produto')
    expect(plural(3, 'produto', 'produtos')).toBe('3 produtos')
    expect(plural(0, 'produto', 'produtos')).toBe('0 produtos')
  })

  it('escreve milhar à brasileira', () => {
    expect(plural(1200, 'item', 'itens')).toBe('1.200 itens')
  })
})

describe('montarPendencias — o que entra', () => {
  it('nada contado, nada na lista: é o "tudo em dia"', () => {
    expect(montarPendencias({}, 'loja')).toEqual([])
  })

  it('zero não vira linha — "0 contas vencidas" em vermelho é ruído', () => {
    const c: Contagens = {
      acabaram: 0,
      noMinimo: 0,
      contasVencidas: { quantas: 0, valor: 0 },
      contasHoje: { quantas: 0, valor: 0 },
      parcelasVencidas: { quantas: 0, valor: 0, clientes: 0 },
      tarefasMinhas: 0,
      tarefasEquipe: 0,
      caixasEsquecidos: { quantos: 0, horas: 0 },
      propostas: 0,
    }
    expect(montarPendencias(c, 'loja')).toEqual([])
  })

  it('cada assunto com número vira UMA linha', () => {
    const c: Contagens = {
      acabaram: 3,
      noMinimo: 5,
      contasVencidas: { quantas: 2, valor: 1230 },
      contasHoje: { quantas: 1, valor: 89.9 },
      parcelasVencidas: { quantas: 4, valor: 600, clientes: 3 },
      tarefasMinhas: 2,
      tarefasEquipe: 7,
      caixasEsquecidos: { quantos: 1, horas: 14 },
      propostas: 1,
    }
    expect(montarPendencias(c, 'loja')).toHaveLength(9)
  })
})

describe('montarPendencias — a frase', () => {
  const frase = (c: Contagens) => montarPendencias(c, 'loja').map((p) => limpo(p.frase))

  it('estoque, no singular e no plural', () => {
    expect(frase({ acabaram: 1 })).toEqual(['1 produto acabou'])
    expect(frase({ acabaram: 3 })).toEqual(['3 produtos acabaram'])
    expect(frase({ noMinimo: 1 })).toEqual(['1 produto no mínimo'])
  })

  it('contas: vencidas e as que vencem hoje, com o valor no detalhe', () => {
    const [v, h] = montarPendencias(
      { contasVencidas: { quantas: 2, valor: 1230 }, contasHoje: { quantas: 1, valor: 89.9 } },
      'loja',
    )
    expect(v!.frase).toBe('2 contas vencidas')
    expect(limpo(v!.detalhe)).toContain('R$ 1.230,00')
    expect(h!.frase).toBe('1 conta vence hoje')
    expect(limpo(h!.detalhe)).toContain('R$ 89,90')
    expect(frase({ contasHoje: { quantas: 3, valor: 1 } })).toEqual(['3 contas vencem hoje'])
  })

  it('fiado diz quanto e de quantos clientes', () => {
    const [p] = montarPendencias({ parcelasVencidas: { quantas: 4, valor: 600, clientes: 1 } }, 'loja')
    expect(p!.frase).toBe('4 parcelas de fiado vencidas')
    expect(limpo(p!.detalhe)).toContain('R$ 600,00 de 1 cliente')
    expect(frase({ parcelasVencidas: { quantas: 1, valor: 1, clientes: 1 } })).toEqual(['1 parcela de fiado vencida'])
  })

  it('tarefas: as minhas e as da equipe são linhas separadas', () => {
    expect(frase({ tarefasMinhas: 1, tarefasEquipe: 2 })).toEqual([
      '1 tarefa sua atrasada',
      '2 tarefas da equipe atrasadas',
    ])
  })

  it('caixa: um só diz há quantas horas; vários dizem quantos', () => {
    expect(frase({ caixasEsquecidos: { quantos: 1, horas: 14 } })).toEqual(['Caixa aberto há 14 horas'])
    expect(frase({ caixasEsquecidos: { quantos: 2, horas: 30 } })).toEqual(['2 caixas abertos há mais de 12 horas'])
  })

  it('propostas do assistente', () => {
    expect(frase({ propostas: 1 })).toEqual(['1 proposta do assistente esperando você'])
    expect(frase({ propostas: 3 })).toEqual(['3 propostas do assistente esperando você'])
  })
})

describe('montarPendencias — a ordem e o nível', () => {
  const tudo: Contagens = {
    noMinimo: 5,
    propostas: 1,
    tarefasEquipe: 7,
    tarefasMinhas: 2,
    caixasEsquecidos: { quantos: 1, horas: 14 },
    contasHoje: { quantas: 1, valor: 1 },
    parcelasVencidas: { quantas: 4, valor: 600, clientes: 3 },
    contasVencidas: { quantas: 2, valor: 1230 },
    acabaram: 3,
  }

  it('o que já custa dinheiro vem primeiro, e em ordem fixa', () => {
    expect(montarPendencias(tudo, 'loja').map((p) => p.chave)).toEqual([
      'acabaram',
      'contasVencidas',
      'parcelasVencidas',
      'contasHoje',
      'caixasEsquecidos',
      'propostas',
      'tarefasMinhas',
      'tarefasEquipe',
      'noMinimo',
    ])
  })

  it('a ordem não depende do tamanho: 1 produto acabado vem antes de 50 no mínimo', () => {
    const l = montarPendencias({ noMinimo: 50, acabaram: 1 }, 'loja')
    expect(l.map((p) => p.chave)).toEqual(['acabaram', 'noMinimo'])
  })

  it('crítico é só o que já custou: acabou, conta vencida, fiado vencido', () => {
    const criticos = montarPendencias(tudo, 'loja')
      .filter((p) => p.nivel === 'critico')
      .map((p) => p.chave)
    expect(criticos).toEqual(['acabaram', 'contasVencidas', 'parcelasVencidas'])
  })

  it('nenhum crítico vem depois de um de atenção', () => {
    const niveis = montarPendencias(tudo, 'loja').map((p) => p.nivel)
    expect(niveis.lastIndexOf('critico')).toBeLessThan(niveis.indexOf('atencao'))
  })
})

describe('montarPendencias — o link', () => {
  const href = (c: Contagens, unidade: string | null = null) =>
    montarPendencias(c, 'minha-loja', unidade).map((p) => p.href)

  it('abre a lista já filtrada no que a frase prometeu', () => {
    expect(href({ acabaram: 1 })).toEqual(['/minha-loja/estoque?situacao=acabaram'])
    expect(href({ noMinimo: 1 })).toEqual(['/minha-loja/estoque?situacao=minimo'])
    expect(href({ parcelasVencidas: { quantas: 1, valor: 1, clientes: 1 } })).toEqual([
      '/minha-loja/crediario?situacao=vencida',
    ])
    expect(href({ tarefasMinhas: 1 })).toEqual(['/minha-loja/tarefas?minhas=1'])
    expect(href({ contasVencidas: { quantas: 1, valor: 1 } })).toEqual(['/minha-loja/financeiro'])
    expect(href({ propostas: 1 })).toEqual(['/minha-loja/agente'])
    expect(href({ caixasEsquecidos: { quantos: 1, horas: 13 } })).toEqual(['/minha-loja/caixa'])
  })

  it('leva junto a loja que a pessoa estava olhando', () => {
    expect(href({ acabaram: 1 }, 'u-shopping')).toEqual(['/minha-loja/estoque?situacao=acabaram&unidade=u-shopping'])
    expect(href({ contasVencidas: { quantas: 1, valor: 1 } }, 'u-shopping')).toEqual([
      '/minha-loja/financeiro?unidade=u-shopping',
    ])
  })
})

describe('o cabeçalho do dia', () => {
  it('saudação pela hora', () => {
    expect(saudacao(4)).toBe('Boa noite')
    expect(saudacao(5)).toBe('Bom dia')
    expect(saudacao(11)).toBe('Bom dia')
    expect(saudacao(12)).toBe('Boa tarde')
    expect(saudacao(17)).toBe('Boa tarde')
    expect(saudacao(18)).toBe('Boa noite')
    expect(saudacao(0)).toBe('Boa noite')
  })

  it('só o primeiro nome', () => {
    expect(primeiroNome('Ana Paula Souza')).toBe('Ana')
    expect(primeiroNome('  Bia ')).toBe('Bia')
  })

  it('conta no relógio de São Paulo, seja qual for o do servidor', () => {
    // 02:30 UTC de quinta é 23:30 de QUARTA em São Paulo.
    const t = new Date(Date.UTC(2026, 8, 24, 2, 30))
    expect(noRelogio(t)).toEqual({ hora: 23, semana: 3, dia: 23, mes: 8 })
    expect(diaPorExtenso(t)).toBe('quarta, 23 de setembro')
    expect(horaMinuto(t)).toBe('23:30')
  })

  it('meia-noite é hora 0, não 24', () => {
    expect(noRelogio(new Date(Date.UTC(2026, 8, 24, 3, 0))).hora).toBe(0)
  })

  it('"quarta passada", mas "sábado passado" e "domingo passado"', () => {
    const em = (dia: number) => new Date(Date.UTC(2026, 8, dia, 15)) // 12h em São Paulo
    expect(mesmoDiaPassado(em(23))).toBe('quarta passada')
    expect(mesmoDiaPassado(em(26))).toBe('sábado passado')
    expect(mesmoDiaPassado(em(27))).toBe('domingo passado')
    expect(mesmoDiaPassado(em(28))).toBe('segunda passada')
  })
})
