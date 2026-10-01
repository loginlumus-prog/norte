import { describe, it, expect } from 'vitest'
import {
  TAMANHOS, ajustarRolo, codigoDoProduto, economiaAVista, emReais, etiquetasDoProduto, etiquetasHTML,
  giroFinal, larguraPagina, linhaDoNome, pecasEmEstoque, testeCalibracaoHTML, trocaOrientacao,
  type Etiqueta, type ProdutoEtiquetavel,
} from '../src/servidor/etiqueta-layout'

// A etiqueta da loja, conferida no TEXTO que vai para a impressora — o mesmo
// HTML da prévia. Espelha a bateria da origem (src/lib/etiqueta.ts, layout 2).

const peca: Etiqueta = {
  nome: 'Blusa Canelada',
  ref: 'AC001225',
  codigo: '005393',
  vista: 8990,
  cartao: 9990,
  crediario: 10990,
  parcelasCartao: 3,
  categoria: 'Blusas',
  variacao: 'M · Verde Musgo',
}

const t33 = TAMANHOS['33x22-1col']
const t60 = TAMANHOS['60x40']

/** O texto da linha do nome no papel (e não no arquivo todo: o CSS também tem "·"). */
const linhaNome = (html: string) => (/<div class="nome[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html) ?? [, ''])[1]!.trim()
/** Só o corpo: o que vai no papel, sem os comentários do CSS. */
const corpo = (html: string) => html.slice(html.indexOf('<body>'))

/** Uma grade P/M com cores, como a loja cadastra: 2 verdes e 1 preta no P, 2 verdes no M. */
const comGrade: ProdutoEtiquetavel = {
  nome: 'Blusa Canelada',
  categoria: 'Blusas',
  variacoes: [
    { codigo: '005393-P-VERDE', opcoes: 'P · Verde', vista: 8990, cartao: 9990, crediario: 10990, saldo: 2 },
    { codigo: '005393-P-PRETO', opcoes: 'P · Preto', vista: 8990, cartao: 9990, crediario: 10990, saldo: 1 },
    { codigo: '005393-M-VERDE', opcoes: 'M · Verde', vista: 8990, cartao: 9990, crediario: 10990, saldo: 2 },
  ],
}

describe('etiqueta da loja · o que sai no papel', () => {
  const html = etiquetasHTML([peca], t33)

  it('a COR e o TAMANHO não aparecem', () => {
    expect(html).not.toMatch(/verde musgo/i)
    expect(linhaNome(html)).not.toContain('M ·')
  })

  it('nome com a referência do fornecedor colada, em caixa alta, sem separador órfão', () => {
    expect(linhaNome(html)).toBe('BLUSA CANELADA AC001225')
    expect(linhaNome(etiquetasHTML([{ ...peca, ref: null }], t33))).toBe('BLUSA CANELADA')
    expect(linhaDoNome({ nome: '  Vestido ', ref: '' })).toBe('VESTIDO')
  })

  it('o código, a categoria e os três preços', () => {
    expect(html).toContain('005393')
    expect(html).toContain('Blusas')
    expect(html).toContain('R$ 89,90')
    expect(html).toContain('R$ 99,90')
    expect(html).toContain('R$ 109,90')
  })

  it('o CÓDIGO vem antes do nome (é o que se digita no balcão)', () => {
    const b = corpo(html)
    expect(b.indexOf('005393')).toBeGreaterThan(-1)
    expect(b.indexOf('005393')).toBeLessThan(b.indexOf('BLUSA CANELADA'))
  })

  it('uma linha por forma: À VISTA / PIX em destaque, CARTÃO ATÉ Nx e CREDIÁRIO', () => {
    const b = corpo(html)
    expect(b.match(/class="pl/g)).toHaveLength(3)
    expect(b).toMatch(/class="pl hero"[\s\S]*?À VISTA \/ PIX/)
    expect(b).toContain('CARTÃO ATÉ 3X')
    expect(b).toContain('CREDIÁRIO')
    expect(b.indexOf('À VISTA')).toBeLessThan(b.indexOf('CARTÃO'))
    expect(b.indexOf('CARTÃO')).toBeLessThan(b.indexOf('CREDIÁRIO'))
  })

  it('cartão em 1x não diz "até"; preço que a loja não preencheu não vira linha', () => {
    const b = corpo(etiquetasHTML([{ ...peca, parcelasCartao: 1, crediario: null }], t33))
    expect(b).toContain('>CARTÃO<')
    expect(b).not.toContain('CREDIÁRIO')
    expect(corpo(etiquetasHTML([{ ...peca, cartao: null, crediario: null }], t33)).match(/class="pl/g)).toHaveLength(1)
  })

  it('o selo ECONOMIZE X% À VISTA é SVG (imprime sem "gráficos de segundo plano")', () => {
    expect(html).toMatch(/<svg class="selo"[\s\S]*?ECONOMIZE 10% À VISTA/)
    // nenhum fundo preto pintado por CSS: ele sumiria na impressão
    expect(html).not.toMatch(/background:\s*#000/)
    expect(economiaAVista(8990, 9990)).toBe(10)
    expect(economiaAVista(12599, 13999)).toBe(10)
  })

  it('sem cartão mais caro, sem selo', () => {
    expect(etiquetasHTML([{ ...peca, cartao: 8990 }], t33)).not.toContain('ECONOMIZE')
    expect(etiquetasHTML([{ ...peca, cartao: null }], t33)).not.toContain('ECONOMIZE')
    expect(economiaAVista(16990, 16990)).toBe(0)
  })

  it('produto sem código sai com "S/ CÓDIGO"', () => {
    expect(etiquetasHTML([{ ...peca, codigo: null }], t33)).toContain('S/ CÓDIGO')
    expect(etiquetasHTML([{ ...peca, codigo: '   ' }], t33)).toContain('S/ CÓDIGO')
    expect(html).not.toContain('S/ CÓDIGO')
  })

  it('sem código de barras por padrão; com ele, a barra é do código impresso e o nome fica numa linha', () => {
    expect(corpo(html)).not.toContain('class="barra"')
    const comBarras = etiquetasHTML([peca], t60, 0, { codigoDeBarras: true })
    expect(comBarras).toMatch(/<div class="barra"><svg preserveAspectRatio="none"[^>]*aria-label="005393"/)
    expect(comBarras).toContain('class="nome uma"')
    // sem código não há o que codificar
    expect(corpo(etiquetasHTML([{ ...peca, codigo: null }], t60, 0, { codigoDeBarras: true }))).not.toContain('class="barra"')
  })

  it('texto da loja não vira HTML', () => {
    const h = etiquetasHTML([{ ...peca, nome: 'Blusa <b>x</b> & "y"', categoria: '<i>' }], t33)
    expect(h).toContain('BLUSA &lt;B&gt;X&lt;/B&gt; &amp; &quot;Y&quot;')
    expect(h).not.toContain('<i>')
  })

  it('preço longo encolhe e leva o ponto do milhar', () => {
    expect(emReais(129990)).toBe('R$ 1.299,90')
    expect(emReais(5)).toBe('R$ 0,05')
    expect(emReais(123456789)).toBe('R$ 1.234.567,89')
    const curto = /class="pr-vl" style="font-size:([\d.]+)mm"/.exec(etiquetasHTML([peca], t33))![1]
    const longo = /class="pr-vl" style="font-size:([\d.]+)mm"/.exec(etiquetasHTML([{ ...peca, vista: 129990 }], t33))![1]
    expect(Number(longo)).toBeLessThan(Number(curto))
  })

  it('o bilhete da CSP vai no <style> quando a página tem', () => {
    expect(etiquetasHTML([peca], t33, 0, { nonce: 'abc123==' })).toContain('<style nonce="abc123==">')
    expect(html).toContain('<style>')
  })
})

describe('etiqueta da loja · o código do produto', () => {
  it('a grade importada imprime a etiqueta do produto, sem o tamanho e a cor', () => {
    expect(codigoDoProduto(['005704-G', '005704-GG', '005704-M', '005704-P'])).toBe('005704')
    expect(codigoDoProduto(['4950-27-GREYWH', '4950-28-PRETOB'])).toBe('4950')
    expect(codigoDoProduto(['5414-37/38', '5414-38'])).toBe('5414')
    // a variação sem sufixo É a etiqueta (a grade cresceu depois)
    expect(codigoDoProduto(['5414', '5414-34'])).toBe('5414')
    expect(codigoDoProduto(['5414-34', '5414'])).toBe('5414')
  })

  it('um número só em duas cores: a raiz, e não a raiz com o número', () => {
    expect(codigoDoProduto(['4950-27-GREYWH', '4950-27-PRETOB'])).toBe('4950')
    expect(codigoDoProduto(['005372-WHITEC', '005372-WHITEC-2'])).toBe('005372')
  })

  it('variação única: o código dela inteiro', () => {
    expect(codigoDoProduto(['006339'])).toBe('006339')
    expect(codigoDoProduto(['005220-3', null, ''])).toBe('005220-3')
  })

  it('código do Norte por variação (sem raiz comum): nenhum, e cada etiqueta leva o da sua peça', () => {
    expect(codigoDoProduto(['SLI017', 'SLI018'])).toBeNull()
    expect(codigoDoProduto(['0059901', '005990-36'])).toBeNull()
    expect(codigoDoProduto([])).toBeNull()
    const es = etiquetasDoProduto({
      nome: 'Slide',
      variacoes: [
        { codigo: 'SLI017', vista: 8990, cartao: null, crediario: null, saldo: 1 },
        { codigo: 'SLI018', vista: 8990, cartao: null, crediario: null, saldo: 1 },
      ],
    })
    expect(es.map((e) => e.codigo)).toEqual(['SLI017', 'SLI018'])
  })

  it('etiqueta de UMA variação da grade ainda leva o código do produto, quando a tela já sabe', () => {
    const so = { ...comGrade, codigo: '005393', variacoes: [comGrade.variacoes[2]!] }
    expect(etiquetasDoProduto(so)[0]!.codigo).toBe('005393')
    // sem dizer, sairia o da variação inteira
    expect(etiquetasDoProduto({ ...so, codigo: undefined })[0]!.codigo).toBe('005393-M-VERDE')
    // raiz nenhuma (nulo): cada uma com o seu
    expect(etiquetasDoProduto({ ...so, codigo: null })[0]!.codigo).toBe('005393-M-VERDE')
  })

  it('não confunde caixa: a raiz sai como a loja escreveu', () => {
    expect(codigoDoProduto(['ab12-p', 'AB12-M'])).toBe('ab12')
  })
})

describe('etiqueta da loja · quantas', () => {
  it('pelo estoque: uma por peça (cor × tamanho), e nenhuma mostra a cor', () => {
    const es = etiquetasDoProduto(comGrade)
    expect(pecasEmEstoque(comGrade)).toBe(5)
    expect(es).toHaveLength(5)
    expect(es.every((e) => e.codigo === '005393')).toBe(true)
    expect(etiquetasHTML(es, t33)).not.toMatch(/Verde|Preto/i)
  })

  it('saldo negativo ou quebrado não inventa peça', () => {
    const p: ProdutoEtiquetavel = {
      nome: 'X',
      variacoes: [
        { codigo: 'X-P', vista: 100, cartao: null, crediario: null, saldo: -3 },
        { codigo: 'X-M', vista: 100, cartao: null, crediario: null, saldo: 2.5 },
      ],
    }
    expect(pecasEmEstoque(p)).toBe(2)
    expect(etiquetasDoProduto(p)).toHaveLength(2)
  })

  it('sem nada em estoque ainda sai uma (a da primeira variação)', () => {
    const p = { ...comGrade, variacoes: comGrade.variacoes.map((v) => ({ ...v, saldo: 0 })) }
    const es = etiquetasDoProduto(p)
    expect(es).toHaveLength(1)
    expect(es[0]!.codigo).toBe('005393')
  })

  it('eu escolho quantas, MENOS que o estoque: as peças em roda, não três da primeira', () => {
    const es = etiquetasDoProduto(comGrade, { quantidade: 3 })
    expect(es.map((e) => e.variacao)).toEqual(['P · Verde', 'P · Verde', 'P · Preto'])
  })

  it('eu escolho quantas, MAIS que o estoque: repete em roda', () => {
    const es = etiquetasDoProduto(comGrade, { quantidade: 7 })
    expect(es).toHaveLength(7)
    expect(es[5]!.variacao).toBe('P · Verde')
    expect(es[6]!.variacao).toBe('P · Verde')
  })

  it('zero = nenhuma; produto sem variação = nenhuma', () => {
    expect(etiquetasDoProduto(comGrade, { quantidade: 0 })).toEqual([])
    expect(etiquetasDoProduto({ nome: 'Y', variacoes: [] }, { quantidade: 3 })).toEqual([])
  })

  it('o preço é o da variação (com o ajuste dela) e as parcelas vão em todas', () => {
    const p: ProdutoEtiquetavel = {
      nome: 'Calça',
      variacoes: [
        { codigo: 'C-38', vista: 10000, cartao: 11000, crediario: 12000, saldo: 1 },
        { codigo: 'C-48', vista: 11500, cartao: 12500, crediario: 13500, saldo: 1 },
      ],
    }
    const es = etiquetasDoProduto(p, { parcelasCartao: 6 })
    expect(es.map((e) => e.vista)).toEqual([10000, 11500])
    expect(es.every((e) => e.parcelasCartao === 6)).toBe(true)
    expect(etiquetasHTML(es, t60)).toContain('CARTÃO ATÉ 6X')
  })
})

describe('etiqueta da loja · o rolo', () => {
  it('fileira de 3 no 33×22: 107 mm, vão de 2 mm', () => {
    const t = TAMANHOS['33x22-3col']
    expect(larguraPagina(t)).toBe(107)
    const h = etiquetasHTML(etiquetasDoProduto(comGrade), t) // 5 etiquetas
    expect(h).toContain('@page { size: 107mm 22mm; margin: 0; }')
    expect(h.match(/class="pg"/g)).toHaveLength(2) // 2 fileiras
    expect(h.match(/class="et vazia"/g)).toHaveLength(1) // a última com 1 espaço em branco
  })

  it('o 60×40 já nasce girado 90°: a página é 40×60 e o desenho gira', () => {
    expect(giroFinal(t60, 0)).toBe(90)
    const h = etiquetasHTML([peca], t60, giroFinal(t60, 0))
    expect(h).toContain('@page { size: 40mm 60mm; margin: 0; }')
    expect(h).toContain('rotate(90deg)')
  })

  it('a correção soma ao giro do rolo e volta ao normal em 360°', () => {
    expect(giroFinal(t60, 90)).toBe(180)
    expect(giroFinal(t60, 270)).toBe(0)
    expect(trocaOrientacao(180)).toBe(false)
    const h = etiquetasHTML([peca], t60, 180)
    expect(h).toContain('@page { size: 60mm 40mm; margin: 0; }')
    expect(h).toContain('rotate(180deg)')
    expect(etiquetasHTML([peca], t60, 0)).not.toContain('rotate(')
  })

  it('a prévia (sem giro) tem o tamanho da etiqueta', () => {
    expect(etiquetasHTML([peca], t60)).toContain('@page { size: 60mm 40mm; margin: 0; }')
    expect(etiquetasHTML([peca], TAMANHOS['50x30'])).toContain('@page { size: 50mm 30mm; margin: 0; }')
  })

  it('o 60×40 é o mesmo desenho do 33×22, 1,82× maior; o 50×30 escala pela altura para caber', () => {
    const fonte = (h: string) => Number(/\.et \{[\s\S]*?font-size:([\d.]+)mm/.exec(h)![1])
    expect(fonte(etiquetasHTML([peca], t33))).toBeCloseTo(1.2, 2)
    expect(fonte(etiquetasHTML([peca], t60))).toBeCloseTo(1.2 * (60 / 33), 2)
    expect(fonte(etiquetasHTML([peca], TAMANHOS['50x30']))).toBeCloseTo(1.2 * (30 / 22), 2)
  })

  it('ajuste fino: a sobra de cada lado sai da largura do rolo e do vão', () => {
    const base = TAMANHOS['33x22-3col']
    expect(ajustarRolo(base).margemMM).toBe(2)
    expect(ajustarRolo(base, { larguraRoloMM: 110, gapMM: 3 }).margemMM).toBe(2.5)
    expect(ajustarRolo(base, { gapMM: 1 })).toMatchObject({ gapMM: 1, margemMM: 2 })
    expect(larguraPagina(ajustarRolo(base, { gapMM: 1 }))).toBe(105)
    // rolo mais estreito que as etiquetas: sobra zero, nunca negativa
    expect(ajustarRolo(base, { larguraRoloMM: 90 }).margemMM).toBe(0)
  })
})

describe('etiqueta da loja · página de teste', () => {
  it('um quadro por coluna e a barra de 100 mm para medir', () => {
    const h = testeCalibracaoHTML(TAMANHOS['33x22-3col'])
    expect(h.match(/class="qd"/g)).toHaveLength(3)
    expect(h).toContain('Esta barra tem 100 mm')
    expect(h).toContain('papel 107×22 mm')
    expect(h.match(/<i style="left:/g)).toHaveLength(9)
  })

  it('no 60×40 a barra é o que cabe, e a página vem girada como as etiquetas', () => {
    const h = testeCalibracaoHTML(t60, giroFinal(t60, 0), { nonce: 'n1' })
    expect(h).toContain('Esta barra tem 60 mm')
    expect(h).toContain('@page { size: 40mm 60mm; margin: 0; }')
    expect(h).toContain('<style nonce="n1">')
  })

  it('a barra é borda, não fundo — imprime com "gráficos de segundo plano" desligado', () => {
    expect(testeCalibracaoHTML(t33)).not.toMatch(/background:\s*#000/)
  })
})
