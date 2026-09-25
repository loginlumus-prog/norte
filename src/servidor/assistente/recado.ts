// O recado fixo ao cliente — a única coisa automática que um cliente recebe
// fora de uma campanha.
//
// ── por que existe, e por que é tão pouco ────────────────────
// Cliente não conversa com a IA (ver `conversa.ts`): quem responde é uma
// pessoa da loja, no WhatsApp da loja. O recado serve só para o cliente não
// achar que falou sozinho — "Oi! Já vamos te atender por aqui." — e por isso
// ele tem três travas, todas pensadas contra o recado virar ruído:
//
//   • vem DESLIGADO. A loja liga na tela do assistente, e escreve a frase;
//   • sai no máximo UMA vez a cada 12 horas por pessoa. Quem manda cinco
//     mensagens seguidas recebe um recado, não cinco;
//   • NUNCA sai se alguém da loja escreveu para aquela pessoa nas últimas
//     24 horas. A conversa já tem gente — um robô no meio dela atrapalha.
//
// Este arquivo é PURO (nada de banco): a tela importa daqui o texto padrão,
// e o teste confere a decisão sem subir nada.
//
// ── onde mora ────────────────────────────────────────────────
// Sem coluna nova: a chave ligada é o poder `recado.automatico` em
// `Agente.poderes` (a lista que a tela já grava, e que em toda empresa
// existente vem sem ele — desligado, como tem de ser), e o texto é
// `Agente.saudacao` ("a primeira frase", que era exatamente isto). O "alguém
// da loja escreveu" é `ConversaAgente.humanoAte`: cada mensagem que sai do
// celular da loja empurra essa marca para 24 horas à frente.

import type { ChavePoder } from '../poderes'

export const PODER_RECADO: ChavePoder = 'recado.automatico'

/** A frase que a tela sugere quando a loja liga o recado sem ter escrito nada. */
export const RECADO_PADRAO = 'Oi! Recebemos sua mensagem e já vamos te atender por aqui.'

/** Uma pessoa recebe no máximo um recado neste intervalo. */
export const HORAS_ENTRE_RECADOS = 12
/** Depois que alguém da loja escreveu, o recado fica calado por este tempo. */
export const HORAS_DE_HUMANO = 24
/** Recado é uma frase, não um manual. */
export const MAXIMO_RECADO = 300

const HORA = 3600_000

/** O texto do recado, se a loja ligou E escreveu. Nulo = desligado. */
export function recadoDe(agente: { poderes: string[]; saudacao: string | null }): string | null {
  if (!agente.poderes.includes(PODER_RECADO)) return null
  const texto = (agente.saudacao ?? '').trim().slice(0, MAXIMO_RECADO)
  return texto || null
}

/** Até quando o recado fica calado, a partir de uma mensagem da loja agora. */
export const humanoAteDepoisDe = (agora: Date) => new Date(agora.getTime() + HORAS_DE_HUMANO * HORA)

export type DecisaoRecado =
  | { manda: true; texto: string }
  | { manda: false; motivo: 'recado_desligado' | 'humano' | 'recado_recente' }

/**
 * Manda o recado agora?
 *
 * `ultimaNossa` é a última mensagem que NÓS mandamos para esta pessoa — o
 * recado anterior, ou qualquer outra (a de uma campanha, por exemplo). Se
 * saiu alguma coisa automática nas últimas 12 horas, a pessoa já sabe que foi
 * ouvida.
 */
export function decidirRecado(a: {
  recado: string | null
  humanoAte: Date | null
  ultimaNossa: Date | null
  agora: Date
}): DecisaoRecado {
  if (!a.recado) return { manda: false, motivo: 'recado_desligado' }
  if (a.humanoAte && a.humanoAte > a.agora) return { manda: false, motivo: 'humano' }
  if (a.ultimaNossa && a.agora.getTime() - a.ultimaNossa.getTime() < HORAS_ENTRE_RECADOS * HORA) {
    return { manda: false, motivo: 'recado_recente' }
  }
  return { manda: true, texto: a.recado }
}
