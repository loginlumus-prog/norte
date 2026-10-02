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

/** Endereço IPv4 de dentro de casa (rede interna, a própria máquina, o metadado da nuvem). */
function ipv4Interno(h: string): boolean {
  const [a, b] = h.split('.').map(Number) as [number, number]
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  )
}

/** O mesmo, para o endereço que o DNS devolveu (v4 ou v6). */
export function ipInterno(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return ipv4Interno(h)
  // IPv4 embrulhado em IPv6 (::ffff:10.0.0.1) é o IPv4 de dentro.
  const embrulhado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
  if (embrulhado) return ipv4Interno(embrulhado[1]!)
  return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
}

/**
 * Endereço de onde se pode baixar: https, e nunca a própria máquina nem a
 * rede interna. O link vem do provedor (Z-API), num corpo que só chega com o
 * token da empresa — mas o servidor não busca nada de dentro de casa por
 * pedido de fora. Isto olha o NOME; `resolveParaFora` olha o endereço que o
 * nome dá (um nome de fora pode apontar para dentro).
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
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && ipv4Interno(h)) return false
  if (h.includes(':')) return false // IPv6 literal: não há motivo para o provedor mandar um
  return true
}

/** Quem resolve o nome: o DNS de verdade, ou um de mentira nos testes. */
export type Resolver = (host: string) => Promise<string[]>

const resolverDoSistema: Resolver = async (host) => {
  const { lookup } = await import('node:dns/promises')
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)
}

/** Todos os endereços que o nome dá são de fora? Nome que não resolve: não. */
async function resolveParaFora(url: string, resolver: Resolver): Promise<boolean> {
  try {
    const ips = await resolver(new URL(url).hostname.replace(/^\[|\]$/g, ''))
    return ips.length > 0 && !ips.some(ipInterno)
  } catch {
    return false
  }
}

/** Lê o corpo até o teto, com ou sem Content-Length: passou, para e devolve nulo. */
async function lerAteOTeto(r: Response, teto: number): Promise<Uint8Array | null> {
  if (!r.body) return null
  const leitor = r.body.getReader()
  const pedacos: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > teto) {
      await leitor.cancel().catch(() => undefined)
      return null
    }
    pedacos.push(value)
  }
  const bytes = new Uint8Array(total)
  let i = 0
  for (const p of pedacos) {
    bytes.set(p, i)
    i += p.byteLength
  }
  return bytes
}

async function baixar(
  url: string,
  buscar: typeof fetch,
  resolver: Resolver | null,
): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  try {
    // Redirecionamento só um, e conferido como o primeiro endereço: seguir
    // às cegas deixaria o link de fora apontar para dentro de casa.
    let atual = url
    let r: Response | null = null
    for (let i = 0; i < 2; i++) {
      if (!enderecoBaixavel(atual)) return null
      if (resolver && !(await resolveParaFora(atual, resolver))) return null
      r = await buscar(atual, { redirect: 'manual', signal: AbortSignal.timeout(ESPERA_MS) })
      const destino = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null
      if (!destino) break
      atual = new URL(destino, atual).toString()
      r = null
    }
    if (!r || !r.ok) return null
    const tamanho = Number(r.headers.get('content-length') ?? 0)
    if (tamanho > MAXIMO_AUDIO_BYTES) return null
    // O Content-Length é do servidor de lá, e pode faltar ou mentir: o teto
    // vale para o que de fato chega.
    const bytes = await lerAteOTeto(r, MAXIMO_AUDIO_BYTES)
    if (!bytes || bytes.byteLength === 0) return null
    return { bytes, mime: r.headers.get('content-type') }
  } catch {
    return null
  }
}

/**
 * Quanto dura o áudio, para a conta. O provedor diz os segundos (Z-API);
 * sem isso, estima pelo tamanho — a nota de voz do WhatsApp (opus) anda
 * perto de 2 KB por segundo. Errar para cima é o lado seguro da conta.
 */
const segundosDe = (bytes: number, informados?: number | null) =>
  informados && informados > 0 ? Math.ceil(informados) : Math.max(1, Math.ceil(bytes / 2000))

export type Ouvido = { texto: string; segundos: number }

/**
 * O áudio recebido → texto, e quanto ele durava (para a conta). Nulo quando
 * não deu, e sem chave nem baixa nada (o caso comum, enquanto a loja não liga).
 *
 * O DNS é conferido quando quem busca é o `fetch` de verdade; o `buscar` de
 * mentira dos testes não sai para a rede, e o nome dele não resolve.
 */
export async function ouvirMedindo(
  audio: AudioRecebido,
  buscar: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
  resolver: Resolver | null = buscar === fetch ? resolverDoSistema : null,
): Promise<Ouvido | null> {
  if (!lerConfigTranscricao(env)) return null
  if ('base64' in audio) {
    if (!/^[A-Za-z0-9+/=]+$/.test(audio.base64)) return null
    const bytes = Buffer.from(audio.base64, 'base64')
    const texto = await transcrever(bytes, audio.mime, buscar, env)
    return texto ? { texto, segundos: segundosDe(bytes.byteLength) } : null
  }
  if (audio.segundos != null && audio.segundos > MAXIMO_AUDIO_SEGUNDOS) return null
  const b = await baixar(audio.url, buscar, resolver)
  if (!b) return null
  const mime = ehAudio(audio.mime) ? audio.mime! : ehAudio(b.mime) ? b.mime! : 'audio/ogg'
  const texto = await transcrever(b.bytes, mime, buscar, env)
  return texto ? { texto, segundos: segundosDe(b.bytes.byteLength, audio.segundos) } : null
}

/** `ouvirMedindo`, só o texto. */
export async function ouvir(
  audio: AudioRecebido,
  buscar: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  return (await ouvirMedindo(audio, buscar, env))?.texto ?? null
}

// ── a conta ──────────────────────────────────────────────────

/**
 * O custo da transcrição, em centavos por minuto começado. O Whisper da Groq
 * sai por menos de meio centavo o minuto; um centavo arredonda para cima (e
 * cobre o câmbio). `TRANSCRICAO_CENT_POR_MINUTO` muda, se o serviço mudar.
 */
export function custoDaTranscricaoCent(segundos: number, env: Record<string, string | undefined> = process.env): number {
  const porMinuto = Number(env.TRANSCRICAO_CENT_POR_MINUTO ?? 1)
  const p = Number.isFinite(porMinuto) && porMinuto >= 0 ? porMinuto : 1
  return Math.ceil(Math.max(1, Math.ceil(segundos / 60)) * p)
}

/**
 * O eco no começo da resposta: a pessoa vê o que o assistente ouviu, e
 * percebe na hora quando "picanha" virou "pianinha". Comprido, encurta.
 */
export function ecoDoAudio(texto: string): string {
  const t = texto.length > 220 ? `${texto.slice(0, 219).trimEnd()}…` : texto
  return `Ouvi: “${t}”`
}
