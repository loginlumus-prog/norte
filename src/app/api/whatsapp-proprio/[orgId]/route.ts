// A porta por onde o CONECTOR entrega o que chegou no WhatsApp conectado por
// QR Code: POST /api/whatsapp-proprio/{orgId}.
//
// Sem sessão, sem cookie. Quem autoriza é a assinatura HMAC do corpo, com o
// CONECTOR_SEGREDO, e um carimbo de no máximo cinco minutos (ver
// src/servidor/assistente/conector.ts). Assinatura errada, velha ou de outro
// caminho: 401, antes de qualquer leitura no banco.
//
// Responde NA HORA e processa depois (`after`), como o webhook do Z-API: a
// conversa com a IA leva segundos, e o conector não precisa esperar por ela.
// A mensagem é gravada pelo id: entregar duas vezes não duplica nada.

import { after, NextResponse } from 'next/server'
import { veioDoConector } from '@/servidor/assistente/conector'
import { receberDoConector } from '@/servidor/assistente/proprio'

/** Mensagem de texto normalizada pelo conector não chega perto disto. */
const MAXIMO_CORPO = 64 * 1024

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params

  if (Number(request.headers.get('content-length') ?? 0) > MAXIMO_CORPO) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  const bruto = await request.text()
  if (bruto.length > MAXIMO_CORPO) return NextResponse.json({ ok: false }, { status: 413 })
  if (!veioDoConector(request, bruto)) return NextResponse.json({ ok: false }, { status: 401 })

  let corpo: unknown = null
  try {
    corpo = JSON.parse(bruto)
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const porta = await receberDoConector(orgId, corpo, {})
  if (porta.trabalho) {
    const trabalho = porta.trabalho
    after(async () => {
      try {
        await trabalho()
      } catch (e) {
        // O id da empresa é nosso; nada da mensagem vai para o log.
        console.error(`[whatsapp-proprio] ${orgId}: falhou ao processar`, e instanceof Error ? e.message : e)
      }
    })
  }
  return NextResponse.json({ ok: porta.status === 200 }, { status: porta.status })
}
