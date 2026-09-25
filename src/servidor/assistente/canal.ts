// Por onde o assistente fala: a boca, separada do cérebro.
//
// O laço da conversa e as rotinas não sabem se a mensagem sai pelo Z-API,
// pela API oficial da Meta ou por lugar nenhum. Sabem só `enviar(numero,
// texto)`. É isso que deixa trocar de fornecedor sem mexer em regra — e é o
// que deixa testar o laço inteiro sem mandar mensagem para ninguém.
//
// ── qual linha cada empresa usa ──────────────────────────────
// Uma instância Z-API é UM número de WhatsApp. Então a pergunta "por onde sai
// a mensagem da empresa X?" tem três respostas, nesta ordem:
//
//   1. A LINHA PRÓPRIA dela: instância e tokens que o dono colou na tela do
//      assistente, guardados no Agente — os tokens cifrados (ver
//      src/servidor/cifra.ts), decifrados só aqui, na hora de montar o canal.
//   2. A linha GLOBAL do servidor, das variáveis de ambiente — mas SÓ para a
//      empresa de `ZAPI_EMPRESA` (o piloto, de antes de existir linha
//      própria). Continua valendo, para não derrubar quem já estava ligado.
//   3. O canal de mentira: grava no histórico, não manda nada, e a tela diz.
//
// Por que a global não serve a todas: antes de 25/09 a segunda empresa que
// ligasse o assistente respondia os clientes dela pelo WhatsApp do piloto — o
// número de OUTRA loja. Nunca mais: sem linha própria e sem ser a do piloto,
// é o canal de mentira.
//
// Variáveis da linha global:
//   ZAPI_INSTANCIA      o id da instância (painel do Z-API → Instâncias)
//   ZAPI_TOKEN          o token DA INSTÂNCIA (vai na URL da chamada)
//   ZAPI_CLIENT_TOKEN   o "token de segurança" da CONTA (cabeçalho Client-Token)
//   ZAPI_URL            opcional; padrão https://api.z-api.io (vale para as duas)
//   ZAPI_EMPRESA        o ENDEREÇO (slug) da única empresa que fala por ela
//
// ── o que nunca sai daqui ────────────────────────────────────
// Token não vai para log. Erro do fornecedor vira "falhou (status N)" — o
// corpo da resposta do Z-API ecoa a URL chamada, e a URL tem o token dentro.

import { paraEnvio } from './telefone'
import { decifrar } from '../cifra'
import { comoOrg } from '../banco'

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

export type ConfigZapi = { url: string; instancia: string; token: string; clientToken: string }

const urlZapi = () => (process.env.ZAPI_URL ?? 'https://api.z-api.io').trim().replace(/\/$/, '')

function lerConfigZapi(): ConfigZapi | null {
  const instancia = (process.env.ZAPI_INSTANCIA ?? '').trim()
  const token = (process.env.ZAPI_TOKEN ?? '').trim()
  const clientToken = (process.env.ZAPI_CLIENT_TOKEN ?? '').trim()
  if (!instancia || !token) return null
  return { url: urlZapi(), instancia, token, clientToken }
}

// ── a linha própria, como mora no Agente ─────────────────────

/** As colunas do Agente que descrevem a linha própria. Tokens ainda cifrados. */
export type LinhaGuardada = {
  zapiInstancia: string | null
  zapiTokenCifrado: string | null
  zapiClientTokenCifrado: string | null
}

export const SELECT_LINHA = { zapiInstancia: true, zapiTokenCifrado: true, zapiClientTokenCifrado: true } as const

/**
 * O contexto da cifra de cada token: prende o texto cifrado à empresa E ao
 * campo. Copiado para outra empresa, ou trocado de coluna, não abre.
 */
export const contextoDoToken = (orgId: string, campo: 'zapi_token' | 'zapi_client_token') =>
  `agente:${orgId}:${campo}`

/**
 * A linha própria da empresa, decifrada e pronta para uso — ou nulo se ela
 * não tem, se está incompleta, ou se o token não abre com a chave deste
 * servidor (chave trocada, texto mexido). Nulo nunca vira "tenta assim mesmo".
 */
export function linhaPropria(orgId: string, g: LinhaGuardada | null | undefined): ConfigZapi | null {
  const instancia = g?.zapiInstancia?.trim()
  if (!instancia || !g?.zapiTokenCifrado) return null
  const token = decifrar(g.zapiTokenCifrado, contextoDoToken(orgId, 'zapi_token'))
  if (!token) {
    // O id da empresa é nosso; nada da credencial vai junto.
    console.error(`[canal] a linha própria da empresa ${orgId} não abre com a chave deste servidor`)
    return null
  }
  const clientToken = g.zapiClientTokenCifrado
    ? decifrar(g.zapiClientTokenCifrado, contextoDoToken(orgId, 'zapi_client_token'))
    : ''
  if (clientToken === null) {
    console.error(`[canal] o Client-Token da empresa ${orgId} não abre com a chave deste servidor`)
    return null
  }
  return { url: urlZapi(), instancia, token, clientToken }
}

/** Há Z-API configurado neste servidor? */
export const temZapi = () => lerConfigZapi() !== null

/** A empresa que fala pelo Z-API deste servidor — ver `ZAPI_EMPRESA` acima. */
export const empresaDoZapi = (): string | null =>
  (process.env.ZAPI_EMPRESA ?? '').trim().toLowerCase() || null

/** Esta empresa pode sair pela linha GLOBAL? Só a do piloto, com Z-API configurado. */
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

function canalFalso(): CanalFalso {
  guardado.__canalFalsoNorte ??= new CanalFalso()
  return guardado.__canalFalsoNorte
}

// ─────────────────────────────────────────────────────────────
// A ESCOLHA
// ─────────────────────────────────────────────────────────────

/** De onde sai a mensagem da empresa. A tela mostra; o teste confere. */
export type OrigemCanal = 'propria' | 'global' | 'nenhuma'

/**
 * A regra inteira, sem banco: linha própria > global (só a do piloto) >
 * mentira. Recebe o que já foi lido do Agente.
 */
export function escolherCanal(
  org: { id: string; slug: string },
  linha: LinhaGuardada | null | undefined,
  buscar: typeof fetch = fetch,
): { canal: Canal; origem: OrigemCanal } {
  const propria = linhaPropria(org.id, linha)
  if (propria) return { canal: new CanalZapi(propria, buscar), origem: 'propria' }
  const global = lerConfigZapi()
  if (global && zapiDa(org.slug)) return { canal: new CanalZapi(global, buscar), origem: 'global' }
  return { canal: canalFalso(), origem: 'nenhuma' }
}

/**
 * O canal DESTA empresa, lendo a linha dela no banco.
 *
 * Abre o próprio `comoOrg`: NÃO chame de dentro de outro (trava — ver
 * banco.ts). Quem já leu o Agente usa `escolherCanal` direto.
 */
export async function canalPara(org: { id: string; slug: string }): Promise<Canal> {
  const linha = await comoOrg(org.id, (db) =>
    db.agente.findUnique({ where: { orgId: org.id }, select: SELECT_LINHA }),
  )
  return escolherCanal(org, linha).canal
}
