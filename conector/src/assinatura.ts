// A conversa entre o conector e o Norte é assinada nos dois sentidos.
//
//   Norte → conector: `Authorization: Bearer <CONECTOR_SEGREDO>`. O conector é
//     serviço interno; quem tem o segredo manda nele.
//   conector → Norte: HMAC-SHA256 do pedido inteiro, com o mesmo segredo. O
//     Norte fica na internet aberta, e o endereço do webhook é adivinhável
//     (/api/whatsapp-proprio/<id da empresa>). Sem a assinatura, qualquer um
//     mandaria "mensagem do dono" para o assistente — ou trocaria a sessão
//     do WhatsApp de uma loja.
//
// O que entra na assinatura: carimbo, método, caminho e corpo cru. O caminho
// prende o pedido à empresa (assinado para a A não serve na porta da B); o
// carimbo limita a repetição a cinco minutos.
//
// PURO: só node:crypto. O Norte tem a MESMA conta em
// src/servidor/assistente/conector.ts — são dois programas, sem pacote em
// comum; um teste na raiz confere que um aceita o que o outro assina.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const CABECALHO_CARIMBO = 'x-norte-carimbo'
export const CABECALHO_ASSINATURA = 'x-norte-assinatura'

/** Segredo curto é segredo adivinhável. */
export const MINIMO_SEGREDO = 32

/** Quanto o relógio dos dois lados pode discordar, e quanto dura um pedido assinado. */
export const TOLERANCIA_SEGUNDOS = 300

const base = (carimbo: string, metodo: string, caminho: string, corpo: string) =>
  `${carimbo}.${metodo.toUpperCase()}.${caminho}.${corpo}`

/** Assina um pedido. `agora` em ms (o carimbo vai em segundos). */
export function assinar(
  segredo: string,
  metodo: string,
  caminho: string,
  corpo: string,
  agora: number = Date.now(),
): { carimbo: string; assinatura: string } {
  const carimbo = String(Math.floor(agora / 1000))
  const assinatura = 'v1=' + createHmac('sha256', segredo).update(base(carimbo, metodo, caminho, corpo)).digest('hex')
  return { carimbo, assinatura }
}

/**
 * Confere `Authorization: Bearer <segredo>` em tempo constante.
 * Sem segredo configurado (ou curto), ninguém passa.
 */
export function conferirPortador(segredo: string, cabecalho: string | null | undefined): boolean {
  if (!segredo || segredo.length < MINIMO_SEGREDO || typeof cabecalho !== 'string') return false
  const m = /^Bearer\s+(.+)$/i.exec(cabecalho.trim())
  if (!m) return false
  const a = Buffer.from(m[1]!)
  const b = Buffer.from(segredo)
  return a.length === b.length && timingSafeEqual(a, b)
}
