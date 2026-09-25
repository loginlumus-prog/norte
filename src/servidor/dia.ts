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

/**
 * O instante em que um dia COMEÇA em São Paulo — para filtrar coluna de
 * instante (`criadaEm`) pelo calendário da loja.
 *
 * O Brasil não tem horário de verão desde 2019, então a meia-noite de São
 * Paulo é sempre 03:00 UTC. Escrito com o deslocamento, e não com a hora
 * local do servidor: assim a conta não depende da variável TZ da máquina.
 */
export function inicioDoDiaEmSP(dia: string): Date {
  return new Date(`${dia}T00:00:00.000-03:00`)
}

/** O primeiro dia do mês de `dia` ('2026-09-25' → '2026-09-01'). */
export function primeiroDoMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`
}

/**
 * Uma coluna `date` escrita para gente: '25/09', '25/09/26', '25/09/2026'.
 *
 * O `Intl` formata no fuso do servidor, e a coluna chega como meia-noite UTC:
 * em São Paulo isso é 21h do dia ANTERIOR, e a parcela que vence dia 10
 * aparecia "vence 09/10". Formatar em UTC mostra o dia que foi gravado.
 */
export function mostrarDiaDaColuna(valor: Date, ano: 'nao' | 'curto' | 'longo' = 'nao'): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    ...(ano === 'curto' ? { year: '2-digit' as const } : ano === 'longo' ? { year: 'numeric' as const } : {}),
  }).format(valor)
}
