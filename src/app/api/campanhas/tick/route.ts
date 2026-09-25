// O relógio das campanhas: POST /api/campanhas/tick, de minuto em minuto.
//
// Sem sessão. Quem autoriza é `Authorization: Bearer ${ROTINAS_SEGREDO}` — o
// mesmo segredo e a mesma conferência (tempo constante, segredo curto não
// vale) do relógio do assistente. Sem o segredo no servidor, ninguém passa.
//
// Chamar duas vezes no mesmo minuto não manda nada em dobro: quem já foi
// acordado tem o próximo despertador no futuro, e a trava de cada execução
// impede duas batidas de pegarem a mesma pessoa (ver campanhas/execucao.ts).

import { NextResponse } from 'next/server'
import { autorizado } from '@/servidor/assistente/rotinas'
import { tickCampanhas } from '@/servidor/campanhas/relogio'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!autorizado(request.headers.get('authorization'), process.env.ROTINAS_SEGREDO)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const r = await tickCampanhas(new Date())
  return NextResponse.json({ ok: r.falhas === 0, ...r }, { headers: { 'Cache-Control': 'no-store' } })
}
