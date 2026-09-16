// O endereço que a hospedagem chama para saber se o Norte está de pé.
//
// Responde sem tocar no banco, de propósito. Se o banco cair, a resposta
// certa para "o processo está vivo?" continua sendo sim — e derrubar e subir
// o processo não conserta banco. Quem vigia o banco é o próprio Supabase e o
// monitor externo, que abre uma tela de verdade de tempos em tempos.
//
// Sem cache: é exatamente a resposta desta requisição que interessa.

import { NextResponse } from 'next/server'

const nasceu = Date.now()

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { ok: true, servico: 'norte', noArHa: Math.round((Date.now() - nasceu) / 1000) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
