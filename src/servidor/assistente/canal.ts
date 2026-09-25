// Por onde o assistente fala: a boca, separada do cérebro.
//
// O laço da conversa e as rotinas não sabem se a mensagem sai pelo Z-API,
// pela API oficial da Meta ou por lugar nenhum. Sabem só `enviar(numero,
// texto)`. É isso que deixa trocar de fornecedor sem mexer em regra — e é o
// que deixa testar o laço inteiro sem mandar mensagem para ninguém.
//
// ── nesta etapa: UMA instância Z-API, global ─────────────────
// As credenciais vêm de variáveis de ambiente do servidor, não do banco:
//
//   ZAPI_INSTANCIA      o id da instância (painel do Z-API → Instâncias)
//   ZAPI_TOKEN          o token DA INSTÂNCIA (vai na URL da chamada)
//   ZAPI_CLIENT_TOKEN   o "token de segurança" da CONTA (cabeçalho Client-Token)
//   ZAPI_URL            opcional; padrão https://api.z-api.io
//   ZAPI_EMPRESA        o ENDEREÇO (slug) da única empresa que fala por ela
//
// Consequência que precisa estar escrita: uma instância é UM número de
// WhatsApp, e o Z-API manda o webhook dela para UM endereço. Então, com
// credencial global, só UMA empresa conversa por vez — a do piloto. Para a
// segunda loja, a instância precisa morar no cadastro da empresa (campo novo
// no Agente, com o token guardado cifrado), e isso é migração de schema, que
// não é desta etapa.
//
// Por isso `ZAPI_EMPRESA`: sem ela, NENHUMA empresa fala pelo número. Antes de
// 25/09 a segunda empresa que ligasse o assistente respondia os clientes dela
// pelo WhatsApp do piloto — o número de outra loja. Agora as outras ficam no
// canal de mentira, e a tela delas diz que o WhatsApp é ligado com a gente.
//
// ── o que nunca sai daqui ────────────────────────────────────
// Token não vai para log. Erro do fornecedor vira "falhou (status N)" — o
// corpo da resposta do Z-API ecoa a URL chamada, e a URL tem o token dentro.

import { paraEnvio } from './telefone'

export type Envio = { ok: true; id?: string } | { ok: false; motivo: string }

export interface Canal {
  /** Nome para a tela e para o log: "Z-API", "teste". */
  readonly nome: string
  /** Falso no canal de mentira: a tela precisa saber que nada sai de verdade. */
  readonly real: boolean
  enviar(numero: string, texto: string): Promise<Envio>
}

// ─────────────────────────────────────────────────────────────
// Z-API
// ─────────────────────────────────────────────────────────────

type ConfigZapi = { url: string; instancia: string; token: string; clientToken: string }

function lerConfigZapi(): ConfigZapi | null {
  const instancia = (process.env.ZAPI_INSTANCIA ?? '').trim()
  const token = (process.env.ZAPI_TOKEN ?? '').trim()
  const clientToken = (process.env.ZAPI_CLIENT_TOKEN ?? '').trim()
  if (!instancia || !token) return null
  const url = (process.env.ZAPI_URL ?? 'https://api.z-api.io').trim().replace(/\/$/, '')
  return { url, instancia, token, clientToken }
}

/** Há Z-API configurado neste servidor? */
export const temZapi = () => lerConfigZapi() !== null

/** A empresa que fala pelo Z-API deste servidor — ver `ZAPI_EMPRESA` acima. */
export const empresaDoZapi = (): string | null =>
  (process.env.ZAPI_EMPRESA ?? '').trim().toLowerCase() || null

/** Esta empresa sai pelo WhatsApp de verdade? Só a do piloto, com Z-API configurado. */
export const zapiDa = (slug: string): boolean => temZapi() && empresaDoZapi() === slug.toLowerCase()

/** O WhatsApp não mostra mensagem gigante; o Z-API recusa acima disto. */
const MAXIMO_TEXTO = 4000

export class CanalZapi implements Canal {
  readonly nome = 'Z-API'
  readonly real = true

  constructor(
    private readonly cfg: ConfigZapi,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  async enviar(numero: string, texto: string): Promise<Envio> {
    const phone = paraEnvio(numero)
    if (!phone) return { ok: false, motivo: 'número inválido' }

    const endereco = `${this.cfg.url}/instances/${encodeURIComponent(this.cfg.instancia)}/token/${encodeURIComponent(this.cfg.token)}/send-text`
    try {
      const r = await this.buscar(endereco, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.cfg.clientToken ? { 'Client-Token': this.cfg.clientToken } : {}),
        },
        body: JSON.stringify({ phone, message: texto.slice(0, MAXIMO_TEXTO) }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) {
        console.error(`[canal] Z-API recusou o envio (status ${r.status})`)
        return { ok: false, motivo: `o Z-API recusou (status ${r.status})` }
      }
      const corpo = (await r.json().catch(() => ({}))) as { messageId?: string; id?: string }
      return { ok: true, id: corpo.messageId ?? corpo.id }
    } catch {
      console.error('[canal] Z-API não respondeu')
      return { ok: false, motivo: 'o Z-API não respondeu' }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// O CANAL DE MENTIRA
// ─────────────────────────────────────────────────────────────

/**
 * Grava o que "enviaria" numa lista, e não manda nada para ninguém.
 *
 * Serve a dois donos: os testes (que conferem o que saiu, palavra por
 * palavra) e o servidor sem Z-API configurado — onde a conversa continua
 * gravada no histórico e a tela avisa "sem canal", em vez de o sistema fingir
 * que mandou.
 */
export class CanalFalso implements Canal {
  readonly nome = 'teste'
  readonly real = false
  readonly enviadas: { numero: string; texto: string }[] = []

  constructor(private readonly falhar = false) {}

  async enviar(numero: string, texto: string): Promise<Envio> {
    if (this.falhar) return { ok: false, motivo: 'canal de teste configurado para falhar' }
    this.enviadas.push({ numero, texto })
    return { ok: true, id: `falso-${this.enviadas.length}` }
  }
}

// Um só por processo: a lista em memória do canal falso precisa ser a mesma
// entre o webhook e a tela, senão "o que ele teria mandado" some.
const guardado = globalThis as unknown as { __canalFalsoNorte?: CanalFalso }

/** O canal deste servidor: Z-API se configurado; o de mentira se não. */
export function canalPadrao(): Canal {
  const cfg = lerConfigZapi()
  if (cfg) return new CanalZapi(cfg)
  guardado.__canalFalsoNorte ??= new CanalFalso()
  return guardado.__canalFalsoNorte
}

/** O canal DESTA empresa: o Z-API só para a do piloto; as outras, o de mentira. */
export function canalPara(slug: string): Canal {
  const cfg = lerConfigZapi()
  if (cfg && zapiDa(slug)) return new CanalZapi(cfg)
  guardado.__canalFalsoNorte ??= new CanalFalso()
  return guardado.__canalFalsoNorte
}
