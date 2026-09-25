// O que chega do WhatsApp, reduzido ao que o Norte precisa — e o resto, fora.
//
// O Baileys entrega TUDO que o celular vê: grupos, status dos contatos,
// canais, reações, confirmações, a mensagem que o próprio conector acabou de
// mandar voltando como eco, o histórico antigo inteiro na primeira conexão.
// O assistente atende conversa de UMA pessoa com a loja, agora. Então:
//
//   • grupo, status, lista de transmissão, canal → fora;
//   • a conversa do dono consigo mesmo ("mensagem para mim") → fora;
//   • eco do que o conector mandou → fora (quem chama passa os ids enviados);
//   • o que alguém da loja mandou PELO CELULAR → vai, como `deMim`, sem o
//     texto: o Norte só precisa saber que um humano assumiu a conversa;
//   • mensagem velha (a sessão ficou fora do ar) → fora depois de um tempo;
//   • áudio, foto e afins sem legenda → vão como aviso, igual ao Z-API: o
//     assistente pede para a pessoa escrever.
//
// Anúncio: quem chega por um anúncio "clique para o WhatsApp" do Facebook ou
// do Instagram traz o id do anúncio em `contextInfo.externalAdReply`. Ele vai
// junto (`anuncioId`) para a campanha certa começar.
//
// PURO: trabalha sobre a FORMA da mensagem, sem importar o Baileys — é o que
// deixa testar da raiz do projeto sem instalar o conector.

/** O pedaço de uma WAMessage que interessa aqui. */
export type MensagemBruta = {
  key?: {
    remoteJid?: string | null
    remoteJidAlt?: string | null
    fromMe?: boolean | null
    id?: string | null
    participant?: string | null
  } | null
  pushName?: string | null
  messageTimestamp?: number | string | { toNumber(): number } | null
  message?: Record<string, unknown> | null
}

export type Normalizada =
  | {
      tipo: 'mensagem'
      telefone: string
      nome: string | null
      texto: string
      id: string
      deMim: boolean
      anuncioId?: string
    }
  | { tipo: 'ignorar'; motivo: string }

const soDigitos = (v: string) => v.replace(/\D/g, '')

/** O número (só dígitos) de um JID de pessoa por telefone; nulo para o resto. */
export function telefoneDoJid(jid: string | null | undefined): string | null {
  if (!jid) return null
  const m = /^(\d{8,15})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/.exec(jid)
  return m ? m[1]! : null
}

export const ehLid = (jid: string | null | undefined) => typeof jid === 'string' && jid.endsWith('@lid')

/** Grupo, status, transmissão, canal: conversa que não é de uma pessoa com a loja. */
export function ehConversaColetiva(jid: string | null | undefined): boolean {
  if (!jid) return true
  return (
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') || // inclui status@broadcast
    jid.endsWith('@newsletter') ||
    jid.endsWith('@call')
  )
}

// Os envelopes que só embrulham a mensagem de verdade.
const ENVELOPES = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' ? (v as Obj) : null)
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Tira os envelopes (efêmera, visualização única...) até chegar no conteúdo. */
export function desembrulhar(m: Obj | null | undefined): Obj | null {
  let atual = m ?? null
  for (let i = 0; atual && i < 5; i++) {
    const dentro = ENVELOPES.map((k) => obj(obj(atual![k])?.message)).find(Boolean)
    if (!dentro) break
    atual = dentro
  }
  return atual
}

const MIDIA: [string, string][] = [
  ['audioMessage', 'um áudio'],
  ['imageMessage', 'uma imagem'],
  ['videoMessage', 'um vídeo'],
  ['ptvMessage', 'um vídeo'],
  ['documentMessage', 'um documento'],
  ['stickerMessage', 'uma figurinha'],
  ['locationMessage', 'uma localização'],
  ['liveLocationMessage', 'uma localização'],
  ['contactMessage', 'um contato'],
  ['contactsArrayMessage', 'um contato'],
]

/** O texto que a pessoa escreveu, de onde quer que ele more. */
export function textoDa(m: Obj | null): string | null {
  if (!m) return null
  return (
    texto(m.conversation) ??
    texto(obj(m.extendedTextMessage)?.text) ??
    texto(obj(m.imageMessage)?.caption) ??
    texto(obj(m.videoMessage)?.caption) ??
    texto(obj(m.documentMessage)?.caption) ??
    texto(obj(m.buttonsResponseMessage)?.selectedDisplayText) ??
    texto(obj(m.templateButtonReplyMessage)?.selectedDisplayText) ??
    texto(obj(m.listResponseMessage)?.title) ??
    null
  )
}

/**
 * O id do anúncio "clique para o WhatsApp", se a conversa veio de um.
 * Mora no `contextInfo` de qualquer que seja a mensagem (texto, foto...).
 */
export function anuncioDa(m: Obj | null): string | null {
  if (!m) return null
  for (const v of Object.values(m)) {
    const ctx = obj(obj(v)?.contextInfo)
    const ad = obj(ctx?.externalAdReply)
    if (!ad) continue
    const tipo = typeof ad.sourceType === 'string' ? ad.sourceType.toLowerCase() : null
    const id = typeof ad.sourceId === 'string' ? ad.sourceId.trim() : ''
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) && (tipo === null || tipo === 'ad')) return id
  }
  return null
}

/** Segundos desde 1970, do jeito que o Baileys entregar (número, texto ou Long). */
export function segundosDe(t: MensagemBruta['messageTimestamp']): number | null {
  if (t == null) return null
  if (typeof t === 'number') return t
  if (typeof t === 'string') return Number(t) || null
  if (typeof t === 'object' && typeof t.toNumber === 'function') return t.toNumber()
  return null
}

export type ContextoNormalizar = {
  /** Agora, em ms. */
  agora: number
  /** O número (só dígitos) do WhatsApp conectado. */
  meuNumero: string | null
  /** Ids que o próprio conector mandou: o eco deles não é gente. */
  enviadas: { has(id: string): boolean }
  /** Mensagem mais velha que isto é ignorada. */
  idadeMaximaMs: number
  /**
   * O telefone já resolvido de um JID "@lid" (o WhatsApp novo esconde o
   * número atrás de um id local). Quem chama pergunta ao Baileys antes.
   */
  telefoneDoLid?: string | null
}

export function normalizar(m: MensagemBruta, c: ContextoNormalizar): Normalizada {
  const key = m.key
  const jid = key?.remoteJid ?? null
  const id = key?.id ?? ''
  if (!jid || !id) return { tipo: 'ignorar', motivo: 'sem conversa ou sem id' }
  if (ehConversaColetiva(jid)) return { tipo: 'ignorar', motivo: 'grupo, status ou transmissão' }

  const conteudo = desembrulhar(m.message)
  if (!conteudo) return { tipo: 'ignorar', motivo: 'sem conteúdo' }
  if (conteudo.protocolMessage || conteudo.reactionMessage || conteudo.pollUpdateMessage) {
    return { tipo: 'ignorar', motivo: 'reação ou controle' }
  }

  const telefone =
    telefoneDoJid(jid) ?? telefoneDoJid(key?.remoteJidAlt) ?? (ehLid(jid) && c.telefoneDoLid ? soDigitos(c.telefoneDoLid) : null)
  if (!telefone) return { tipo: 'ignorar', motivo: 'sem telefone' }
  if (c.meuNumero && telefone === c.meuNumero) return { tipo: 'ignorar', motivo: 'conversa consigo mesmo' }

  const s = segundosDe(m.messageTimestamp)
  if (s !== null && c.agora - s * 1000 > c.idadeMaximaMs) return { tipo: 'ignorar', motivo: 'mensagem velha' }

  if (key?.fromMe) {
    if (c.enviadas.has(id)) return { tipo: 'ignorar', motivo: 'eco do próprio envio' }
    // Alguém da loja respondeu pelo celular. O texto não vai: não é da conta
    // do assistente, e o Norte só precisa saber QUE um humano assumiu.
    return { tipo: 'mensagem', telefone, nome: null, texto: '', id, deMim: true }
  }

  const anuncioId = anuncioDa(conteudo)
  const nome = texto(m.pushName)?.trim() ?? null
  const escrito = textoDa(conteudo)
  const base = { tipo: 'mensagem' as const, telefone, nome, id, deMim: false, ...(anuncioId ? { anuncioId } : {}) }
  if (escrito) return { ...base, texto: escrito }

  const qual = MIDIA.find(([k]) => conteudo[k] && typeof conteudo[k] === 'object')
  if (qual) {
    return {
      ...base,
      texto: `(a pessoa mandou ${qual[1]}, que o assistente ainda não consegue abrir — peça para escrever)`,
    }
  }
  return { tipo: 'ignorar', motivo: 'tipo de mensagem não tratado' }
}
