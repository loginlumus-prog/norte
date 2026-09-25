// Pequenas regras de texto que toda tela usa.
//
// ── por que existe ───────────────────────────────────────────
// "3 item(ns)", "1 venda(s)", "conta(s) vencida(s)": o plural com parêntese
// é o jeito de o programa dizer que não quis fazer a conta — e é a primeira
// coisa que faz um sistema parecer feito às pressas. A conta é uma linha.
//
// Puro, sem nada de servidor: serve à tela do servidor e à do navegador.

/** "venda" ou "vendas", conforme o número. Só a palavra. */
export function palavra(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios
}

/** "1 venda" / "3 vendas". O número vai junto, já no formato brasileiro. */
export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString('pt-BR')} ${palavra(n, um, varios)}`
}

/**
 * Quanto tempo, do jeito que se fala: "40 min", "14 horas", "11 dias".
 *
 * O painel dizia "Caixa aberto há 286 horas" enquanto a tela do caixa dizia
 * "há 11 dias" — o mesmo caixa, duas contas. Passou de um dia, fala em dias
 * (arredondando para baixo, como a tela do caixa); passou de uma hora, em
 * horas; antes disso, em minutos.
 */
export function duracao(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return plural(h, 'hora', 'horas')
  return plural(Math.floor(h / 24), 'dia', 'dias')
}

const SIGLA_DA_MEDIDA: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'l', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

/**
 * Uma quantidade com a medida dela: "1,857 kg", "3 un", "2 par".
 *
 * Sorvete a granel sai em quilo com três casas; camiseta sai inteira. Somar
 * ou mostrar os dois sem a medida dava "1,857 un" — um número que não quer
 * dizer nada para quem lê.
 */
export function quantidade(q: number, medida: string | null | undefined): string {
  const sigla = SIGLA_DA_MEDIDA[medida ?? 'UN'] ?? (medida ?? 'un').toLowerCase()
  return `${q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${sigla}`
}
