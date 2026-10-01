// A etiqueta da LOJA: o papel de gôndola que a vendedora e a cliente já conhecem.
//
// A loja chegou de outro sistema imprimindo etiqueta na térmica (rolo 60×40,
// às vezes o 33×22 de três colunas) e a equipe lê aquele papel de olho: o
// CÓDIGO grande em cima (é o que se digita no balcão), o nome, e os TRÊS
// preços — à vista/Pix em destaque, cartão "até Nx" e crediário — com o selo
// "ECONOMIZE X% À VISTA". Trocar de sistema não pode trocar o papel: aqui está
// o mesmo desenho, medida por medida (origem: src/lib/etiqueta.ts, layout 2).
//
// Gera uma página HTML no tamanho EXATO do papel. A impressora de etiqueta
// aparece como impressora comum do Windows: sem driver especial, sem SDK. O
// mesmo HTML é a prévia da tela e o que vai para o papel — os dois não têm
// como divergir.
//
// Puro, sem I/O: a tela monta no navegador; os testes conferem o texto.

import { svgCode128 } from './codigo-barras'
import { SEPARADOR_DA_ETIQUETA } from './etiqueta'

// ── o que vai no papel ───────────────────────────────────────

/** Uma etiqueta. Dinheiro em CENTAVOS; nulo = a loja não preencheu aquele preço. */
export type Etiqueta = {
  codigo: string | null
  nome: string
  /** Referência do fornecedor — vai COLADA no nome, como a loja escrevia. */
  ref?: string | null
  categoria?: string | null
  /**
   * Tamanho e cor ("M · Preto"). NÃO vão para o papel — quem segura a peça já
   * vê a cor, e o tamanho a loja nem usava. Ficam só para a contagem "pelo
   * estoque" sair uma por peça de verdade.
   */
  variacao?: string | null
  vista: number
  cartao: number | null
  crediario: number | null
  /** "CARTÃO ATÉ Nx". 1 ou nada = sem o "até". */
  parcelasCartao?: number
}

/** Uma variação na forma mínima que a etiqueta precisa. Preços JÁ com o ajuste da variação. */
export type VariacaoEtiquetavel = {
  codigo: string | null
  /** "M · Preto" — só para a tela. */
  opcoes?: string | null
  vista: number
  cartao: number | null
  crediario: number | null
  /** Peças na(s) loja(s) escolhida(s). */
  saldo: number
}

export type ProdutoEtiquetavel = {
  nome: string
  referencia?: string | null
  categoria?: string | null
  /**
   * O código da etiqueta do produto, quando já se sabe (tirado de TODAS as
   * variações — ver `codigoDoProduto`). Sem ele, sai das variações dadas;
   * com uma variação só na lista, sairia o código dela inteiro.
   */
  codigo?: string | null
  variacoes: VariacaoEtiquetavel[]
}

/** Teto de uma impressão: "pelo estoque" de uma caixa grande não pode virar mil páginas sem querer. */
export const MAXIMO_DE_ETIQUETAS = 1000

const limpo = (s: string | null | undefined) => (s ?? '').trim()

/**
 * O código da etiqueta do PRODUTO, que é o que a loja imprime.
 *
 * O produto que veio de outro sistema tem uma etiqueta para a grade inteira e
 * as variações a levam na frente: 005704-P, 005704-M, 4950-27-PRETO (ver
 * etiqueta.ts). O papel leva só o 005704 — o tamanho a vendedora vê na peça,
 * e digitar 005704 no balcão já abre a grade.
 *
 * Fica com a MENOR raiz comum que termina antes de um hífen: 4950-27-GREY e
 * 4950-27-PRETO (só um número, duas cores) dão 4950, e não 4950-27. Uma
 * variação só: o código dela inteiro. Sem raiz comum (CAM001, CAM002 — o
 * código do Norte é por variação): nulo, e cada etiqueta leva o da sua peça.
 */
export function codigoDoProduto(codigos: readonly (string | null | undefined)[]): string | null {
  const originais: string[] = []
  const vistos = new Set<string>()
  for (const c of codigos) {
    const t = limpo(c)
    if (t && !vistos.has(t.toUpperCase())) {
      vistos.add(t.toUpperCase())
      originais.push(t)
    }
  }
  if (originais.length === 0) return null
  if (originais.length === 1) return originais[0]!
  const altos = originais.map((c) => c.toUpperCase())
  const primeiro = altos[0]!
  for (let k = 1; k <= primeiro.length; k++) {
    const raiz = primeiro.slice(0, k)
    if (raiz.endsWith(SEPARADOR_DA_ETIQUETA)) continue
    if (altos.every((c) => c.startsWith(raiz) && (c.length === k || c[k] === SEPARADOR_DA_ETIQUETA))) {
      return originais[0]!.slice(0, k)
    }
  }
  return null
}

/** Peças inteiras de um saldo. Saldo negativo (vendeu sem estoque) não etiqueta nada. */
const pecas = (saldo: number) => Math.max(0, Math.floor(Number(saldo) || 0))

/** Quantas peças o produto tem em estoque — é o "uma etiqueta por peça exposta". */
export function pecasEmEstoque(p: ProdutoEtiquetavel): number {
  return p.variacoes.reduce((n, v) => n + pecas(v.saldo), 0)
}

/**
 * As etiquetas de UM produto.
 *
 * `quantidade` indefinida = uma por peça em estoque (cada tamanho × cor), que
 * é como a peça fica na arara. Com quantidade escolhida, as peças se repetem
 * em roda — 3 etiquetas de um produto com P, M e G em estoque saem uma de
 * cada, e não três da primeira. Produto sem nada em estoque ainda merece uma
 * etiqueta: a da primeira variação.
 */
export function etiquetasDoProduto(
  p: ProdutoEtiquetavel,
  opts: { parcelasCartao?: number; quantidade?: number } = {},
): Etiqueta[] {
  const raiz = p.codigo !== undefined ? limpo(p.codigo) || null : codigoDoProduto(p.variacoes.map((v) => v.codigo))
  const daVariacao = (v: VariacaoEtiquetavel): Etiqueta => ({
    codigo: raiz ?? (limpo(v.codigo) || null),
    nome: p.nome,
    ref: p.referencia ?? null,
    categoria: p.categoria ?? null,
    variacao: v.opcoes ?? null,
    vista: v.vista,
    cartao: v.cartao,
    crediario: v.crediario,
    parcelasCartao: opts.parcelasCartao,
  })

  const porPeca: Etiqueta[] = []
  for (const v of p.variacoes) for (let i = 0; i < pecas(v.saldo); i++) porPeca.push(daVariacao(v))
  const fonte = porPeca.length ? porPeca : p.variacoes[0] ? [daVariacao(p.variacoes[0])] : []
  if (opts.quantidade === undefined) return fonte
  if (fonte.length === 0) return []
  return Array.from({ length: pecas(opts.quantidade) }, (_, i) => fonte[i % fonte.length]!)
}

// ── o rolo ───────────────────────────────────────────────────

/** Quanto girar o desenho na página. 90/270 = quarto de volta (a página troca de orientação). */
export type Giro = 0 | 90 | 180 | 270

/**
 * Geometria do rolo. `colunas` é o que pega: o rolo 33×22 tem TRÊS etiquetas
 * lado a lado, então a página impressa é a FILEIRA inteira, não uma etiqueta
 * — senão o desenho cai em cima da emenda.
 */
export type TamanhoEtiqueta = {
  /** Largura de UMA etiqueta. */
  larguraMM: number
  /** Altura de UMA etiqueta (= altura da página). */
  alturaMM: number
  /** Etiquetas lado a lado no rolo. */
  colunas: number
  /** Vão entre as colunas. */
  gapMM: number
  /** Sobra em cada lado do papel. */
  margemMM: number
  /**
   * Giro que ESTE rolo já pede para sair certo — é o "Normal" dele, não uma
   * correção. O 60×40 entra na térmica deitado: sem os 90° o desenho sai
   * atravessado. No tamanho, para ninguém precisar lembrar de "Girar 90°".
   */
  giroBase?: Giro
}

/** Quarto de volta → a página inverte largura × altura. 180° não inverte. */
export const trocaOrientacao = (giro: Giro): boolean => giro === 90 || giro === 270

/** Giro final = o que o rolo já pede + a correção escolhida. */
export const giroFinal = (t: TamanhoEtiqueta, ajuste: Giro): Giro => (((t.giroBase ?? 0) + ajuste) % 360) as Giro

/** Largura total da página = colunas × etiqueta + vãos + margens. */
export const larguraPagina = (t: TamanhoEtiqueta): number =>
  t.colunas * t.larguraMM + (t.colunas - 1) * t.gapMM + 2 * t.margemMM

/**
 * Os rolos. Geometria MEDIDA na impressão da loja (fotos de 29/07 da origem),
 * não chutada: no 33×22 o vão é 2 mm e a fileira de 3 é 33×3 + 2×2 = 103 mm;
 * com 2 mm de sobra de cada lado, o papel tem 107 mm — cabe nos 108 mm de
 * impressão da térmica comum (Elgin L42 Pro e parentes).
 */
export const TAMANHOS = {
  // 60×40 = o rolo do dia a dia da loja, que entra deitado: o desenho nasce girado 90°.
  '60x40': { larguraMM: 60, alturaMM: 40, colunas: 1, gapMM: 0, margemMM: 0, giroBase: 90 },
  // Uma etiqueta por página: quem espalha nas 3 colunas é o DRIVER ("etiquetas
  // por linha = 3"). É o que menos depende do navegador acertar a escala.
  '33x22-1col': { larguraMM: 33, alturaMM: 22, colunas: 1, gapMM: 0, margemMM: 0 },
  // A página é a FILEIRA inteira (107 mm): não depende do driver saber das
  // colunas, mas exige um papel de 107×22 mm cadastrado nele.
  '33x22-3col': { larguraMM: 33, alturaMM: 22, colunas: 3, gapMM: 2, margemMM: 2 },
  '50x30': { larguraMM: 50, alturaMM: 30, colunas: 1, gapMM: 0, margemMM: 0 },
} as const satisfies Record<string, TamanhoEtiqueta>

export type ChaveTamanho = keyof typeof TAMANHOS

/**
 * O ajuste fino, medido com régua: a LARGURA DO ROLO (o papel inteiro) e o vão
 * entre as etiquetas. A sobra de cada lado sai da conta — o que fica depois
 * das etiquetas e dos vãos, dividido nos dois lados.
 */
export function ajustarRolo(base: TamanhoEtiqueta, ajuste: { gapMM?: number | null; larguraRoloMM?: number | null } = {}): TamanhoEtiqueta {
  const gapMM = ajuste.gapMM ?? base.gapMM
  const rolo = ajuste.larguraRoloMM ?? larguraPagina({ ...base, gapMM })
  const sobra = (rolo - base.colunas * base.larguraMM - (base.colunas - 1) * gapMM) / 2
  return { ...base, gapMM, margemMM: Math.max(0, Math.round(sobra * 10) / 10) }
}

// ── o desenho ────────────────────────────────────────────────

/**
 * A escala do desenho. Tudo foi medido no 33×22 e cresce em proporção: o
 * 60×40 é o mesmo desenho 1,82× maior. Pela MENOR das duas medidas, para o
 * 50×30 (mais achatado) caber na altura — no 33×22 e no 60×40 dá o mesmo.
 */
const escalaDe = (t: TamanhoEtiqueta) => Math.min(t.larguraMM / 33, t.alturaMM / 22)

/** "R$ 1.299,90", sem depender do idioma da máquina. */
export function emReais(cent: number): string {
  const c = Math.round(Number(cent) || 0)
  const abs = Math.abs(c)
  const inteiro = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${c < 0 ? '-' : ''}R$ ${inteiro},${String(abs % 100).padStart(2, '0')}`
}

/** Quanto o à vista economiza sobre o cartão, em % inteiro. Sem cartão mais caro, zero (e sem selo). */
export function economiaAVista(vista: number, cartao: number | null): number {
  const c = Number(cartao) || 0
  return c > vista ? Math.round(((c - vista) / c) * 100) : 0
}

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/**
 * Selo preto "ECONOMIZE X% À VISTA" como SVG, não como `background:#000`.
 *
 * O Chrome vem com "Gráficos de segundo plano" DESMARCADO: todo fundo some na
 * impressão e o selo sairia como texto preto solto, sem a tarja. Desenho SVG
 * é conteúdo, não fundo — imprime sempre.
 */
function seloSVG(texto: string, k: number): string {
  const fs = 1.15 // mm, na escala k = 1
  const larg = texto.length * fs * 0.62 + 1.6 // Arial negrito ≈ 0,62 em por caractere + folga
  const alt = fs * 1.9
  return `<svg class="selo" width="${(larg * k).toFixed(2)}mm" height="${(alt * k).toFixed(2)}mm"
    viewBox="0 0 ${larg.toFixed(2)} ${alt.toFixed(2)}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${larg.toFixed(2)}" height="${alt.toFixed(2)}" rx="${(alt / 2).toFixed(2)}" fill="#000"/>
    <text x="${(larg / 2).toFixed(2)}" y="${(alt / 2).toFixed(2)}" fill="#fff" font-family="Arial, Helvetica, sans-serif"
      font-size="${fs}" font-weight="bold" text-anchor="middle" dominant-baseline="central">${esc(texto)}</text>
  </svg>`
}

/** Código de barras esticado na largura da etiqueta (Code 128 do código impresso). */
function barraSVG(codigo: string): string {
  const ascii = [...codigo].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126).join('')
  if (!ascii.trim()) return ''
  return svgCode128(ascii, { altura: 10, modulo: 1 }).replace('<svg ', '<svg preserveAspectRatio="none" ')
}

/** O texto da linha do nome: NOME + referência do fornecedor, em caixa alta. Sem cor, sem tamanho. */
export const linhaDoNome = (e: Pick<Etiqueta, 'nome' | 'ref'>): string =>
  [limpo(e.nome), limpo(e.ref)].filter(Boolean).join(' ').toUpperCase()

/**
 * Uma etiqueta.
 *
 *   linha 1 .... CÓDIGO grande à esquerda · categoria pequena à direita
 *   linha 2 .... NOME + REF do fornecedor (até 2 linhas)
 *   [barras] ... só se a loja pedir (o padrão é sem: a loja digita o código)
 *   régua
 *   preços ..... uma linha POR forma, rótulo à esquerda e valor à direita:
 *                À VISTA / PIX (valor grande) · CARTÃO ATÉ Nx · CREDIÁRIO
 *   selo ....... ECONOMIZE X% À VISTA
 */
function etiquetaHTML(e: Etiqueta, t: TamanhoEtiqueta, comBarras: boolean): string {
  const k = escalaDe(t)
  const mm = (v: number) => `${(v * k).toFixed(2)}mm`
  const cod = limpo(e.codigo)
  // Nem cor nem tamanho: a cor está na mão de quem segura a peça, e o tamanho
  // a loja quase sempre tem como "Único". Sem eles o nome cabe inteiro e maior.
  const nome = linhaDoNome(e)
  const cartao = Number(e.cartao) || 0
  const crediario = Number(e.crediario) || 0
  const parcelas = e.parcelasCartao && e.parcelasCartao > 1 ? ` até ${e.parcelasCartao}x` : ''
  const economia = economiaAVista(e.vista, cartao)

  // CÓDIGO: é o que a vendedora digita no balcão, então vem primeiro e grande.
  // Encolhe se for longo (um EAN de 13 dígitos; cabem ~8 na fonte cheia).
  const fsCod = Math.max(1.7, 2.9 * Math.min(1, 8 / Math.max(8, cod.length || 8)))
  // NOME: até 2 linhas; só encolhe quando nem assim cabe.
  const fsNome = Math.max(1.45, 2.0 * Math.min(1, 46 / Math.max(46, nome.length)))
  // À VISTA: o maior que ainda cabe na metade direita ("R$ 1.299,90" = 11 caracteres).
  const txtVista = emReais(e.vista)
  const fsVista = Math.max(2.4, 3.6 * Math.min(1, 9 / Math.max(9, txtVista.length)))

  const linha = (rotulo: string, valor: string, destaque = false) =>
    `<div class="pl${destaque ? ' hero' : ''}">
       <span class="pr-lb">${esc(rotulo)}</span>
       <span class="pr-vl"${destaque ? ` style="font-size:${mm(fsVista)}"` : ''}>${esc(valor)}</span>
     </div>`

  const barras = comBarras && cod ? barraSVG(cod) : ''

  return `<div class="et">
    <div class="top">
      <div class="cod" style="font-size:${mm(fsCod)}">${cod ? esc(cod) : '<span class="semcod">S/ CÓDIGO</span>'}</div>
      <div class="cat">${e.categoria ? esc(e.categoria) : ''}</div>
    </div>
    <div class="nome${barras ? ' uma' : ''}" style="font-size:${mm(fsNome)}">${esc(nome)}</div>
    ${barras ? `<div class="barra">${barras}</div>` : ''}
    <div class="regua"></div>
    <div class="precos">
      ${linha('À VISTA / PIX', txtVista, true)}
      ${cartao ? linha(`CARTÃO${parcelas.toUpperCase()}`, emReais(cartao)) : ''}
      ${crediario ? linha('CREDIÁRIO', emReais(crediario)) : ''}
    </div>
    ${economia > 0 ? seloSVG(`ECONOMIZE ${economia}% À VISTA`, k) : ''}
  </div>`
}

/** A página e a fileira, giradas quando o rolo pede. O mesmo para as etiquetas e para o teste. */
function geometria(t: TamanhoEtiqueta, giro: Giro) {
  const pageW = larguraPagina(t)
  const vira = trocaOrientacao(giro)
  return {
    pageW,
    paginaW: vira ? t.alturaMM : pageW,
    paginaH: vira ? pageW : t.alturaMM,
    // GIRO: quando a impressora insiste em imprimir deitado, em vez de brigar
    // com o driver a página é declarada na outra orientação e o desenho gira
    // por CSS. O papel é o mesmo; muda só como o conteúdo é desenhado nele.
    girar: giro !== 0 ? `position:absolute; left:50%; top:50%; transform: translate(-50%,-50%) rotate(${giro}deg);` : '',
  }
}

/** `<style>` com o bilhete (nonce) da página: em produção a CSP só aceita estilo que o tenha. */
const abreEstilo = (nonce?: string) => (nonce ? `<style nonce="${esc(nonce)}">` : '<style>')

/**
 * A página pronta para imprimir.
 *
 * Cada PÁGINA é uma FILEIRA do rolo (com `colunas` etiquetas lado a lado) e
 * tem exatamente a largura do papel. Sobrou espaço na última fileira? Entram
 * etiquetas em branco, para o avanço do papel não desalinhar.
 */
export function etiquetasHTML(
  etiquetas: readonly Etiqueta[],
  t: TamanhoEtiqueta,
  giro: Giro = 0,
  opcoes: { nonce?: string; codigoDeBarras?: boolean } = {},
): string {
  const k = escalaDe(t)
  const mm = (v: number) => `${(v * k).toFixed(2)}mm`
  const g = geometria(t, giro)

  const fileiras: (Etiqueta | null)[][] = []
  for (let i = 0; i < etiquetas.length; i += t.colunas) {
    const fileira: (Etiqueta | null)[] = etiquetas.slice(i, i + t.colunas)
    while (fileira.length < t.colunas) fileira.push(null)
    fileiras.push(fileira)
  }
  const corpo = fileiras
    .map(
      (f) =>
        `<div class="pg"><div class="row">${f.map((e) => (e ? etiquetaHTML(e, t, !!opcoes.codigoDeBarras) : '<div class="et vazia"></div>')).join('')}</div></div>`,
    )
    .join('\n')

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas</title>
${abreEstilo(opcoes.nonce)}
  /* a página é a FILEIRA do rolo, não uma etiqueta (invertida quando o desenho vai girado) */
  @page { size: ${g.paginaW}mm ${g.paginaH}mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html,body { margin:0; padding:0; background:#fff; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; }
  .pg { position:relative; width:${g.paginaW}mm; height:${g.paginaH}mm; overflow:hidden;
        page-break-after: always; break-after: page; }
  .pg:last-child { page-break-after:auto; break-after:auto; }
  .row {
    width:${g.pageW}mm; height:${t.alturaMM}mm; padding:0 ${t.margemMM}mm;
    display:flex; gap:${t.gapMM}mm; overflow:hidden;
    ${g.girar}
  }
  .vazia { visibility:hidden; }
  .et {
    /* folga de 1,6 mm em cima e embaixo: a térmica desvia ~1 mm na vertical
       e o selo caía no vão entre as etiquetas. Com a folga, aguenta. */
    width:${t.larguraMM}mm; height:${t.alturaMM}mm; padding:${mm(1.6)} ${mm(1.4)};
    display:flex; flex-direction:column; justify-content:space-between; overflow:hidden;
    flex:0 0 ${t.larguraMM}mm;
    /* fonte-base MIÚDA de propósito: sem isto a linha herda os 16px do corpo
       e o selo sozinho comia ~3 mm, espremendo o nome. */
    font-size:${mm(1.2)}; line-height:1;
  }
  .et > * { flex:0 0 auto; }

  /* 1 · CÓDIGO (o que se digita no balcão) + categoria */
  .top { display:flex; align-items:baseline; justify-content:space-between; gap:${mm(1)}; }
  .cod { font-weight:bold; line-height:1; letter-spacing:${mm(0.06)}; white-space:nowrap; flex:0 0 auto; }
  .cod .semcod { font-size:${mm(1.5)}; letter-spacing:0; }
  .cat { font-size:${mm(1.35)}; line-height:1.1; min-width:0; text-align:right;
         overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }

  /* 2 · nome + ref do fornecedor (até 2 linhas; a fonte vem na própria linha) */
  .nome { font-weight:bold; line-height:1.06; letter-spacing:${mm(0.02)};
          display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
          overflow:hidden; overflow-wrap:anywhere;
          /* o corte das 2 linhas (overflow) levava o acento da maiúscula: "TÊNIS"
             saía "TËNIS". A folga em cima é onde o acento cabe. */
          padding-top:0.14em; }
  /* com as barras, o nome fica numa linha só: é dela a altura que as barras ocupam */
  .nome.uma { -webkit-line-clamp:1; }
  .barra svg { display:block; width:100%; height:${mm(2.6)}; }

  .regua { border-top:${mm(0.25)} solid #000; }

  /* 3 · preços — UMA LINHA POR FORMA: rótulo à esquerda, valor à direita */
  .precos { display:flex; flex-direction:column; gap:${mm(0.25)}; }
  .pl { display:flex; align-items:baseline; justify-content:space-between; gap:${mm(0.6)}; }
  /* line-height maior que 1: com o corte (overflow), "CARTÃO ATÉ" e "À VISTA"
     perdiam o til e os acentos. A linha não cresce — quem manda nela é o valor. */
  .pr-lb { font-size:${mm(1.3)}; line-height:1.25; letter-spacing:${mm(0.04)}; white-space:nowrap;
           overflow:hidden; text-overflow:ellipsis; }
  .pr-vl { font-weight:bold; font-size:${mm(2.0)}; letter-spacing:-${mm(0.04)}; white-space:nowrap; flex:0 0 auto; }
  .pl.hero .pr-lb { font-weight:bold; }
  .pl.hero .pr-vl { letter-spacing:-${mm(0.07)}; }

  /* o selo é SVG (ver seloSVG): sobrevive ao "Gráficos de segundo plano" desmarcado */
  .selo { display:block; align-self:flex-start; }
</style></head><body>
${corpo}
</body></html>`
}

/**
 * Página de TESTE, para descobrir por que a impressão sai torta sem gastar o rolo.
 *
 * Página 1: um quadro em cada posição de etiqueta — mostra se as colunas batem no papel.
 * Página 2: uma barra de EXATAMENTE 100 mm (ou o que couber) — é só medir com
 * régua. Se der menos, a impressora está reduzindo a página: escala 100% e o
 * papel certo no driver.
 */
export function testeCalibracaoHTML(t: TamanhoEtiqueta, giro: Giro = 0, opcoes: { nonce?: string } = {}): string {
  const k = escalaDe(t)
  const mm = (v: number) => `${(v * k).toFixed(2)}mm`
  const g = geometria(t, giro)
  const quadros = Array.from(
    { length: t.colunas },
    (_, i) => `<div class="qd"><b>${i + 1}</b><span>${t.larguraMM}×${t.alturaMM}</span></div>`,
  ).join('')
  // barra de 100 mm (ou o que couber na página), com marca a cada 10 mm
  const barraMM = Math.min(100, Math.floor(g.pageW - 2 * t.margemMM))
  const ticks = Array.from({ length: Math.max(0, Math.floor(barraMM / 10) - 1) }, (_, i) => `<i style="left:${(i + 1) * 10}mm"></i>`).join('')

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Teste</title>
${abreEstilo(opcoes.nonce)}
  @page { size: ${g.paginaW}mm ${g.paginaH}mm; margin: 0; }
  * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html,body { margin:0; padding:0; background:#fff; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; }
  .pg { position:relative; width:${g.paginaW}mm; height:${g.paginaH}mm; overflow:hidden;
        page-break-after:always; break-after:page; }
  .pg:last-child { page-break-after:auto; break-after:auto; }
  .row { width:${g.pageW}mm; height:${t.alturaMM}mm; padding:0 ${t.margemMM}mm;
         display:flex; gap:${t.gapMM}mm; overflow:hidden; ${g.girar} }
  .qd { flex:0 0 ${t.larguraMM}mm; height:${t.alturaMM}mm; border:${mm(0.4)} solid #000;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:${mm(0.5)}; }
  .qd b { font-size:${mm(5)}; line-height:1; }
  .qd span { font-size:${mm(1.6)}; }
  .reg { flex:1; display:flex; flex-direction:column; justify-content:center; gap:${mm(0.8)}; }
  /* a barra é BORDA, não fundo: borda imprime com "Gráficos de segundo plano" desligado */
  .barra { position:relative; width:${barraMM}mm; height:0; border-top:${mm(2.4)} solid #000; }
  .barra i { position:absolute; top:-${mm(2.4)}; width:${mm(0.3)}; height:${mm(2.4)}; border-left:${mm(0.3)} solid #fff; }
  .leg { font-size:${mm(1.7)}; font-weight:bold; line-height:1.2; }
  .leg span { font-weight:normal; }
</style></head><body>
  <div class="pg"><div class="row">${quadros}</div></div>
  <div class="pg"><div class="row"><div class="reg">
    <div class="barra">${ticks}</div>
    <div class="leg">Esta barra tem ${barraMM} mm — meça com régua.
      <span>Se der menos, a impressora está reduzindo: escala 100% e papel ${g.pageW}×${t.alturaMM} mm no driver.</span></div>
  </div></div></div>
</body></html>`
}
