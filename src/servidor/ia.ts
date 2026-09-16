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
