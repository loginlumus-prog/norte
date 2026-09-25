import { describe, it, expect } from 'vitest'
import {
  contar,
  faltaCom,
  notasSugeridas,
  pagamentosParaEnviar,
  passoAtual,
  type LinhaDaConta,
} from '../src/app/[empresa]/balcao/conta'
import {
  acharVariacao,
  eixosDe,
  faixaDePreco,
  fracionado,
  iniciais,
  partesDaDescricao,
  possivel,
  rotuloDaVariacao,
  tomDe,
  TONS,
  type VariacaoNaVitrine,
} from '../src/app/[empresa]/balcao/vitrine'

const linha = (preco: number, quantidade: number, cartao = preco): LinhaDaConta => ({
  preco,
  precos: { vista: preco, cartao, crediario: cartao },
  quantidade,
})

describe('a conta do balcão', () => {
  it('troco sai do dinheiro recebido a mais', () => {
    const c = contar([linha(12.5, 2), linha(8, 1)], [{ forma: 'DINHEIRO', valor: 50 }], 0, 0)
    expect(c.aPagarCent).toBe(3300)
    expect(c.trocoCent).toBe(1700)
    expect(c.faltaCent).toBe(-1700)
    expect(c.sobrouSemDinheiro).toBe(false)
  })

  it('cartão a mais não dá troco — trava', () => {
    const c = contar([linha(10, 1)], [{ forma: 'PIX', valor: 15 }], 0, 0)
    expect(c.trocoCent).toBe(0)
    expect(c.sobrouSemDinheiro).toBe(true)
  })

  it('pagamento dividido: pix + dinheiro com troco', () => {
    const c = contar(
      [linha(83, 1)],
      [
        { forma: 'PIX', valor: 50 },
        { forma: 'DINHEIRO', valor: 50 },
      ],
      0,
      0,
    )
    expect(c.trocoCent).toBe(1700)
  })

  it('crédito puxa a tabela do cartão, e o que falta é calculado nela', () => {
    const carrinho = [linha(100, 1, 110)]
    expect(faltaCom(carrinho, [], 'PIX', 0, 0)).toBe(10000)
    expect(faltaCom(carrinho, [], 'CREDITO', 0, 0)).toBe(11000)
    const c = contar(carrinho, [{ forma: 'CREDITO', valor: 110 }], 0, 0)
    expect(c.tabela).toBe('cartao')
    expect(c.faltaCent).toBe(0)
    expect(c.temEscada).toBe(true)
  })

  it('desconto e pontos abatem antes do pagamento, e nunca deixam negativo', () => {
    const c = contar([linha(20, 1)], [], 5, 300)
    expect(c.aPagarCent).toBe(1200)
    expect(contar([linha(20, 1)], [], 50, 0).aPagarCent).toBe(0)
  })

  it('peso quebrado arredonda meio-para-cima, como a calculadora do balcão', () => {
    // 44,90 × 0,750 = 33,675 → 33,68
    expect(contar([linha(44.9, 0.75)], [], 0, 0).totalCent).toBe(3368)
  })
})

describe('os pagamentos que vão para o servidor', () => {
  it('o troco sai do ÚLTIMO dinheiro, em centavos exatos', () => {
    const r = pagamentosParaEnviar(
      [
        { forma: 'DINHEIRO', valor: 20 },
        { forma: 'PIX', valor: 30 },
        { forma: 'DINHEIRO', valor: 100 },
      ],
      1710,
    )
    expect(r.map((p) => p.valor)).toEqual([20, 30, 82.9])
  })

  it('sem troco, vai como está', () => {
    const pagos = [{ forma: 'PIX', valor: 33, referencia: undefined, parcelas: undefined }]
    expect(pagamentosParaEnviar(pagos, 0)).toEqual(pagos)
  })

  it('não leva o rótulo da tela junto', () => {
    const r = pagamentosParaEnviar([{ forma: 'CREDIARIO', valor: 90, parcelas: 3, rotulo: 'Crediário 3×' } as never], 0)
    expect(r[0]).toEqual({ forma: 'CREDIARIO', valor: 90, referencia: undefined, parcelas: 3 })
  })
})

describe('as notas prováveis', () => {
  it('R$ 83: exato, 85, 90, 100', () => {
    expect(notasSugeridas(8300)).toEqual([8300, 8500, 9000, 10000])
  })
  it('R$ 12,50: exato, 15, 20, 50', () => {
    expect(notasSugeridas(1250)).toEqual([1250, 1500, 2000, 5000])
  })
  it('R$ 100 redondo: exato, 150, 200', () => {
    expect(notasSugeridas(10000)).toEqual([10000, 15000, 20000])
  })
  it('R$ 20: exato, 50, 100', () => {
    expect(notasSugeridas(2000)).toEqual([2000, 5000, 10000])
  })
  it('nada a pagar, nenhuma nota', () => {
    expect(notasSugeridas(0)).toEqual([])
  })
  it('a primeira é sempre o exato, e nenhuma se repete', () => {
    for (const v of [1, 99, 499, 500, 2350, 4999, 12345, 30000]) {
      const n = notasSugeridas(v)
      expect(n[0]).toBe(v)
      expect(new Set(n).size).toBe(n.length)
      expect(n.every((x) => x >= v)).toBe(true)
    }
  })
})

describe('os três passos', () => {
  it('acende o próximo', () => {
    expect(passoAtual({ itens: 0, pagos: 0, faltaCent: 0, sobrouSemDinheiro: false })).toBe(0)
    expect(passoAtual({ itens: 2, pagos: 0, faltaCent: 3300, sobrouSemDinheiro: false })).toBe(1)
    expect(passoAtual({ itens: 2, pagos: 1, faltaCent: 1000, sobrouSemDinheiro: false })).toBe(2)
    expect(passoAtual({ itens: 2, pagos: 1, faltaCent: -500, sobrouSemDinheiro: true })).toBe(2)
    expect(passoAtual({ itens: 2, pagos: 1, faltaCent: -1700, sobrouSemDinheiro: false })).toBe(3)
  })
})

const va = (id: string, opcoes: [string, string, number][], saldo = 5, preco = 50): VariacaoNaVitrine => ({
  id,
  codigo: id,
  descricao: `Camiseta — ${opcoes.map((o) => o[1]).join(' · ')}`,
  medida: 'UN',
  preco,
  precos: { vista: preco, cartao: preco, crediario: preco },
  saldo,
  opcoes: opcoes.map(([eixo, valor, ordem]) => ({
    eixo,
    eixoOrdem: eixo === 'Tamanho' ? 0 : 1,
    valor,
    ordem,
    hex: null,
  })),
})

describe('a escolha da variação', () => {
  const vs = [
    va('pp', [['Tamanho', 'P', 0], ['Cor', 'Preta', 0]]),
    va('mp', [['Tamanho', 'M', 1], ['Cor', 'Preta', 0]]),
    va('mr', [['Tamanho', 'M', 1], ['Cor', 'Rosa', 1]], 0),
    va('gp', [['Tamanho', 'GG', 3], ['Cor', 'Preta', 0]], 2, 55),
  ]

  it('os eixos saem na ordem do cadastro, sem repetir', () => {
    expect(eixosDe(vs)).toEqual([
      { nome: 'Tamanho', opcoes: [{ valor: 'P', hex: null }, { valor: 'M', hex: null }, { valor: 'GG', hex: null }] },
      { nome: 'Cor', opcoes: [{ valor: 'Preta', hex: null }, { valor: 'Rosa', hex: null }] },
    ])
  })

  it('apaga a opção que não leva a peça nenhuma', () => {
    expect(possivel(vs, { Cor: 'Rosa' }, 'Tamanho', 'GG')).toBe(false)
    expect(possivel(vs, { Cor: 'Rosa' }, 'Tamanho', 'M')).toBe(true)
    expect(possivel(vs, {}, 'Tamanho', 'GG')).toBe(true)
  })

  it('só acha a peça com todos os eixos escolhidos', () => {
    expect(acharVariacao(vs, { Tamanho: 'M' })).toBeNull()
    expect(acharVariacao(vs, { Tamanho: 'M', Cor: 'Rosa' })?.id).toBe('mr')
  })

  it('o cartão diz "a partir de" o menor preço', () => {
    expect(faixaDePreco(vs)).toEqual({ de: 50, ate: 55 })
  })

  it('o rótulo é só a opção; sem opção, o nome', () => {
    expect(rotuloDaVariacao(vs[3]!)).toBe('GG · Preta')
    expect(rotuloDaVariacao({ ...vs[0]!, opcoes: [] })).toBe(vs[0]!.descricao)
  })
})

describe('a cara do cartão', () => {
  it('duas iniciais, pulando palavra miúda', () => {
    expect(iniciais('Sorvete a granel')).toBe('SG')
    expect(iniciais('Açaí')).toBe('AÇ')
    expect(iniciais('Picolé de limão')).toBe('PL')
    expect(iniciais('  ')).toBe('?')
  })

  it('a mesma categoria tem sempre o mesmo tom, e nunca vermelho nem verde', () => {
    expect(tomDe(0)).toBe(tomDe(TONS.length))
    expect(tomDe(-1)).toBe('--nav-3')
    for (const t of TONS) expect(t).not.toMatch(/critico|bom/)
  })

  it('peso pergunta quanto; unidade entra direto', () => {
    expect(fracionado('KG')).toBe(true)
    expect(fracionado('L')).toBe(true)
    expect(fracionado('UN')).toBe(false)
    expect(fracionado('PAR')).toBe(false)
  })

  it('a descrição da busca vira nome e detalhe', () => {
    expect(partesDaDescricao('Camiseta canelada — P · Preta')).toEqual({ nome: 'Camiseta canelada', detalhe: 'P · Preta' })
    expect(partesDaDescricao('Sorvete a granel')).toEqual({ nome: 'Sorvete a granel', detalhe: null })
  })
})
