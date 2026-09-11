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

/** Um valor vira o texto da célula. Número em vírgula decimal; data em dd/mm/aaaa. */
export function celula(v: Celula): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, '0')
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const h = v.getHours() || v.getMinutes() ? ` ${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}` : ''
    return `${d}/${m}/${v.getFullYear()}${h}`
  }
  // Texto com ponto e vírgula, aspas ou quebra de linha vai entre aspas, com
  // as aspas de dentro dobradas — é a regra do CSV e é o que o Excel espera.
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
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
