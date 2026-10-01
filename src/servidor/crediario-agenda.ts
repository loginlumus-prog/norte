// Quando vence cada parcela do crediário.
//
// ── o que mudou ──────────────────────────────────────────────
// Antes: hoje + 30, + 60, + 90 dias. Parece mês e não é: a venda do dia 5
// vencia 4/11, 4/12, 3/1, 2/2 — o dia escorrega, a cliente não decora, e a
// loja que cobra "todo dia 5" vê a parcela "atrasada" no dia 5.
//
// Agora a vendedora escolhe o 1º vencimento (vem pronto em hoje + 30, e vai
// até 60 dias — a cliente que recebe dia 10 pede para começar dia 10) e as
// seguintes caem NO MESMO DIA dos meses seguintes. Dia que o mês não tem
// cai no último dia dele: começou dia 31, vence 28 (ou 29) de fevereiro e
// volta para 31 em março — o dia é o do 1º vencimento, não o do mês anterior.
//
// Isso vale quando a loja cobra por mês (`crediarioDiasEntre` = 30, o
// padrão). A loja que configurou outro intervalo (quinzenal, semanal) segue
// com o intervalo dela em dias, a partir do 1º vencimento escolhido.
//
// Os centavos que não dividem certo vão um por vez para as PRIMEIRAS
// parcelas: a loja recebe o resto antes, não depois.
//
// Puro, sem I/O: a tela mostra a agenda com a mesma conta que o servidor grava.

import { colunaDoDia, diasEntre, somarDias } from './dia'

/** Até quantos dias depois da venda o 1º vencimento pode cair. */
export const PRIMEIRO_VENCIMENTO_MAX_DIAS = 60

/** O intervalo que quer dizer "todo mês, no mesmo dia". */
export const INTERVALO_MENSAL = 30

export type ParcelaAgendada = { numero: number; de: number; vencimento: Date; valorCent: number }

const ehDia = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(colunaDoDia(d).getTime()) && colunaDoDia(d).toISOString().slice(0, 10) === d

const ultimoDiaDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate()

/** O mesmo dia `meses` meses depois; dia que o mês não tem vira o último dele. */
export function mesmoDiaDepois(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  const total = a * 12 + (m - 1) + meses
  const ano = Math.floor(total / 12)
  const mes0 = total % 12
  const dd = Math.min(d, ultimoDiaDoMes(ano, mes0))
  return `${ano}-${String(mes0 + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** O 1º vencimento que a tela oferece: hoje + o intervalo da loja (30 dias, no padrão). */
export function primeiroVencimentoPadrao(hoje: string, diasEntre = INTERVALO_MENSAL): string {
  return somarDias(hoje, Math.max(1, diasEntre))
}

/** Até que dia o 1º vencimento pode ir: 60 dias, ou o intervalo da loja se for maior. */
export function primeiroVencimentoMaximo(hoje: string, diasEntre = INTERVALO_MENSAL): string {
  return somarDias(hoje, Math.max(PRIMEIRO_VENCIMENTO_MAX_DIAS, diasEntre))
}

/**
 * O que está errado neste 1º vencimento, ou `null` quando serve.
 *
 * Não pode ser hoje nem antes (parcela que já nasce vencida é cobrança de
 * juro no primeiro minuto), nem passar do máximo — data a perder de vista é
 * dedo errado no ano, não combinado com a cliente.
 */
export function problemaDoPrimeiroVencimento(dia: string, hoje: string, intervalo = INTERVALO_MENSAL): string | null {
  if (!ehDia(dia)) return 'Data do 1º vencimento inválida.'
  if (diasEntre(hoje, dia) < 1) return 'O 1º vencimento precisa ser depois de hoje.'
  if (dia > primeiroVencimentoMaximo(hoje, intervalo)) {
    return `O 1º vencimento vai até ${Math.max(PRIMEIRO_VENCIMENTO_MAX_DIAS, intervalo)} dias depois da venda.`
  }
  return null
}

/**
 * As parcelas: quantas, de quanto e para quando.
 *
 * `primeiroVencimento` é o dia escrito ('AAAA-MM-DD'), já conferido por quem
 * chama; os vencimentos saem prontos para a coluna `date` (meia-noite UTC do
 * dia — ver dia.ts).
 */
export function agendaDoCrediario(p: {
  totalCent: number
  parcelas: number
  primeiroVencimento: string
  diasEntre?: number
}): ParcelaAgendada[] {
  const n = Math.floor(p.parcelas)
  if (!(n >= 1) || !(p.totalCent > 0) || !ehDia(p.primeiroVencimento)) return []
  const intervalo = p.diasEntre ?? INTERVALO_MENSAL
  const base = Math.floor(p.totalCent / n)
  const resto = p.totalCent - base * n
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    de: n,
    vencimento: colunaDoDia(
      intervalo === INTERVALO_MENSAL
        ? mesmoDiaDepois(p.primeiroVencimento, i)
        : somarDias(p.primeiroVencimento, intervalo * i),
    ),
    valorCent: base + (i < resto ? 1 : 0),
  }))
}
