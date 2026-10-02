// Números e datas das telas da fábrica, iguais no servidor e no navegador.
//
// Quem digita na fábrica escreve "4,5" (litro de leite) e às vezes "4.5"
// (teclado do celular). Os dois valem; "1.500" não — pode ser mil e
// quinhentos ou um e meio, e errar aqui é baixar mil vezes o estoque. A régua
// é a de `lerNumero` (dinheiro.ts), com três casas para quilo e litro.

import { lerNumero } from '@/servidor/dinheiro'
import { quantidade } from '@/ui/texto'

/** O que a pessoa digitou, em número. `null` = em branco; `NaN` = não deu para ler. */
export function ler(t: string): number | null {
  const s = t.trim()
  if (!s) return null
  return lerNumero(s, 3) ?? Number.NaN
}

/** Um número para pôr de volta num campo: vírgula, sem ponto de milhar. */
export const paraCampo = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false })

/** "2026-10-02" → "02/10/2026". */
export function diaBR(dia: string | null | undefined): string {
  if (!dia) return '—'
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}

/** Hoje + N dias, em AAAA-MM-DD — a validade que a ficha técnica sugere. */
export function diaMaisDias(hoje: string, dias: number): string {
  const d = new Date(`${hoje}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** "02/10 14:30", no relógio de São Paulo. */
export const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

export const LEGIVEL = 'Não deu para ler um dos números. Escreva assim: 4,5 ou 40.'

/** A sigla da medida: "kg", "l", "un" — a mesma de `quantidade`. */
export const sigla = (medida: string) => quantidade(1, medida).replace(/^1 /, '')
