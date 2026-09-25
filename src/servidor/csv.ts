// Exportar em planilha.
//
// É obrigação dos termos (cláusula 11: a empresa leva os dados dela quando
// quiser) e é o que o contador pede todo mês. O formato é o que o Excel em
// português abre com dois cliques: ponto e vírgula como separador, vírgula
// decimal, e o BOM na frente para o acento aparecer certo.
//
// Nada aqui é esperto de propósito: uma linha por registro, uma coluna por
// campo, texto entre aspas quando precisa. Planilha que tenta ser bonita
// não abre no programa do contador.

export type Celula = string | number | boolean | Date | null | undefined

const noRelogioDeSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * Uma data vira dd/mm/aaaa, com hora quando é um instante.
 *
 * Duas espécies chegam aqui, e antes as duas saíam no relógio do servidor:
 *
 *   • coluna `date` (nascimento, vencimento) — chega como meia-noite UTC.
 *     No relógio de São Paulo isso é 21h do dia ANTERIOR: o aniversário de
 *     15/03 saía "14/03/1990 21:00". É reconhecida por ser meia-noite UTC
 *     em ponto, e sai pela data UTC, sem hora.
 *   • instante (`criadaEm`) — sai no relógio de São Paulo, qualquer que seja o
 *     fuso da máquina: a venda das 22h não pode virar o dia seguinte.
 */
function data(v: Date): string {
  if (Number.isNaN(v.getTime())) return ''
  const iso = v.toISOString()
  if (iso.endsWith('T00:00:00.000Z')) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  const [dia, hora] = noRelogioDeSP.format(v).split(', ')
  return hora && hora !== '00:00' ? `${dia} ${hora}` : dia!
}

/** Um valor vira o texto da célula. Número em vírgula decimal; data em dd/mm/aaaa. */
export function celula(v: Celula): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (v instanceof Date) return data(v)
  // Texto que começa com = + - @ é FÓRMULA para o Excel. O nome do cliente é
  // digitado no balcão; "=HYPERLINK(...)" cadastrado lá virava um link
  // clicável (ou pior) na planilha que o dono abre. O apóstrofo na frente
  // faz o Excel ler como texto. Número e telefone ("-5", "+55 71...") passam.
  const seguro = /^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s().,-]+$/.test(v) ? `'${v}` : v
  // Texto com ponto e vírgula, aspas ou quebra de linha vai entre aspas, com
  // as aspas de dentro dobradas — é a regra do CSV e é o que o Excel espera.
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

/** Monta o arquivo inteiro. O BOM (﻿) é o que faz o Excel ler UTF-8. */
export function csv(cabecalho: string[], linhas: Celula[][]): string {
  const corpo = [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n')
  return `﻿${corpo}\r\n`
}

/** A resposta HTTP pronta, com o nome do arquivo. */
export function respostaCsv(nome: string, conteudo: string): Response {
  return new Response(conteudo, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nome.replace(/[^\w.-]+/g, '-')}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
