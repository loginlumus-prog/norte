// A mídia de campanha para o fornecedor do WhatsApp buscar:
// GET /api/midia/{id}/{assinatura}?org={empresa}&exp={vence}
//
// Sem sessão e sem cookie — quem busca é o Z-API (ou o conector), não uma
// pessoa da loja. A autorização é o próprio endereço: HMAC de (empresa, id,
// vencimento), conferido em tempo constante ANTES de qualquer leitura no
// banco. Assinatura errada, prazo vencido ou prazo longo demais → 404, a
// mesma resposta de id inexistente: a porta não serve para descobrir se uma
// mídia existe. Ver src/servidor/campanhas/midia.ts.

import { conferirAssinatura, lerMidia } from '@/servidor/campanhas/midia'

const nada = () => new Response('não encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; assinatura: string }> },
) {
  const { id, assinatura } = await params
  const url = new URL(request.url)
  const orgId = url.searchParams.get('org') ?? ''
  const exp = Number(url.searchParams.get('exp'))
  if (!orgId || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !/^[A-Za-z0-9_-]{1,40}$/.test(orgId)) return nada()
  if (!conferirAssinatura({ orgId, midiaId: id, exp, assinatura })) return nada()

  const m = await lerMidia(orgId, id)
  if (!m) return nada()
  return new Response(new Uint8Array(m.dados), {
    headers: {
      'Content-Type': m.mime,
      'Content-Length': String(m.tamanho),
      'Content-Disposition': 'inline',
      // O endereço já vence sozinho; cache privado só evita buscar duas vezes
      // na mesma tentativa de envio.
      'Cache-Control': 'private, max-age=3600',
      ETag: `"${m.sha256}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
