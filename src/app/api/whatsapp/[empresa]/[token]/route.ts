// O webhook do Z-API: POST /api/whatsapp/{empresa}/{token}.
//
// Sem sessão, sem cookie. Quem autoriza é o token do endereço, conferido
// antes de qualquer outra coisa (ver src/servidor/assistente/webhook.ts).
//
// Responde 200 NA HORA e processa depois (`after`): o Z-API reenvia o que
// demora a ser confirmado, e a conversa com a IA pode levar vários segundos.
// Reenvio não duplica nada — a mensagem é gravada pelo id dela — mas cada
// reenvio ainda seria uma leitura à toa.

import { after, NextResponse } from 'next/server'
import { receberWebhook } from '@/servidor/assistente/webhook'
import { canalPara } from '@/servidor/assistente/canal'


/** Mensagem de WhatsApp em JSON não passa disto. Corpo maior é outra coisa. */
const MAXIMO_CORPO = 256 * 1024

export async function POST(
  request: Request,
  { params }: { params: Promise<{ empresa: string; token: string }> },
) {
  const { empresa, token } = await params

  if (Number(request.headers.get('content-length') ?? 0) > MAXIMO_CORPO) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  const bruto = await request.text()
  if (bruto.length > MAXIMO_CORPO) return NextResponse.json({ ok: false }, { status: 413 })
  let corpo: unknown = null
  try {
    corpo = JSON.parse(bruto)
  } catch {
    corpo = null
  }

  const porta = receberWebhook(empresa, token, corpo, { canal: canalPara(empresa) })
  if (porta.trabalho) {
    const trabalho = porta.trabalho
    after(async () => {
      try {
        await trabalho()
      } catch (e) {
        // O slug é público; o token não entra no log.
        console.error(`[whatsapp] ${empresa}: falhou ao processar`, e instanceof Error ? e.message : e)
      }
    })
  }
  return NextResponse.json({ ok: porta.status === 200 }, { status: porta.status })
}
