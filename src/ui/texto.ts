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
