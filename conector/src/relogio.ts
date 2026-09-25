// O relógio do Norte, morando no conector.
//
// As campanhas acordam por minuto (`/api/campanhas/tick`) e as rotinas do
// assistente por hora (`/api/rotinas`: relatório das 8h e 20h, "vai faltar",
// cliente sumido). Alguém precisa bater nesses endereços. No Render isso é um
// cron job, que é pago; o conector já fica ligado 24 horas num servidor nosso
// — então ele bate.
//
// Só liga com ROTINAS_SEGREDO (o mesmo do Norte). Sem ele, o conector só
// conecta WhatsApp, e o relógio fica com quem já tinha (o cron do Render).
//
// O Norte aguenta ser chamado duas vezes: o tick e as rotinas são
// idempotentes (ver campanhas e rotinas.ts). Então, se o cron do Render e o
// conector baterem juntos, nada sai em dobro — só é trabalho a mais.

import { log, resumoDoErro } from './log'

const MINUTO = 60_000

export type Relogio = { parar: () => void }

/** Quanto falta para o próximo minuto cheio (+2 s de folga). Puro. */
export function ateOProximoMinuto(agora: number): number {
  return MINUTO - (agora % MINUTO) + 2_000
}

/** As rotinas batem só no minuto 1 de cada hora. Puro. */
export function horaDasRotinas(agora: Date): boolean {
  return agora.getUTCMinutes() === 1
}

export function ligarRelogio(norteUrl: string, segredo: string | undefined): Relogio | null {
  const s = (segredo ?? '').trim()
  if (s.length < 32) {
    log.info('relogio.desligado', { motivo: 'sem ROTINAS_SEGREDO' })
    return null
  }

  const bater = async (rota: string) => {
    try {
      const r = await fetch(`${norteUrl}${rota}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s}` },
        signal: AbortSignal.timeout(50_000),
      })
      if (!r.ok) log.aviso('relogio.falhou', { rota, status: r.status })
    } catch (e) {
      log.aviso('relogio.falhou', { rota, erro: resumoDoErro(e) })
    }
  }

  let parado = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const volta = () => {
    if (parado) return
    const agora = new Date()
    void bater('/api/campanhas/tick')
    if (horaDasRotinas(agora)) void bater('/api/rotinas')
    timer = setTimeout(volta, ateOProximoMinuto(Date.now()))
  }
  timer = setTimeout(volta, ateOProximoMinuto(Date.now()))
  log.info('relogio.ligado', {})

  return {
    parar: () => {
      parado = true
      if (timer) clearTimeout(timer)
    },
  }
}
