// Por onde o assistente fala: a boca, separada do cérebro.
//
// O laço da conversa e as rotinas não sabem se a mensagem sai pelo Z-API,
// pela API oficial da Meta ou por lugar nenhum. Sabem só `enviar(numero,
// texto)`. É isso que deixa trocar de fornecedor sem mexer em regra — e é o
// que deixa testar o laço inteiro sem mandar mensagem para ninguém.
//
// ── qual linha cada empresa usa ──────────────────────────────
// A pergunta "por onde sai a mensagem da empresa X?" tem cinco respostas,
// nesta ordem:
//
//  -1. O WHATSAPP OFICIAL (Meta, Cloud API): a loja conectou pelo Cadastro
//      incorporado da Meta na tela do assistente (`canal = META`), e este
//      servidor tem o app da Meta configurado (ver ./meta-regras.ts). É o
//      caminho sem risco de banimento por "aparelho não oficial" — e o único
//      com a JANELA DE 24 HORAS: fora dela, só modelo aprovado
//      (`enviarModelo`). Ver ./meta.ts.
//   0. O QR CODE: o WhatsApp da loja conectado direto no Norte, pelo conector
//      (pasta conector/, ver ./conector.ts) — sem Z-API, sem mensalidade de
//      terceiro. Vale quando o Agente está em `canal = PROPRIO` (o celular
//      leu o QR) E este servidor tem o conector configurado.
//   1. A LINHA PRÓPRIA no Z-API: instância e tokens que o dono colou na tela
//      do assistente, guardados no Agente — os tokens cifrados (ver
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

import type { CanalAgente } from '@prisma/client'
import { paraEnvio } from './telefone'
import { decifrar } from '../cifra'
import { comoOrg } from '../banco'
import { enviarPeloConector, lerConfigConector, type ConfigConector } from './conector'
import { CanalMeta } from './meta'
import { lerConfigMeta } from './meta-regras'

/**
 * `codigo` é para quem decide o que fazer depois — a frase (`motivo`) é
 * para a tela e o log. 'janela_fechada': WhatsApp oficial, a pessoa não
 * escreveu nas últimas 24 horas, e texto livre não sai (só modelo aprovado).
 */
export type CodigoFalha = 'janela_fechada' | 'modelo' | 'credencial' | 'limite' | 'numero' | 'fornecedor'
export type Envio = { ok: true; id?: string } | { ok: false; motivo: string; codigo?: CodigoFalha }

/**
 * Um modelo (template) aprovado na conta da Meta, pronto para sair: o nome,
 * o idioma e o texto de cada variável do corpo, na ordem ({{1}}, {{2}}...).
 */
export type ModeloParaEnvio = { nome: string; idioma: string; variaveis: string[] }

/** A janela de atendimento com um número (só existe no WhatsApp oficial). */
export type Janela = { aberta: boolean; ultimaEntrada: Date | null }

export interface Canal {
  /** Nome para a tela e para o log: "Z-API", "teste". */
  readonly nome: string
  /** Falso no canal de mentira: a tela precisa saber que nada sai de verdade. */
  readonly real: boolean
  enviar(numero: string, texto: string): Promise<Envio>
  /**
   * Foto, vídeo ou áudio (campanhas). OPCIONAL: canal que não sabe mandar
   * mídia não implementa, e a campanha manda só a legenda como texto.
   * `url` é um endereço público e assinado, com prazo (/api/midia/...): o
   * fornecedor busca o arquivo lá. `comoGravado` = áudio como nota de voz.
   */
  enviarMidia?(numero: string, m: MidiaParaEnvio): Promise<Envio>
  /**
   * Só no WhatsApp OFICIAL. A Meta só entrega texto livre a quem escreveu
   * para a loja nas últimas 24 horas; fora disso, só modelo aprovado. Canal
   * sem este método não tem janela (Z-API, QR Code, mentira).
   */
  janela?(numero: string): Promise<Janela>
  /** Manda um modelo aprovado. Só no WhatsApp oficial. */
  enviarModelo?(numero: string, m: ModeloParaEnvio): Promise<Envio>
}

/**
 * Manda o texto; se o canal disser que a janela de 24 horas fechou e houver
 * um modelo aprovado para o caso, manda o modelo no lugar.
 *
 * É a regra inteira do "fora da janela" num lugar só: as rotinas (relatório
 * às 8h para a dona que não escreve desde ontem), o aviso à equipe, a
 * mensagem de teste e as campanhas passam por aqui. Sem modelo, a falha volta
 * como veio — com `codigo: 'janela_fechada'` —, e quem chamou decide.
 */
export async function enviarOuModelo(
  canal: Canal,
  numero: string,
  texto: string,
  modelo?: ModeloParaEnvio | null,
): Promise<Envio & { porModelo?: boolean }> {
  const r = await canal.enviar(numero, texto)
  if (r.ok || r.codigo !== 'janela_fechada' || !modelo || !canal.enviarModelo) return r
  const m = await canal.enviarModelo(numero, modelo)
  return m.ok ? { ...m, porModelo: true } : m
}

export type MidiaParaEnvio = {
  tipo: 'imagem' | 'video' | 'audio'
  url: string
  legenda?: string
  comoGravado?: boolean
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

/**
 * As colunas do Agente que descrevem as linhas próprias (Z-API e Meta).
 * Tokens ainda cifrados. As da Meta são opcionais no tipo: quem monta a
 * linha à mão (os testes, as telas antigas) não precisa saber delas.
 */
export type LinhaGuardada = {
  zapiInstancia: string | null
  zapiTokenCifrado: string | null
  zapiClientTokenCifrado: string | null
  metaPhoneNumberId?: string | null
  metaWabaId?: string | null
  metaTokenCifrado?: string | null
}

export const SELECT_LINHA = {
  zapiInstancia: true,
  zapiTokenCifrado: true,
  zapiClientTokenCifrado: true,
  metaPhoneNumberId: true,
  metaWabaId: true,
  metaTokenCifrado: true,
} as const

/**
 * O contexto da cifra de cada token: prende o texto cifrado à empresa E ao
 * campo. Copiado para outra empresa, ou trocado de coluna, não abre.
 */
export const contextoDoToken = (orgId: string, campo: 'zapi_token' | 'zapi_client_token' | 'meta_token') =>
  `agente:${orgId}:${campo}`

/** A linha oficial da empresa, decifrada — ou nulo (sem, incompleta, ou o token não abre aqui). */
export function linhaMeta(
  orgId: string,
  g: LinhaGuardada | null | undefined,
): { phoneNumberId: string; wabaId: string | null; token: string } | null {
  const phoneNumberId = g?.metaPhoneNumberId?.trim()
  if (!phoneNumberId || !g?.metaTokenCifrado) return null
  const token = decifrar(g.metaTokenCifrado, contextoDoToken(orgId, 'meta_token'))
  if (!token) {
    // O id da empresa é nosso; nada da credencial vai junto.
    console.error(`[canal] o token da Meta da empresa ${orgId} não abre com a chave deste servidor`)
    return null
  }
  return { phoneNumberId, wabaId: g.metaWabaId?.trim() || null, token }
}

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
// O QR CODE (o conector do próprio Norte)
// ─────────────────────────────────────────────────────────────

/**
 * Manda pelo conector (ver ./conector.ts). O ritmo — fila por número,
 * intervalo sorteado, "digitando…", tetos por minuto e por dia — é do
 * conector: é lá que ele protege o número da loja, qualquer que seja quem
 * pediu o envio.
 */
export class CanalProprio implements Canal {
  readonly nome = 'WhatsApp (QR Code)'
  readonly real = true

  constructor(
    private readonly orgId: string,
    private readonly cfg: ConfigConector,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  private async pedir(corpo: { numero: string; texto: string } | { numero: string; midia: MidiaParaEnvio }): Promise<Envio> {
    const r = await enviarPeloConector(this.cfg, this.orgId, corpo, this.buscar)
    if (!r) return { ok: false, motivo: 'o conector do WhatsApp não respondeu' }
    const j = (r.json ?? {}) as { ok?: unknown; id?: unknown; motivo?: unknown }
    if (r.status === 200 && j.ok === true) return { ok: true, id: typeof j.id === 'string' ? j.id : undefined }
    // O motivo do conector é frase nossa, sem segredo nem número inteiro.
    const motivo = typeof j.motivo === 'string' ? j.motivo.slice(0, 200) : `o conector recusou (status ${r.status})`
    console.error(`[canal] o conector recusou o envio da empresa ${this.orgId} (status ${r.status})`)
    return { ok: false, motivo }
  }

  async enviar(numero: string, texto: string): Promise<Envio> {
    const n = paraEnvio(numero)
    if (!n) return { ok: false, motivo: 'número inválido' }
    return this.pedir({ numero: n, texto: texto.slice(0, MAXIMO_TEXTO) })
  }

  async enviarMidia(numero: string, midia: MidiaParaEnvio): Promise<Envio> {
    const n = paraEnvio(numero)
    if (!n) return { ok: false, motivo: 'número inválido' }
    return this.pedir({ numero: n, midia })
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

/**
 * De onde sai a mensagem da empresa. A tela mostra; o teste confere.
 * 'meta' = o WhatsApp oficial (Cloud API); 'qr' = o WhatsApp conectado pelo
 * QR Code; 'propria' = a instância Z-API da empresa; 'global' = o Z-API do
 * servidor (só o piloto).
 */
export type OrigemCanal = 'meta' | 'qr' | 'propria' | 'global' | 'nenhuma'

/** O que a escolha lê do Agente: a linha do Z-API e, se leu, o canal ligado. */
export type LinhaDoAgente = LinhaGuardada & { canal?: CanalAgente | null }

/**
 * A regra inteira, sem banco: oficial (Meta) > QR Code > linha própria no
 * Z-API > global (só a do piloto) > mentira. Recebe o que já foi lido do
 * Agente.
 *
 * O oficial só vale com o app da Meta configurado AQUI (as variáveis META_*),
 * e o QR só com o conector: sem eles, a empresa cai para o que tiver de Z-API
 * (ou para o de mentira, e a tela diz). Uma variável esquecida no deploy não
 * derruba nada — só troca o caminho, e a tela mostra qual.
 */
export function escolherCanal(
  org: { id: string; slug: string },
  linha: LinhaDoAgente | null | undefined,
  buscar: typeof fetch = fetch,
): { canal: Canal; origem: OrigemCanal } {
  if (linha?.canal === 'META') {
    const cfg = lerConfigMeta()
    const oficial = cfg ? linhaMeta(org.id, linha) : null
    if (cfg && oficial) {
      return {
        canal: new CanalMeta(org.id, { phoneNumberId: oficial.phoneNumberId, token: oficial.token, versao: cfg.versao }, { buscar }),
        origem: 'meta',
      }
    }
  }
  if (linha?.canal === 'PROPRIO') {
    const conector = lerConfigConector()
    if (conector) return { canal: new CanalProprio(org.id, conector, buscar), origem: 'qr' }
  }
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
    // o canal ligado entra junto: é ele que diz se a empresa está no QR Code
    db.agente.findUnique({ where: { orgId: org.id }, select: { ...SELECT_LINHA, canal: true } }),
  )
  return escolherCanal(org, linha).canal
}
