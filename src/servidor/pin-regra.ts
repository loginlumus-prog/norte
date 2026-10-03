// A regra do PIN, sem banco nem servidor: serve ao servidor (que confere de
// verdade) e à tela do balcão (que recusa na hora o PIN fraco, sem esperar a
// viagem). Quem decide é sempre o servidor; a tela só poupa o vai-e-volta.

/** O PIN tem de 4 a 6 números — para criar e para conferir. */
export const PIN_MIN = 4
export const PIN_MAX = 6

/**
 * O que está errado neste PIN, ou `null` quando ele serve.
 *
 * Além do tamanho, recusa o que todo mundo chuta primeiro: número repetido
 * (0000, 1111) e escada (1234, 4321, 123456). Com 10 mil combinações e um
 * freio de cinco tentativas, o chute só funciona se o PIN for desses.
 */
export function problemaDoPin(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return 'O PIN é só de números.'
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return `O PIN tem de ${PIN_MIN} a ${PIN_MAX} números.`
  if (/^(\d)\1+$/.test(pin)) return 'Número repetido (como 0000) é o primeiro que alguém chuta. Escolha outro.'
  const d = [...pin].map(Number)
  const sobe = d.every((x, i) => i === 0 || x === (d[i - 1]! + 1) % 10)
  const desce = d.every((x, i) => i === 0 || x === (d[i - 1]! + 9) % 10)
  if (sobe || desce) return 'Sequência (como 1234) é o primeiro que alguém chuta. Escolha outro.'
  return null
}
