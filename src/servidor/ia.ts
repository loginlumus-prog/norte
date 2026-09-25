// A chamada à IA, crua.
//
// Sem SDK, de propósito: é um POST só, com três cabeçalhos, e o projeto não
// ganha uma dependência para isso. Quem usa é o Guia (perguntarAoGuiaAcao),
// que manda o manual como sistema e a pergunta da pessoa — nunca dado do
// banco. Este arquivo não sabe o que está mandando; só leva e traz.
//
// ── o que sobe e o que não sobe ──────────────────────────────
// Erro HTTP vira uma frase só, em português, sem o corpo da resposta: o
// corpo do fornecedor traz nome de modelo, cota e às vezes pedaço da chave —
// nada disso é para a tela. Timeout de 20 segundos: quem está no balcão não
// espera mais que isso por uma resposta de ajuda.

const ENDERECO = 'https://api.anthropic.com/v1/messages'
const VERSAO = '2023-06-01'
export const MODELO_PADRAO = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 20_000

export const RECADO_FALHA = 'O guia não conseguiu responder agora. Tente de novo em instantes.'

/** Há chave no servidor? Sem ela o Guia responde só pelo manual. */
export function temChaveIA(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0
}

export type Mensagem = { papel: 'usuario' | 'assistente'; texto: string }

export type Resposta = {
  texto: string
  /** Tokens de entrada e de saída, para quem quiser medir o custo. */
  entrada: number
  saida: number
}

type CorpoDaResposta = {
  content?: { type: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

export async function perguntar(p: {
  sistema: string
  mensagens: Mensagem[]
  modelo?: string
  maxTokens?: number
}): Promise<Resposta> {
  const chave = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!chave) throw new Error(RECADO_FALHA)

  let resposta: globalThis.Response
  try {
    resposta = await fetch(ENDERECO, {
      method: 'POST',
      headers: {
        'x-api-key': chave,
        'anthropic-version': VERSAO,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: p.modelo ?? MODELO_PADRAO,
        max_tokens: p.maxTokens ?? 700,
        system: p.sistema,
        messages: p.mensagens.map((m) => ({
          role: m.papel === 'usuario' ? 'user' : 'assistant',
          content: m.texto,
        })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Rede fora, timeout, DNS: tudo a mesma frase. O detalhe vai para o log
    // do servidor, não para a tela.
    throw new Error(RECADO_FALHA)
  }

  if (!resposta.ok) {
    console.error(`[ia] o fornecedor respondeu ${resposta.status}`)
    throw new Error(RECADO_FALHA)
  }

  let corpo: CorpoDaResposta
  try {
    corpo = (await resposta.json()) as CorpoDaResposta
  } catch {
    throw new Error(RECADO_FALHA)
  }

  const texto = (corpo.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n')
    .trim()
  if (!texto) throw new Error(RECADO_FALHA)

  return {
    texto,
    entrada: corpo.usage?.input_tokens ?? 0,
    saida: corpo.usage?.output_tokens ?? 0,
  }
}

// ═════════════════════════════════════════════════════════════
// A CHAMADA COM FERRAMENTAS — a que o assistente do WhatsApp usa
// ═════════════════════════════════════════════════════════════
//
// A mesma chamada crua, com três coisas que o Guia não precisa:
//
// 1. FERRAMENTAS. O modelo pede ("tool_use"), o servidor decide se executa.
//    Esta função só leva e traz o pedido; quem confere permissão é o laço da
//    conversa (src/servidor/assistente/conversa.ts), DEPOIS do modelo.
//
// 2. CACHE. O sistema chega em blocos, e o bloco estável (regras do Norte,
//    jeito de falar, manual da loja) vem marcado com `cache_control`. O que
//    muda a cada mensagem — a hora, quem está falando — fica DEPOIS da marca.
//    Uma data no meio do bloco estável invalidaria o cache a cada minuto, e o
//    cache é o que decide se o agente se paga (ver custo-ia.ts).
//
// 3. O `fetch` INJETÁVEL. É por ele que os testes trocam a API de verdade
//    por uma de mentira e provam o laço inteiro sem chave e sem custo.
//
// O que sobe para a tela continua sendo só a frase de RECADO_FALHA_ASSISTENTE:
// corpo de erro do fornecedor nunca sai daqui.

export const RECADO_FALHA_ASSISTENTE =
  'Não consegui responder agora. Pode mandar de novo daqui a pouco?'

/** Um bloco de sistema. `cache` marca o fim da parte estável. */
export type BlocoSistema = { texto: string; cache?: boolean }

export type Ferramenta = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** O que a API devolve em `content`. Só os tipos que o laço trata têm forma. */
export type BlocoResposta =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown }

export type BlocoPergunta =
  | { type: 'text'; text: string }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export type MensagemAPI =
  | { role: 'user'; content: string | BlocoPergunta[] }
  | { role: 'assistant'; content: string | BlocoResposta[] }

export type Uso = {
  entrada: number
  saida: number
  cacheEscrita: number
  cacheLeitura: number
}

export type RespostaComFerramentas = {
  conteudo: BlocoResposta[]
  /** end_turn | tool_use | max_tokens | refusal | pause_turn ... */
  parada: string
  uso: Uso
  /** Quem de fato respondeu — com fallback, pode não ser o pedido. */
  modelo: string
}

/** Falha da IA com recado seguro para mostrar. O detalhe fica no log. */
export class FalhaIA extends Error {
  constructor(readonly status?: number) {
    super(RECADO_FALHA_ASSISTENTE)
    this.name = 'FalhaIA'
  }
}

// Modelos que aceitam `output_config.effort`. Mandar para o Haiku 4.5 dá 400.
const COM_ESFORCO = new Set([
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-fable-5',
  'claude-fable-5-1',
])

// Modelos em que a recusa por classificador de segurança pode acontecer e o
// próprio fornecedor oferece refazer em outro modelo, dentro da mesma
// chamada. Ligado por padrão onde existe: uma recusa no meio de um atendimento
// vira cliente sem resposta. O Sonnet 5, que é o padrão do Agente, não entra.
const COM_FALLBACK = new Set(['claude-opus-5', 'claude-fable-5-1'])

const TIMEOUT_ASSISTENTE_MS = 60_000

export async function conversarComFerramentas(p: {
  modelo: string
  sistema: BlocoSistema[]
  ferramentas: Ferramenta[]
  mensagens: MensagemAPI[]
  maxTokens?: number
  esforco?: 'low' | 'medium' | 'high'
  buscar?: typeof fetch
}): Promise<RespostaComFerramentas> {
  const chave = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!chave) throw new FalhaIA()

  const cabecalhos: Record<string, string> = {
    'x-api-key': chave,
    'anthropic-version': VERSAO,
    'content-type': 'application/json',
  }
  const corpo: Record<string, unknown> = {
    model: p.modelo,
    // Não é o tamanho da resposta: é o teto. O pensamento do modelo também
    // conta aqui, e cortar no meio custa uma segunda chamada inteira.
    max_tokens: p.maxTokens ?? 16_000,
    system: p.sistema.map((b) => ({
      type: 'text',
      text: b.texto,
      ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}),
    })),
    messages: p.mensagens,
    // Cache automático na cauda da conversa: dentro do laço de ferramentas,
    // cada volta reenvia tudo o que a anterior mandou.
    cache_control: { type: 'ephemeral' },
  }
  if (p.ferramentas.length > 0) corpo.tools = p.ferramentas
  if (p.esforco && COM_ESFORCO.has(p.modelo)) corpo.output_config = { effort: p.esforco }
  if (COM_FALLBACK.has(p.modelo)) {
    cabecalhos['anthropic-beta'] = 'server-side-fallback-2026-07-01'
    corpo.fallbacks = 'default'
  }

  let resposta: globalThis.Response
  try {
    resposta = await (p.buscar ?? fetch)(ENDERECO, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_ASSISTENTE_MS),
    })
  } catch {
    console.error('[ia] o fornecedor não respondeu')
    throw new FalhaIA()
  }

  if (!resposta.ok) {
    console.error(`[ia] o fornecedor respondeu ${resposta.status}`)
    throw new FalhaIA(resposta.status)
  }

  let json: {
    content?: BlocoResposta[]
    stop_reason?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  try {
    json = await resposta.json()
  } catch {
    throw new FalhaIA()
  }

  return {
    // O bloco `fallback` é só marcador de auditoria do fornecedor: não volta
    // na próxima chamada.
    conteudo: (json.content ?? []).filter((b) => b.type !== 'fallback'),
    parada: json.stop_reason ?? 'end_turn',
    modelo: json.model ?? p.modelo,
    uso: {
      entrada: json.usage?.input_tokens ?? 0,
      saida: json.usage?.output_tokens ?? 0,
      cacheEscrita: json.usage?.cache_creation_input_tokens ?? 0,
      cacheLeitura: json.usage?.cache_read_input_tokens ?? 0,
    },
  }
}
