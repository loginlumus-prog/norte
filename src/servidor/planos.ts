// Planos, limites e o que custa a mais.
//
// ── a regra de ouro ──────────────────────────────────────────
// O cliente NUNCA descobre a cobrança na fatura. Antes de criar a décima
// loja, a tela diz "isto passa a custar R$ X por mês" e ele confirma. Surpresa
// em conta é o caminho mais curto para o cancelamento — e para a reclamação
// pública, que custa mais que o cliente.
//
// ── e por que limite existe de verdade ───────────────────────
// Não é só comercial: cada loja é estoque próprio, caixa próprio, gente
// própria e mais consulta no banco. Rede de vinte lojas custa mais para
// atender, e o preço precisa acompanhar, senão o cliente grande é prejuízo.

import type { Plano } from '@prisma/client'

export type Limite = {
  titulo: string
  /** null = sem limite. */
  unidades: number | null
  usuarios: number | null
  /** Mensalidade base, em reais. */
  mensal: number | null
  /** Cobrado por unidade além da cota. null = não vende extra neste plano. */
  porUnidadeExtra: number | null
}

export const PLANOS: Record<Plano, Limite> = {
  BALCAO: {
    titulo: 'Balcão',
    unidades: 1,
    usuarios: 5,
    mensal: 349,
    porUnidadeExtra: null, // quem quer a segunda loja sobe de plano
  },
  BALCAO_AGENTE: {
    titulo: 'Balcão + Agente',
    unidades: 1,
    usuarios: 5,
    mensal: 697,
    porUnidadeExtra: null,
  },
  REDE: {
    titulo: 'Rede',
    unidades: 5,
    usuarios: 30,
    mensal: 1497,
    porUnidadeExtra: 249,
  },
  CORPORATIVO: {
    titulo: 'Corporativo',
    unidades: null,
    usuarios: null,
    mensal: null, // sob consulta
    porUnidadeExtra: null,
  },
}

export type Veredito =
  | { pode: true; custoExtra: 0 }
  /** Cabe, mas passa a custar mais — a tela tem que dizer ANTES. */
  | { pode: true; custoExtra: number; novoTotal: number }
  /** Não cabe neste plano: o caminho é subir de plano, não bloquear e calar. */
  | { pode: false; motivo: string; sugestao: Plano }

/**
 * Posso criar mais uma unidade?
 *
 * Devolve o custo em vez de só sim/não, porque quem chama precisa MOSTRAR o
 * valor antes de confirmar.
 */
export function podeCriarUnidade(plano: Plano, jaTem: number): Veredito {
  const p = PLANOS[plano]

  // Sem limite: nada a avisar.
  if (p.unidades === null) return { pode: true, custoExtra: 0 }

  // Ainda dentro da cota.
  if (jaTem < p.unidades) return { pode: true, custoExtra: 0 }

  // Passou da cota e o plano vende extra: cobra, mas avisa antes.
  if (p.porUnidadeExtra !== null) {
    const extras = jaTem - p.unidades + 1
    return {
      pode: true,
      custoExtra: p.porUnidadeExtra,
      novoTotal: (p.mensal ?? 0) + extras * p.porUnidadeExtra,
    }
  }

  // Passou da cota e o plano não vende extra: sobe de plano.
  return {
    pode: false,
    motivo:
      `O plano ${p.titulo} atende ${p.unidades} ` +
      `${p.unidades === 1 ? 'unidade' : 'unidades'}.`,
    sugestao: 'REDE',
  }
}

/** Mesma ideia para gente na equipe. */
export function podeAdicionarUsuario(plano: Plano, jaTem: number): Veredito {
  const p = PLANOS[plano]
  if (p.usuarios === null || jaTem < p.usuarios) return { pode: true, custoExtra: 0 }
  return {
    pode: false,
    motivo: `O plano ${p.titulo} atende ${p.usuarios} pessoas.`,
    sugestao: plano === 'REDE' ? 'CORPORATIVO' : 'REDE',
  }
}

/** O que esta empresa deve pagar hoje, com as unidades que ela tem. */
export function mensalidade(plano: Plano, unidades: number) {
  const p = PLANOS[plano]
  if (p.mensal === null) return { base: null, extras: 0, total: null }

  const cota = p.unidades ?? unidades
  const extras = p.porUnidadeExtra !== null ? Math.max(0, unidades - cota) : 0
  return {
    base: p.mensal,
    extras,
    porExtra: p.porUnidadeExtra,
    total: p.mensal + extras * (p.porUnidadeExtra ?? 0),
  }
}
