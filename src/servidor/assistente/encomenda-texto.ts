// A encomenda em texto de WhatsApp — o mesmo jeito de dizer na ferramenta do
// assistente (`encomendas.ver`), no aviso à equipe e no aviso à cliente.
//
// PURO: sem banco, sem I/O. A hora é a de São Paulo, pelas funções de
// encomenda.ts (o servidor pode estar em qualquer fuso).

import { diaCurtoSP, diaEmSP, horaEmSP, somarDias } from '../encomenda'

/** "Maria Aparecida Souza" → "Maria". Na conversa da equipe, o primeiro nome basta. */
export const primeiroNome = (nome: string | null | undefined): string => (nome ?? '').trim().split(/\s+/)[0] ?? ''

/** 2 → "2"; 1,5 → "1,5". */
const numero = (q: number) => q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

/**
 * "2x Picolé de morango, 1x Pote 1L" — dos itens do catálogo; sem itens (a
 * encomenda de balcão), a descrição. Cortado: a lista inteira de um pedido
 * grande é a tela, não a mensagem.
 */
export function itensEmTexto(itens: readonly { descricao: string; quantidade: number }[], descricao: string, max = 160): string {
  const t = itens.length > 0 ? itens.map((i) => `${numero(i.quantidade)}x ${i.descricao}`).join(', ') : descricao
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** "15h" ou "15h30" — como se fala a hora no WhatsApp. */
export function horaFalada(d: Date): string {
  const [h, m] = horaEmSP(d).split(':') as [string, string]
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

/** "hoje às 15h", "amanhã às 9h30", "sáb 04/10 às 15h". */
export function quandoFalado(para: Date, agora: Date): string {
  const dia = diaEmSP(para)
  const hoje = diaEmSP(agora)
  const qual = dia === hoje ? 'hoje' : dia === somarDias(hoje, 1) ? 'amanhã' : diaCurtoSP(para)
  return `${qual} às ${horaFalada(para)}`
}

/** "retirada hoje às 15h" / "entrega amanhã às 10h". */
export const comoRecebe = (e: { entrega: boolean; para: Date }, agora: Date) =>
  `${e.entrega ? 'entrega' : 'retirada'} ${quandoFalado(e.para, agora)}`

/**
 * O código que a pessoa digita: "ENC-A1B2C3", "enc a1b2c3", "a1b2c3". Devolve
 * o pedaço final do id (minúsculo, como o cuid) — ou nulo se não parece código.
 */
export function finalDoCodigo(texto: string): string | null {
  const t = texto.trim()
  // Com "ENC" na frente, em qualquer lugar; sem, só se o texto for o código
  // inteiro — senão "aceitar" viraria o código "aceita".
  const m = /\benc[\s-]*([a-z0-9]{6})\b/i.exec(t) ?? /^([a-z0-9]{6})$/i.exec(t)
  return m ? m[1]!.toLowerCase() : null
}
