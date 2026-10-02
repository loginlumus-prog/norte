// A foto de um produto, para o catálogo público (e para o próprio sistema).
// GET /{empresa}/foto/{id}
//
// Sem sessão: a foto de produto é o que a loja põe na vitrine. Só sai mídia
// que é foto de produto DESTA empresa (ver `lerFotoPublica`) — áudio e vídeo
// de campanha não passam por aqui. O id muda quando a foto muda (a mídia é
// guardada pelo conteúdo), então o navegador pode guardar para sempre.

import { lerFotoPublica } from '@/servidor/catalogo'

export async function GET(_: Request, { params }: { params: Promise<{ empresa: string; id: string }> }) {
  const { empresa, id } = await params
  const f = await lerFotoPublica(empresa, id)
  if (!f) return new Response('não encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new Response(new Uint8Array(f.dados), {
    headers: {
      'Content-Type': f.mime,
      'Content-Length': String(f.dados.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  })
}
