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
import { autorizado, rodarRotinas, rotinasDaHora, relogioSP, type Execucao } from '@/servidor/assistente/rotinas'
import { empresasComAgente } from '@/servidor/assistente/portaria'
import { canalPara, temZapi } from '@/servidor/assistente/canal'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!autorizado(request.headers.get('authorization'), process.env.ROTINAS_SEGREDO)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const agora = new Date()
  const total: Execucao = { hora: relogioSP(agora).hora, rotinas: rotinasDaHora(agora), empresas: 0, enviadas: 0, propostas: 0, falhas: 0 }
  if (total.rotinas.length === 0) return responder(total)

  // Cada empresa com o SEU canal: a linha própria dela, a global se for a do
  // piloto (ZAPI_EMPRESA), ou nenhuma. Sem linha de verdade, a empresa fica
  // de fora — ela falaria pelo número de outra loja, ou por lugar nenhum
  // fingindo que falou. A exceção é o servidor sem Z-API global (o laptop, a
  // demonstração): lá quem não tem linha própria roda no canal de mentira e
  // fica no histórico, como sempre foi.
  const semWhatsappNoServidor = !temZapi()
  for (const e of await empresasComAgente()) {
    try {
      const canal = await canalPara(e)
      if (!canal.real && !semWhatsappNoServidor) continue
      const r = await rodarRotinas(agora, { canal, empresas: async () => [e] })
      total.empresas += r.empresas
      total.enviadas += r.enviadas
      total.propostas += r.propostas
      total.falhas += r.falhas
    } catch (erro) {
      total.falhas++
      console.error(`[rotinas] empresa ${e.id} falhou:`, erro instanceof Error ? erro.message : erro)
    }
  }
  return responder(total)
}

const responder = (r: Execucao) =>
  NextResponse.json({ ok: r.falhas === 0, ...r }, { headers: { 'Cache-Control': 'no-store' } })
