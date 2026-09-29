// O relógio do assistente: POST /api/rotinas, chamado de hora em hora por um
// cron externo (ver render.yaml). E o da escola: a mensalidade do mês e o
// aviso ao responsável, que rodam toda hora (ver `mensalidadesDaHora`).
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
import { empresasComEscola } from '@/servidor/assistente/portaria'
import { gerarMensalidadesDaEmpresa } from '@/servidor/mensalidades'
import { tickAvisosMensalidade, type BatidaAvisos } from '@/servidor/avisos-mensalidade'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!autorizado(request.headers.get('authorization'), process.env.ROTINAS_SEGREDO)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const agora = new Date()
  const total: Execucao = { hora: relogioSP(agora).hora, rotinas: rotinasDaHora(agora), empresas: 0, enviadas: 0, propostas: 0, falhas: 0 }

  // Toda hora, antes do resto: a mensalidade do mês de cada escola (a que
  // ninguém abriu no dia 1º), e o aviso dela ao responsável. Gerar é
  // idempotente (mensalidades.ts) e o aviso é reivindicado antes de sair
  // (avisos-mensalidade.ts): a hora repetida não cobra nem avisa duas vezes.
  // Um relógio que quebra não leva os outros junto.
  const escola = await mensalidadesDaHora(agora)
  if (total.rotinas.length === 0) return responder(total, escola)

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
  return responder(total, escola)
}

type DaEscola = { geradas: number; avisos: BatidaAvisos; falhas: number }

async function mensalidadesDaHora(agora: Date): Promise<DaEscola> {
  const r: DaEscola = { geradas: 0, avisos: { empresas: 0, enviados: 0, semAceite: 0, falhas: 0 }, falhas: 0 }
  try {
    for (const e of await empresasComEscola()) {
      try {
        r.geradas += await gerarMensalidadesDaEmpresa(e.id, agora)
      } catch (erro) {
        r.falhas++
        console.error(`[mensalidades] empresa ${e.id} falhou:`, erro instanceof Error ? erro.message : erro)
      }
    }
  } catch (erro) {
    r.falhas++
    console.error('[mensalidades] a lista de escolas falhou:', erro instanceof Error ? erro.message : erro)
  }
  r.avisos = await tickAvisosMensalidade(agora).catch((erro: unknown) => {
    console.error('[avisos] a batida falhou:', erro instanceof Error ? erro.message : erro)
    return { empresas: 0, enviados: 0, semAceite: 0, falhas: 1 }
  })
  return r
}

const responder = (r: Execucao, escola: DaEscola) =>
  NextResponse.json(
    { ok: r.falhas === 0 && escola.falhas === 0 && escola.avisos.falhas === 0, ...r, escola },
    { headers: { 'Cache-Control': 'no-store' } },
  )
