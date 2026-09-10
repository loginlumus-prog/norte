// A venda em andamento sobrevive ao susto.
//
// ── o que estava errado ──────────────────────────────────────
// O carrinho do balcão só existia na memória da tela: produto, quantidade,
// desconto, cliente, formas de pagamento. Nada disso vira linha no banco antes
// da venda fechar — e é assim de propósito, porque venda pela metade não é
// venda e não pode aparecer em relatório nenhum.
//
// O problema não é o banco, é o que acontece antes dele. Um F5 sem querer, o
// navegador que trava, a luz que pisca, e a venda que estava sendo montada com
// o cliente na frente simplesmente some. Quem estava no caixa passa tudo de
// novo, na frente de quem está esperando.
//
// Aqui isso passa a ficar guardado no próprio aparelho enquanto a venda não
// fecha. Não é sincronização e não é o modo sem internet (esse é outro, e é
// grande): é uma cópia local do que está na tela, para a tela conseguir voltar
// ao que era.
//
// ── por que a chave leva a PESSOA ────────────────────────────
// Um computador no balcão, três turnos. Se a chave fosse só da loja, a venda
// deixada pela caixa da manhã apareceria para a da tarde — que concluiria, no
// nome dela, uma venda que ela não montou. O livro de auditoria passaria a
// mentir, e ele é justamente o que a gente vende.
//
// Com a pessoa na chave, cada uma volta para a sua, e quem senta na máquina
// depois começa limpo.

import type { ClienteNoBalcao } from './acoes'

/**
 * Depois disto, o que está guardado não volta mais.
 *
 * Doze horas cobre o turno mais longo e o "fechei sem querer, abro de novo
 * agora". O que não cobre — de propósito — é abrir na segunda-feira a venda
 * que ficou pela metade na sexta: aquele carrinho não tem mais nada a ver com
 * o cliente que está na frente, e ressuscitar ele seria pior que perder.
 */
const VALE_HORAS = 12

export type Guardado = {
  carrinho: unknown[]
  pagos: { forma: string; valor: number }[]
  desconto: number
  cliente: ClienteNoBalcao | null
  pontosUsar: number
  /** Quando foi guardado. É o que decide se ainda vale. */
  em: number
}

export const chaveDoBalcao = (slug: string, unidadeId: string, usuarioId: string) =>
  `norte:balcao:${slug}:${unidadeId}:${usuarioId}`

// Tudo aqui é try/catch porque `localStorage` NÃO é garantido: janela anônima,
// navegador com dado de site bloqueado, disco cheio. Em qualquer um desses o
// acesso ESTOURA — não devolve nulo. Sem o catch, o balcão inteiro morreria na
// hora de abrir por causa de uma preferência do navegador.

export function guardar(chave: string, dados: Omit<Guardado, 'em'>) {
  try {
    localStorage.setItem(chave, JSON.stringify({ ...dados, em: Date.now() }))
  } catch {
    // Sem lugar para guardar, o balcão continua funcionando como antes.
  }
}

export function recuperar(chave: string): Guardado | null {
  try {
    const cru = localStorage.getItem(chave)
    if (!cru) return null

    const g = JSON.parse(cru) as Guardado
    if (!Array.isArray(g.carrinho) || g.carrinho.length === 0) return null

    if (Date.now() - g.em > VALE_HORAS * 3600e3) {
      esquecer(chave)
      return null
    }
    return g
  } catch {
    // Guardado corrompido (mudou o formato, meio gravado) some em silêncio.
    // Recuperar meia venda é pior que não recuperar nenhuma.
    esquecer(chave)
    return null
  }
}

export function esquecer(chave: string) {
  try {
    localStorage.removeItem(chave)
  } catch {}
}

/** Quanto tempo faz, em palavra de gente. */
export function faz(em: number): string {
  const min = Math.floor((Date.now() - em) / 60000)
  if (min < 1) return 'agora mesmo'
  if (min === 1) return 'há 1 minuto'
  if (min < 60) return `há ${min} minutos`
  const h = Math.floor(min / 60)
  return h === 1 ? 'há 1 hora' : `há ${h} horas`
}
