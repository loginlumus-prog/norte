// Trazer produtos de outro sistema: a leitura da planilha, sem banco.
//
// O que a loja traz de verdade — CSV do Excel em português (ponto e vírgula,
// vírgula decimal, latin1), o que se cola de uma planilha (tabulação), o
// relatório com título em cima e total embaixo, o "CalÃ§a" de quem já leu o
// arquivo errado — tem de virar produto sem a pessoa arrumar nada antes.

import { describe, it, expect } from 'vitest'
import {
  MODELO_CSV,
  acharCabecalho,
  adivinharCampos,
  amostraParaIA,
  arrumarGrade,
  campoDoCabecalho,
  conferirItem,
  consertarAcentos,
  decodificar,
  detectarSeparador,
  lerEan,
  lerMedida,
  lerRespostaDaIA,
  lerTexto,
  lerValor,
  lotes,
  montarItens,
  precisaDeAjuda,
  type Campo,
} from '../src/servidor/importacao-planilha'

const ler = (texto: string) => arrumarGrade(lerTexto(texto))

describe('o texto do arquivo', () => {
  it('UTF-8 com marca, latin1 do Windows e UTF-16 do "Texto Unicode" do Excel', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Calça;Pão')])
    expect(decodificar(utf8)).toBe('Calça;Pão')
    // "Calça" em windows-1252: ç = 0xE7, que sozinho não é UTF-8 válido
    expect(decodificar(new Uint8Array([0x43, 0x61, 0x6c, 0xe7, 0x61]))).toBe('Calça')
    const utf16 = new Uint8Array([0xff, 0xfe, 0x50, 0x00, 0xe3, 0x00, 0x6f, 0x00])
    expect(decodificar(utf16)).toBe('Pão')
  })

  it('desfaz o "CalÃ§a" de quem leu UTF-8 como latin1, e não mexe em texto certo', () => {
    expect(consertarAcentos('CalÃ§a Jeans')).toBe('Calça Jeans')
    expect(consertarAcentos('PÃ£o de AÃ§Ãºcar')).toBe('Pão de Açúcar')
    expect(consertarAcentos('CafÃ© â€“ 500g')).toBe('Café – 500g')
    expect(consertarAcentos('São Paulo')).toBe('São Paulo')
    expect(consertarAcentos('AÇÃO')).toBe('AÇÃO')
  })

  it('acha o separador: ponto e vírgula com vírgula decimal, vírgula, tabulação', () => {
    expect(detectarSeparador('Nome;Preço\nCamiseta;49,90\nBoné;29,90')).toBe(';')
    expect(detectarSeparador('name,price\nShirt,49.90\nCap,29.90')).toBe(',')
    expect(detectarSeparador('Nome\tPreço\nCamiseta\t49,90')).toBe('\t')
    expect(detectarSeparador('nome,preco\n"Camiseta, branca","49,90"\n"Boné","29,90"')).toBe(',')
  })

  it('aspas do jeito do Excel: separador e aspas dentro do campo', () => {
    const g = lerTexto('Nome;Obs\r\n"Tênis 42; preto";"diz ""novo"""\r\n')
    expect(g).toEqual([
      ['Nome', 'Obs'],
      ['Tênis 42; preto', 'diz "novo"'],
    ])
  })
})

describe('os números', () => {
  it('dinheiro e quantidade do jeito brasileiro', () => {
    expect(lerValor('1.234,56')).toBe(1234.56)
    expect(lerValor('R$ 12,90')).toBe(12.9)
    expect(lerValor('12,90 R$')).toBe(12.9)
    expect(lerValor('10 kg')).toBe(10)
    expect(lerValor('2,5L')).toBe(2.5)
    expect(lerValor('-3')).toBe(-3)
    expect(lerValor('(3)')).toBe(-3)
    expect(lerValor('')).toBeNull()
    expect(lerValor('-')).toBeNull()
    expect(lerValor(19.9)).toBe(19.9)
    expect(lerValor('abc')).toBeNaN()
    expect(lerValor('12,3,4')).toBeNaN()
  })

  it('"1.234" se decide pela coluna: milhar aqui, decimal na planilha em inglês', () => {
    expect(lerValor('1.234', 'br')).toBe(1234)
    expect(lerValor('1.234', 'us')).toBe(1.234)
    expect(lerValor('1,234.50', 'br')).toBe(1234.5)
    expect(lerValor('12.90')).toBe(12.9)
  })

  it('medida pela sigla, com ou sem ponto e acento', () => {
    expect(lerMedida('KG')).toBe('KG')
    expect(lerMedida('Unid.')).toBe('UN')
    expect(lerMedida('pç')).toBe('UN')
    expect(lerMedida('Litro')).toBe('L')
    expect(lerMedida('bombona')).toBeNull()
  })

  it('código de barras: só algarismos, e o EAN que o Excel estragou é recusado', () => {
    expect(lerEan('7891234567895')).toEqual({ ean: '7891234567895' })
    expect(lerEan(7891234567895)).toEqual({ ean: '7891234567895' })
    expect(lerEan('7,89123E+12').ean).toBeNull()
    expect(lerEan('7,89123E+12').aviso).toMatch(/Excel/)
    expect(lerEan('ABC').ean).toBeNull()
  })
})

describe('que coluna é o quê', () => {
  it('pelos títulos que os sistemas usam', () => {
    const casos: [string, Campo | null][] = [
      ['Descrição', 'nome'],
      ['Nome do produto', 'nome'],
      ['Cód.', 'codigo'],
      ['SKU', 'codigo'],
      ['Referência', 'codigo'],
      ['Cód. Barras', 'codigoBarras'],
      ['EAN/GTIN', 'codigoBarras'],
      ['Grupo', 'categoria'],
      ['Departamento', 'categoria'],
      ['Preço de venda', 'precoVista'],
      ['Vlr. Venda', 'precoVista'],
      ['Preço à vista', 'precoVista'],
      ['Preço a prazo', 'precoCartao'],
      ['Preço de custo', 'custo'],
      ['Custo médio', 'custo'],
      ['Estoque atual', 'estoque'],
      ['Qtde', 'estoque'],
      ['Saldo', 'estoque'],
      ['UN', 'medida'],
      ['Marca', 'marca'],
      ['Tam.', 'tamanho'],
      ['Numeração', 'tamanho'],
      ['Cor', 'cor'],
      ['Valor total', 'ignorar'],
      ['Estoque mínimo', 'ignorar'],
      ['Qtd vendida', 'ignorar'],
      ['Preço promocional', 'ignorar'],
      ['Pr1', null],
    ]
    for (const [titulo, campo] of casos) expect(campoDoCabecalho(titulo), titulo).toBe(campo)
  })

  it('relatório com título e data em cima: os títulos estão na linha 4', () => {
    const g = ler('Relatório de estoque\nEmitido em 01/10/2026\n\nCód.;Descrição;Grupo;Qtde;Vlr Venda\n001;Camiseta;Roupas;3;49,90\n')
    const cab = acharCabecalho(g)
    expect(cab).toBe(3)
    expect(adivinharCampos(g, cab)).toEqual(['codigo', 'nome', 'categoria', 'estoque', 'precoVista'])
    expect(precisaDeAjuda(g, cab, adivinharCampos(g, cab))).toBe(false)
  })

  it('sem títulos: o conteúdo diz, e a IA é chamada', () => {
    const g = ler('Camiseta básica branca\t49,90\t22,00\t3\t7891234567895\nBoné aba reta\t29,90\t12,00\t10\t7891234567802\n')
    const cab = acharCabecalho(g)
    expect(cab).toBeNull()
    const campos = adivinharCampos(g, cab)
    expect(campos).toEqual(['nome', 'precoVista', 'custo', 'estoque', 'codigoBarras'])
    expect(precisaDeAjuda(g, cab, campos)).toBe(true)
  })

  it('a amostra da IA leva no máximo nove linhas, cortadas, e diz de onde veio cada uma', () => {
    const linhas = Array.from({ length: 30 }, (_, i) => `Produto ${i} ${'x'.repeat(80)};${i},90`).join('\n')
    const g = ler(`Título do relatório\n\nNome;Preço\n${linhas}`)
    const a = amostraParaIA(g, 2)
    expect(a.linhas).toHaveLength(9)
    expect(a.indices[0]).toBe(2)
    expect(a.linhas[1]![0]!.length).toBeLessThanOrEqual(40)
  })

  it('a resposta da IA é conferida: lixo em volta, campo inventado e campo repetido', () => {
    const texto = 'Claro! Aqui está:\n```json\n{"cabecalho": 0, "colunas": ["nome", "preco", "precoVista", "precoVista", "estoque"]}\n```'
    expect(lerRespostaDaIA(texto, 5)).toEqual({ cabecalho: 0, campos: ['nome', 'ignorar', 'precoVista', 'ignorar', 'estoque'] })
    expect(lerRespostaDaIA('{"cabecalho": -1, "colunas": ["nome"]}', 2)).toEqual({ cabecalho: null, campos: ['nome', 'ignorar'] })
    expect(lerRespostaDaIA('não sei', 3)).toBeNull()
    expect(lerRespostaDaIA('{"colunas": "nome"}', 3)).toBeNull()
    expect(lerRespostaDaIA('{"colunas": ["xyz"]}', 1)).toBeNull()
  })
})

describe('as linhas viram produtos', () => {
  const campos: Campo[] = ['codigo', 'nome', 'categoria', 'precoVista', 'custo', 'estoque', 'medida', 'codigoBarras']

  it('o caso comum, com problemas e avisos apontando a linha do Excel', () => {
    const g = ler(
      [
        'Cód;Descrição;Grupo;Preço;Custo;Estoque;Un;EAN',
        '001;Camiseta;Roupas;49,90;22,00;3;UN;7891234567895',
        '002;;Roupas;10,00;;1;UN;',
        '003;Boné;Acessórios;abc;;1;UN;',
        '004;Meia;Roupas;0;;1;UN;',
        '005;Granola;Mercearia;R$ 32,00;19,5;4,5;KG;',
        '006;Caneca;Casa;25,00;;-2;UN;7,89123E+12',
        '001;Camiseta repetida;Roupas;49,90;;1;UN;',
        'Total geral;;;;;9;;',
      ].join('\n'),
    )
    const m = montarItens(g, 0, campos)
    expect(m.itens.map((i) => i.nome)).toEqual(['Camiseta', 'Granola', 'Caneca'])
    expect(m.itens[0]).toMatchObject({ linha: 2, codigo: '001', precoVista: 49.9, custo: 22, estoque: 3, codigoBarras: '7891234567895', medida: 'UN', categoria: 'Roupas' })
    expect(m.itens[1]).toMatchObject({ medida: 'KG', estoque: 4.5, precoVista: 32 })
    expect(m.itens[2]).toMatchObject({ estoque: 0, codigoBarras: null })
    expect(m.problemas.map((p) => [p.linha, p.motivo])).toEqual([
      [3, 'sem nome'],
      [4, 'preço ilegível ("abc")'],
      [5, 'preço zerado ou negativo'],
      [8, 'código 001 repetido (já está na linha 2)'],
      [9, 'parece a linha de total do relatório'],
    ])
    expect(m.avisos.map((a) => a.linha)).toEqual([7, 7])
    expect(m.avisos[0]!.aviso).toMatch(/negativo/)
    expect(m.categorias).toEqual(['Roupas', 'Mercearia', 'Casa'])
    expect(m.linhasLidas).toBe(8)
  })

  it('tamanho e cor: as linhas da mesma peça viram UM produto com grade', () => {
    const g = ler(
      [
        'Código;Nome;Preço;Estoque;Tamanho;Cor',
        'VES10;Vestido Midi;159,90;2;P;Preto',
        'VES10;Vestido Midi;159,90;3;M;Preto',
        'VES10;Vestido Midi;169,90;1;G;Preto',
        'VES10;Vestido Midi;159,90;1;M;Preto',
        ';Sandália Rasteira 36;89,90;4;36;',
        ';Sandália Rasteira 37;89,90;2;37;',
        'BOL1;Bolsa;120,00;1;;',
      ].join('\n'),
    )
    const m = montarItens(g, 0, ['codigo', 'nome', 'precoVista', 'estoque', 'tamanho', 'cor'])
    expect(m.itens).toHaveLength(3)
    const vestido = m.itens[0]!
    expect(vestido.codigo).toBe('VES10')
    expect(vestido.variacoes.map((v) => [v.codigo, v.estoque])).toEqual([
      ['VES10-P-PRETO', 2],
      ['VES10-M-PRETO', 3],
      ['VES10-G-PRETO', 1],
    ])
    // O nome sem o número da sandália: as duas linhas são a mesma peça.
    const sandalia = m.itens[1]!
    expect(sandalia.nome).toBe('Sandália Rasteira')
    expect(sandalia.variacoes.map((v) => v.tamanho)).toEqual(['36', '37'])
    expect(m.itens[2]).toMatchObject({ nome: 'Bolsa', variacoes: [] })
    expect(m.avisos.some((a) => a.linha === 4 && /preço diferente/.test(a.aviso))).toBe(true)
    expect(m.problemas.map((p) => p.linha)).toEqual([5])
  })

  it('a planilha modelo que a tela oferece entra inteira, sem problema', () => {
    const g = ler(MODELO_CSV)
    const cab = acharCabecalho(g)
    const campos = adivinharCampos(g, cab)
    expect(precisaDeAjuda(g, cab, campos)).toBe(false)
    const m = montarItens(g, cab, campos)
    expect(m.problemas).toEqual([])
    expect(m.itens).toHaveLength(3)
  })

  it('os lotes não partem um produto com grade', () => {
    const itens = [{ variacoes: [] }, { variacoes: Array(150).fill(0) }, { variacoes: Array(60).fill(0) }, { variacoes: [] }]
    expect(lotes(itens as never, 200).map((l) => l.length)).toEqual([2, 2])
  })
})

describe('o que o servidor confere', () => {
  it('recusa o que não é produto e corta o que passa do teto', () => {
    expect(conferirItem(null)).toBe('linha em formato desconhecido')
    expect(conferirItem({ nome: 'X', precoVista: 0 })).toMatch(/maior que zero/)
    expect(conferirItem({ nome: 'X', precoVista: 10, estoque: -1 })).toBe('número ilegível')
    expect(conferirItem({ nome: 'X', precoVista: 10, custo: 'abc' })).toBe('número ilegível')
    const ok = conferirItem({ linha: 3, nome: `  ${'a'.repeat(300)}  `, precoVista: 10.555, codigo: 'abc-1', codigoBarras: '12', medida: 'XX', variacoes: [] })
    expect(typeof ok).toBe('object')
    if (typeof ok === 'object') {
      expect(ok.nome).toHaveLength(200)
      expect(ok.codigo).toBe('ABC-1')
      expect(ok.codigoBarras).toBeNull()
      expect(ok.medida).toBe('UN')
      expect(ok.precoVista).toBe(10.56)
    }
  })
})
