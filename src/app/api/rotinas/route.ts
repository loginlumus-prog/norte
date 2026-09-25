// O relógio do assistente: POST /api/rotinas, chamado de hora em hora por um
// cron externo (ver render.yaml).
//
// Sem sessão. Quem autoriza é `Authorization: Bearer ${ROTINAS_SEGREDO}` —
// sem o segredo configurado no servidor, ninguém passa, nem com cabeçalho.
// O que roda em cada hora é decidido lá dentro, no fuso de São Paulo
// (src/servidor/assistente/rotinas.ts); chamar fora de hora não faz nada.
//
// Roda até o fim antes de responder, de propósito: o log do cron mostra o
// que aconteceu (quantas empresas, quantas mensagens, quantas falhas) — e é
// o único lugar onde alguém olha às oito da manhã.

import { NextResponse } from 'next/server'
import { autorizado, rodarRotinas } from '@/servidor/assistente/rotinas'
import { empresasComAgente } from '@/servidor/assistente/portaria'
import { canalPadrao, empresaDoZapi, temZapi } from '@/servidor/assistente/canal'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!autorizado(request.headers.get('authorization'), process.env.ROTINAS_SEGREDO)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  // Com o WhatsApp de verdade, só a empresa do piloto recebe rotina: as outras
  // falariam pelo número dela (ver `ZAPI_EMPRESA` em canal.ts).
  const r = await rodarRotinas(new Date(), {
    canal: canalPadrao(),
    empresas: temZapi()
      ? async () => (await empresasComAgente()).filter((e) => e.slug === empresaDoZapi())
      : undefined,
  })
  return NextResponse.json({ ok: r.falhas === 0, ...r }, { headers: { 'Cache-Control': 'no-store' } })
}
