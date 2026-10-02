// Mandar e-mail.
//
// ── um fornecedor, atrás de uma porta ────────────────────────
// O resto do sistema chama `enviarEmail` e não sabe quem entrega. Hoje é o
// Resend, pela API HTTP (um POST, sem SDK, sem dependência nova). Trocar de
// fornecedor é escrever outro `enviarPor...` aqui e escolher pela variável —
// nenhuma tela muda.
//
// ── sem configuração, o sistema continua de pé ───────────────
// Sem RESEND_API_KEY e EMAIL_REMETENTE, nada quebra: `enviarEmail` responde
// `nao_configurado` e deixa uma linha no log dizendo isso. As telas que
// dependem de e-mail perguntam antes (`emailConfigurado`) e dizem a verdade
// à pessoa — "peça para quem administra a empresa gerar um link na tela
// Equipe" — em vez de fingir que mandaram.
//
// ── o que NUNCA vai para o log ───────────────────────────────
// A chave, o corpo da mensagem (tem link de senha dentro) e o endereço
// inteiro de quem recebe. O endereço sai mascarado (`a***@e***.com.br`): dá
// para o suporte reconhecer "é o e-mail da dona", não dá para colher lista.
// E o erro do fornecedor sai só com o código e o NOME do erro — a mensagem
// dele às vezes repete o endereço.
//
// ── nunca lança ──────────────────────────────────────────────
// Quem chama está no meio de outra coisa (criar um convite, trocar uma
// senha). Um fornecedor fora do ar não pode desfazer isso: a função devolve
// o resultado, e quem chama decide o que dizer.

export type Email = {
  para: string
  assunto: string
  /** A versão só texto — é a que o leitor de tela e o filtro de spam leem primeiro. */
  texto: string
  html: string
}

export type Envio =
  | { ok: true; id: string | null }
  | { ok: false; motivo: 'nao_configurado' | 'recusado' | 'falhou' }

const API_RESEND = 'https://api.resend.com/emails'
const TEMPO_MAX_MS = 10_000

/** "Norte <nao-responda@gestornorte.com>" ou só o endereço. */
const FORMATO_REMETENTE = /^(?:[^<>\r\n]{1,80}<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>|[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+)$/

type Ambiente = Record<string, string | undefined>

function configuracao(env: Ambiente = process.env) {
  const chave = env.RESEND_API_KEY?.trim()
  const remetente = env.EMAIL_REMETENTE?.trim()
  if (!chave || !remetente || !FORMATO_REMETENTE.test(remetente)) return null
  return { chave, remetente }
}

/** O servidor sabe mandar e-mail? As telas perguntam isto antes de prometer. */
export function emailConfigurado(env: Ambiente = process.env): boolean {
  return configuracao(env) !== null
}

/**
 * "ana.souza@exemplo.com.br" → "a***@e***.com.br".
 * A primeira letra de cada lado e o fim do domínio: o bastante para reconhecer.
 */
export function mascararEmail(email: string): string {
  const [local = '', dominio = ''] = email.trim().toLowerCase().split('@')
  if (!local || !dominio) return '***'
  const partes = dominio.split('.')
  const nome = partes.shift() ?? ''
  const resto = partes.length ? `.${partes.join('.')}` : ''
  return `${local[0]}***@${nome[0] ?? ''}***${resto}`
}

/** Assunto numa linha só: quebra de linha em assunto é o começo de injeção de cabeçalho. */
const umaLinha = (s: string) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)

export async function enviarEmail(m: Email, env: Ambiente = process.env): Promise<Envio> {
  const para = m.para.trim().toLowerCase()
  const cfg = configuracao(env)
  if (!cfg) {
    console.info(`[email] e-mail não configurado; nada enviado para ${mascararEmail(para)} (${umaLinha(m.assunto).slice(0, 60)})`)
    return { ok: false, motivo: 'nao_configurado' }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) {
    console.warn(`[email] destinatário sem forma de e-mail; nada enviado (${mascararEmail(para)})`)
    return { ok: false, motivo: 'recusado' }
  }

  try {
    const r = await fetch(API_RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.remetente,
        to: [para],
        subject: umaLinha(m.assunto),
        html: m.html,
        text: m.texto,
      }),
      signal: AbortSignal.timeout(TEMPO_MAX_MS),
    })

    if (r.ok) {
      const corpo = (await r.json().catch(() => null)) as { id?: unknown } | null
      const id = typeof corpo?.id === 'string' ? corpo.id : null
      console.info(`[email] enviado para ${mascararEmail(para)}${id ? ` (id ${id})` : ''}`)
      return { ok: true, id }
    }

    // Só o código e o NOME do erro ("validation_error"): a mensagem do
    // fornecedor pode repetir o endereço.
    const erro = (await r.json().catch(() => null)) as { name?: unknown } | null
    const nome = typeof erro?.name === 'string' ? erro.name.slice(0, 60) : 'sem nome'
    console.error(`[email] o fornecedor recusou (${r.status}, ${nome}) o envio para ${mascararEmail(para)}`)
    return { ok: false, motivo: r.status >= 500 || r.status === 429 ? 'falhou' : 'recusado' }
  } catch (e) {
    const nome = e instanceof Error ? e.name : 'erro'
    console.error(`[email] o envio para ${mascararEmail(para)} falhou (${nome})`)
    return { ok: false, motivo: 'falhou' }
  }
}
