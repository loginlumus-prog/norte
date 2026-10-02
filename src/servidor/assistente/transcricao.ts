// O áudio que a EQUIPE manda, virado texto.
//
// "Comprei agora 10 kg de picanha a 39,90 o quilo" falado no meio do
// descarregamento vira o mesmo texto que a pessoa teria digitado, e segue o
// caminho de sempre (o modelo, as ferramentas, a proposta, o SIM).
//
// ── quem transcreve ──────────────────────────────────────────
// Um serviço compatível com o Whisper da OpenAI (o padrão é o da Groq, que é
// rápido e barato), configurado no servidor:
//
//   TRANSCRICAO_URL     o endereço de transcrição (padrão: o da Groq)
//   TRANSCRICAO_CHAVE   a chave da conta — segredo do servidor; sem ela, nada
//                       é transcrito e o áudio segue como hoje ("peça para
//                       escrever")
//   TRANSCRICAO_MODELO  o modelo (padrão: whisper-large-v3-turbo)
//
// ── de quem ──────────────────────────────────────────────────
// SÓ de quem é da equipe (telefone confirmado de usuário ativo — quem decide
// é `conversa.ts`, antes de chamar isto). Áudio de cliente nunca sai do
// Norte para serviço nenhum: cliente não conversa com IA, e a voz dela não é
// dado nosso para mandar a terceiro.
//
// ── e quando falha ───────────────────────────────────────────
// Sem chave, serviço fora do ar, áudio grande demais, resposta vazia: nulo,
// e quem chamou segue com o aviso de sempre. Nada daqui lança. O log leva o
// status e o tamanho — nunca o áudio, nunca o texto.

/** Áudio maior que isto não vai: três minutos de nota de voz cabem com folga. */
export const MAXIMO_AUDIO_BYTES = 3 * 1024 * 1024
export const MAXIMO_AUDIO_SEGUNDOS = 180
/** Quanto esperar o serviço. Passou disso, a pessoa já está esperando demais. */
const ESPERA_MS = 20_000

export const URL_PADRAO = 'https://api.groq.com/openai/v1/audio/transcriptions'
export const MODELO_PADRAO = 'whisper-large-v3-turbo'

/**
 * O áudio como chegou: em bytes (base64, o conector do QR Code baixa e manda
 * junto) ou num endereço para baixar (o Z-API guarda e manda o link).
 */
export type AudioRecebido =
  | { base64: string; mime: string }
  | { url: string; mime: string | null; segundos?: number | null }

export type ConfigTranscricao = { url: string; chave: string; modelo: string }

export function lerConfigTranscricao(env: Record<string, string | undefined> = process.env): ConfigTranscricao | null {
  const chave = (env.TRANSCRICAO_CHAVE ?? '').trim()
  if (!chave) return null
  const url = (env.TRANSCRICAO_URL ?? '').trim() || URL_PADRAO
  try {
    const u = new URL(url)
    // A chave vai no cabeçalho: em http, quem está no caminho lê.
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ehLocal(u.hostname))) return null
  } catch {
    return null
  }
  return { url, chave, modelo: (env.TRANSCRICAO_MODELO ?? '').trim() || MODELO_PADRAO }
}

export const temTranscricao = () => lerConfigTranscricao() !== null

const ehLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/** O nome do arquivo pela forma do áudio: o serviço olha a extensão. */
function arquivoDo(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('ogg') || m.includes('opus')) return 'audio.ogg'
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3'
  if (m.includes('wav')) return 'audio.wav'
  if (m.includes('webm')) return 'audio.webm'
  if (m.includes('aac')) return 'audio.aac'
  return 'audio.m4a'
}

const ehAudio = (mime: string | null | undefined) => typeof mime === 'string' && /^audio\/[\w.+-]+/i.test(mime.trim())

/**
 * Bytes e forma → texto. Nulo quando não deu (sem chave, falha, vazio).
 * `buscar` é o fetch — nos testes, um de mentira.
 */
export async function transcrever(
  bytes: Uint8Array,
  mime: string,
  buscar: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const cfg = lerConfigTranscricao(env)
  if (!cfg) return null
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMO_AUDIO_BYTES) return null
  const tipo = ehAudio(mime) ? mime.trim() : 'audio/ogg'
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes)], { type: tipo }), arquivoDo(tipo))
    form.append('model', cfg.modelo)
    form.append('language', 'pt')
    form.append('response_format', 'json')
    form.append('temperature', '0')
    const r = await buscar(cfg.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.chave}` },
      body: form,
      signal: AbortSignal.timeout(ESPERA_MS),
    })
    if (!r.ok) {
      console.warn(`[transcricao] o serviço recusou (status ${r.status}, ${bytes.byteLength} bytes)`)
      return null
    }
    const j = (await r.json()) as { text?: unknown }
    const texto = typeof j.text === 'string' ? j.text.replace(/\s+/g, ' ').trim() : ''
    return texto ? texto.slice(0, 4_000) : null
  } catch (e) {
    console.warn(`[transcricao] falhou: ${e instanceof Error ? e.name : 'erro'}`)
    return null
  }
}

/**
 * Endereço de onde se pode baixar: https, e nunca a própria máquina nem a
 * rede interna. O link vem do provedor (Z-API), num corpo que só chega com o
 * token da empresa — mas o servidor não busca nada de dentro de casa por
 * pedido de fora.
 */
export function enderecoBaixavel(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number) as [number, number]
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false
    }
  }
  if (h.includes(':')) return false // IPv6 literal: não há motivo para o provedor mandar um
  return true
}

async function baixar(url: string, buscar: typeof fetch): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  try {
    // Redirecionamento só um, e conferido como o primeiro endereço: seguir
    // às cegas deixaria o link de fora apontar para dentro de casa.
    let atual = url
    let r: Response | null = null
    for (let i = 0; i < 2; i++) {
      if (!enderecoBaixavel(atual)) return null
      r = await buscar(atual, { redirect: 'manual', signal: AbortSignal.timeout(ESPERA_MS) })
      const destino = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null
      if (!destino) break
      atual = new URL(destino, atual).toString()
      r = null
    }
    if (!r || !r.ok) return null
    const tamanho = Number(r.headers.get('content-length') ?? 0)
    if (tamanho > MAXIMO_AUDIO_BYTES) return null
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAXIMO_AUDIO_BYTES) return null
    return { bytes, mime: r.headers.get('content-type') }
  } catch {
    return null
  }
}

/**
 * O áudio recebido → texto, do jeito que ele vier. Nulo quando não deu, e
 * sem chave nem baixa nada (o caso comum, enquanto a loja não liga).
 */
export async function ouvir(
  audio: AudioRecebido,
  buscar: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (!lerConfigTranscricao(env)) return null
  if ('base64' in audio) {
    if (!/^[A-Za-z0-9+/=]+$/.test(audio.base64)) return null
    const bytes = Buffer.from(audio.base64, 'base64')
    return transcrever(bytes, audio.mime, buscar, env)
  }
  if (audio.segundos != null && audio.segundos > MAXIMO_AUDIO_SEGUNDOS) return null
  const b = await baixar(audio.url, buscar)
  if (!b) return null
  const mime = ehAudio(audio.mime) ? audio.mime! : ehAudio(b.mime) ? b.mime! : 'audio/ogg'
  return transcrever(b.bytes, mime, buscar, env)
}

/**
 * O eco no começo da resposta: a pessoa vê o que o assistente ouviu, e
 * percebe na hora quando "picanha" virou "pianinha". Comprido, encurta.
 */
export function ecoDoAudio(texto: string): string {
  const t = texto.length > 220 ? `${texto.slice(0, 219).trimEnd()}…` : texto
  return `Ouvi: “${t}”`
}
