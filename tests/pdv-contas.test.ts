// As contas puras do balcão novo: a agenda do crediário, o desconto em % e o
// acréscimo, o preço mostrado antes da forma, o juro do crédito, o PIN, a
// maquininha e o vale por loja. Sem banco — o que roda com banco está em
// pdv-balcao.test.ts.

import { describe, it, expect } from 'vitest'
import {
  agendaDoCrediario,
  mesmoDiaDepois,
  primeiroVencimentoMaximo,
  primeiroVencimentoPadrao,
  problemaDoPrimeiroVencimento,
} from '../src/servidor/crediario-agenda'
import {
  contar,
  cpfConfere,
  descontoEmCentavos,
  faltaCom,
  jurosDoCredito,
  pagamentosParaEnviar,
  type LinhaDaConta,
} from '../src/app/[empresa]/balcao/conta'
import { problemaDoPin } from '../src/servidor/autorizacao'
import { lerMaquininhas, maquininhaDoPagamento } from '../src/servidor/maquininhas'
import { valeServeNaLoja } from '../src/servidor/venda'
import { tabelaDe } from '../src/servidor/preco'

const dia = (d: Date) => d.toISOString().slice(0, 10)

describe('agenda do crediário: mesmo dia de cada mês', () => {
  it('a partir do 1º vencimento escolhido, no mesmo dia dos meses seguintes', () => {
    const a = agendaDoCrediario({ totalCent: 30000, parcelas: 3, primeiroVencimento: '2026-11-10' })
    expect(a.map((x) => dia(x.vencimento))).toEqual(['2026-11-10', '2026-12-10', '2027-01-10'])
    expect(a.map((x) => x.valorCent)).toEqual([10000, 10000, 10000])
    expect(a.map((x) => `${x.numero}/${x.de}`)).toEqual(['1/3', '2/3', '3/3'])
  })

  it('dia 31 cai no último dia do mês curto e volta a 31 no mês seguinte', () => {
    const a = agendaDoCrediario({ totalCent: 40000, parcelas: 4, primeiroVencimento: '2027-01-31' })
    expect(a.map((x) => dia(x.vencimento))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  })

  it('fevereiro de ano bissexto tem 29', () => {
    expect(mesmoDiaDepois('2028-01-30', 1)).toBe('2028-02-29')
    expect(mesmoDiaDepois('2027-01-29', 1)).toBe('2027-02-28')
  })

  it('vira o ano sem escorregar', () => {
    expect(mesmoDiaDepois('2026-12-15', 1)).toBe('2027-01-15')
    expect(mesmoDiaDepois('2026-10-05', 12)).toBe('2027-10-05')
  })

  it('os centavos que sobram vão para as primeiras parcelas', () => {
    const a = agendaDoCrediario({ totalCent: 10000, parcelas: 3, primeiroVencimento: '2026-11-01' })
    expect(a.map((x) => x.valorCent)).toEqual([3334, 3333, 3333])
    expect(a.reduce((s, x) => s + x.valorCent, 0)).toBe(10000)
  })

  it('a loja com outro intervalo (quinzenal) segue em dias, a partir do 1º vencimento', () => {
    const a = agendaDoCrediario({ totalCent: 3000, parcelas: 3, primeiroVencimento: '2026-11-01', diasEntre: 15 })
    expect(a.map((x) => dia(x.vencimento))).toEqual(['2026-11-01', '2026-11-16', '2026-12-01'])
  })

  it('o 1º vencimento padrão é hoje + 30, e vai até 60 dias', () => {
    expect(primeiroVencimentoPadrao('2026-10-01')).toBe('2026-10-31')
    expect(primeiroVencimentoMaximo('2026-10-01')).toBe('2026-11-30')
    expect(problemaDoPrimeiroVencimento('2026-10-31', '2026-10-01')).toBeNull()
    expect(problemaDoPrimeiroVencimento('2026-11-30', '2026-10-01')).toBeNull()
    expect(problemaDoPrimeiroVencimento('2026-12-01', '2026-10-01')).toMatch(/60 dias/)
    expect(problemaDoPrimeiroVencimento('2026-10-01', '2026-10-01')).toMatch(/depois de hoje/)
    expect(problemaDoPrimeiroVencimento('2026-09-20', '2026-10-01')).toMatch(/depois de hoje/)
    expect(problemaDoPrimeiroVencimento('2026-02-30', '2026-01-01')).toMatch(/inválida/)
    expect(problemaDoPrimeiroVencimento('amanhã', '2026-10-01')).toMatch(/inválida/)
  })

  it('nada para montar: zero, sem parcela, data ruim', () => {
    expect(agendaDoCrediario({ totalCent: 0, parcelas: 3, primeiroVencimento: '2026-11-01' })).toEqual([])
    expect(agendaDoCrediario({ totalCent: 100, parcelas: 0, primeiroVencimento: '2026-11-01' })).toEqual([])
    expect(agendaDoCrediario({ totalCent: 100, parcelas: 1, primeiroVencimento: 'x' })).toEqual([])
  })
})

const linha = (vista: number, quantidade: number, cartao = vista, crediario = cartao): LinhaDaConta => ({
  preco: vista,
  precos: { vista, cartao, crediario },
  quantidade,
})

describe('a conta do balcão: desconto em %, acréscimo e o preço antes da forma', () => {
  it('desconto em % é sobre as peças na tabela da forma — muda junto com a forma', () => {
    const carrinho = [linha(100, 1, 120)]
    const pix = contar(carrinho, [{ forma: 'PIX', valor: 90 }], { desconto: 10, descontoEmPct: true }, 0)
    expect(pix.descontoCent).toBe(1000)
    expect(pix.aPagarCent).toBe(9000)
    const credito = contar(carrinho, [{ forma: 'CREDITO', valor: 108 }], { desconto: 10, descontoEmPct: true }, 0)
    expect(credito.descontoCent).toBe(1200)
    expect(credito.aPagarCent).toBe(10800)
    expect(faltaCom(carrinho, [], 'CREDITO', { desconto: 10, descontoEmPct: true }, 0)).toBe(10800)
  })

  it('desconto em % nunca passa de 100, e em reais nunca passa das peças', () => {
    expect(descontoEmCentavos(5000, { desconto: 150, descontoEmPct: true })).toBe(5000)
    expect(descontoEmCentavos(5000, { desconto: 80 })).toBe(5000)
    expect(descontoEmCentavos(5000, { desconto: 12.5, descontoEmPct: true })).toBe(625)
  })

  it('acréscimo soma depois do desconto e entra no que falta', () => {
    const c = contar([linha(50, 2)], [{ forma: 'DINHEIRO', valor: 100 }], { desconto: 10, acrescimo: 15 }, 0)
    expect(c.totalCent).toBe(10000)
    expect(c.descontoCent).toBe(1000)
    expect(c.acrescimoCent).toBe(1500)
    expect(c.aPagarCent).toBe(10500)
    expect(c.faltaCent).toBe(500)
    expect(faltaCom([linha(50, 2)], [], 'PIX', { desconto: 0, acrescimo: 15 }, 0)).toBe(11500)
  })

  it('o número antigo (desconto em reais) continua valendo', () => {
    expect(contar([linha(20, 1)], [], 5, 300).aPagarCent).toBe(1200)
  })

  it('antes de escolher a forma, mostra o preço mais caro e quanto economiza à vista', () => {
    const carrinho = [linha(100, 1, 110, 125)]
    const antes = contar(carrinho, [], 0, 0, 'crediario')
    expect(antes.escolheu).toBe(false)
    expect(antes.tabela).toBe('crediario')
    expect(antes.aPagarCent).toBe(12500)
    expect(antes.economiaCent).toBe(2500)
    const depois = contar(carrinho, [{ forma: 'PIX', valor: 100 }], 0, 0, 'crediario')
    expect(depois.tabela).toBe('vista')
    expect(depois.aPagarCent).toBe(10000)
    expect(depois.economiaCent).toBe(0)
  })

  it('o débito puxa o preço de cartão', () => {
    const carrinho = [linha(100, 1, 110)]
    expect(faltaCom(carrinho, [], 'DEBITO', 0, 0)).toBe(11000)
    expect(contar(carrinho, [{ forma: 'DEBITO', valor: 110 }], 0, 0).tabela).toBe('cartao')
    expect(tabelaDe(['DEBITO'])).toBe('cartao')
  })

  it('juro do crédito só de 2× para cima, arredondado ao centavo', () => {
    expect(jurosDoCredito(10000, 1, 5)).toBe(0)
    expect(jurosDoCredito(10000, 3, 0)).toBe(0)
    expect(jurosDoCredito(10000, 3, 2.5)).toBe(250)
    expect(jurosDoCredito(3333, 2, 3)).toBe(100)
  })

  it('a maquininha e o 1º vencimento vão junto para o servidor', () => {
    const enviados = pagamentosParaEnviar(
      [
        { forma: 'CREDITO', valor: 50, parcelas: 3, maquininha: 'Banco Azul' },
        { forma: 'CREDIARIO', valor: 30, parcelas: 2, primeiroVencimento: '2026-11-10' },
      ],
      0,
    )
    expect(enviados[0]).toMatchObject({ forma: 'CREDITO', parcelas: 3, maquininha: 'Banco Azul' })
    expect(enviados[1]).toMatchObject({ forma: 'CREDIARIO', primeiroVencimento: '2026-11-10' })
  })

  it('o CPF da tela confere os dígitos, como o do servidor', () => {
    expect(cpfConfere('529.982.247-25')).toBe(true)
    expect(cpfConfere('52998224724')).toBe(false)
    expect(cpfConfere('111.111.111-11')).toBe(false)
    expect(cpfConfere('123')).toBe(false)
  })
})

describe('o PIN', () => {
  it('de 4 a 6 números, sem repetido nem escada', () => {
    expect(problemaDoPin('2580')).toBeNull()
    expect(problemaDoPin('730194')).toBeNull()
    expect(problemaDoPin('123')).toMatch(/4 a 6/)
    expect(problemaDoPin('1234567')).toMatch(/4 a 6/)
    expect(problemaDoPin('12a4')).toMatch(/só de números/)
    expect(problemaDoPin('0000')).toMatch(/repetido/)
    expect(problemaDoPin('1234')).toMatch(/Sequência/)
    expect(problemaDoPin('4321')).toMatch(/Sequência/)
    expect(problemaDoPin('7890')).toMatch(/Sequência/)
  })
})

describe('as maquininhas da loja', () => {
  const lista = lerMaquininhas([
    { nome: 'Banco Azul', formas: ['PIX', 'DEBITO', 'CREDITO'] },
    { nome: ' Pague Fácil ', formas: ['CREDITO', 'DINHEIRO'] },
    { nome: '', formas: ['PIX'] },
    { nome: 'banco azul', formas: ['PIX'] },
    { nome: 'Sem forma', formas: [] },
    'lixo',
  ])

  it('lê só o que serve: com nome, forma de maquininha e sem repetir', () => {
    expect(lista).toEqual([
      { nome: 'Banco Azul', formas: ['PIX', 'DEBITO', 'CREDITO'] },
      { nome: 'Pague Fácil', formas: ['CREDITO'] },
    ])
    expect(lerMaquininhas(null)).toEqual([])
  })

  it('o pagamento só aceita maquininha desta loja que aceita a forma', () => {
    expect(maquininhaDoPagamento(lista, 'CREDITO', 'pague fácil')).toEqual({ ok: true, nome: 'Pague Fácil' })
    expect(maquininhaDoPagamento(lista, 'PIX', 'Pague Fácil')).toEqual({ ok: false })
    expect(maquininhaDoPagamento(lista, 'DINHEIRO', 'Banco Azul')).toEqual({ ok: false })
    expect(maquininhaDoPagamento(lista, 'PIX', 'Inventada')).toEqual({ ok: false })
    expect(maquininhaDoPagamento(lista, 'PIX', null)).toEqual({ ok: true, nome: null })
    expect(maquininhaDoPagamento([], 'PIX', '')).toEqual({ ok: true, nome: null })
  })
})

describe('vale por loja', () => {
  it('com a regra, só na loja que emitiu; vale sem loja serve em todas', () => {
    expect(valeServeNaLoja(true, 'loja-1', 'loja-1')).toBe(true)
    expect(valeServeNaLoja(true, 'loja-1', 'loja-2')).toBe(false)
    expect(valeServeNaLoja(true, null, 'loja-2')).toBe(true)
    expect(valeServeNaLoja(false, 'loja-1', 'loja-2')).toBe(true)
  })
})
