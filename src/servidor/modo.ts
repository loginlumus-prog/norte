// Simples ou avançado: quanto do sistema aparece de uma vez.
//
// ── por que existe ───────────────────────────────────────────
// A mesma ferramenta é aberta por duas pessoas muito diferentes. A moça do
// balcão da sorveteria precisa de três botões e do total; o dono, no fim do
// mês, quer a curva ABC, o livro de auditoria e o markup de cada item. Uma
// tela só para as duas vira a tela de ninguém: a primeira se perde, o
// segundo se irrita procurando.
//
// ── o que cada modo muda ─────────────────────────────────────
// SIMPLES   o menu esconde as telas de análise (Caixa, Preços, Análise,
//           Auditoria); o painel abre pelo essencial e pelo que precisa de
//           você hoje; o balcão vende por botões grandes.
// AVANÇADO  tudo aparece, com todos os gráficos e todas as colunas.
//
// Nenhum dos dois TIRA permissão: o modo decide o que se VÊ primeiro, nunca o
// que se PODE. Quem colar o endereço da Análise no modo simples abre a
// Análise normalmente — e o item aparece aceso no menu enquanto está nela.
//
// ── e por que cookie do APARELHO, e não preferência da pessoa ─
// Porque quem decide é o lugar, não a pessoa. O computador do balcão fica no
// simples para sempre, seja quem for que sentar; o notebook do dono fica no
// avançado. Se fosse da pessoa, o dono que passasse pelo balcão para vender
// levaria o avançado junto e deixaria a tela do caixa cheia de gráfico.

import { cookies } from 'next/headers'

export type Modo = 'simples' | 'avancado'

/** O que ninguém escolheu ainda vê o simples: é a porta de entrada. */
export const MODO_PADRAO: Modo = 'simples'

/** Lê o valor cru do cookie. Qualquer coisa estranha vira o padrão. */
export function modoDe(valor: string | undefined | null): Modo {
  return valor === 'avancado' || valor === 'simples' ? valor : MODO_PADRAO
}

/** O modo deste aparelho. Só em componente de servidor. */
export async function lerModo(): Promise<Modo> {
  return modoDe((await cookies()).get('modo')?.value)
}
