// O estado do sistema por dentro: uma loja só, para todas as telas.
//
// A venda que a pessoa conclui no Balcão tira do Estoque e soma no Painel; a
// conta que ela paga some do Financeiro e da linha "Precisa de você"; a
// proposta que ela confirma no Assistente vira conta a pagar ou peça no
// estoque. É o que faz a amostra parecer sistema, e não oito fotos: uma tela
// responde ao que se fez na outra, como lá dentro.
//
// Nada disto sai do navegador — não há servidor, nem gravação. Recarregar a
// página (ou "Recomeçar") volta a loja ao começo.

import {
  CONTAS,
  PRODUTOS,
  PROPOSTAS,
  TAREFAS,
  type Conta,
  type SituacaoTarefa,
} from './dados'

export type TelaId =
  | 'painel'
  | 'balcao'
  | 'estoque'
  | 'financeiro'
  | 'clientes'
  | 'tarefas'
  | 'analise'
  | 'assistente'

export type Modo = 'simples' | 'avancado'

export type Estado = {
  tela: TelaId
  modo: Modo
  estoque: Record<string, number>
  /** O que as vendas feitas aqui somaram ao dia. */
  extra: { total: number; vendas: number; custo: number }
  proximaVenda: number
  pagas: string[]
  contasNovas: Conta[]
  propostas: Record<string, 'espera' | 'confirmada' | 'recusada'>
  tarefas: Record<string, SituacaoTarefa>
}

export const INICIAL: Estado = {
  tela: 'painel',
  // O padrão do sistema: quem ninguém configurou começa no simples.
  modo: 'simples',
  estoque: Object.fromEntries(PRODUTOS.map((p) => [p.id, p.estoque])),
  extra: { total: 0, vendas: 0, custo: 0 },
  proximaVenda: 1292,
  pagas: [],
  contasNovas: [],
  propostas: Object.fromEntries(PROPOSTAS.map((p) => [p.id, 'espera' as const])),
  tarefas: Object.fromEntries(TAREFAS.map((t) => [t.id, t.situacao])),
}

export type Acao =
  | { tipo: 'tela'; tela: TelaId }
  | { tipo: 'modo'; modo: Modo }
  | { tipo: 'vender'; itens: { id: string; q: number }[] }
  | { tipo: 'entrada'; id: string; q: number }
  | { tipo: 'pagar'; id: string }
  | { tipo: 'proposta'; id: string; sim: boolean }
  | { tipo: 'tarefa'; id: string; situacao: SituacaoTarefa }
  | { tipo: 'recomecar' }

export function reduzir(e: Estado, a: Acao): Estado {
  switch (a.tipo) {
    case 'tela':
      return { ...e, tela: a.tela }
    case 'modo':
      return { ...e, modo: a.modo }
    case 'vender': {
      const estoque = { ...e.estoque }
      let total = 0
      let custo = 0
      for (const i of a.itens) {
        const p = PRODUTOS.find((x) => x.id === i.id)!
        estoque[i.id] = Math.max(0, (estoque[i.id] ?? 0) - i.q)
        total += p.preco * i.q
        custo += p.custo * i.q
      }
      return {
        ...e,
        estoque,
        extra: {
          total: Math.round((e.extra.total + total) * 100) / 100,
          vendas: e.extra.vendas + 1,
          custo: e.extra.custo + custo,
        },
        proximaVenda: e.proximaVenda + 1,
      }
    }
    case 'entrada':
      return { ...e, estoque: { ...e.estoque, [a.id]: (e.estoque[a.id] ?? 0) + a.q } }
    case 'pagar':
      return e.pagas.includes(a.id) ? e : { ...e, pagas: [...e.pagas, a.id] }
    case 'proposta': {
      if (e.propostas[a.id] !== 'espera') return e
      const p = PROPOSTAS.find((x) => x.id === a.id)!
      const propostas = { ...e.propostas, [a.id]: a.sim ? ('confirmada' as const) : ('recusada' as const) }
      if (!a.sim) return { ...e, propostas }
      if (p.efeito.tipo === 'conta') {
        return { ...e, propostas, contasNovas: [...e.contasNovas, p.efeito.conta] }
      }
      return {
        ...e,
        propostas,
        estoque: { ...e.estoque, [p.efeito.id]: (e.estoque[p.efeito.id] ?? 0) + p.efeito.q },
      }
    }
    case 'tarefa':
      return { ...e, tarefas: { ...e.tarefas, [a.id]: a.situacao } }
    case 'recomecar':
      return { ...INICIAL, tela: e.tela, modo: e.modo }
  }
}

/** Todas as contas em aberto: as da loja, mais as que as propostas lançaram. */
export function contasEmAberto(e: Estado): Conta[] {
  return [...CONTAS, ...e.contasNovas].filter((c) => !e.pagas.includes(c.id))
}

export const PESSOAS: Record<string, string> = {
  MC: 'Marina',
  JP: 'João',
  RA: 'Rafaela',
  CS: 'Carlos',
}
