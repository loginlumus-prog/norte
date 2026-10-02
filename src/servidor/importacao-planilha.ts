// Trazer produtos de outro sistema — a parte que LÊ a planilha.
//
// ── por que isto existe ──────────────────────────────────────
// A loja que chega ao Norte já tem 300, 900, 4 mil produtos cadastrados em
// algum lugar: no sistema antigo, numa planilha do Excel, no relatório de
// estoque que o contador pediu. Digitar tudo de novo é o motivo número um de
// a implantação morrer na primeira semana. Então a regra desta tela é: o que
// a pessoa tiver na mão, serve — do jeito que veio.
//
// "Do jeito que veio" quer dizer, no Brasil:
//   • CSV com ponto e vírgula (o Excel em português salva assim), com
//     vírgula, ou com tabulação (o que se copia de uma planilha e se cola);
//   • texto em latin1 (o sistema antigo do Windows) ou em UTF-8 lido como
//     latin1 por alguém no caminho — o "CalÃ§a" que devia ser "Calça";
//   • dinheiro como "1.234,56", "R$ 12,90", ou "12.90" quando a planilha foi
//     feita num programa em inglês; quantidade como "10 kg";
//   • o cabeçalho na linha 4, porque as três de cima são o título do
//     relatório; colunas chamadas "Cód.", "Descrição", "Vlr Venda", "Qtde".
//
// ── e por que é puro ─────────────────────────────────────────
// Sem banco, sem rede, sem React. A leitura roda no NAVEGADOR (o arquivo
// nunca sobe inteiro para o servidor; só os produtos já montados, em lotes),
// e o servidor usa as MESMAS regras para conferir o que chegou — o que vem do
// navegador é do usuário. E o teste roda tudo sem subir nada.

import type { Medida } from '@prisma/client'

// ─────────────────────────────────────────────────────────────
// OS LIMITES
// ─────────────────────────────────────────────────────────────

/** Linhas de produto numa importação. Mais que isso é catálogo de atacadista: fale com o suporte. */
export const MAX_LINHAS = 10_000
/** Colunas lidas. Relatório com 80 colunas existe; as que importam estão nas primeiras. */
export const MAX_COLUNAS = 60
/** Variações (linhas da planilha) por lote mandado ao servidor — ver `lotes`. */
export const TAM_LOTE = 200
/** Opções numa grade só. Acima disso é engano de agrupamento, não produto. */
export const MAX_VARIACOES = 200

export const MAX_NOME = 200
export const MAX_CODIGO = 60
export const MAX_CATEGORIA = 60
export const MAX_MARCA = 60
export const MAX_OPCAO = 40
/** Teto de preço e de estoque: o que passa disso é coluna trocada, não produto. */
export const MAX_VALOR = 9_999_999

/** O motivo que vai no movimento de estoque e no livro de auditoria. */
export const MOTIVO_IMPORTACAO = 'Importado de outro sistema'

// ─────────────────────────────────────────────────────────────
// OS CAMPOS
// ─────────────────────────────────────────────────────────────

export const CAMPOS = [
  'nome',
  'codigo',
  'codigoBarras',
  'categoria',
  'precoVista',
  'precoCartao',
  'custo',
  'estoque',
  'medida',
  'marca',
  'tamanho',
  'cor',
  'ignorar',
] as const

export type Campo = (typeof CAMPOS)[number]

/** O que a tela escreve no "Esta coluna é:". */
export const ROTULO_DO_CAMPO: Record<Campo, string> = {
  nome: 'Nome do produto',
  codigo: 'Código / referência',
  codigoBarras: 'Código de barras (EAN)',
  categoria: 'Categoria',
  precoVista: 'Preço de venda',
  precoCartao: 'Preço no cartão',
  custo: 'Custo',
  estoque: 'Estoque',
  medida: 'Unidade (UN, KG…)',
  marca: 'Marca',
  tamanho: 'Tamanho',
  cor: 'Cor',
  ignorar: 'Ignorar esta coluna',
}

export type Celula = string | number | boolean | Date | null | undefined
export type Grade = Celula[][]

// ─────────────────────────────────────────────────────────────
// O TEXTO: ACENTO E ENCODING
// ─────────────────────────────────────────────────────────────

/** Sem acento, caixa baixa, espaço único. "Calça  Jeans" e "calca jeans" são o mesmo produto. */
export function chaveDoNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// O windows-1252 põe letras nas posições 0x80–0x9F, onde o latin1 tem
// controles. Quem leu UTF-8 como windows-1252 escreveu "â€™" no lugar do
// apóstrofo curvo: para desfazer, cada letra dessas volta ao byte dela.
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

// "Ã§", "Ã£", "Ã©", "Âº": a marca de UTF-8 lido como latin1. Ã ou Â seguido
// de uma letra da faixa alta é a assinatura — em português de verdade, "Ã"
// vem antes de "O" ("ÃO"), nunca antes de "§" ou "©".
const MOJIBAKE = /[ÃÂ][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/

/**
 * Desfaz o "CalÃ§a" que devia ser "Calça".
 *
 * Só mexe quando a assinatura aparece E a volta dá UTF-8 válido: "São Paulo"
 * escrito certo nunca passa por aqui, e texto que só parece estragado fica
 * como veio. Célula por célula — a planilha que juntou duas origens tem umas
 * estragadas e outras não.
 */
export function consertarAcentos(s: string): string {
  if (!MOJIBAKE.test(s)) return s
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const b = c <= 0xff ? c : CP1252[s[i]!]
    if (b === undefined) return s
    bytes[i] = b
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return s
  }
}

/**
 * Os bytes do arquivo viram texto.
 *
 * UTF-8 primeiro, com a trava ligada: se aparecer byte que não é UTF-8, o
 * arquivo é do sistema antigo do Windows (windows-1252, o "latin1" do Excel
 * em português) e é lido assim. O "Texto Unicode" do Excel é UTF-16 e vem
 * com a marca no começo. Depois, o conserto de quem já gravou estragado.
 */
export function decodificar(bytes: Uint8Array): string {
  let texto: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe) texto = new TextDecoder('utf-16le').decode(bytes.subarray(2))
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) texto = new TextDecoder('utf-16be').decode(bytes.subarray(2))
  else {
    const semMarca = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(semMarca)
    } catch {
      texto = new TextDecoder('windows-1252').decode(semMarca)
    }
  }
  return texto
}

// ─────────────────────────────────────────────────────────────
// O TEXTO EM LINHAS E COLUNAS
// ─────────────────────────────────────────────────────────────

export type Separador = ';' | ',' | '\t'

/** Quantos separadores há em cada linha, fora das aspas — para decidir qual é. */
function contarPorLinha(texto: string, sep: string, maxLinhas: number): number[] {
  const contas: number[] = []
  let n = 0
  let aspas = false
  for (let i = 0; i < texto.length && contas.length < maxLinhas; i++) {
    const c = texto[i]
    if (c === '"') aspas = !aspas
    else if (!aspas && c === sep) n++
    else if (!aspas && c === '\n') {
      contas.push(n)
      n = 0
    }
  }
  if (contas.length < maxLinhas && n > 0) contas.push(n)
  return contas
}

/**
 * Ponto e vírgula, vírgula ou tabulação?
 *
 * O que se repete do MESMO jeito em quase toda linha. A vírgula sozinha
 * engana: "12,90" tem vírgula, e a planilha do Excel em português separa por
 * ponto e vírgula justamente por isso. Empate fica com a tabulação (o que se
 * cola), depois o ponto e vírgula, depois a vírgula.
 */
export function detectarSeparador(texto: string): Separador {
  let melhor: { sep: Separador; nota: number } = { sep: ';', nota: -1 }
  for (const sep of ['\t', ';', ','] as const) {
    const contas = contarPorLinha(texto, sep, 30)
    const comAlgo = contas.filter((n) => n > 0)
    if (comAlgo.length === 0) continue
    // A contagem que mais se repete, e em quantas linhas ela aparece.
    const freq = new Map<number, number>()
    for (const n of comAlgo) freq.set(n, (freq.get(n) ?? 0) + 1)
    const [, vezes] = [...freq].sort((a, b) => b[1] - a[1])[0]!
    const nota = vezes / Math.max(1, contas.length)
    if (nota > melhor.nota + 0.05) melhor = { sep, nota }
  }
  return melhor.sep
}

/**
 * O texto (CSV, TSV, ou o que foi colado) em linhas e colunas.
 *
 * Aspas como o Excel escreve: campo entre aspas pode ter separador e quebra
 * de linha dentro, e aspas dobradas são uma aspa.
 */
export function lerTexto(texto: string, sep: Separador = detectarSeparador(texto)): Grade {
  const linhas: Grade = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else aspas = false
      } else campo += c
      continue
    }
    if (c === '"' && campo === '') aspas = true
    else if (c === sep) {
      linha.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ''
    } else campo += c
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo)
    linhas.push(linha)
  }
  return linhas
}

/**
 * A grade arrumada para ler: texto consertado e aparado, linhas vazias fora
 * do fim, colunas cortadas no teto. Linha vazia NO MEIO fica (vazia), para o
 * número de linha que a tela mostra bater com o do Excel.
 */
export function arrumarGrade(g: Grade): Grade {
  const limpa = g.map((l) =>
    l.slice(0, MAX_COLUNAS).map((c) => (typeof c === 'string' ? consertarAcentos(c.replace(/ /g, ' ').trim()) : c)),
  )
  while (limpa.length > 0 && linhaVazia(limpa[limpa.length - 1]!)) limpa.pop()
  return limpa
}

export const vazia = (c: Celula) => c === null || c === undefined || (typeof c === 'string' && c.trim() === '')
export const linhaVazia = (l: Celula[]) => l.every(vazia)

/** Quantas colunas a grade tem de verdade (a última com algo escrito). */
export function largura(g: Grade): number {
  let n = 0
  for (const l of g) for (let i = l.length - 1; i >= n; i--) if (!vazia(l[i])) n = i + 1
  return n
}

/** A célula como texto, para mostrar e para os campos de texto. */
export function textoDe(c: Celula): string {
  if (c === null || c === undefined) return ''
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(c).replace('.', ',')
  if (typeof c === 'boolean') return c ? 'sim' : 'não'
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : c.toISOString().slice(0, 10).split('-').reverse().join('/')
  return String(c).trim()
}

// ─────────────────────────────────────────────────────────────
// OS NÚMEROS
// ─────────────────────────────────────────────────────────────

/** Vírgula decimal ("1.234,56") ou ponto decimal ("1,234.56")? */
export type Estilo = 'br' | 'us'

/**
 * O jeito de escrever número de uma COLUNA inteira.
 *
 * "1.234" sozinho não se decide: mil duzentos e trinta e quatro aqui, um e
 * vinte e três numa planilha em inglês. Mas a coluna decide: se outra linha
 * dela tem "12,90", a vírgula é decimal e o ponto é milhar; se tem "12.90",
 * o contrário. Sem pista nenhuma, vale o jeito brasileiro — é daqui que
 * vem quase toda planilha.
 */
export function estiloDaColuna(valores: Celula[]): Estilo {
  let br = 0
  let us = 0
  for (const v of valores) {
    if (typeof v !== 'string') continue
    const t = v.replace(/[^\d.,]/g, '')
    if (/\d,\d{1,2}$/.test(t) || /\d\.\d{3},\d/.test(t)) br++
    else if (/\d\.\d{1,2}$/.test(t) || /\d,\d{3}\.\d/.test(t)) us++
  }
  return us > br ? 'us' : 'br'
}

const MEDIDAS: [Medida, RegExp][] = [
  ['KG', /^(kg|kgs|quilo|quilos|kilo|kilos|quilograma)$/],
  ['G', /^(g|gr|grs|grama|gramas)$/],
  ['ML', /^(ml|mililitro|mililitros)$/],
  ['L', /^(l|lt|lts|litro|litros)$/],
  ['M', /^(m|mt|mts|metro|metros)$/],
  ['PAR', /^(par|pares|pr)$/],
  ['CX', /^(cx|caixa|caixas)$/],
  ['UN', /^(un|und|unid|unidade|unidades|pc|pc|pç|pca|peca|pecas|peça|peças|u|ud|ea)$/],
]

/** "kg", "Litro", "UND" → a medida do Norte. Desconhecida → null. */
export function lerMedida(c: Celula): Medida | null {
  const t = chaveDoNome(textoDe(c)).replace(/[.\s]/g, '')
  if (!t) return null
  for (const [m, re] of MEDIDAS) if (re.test(t)) return m
  return null
}

/**
 * Um número de planilha, perdoando o que dá para perdoar.
 *
 * `null` = célula vazia (não informado). `NaN` = tem algo escrito e não é
 * número — a tela mostra o que estava escrito, em vez de inventar um valor.
 * Aceita "R$ 12,90", "12,90 R$", "1.234,56", "10 kg", "-3" e "(3)".
 */
export function lerValor(c: Celula, estilo: Estilo = 'br'): number | null {
  if (c === null || c === undefined) return null
  if (typeof c === 'number') return Number.isFinite(c) ? c : NaN
  if (typeof c !== 'string') return NaN
  let t = c.replace(/ /g, ' ').trim()
  if (!t || /^[-–—]$/.test(t)) return null
  let negativo = false
  if (/^\(.*\)$/.test(t)) {
    negativo = true
    t = t.slice(1, -1)
  }
  t = t.replace(/r\$|\$|us\$/gi, '').trim()
  // A medida depois do número: "10 kg", "2,5L", "3 un".
  t = t.replace(/\s*[a-zA-Zç.]+$/i, (fim) => (lerMedida(fim.replace(/^\./, '')) || /^\s*\.$/.test(fim) ? '' : fim)).trim()
  if (t.startsWith('-')) {
    negativo = true
    t = t.slice(1).trim()
  } else if (t.endsWith('-')) {
    negativo = true
    t = t.slice(0, -1).trim()
  }
  t = t.replace(/\s/g, '')
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return NaN

  let normal: string
  const ultimaVirgula = t.lastIndexOf(',')
  const ultimoPonto = t.lastIndexOf('.')
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    // Os dois: o que vem por último é o decimal.
    normal = ultimaVirgula > ultimoPonto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (ultimaVirgula >= 0) {
    if (/^\d{1,3}(,\d{3})+$/.test(t) && (estilo === 'us' || t.split(',').length > 2)) normal = t.replace(/,/g, '')
    else if (t.split(',').length === 2) normal = t.replace(',', '.')
    else return NaN
  } else if (ultimoPonto >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t) && (estilo === 'br' || t.split('.').length > 2)) normal = t.replace(/\./g, '')
    else if (t.split('.').length === 2) normal = t
    else return NaN
  } else normal = t
  if (!/^\d+(\.\d+)?$/.test(normal)) return NaN
  const n = Number(normal)
  return negativo ? -n : n
}

/**
 * O código de barras, só com algarismos, ou o motivo de não servir.
 *
 * "7,89123E+12" é o EAN que o Excel estragou ao abrir o CSV: os últimos
 * algarismos já se perderam, e gravar isso seria cadastrar um código que
 * não bate com nenhuma embalagem.
 */
export function lerEan(c: Celula): { ean: string | null; aviso?: string } {
  if (vazia(c)) return { ean: null }
  if (typeof c === 'number') {
    if (!Number.isInteger(c) || c <= 0) return { ean: null, aviso: `código de barras ilegível (${textoDe(c)})` }
    c = String(c)
  }
  const t = textoDe(c)
  if (/e\+?\d+$/i.test(t)) return { ean: null, aviso: `código de barras cortado pelo Excel (${t}) — formate a coluna como texto e exporte de novo` }
  const so = t.replace(/[\s.-]/g, '')
  if (!/^\d{8,14}$/.test(so)) return { ean: null, aviso: `código de barras não parece EAN (${t.slice(0, 20)})` }
  return { ean: so }
}

/** O código da etiqueta: maiúsculo, sem espaço sobrando, com teto. Número do Excel vira texto sem ",0". */
export function lerCodigo(c: Celula): { codigo: string | null; aviso?: string } {
  if (vazia(c)) return { codigo: null }
  if (typeof c === 'number' && !Number.isInteger(c)) return { codigo: null, aviso: `código ilegível (${textoDe(c)})` }
  const t = textoDe(c).replace(/\s+/g, ' ').toUpperCase()
  if (/^\d+(,\d+)?E\+\d+$/i.test(t)) return { codigo: null, aviso: `código cortado pelo Excel (${t})` }
  if (t.length > MAX_CODIGO) return { codigo: null, aviso: `código longo demais (${t.slice(0, 20)}…)` }
  return { codigo: t }
}

// ─────────────────────────────────────────────────────────────
// O CABEÇALHO: QUE COLUNA É O QUÊ
// ─────────────────────────────────────────────────────────────

/** "Cód. Barras" → "cod barras". É o que as regras de baixo comparam. */
export const chaveDoCabecalho = (s: string) => chaveDoNome(s).replace(/[^a-z0-9]+/g, ' ').trim()

// A ordem importa: a primeira regra que casa decide. Por isso o que NÃO é
// produto vem primeiro ("Valor total" não é preço, "Estoque mínimo" não é
// estoque, "Qtd vendida" não é saldo), depois o mais específico ("Preço de
// custo" é custo antes de ser preço; "Código de barras" antes de "Código").
const REGRAS: [Campo, RegExp][] = [
  ['ignorar', /\b(total|subtotal|promo|promocao|promocional|margem|markup|lucro|ncm|cest|cfop|cst|icms|ipi|pis|cofins|data|minimo|maximo|peso|comissao|desconto|fornecedor|situacao|status|ativo|inativo|obs|observacao|observacoes|localizacao|prateleira|vendid\w*|saidas?|entradas?|validade|lote|imagem|foto|url|link)\b/],
  ['codigoBarras', /\b(ean|ean13|gtin|barras?|codbarras?|cod barras?|codigo de barras?|codigo barras?)\b/],
  ['precoCartao', /\b(cartao|credito|a prazo|prazo|parcelado)\b/],
  ['custo', /\b(custo|compra|preco de compra|valor de compra|pcusto)\b/],
  ['precoVista', /\b(preco|precos|valor|venda|pv|vlr|a vista|varejo|pvenda|unitario)\b/],
  ['estoque', /\b(estoque|saldo|quantidade|qtd|qtde|qtdade|quant|qt|disponivel)\b/],
  ['medida', /^(un|und|unid|unidade|unidades|medida|unidade de medida|um|u m|tipo de unidade|embalagem|unid medida|unidade medida)$/],
  ['categoria', /\b(categoria|categorias|grupo|departamento|depto|secao|familia|subgrupo|linha|tipo|colecao|genero|classe)\b/],
  ['marca', /\b(marca|fabricante|grife)\b/],
  ['tamanho', /\b(tamanho|tamanhos|tam|numeracao|num|tm)\b/],
  ['cor', /\b(cor|cores)\b/],
  ['codigo', /\b(cod|codigo|sku|ref|referencia|id|plu|codigo interno|cod interno)\b/],
  ['nome', /\b(nome|descricao|produto|produtos|item|mercadoria|artigo|desc|titulo)\b/],
]

/** O campo que o título da coluna sugere, ou `null` quando o título não diz nada. */
export function campoDoCabecalho(titulo: Celula): Campo | null {
  const t = chaveDoCabecalho(textoDe(titulo))
  if (!t) return null
  for (const [campo, re] of REGRAS) if (re.test(t)) return campo
  return null
}

/**
 * Em que linha estão os títulos? `null` = a planilha não tem.
 *
 * A que mais tem títulos conhecidos entre as primeiras vinte (relatório tem
 * título, data e linha em branco antes). Precisa de dois conhecidos — um só
 * pode ser coincidência de dado ("Produto" escrito numa célula qualquer).
 */
export function acharCabecalho(g: Grade): number | null {
  let melhor: { linha: number; nota: number } | null = null
  for (let i = 0; i < Math.min(g.length, 20); i++) {
    const l = g[i]!
    let nota = 0
    for (const c of l) {
      if (typeof c !== 'string') continue
      const campo = campoDoCabecalho(c)
      if (campo && campo !== 'ignorar') nota++
    }
    if (nota >= 2 && (!melhor || nota > melhor.nota)) melhor = { linha: i, nota }
  }
  return melhor?.linha ?? null
}

/**
 * O primeiro palpite para cada coluna, pelo título — e, sem título, pelo
 * jeito do conteúdo. Cada campo fica com UMA coluna: a primeira que casou.
 */
export function adivinharCampos(g: Grade, cabecalho: number | null): Campo[] {
  const n = largura(g)
  const campos: Campo[] = Array.from({ length: n }, () => 'ignorar')
  const usados = new Set<Campo>()
  // A coluna cujo título diz alguma coisa — inclusive "não é produto"
  // ("Valor total") — não entra no palpite pelo conteúdo.
  const decididas = new Set<number>()
  if (cabecalho !== null) {
    const titulos = g[cabecalho] ?? []
    for (let i = 0; i < n; i++) {
      const c = campoDoCabecalho(titulos[i])
      if (c) decididas.add(i)
      if (c && c !== 'ignorar' && !usados.has(c)) {
        campos[i] = c
        usados.add(c)
      }
    }
  }
  // O que os títulos não disseram, o conteúdo tenta: a coluna "Pr1" com
  // "12,90" em toda linha é o preço que faltava.
  return pelasAmostras(g, cabecalho === null ? 0 : cabecalho + 1, campos, usados, decididas)
}

/**
 * Sem títulos: o conteúdo diz. Texto comprido com letras é o nome; 8 a 14
 * algarismos é código de barras; dinheiro é preço (o primeiro) e custo (o
 * segundo, quando é menor); número inteiro pequeno é estoque; sigla curta é
 * código. É palpite — a tela mostra e a pessoa corrige.
 */
function pelasAmostras(g: Grade, inicio: number, campos: Campo[], usados: Set<Campo>, decididas: Set<number>): Campo[] {
  const amostra = g.slice(inicio, inicio + 50).filter((l) => !linhaVazia(l))
  if (amostra.length === 0) return campos
  type Perfil = { i: number; letras: number; tam: number; ean: number; dinheiro: number; inteiro: number; codigo: number; total: number; media: number }
  const perfis: Perfil[] = campos.map((_, i) => {
    const p: Perfil = { i, letras: 0, tam: 0, ean: 0, dinheiro: 0, inteiro: 0, codigo: 0, total: 0, media: 0 }
    let soma = 0
    for (const l of amostra) {
      const c = l[i]
      if (vazia(c)) continue
      p.total++
      const t = textoDe(c)
      if (/[a-zà-ú]{3,}/i.test(t) && /\s/.test(t)) p.letras++
      p.tam += t.length
      if (/^\d{8,14}$/.test(t)) p.ean++
      else if (/^[A-Z0-9][A-Z0-9./-]{0,15}$/i.test(t) && /\d/.test(t)) p.codigo++
      const v = lerValor(c)
      if (v !== null && !Number.isNaN(v)) {
        soma += v
        if (/[,.]\d{2}$/.test(t) || /r\$/i.test(t) || (typeof c === 'number' && !Number.isInteger(c))) p.dinheiro++
        else if (Number.isInteger(v) && Math.abs(v) < 100_000) p.inteiro++
      }
    }
    p.media = p.total ? soma / p.total : 0
    p.tam = p.total ? p.tam / p.total : 0
    return p
  })
  const maioria = (n: number, p: Perfil) => p.total > 0 && n / p.total >= 0.6
  const livre = (p: Perfil) => campos[p.i] === 'ignorar' && !decididas.has(p.i)
  const pegar = (campo: Campo, p: Perfil | undefined) => {
    if (!p || usados.has(campo) || !livre(p)) return
    campos[p.i] = campo
    usados.add(campo)
  }
  pegar('nome', [...perfis].filter((p) => livre(p) && maioria(p.letras, p)).sort((a, b) => b.tam - a.tam)[0])
  pegar('codigoBarras', perfis.find((p) => livre(p) && maioria(p.ean, p)))
  if (usados.has('precoVista') && usados.has('custo')) {
    pegar('estoque', perfis.find((p) => livre(p) && maioria(p.inteiro, p)))
    pegar('codigo', perfis.find((p) => livre(p) && maioria(p.codigo, p)))
    return campos
  }
  const dinheiros = perfis.filter((p) => livre(p) && maioria(p.dinheiro, p))
  if (dinheiros.length >= 2 && dinheiros[1]!.media < dinheiros[0]!.media) {
    pegar('precoVista', dinheiros[0])
    pegar('custo', dinheiros[1])
  } else if (dinheiros.length >= 2) {
    pegar('custo', dinheiros[0])
    pegar('precoVista', dinheiros[1])
  } else pegar('precoVista', dinheiros[0])
  pegar('estoque', perfis.find((p) => livre(p) && maioria(p.inteiro, p)))
  pegar('codigo', perfis.find((p) => livre(p) && maioria(p.codigo, p)))
  return campos
}

/**
 * Vale pedir ajuda à IA? Quando não há títulos, quando falta o nome ou o
 * preço, ou quando boa parte dos títulos não disse nada às regras (o sistema
 * antigo chamava a coluna de "Pr1" e "Est.Loja").
 */
export function precisaDeAjuda(g: Grade, cabecalho: number | null, campos: Campo[]): boolean {
  if (cabecalho === null) return true
  if (!campos.includes('nome') || !campos.includes('precoVista')) return true
  const titulos = g[cabecalho] ?? []
  const comTitulo = titulos.filter((t) => !vazia(t)).length
  const mudos = titulos.filter((t) => !vazia(t) && campoDoCabecalho(t) === null).length
  return mudos >= Math.max(2, Math.ceil(comTitulo / 3))
}

// ─────────────────────────────────────────────────────────────
// A IA: SÓ OS TÍTULOS E UMA AMOSTRA
// ─────────────────────────────────────────────────────────────

/**
 * Linhas que sobem para a IA: no máximo nove (títulos + oito), 40 colunas,
 * 40 letras por célula — e nada além disso da planilha. `indices` diz de que
 * linha da grade veio cada uma, para a resposta ("os títulos são a 2")
 * voltar ao lugar certo.
 */
export function amostraParaIA(g: Grade, cabecalho: number | null): { linhas: string[][]; indices: number[] } {
  const indices: number[] = []
  for (let i = cabecalho ?? 0; i < g.length && indices.length < 9; i++) if (!linhaVazia(g[i]!)) indices.push(i)
  const n = Math.min(largura(indices.map((i) => g[i]!)), 40)
  return { linhas: indices.map((i) => Array.from({ length: n }, (_, c) => textoDe(g[i]![c]).slice(0, 40))), indices }
}

/** Limpa o que chegou do navegador para subir à IA: só texto, nos mesmos tetos. */
export function amostraSegura(x: unknown): string[][] | null {
  if (!Array.isArray(x)) return null
  const linhas = x.slice(0, 9).map((l) => (Array.isArray(l) ? l.slice(0, 40).map((c) => String(c ?? '').slice(0, 40)) : []))
  return linhas.some((l) => l.some((c) => c.trim())) ? linhas : null
}

export const SISTEMA_DA_IA = [
  'Você recebe as primeiras linhas de uma planilha de PRODUTOS exportada do sistema antigo de uma loja brasileira (ou feita à mão).',
  'Diga o que é cada coluna. Responda SÓ com um JSON, sem nenhum texto antes ou depois, neste formato:',
  '{"cabecalho": <índice da linha que tem os títulos das colunas, contando do 0, ou -1 se nenhuma linha é de títulos>, "colunas": [<um campo para cada coluna, na ordem>]}',
  'Campos possíveis (use exatamente estas palavras):',
  '- nome: o nome ou a descrição do produto',
  '- codigo: código interno, SKU, referência, código da etiqueta',
  '- codigoBarras: código de barras EAN/GTIN (8 a 14 algarismos)',
  '- categoria: grupo, departamento, seção, família',
  '- precoVista: o preço de venda (à vista)',
  '- precoCartao: preço de venda a prazo ou no cartão, quando há um segundo preço',
  '- custo: preço de custo ou de compra',
  '- estoque: a quantidade em estoque (saldo)',
  '- medida: a unidade de medida (UN, KG, L, CX…)',
  '- marca: marca ou fabricante',
  '- tamanho: tamanho ou numeração (P, M, G, 38, 40…)',
  '- cor: a cor',
  '- ignorar: qualquer outra coisa (totais, datas, impostos, preço promocional, estoque mínimo, quantidade vendida)',
  'Cada campo, menos "ignorar", aparece no máximo uma vez. Na dúvida entre dois preços, o maior é o de venda e o menor é o custo.',
].join('\n')

export function pedidoParaIA(linhas: string[][]): string {
  return `As linhas (cada uma é uma lista de células):\n${linhas.map((l, i) => `${i}: ${JSON.stringify(l)}`).join('\n')}`
}

/**
 * O que a IA respondeu, conferido. Qualquer coisa fora do formato vira
 * `null` — e a tela fica com o palpite das regras. Nunca confie que o JSON
 * veio limpo: a IA às vezes escreve uma frase antes, ou fecha em ```json.
 */
export function lerRespostaDaIA(texto: string, colunas: number): { cabecalho: number | null; campos: Campo[] } | null {
  const ini = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (ini < 0 || fim <= ini) return null
  let bruto: unknown
  try {
    bruto = JSON.parse(texto.slice(ini, fim + 1))
  } catch {
    return null
  }
  if (!bruto || typeof bruto !== 'object') return null
  const { cabecalho, colunas: lista } = bruto as { cabecalho?: unknown; colunas?: unknown }
  if (!Array.isArray(lista) || lista.length === 0) return null
  const usados = new Set<Campo>()
  const campos: Campo[] = Array.from({ length: colunas }, (_, i) => {
    const v = lista[i]
    const c = typeof v === 'string' && (CAMPOS as readonly string[]).includes(v) ? (v as Campo) : 'ignorar'
    if (c === 'ignorar' || usados.has(c)) return 'ignorar'
    usados.add(c)
    return c
  })
  if (!campos.some((c) => c !== 'ignorar')) return null
  const cab = typeof cabecalho === 'number' && Number.isInteger(cabecalho) && cabecalho >= 0 && cabecalho < 9 ? cabecalho : null
  return { cabecalho: cab, campos }
}

// ─────────────────────────────────────────────────────────────
// AS LINHAS VIRAM PRODUTOS
// ─────────────────────────────────────────────────────────────

export type VariacaoImportada = {
  linha: number
  tamanho: string | null
  cor: string | null
  codigo: string | null
  codigoBarras: string | null
  estoque: number | null
}

/** Um produto pronto para subir: o que o servidor recebe, em lotes. */
export type ItemImportado = {
  /** A linha da planilha, contada como o Excel conta (a primeira é 1). */
  linha: number
  nome: string
  /** Simples: o código da etiqueta. Com grade: a etiqueta do produto, se as linhas dividem uma. */
  codigo: string | null
  codigoBarras: string | null
  categoria: string | null
  marca: string | null
  medida: Medida
  precoVista: number
  precoCartao: number | null
  custo: number | null
  estoque: number | null
  /** Vazio = produto simples. Cheio = a grade (cada linha de tamanho/cor da planilha). */
  variacoes: VariacaoImportada[]
}

export type Problema = { linha: number; motivo: string; trecho: string }
export type Aviso = { linha: number; aviso: string }

export type Montagem = {
  itens: ItemImportado[]
  /** Linhas que NÃO entram, com o motivo. */
  problemas: Problema[]
  /** Linhas que entram com um ajuste que a pessoa deve saber. */
  avisos: Aviso[]
  /** Linhas com algo escrito, contadas a partir dos títulos. */
  linhasLidas: number
  /** As categorias citadas, uma vez cada (pelo nome sem acento). */
  categorias: string[]
}

const limitar = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)
const dinheiro = (n: number) => Math.round(n * 100) / 100
const quantia = (n: number) => Math.round(n * 1000) / 1000

/** O começo da linha, para a tela mostrar qual é ("Camiseta · 12,90 · 30"). */
function trechoDa(l: Celula[]): string {
  return l
    .filter((c) => !vazia(c))
    .slice(0, 4)
    .map((c) => textoDe(c).slice(0, 30))
    .join(' · ')
}

/**
 * Tira do fim do nome o tamanho e a cor que já estão nas colunas deles:
 * "Camiseta Básica Azul M" vira "Camiseta Básica", para as linhas da mesma
 * peça virarem UM produto com grade.
 */
function nomeSemOpcoes(nome: string, tamanho: string | null, cor: string | null): string {
  let n = nome
  for (let i = 0; i < 2; i++) {
    for (const o of [tamanho, cor]) {
      if (!o) continue
      const re = new RegExp(`[\\s\\-/–]+${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      n = n.replace(re, '')
    }
  }
  return n.trim() || nome
}

/** O pedaço do código da variação: "M", "AZUL-M" (o separador é o de etiqueta.ts). */
const parteDoCodigo = (s: string) => chaveDoNome(s).toUpperCase().replace(/[^A-Z0-9]+/g, '')

/**
 * Monta os produtos a partir da grade e do que cada coluna é.
 *
 * Cada linha vira um produto — ou uma opção de um produto com grade, quando
 * há coluna de tamanho ou cor: as linhas com o mesmo nome (ou a mesma
 * etiqueta) viram UM produto, com uma variação por linha. É assim que o
 * sistema antigo exporta a camiseta: uma linha para cada tamanho.
 *
 * O que não dá para aproveitar vai para `problemas` com o motivo, e a linha
 * fica de fora; o que dá, com um ajuste, entra e vai para `avisos`.
 */
export function montarItens(g: Grade, cabecalho: number | null, campos: Campo[]): Montagem {
  const col = (c: Campo) => campos.indexOf(c)
  const ci = {
    nome: col('nome'), codigo: col('codigo'), codigoBarras: col('codigoBarras'), categoria: col('categoria'),
    precoVista: col('precoVista'), precoCartao: col('precoCartao'), custo: col('custo'), estoque: col('estoque'),
    medida: col('medida'), marca: col('marca'), tamanho: col('tamanho'), cor: col('cor'),
  }
  const inicio = cabecalho === null ? 0 : cabecalho + 1
  const dados = g.slice(inicio)
  const coluna = (i: number) => (i < 0 ? [] : dados.map((l) => l[i]))
  const estilo = {
    precoVista: estiloDaColuna(coluna(ci.precoVista)),
    precoCartao: estiloDaColuna(coluna(ci.precoCartao)),
    custo: estiloDaColuna(coluna(ci.custo)),
    estoque: estiloDaColuna(coluna(ci.estoque)),
  }

  const problemas: Problema[] = []
  const avisos: Aviso[] = []
  const itens: ItemImportado[] = []
  const categorias = new Map<string, string>()
  let linhasLidas = 0

  // Repetidos DENTRO da planilha: a mesma etiqueta, ou o mesmo nome sem etiqueta.
  const simplesPorCodigo = new Map<string, number>()
  const simplesPorNome = new Map<string, number>()
  // A grade: as linhas da mesma peça se acham pelo código ou pelo nome.
  const gradePorCodigo = new Map<string, ItemImportado>()
  const gradePorNome = new Map<string, ItemImportado>()
  const eans = new Map<string, number>()
  const temGrade = ci.tamanho >= 0 || ci.cor >= 0

  dados.forEach((l, i) => {
    const linha = inicio + i + 1
    if (linhaVazia(l)) return
    linhasLidas++
    const trecho = trechoDa(l)
    const pular = (motivo: string) => problemas.push({ linha, motivo, trecho })
    const avisar = (aviso: string) => avisos.push({ linha, aviso })
    const cel = (k: keyof typeof ci) => (ci[k] >= 0 ? l[ci[k]] : null)

    // ── nome ──
    let nome = limitar(textoDe(cel('nome')), 10_000)
    // O relatório termina em "Total geral: 1.234 itens", na coluna que for —
    // não é produto.
    const primeira = textoDe(l.find((c) => !vazia(c)))
    if (/^(total|subtotal|soma)\b/.test(chaveDoNome(nome || primeira))) return void pular('parece a linha de total do relatório')
    if (!nome) return void pular('sem nome')
    if (nome.length > MAX_NOME) {
      avisar(`nome com mais de ${MAX_NOME} letras: foi cortado`)
      nome = nome.slice(0, MAX_NOME).trim()
    }

    // ── preço de venda: o único número obrigatório ──
    const brutoPreco = cel('precoVista')
    const preco = lerValor(brutoPreco, estilo.precoVista)
    if (preco === null) return void pular('sem preço de venda')
    if (Number.isNaN(preco)) return void pular(`preço ilegível ("${textoDe(brutoPreco).slice(0, 20)}")`)
    if (preco <= 0) return void pular('preço zerado ou negativo')
    if (preco > MAX_VALOR) return void pular(`preço alto demais (${textoDe(brutoPreco)}) — a coluna está certa?`)

    const opcional = (k: 'precoCartao' | 'custo', rotulo: string): number | null => {
      const bruto = cel(k)
      const v = lerValor(bruto, estilo[k])
      if (v === null) return null
      if (Number.isNaN(v) || v < 0 || v > MAX_VALOR) {
        avisar(`${rotulo} ilegível ("${textoDe(bruto).slice(0, 20)}"): entra sem`)
        return null
      }
      return dinheiro(v)
    }
    const precoCartao = opcional('precoCartao', 'preço no cartão')
    const custo = opcional('custo', 'custo')

    // ── estoque ──
    let estoque: number | null = null
    {
      const bruto = cel('estoque')
      const v = lerValor(bruto, estilo.estoque)
      if (v !== null) {
        if (Number.isNaN(v) || Math.abs(v) > MAX_VALOR) avisar(`estoque ilegível ("${textoDe(bruto).slice(0, 20)}"): entra sem estoque`)
        else if (v < 0) {
          // O sistema antigo deixava vender sem saldo e o número ficou
          // negativo. Negativo não é o que está na prateleira — entra zero,
          // e a contagem da loja acerta depois.
          avisar(`estoque negativo no sistema antigo (${textoDe(bruto)}): entra como 0`)
          estoque = 0
        } else estoque = quantia(v)
      }
    }

    // ── medida: a coluna, ou a sigla escrita junto do número ("10 kg") ──
    let medida: Medida = 'UN'
    if (ci.medida >= 0 && !vazia(cel('medida'))) {
      const m = lerMedida(cel('medida'))
      if (m) medida = m
      else avisar(`unidade "${textoDe(cel('medida')).slice(0, 10)}" desconhecida: entra como unidade (UN)`)
    } else {
      const doEstoque = textoDe(cel('estoque')).match(/[a-zç]+\.?$/i)?.[0]
      const m = doEstoque ? lerMedida(doEstoque.replace(/\.$/, '')) : null
      if (m) medida = m
    }
    if (medida === 'UN' && estoque !== null && !Number.isInteger(estoque)) {
      avisar(`estoque com fração (${textoDe(cel('estoque'))}) num produto por unidade`)
    }

    // ── os textos ──
    const { codigo, aviso: avisoCodigo } = lerCodigo(cel('codigo'))
    if (avisoCodigo) avisar(`${avisoCodigo}: o Norte cria um`)
    const { ean, aviso: avisoEan } = ci.codigoBarras >= 0 ? lerEan(cel('codigoBarras')) : { ean: null }
    if (avisoEan) avisar(`${avisoEan}: entra sem`)
    const categoria = limitar(textoDe(cel('categoria')), MAX_CATEGORIA) || null
    if (categoria) {
      const k = chaveDoNome(categoria)
      if (!categorias.has(k)) categorias.set(k, categoria)
    }
    const marca = limitar(textoDe(cel('marca')), MAX_MARCA) || null
    const tamanho = limitar(textoDe(cel('tamanho')), MAX_OPCAO) || null
    const cor = limitar(textoDe(cel('cor')), MAX_OPCAO) || null

    // O mesmo código de barras em duas linhas: a segunda entra sem ele — um
    // EAN é de uma embalagem só, e o leitor não saberia qual das duas é.
    let codigoBarras = ean
    if (ean && eans.has(ean)) {
      avisar(`código de barras ${ean} repetido (já está na linha ${eans.get(ean)}): entra sem`)
      codigoBarras = null
    } else if (ean) eans.set(ean, linha)

    // ── produto simples ──
    if (!temGrade || (!tamanho && !cor)) {
      const k = chaveDoNome(nome)
      if (codigo && simplesPorCodigo.has(codigo)) return void pular(`código ${codigo} repetido (já está na linha ${simplesPorCodigo.get(codigo)})`)
      if (codigo && gradePorCodigo.has(codigo)) return void pular(`código ${codigo} já é do produto com grade da linha ${gradePorCodigo.get(codigo)!.linha}`)
      if (!codigo && simplesPorNome.has(k)) return void pular(`nome repetido (já está na linha ${simplesPorNome.get(k)}) e sem código para diferenciar`)
      const daGrade = gradePorNome.get(k)
      if (daGrade) return void pular(`mesmo nome do produto com grade da linha ${daGrade.linha}, mas sem tamanho nem cor`)
      if (codigo) simplesPorCodigo.set(codigo, linha)
      else simplesPorNome.set(k, linha)
      itens.push({ linha, nome, codigo, codigoBarras, categoria, marca, medida, precoVista: dinheiro(preco), precoCartao, custo, estoque, variacoes: [] })
      return
    }

    // ── uma opção de um produto com grade ──
    const base = nomeSemOpcoes(nome, tamanho, cor)
    const k = chaveDoNome(base)
    if (simplesPorNome.has(k)) return void pular(`tem tamanho/cor, mas o mesmo nome já entrou sem grade na linha ${simplesPorNome.get(k)}`)
    if (codigo && simplesPorCodigo.has(codigo)) return void pular(`código ${codigo} já é do produto sem grade da linha ${simplesPorCodigo.get(codigo)}`)
    let item = (codigo ? gradePorCodigo.get(codigo) : undefined) ?? gradePorNome.get(k)
    if (!item) {
      item = { linha, nome: base, codigo, codigoBarras: null, categoria, marca, medida, precoVista: dinheiro(preco), precoCartao, custo, estoque: null, variacoes: [] }
      itens.push(item)
      gradePorNome.set(k, item)
    } else if (Math.round(item.precoVista * 100) !== Math.round(preco * 100)) {
      avisar(`preço diferente do da linha ${item.linha} (mesmo produto): fica o da linha ${item.linha}`)
    }
    if (codigo) gradePorCodigo.set(codigo, item)
    const combinacao = `${chaveDoNome(tamanho ?? '')}|${chaveDoNome(cor ?? '')}`
    const repetida = item.variacoes.find((v) => `${chaveDoNome(v.tamanho ?? '')}|${chaveDoNome(v.cor ?? '')}` === combinacao)
    if (repetida) return void pular(`${[tamanho, cor].filter(Boolean).join(' ')} repetido no mesmo produto (já está na linha ${repetida.linha})`)
    if (item.variacoes.length >= MAX_VARIACOES) return void pular(`mais de ${MAX_VARIACOES} opções no mesmo produto`)
    item.variacoes.push({ linha, tamanho, cor, codigo, codigoBarras, estoque })
  })

  // A etiqueta de cada opção da grade. Quando todas as linhas da peça têm o
  // MESMO código (a etiqueta do produto, como muita loja usa), a opção ganha
  // o código seguido do que a distingue: 005990-38, 004410-M-PRETO — a regra
  // de etiqueta.ts, que faz o leitor achar a grade pelo código do produto.
  // Códigos diferentes por linha ficam como vieram.
  for (const item of itens) {
    if (item.variacoes.length === 0) continue
    const codigos = new Set(item.variacoes.map((v) => v.codigo).filter(Boolean))
    if (codigos.size === 1 && item.variacoes.length > 1) {
      const base = [...codigos][0]!
      item.codigo = base
      for (const v of item.variacoes) {
        const resto = [v.tamanho, v.cor].filter(Boolean).map((s) => parteDoCodigo(s!)).filter(Boolean).join('-')
        v.codigo = resto ? `${base}-${resto}`.slice(0, MAX_CODIGO) : base
      }
    } else if (codigos.size === 1) {
      item.codigo = [...codigos][0]!
    } else {
      item.codigo = null
      // Duas linhas da mesma grade com o mesmo código não podem: código é um por opção.
      const vistos = new Set<string>()
      for (const v of item.variacoes) {
        if (!v.codigo) continue
        if (vistos.has(v.codigo)) v.codigo = null
        else vistos.add(v.codigo)
      }
    }
  }

  return { itens, problemas, avisos, linhasLidas, categorias: [...categorias.values()] }
}

/** Quantas linhas da planilha o item ocupa: uma, ou uma por opção. */
export const pesoDo = (i: Pick<ItemImportado, 'variacoes'>) => Math.max(1, i.variacoes.length)

/**
 * Os itens em lotes de até `TAM_LOTE` linhas — cada lote é uma chamada ao
 * servidor, e a barra de progresso anda de lote em lote. Produto com grade
 * nunca é partido entre dois lotes.
 */
export function lotes<T extends Pick<ItemImportado, 'variacoes'>>(itens: T[], tamanho = TAM_LOTE): T[][] {
  const r: T[][] = []
  let atual: T[] = []
  let peso = 0
  for (const i of itens) {
    const p = pesoDo(i)
    if (atual.length > 0 && peso + p > tamanho) {
      r.push(atual)
      atual = []
      peso = 0
    }
    atual.push(i)
    peso += p
  }
  if (atual.length > 0) r.push(atual)
  return r
}

// ─────────────────────────────────────────────────────────────
// O QUE O SERVIDOR CONFERE
// ─────────────────────────────────────────────────────────────

const MEDIDAS_VALIDAS: readonly Medida[] = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'CX']

const textoSeguro = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}
const numeroSeguro = (v: unknown, min: number): number | null | undefined => {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > MAX_VALOR) return undefined
  return v
}
const codigoSeguro = (v: unknown) => {
  const t = textoSeguro(v, MAX_CODIGO)
  return t ? t.toUpperCase() : null
}
const eanSeguro = (v: unknown) => (typeof v === 'string' && /^\d{8,14}$/.test(v) ? v : null)

/**
 * O item que chegou do navegador, conferido campo a campo — ou a frase do
 * que está errado. A tela já montou certo; isto é para quem chamar a ação
 * sem a tela.
 */
export function conferirItem(x: unknown): ItemImportado | string {
  if (!x || typeof x !== 'object') return 'linha em formato desconhecido'
  const o = x as Record<string, unknown>
  const linha = typeof o.linha === 'number' && Number.isInteger(o.linha) && o.linha > 0 ? o.linha : 0
  const nome = textoSeguro(o.nome, MAX_NOME)
  if (!nome) return 'sem nome'
  const precoVista = numeroSeguro(o.precoVista, 0)
  if (!precoVista || precoVista <= 0) return 'preço de venda precisa ser maior que zero'
  const precoCartao = numeroSeguro(o.precoCartao, 0)
  const custo = numeroSeguro(o.custo, 0)
  const estoque = numeroSeguro(o.estoque, 0)
  if (precoCartao === undefined || custo === undefined || estoque === undefined) return 'número ilegível'
  const medida = MEDIDAS_VALIDAS.includes(o.medida as Medida) ? (o.medida as Medida) : 'UN'
  const variacoes: VariacaoImportada[] = []
  if (Array.isArray(o.variacoes)) {
    if (o.variacoes.length > MAX_VARIACOES) return `mais de ${MAX_VARIACOES} opções no mesmo produto`
    for (const v of o.variacoes) {
      if (!v || typeof v !== 'object') return 'opção em formato desconhecido'
      const w = v as Record<string, unknown>
      const tamanho = textoSeguro(w.tamanho, MAX_OPCAO)
      const cor = textoSeguro(w.cor, MAX_OPCAO)
      if (!tamanho && !cor) return 'opção sem tamanho nem cor'
      const est = numeroSeguro(w.estoque, 0)
      if (est === undefined) return 'estoque ilegível numa opção'
      variacoes.push({
        linha: typeof w.linha === 'number' && Number.isInteger(w.linha) ? w.linha : linha,
        tamanho,
        cor,
        codigo: codigoSeguro(w.codigo),
        codigoBarras: eanSeguro(w.codigoBarras),
        estoque: est,
      })
    }
  }
  return {
    linha,
    nome,
    codigo: codigoSeguro(o.codigo),
    codigoBarras: variacoes.length ? null : eanSeguro(o.codigoBarras),
    categoria: textoSeguro(o.categoria, MAX_CATEGORIA),
    marca: textoSeguro(o.marca, MAX_MARCA),
    medida,
    precoVista: dinheiro(precoVista),
    precoCartao: precoCartao === null ? null : dinheiro(precoCartao),
    custo: custo === null ? null : dinheiro(custo),
    estoque: variacoes.length ? null : estoque === null ? null : quantia(estoque),
    variacoes,
  }
}

// ─────────────────────────────────────────────────────────────
// A PLANILHA MODELO
// ─────────────────────────────────────────────────────────────

/** O modelo que a tela oferece para baixar: os títulos que as regras entendem de primeira. */
export const MODELO_CSV = [
  'Código;Nome;Categoria;Marca;Preço de venda;Preço no cartão;Custo;Estoque;Unidade;Código de barras;Tamanho;Cor',
  'CAM-01;Camiseta básica;Roupas;;49,90;54,90;22,00;3;UN;;P;Preta',
  'CAM-01;Camiseta básica;Roupas;;49,90;54,90;22,00;5;UN;;M;Preta',
  'CAF500;Café torrado 500 g;Mercearia;Marca Exemplo;18,90;;11,40;24;UN;7890000000017;;',
  'GRA-KG;Granola a granel;Mercearia;;32,00;;19,50;4,5;KG;;;',
].join('\r\n')
