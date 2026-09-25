// As variáveis do conector, lidas uma vez, conferidas na partida.
//
//   CONECTOR_SEGREDO   o MESMO valor configurado no Norte. Pelo menos 32
//                      caracteres. Gerar:
//                        node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
//   NORTE_URL          o endereço do Norte, ex.: https://norte.app — para onde
//                      vão as mensagens recebidas e onde mora a sessão cifrada
//   PORT               a porta HTTP deste serviço (padrão 3200)
//   HOST               onde escutar (padrão 0.0.0.0)
//   ROTINAS_SEGREDO    opcional: o MESMO do Norte. Com ele, o conector também
//                      é o relógio — bate nas campanhas a cada minuto e nas
//                      rotinas do assistente a cada hora (ver relogio.ts), e
//                      o cron pago do Render deixa de ser necessário.
//   PASTA_DADOS        onde guardar a LISTA de empresas conectadas (só ids,
//                      nenhuma credencial), para religar tudo depois de
//                      reiniciar. Padrão ./dados
//
// O ritmo (ver ritmo.ts), todos opcionais:
//   RITMO_INTERVALO_MIN_MS, RITMO_INTERVALO_MAX_MS, RITMO_POR_MINUTO,
//   RITMO_POR_DIA, RITMO_POR_CONTATO_MINUTO, FILA_MAXIMA
//   IDADE_MAXIMA_MIN   mensagem recebida mais velha que isto é ignorada (padrão 360)
//
// PURO: recebe o ambiente como argumento.

import { MINIMO_SEGREDO } from './assinatura'
import { RITMO_PADRAO, type ConfigRitmo } from './ritmo'

export type Config = {
  segredo: string
  norteUrl: string
  porta: number
  host: string
  pastaDados: string
  ritmo: ConfigRitmo
  filaMaxima: number
  idadeMaximaMs: number
}

const inteiro = (v: string | undefined, padrao: number, min: number, max: number) => {
  const n = Number(v)
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao
}

export function lerConfig(env: Record<string, string | undefined>): { ok: true; config: Config } | { ok: false; erros: string[] } {
  const erros: string[] = []
  const segredo = (env.CONECTOR_SEGREDO ?? '').trim()
  if (segredo.length < MINIMO_SEGREDO) erros.push(`CONECTOR_SEGREDO falta ou tem menos de ${MINIMO_SEGREDO} caracteres.`)

  const norteUrl = (env.NORTE_URL ?? '').trim().replace(/\/+$/, '')
  try {
    const u = new URL(norteUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
    // Em produção a sessão e as mensagens viajam por aqui: sem TLS, só na
    // própria máquina (o laptop, ou o Norte na mesma rede privada).
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.internal')
    if (u.protocol === 'http:' && !local) erros.push('NORTE_URL precisa ser https:// (só localhost pode ser http://).')
  } catch {
    erros.push('NORTE_URL falta ou não é um endereço (ex.: https://norte.app).')
  }

  const min = inteiro(env.RITMO_INTERVALO_MIN_MS, RITMO_PADRAO.intervaloMinMs, 1_000, 120_000)
  const max = Math.max(min, inteiro(env.RITMO_INTERVALO_MAX_MS, RITMO_PADRAO.intervaloMaxMs, 1_000, 300_000))

  const config: Config = {
    segredo,
    norteUrl,
    porta: inteiro(env.PORT, 3200, 1, 65535),
    host: (env.HOST ?? '').trim() || '0.0.0.0',
    pastaDados: (env.PASTA_DADOS ?? '').trim() || './dados',
    ritmo: {
      intervaloMinMs: min,
      intervaloMaxMs: max,
      porMinuto: inteiro(env.RITMO_POR_MINUTO, RITMO_PADRAO.porMinuto, 1, 60),
      porDia: inteiro(env.RITMO_POR_DIA, RITMO_PADRAO.porDia, 1, 5_000),
      porContatoMinuto: inteiro(env.RITMO_POR_CONTATO_MINUTO, RITMO_PADRAO.porContatoMinuto, 1, 30),
    },
    filaMaxima: inteiro(env.FILA_MAXIMA, 50, 1, 1_000),
    idadeMaximaMs: inteiro(env.IDADE_MAXIMA_MIN, 360, 1, 7 * 24 * 60) * 60_000,
  }
  return erros.length ? { ok: false, erros } : { ok: true, config }
}
