// O DIA, no calendário da loja.
//
// ── o defeito que isto fecha ─────────────────────────────────
// Vencimento de parcela, de conta e prazo de tarefa são colunas `date` — sem
// hora. O Prisma entrega uma coluna `date` como a MEIA-NOITE EM UTC daquele
// dia: o vencimento de 25/09 chega como 2026-09-25T00:00Z. A meia-noite de
// 25/09 em São Paulo é 2026-09-25T03:00Z. Comparar os dois com `<` dizia que a
// parcela que vence HOJE já tinha vencido desde a madrugada — e a conta de
// dias de atraso contava um dia a mais, o que cobrava juro a mais do cliente.
//
// Os testes antigos não pegavam: montavam as datas com `new Date(2026, 8, 25)`,
// que é meia-noite LOCAL, e não do jeito que o banco devolve.
//
// ── a regra ──────────────────────────────────────────────────
// Conta de calendário se faz com o dia escrito ('AAAA-MM-DD'), nunca com o
// instante. "Hoje" é o dia em São Paulo; o dia de uma coluna `date` é a parte
// de data dela em UTC. Texto nesse formato se compara com `<` direto.
//
// Puro, sem I/O.

export const FUSO = 'America/Sao_Paulo'

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** O dia de hoje (ou de um instante qualquer) no calendário de São Paulo. */
export function diaEmSP(instante: Date = new Date()): string {
  return formato.format(instante)
}

/** O dia guardado numa coluna `date`, do jeito que o Prisma a devolve. */
export function diaDaColuna(valor: Date): string {
  return valor.toISOString().slice(0, 10)
}

/** O valor para filtrar uma coluna `date` pelo dia: `{ lt: colunaDoDia(hoje) }`. */
export function colunaDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`)
}

/** O dia + n dias de calendário. */
export function somarDias(dia: string, n: number): string {
  const d = colunaDoDia(dia)
  d.setUTCDate(d.getUTCDate() + n)
  return diaDaColuna(d)
}

/** Quantos dias de calendário de `de` até `ate`. Negativo quando `ate` vem antes. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((colunaDoDia(ate).getTime() - colunaDoDia(de).getTime()) / 864e5)
}
