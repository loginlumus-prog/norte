// O bloco do ramo no painel, e os toques do ramo no balcão.
//
// O que se confere aqui é a HONESTIDADE das contas: a grade quebrada só
// quando o que vendia acabou e o resto sobrou; a média do mesmo dia da semana
// dividida só pelos dias em que a loja já vendia; o sabor que "acaba hoje"
// pela venda média, e não por palpite; a balança só vale com peso ESTÁVEL.

import { describe, it, expect } from 'vitest'
import {
  NICHOS,
  abaixoDoMinimo,
  categoriaDeComplemento,
  agruparPorRamo,
  deQuantosDias,
  diaDaSemana,
  encomendasDePerto,
  giro,
  gradeMaisVendida,
  gradeQuebrada,
  gradeQuebradaNasLojas,
  horasFortes,
  listaFalada,
  mesmosDiasAntes,
  picoDoDia,
  producaoDoDia,
  quantidadeFalada,
  quilosVendidos,
  ramoEfetivo,
  saboresAcabando,
  saboresDoDia,
  tituloDoNicho,
  type LinhaDeSabor,
} from '../src/servidor/nicho'
import { RAMOS } from '../src/servidor/modulos'
import {
  lerPeso,
  pesoNoCampo,
  pedeComplemento,
  teclasDePeso,
  ehComplemento,
  digitarNoPeso,
} from '../src/app/[empresa]/balcao/ramo'
import { matrizDaGrade, type VariacaoNaVitrine } from '../src/app/[empresa]/balcao/vitrine'

describe('a tabela de nichos', () => {
  it('todo ramo tem nicho, e todo nicho é de um ramo', () => {
    expect(Object.keys(NICHOS).sort()).toEqual(Object.keys(RAMOS).sort())
  })

  it('o ramo da loja vale; sem ele, o da empresa; sem os dois, "outro"', () => {
    expect(ramoEfetivo('sorveteria', 'roupa')).toBe('sorveteria')
    expect(ramoEfetivo(null, 'roupa')).toBe('roupa')
    expect(ramoEfetivo('inventado', 'padaria')).toBe('padaria')
    expect(ramoEfetivo(null, null)).toBe('outro')
    // "toString" existe em todo objeto — e não é ramo.
    expect(ramoEfetivo('toString', null)).toBe('outro')
  })

  it('o título fala como o dono fala, com o artigo certo', () => {
    expect(tituloDoNicho('sorveteria', 1)).toBe('Hoje na sua sorveteria')
    expect(tituloDoNicho('petshop', 1)).toBe('Hoje no seu pet shop')
    expect(tituloDoNicho('roupa', 2)).toBe('Hoje nas suas lojas de roupas')
    expect(tituloDoNicho('petshop', 3)).toBe('Hoje nos seus pet shops')
  })
})

describe('agruparPorRamo — o consolidado', () => {
  const lojas = [
    { id: 'a1', nome: 'Centro', ramo: null, ehDeposito: false },
    { id: 's1', nome: 'Sorveteria', ramo: 'sorveteria', ehDeposito: false },
    { id: 'a2', nome: 'Shopping', ramo: null, ehDeposito: false },
    { id: 'd1', nome: 'Depósito', ramo: null, ehDeposito: true },
  ]

  it('cada ramo com as lojas dele, o de mais lojas primeiro, sem depósito', () => {
    const g = agruparPorRamo(lojas, 'roupa')
    expect(g.map((x) => x.ramo)).toEqual(['roupa', 'sorveteria'])
    expect(g[0]!.lojas.map((l) => l.id)).toEqual(['a1', 'a2'])
    expect(g[1]!.lojas.map((l) => l.id)).toEqual(['s1'])
  })

  it('no máximo três ramos', () => {
    const muitas = ['padaria', 'mercearia', 'petshop', 'papelaria'].map((r, i) => ({
      id: `u${i}`, nome: r, ramo: r, ehDeposito: false,
    }))
    expect(agruparPorRamo(muitas, null)).toHaveLength(3)
  })

  it('só depósito: nenhum bloco', () => {
    expect(agruparPorRamo([lojas[3]!], 'roupa')).toEqual([])
  })
})

describe('texto', () => {
  it('lista falada', () => {
    expect(listaFalada([])).toBe('')
    expect(listaFalada(['M'])).toBe('M')
    expect(listaFalada(['M', 'G'])).toBe('M e G')
    expect(listaFalada(['P', 'M', 'G'])).toBe('P, M e G')
  })

  it('quantidade com a medida: quilo com casas, unidade inteira', () => {
    expect(quantidadeFalada(0.35, 'KG')).toBe('0,35 kg')
    expect(quantidadeFalada(2.44, 'KG')).toBe('2,4 kg')
    expect(quantidadeFalada(12.25, 'UN')).toBe('12 un')
    expect(quantidadeFalada(3, 'PAR')).toBe('3 par')
  })

  it('o dia da semana e o "das últimas 4 quartas"', () => {
    expect(diaDaSemana('2026-09-23').um).toBe('quarta')
    expect(deQuantosDias('2026-09-23', 4)).toBe('das últimas 4 quartas')
    expect(deQuantosDias('2026-09-26', 2)).toBe('dos últimos 2 sábados')
    expect(deQuantosDias('2026-09-23', 1)).toBe('da última quarta')
    expect(deQuantosDias('2026-09-27', 1)).toBe('do último domingo')
  })

  it('os mesmos dias antes, atravessando o mês', () => {
    expect(mesmosDiasAntes('2026-10-07', 4)).toEqual(['2026-09-30', '2026-09-23', '2026-09-16', '2026-09-09'])
  })
})

describe('gradeQuebrada', () => {
  const peca = (rotulo: string, saldo: number, vendidos30: number, produtoId = 'cam', produto = 'Camiseta canelada') => ({
    produtoId, produto, rotulo, saldo, vendidos30,
  })

  it('acabou o que vendia e sobrou o resto: é grade quebrada, na ordem da grade', () => {
    const r = gradeQuebrada([peca('PP', 4, 1), peca('M', 0, 9), peca('G', 0, 6), peca('GG', 3, 0)])
    expect(r).toEqual([
      { produtoId: 'cam', produto: 'Camiseta canelada', acabou: ['M', 'G'], sobrou: ['PP', 'GG'], vendiaNoMes: 15 },
    ])
  })

  it('zerado que nunca vendeu não é grade quebrada — é grade que nunca chegou', () => {
    expect(gradeQuebrada([peca('PP', 0, 0), peca('M', 5, 3)])).toEqual([])
  })

  it('acabou tudo não é grade quebrada: a peça inteira acabou', () => {
    expect(gradeQuebrada([peca('P', 0, 3), peca('M', 0, 2)])).toEqual([])
  })

  it('produto sem grade (uma variação só) não entra', () => {
    expect(gradeQuebrada([peca('Único', 0, 5)])).toEqual([])
  })

  it('o buraco que mais custa vem primeiro', () => {
    const r = gradeQuebrada([
      peca('M', 0, 2, 'a', 'Blusa'), peca('G', 1, 0, 'a', 'Blusa'),
      peca('38', 0, 10, 'b', 'Calça'), peca('40', 2, 1, 'b', 'Calça'),
    ])
    expect(r.map((g) => g.produto)).toEqual(['Calça', 'Blusa'])
  })
})

describe('gradeQuebradaNasLojas — loja por loja', () => {
  const l = (unidadeId: string, variacaoId: string, rotulo: string, saldo: number, vendidos30: number) => ({
    unidadeId, variacaoId, rotulo, saldo, vendidos30, produtoId: 'cam', produto: 'Camiseta',
  })
  const nomes = new Map([['c', 'Centro'], ['s', 'Shopping']])

  it('a soma das lojas não esconde o buraco de uma — e diz quem tem a peça', () => {
    const r = gradeQuebradaNasLojas(
      [
        l('c', 'm', 'M', 0, 8), l('c', 'g', 'G', 4, 2),
        l('s', 'm', 'M', 6, 1), l('s', 'g', 'G', 2, 1),
      ],
      nomes,
    )
    expect(r).toEqual([
      expect.objectContaining({ unidadeId: 'c', unidadeNome: 'Centro', acabou: ['M'], sobrou: ['G'], temEm: ['Shopping'] }),
    ])
  })

  it('ninguém tem: a lista das outras lojas vem vazia', () => {
    const r = gradeQuebradaNasLojas([l('c', 'm', 'M', 0, 8), l('c', 'g', 'G', 4, 2), l('s', 'm', 'M', 0, 0)], nomes)
    expect(r[0]!.temEm).toEqual([])
  })
})

describe('gradeMaisVendida', () => {
  const o = (eixo: string, valor: string, ordem: number, quantidade: number, ehCor = false) => ({ eixo, valor, ordem, quantidade, ehCor })

  it('usa o eixo principal do ramo e mostra na ordem da grade, com a porcentagem', () => {
    const r = gradeMaisVendida(
      [o('Tamanho', 'G', 3, 2), o('Tamanho', 'P', 1, 3), o('Tamanho', 'M', 2, 5), o('Cor', 'Preto', 1, 10, true)],
      'Tamanho',
    )!
    expect(r.eixo).toBe('Tamanho')
    expect(r.total).toBe(10)
    expect(r.itens.map((i) => i.valor)).toEqual(['P', 'M', 'G'])
    expect(r.itens.find((i) => i.valor === 'M')).toMatchObject({ pct: 50, maior: true })
  })

  it('sem o eixo do ramo, prefere o que não é cor', () => {
    const r = gradeMaisVendida([o('Cor', 'Azul', 1, 50, true), o('Numeração', '38', 1, 4)], 'Tamanho')!
    expect(r.eixo).toBe('Numeração')
  })

  it('sem venda, nada', () => {
    expect(gradeMaisVendida([], 'Tamanho')).toBeNull()
  })
})

describe('sabores', () => {
  const s = (rotulo: string, x: Partial<LinhaDeSabor>): LinhaDeSabor => ({
    variacaoId: rotulo, rotulo, produto: null, medida: 'KG', saldo: 5, minimo: null, vendidosHoje: 0, vendidos7: 0, ...x,
  })

  it('acabou só se vendia; acaba hoje pela venda média; mínimo pelo da loja', () => {
    const r = saboresAcabando([
      s('Morango', { saldo: 0, vendidos7: 0 }), // não vendia: não é notícia
      s('Chocolate', { saldo: 0, vendidos7: 14 }),
      s('Flocos', { saldo: 1, vendidos7: 14 }), // 2 kg por dia, sobrou 1
      s('Creme', { saldo: 3, minimo: 4, vendidos7: 7 }), // 1 kg/dia, dura 3 dias, mas está no mínimo
      s('Limão', { saldo: 30, minimo: 4, vendidos7: 7 }),
    ])
    expect(r.map((x) => [x.rotulo, x.motivo])).toEqual([
      ['Chocolate', 'acabou'],
      ['Flocos', 'acaba_hoje'],
      ['Creme', 'minimo'],
    ])
  })

  it('o que mais saiu hoje, pela quantidade', () => {
    const r = saboresDoDia([s('A', { vendidosHoje: 1.2 }), s('B', { vendidosHoje: 0 }), s('C', { vendidosHoje: 2 })])
    expect(r.map((x) => x.rotulo)).toEqual(['C', 'A'])
  })

  it('a peso antes de por unidade, e complemento não é sabor', () => {
    const r = saboresDoDia([
      s('Picolé de uva', { medida: 'UN', vendidosHoje: 9 }),
      s('Granola', { medida: 'UN', vendidosHoje: 20, complemento: true }),
      s('Flocos', { medida: 'KG', vendidosHoje: 0.3 }),
      s('Creme', { medida: 'G', vendidosHoje: 500 }),
    ])
    expect(r.map((x) => x.rotulo)).toEqual(['Creme', 'Flocos', 'Picolé de uva'])
  })

  it('a aba de complementos, com ou sem acento e plural', () => {
    expect(categoriaDeComplemento('Complementos')).toBe(true)
    expect(categoriaDeComplemento('Coberturas')).toBe(true)
    expect(categoriaDeComplemento('Açaí')).toBe(false)
    expect(categoriaDeComplemento(null)).toBe(false)
  })

  it('quilos: KG direto, G dividido por mil, unidade fora', () => {
    expect(quilosVendidos([{ medida: 'KG', quantidade: 1.5 }, { medida: 'G', quantidade: 500 }, { medida: 'UN', quantidade: 7 }])).toBeCloseTo(2, 9)
  })

  it('pico: a hora com mais vendas, empate na mais cedo', () => {
    const h = Array.from({ length: 24 }, () => 0)
    h[14] = 5
    h[16] = 5
    h[9] = 2
    expect(picoDoDia(h)).toEqual({ hora: 14, vendas: 5 })
    expect(picoDoDia(Array.from({ length: 24 }, () => 0))).toBeNull()
  })
})

describe('produção do dia', () => {
  const hoje = '2026-09-23' // quarta
  const dias = mesmosDiasAntes(hoje, 4) // 16, 09, 02/09, 26/08
  const v = (dia: string, quantidade: number, chave = 'pao', rotulo = 'Pão francês', medida = 'KG') => ({
    chave, rotulo, medida, dia, quantidade,
  })

  it('média das quartas em que a loja já vendia — não inventa quarta zerada', () => {
    // A loja abriu em 05/09: só as quartas 09/09 e 16/09 contam.
    const r = producaoDoDia([v('2026-09-16', 10), v('2026-09-09', 6), v(hoje, 3)], dias, hoje, '2026-09-05')
    expect(r.semanas).toBe(2)
    expect(r.itens).toEqual([{ chave: 'pao', rotulo: 'Pão francês', medida: 'KG', media: 8, hoje: 3 }])
  })

  it('quatro quartas: divide por quatro, inclusive a quarta que não vendeu aquele item', () => {
    const r = producaoDoDia([v('2026-09-16', 8), v('2026-09-02', 4)], dias, hoje, '2026-01-01')
    expect(r.semanas).toBe(4)
    expect(r.itens[0]!.media).toBe(3)
  })

  it('outro dia da semana não entra na média', () => {
    const r = producaoDoDia([v('2026-09-22', 50), v('2026-09-16', 4)], dias, hoje, '2026-01-01')
    expect(r.itens[0]!.media).toBe(1)
  })

  it('loja sem venda antes de hoje: sem média', () => {
    expect(producaoDoDia([v(hoje, 3)], dias, hoje, hoje)).toEqual({ semanas: 0, itens: [] })
    expect(producaoDoDia([], dias, hoje, null)).toEqual({ semanas: 0, itens: [] })
  })

  it('horas fortes: as de maior média, na ordem do relógio, com o que mais sai', () => {
    const r = horasFortes(
      [{ hora: 7, total: 400 }, { hora: 12, total: 100 }, { hora: 17, total: 300 }, { hora: 8, total: 200 }],
      4,
      [{ hora: 7, rotulo: 'Pão francês', quantidade: 20 }, { hora: 7, rotulo: 'Café', quantidade: 5 }],
    )
    expect(r).toEqual([
      { hora: 7, media: 100, item: 'Pão francês' },
      { hora: 8, media: 50, item: null },
      { hora: 17, media: 75, item: null },
    ])
  })

  it('encomendas de perto: atrasada, hoje e amanhã; depois e entregue ficam de fora', () => {
    const agora = new Date('2026-09-23T15:00:00-03:00')
    const e = (para: string, situacao: 'ABERTA' | 'PRONTA' | 'ENTREGUE' = 'ABERTA') => ({ para: new Date(para), situacao })
    const r = encomendasDePerto(
      [
        e('2026-09-23T10:00:00-03:00'), // atrasada
        e('2026-09-23T18:00:00-03:00', 'PRONTA'), // hoje
        e('2026-09-24T09:00:00-03:00'), // amanhã
        e('2026-09-25T09:00:00-03:00'), // depois
        e('2026-09-23T19:00:00-03:00', 'ENTREGUE'),
      ],
      agora,
    )
    expect([r.atrasadas.length, r.hoje.length, r.amanha.length]).toEqual([1, 1, 1])
  })
})

describe('reposição', () => {
  it('giro: com a comparação, e "novo" sem venda antes', () => {
    const r = giro([
      { rotulo: 'Arroz', medida: 'UN', semana: 30, anterior: 20 },
      { rotulo: 'Feijão', medida: 'UN', semana: 10, anterior: 0 },
      { rotulo: 'Sal', medida: 'UN', semana: 0, anterior: 9 },
    ])
    expect(r.map((g) => [g.rotulo, g.variacao])).toEqual([['Arroz', 50], ['Feijão', null]])
  })

  it('abaixo do mínimo, do mais vazio ao menos', () => {
    const r = abaixoDoMinimo([
      { rotulo: 'A', medida: 'UN', saldo: 5, minimo: 5 },
      { rotulo: 'B', medida: 'UN', saldo: 0, minimo: 3 },
      { rotulo: 'C', medida: 'UN', saldo: 9, minimo: 3 },
    ])
    expect(r.map((x) => x.rotulo)).toEqual(['B', 'A'])
  })
})

/* ── balcão ────────────────────────────────────────────────── */

describe('teclas de peso por ramo', () => {
  it('sorveteria pesa copo; padaria pesa pão', () => {
    expect(teclasDePeso('sorveteria', 'KG').map((t) => t.valor)).toEqual([0.2, 0.3, 0.5, 1])
    expect(teclasDePeso('padaria', 'KG').map((t) => t.valor)).toEqual([0.1, 0.25, 0.5, 1])
    expect(teclasDePeso('sorveteria', 'KG')[0]!.rotulo).toBe('200 g')
  })

  it('produto em grama: as mesmas teclas, na unidade do produto', () => {
    expect(teclasDePeso('sorveteria', 'G').map((t) => t.valor)).toEqual([200, 300, 500, 1000])
    expect(teclasDePeso('sorveteria', 'G')[3]!.rotulo).toBe('1 kg')
  })

  it('o peso lido vai para o campo na unidade do produto, com vírgula', () => {
    expect(pesoNoCampo(0.35, 'KG')).toBe('0,35')
    expect(pesoNoCampo(0.35, 'G')).toBe('350')
    expect(pesoNoCampo(1, 'KG')).toBe('1')
  })

  it('o teclado grande: uma vírgula só, três casas no máximo', () => {
    expect(digitarNoPeso('', '0')).toBe('0')
    expect(digitarNoPeso('0', ',')).toBe('0,')
    expect(digitarNoPeso('0,', ',')).toBe('0,')
    expect(digitarNoPeso('0,35', '0')).toBe('0,350')
    expect(digitarNoPeso('0,350', '1')).toBe('0,350')
    expect(digitarNoPeso('0,35', 'apagar')).toBe('0,3')
    expect(digitarNoPeso('', ',')).toBe('0,')
    expect(digitarNoPeso('00', '5')).toBe('5')
  })
})

describe('lerPeso — a balança', () => {
  const STX = '\x02'
  const ETX = '\x03'

  it('Toledo/Filizola: cinco dígitos entre STX e ETX, em gramas', () => {
    expect(lerPeso(`${STX}00350${ETX}`)).toEqual({ kg: 0.35 })
  })

  it('peso instável (IIIII) não vale', () => {
    expect(lerPeso(`${STX}IIIII${ETX}`)).toEqual({ instavel: true })
  })

  it('a última leitura estável é a que vale', () => {
    expect(lerPeso(`${STX}IIIII${ETX}${STX}00410${ETX}`)).toEqual({ kg: 0.41 })
  })

  it('linha "ST,GS": estável; "US": instável', () => {
    expect(lerPeso('ST,GS,+  0.352kg\r\n')).toEqual({ kg: 0.352 })
    expect(lerPeso('US,GS,+  0.352kg\r\n')).toEqual({ instavel: true })
    expect(lerPeso('ST,NT,+  350 g\r\n')).toEqual({ kg: 0.35 })
  })

  it('lixo, vazio ou quadro pela metade: nada', () => {
    expect(lerPeso('')).toBeNull()
    expect(lerPeso('abc')).toBeNull()
    expect(lerPeso(`${STX}003`)).toBeNull()
  })

  it('peso absurdo não vale', () => {
    expect(lerPeso('ST,GS,+99999.000kg\r\n')).toBeNull()
  })
})

describe('complementos na sorveteria', () => {
  it('copo, açaí, massa pedem complemento; picolé e o próprio complemento não', () => {
    expect(pedeComplemento('sorveteria', 'Açaí', 'Açaí 500 ml')).toBe(true)
    expect(pedeComplemento('sorveteria', 'Massa', 'Sorvete a granel')).toBe(true)
    expect(pedeComplemento('sorveteria', 'Sorvetes', 'Sorvete a granel')).toBe(true)
    expect(pedeComplemento('sorveteria', 'Picolé', 'Picolé de uva')).toBe(false)
    expect(pedeComplemento('sorveteria', 'Complementos', 'Granola')).toBe(false)
  })

  it('só na sorveteria', () => {
    expect(pedeComplemento('roupa', 'Açaí', 'Açaí')).toBe(false)
    expect(pedeComplemento(null, 'Açaí', 'Açaí')).toBe(false)
  })

  it('a categoria de complementos, com ou sem acento e plural', () => {
    expect(ehComplemento('Complementos')).toBe(true)
    expect(ehComplemento('complemento')).toBe(true)
    expect(ehComplemento('Coberturas')).toBe(true)
    expect(ehComplemento('Picolé')).toBe(false)
  })
})

describe('a grade na folha de escolha', () => {
  const vv = (id: string, tam: string, cor: string, saldo: number): VariacaoNaVitrine => ({
    id, codigo: id, descricao: `Camiseta — ${tam} · ${cor}`, medida: 'UN', preco: 10,
    precos: { vista: 10, cartao: 10, crediario: 10 }, saldo,
    opcoes: [
      { eixo: 'Tamanho', eixoOrdem: 0, valor: tam, ordem: ['P', 'M', 'G'].indexOf(tam), hex: null },
      { eixo: 'Cor', eixoOrdem: 1, valor: cor, ordem: ['Preto', 'Azul'].indexOf(cor), hex: null },
    ],
  })

  it('linhas do primeiro eixo, colunas do segundo, e buraco onde a peça não existe', () => {
    const m = matrizDaGrade([vv('1', 'P', 'Preto', 2), vv('2', 'M', 'Preto', 0), vv('3', 'M', 'Azul', 5)])!
    expect(m.linhas.nome).toBe('Tamanho')
    expect(m.colunas.nome).toBe('Cor')
    expect(m.linhas.opcoes.map((o) => o.valor)).toEqual(['P', 'M'])
    expect(m.colunas.opcoes.map((o) => o.valor)).toEqual(['Preto', 'Azul'])
    expect(m.celulas.map((l) => l.map((c) => c?.saldo ?? null))).toEqual([
      [2, null],
      [0, 5],
    ])
  })

  it('a cor (com bolinha) vai para as colunas, mesmo cadastrada primeiro', () => {
    const comCor = (x: VariacaoNaVitrine): VariacaoNaVitrine => ({
      ...x,
      opcoes: x.opcoes.map((o) =>
        o.eixo === 'Cor' ? { ...o, eixoOrdem: 0, hex: '#000' } : { ...o, eixoOrdem: 1 },
      ),
    })
    const m = matrizDaGrade([comCor(vv('1', 'P', 'Preto', 2)), comCor(vv('2', 'M', 'Azul', 1))])!
    expect(m.linhas.nome).toBe('Tamanho')
    expect(m.colunas.nome).toBe('Cor')
  })

  it('só com dois eixos', () => {
    expect(matrizDaGrade([])).toBeNull()
  })
})
