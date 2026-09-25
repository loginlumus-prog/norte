// A sessão do WhatsApp conectado por QR Code, guardada no Norte — cifrada.
//
//   GET    /api/whatsapp-proprio/{orgId}/sessao  → { dados, versao } ou 404
//   PUT    /api/whatsapp-proprio/{orgId}/sessao  ← { dados, versao }  (409 = versão velha)
//   DELETE /api/whatsapp-proprio/{orgId}/sessao
//
// Só o conector fala aqui: assinatura HMAC do pedido inteiro (método, caminho,
// corpo, carimbo de até cinco minutos), com o CONECTOR_SEGREDO. É por isto
// que o conector não guarda credencial nenhuma no disco — e é por isto que
// esta porta é tão fechada quanto a do webhook: com a sessão, fala-se pelo
// WhatsApp da loja.
//
// A empresa do endereço precisa existir (404 se não). O conteúdo entra e sai
// daqui em claro, por HTTPS; no banco, só cifrado (src/servidor/cifra.ts).

import { NextResponse } from 'next/server'
import { veioDoConector } from '@/servidor/assistente/conector'
import {
  apagarSessaoWhatsapp,
  empresaExiste,
  gravarSessaoWhatsapp,
  lerSessaoWhatsapp,
  MAXIMO_SESSAO,
} from '@/servidor/assistente/proprio'

type Contexto = { params: Promise<{ orgId: string }> }

const nao = (status: number) =>
  NextResponse.json({ ok: false }, { status, headers: { 'Cache-Control': 'no-store' } })

/** Confere assinatura e empresa. Devolve a resposta de recusa, ou nulo se pode seguir. */
async function porteiro(request: Request, orgId: string, corpo: string): Promise<NextResponse | null> {
  if (!veioDoConector(request, corpo)) return nao(401)
  if (!(await empresaExiste(orgId))) return nao(404)
  return null
}

export async function GET(request: Request, { params }: Contexto) {
  const { orgId } = await params
  const recusa = await porteiro(request, orgId, '')
  if (recusa) return recusa
  const s = await lerSessaoWhatsapp(orgId)
  if (!s) return nao(404)
  return NextResponse.json(s, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, { params }: Contexto) {
  const { orgId } = await params
  if (Number(request.headers.get('content-length') ?? 0) > MAXIMO_SESSAO + 1024) return nao(413)
  const bruto = await request.text()
  if (bruto.length > MAXIMO_SESSAO + 1024) return nao(413)
  const recusa = await porteiro(request, orgId, bruto)
  if (recusa) return recusa

  let corpo: { dados?: unknown; versao?: unknown }
  try {
    corpo = JSON.parse(bruto) as typeof corpo
  } catch {
    return nao(400)
  }
  const r = await gravarSessaoWhatsapp(orgId, corpo?.dados, corpo?.versao)
  if (r === 'ok') return NextResponse.json({ ok: true })
  if (r === 'velha') return nao(409)
  if (r === 'sem_cifra') {
    // Sem NORTE_CIFRA não se guarda credencial em texto, nem "por enquanto".
    console.error('[whatsapp-proprio] sem NORTE_CIFRA: a sessão não foi guardada')
    return nao(503)
  }
  return nao(400)
}

export async function DELETE(request: Request, { params }: Contexto) {
  const { orgId } = await params
  const recusa = await porteiro(request, orgId, '')
  if (recusa) return recusa
  await apagarSessaoWhatsapp(orgId)
  return NextResponse.json({ ok: true })
}
