// Previsão de ruptura: quando a peça vai faltar, e até quando dá para pedir.
//
// ── a conta ──────────────────────────────────────────────────
// O estoque já diz "está no mínimo". Isso é um número parado. O que a pessoa
// precisa é um número que ande: no ritmo em que sai, o saldo dura QUANTOS
// DIAS — e o fornecedor leva quantos dias para entregar? Se dura 6 e a
// entrega leva 10, "no mínimo" é tarde. Se dura 60 e a entrega leva 3, o
// mínimo pode esperar.
//
//   ritmo    = vendidos nos últimos 30 dias / 30
//   dura     = saldo / ritmo
//   pedir até = hoje + (dura − prazo)
//
// ── por que 30 dias ──────────────────────────────────────────
// É a janela que o painel, a Análise e o "saiu 30d" já usam. Curta demais,
// um sábado bom faz tudo parecer urgente; longa demais, a peça que virou
// moda em agosto ainda parece parada em setembro. Um mês é o ciclo em que a
// loja pensa — e é o ciclo do aluguel.
//
// ── por que o prazo padrão existe ────────────────────────────
// Quase ninguém preenche o prazo de reposição no primeiro dia. Sem um
// padrão, a previsão ficaria muda para o catálogo inteiro até alguém abrir
// ficha por ficha. Sete dias é o que pedido a distribuidor nacional costuma
// levar; a tela marca "(padrão)" para que a pessoa saiba que aquele número é
// nosso, não dela.
//
// A parte pura (`preverRuptura`, `ordenarPorUrgencia`) roda sem banco e está
// testada em `tests/ruptura.test.ts`.

import { comoOrg } from './banco'
import { exigir, type Sessao } from './permissao'

export const PRAZO_PADRAO = 7
export const JANELA_DIAS = 30

/** Quantas linhas a seção "Vai faltar" mostra. Mais que isso é lista, não alerta. */
export const LIMITE_LINHAS = 40

export type SituacaoRuptura = 'ja_faltou' | 'pedir_agora' | 'atencao' | 'ok' | 'sem_giro'

export type Previsao = {
  /** Unidades por dia, no ritmo dos últimos 30 dias. */
  ritmoDia: number
  /** Quantos dias o saldo aguenta. Nulo sem ritmo (não dá para dividir por zero). */
  duraDias: number | null
  /** O prazo usado na conta: o informado, ou o padrão. */
  prazo: number
  prazoInformado: boolean
  situacao: SituacaoRuptura
  /**
   * O último dia em que dá para pedir e a peça chegar antes de faltar. Nulo
   * quando não há o que prever (já faltou, ou não gira). Quando a data já
   * passou, vem HOJE: o melhor dia que sobrou.
   */
  pedirAte: Date | null
}

const DIA_MS = 86400000

export function preverRuptura({
  saldo,
  vendidos30,
  prazoDias,
  hoje = new Date(),
}: {
  saldo: number
  vendidos30: number
  prazoDias: number | null
  hoje?: Date
}): Previsao {
  const ritmoDia = Math.max(0, vendidos30) / JANELA_DIAS
  const prazoInformado = prazoDias !== null && prazoDias !== undefined
  const prazo = prazoInformado ? Math.max(0, prazoDias) : PRAZO_PADRAO

  // Saldo zerado (ou negativo — venda que passou do saldo) já é ruptura, e
  // não importa o ritmo: a peça não está na prateleira.
  if (saldo <= 0) {
    return { ritmoDia, duraDias: ritmoDia > 0 ? 0 : null, prazo, prazoInformado, situacao: 'ja_faltou', pedirAte: null }
  }

  // Tem saldo e não vende: não vai faltar — vai sobrar. É outra conversa
  // (a de dinheiro parado, na Análise), e por isso é uma situação própria em
  // vez de "ok": ok diria que está tudo bem, e não está.
  if (ritmoDia <= 0) {
    return { ritmoDia, duraDias: null, prazo, prazoInformado, situacao: 'sem_giro', pedirAte: null }
  }

  const duraDias = saldo / ritmoDia
  const folga = duraDias - prazo

  const situacao: SituacaoRuptura =
    duraDias <= prazo ? 'pedir_agora'
    : duraDias <= 2 * prazo ? 'atencao'
    : 'ok'

  // Chão, não arredondamento: pedir um dia antes custa nada, um dia depois
  // custa a venda.
  const pedirAte = new Date(hoje.getTime() + Math.max(0, Math.floor(folga)) * DIA_MS)

  return { ritmoDia, duraDias, prazo, prazoInformado, situacao, pedirAte }
}

/**
 * Do mais urgente para o menos.
 *
 * Primeiro o que já faltou, depois o que tem que ser pedido hoje, depois o
 * que está chegando perto. Dentro do grupo, o que dura menos vem antes; entre
 * os que já faltaram, o que vendia mais — porque é a falta que mais custa.
 */
const PESO: Record<SituacaoRuptura, number> = {
  ja_faltou: 0,
  pedir_agora: 1,
  atencao: 2,
  ok: 3,
  sem_giro: 4,
}

export function ordenarPorUrgencia<T extends { previsao: Previsao }>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    const p = PESO[a.previsao.situacao] - PESO[b.previsao.situacao]
    if (p !== 0) return p
    if (a.previsao.situacao === 'ja_faltou') return b.previsao.ritmoDia - a.previsao.ritmoDia
    const da = a.previsao.duraDias ?? Number.POSITIVE_INFINITY
    const dbb = b.previsao.duraDias ?? Number.POSITIVE_INFINITY
    return da - dbb
  })
}

// ─────────────────────────────────────────────────────────────
// COM BANCO
// ─────────────────────────────────────────────────────────────

export type LinhaRuptura = {
  variacaoId: string
  nome: string
  codigo: string | null
  /** "P · Azul". Vazio para item sem variação. */
  opcoes: string
  saldo: number
  vendidos30: number
  prazoDias: number | null
  previsao: Previsao
}

/**
 * A previsão por variação, somando as unidades pedidas.
 *
 * Por VARIAÇÃO e não por produto: quem repõe compra "Azul M", e o Azul M
 * pode estar acabando enquanto o Preto G sobra. Somar por produto esconderia
 * exatamente a falta que a pessoa veio ver.
 *
 * Entra só o que tem saldo ou vendeu no mês: variação sem saldo e sem venda
 * é grade que nunca chegou à prateleira, e listar isso como "já faltou"
 * seria alarme falso em cima de alarme falso.
 */
export async function previsaoDeRuptura(sessao: Sessao, unidadeIds: string[]): Promise<LinhaRuptura[]> {
  exigir(sessao, 'estoque.ver')
  if (unidadeIds.length === 0) return []

  const corte = new Date(Date.now() - JANELA_DIAS * DIA_MS)

  const linhas = await comoOrg(sessao.orgId, async (db) => {
    const uni = unidadeIds
    // Saldo, venda e opções em três laterais, uma por variação, porque juntar
    // estoque com venda na mesma junção multiplicaria o saldo pelo número de
    // vendas. As opções vêm já em texto, na ordem do eixo — é como a etiqueta
    // se lê.
    return db.$queryRaw<
      {
        variacao_id: string
        nome: string
        codigo: string | null
        prazo: number | null
        saldo: string | null
        vendidos: string | null
        opcoes: string | null
      }[]
    >`
      select vr.id as variacao_id, p.nome, vr.codigo, p.prazo_reposicao_dias as prazo,
             e.saldo, s.vendidos, o.opcoes
        from variacoes vr
        join produtos p on p.id = vr.produto_id
        left join lateral (
          select sum(quantidade) as saldo
            from estoque
           where variacao_id = vr.id and unidade_id = any(${uni})
        ) e on true
        left join lateral (
          select sum(i.quantidade) as vendidos
            from venda_itens i
            join vendas v on v.id = i.venda_id
           where i.variacao_id = vr.id
             and v.unidade_id = any(${uni})
             and v.situacao = 'CONCLUIDA'
             and v.criada_em >= ${corte}
        ) s on true
        left join lateral (
          select string_agg(op.valor, ' · ' order by ex.ordem, op.ordem) as opcoes
            from variacao_opcoes vo
            join opcoes op on op.id = vo.opcao_id
            join eixos ex on ex.id = op.eixo_id
           where vo.variacao_id = vr.id
        ) o on true
       where vr.ativa and p.ativo
         and (coalesce(e.saldo, 0) > 0 or coalesce(s.vendidos, 0) > 0)
    `
  })

  const hoje = new Date()
  return ordenarPorUrgencia(
    linhas.map((l) => {
      const saldo = Number(l.saldo ?? 0)
      const vendidos30 = Number(l.vendidos ?? 0)
      return {
        variacaoId: l.variacao_id,
        nome: l.nome,
        codigo: l.codigo,
        opcoes: l.opcoes ?? '',
        saldo,
        vendidos30,
        prazoDias: l.prazo,
        previsao: preverRuptura({ saldo, vendidos30, prazoDias: l.prazo, hoje }),
      }
    }),
  ).slice(0, LIMITE_LINHAS)
}
