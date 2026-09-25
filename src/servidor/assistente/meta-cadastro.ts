// O recado do fim do Cadastro incorporado da Meta (Embedded Signup v4).
//
// Mora num arquivo à parte porque é lido NO NAVEGADOR (a tela do assistente
// escuta o `postMessage` da janela da Meta) e também no servidor. Por isso é
// puro e não importa nada do Node — ./meta-regras.ts importa `node:crypto`, e
// o navegador não tem.

/** Id de conta, de número, de negócio na Meta: só dígitos. */
export const FORMATO_ID_META = /^\d{1,32}$/

export type FimDoCadastro =
  | { tipo: 'fim'; evento: string; wabaId: string; phoneNumberId: string | null; coexistencia: boolean }
  | { tipo: 'cancelado'; passo: string | null; erro: string | null }
  | { tipo: 'outro' }

/**
 * A mensagem que a janela da Meta manda para a nossa no fim do cadastro:
 *
 *   { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' | 'FINISH_ONLY_WABA' |
 *     'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' | 'CANCEL' | ...,
 *     data: { phone_number_id, waba_id, business_id } }
 *
 * No cancelamento, `data` traz o passo em que a pessoa parou, ou a mensagem
 * de erro (erro também chega como CANCEL). Na coexistência (número que já usa
 * o app WhatsApp Business) o id do número pode não vir — o servidor procura.
 *
 * Quem lê no navegador confere a ORIGEM antes (tem de ser facebook.com); o
 * servidor confere de novo o formato dos ids: o que vem do navegador é pedido.
 */
export function lerFimDoCadastro(dados: unknown): FimDoCadastro {
  let d: unknown = dados
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d)
    } catch {
      return { tipo: 'outro' }
    }
  }
  if (!d || typeof d !== 'object') return { tipo: 'outro' }
  const o = d as Record<string, unknown>
  if (o.type !== 'WA_EMBEDDED_SIGNUP') return { tipo: 'outro' }
  const evento = typeof o.event === 'string' ? o.event : ''
  const info = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {}
  const txt = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
  if (evento === 'CANCEL') {
    return { tipo: 'cancelado', passo: txt(info.current_step) || null, erro: txt(info.error_message).slice(0, 200) || null }
  }
  if (evento.startsWith('FINISH')) {
    const wabaId = txt(info.waba_id)
    const pnid = txt(info.phone_number_id)
    if (!FORMATO_ID_META.test(wabaId)) return { tipo: 'outro' }
    return {
      tipo: 'fim',
      evento,
      wabaId,
      phoneNumberId: FORMATO_ID_META.test(pnid) ? pnid : null,
      coexistencia: evento === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    }
  }
  return { tipo: 'outro' }
}

/** A origem do `postMessage` é da Meta? (www.facebook.com, web.facebook.com...) */
export function origemDaMeta(origem: string): boolean {
  try {
    const u = new URL(origem)
    return u.protocol === 'https:' && (u.hostname === 'facebook.com' || u.hostname.endsWith('.facebook.com'))
  } catch {
    return false
  }
}
