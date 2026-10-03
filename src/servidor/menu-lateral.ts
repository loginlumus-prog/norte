// O menu da lateral: aberto, ou recolhido num trilho só de ícones.
//
// ── quem decide ──────────────────────────────────────────────
// A pessoa, com o botão que fica no alto da lateral, em toda tela. A escolha
// vai num cookie do APARELHO (como o modo simples/avançado, ver modo.ts): o
// computador do balcão fica do jeito que a loja deixou, seja quem for que
// sentar. Lido no servidor para a tela já nascer do tamanho certo — se fosse
// só no navegador, a lateral abriria larga e encolheria na frente da pessoa a
// cada clique de menu.
//
// ── o que vale quando ninguém escolheu ainda ─────────────────
// O padrão da tela: o balcão abre recolhido (a venda ganha a largura toda),
// as outras abrem com o menu aberto. Quem escolheu, escolheu para todas.

import { cookies } from 'next/headers'

export const COOKIE_MENU = 'menu'

/** Qualquer valor estranho no cookie vale como "ninguém escolheu". */
export function menuRecolhidoDe(valor: string | undefined | null, padrao: boolean): boolean {
  if (valor === 'recolhido') return true
  if (valor === 'aberto') return false
  return padrao
}

/** A lateral deste aparelho está recolhida? Só em componente de servidor. */
export async function menuRecolhido(padrao = false): Promise<boolean> {
  return menuRecolhidoDe((await cookies()).get(COOKIE_MENU)?.value, padrao)
}
