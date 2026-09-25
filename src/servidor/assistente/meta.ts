// O WhatsApp OFICIAL: a parte que fala com a Meta (Graph API) e o canal.
//
// As regras sem rede (assinatura, leitura do webhook, janela, erros, modelos)
// estão em ./meta-regras.ts; aqui fica o que precisa de rede ou de banco:
//
//   • `Graph`     — o cliente: prazo por chamada, novas tentativas em 429/5xx
//                   com espera crescente, erro traduzido sem vazar token;
//   • as chamadas — mandar texto, mídia e modelo, marcar como lida, listar /
//                   criar / apagar modelos, inscrever o app na conta (WABA),
//                   registrar o número, trocar o código do cadastro por token;
//   • `CanalMeta` — o `Canal` (./canal.ts) da Cloud API, que sabe a JANELA DE
//                   24 HORAS de cada número e recusa texto livre fora dela.
//
// ── o token ──────────────────────────────────────────────────
// É o "token de integração de negócio" que a Meta entrega ao fim do cadastro
// incorporado: vale para a conta da LOJA, e com ele se manda mensagem em nome
// dela. Mora cifrado no Agente (contexto `agente:<org>:meta_token`), é aberto
// só na hora de montar o canal, e vai no cabeçalho Authorization — nunca na
// URL (a URL aparece em log de proxy; o cabeçalho não). A única exceção é a
// troca do código, que a Meta documenta com a chave do app na query: aquela
// URL não é logada em lugar nenhum.

import { comoOrg } from '../banco'
import type { Canal, Envio, Janela, MidiaParaEnvio, ModeloParaEnvio } from './canal'
import { chaveTelefone, paraEnvio } from './telefone'
import {
  GRAPH,
  corpoDeMidia,
  corpoDeModelo,
  corpoDeTexto,
  janelaAberta,
  lerErroGraph,
  lerModeloDaConta,
  semSegredo,
  type ConfigMeta,
  type ErroGraph,
  type ModeloNaConta,
} from './meta-regras'

// ─────────────────────────────────────────────────────────────
// O CLIENTE
// ─────────────────────────────────────────────────────────────

export type OpcoesGraph = {
  buscar?: typeof fetch
  /** Trocável nos testes: a espera entre tentativas. */
  dormir?: (ms: number) => Promise<void>
  /** Tentativas no total (a primeira conta). */
  tentativas?: number
  prazoMs?: number
}

export type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: ErroGraph }

const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class Graph {
  private readonly buscar: typeof fetch
  private readonly dormir: (ms: number) => Promise<void>
  private readonly tentativas: number
  private readonly prazoMs: number

  constructor(
    private readonly versao: string,
    private readonly token: string | null,
    o: OpcoesGraph = {},
  ) {
    this.buscar = o.buscar ?? fetch
    this.dormir = o.dormir ?? dormirDeVerdade
    this.tentativas = Math.max(1, o.tentativas ?? 3)
    this.prazoMs = o.prazoMs ?? 15_000
  }

  /**
   * Uma chamada à Graph API.
   *
   * Tenta de novo quando a Meta diz "devagar" (429, códigos de ritmo) ou está
   * fora do ar (5xx), esperando 0,5 s, 1,5 s... (ou o Retry-After dela, até 5
   * s). Queda de rede e prazo estourado só repetem em GET: um POST de mensagem
   * que sumiu no caminho pode ter chegado, e repetir mandaria duas vezes.
   */
  async pedir<T>(
    metodo: 'GET' | 'POST' | 'DELETE',
    caminho: string,
    p: { corpo?: unknown; query?: Record<string, string>; cabecalhos?: Record<string, string>; bruto?: BodyInit; semToken?: boolean } = {},
  ): Promise<Resposta<T>> {
    const q = p.query ? `?${new URLSearchParams(p.query).toString()}` : ''
    const url = caminho.startsWith('https://') ? `${caminho}${q}` : `${GRAPH}/${this.versao}/${caminho.replace(/^\//, '')}${q}`
    const cabecalhos: Record<string, string> = { ...(p.cabecalhos ?? {}) }
    if (this.token && !p.semToken && !cabecalhos.Authorization) cabecalhos.Authorization = `Bearer ${this.token}`
    if (p.corpo !== undefined) cabecalhos['content-type'] = 'application/json'

    let ultimo: ErroGraph = lerErroGraph(0, null)
    for (let tentativa = 1; tentativa <= this.tentativas; tentativa++) {
      let r: Response
      try {
        r = await this.buscar(url, {
          method: metodo,
          headers: cabecalhos,
          body: p.bruto ?? (p.corpo !== undefined ? JSON.stringify(p.corpo) : undefined),
          signal: AbortSignal.timeout(this.prazoMs),
        })
      } catch {
        ultimo = lerErroGraph(0, null)
        if (metodo !== 'GET' || tentativa === this.tentativas) return { ok: false, erro: ultimo }
        await this.dormir(espera(tentativa, null))
        continue
      }
      const json = (await r.json().catch(() => null)) as unknown
      if (r.ok) return { ok: true, dados: json as T }
      ultimo = lerErroGraph(r.status, json)
      if (!ultimo.repetir || tentativa === this.tentativas) return { ok: false, erro: ultimo }
      await this.dormir(espera(tentativa, r.headers.get('retry-after')))
    }
    return { ok: false, erro: ultimo }
  }
}

/** 0,5 s, 1,5 s, 4,5 s… — ou o que a Meta pediu, até 5 s (ninguém espera mais que isso numa requisição). */
function espera(tentativa: number, retryAfter: string | null): number {
  const pedido = Number(retryAfter)
  if (Number.isFinite(pedido) && pedido > 0) return Math.min(5_000, pedido * 1000)
  return Math.min(5_000, 500 * 3 ** (tentativa - 1))
}

const log = (texto: string) => console.error(semSegredo(texto))

// ─────────────────────────────────────────────────────────────
// AS CHAMADAS
// ─────────────────────────────────────────────────────────────

type RespostaEnvio = { messages?: { id?: string }[] }

/** POST /<número>/messages. O id que volta (wamid) é o da mensagem no WhatsApp. */
export async function enviarMensagem(g: Graph, phoneNumberId: string, corpo: unknown): Promise<Envio> {
  const r = await g.pedir<RespostaEnvio>('POST', `${phoneNumberId}/messages`, { corpo })
  if (!r.ok) return { ok: false, motivo: r.erro.mensagem, codigo: r.erro.codigo }
  return { ok: true, id: r.dados?.messages?.[0]?.id }
}

/**
 * Marca como lida (os dois tiques azuis) e, com `digitando`, mostra
 * "digitando…" até a resposta sair (ou 25 s). Falha aqui não importa a
 * ninguém: é cortesia, e não segura a conversa.
 */
export async function marcarLida(g: Graph, phoneNumberId: string, idMensagem: string, digitando = false): Promise<boolean> {
  const r = await g.pedir('POST', `${phoneNumberId}/messages`, {
    corpo: {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: idMensagem,
      ...(digitando ? { typing_indicator: { type: 'text' } } : {}),
    },
  })
  return r.ok
}

/** Os modelos da conta (até 5 páginas de 100 — mais que isso nenhuma loja tem). */
export async function listarModelos(g: Graph, wabaId: string): Promise<Resposta<ModeloNaConta[]>> {
  const todos: ModeloNaConta[] = []
  let depois: string | null = null
  for (let pagina = 0; pagina < 5; pagina++) {
    const query: Record<string, string> = {
      fields: 'id,name,status,category,language,components,rejected_reason',
      limit: '100',
      ...(depois ? { after: depois } : {}),
    }
    const r: Resposta<{ data?: unknown[]; paging?: { cursors?: { after?: string }; next?: string } }> = await g.pedir(
      'GET',
      `${wabaId}/message_templates`,
      { query },
    )
    if (!r.ok) return r
    for (const t of r.dados?.data ?? []) {
      const m = lerModeloDaConta(t)
      if (m) todos.push(m)
    }
    depois = r.dados?.paging?.next ? (r.dados.paging.cursors?.after ?? null) : null
    if (!depois) break
  }
  return { ok: true, dados: todos }
}

export async function criarModelo(g: Graph, wabaId: string, corpo: Record<string, unknown>): Promise<Resposta<{ id?: string; status?: string }>> {
  return g.pedir('POST', `${wabaId}/message_templates`, { corpo })
}

/** Apaga o modelo (todos os idiomas com esse nome; com `id`, só aquele). */
export async function apagarModelo(g: Graph, wabaId: string, nome: string, id?: string | null): Promise<Resposta<unknown>> {
  return g.pedir('DELETE', `${wabaId}/message_templates`, { query: { name: nome, ...(id ? { hsm_id: id } : {}) } })
}

/** Inscreve o app do Norte na conta da loja: sem isto, nenhum webhook dela chega aqui. */
export async function inscreverApp(g: Graph, wabaId: string): Promise<Resposta<unknown>> {
  return g.pedir('POST', `${wabaId}/subscribed_apps`)
}

/** O contrário, ao desconectar: a Meta para de mandar o webhook dessa conta para o Norte. */
export async function desinscreverApp(g: Graph, wabaId: string): Promise<Resposta<unknown>> {
  return g.pedir('DELETE', `${wabaId}/subscribed_apps`)
}

/** Registra o número na Cloud API (não na coexistência: lá ele já está no app). `pin` = verificação em duas etapas. */
export async function registrarNumero(g: Graph, phoneNumberId: string, pin: string): Promise<Resposta<unknown>> {
  return g.pedir('POST', `${phoneNumberId}/register`, { corpo: { messaging_product: 'whatsapp', pin } })
}

export type InfoNumero = {
  display_phone_number?: string
  verified_name?: string
  code_verification_status?: string
  status?: string
  platform_type?: string
  is_on_biz_app?: boolean
}

export async function lerNumero(g: Graph, phoneNumberId: string): Promise<Resposta<InfoNumero>> {
  return g.pedir('GET', phoneNumberId, {
    query: { fields: 'display_phone_number,verified_name,code_verification_status,status,platform_type,is_on_biz_app' },
  })
}

/** Os números da conta — a coexistência às vezes termina sem dizer qual. */
export async function numerosDaConta(g: Graph, wabaId: string): Promise<Resposta<{ id: string; display_phone_number?: string }[]>> {
  const r = await g.pedir<{ data?: { id?: string; display_phone_number?: string }[] }>('GET', `${wabaId}/phone_numbers`, {
    query: { fields: 'id,display_phone_number' },
  })
  if (!r.ok) return r
  return { ok: true, dados: (r.dados?.data ?? []).filter((n): n is { id: string } => typeof n.id === 'string') }
}

/**
 * Coexistência: a Meta pede que, em até 24 horas do cadastro, o parceiro peça
 * a sincronização da agenda e do histórico do app — senão a conta precisa
 * ser desfeita e refeita. O Norte pede as duas e NÃO guarda o que chega (os
 * webhooks `history` e `smb_app_state_sync` são descartados): o que vale para
 * o assistente começa da conexão em diante.
 */
export async function sincronizarCoexistencia(g: Graph, phoneNumberId: string): Promise<{ contatos: boolean; historico: boolean }> {
  const contatos = await g.pedir('POST', `${phoneNumberId}/smb_app_data`, {
    corpo: { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' },
  })
  const historico = await g.pedir('POST', `${phoneNumberId}/smb_app_data`, {
    corpo: { messaging_product: 'whatsapp', sync_type: 'history' },
  })
  return { contatos: contatos.ok, historico: historico.ok }
}

/**
 * O código do cadastro incorporado vira o token da loja. O código vale 30
 * segundos: esta é a PRIMEIRA coisa que a conexão faz. A chave do app vai só
 * daqui para a Meta, pelo servidor — o navegador nunca a vê.
 */
export async function trocarCodigo(cfg: ConfigMeta, code: string, o: OpcoesGraph = {}): Promise<Resposta<string>> {
  const g = new Graph(cfg.versao, null, { ...o, tentativas: 1 })
  const r = await g.pedir<{ access_token?: unknown }>('GET', 'oauth/access_token', {
    query: { client_id: cfg.appId, client_secret: cfg.appSecret, code },
  })
  if (!r.ok) return r
  const token = typeof r.dados?.access_token === 'string' ? r.dados.access_token : ''
  if (!token) return { ok: false, erro: lerErroGraph(502, null) }
  return { ok: true, dados: token }
}

/**
 * Sobe uma imagem para virar o CABEÇALHO de um modelo (a Meta pede um
 * "handle" do upload retomável, não um link). Duas chamadas: abrir a sessão
 * no app e mandar os bytes.
 */
export async function subirImagemDoModelo(
  cfg: ConfigMeta,
  token: string,
  arquivo: { nome: string; mime: string; bytes: Uint8Array },
  o: OpcoesGraph = {},
): Promise<Resposta<string>> {
  const g = new Graph(cfg.versao, token, o)
  const sessao = await g.pedir<{ id?: string }>('POST', `${cfg.appId}/uploads`, {
    query: { file_name: arquivo.nome.replace(/[^\w.-]/g, '_').slice(0, 80) || 'imagem', file_length: String(arquivo.bytes.byteLength), file_type: arquivo.mime },
  })
  if (!sessao.ok) return sessao
  const id = typeof sessao.dados?.id === 'string' ? sessao.dados.id : ''
  if (!/^upload:[A-Za-z0-9_=:-]+$/.test(id)) return { ok: false, erro: lerErroGraph(502, null) }
  const envio = await g.pedir<{ h?: string }>('POST', id, {
    // O upload retomável quer "OAuth", não "Bearer".
    cabecalhos: { Authorization: `OAuth ${token}`, file_offset: '0' },
    bruto: Buffer.from(arquivo.bytes),
  })
  if (!envio.ok) return envio
  const h = typeof envio.dados?.h === 'string' ? envio.dados.h : ''
  return h ? { ok: true, dados: h } : { ok: false, erro: lerErroGraph(502, null) }
}

// ─────────────────────────────────────────────────────────────
// A JANELA, DO BANCO
// ─────────────────────────────────────────────────────────────

/**
 * Quando ESTE número escreveu para a loja pela última vez: a mensagem mais
 * nova da pessoa (de: PESSOA) em qualquer conversa com a mesma chave de
 * telefone. Todo recebido passa por `processarMensagem`, que grava antes de
 * qualquer outra coisa — então a janela sai do que já está guardado.
 *
 * O que a LOJA escreveu pelo app (eco da coexistência) não conta: janela é
 * aberta pela pessoa, nunca por quem vende.
 *
 * Abre o próprio `comoOrg`: não chame de dentro de outro.
 */
export async function ultimaEntradaDe(orgId: string, telefone: string): Promise<Date | null> {
  const chave = chaveTelefone(telefone)
  if (!chave) return null
  return comoOrg(orgId, async (db) => {
    const conversas = await db.conversaAgente.findMany({
      where: { telefone: { endsWith: chave.slice(-8) } },
      select: { id: true, telefone: true },
    })
    const ids = conversas.filter((c) => chaveTelefone(c.telefone) === chave).map((c) => c.id)
    if (ids.length === 0) return null
    const m = await db.mensagemAgente.findFirst({
      where: { conversaId: { in: ids }, de: 'PESSOA' },
      orderBy: { criadaEm: 'desc' },
      select: { criadaEm: true },
    })
    return m?.criadaEm ?? null
  })
}

// ─────────────────────────────────────────────────────────────
// O CANAL
// ─────────────────────────────────────────────────────────────

export type LinhaOficial = { phoneNumberId: string; token: string; versao: string }

export type OpcoesCanalMeta = OpcoesGraph & {
  /** Quando o número escreveu por último. Padrão: o banco (`ultimaEntradaDe`). */
  ultimaEntrada?: (numero: string) => Promise<Date | null>
  agora?: () => Date
}

const FRASE_JANELA =
  'A pessoa não escreve para a loja há mais de 24 horas: no WhatsApp oficial, fora dessa janela só sai modelo aprovado.'

export class CanalMeta implements Canal {
  readonly nome = 'WhatsApp oficial (Meta)'
  readonly real = true
  private readonly g: Graph
  private readonly ultimaEntrada: (numero: string) => Promise<Date | null>
  private readonly agora: () => Date

  constructor(
    private readonly orgId: string,
    private readonly linha: LinhaOficial,
    o: OpcoesCanalMeta = {},
  ) {
    this.g = new Graph(linha.versao, linha.token, o)
    this.ultimaEntrada = o.ultimaEntrada ?? ((n) => ultimaEntradaDe(orgId, n))
    this.agora = o.agora ?? (() => new Date())
  }

  async janela(numero: string): Promise<Janela> {
    const ultimaEntrada = await this.ultimaEntrada(numero)
    return { aberta: janelaAberta(ultimaEntrada, this.agora()), ultimaEntrada }
  }

  /**
   * Texto livre: só dentro da janela. Fora, nem chama a Meta — a recusa
   * seria certa (131047), e cada chamada recusada conta no ritmo da conta.
   */
  async enviar(numero: string, texto: string): Promise<Envio> {
    const para = paraEnvio(numero)
    if (!para) return { ok: false, motivo: 'número inválido', codigo: 'numero' }
    if (!(await this.janela(para)).aberta) return { ok: false, motivo: FRASE_JANELA, codigo: 'janela_fechada' }
    return this.saida(await enviarMensagem(this.g, this.linha.phoneNumberId, corpoDeTexto(para, texto)))
  }

  async enviarMidia(numero: string, m: MidiaParaEnvio): Promise<Envio> {
    const para = paraEnvio(numero)
    if (!para) return { ok: false, motivo: 'número inválido', codigo: 'numero' }
    if (!(await this.janela(para)).aberta) return { ok: false, motivo: FRASE_JANELA, codigo: 'janela_fechada' }
    const r = this.saida(await enviarMensagem(this.g, this.linha.phoneNumberId, corpoDeMidia(para, m)))
    // Áudio não leva legenda na Cloud API: ela sai logo depois, como texto.
    if (r.ok && m.tipo === 'audio' && m.legenda?.trim()) {
      await enviarMensagem(this.g, this.linha.phoneNumberId, corpoDeTexto(para, m.legenda))
    }
    return r
  }

  /** Modelo aprovado sai a qualquer hora — é para isso que ele existe. */
  async enviarModelo(numero: string, m: ModeloParaEnvio): Promise<Envio> {
    const para = paraEnvio(numero)
    if (!para) return { ok: false, motivo: 'número inválido', codigo: 'numero' }
    return this.saida(await enviarMensagem(this.g, this.linha.phoneNumberId, corpoDeModelo(para, m)))
  }

  /** Cortesia depois de responder: tiques azuis na mensagem que ele tratou. */
  async marcarLida(idMensagem: string): Promise<boolean> {
    return marcarLida(this.g, this.linha.phoneNumberId, idMensagem)
  }

  private saida(r: Envio): Envio {
    if (!r.ok) log(`[canal] a Meta recusou o envio da empresa ${this.orgId}: ${r.motivo}`)
    return r
  }
}
