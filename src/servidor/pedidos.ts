// Os pedidos de assinatura: "quero o plano Norte", "quero +500 respostas" (e
// o "quero R$ 200 de crédito" do modelo antigo, que ainda está no livro).
//
// ── por que não existe uma tabela de pedidos ─────────────────
// Enquanto não há gateway, subir de plano e pôr crédito viram PEDIDO (ver
// `assinaturaLivre` em assinatura.ts), e o pedido já nasce como linha no livro
// de auditoria da empresa — `plano.pediu` / `respostas.pediu` (e o antigo
// `credito.pediu`). O livro é imutável, datado e já é lido pela loja. Uma
// tabela à parte seria uma
// segunda verdade sobre a mesma coisa, e mexer no schema agora não vale o que
// custa: o volume é de dezenas de pedidos, não de milhares.
//
// Então o ESTADO de um pedido é deduzido do que veio depois dele no livro:
//
//   aberto       nada respondeu ainda
//   atendido     o plano pedido entrou (`plano.trocou`), o pacote entrou
//                (`respostas.adicionou`), ou o crédito caiu
//                (`credito.recarregou` apontando para o pedido, ou uma
//                recarga COMPRA depois dele — é o que o gateway vai gravar)
//   recusado     a equipe recusou (`pedido.recusou`), com o motivo que a loja lê
//   substituído  a loja pediu de novo, do mesmo tipo, antes da resposta —
//                vale o último; responder o velho seria responder o que ela
//                já não quer
//
// A regra é PURA (`lerPedidos`) para ser testada sem banco, e a mesma serve
// para a tela da Assinatura (uma empresa, dentro do comoOrg) e para a
// ferramenta de operação da equipe (todas as empresas, no laptop).

import type { Plano } from '@prisma/client'
import { comoOrg } from './banco'
import { PLANOS, PRECOS, milhar, type Pacote } from './planos'
import { mostrar } from './dinheiro'

/** O pacote que corresponde a um número de respostas pedido (o de 500, antigo, vira o pequeno). */
export const pacoteDeRespostas = (n: number): Pacote => (n >= PRECOS.pacoteGrandeRespostas ? 'grande' : 'pequeno')

/** O pacote que um pedido do livro pediu — a equipe atende o que foi pedido. */
export async function pacoteDoPedido(orgId: string, pedidoId: string): Promise<Pacote> {
  const linha = await comoOrg(orgId, (db) =>
    db.auditoria.findFirst({ where: { id: pedidoId, acao: 'respostas.pediu' }, select: { depois: true } }),
  )
  const n = (linha?.depois as { respostas?: unknown } | null)?.respostas
  return pacoteDeRespostas(typeof n === 'number' ? n : PRECOS.pacoteRespostas)
}

/** As ações do livro que contam a história de um pedido. */
export const ACOES_DE_PEDIDO = [
  'plano.pediu',
  'credito.pediu',
  'respostas.pediu',
  'plano.trocou',
  'credito.recarregou',
  'respostas.adicionou',
  'pedido.recusou',
] as const

/** `credito` é do modelo antigo (dinheiro de IA): só aparece em pedido que já estava no livro. */
export type TipoPedido = 'plano' | 'credito' | 'respostas'

/** Uma linha do livro (ou uma recarga) que pode abrir ou fechar um pedido. */
export type EventoPedido = {
  id: string
  /** Uma de ACOES_DE_PEDIDO, ou 'recarga' (uma RecargaIA COMPRA positiva). */
  acao: string
  criadoEm: Date
  alvoNome: string | null
  motivo: string | null
  depois: unknown
}

export type Pedido = {
  /** O id da linha `*.pediu` no livro. É por ele que a resposta aponta. */
  id: string
  tipo: TipoPedido
  criadoEm: Date
  /** O plano pedido, quando o pedido é de plano e dá para saber qual. */
  plano: Plano | null
  /** O valor pedido, em centavos, quando o pedido é de crédito. */
  centavos: number | null
  /** O pacote pedido, quando o pedido é de respostas. */
  pacote?: Pacote | null
  /** "plano Norte" / "pacote de +500 respostas" / "R$ 200,00 de crédito de IA" */
  oQue: string
  estado: 'aberto' | 'atendido' | 'recusado' | 'substituido'
  fechadoEm: Date | null
  /** O motivo da recusa, como a loja vai ler. */
  motivoRecusa: string | null
}

const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const ehPlano = (v: unknown): v is Plano => typeof v === 'string' && v in PLANOS

/** "Direção" → 'REDE'. Para as linhas antigas, que só guardavam o título. */
export function planoPeloTitulo(titulo: string | null): Plano | null {
  if (!titulo) return null
  const t = titulo.trim()
  const achado = (Object.keys(PLANOS) as Plano[]).find((p) => PLANOS[p].titulo === t)
  return achado ?? TITULOS_ANTIGOS[t] ?? null
}

/**
 * Os nomes que os planos já tiveram. O livro não se reescreve: um pedido de
 * setembro diz "Direção", e precisa continuar sendo lido como o plano que era.
 */
const TITULOS_ANTIGOS: Record<string, Plano> = {
  Balcão: 'BALCAO',
  'Balcão + Assistente': 'BALCAO_AGENTE',
  Assistente: 'BALCAO_AGENTE',
  Rede: 'REDE',
  Direção: 'REDE',
  // A tabela de 02/10/2026 a 06/10/2026: um plano e o assistente por cima.
  Norte: 'BALCAO',
  'Norte + Assistente': 'BALCAO_AGENTE',
}

/** "R$ 1234,56" (o formato de `mostrar`) → 123456. Para as linhas antigas. */
export function centavosDoTexto(texto: string | null): number | null {
  const m = texto?.match(/R\$\s*(-?)(\d+),(\d{2})/)
  if (!m) return null
  const v = Number(m[2]) * 100 + Number(m[3])
  return m[1] ? -v : v
}

/** O plano de destino de um `plano.trocou` (novo: `depois.para`; antigo: o título). */
function destinoDaTroca(e: EventoPedido): Plano | null {
  const para = objeto(e.depois).para
  return ehPlano(para) ? para : planoPeloTitulo(e.alvoNome)
}

function abrir(e: EventoPedido): Pedido {
  const d = objeto(e.depois)
  if (e.acao === 'plano.pediu') {
    const plano = ehPlano(d.plano) ? d.plano : planoPeloTitulo(e.alvoNome)
    return {
      id: e.id, tipo: 'plano', criadoEm: e.criadoEm, plano, centavos: null,
      oQue: `plano ${plano ? PLANOS[plano].titulo : (e.alvoNome ?? '?')}`,
      estado: 'aberto', fechadoEm: null, motivoRecusa: null,
    }
  }
  if (e.acao === 'respostas.pediu') {
    const n = typeof d.respostas === 'number' ? d.respostas : PRECOS.pacoteRespostas
    return {
      id: e.id, tipo: 'respostas', criadoEm: e.criadoEm, plano: null, centavos: null,
      pacote: pacoteDeRespostas(n),
      oQue: `pacote de +${milhar(n)} respostas`,
      estado: 'aberto', fechadoEm: null, motivoRecusa: null,
    }
  }
  const centavos = typeof d.centavos === 'number' ? d.centavos : centavosDoTexto(e.alvoNome)
  return {
    id: e.id, tipo: 'credito', criadoEm: e.criadoEm, plano: null, centavos,
    oQue: `${centavos !== null ? mostrar(centavos) : (e.alvoNome ?? '?')} de crédito de IA`,
    estado: 'aberto', fechadoEm: null, motivoRecusa: null,
  }
}

/**
 * Todos os pedidos de UMA empresa, com o estado de cada um, do mais antigo
 * ao mais novo. Os eventos podem vir em qualquer ordem.
 */
export function lerPedidos(eventos: readonly EventoPedido[]): Pedido[] {
  // Empate de horário: o pedido vem antes da resposta. Na prática não
  // empata (são requisições diferentes), mas a regra não pode depender disso.
  const ordem = (a: string) => (a.endsWith('.pediu') ? 0 : 1)
  const linha = [...eventos].sort(
    (a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || ordem(a.acao) - ordem(b.acao),
  )

  const todos: Pedido[] = []
  const aberto: Partial<Record<TipoPedido, Pedido>> = {}
  const fechar = (p: Pedido, estado: Pedido['estado'], quando: Date, motivo: string | null = null) => {
    p.estado = estado
    p.fechadoEm = quando
    p.motivoRecusa = motivo
    delete aberto[p.tipo]
  }

  for (const e of linha) {
    const d = objeto(e.depois)
    const apontaPara = typeof d.pedidoId === 'string' ? d.pedidoId : null

    if (e.acao === 'plano.pediu' || e.acao === 'credito.pediu' || e.acao === 'respostas.pediu') {
      const novo = abrir(e)
      const velho = aberto[novo.tipo]
      if (velho) fechar(velho, 'substituido', e.criadoEm)
      aberto[novo.tipo] = novo
      todos.push(novo)
      continue
    }

    if (e.acao === 'plano.trocou') {
      const p = aberto.plano
      // Troca para o plano pedido atende. Troca para OUTRO plano só atende se
      // foi a equipe respondendo a este pedido (a conversa pode acabar num
      // plano diferente do clicado) — a loja descendo sozinha não responde
      // um pedido de subir.
      if (p && (apontaPara === p.id || (p.plano !== null && destinoDaTroca(e) === p.plano))) {
        fechar(p, 'atendido', e.criadoEm)
      }
      continue
    }

    if (e.acao === 'credito.recarregou') {
      const p = aberto.credito
      if (p && apontaPara === p.id) fechar(p, 'atendido', e.criadoEm)
      continue
    }

    if (e.acao === 'respostas.adicionou') {
      // Pacote que entrou depois do pedido atende — apontando para ele, ou
      // não (o gateway e a tela no modo livre não sabem do pedido).
      const p = aberto.respostas
      if (p && (apontaPara === null || apontaPara === p.id)) fechar(p, 'atendido', e.criadoEm)
      continue
    }

    if (e.acao === 'recarga') {
      // Recarga COMPRA depois do pedido: o dinheiro entrou, por onde for.
      const p = aberto.credito
      if (p) fechar(p, 'atendido', e.criadoEm)
      continue
    }

    if (e.acao === 'pedido.recusou') {
      const tipo = d.tipo === 'plano' || d.tipo === 'credito' || d.tipo === 'respostas' ? d.tipo : null
      const p = tipo ? aberto[tipo] : undefined
      if (p && (apontaPara === null || apontaPara === p.id)) {
        fechar(p, 'recusado', e.criadoEm, e.motivo)
      }
    }
  }

  return todos
}

/** Só os que esperam resposta. No máximo um por tipo. */
export const pedidosAbertos = (eventos: readonly EventoPedido[]): Pedido[] =>
  lerPedidos(eventos).filter((p) => p.estado === 'aberto')

/** O pedido aberto deste tipo, se houver. */
export const pedidoAberto = (eventos: readonly EventoPedido[], tipo: TipoPedido): Pedido | null =>
  pedidosAbertos(eventos).find((p) => p.tipo === tipo) ?? null

/** Até quando uma recusa continua aparecendo na tela da loja. */
export const RECUSA_APARECE_DIAS = 30

/**
 * O que a tela da Assinatura mostra de cada tipo: o pedido que espera
 * resposta, ou a recusa recente (com o motivo). Atendido não precisa de
 * aviso — o plano novo e o saldo novo já estão na tela.
 */
export function pedidosParaTela(
  eventos: readonly EventoPedido[],
  agora = new Date(),
): Partial<Record<TipoPedido, Pedido>> {
  const limite = agora.getTime() - RECUSA_APARECE_DIAS * 864e5
  const saida: Partial<Record<TipoPedido, Pedido>> = {}
  for (const p of lerPedidos(eventos)) {
    // O último de cada tipo manda: um pedido novo esconde a recusa antiga.
    if (p.estado === 'aberto' || (p.estado === 'recusado' && p.fechadoEm!.getTime() >= limite)) {
      saida[p.tipo] = p
    } else if (p.estado !== 'substituido') {
      delete saida[p.tipo]
    }
  }
  return saida
}

/** Quanto do livro olhar para trás. Pedido de meio ano atrás já não é pedido. */
export const JANELA_PEDIDOS_DIAS = 180

/** Os eventos de pedido de UMA empresa, pelo caminho da aplicação (RLS). */
export async function eventosDePedido(orgId: string, agora = new Date()): Promise<EventoPedido[]> {
  const desde = new Date(agora.getTime() - JANELA_PEDIDOS_DIAS * 864e5)
  return comoOrg(orgId, async (db) => {
    // Em sequência, não em Promise.all: dentro do comoOrg é uma conexão só.
    const livro = await db.auditoria.findMany({
      where: { acao: { in: [...ACOES_DE_PEDIDO] }, criadoEm: { gte: desde } },
      select: { id: true, acao: true, criadoEm: true, alvoNome: true, motivo: true, depois: true },
      orderBy: { criadoEm: 'asc' },
      take: 500,
    })
    // O pacote de respostas também é recarga COMPRA, mas fecha o pedido DELE
    // (pela linha `respostas.adicionou`), não um pedido antigo de crédito.
    const recargas = await db.recargaIA.findMany({
      where: { tipo: 'COMPRA', centavos: { gt: 0 }, criadoEm: { gte: desde }, origem: { not: 'pacote' } },
      select: { id: true, criadoEm: true },
      take: 500,
    })
    return [...livro, ...recargas.map(recargaComoEvento)]
  })
}

/** Uma recarga COMPRA vira evento — é assim que o gateway fecha o pedido. */
export const recargaComoEvento = (r: { id: string; criadoEm: Date }): EventoPedido => ({
  id: r.id, acao: 'recarga', criadoEm: r.criadoEm, alvoNome: null, motivo: null, depois: null,
})
