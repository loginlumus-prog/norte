// O relógio das campanhas: POST /api/campanhas/tick, de minuto em minuto.
//
// Sem sessão. Quem autoriza é `Authorization: Bearer ${ROTINAS_SEGREDO}` — o
// mesmo segredo e a mesma conferência (tempo constante, segredo curto não
// vale) do relógio do assistente. Sem o segredo no servidor, ninguém passa.
//
// Chamar duas vezes no mesmo minuto não manda nada em dobro: quem já foi
// acordado tem o próximo despertador no futuro, e a trava de cada execução
// impede duas batidas de pegarem a mesma pessoa (ver campanhas/execucao.ts).
//
// Na mesma batida, os LEMBRETES do horário marcado (lembretes.ts): texto fixo,
// só para quem aceitou, e cada horário reivindicado antes de sair — a batida
// repetida não lembra ninguém duas vezes.

import { NextResponse } from 'next/server'
import { autorizado } from '@/servidor/assistente/rotinas'
import { tickCampanhas } from '@/servidor/campanhas/relogio'
import { tickLembretes } from '@/servidor/lembretes'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!autorizado(request.headers.get('authorization'), process.env.ROTINAS_SEGREDO)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const agora = new Date()
  const r = await tickCampanhas(agora)
  // Um relógio que quebra não leva o outro junto.
  const lembretes = await tickLembretes(agora).catch((e: unknown) => {
    console.error('[lembretes] a batida falhou:', e instanceof Error ? e.message : e)
    return { empresas: 0, enviados: 0, semAceite: 0, falhas: 1 }
  })
  return NextResponse.json(
    { ok: r.falhas === 0 && lembretes.falhas === 0, ...r, lembretes },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
