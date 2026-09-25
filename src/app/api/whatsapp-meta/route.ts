// O webhook do WhatsApp OFICIAL (Meta, Cloud API): /api/whatsapp-meta.
//
//   GET  — a verificação do endereço, quando ele é cadastrado no painel da
//          Meta: `hub.verify_token` tem de ser o META_WEBHOOK_VERIFY_TOKEN, e
//          a resposta é o `hub.challenge` puro. Errado: 403.
//   POST — mensagens, status de entrega, ecos do app WhatsApp Business e
//          avisos de modelo. A assinatura `X-Hub-Signature-256` é conferida
//          sobre o corpo CRU (por isso `request.text()`, e nunca `.json()`).
//
// Com a Meta desligada neste servidor (faltam as variáveis META_*), as duas
// respondem 404: a porta não existe.
//
// Responde 200 NA HORA e processa depois (`after`): a Meta reenvia por até 7
// dias o que não foi confirmado rápido, e a conversa com a IA leva segundos.
// As regras moram em src/servidor/assistente/meta-webhook.ts.

import { after, NextResponse } from 'next/server'
import { receberWebhookMeta, verificarWebhookMeta } from '@/servidor/assistente/meta-webhook'
import { semSegredo } from '@/servidor/assistente/meta-regras'

/** A Meta junta até mil atualizações por POST; nada legítimo passa de 1 MB. */
const MAXIMO_CORPO = 1024 * 1024

export const maxDuration = 300

export async function GET(request: Request) {
  const r = verificarWebhookMeta(new URL(request.url).searchParams)
  return new Response(r.corpo, {
    status: r.status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAXIMO_CORPO) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  const bruto = await request.text()
  if (bruto.length > MAXIMO_CORPO) return NextResponse.json({ ok: false }, { status: 413 })

  const porta = receberWebhookMeta(bruto, request.headers.get('x-hub-signature-256'))
  if (porta.trabalho) {
    const trabalho = porta.trabalho
    after(async () => {
      try {
        await trabalho()
      } catch (e) {
        console.error('[whatsapp-meta] falhou ao processar', semSegredo(e instanceof Error ? e.message : String(e)))
      }
    })
  }
  return NextResponse.json({ ok: porta.status === 200 }, { status: porta.status })
}
