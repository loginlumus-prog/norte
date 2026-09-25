// O Norte falando com o CONECTOR — o serviço à parte (pasta conector/) que
// segura o WhatsApp de cada loja conectado por QR Code, sem Z-API no meio.
//
// ── por que um serviço à parte ───────────────────────────────
// O WhatsApp Web é uma conexão aberta o tempo todo. O Norte é um site: pode
// dormir, reiniciar a cada deploy, rodar em várias cópias. Quem segura a
// conexão é o conector, sempre ligado numa máquina pequena; o Norte pede a
// ele "gera o QR", "manda esta mensagem", e recebe dele o que chegou.
//
// ── as duas mãos, e o segredo de cada uma ────────────────────
//   Norte → conector: `Authorization: Bearer ${CONECTOR_SEGREDO}`.
//   conector → Norte: HMAC-SHA256 de carimbo + método + caminho + corpo, com o
//     mesmo segredo, e o carimbo vale cinco minutos. O caminho tem o id da
//     empresa: assinado para a A não abre a porta da B.
//
// Variáveis:
//   CONECTOR_URL      onde o conector escuta, ex.: http://10.0.0.5:3200 (rede
//                     privada) ou https://conector.norte.app
//   CONECTOR_SEGREDO  32+ caracteres, o MESMO configurado no conector
//
// Sem as duas, a conexão por QR Code fica desligada neste servidor e a tela
// diz isso — nada finge funcionar.
//
// A conta do HMAC é IGUAL à de conector/src/assinatura.ts (dois programas,
// nenhum pacote em comum). tests/whatsapp-proprio.test.ts confere que um
// aceita o que o outro assina.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const CABECALHO_CARIMBO = 'x-norte-carimbo'
export const CABECALHO_ASSINATURA = 'x-norte-assinatura'
const MINIMO_SEGREDO = 32
/** Quanto o relógio dos dois lados pode discordar — e quanto um pedido assinado vale. */
export const TOLERANCIA_SEGUNDOS = 300

export type ConfigConector = { url: string; segredo: string }

export function lerConfigConector(env: Record<string, string | undefined> = process.env): ConfigConector | null {
  const url = (env.CONECTOR_URL ?? '').trim().replace(/\/+$/, '')
  const segredo = (env.CONECTOR_SEGREDO ?? '').trim()
  if (!url || segredo.length < MINIMO_SEGREDO) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  } catch {
    return null
  }
  return { url, segredo }
}

/** A conexão por QR Code está ligada neste servidor? */
export const temConector = () => lerConfigConector() !== null

/** Só o segredo, para conferir o que o conector manda (o endereço não importa aí). */
const segredoDoAmbiente = () => {
  const s = (process.env.CONECTOR_SEGREDO ?? '').trim()
  return s.length >= MINIMO_SEGREDO ? s : null
}

// ─────────────────────────────────────────────────────────────
// A ASSINATURA
// ─────────────────────────────────────────────────────────────

const base = (carimbo: string, metodo: string, caminho: string, corpo: string) =>
  `${carimbo}.${metodo.toUpperCase()}.${caminho}.${corpo}`

export function assinarPedido(segredo: string, metodo: string, caminho: string, corpo: string, agora = Date.now()) {
  const carimbo = String(Math.floor(agora / 1000))
  const assinatura = 'v1=' + createHmac('sha256', segredo).update(base(carimbo, metodo, caminho, corpo)).digest('hex')
  return { carimbo, assinatura }
}

export type PedidoAssinado = {
  metodo: string
  caminho: string
  corpo: string
  carimbo: string | null
  assinatura: string | null
}

/**
 * O pedido veio do conector, agora? Assinatura certa, carimbo dentro de
 * cinco minutos (para trás E para a frente). Sem segredo no servidor,
 * ninguém passa. Comparação em tempo constante.
 */
export function conferirAssinatura(
  p: PedidoAssinado,
  segredo: string | null = segredoDoAmbiente(),
  agora = Date.now(),
): boolean {
  if (!segredo || segredo.length < MINIMO_SEGREDO) return false
  if (!p.carimbo || !/^\d{9,11}$/.test(p.carimbo) || !p.assinatura) return false
  if (Math.abs(agora / 1000 - Number(p.carimbo)) > TOLERANCIA_SEGUNDOS) return false
  const certa = 'v1=' + createHmac('sha256', segredo).update(base(p.carimbo, p.metodo, p.caminho, p.corpo)).digest('hex')
  const a = Buffer.from(certa)
  const b = Buffer.from(p.assinatura)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * O pedido que chegou numa rota do Norte veio do conector? O caminho é o que
 * o Norte recebeu (sem domínio, sem ?): é o mesmo que o conector assinou.
 */
export function veioDoConector(request: Request, corpo: string, agora = Date.now()): boolean {
  return conferirAssinatura(
    {
      metodo: request.method,
      caminho: new URL(request.url).pathname,
      corpo,
      carimbo: request.headers.get(CABECALHO_CARIMBO),
      assinatura: request.headers.get(CABECALHO_ASSINATURA),
    },
    segredoDoAmbiente(),
    agora,
  )
}

// ─────────────────────────────────────────────────────────────
// PEDIR AO CONECTOR
// ─────────────────────────────────────────────────────────────

export type EstadoQr = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado' | 'expulso'

/** O que o conector diz de uma empresa. O QR é uma imagem (data URL PNG). */
export type RetratoQr = { estado: EstadoQr; qr: string | null; numero: string | null; motivo: string | null }

const ESTADOS: EstadoQr[] = ['desconectado', 'aguardando_qr', 'conectando', 'conectado', 'expulso']

function lerRetrato(j: unknown): RetratoQr | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  if (!ESTADOS.includes(o.estado as EstadoQr)) return null
  const qr = typeof o.qr === 'string' && o.qr.startsWith('data:image/png;base64,') ? o.qr : null
  return {
    estado: o.estado as EstadoQr,
    qr,
    numero: typeof o.numero === 'string' ? o.numero.slice(0, 40) : null,
    motivo: typeof o.motivo === 'string' ? o.motivo.slice(0, 200) : null,
  }
}

/**
 * Um pedido ao conector. Nulo quando ele não respondeu — quem chama diz "o
 * conector está fora do ar", sem detalhe (o detalhe teria o endereço).
 */
export async function pedirAoConector(
  cfg: ConfigConector,
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo?: unknown,
  opcoes: { buscar?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ status: number; json: unknown } | null> {
  const buscar = opcoes.buscar ?? fetch
  try {
    const r = await buscar(`${cfg.url}${caminho}`, {
      method: metodo,
      headers: {
        authorization: `Bearer ${cfg.segredo}`,
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 10_000),
      cache: 'no-store',
    })
    return { status: r.status, json: await r.json().catch(() => null) }
  } catch {
    console.error('[conector] não respondeu')
    return null
  }
}

const caminhoDa = (orgId: string, acao = '') => `/sessoes/${encodeURIComponent(orgId)}${acao ? `/${acao}` : ''}`

/** Liga (ou retoma) a conexão da empresa. Nulo = conector fora do ar. */
export async function iniciarNoConector(cfg: ConfigConector, orgId: string, buscar?: typeof fetch) {
  const r = await pedirAoConector(cfg, 'POST', caminhoDa(orgId, 'iniciar'), undefined, { buscar, timeoutMs: 20_000 })
  return r && r.status === 200 ? lerRetrato(r.json) : null
}

export async function retratoNoConector(cfg: ConfigConector, orgId: string, buscar?: typeof fetch) {
  const r = await pedirAoConector(cfg, 'GET', caminhoDa(orgId), undefined, { buscar, timeoutMs: 8_000 })
  return r && r.status === 200 ? lerRetrato(r.json) : null
}

export async function sairNoConector(cfg: ConfigConector, orgId: string, buscar?: typeof fetch) {
  const r = await pedirAoConector(cfg, 'POST', caminhoDa(orgId, 'sair'), undefined, { buscar, timeoutMs: 20_000 })
  return r !== null && r.status === 200
}

/** Pedido de envio: texto, ou mídia. O ritmo e a fila são do conector. */
export async function enviarPeloConector(
  cfg: ConfigConector,
  orgId: string,
  corpo: { numero: string; texto: string } | { numero: string; midia: unknown },
  buscar?: typeof fetch,
) {
  // Folga larga: o conector espera a vez na fila e o "digitando…" antes de
  // mandar — é esse ritmo que protege o número da loja.
  return pedirAoConector(cfg, 'POST', caminhoDa(orgId, 'enviar'), corpo, { buscar, timeoutMs: 120_000 })
}
