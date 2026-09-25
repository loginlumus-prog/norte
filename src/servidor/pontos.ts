// Programa de pontos: as contas.
//
// Sem I/O de propósito — isto aqui é aritmética, e aritmética de dinheiro
// merece teste exaustivo. O serviço que grava está em `pontos-servico.ts`.
//
// ── ponto é dívida, não brinde ───────────────────────────────
// Todo ponto entregue é desconto que a loja vai pagar depois. Um programa a
// R$ 0,10 por ponto, ganhando 1 ponto por real, devolve 10% de tudo — mais que
// a margem de muita peça. Por isso o programa nasce DESLIGADO e a loja escolhe
// os dois números com o resultado da conta na frente.
//
// ── por que milicentavo ──────────────────────────────────────
// O valor do ponto é pequeno e quebrado (R$ 0,025 é comum), então a conta em
// centavos inteiros perderia a casa que importa: 100 pontos × 2,5 centavos =
// 250 centavos, mas 1 ponto × 2,5 centavos arredondado vira 2 ou 3 e, somado
// mil vezes, some — ou aparece — dinheiro que ninguém sabe explicar.
//
// Então a conta inteira acontece em MILICENTAVO (1 centavo = 1000), que é
// exato para os quatro decimais que o banco guarda, e só o resultado final
// vira centavo. E vira PARA BAIXO: quando não fecha redondo, a sobra fica com
// a loja. O contrário seria a loja pagar um centavo que o cliente não juntou,
// toda venda, para sempre.

import type { Plano } from '@prisma/client'
import { liberado } from './planos'

export type Programa = {
  ativo: boolean
  /** Pontos ganhos por R$ 1 gasto. */
  porReal: number
  /** Quanto UM ponto vale em reais (até 4 casas). */
  pontoVale: number
  /** Quanto a pessoa precisa juntar antes de poder usar. */
  minimo: number
}

export const DESLIGADO: Programa = { ativo: false, porReal: 1, pontoVale: 0, minimo: 0 }

/** Valor de um ponto em milicentavos. Inteiro exato para 4 casas decimais. */
export const porPontoMili = (p: Programa): number => Math.round(p.pontoVale * 100_000)

/**
 * Quantos pontos esta venda gera.
 *
 * Conta em cima do que a pessoa REALMENTE pagou — depois do desconto e depois
 * dos pontos que ela já usou. Pontuar em cima do preço cheio faria a loja
 * pagar duas vezes pelo mesmo desconto.
 */
export function pontosGanhos(pagoCent: number, p: Programa): number {
  if (!p.ativo || pagoCent <= 0 || p.porReal <= 0) return 0
  // Pontos por real, com o pago em centavos: (cent/100) × porReal.
  return Math.floor((pagoCent * p.porReal) / 100)
}

/** O que N pontos valem, em centavos. Sempre para baixo. */
export function valorEmCentavos(pontos: number, p: Programa): number {
  if (!p.ativo || pontos <= 0) return 0
  return Math.floor((pontos * porPontoMili(p)) / 1000)
}

export type Oferta = {
  /** Pode usar agora? */
  pode: boolean
  /** Saldo de pontos da pessoa. */
  saldo: number
  /** Quantos pontos cabem nesta venda. */
  pontos: number
  /** Quanto isso abate, em centavos. */
  centavos: number
  /** Quando não dá, o motivo em português — a tela mostra isto. */
  recado: string | null
}

/**
 * O que dá para oferecer a esta pessoa, nesta venda.
 *
 * Três tetos, nesta ordem: o saldo dela, o mínimo do programa e o valor da
 * própria venda. O terceiro é o que mais esquece: sem ele, uma compra de R$ 10
 * feita por quem tem 5.000 pontos viraria venda de valor negativo, e o troco
 * sairia da gaveta.
 */
export function oferecer(saldo: number, aPagarCent: number, p: Programa): Oferta {
  const vazio = { saldo, pontos: 0, centavos: 0 }

  if (!p.ativo || porPontoMili(p) <= 0) {
    return { ...vazio, pode: false, recado: null }
  }
  if (saldo <= 0) {
    return { ...vazio, pode: false, recado: null }
  }
  if (saldo < p.minimo) {
    return {
      ...vazio,
      pode: false,
      recado: `Tem ${saldo} ponto(s). Precisa de ${p.minimo} para usar.`,
    }
  }
  if (aPagarCent <= 0) {
    return { ...vazio, pode: false, recado: null }
  }

  // Quantos pontos cabem no valor da venda, sem passar dela.
  const cabemNaVenda = Math.floor((aPagarCent * 1000) / porPontoMili(p))
  const pontos = Math.min(saldo, cabemNaVenda)
  const centavos = valorEmCentavos(pontos, p)

  if (pontos <= 0 || centavos <= 0) {
    return { ...vazio, pode: false, recado: null }
  }

  return { pode: true, saldo, pontos, centavos, recado: null }
}

export type Recusa =
  | 'programa_desligado'
  | 'sem_cliente'
  | 'saldo_insuficiente'
  | 'abaixo_do_minimo'
  | 'passa_da_venda'

/**
 * A conferência do servidor, DEPOIS que a tela pediu.
 *
 * A tela manda "usar 300 pontos", e a tela é do usuário: o número que chega
 * aqui é pedido, não ordem. Sem esta função, quem monta o POST na mão abate
 * 90.000 pontos que não tem e leva a mercadoria de graça.
 */
export function conferirUso(
  pedido: number,
  saldo: number,
  aPagarCent: number,
  p: Programa,
): { ok: true; pontos: number; centavos: number } | { ok: false; motivo: Recusa } {
  if (!p.ativo || porPontoMili(p) <= 0) return { ok: false, motivo: 'programa_desligado' }
  if (pedido <= 0) return { ok: false, motivo: 'saldo_insuficiente' }
  if (pedido > saldo) return { ok: false, motivo: 'saldo_insuficiente' }
  if (saldo < p.minimo) return { ok: false, motivo: 'abaixo_do_minimo' }

  const centavos = valorEmCentavos(pedido, p)
  if (centavos > aPagarCent) return { ok: false, motivo: 'passa_da_venda' }

  return { ok: true, pontos: pedido, centavos }
}

export const RECADO_PONTOS: Record<Recusa, string> = {
  programa_desligado: 'O programa de pontos está desligado.',
  sem_cliente: 'Escolha o cliente para usar os pontos dele.',
  saldo_insuficiente: 'A pessoa não tem todos esses pontos.',
  abaixo_do_minimo: 'Ainda não juntou o mínimo para usar.',
  passa_da_venda: 'Os pontos passam do valor da venda.',
}

/**
 * O que a loja está prometendo, em porcento do faturamento.
 *
 * Existe para a tela de configuração poder dizer, na hora em que a pessoa
 * digita: "isto devolve 3% de tudo que a loja vender". Escolher "1 ponto por
 * real, R$ 0,10 o ponto" sem ver esse número é assinar 10% sem ler.
 */
export function quantoCusta(p: Programa): number {
  if (!p.ativo || p.porReal <= 0) return 0
  // Em R$ 1: ganha `porReal` pontos, que valem `porReal × pontoVale` reais.
  return p.porReal * p.pontoVale * 100
}

/** Lê a configuração da empresa como Programa. Decimal do banco vira número. */
export function programaDe(org: {
  pontosAtivo: boolean
  pontosPorReal: { toString(): string }
  pontoVale: { toString(): string }
  pontosMinimo: number
}): Programa {
  return {
    ativo: org.pontosAtivo,
    porReal: Number(org.pontosPorReal),
    pontoVale: Number(org.pontoVale),
    minimo: org.pontosMinimo,
  }
}

/**
 * O programa que VALE para esta empresa: o configurado, se o plano abre o
 * programa de pontos; desligado, se não abre.
 *
 * O servidor da venda e a tela do balcão precisam dar a MESMA resposta: se a
 * tela mostrasse "ganha 12 pontos" e o servidor não creditasse, a promessa
 * seria feita na frente do cliente e quebrada no extrato dele.
 */
export function programaNoPlano(org: Parameters<typeof programaDe>[0] & { plano: Plano }): Programa {
  return liberado(org.plano, 'pontos.programa') ? programaDe(org) : DESLIGADO
}
