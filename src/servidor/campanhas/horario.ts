// "Só no horário da loja": entender o horário que a loja escreveu.
//
// O horário mora em Unidade.horario como TEXTO LIVRE — "Seg a sex 9h-18h,
// sáb 9h-13h" — porque é o que o assistente lê em voz alta para o cliente.
// Aqui ele é lido por máquina, do jeito mais comum que as lojas escrevem.
// Não entendeu? Devolve nulo, e a espera ignora o horário (o editor avisa).
// Adivinhar um horário é pior que ignorar: a mensagem das 9h sairia às 3h.
//
// PURO. O relógio é o de São Paulo (sem horário de verão desde 2019: o
// deslocamento é fixo, e é isso que deixa `inicioDoDiaEmSP` somar minutos).

import { diaEmSP, inicioDoDiaEmSP, somarDias } from '../dia'
import { normalizar } from './casar'

/** Por dia da semana (0 = domingo), as janelas abertas em minutos do dia. */
export type Horario = Record<number, [number, number][]>

const DIAS: Record<string, number> = {
  dom: 0, domingo: 0,
  seg: 1, segunda: 1,
  ter: 2, terca: 2,
  qua: 3, quarta: 3,
  qui: 4, quinta: 4,
  sex: 5, sexta: 5,
  sab: 6, sabado: 6,
}

const hora = (h: string, m?: string) => Number(h) * 60 + Number(m ?? 0)

/**
 * "Seg a sex 9h-18h, sáb 9h às 13h" → { 1..5: [[540,1080]], 6: [[540,780]] }.
 * Aceita "9h", "9:00", "09h30", "9h às 18h", "9-18", "de segunda a sexta",
 * "todos os dias", "diariamente", "seg, qua e sex". Nulo se nada fizer
 * sentido.
 */
export function lerHorario(texto: string | null | undefined): Horario | null {
  if (!texto?.trim()) return null
  const h: Horario = {}
  let achou = false
  // Sem acento e em minúsculas, mas mantendo ":" (9:30) e "-" (9-18).
  const limpo = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/-?feira/g, ' ')
  // Cada faixa de hora é precedida pelos dias a que ela se refere: o texto
  // entre o fim da faixa anterior e o começo desta. Assim "seg a sex 9h-18h
  // sáb 9h-13h" funciona com ou sem vírgula entre os trechos.
  const faixa = /(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:-|a|as|ate)\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?/g
  let depoisDaAnterior = 0
  for (const m of limpo.matchAll(faixa)) {
    const de = hora(m[1]!, m[2])
    const ate = hora(m[3]!, m[4])
    const parteDias = normalizar(limpo.slice(depoisDaAnterior, m.index))
    depoisDaAnterior = m.index! + m[0].length
    if (!(de >= 0 && ate <= 24 * 60 && de < ate)) continue
    for (const d of lerDias(parteDias)) (h[d] ??= []).push([de, ate])
    achou = true
  }
  return achou ? h : null
}

const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6]

/** Os dias de um trecho. Trecho sem dia nenhum ("9h às 18h") vale para todos. */
function lerDias(t: string): number[] {
  if (!t || /\b(todos os dias|diariamente|todo dia|todos)\b/.test(t)) return TODOS_OS_DIAS
  const palavras = t.split(' ').filter(Boolean)
  const achados: { d: number; i: number }[] = []
  palavras.forEach((p, i) => {
    if (p in DIAS) achados.push({ d: DIAS[p]!, i })
  })
  if (achados.length === 0) return TODOS_OS_DIAS
  // "seg a sex": intervalo entre os dois primeiros, se ligados por "a"/"ate".
  if (achados.length === 2 && palavras.slice(achados[0]!.i + 1, achados[1]!.i).some((p) => p === 'a' || p === 'ate')) {
    const out: number[] = []
    for (let d = achados[0]!.d; ; d = (d + 1) % 7) {
      out.push(d)
      if (d === achados[1]!.d || out.length > 7) break
    }
    return out
  }
  return achados.map((a) => a.d)
}

/** Dia da semana e minuto do dia, em São Paulo. */
function relogio(agora: Date): { dia: string; semana: number; minuto: number } {
  const dia = diaEmSP(agora)
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay()
  const minuto = Math.floor((agora.getTime() - inicioDoDiaEmSP(dia).getTime()) / 60_000)
  return { dia, semana, minuto }
}

/**
 * O primeiro instante, a partir de `quando`, em que a loja está aberta.
 * Se já está aberta, é o próprio `quando`. Procura até oito dias à frente;
 * horário sem janela nenhuma devolve `quando` (melhor mandar que nunca).
 */
export function proximaAbertura(quando: Date, h: Horario): Date {
  const r = relogio(quando)
  for (let i = 0; i < 8; i++) {
    const dia = somarDias(r.dia, i)
    const semana = (r.semana + i) % 7
    const janelas = [...(h[semana] ?? [])].sort((a, b) => a[0] - b[0])
    for (const [de, ate] of janelas) {
      if (i === 0) {
        if (r.minuto >= de && r.minuto < ate) return quando
        if (r.minuto >= ate) continue
      }
      return new Date(inicioDoDiaEmSP(dia).getTime() + de * 60_000)
    }
  }
  return quando
}
