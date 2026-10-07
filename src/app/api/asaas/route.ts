// O aviso do Asaas: /api/asaas. Cadastrado no painel do Asaas (Integrações ›
// Webhooks), com os eventos de cobrança. As regras moram em
// src/servidor/asaas.ts — o aviso só diz "olhe o pagamento tal"; quem decide
// se está pago é a consulta ao Asaas com a nossa chave.
//
// Responde 200 NA HORA e trabalha depois (`after`): o Asaas pausa a fila de
// avisos depois de falhas seguidas.

import { after, NextResponse } from 'next/server'
import { receberAvisoAsaas } from '@/servidor/asaas'

const MAXIMO_CORPO = 256 * 1024

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAXIMO_CORPO) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  const bruto = await request.text()
  if (bruto.length > MAXIMO_CORPO) return NextResponse.json({ ok: false }, { status: 413 })

  const porta = receberAvisoAsaas(bruto, request.headers.get('asaas-access-token'))
  if (porta.trabalho) {
    const trabalho = porta.trabalho
    after(async () => {
      try {
        await trabalho()
      } catch (e) {
        console.error('[asaas] falhou ao processar o aviso:', (e as Error).message)
      }
    })
  }
  return NextResponse.json({ ok: porta.status === 200 }, { status: porta.status })
}
