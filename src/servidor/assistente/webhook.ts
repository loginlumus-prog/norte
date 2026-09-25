// A porta por onde o WhatsApp entra: /api/whatsapp/{empresa}/{token}.
//
// ═══════════════════════════════════════════════════════════════
//  QUEM BATE AQUI NÃO TEM SESSÃO
// ═══════════════════════════════════════════════════════════════
//
// O Z-API não faz login. Ele manda um POST para o endereço cadastrado, e
// qualquer pessoa que descobrir o endereço consegue mandar o mesmo POST —
// inclusive fingindo ser o DONO, porque o número de quem mandou vem no corpo.
// Então o endereço É a senha, e é tratado como senha:
//
//   • o token é ALEATÓRIO e é da empresa: 32 bytes gerados na tela do
//     assistente, mostrados UMA vez, e guardados só como resumo (sha256) em
//     `Agente.webhookTokenHash` — o mesmo desenho do convite. Banco vazado não
//     entrega token nenhum, e trocar o de UMA empresa é gerar outro;
//   • a conferência compara os resumos em tempo constante. Token errado e
//     empresa inexistente dão a mesma resposta (401), então a porta não serve
//     para descobrir quais empresas existem;
//   • token fora do formato morre ANTES de qualquer leitura no banco — lixo
//     batendo na porta não custa consulta;
//   • nada disso vai para log.
//
// ── o endereço antigo, derivado do slug ──────────────────────
// Antes de existir a coluna, o token era um HMAC-SHA256 do slug com um
// segredo do servidor (WEBHOOK_SEGREDO). Funcionava, mas não dava para trocar
// o de uma empresa só (trocar o segredo trocava o de todas), e quem tivesse o
// segredo fabricava o endereço de qualquer uma.
//
// Ele continua aceito, e SÓ enquanto a empresa não gerou o endereço próprio
// (webhookTokenHash nulo): é o caminho de migração do piloto, que já tem o
// endereço antigo colado no Z-API. No dia em que ela gera o novo, o antigo
// para de abrir na hora — e não volta.
//
// O interruptor continua por empresa: `canal = NENHUM` fecha a porta dela (o
// endereço segue igual, mas a mensagem é descartada).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { acharOrgPorSlug, comoOrg } from '../banco'
import { abrirConversa } from './contexto'
import { processarMensagem, type Dependencias, type Desfecho } from './conversa'
import { escolherCanal, SELECT_LINHA, type Canal } from './canal'

// ─────────────────────────────────────────────────────────────
// O TOKEN
// ─────────────────────────────────────────────────────────────

/**
 * Os dois tokens (o próprio e o antigo) são 32 bytes em base64url: 43
 * caracteres. Qualquer outra coisa é "não" sem encostar no banco.
 */
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/
export const formatoDeToken = (token: unknown): token is string =>
  typeof token === 'string' && FORMATO_TOKEN.test(token)

/** O resumo que fica no banco. sha256 em hex — nunca o token. */
export const resumoDoToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Um token novo para a empresa, e o resumo dele para guardar. */
export function novoTokenDoWebhook(): { token: string; resumo: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, resumo: resumoDoToken(token) }
}

/** Confere o token contra o resumo guardado, em tempo constante. */
export function conferirTokenProprio(resumoGuardado: string, token: unknown): boolean {
  if (!formatoDeToken(token) || typeof resumoGuardado !== 'string') return false
  const a = Buffer.from(resumoDoToken(token), 'hex')
  const b = Buffer.from(resumoGuardado, 'hex')
  return a.length === 32 && a.length === b.length && timingSafeEqual(a, b)
}

export function montarEnderecoDoWebhook(base: string, slug: string, token: string): string {
  return `${base.replace(/\/$/, '')}/api/whatsapp/${encodeURIComponent(slug)}/${token}`
}

// ── o endereço antigo (derivado do slug) ─────────────────────

/** Segredo curto é segredo adivinhável. Abaixo disto, a porta antiga fica fechada. */
const MINIMO_SEGREDO = 32

function segredo(): string | null {
  const s = (process.env.WEBHOOK_SEGREDO ?? '').trim()
  return s.length >= MINIMO_SEGREDO ? s : null
}

/** O servidor ainda sabe abrir a porta ANTIGA? */
export const temSegredoWebhook = () => segredo() !== null

/** O token ANTIGO desta empresa. Nulo se o servidor não tem segredo configurado. */
export function tokenDoWebhook(slug: string): string | null {
  const s = segredo()
  if (!s) return null
  return createHmac('sha256', s).update(`whatsapp:${slug}`).digest('base64url')
}

/** Confere o token ANTIGO sem vazar tempo. Qualquer coisa fora do formato é "não". */
export function conferirToken(slug: string, token: string): boolean {
  const certo = tokenDoWebhook(slug)
  if (!certo || typeof token !== 'string') return false
  const a = Buffer.from(certo)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * A regra da porta, inteira: com endereço próprio, SÓ ele abre; sem, o
 * antigo (se o servidor ainda tem o segredo).
 */
export function portaAbre(slug: string, token: string, resumoGuardado: string | null | undefined): boolean {
  if (resumoGuardado) return conferirTokenProprio(resumoGuardado, token)
  return conferirToken(slug, token)
}

// ─────────────────────────────────────────────────────────────
// O QUE O Z-API MANDA
// ─────────────────────────────────────────────────────────────

export type Recebida =
  | { tipo: 'mensagem'; telefone: string; nome: string | null; texto: string; idExterno: string }
  /** Alguém da loja respondeu pelo próprio celular: o assistente sai da frente. */
  | { tipo: 'humano'; telefone: string }
  | { tipo: 'ignorar'; motivo: string }

const MIDIA: Record<string, string> = {
  audio: 'um áudio',
  image: 'uma imagem',
  video: 'um vídeo',
  document: 'um documento',
  sticker: 'uma figurinha',
  location: 'uma localização',
  contact: 'um contato',
}

/**
 * O callback "ao receber" do Z-API, reduzido ao que interessa.
 *
 * Grupo, canal, lista de transmissão, status de entrega: tudo ignorado. O
 * assistente atende conversa de uma pessoa com a loja, e mais nada — num
 * grupo ele responderia a todo mundo, a cada mensagem.
 */
export function lerZapi(
  corpo: unknown,
  /** A instância que ESTA empresa usa. Sem ela, a do ambiente (a linha global). */
  instanciaEsperada: string | null = (process.env.ZAPI_INSTANCIA ?? '').trim() || null,
): Recebida {
  if (!corpo || typeof corpo !== 'object') return { tipo: 'ignorar', motivo: 'corpo vazio' }
  const c = corpo as Record<string, unknown>
  if (c.type !== 'ReceivedCallback') return { tipo: 'ignorar', motivo: 'não é mensagem recebida' }
  if (c.isGroup === true || c.isNewsletter === true || c.broadcast === true) {
    return { tipo: 'ignorar', motivo: 'grupo ou transmissão' }
  }
  const telefone = typeof c.phone === 'string' ? c.phone.replace(/\D/g, '') : ''
  const idExterno = typeof c.messageId === 'string' ? c.messageId : ''
  if (!telefone || !idExterno) return { tipo: 'ignorar', motivo: 'sem telefone ou id' }

  // Instância diferente da configurada: não é o nosso número falando.
  const instancia = instanciaEsperada
  if (instancia && typeof c.instanceId === 'string' && c.instanceId !== instancia) {
    return { tipo: 'ignorar', motivo: 'outra instância' }
  }

  if (c.fromMe === true) {
    // O que o próprio assistente mandou pela API volta como "fromMe" — isso
    // não é gente. O que saiu do celular da loja é.
    return c.fromApi === true ? { tipo: 'ignorar', motivo: 'eco do próprio envio' } : { tipo: 'humano', telefone }
  }

  const nome =
    (typeof c.senderName === 'string' && c.senderName.trim()) ||
    (typeof c.chatName === 'string' && c.chatName.trim()) ||
    null

  const t = c.text as { message?: unknown } | undefined
  if (t && typeof t.message === 'string' && t.message.trim()) {
    return { tipo: 'mensagem', telefone, nome, texto: t.message, idExterno }
  }
  const qual = Object.keys(MIDIA).find((k) => c[k] && typeof c[k] === 'object')
  if (qual) {
    return {
      tipo: 'mensagem',
      telefone,
      nome,
      idExterno,
      texto: `(a pessoa mandou ${MIDIA[qual]}, que o assistente ainda não consegue abrir — peça para escrever)`,
    }
  }
  return { tipo: 'ignorar', motivo: 'tipo de mensagem não tratado' }
}

// ─────────────────────────────────────────────────────────────
// A PORTA
// ─────────────────────────────────────────────────────────────

/** Quanto tempo o assistente fica calado depois que alguém da loja respondeu. */
const HUMANO_MINUTOS = 30

export type Porta = {
  status: 200 | 401
  /**
   * O que fazer depois de responder. A rota entrega ao `after()` do Next: o
   * Z-API recebe o 200 na hora e não reenvia por impaciência, e a conversa
   * (que pode levar vários segundos com a IA) roda em seguida.
   */
  trabalho?: () => Promise<Desfecho | void>
}

/** O que a porta precisa para trabalhar. Sem `canal`, usa o da própria empresa. */
export type DependenciasPorta = Omit<Dependencias, 'canal'> & { canal?: Canal }

/**
 * A decisão da porta.
 *
 * Token fora do formato: 401 na hora, sem banco. No formato: a portaria diz
 * de quem é o endereço, e o Agente diz qual token vale — o próprio, se a
 * empresa já gerou; o antigo, se não. Empresa inexistente, sem assistente ou
 * token errado: o mesmo 401, sem pista de qual foi.
 */
export async function receberWebhook(slug: string, token: string, corpo: unknown, deps: DependenciasPorta): Promise<Porta> {
  if (!formatoDeToken(token)) return { status: 401 }

  const org = await acharOrgPorSlug(slug)
  if (!org) return { status: 401 }
  const agente = await comoOrg(org.id, (db) =>
    db.agente.findUnique({
      where: { orgId: org.id },
      select: { id: true, canal: true, webhookTokenHash: true, ...SELECT_LINHA },
    }),
  )
  if (!agente || !portaAbre(org.slug, token, agente.webhookTokenHash)) return { status: 401 }

  // A instância que conta é a da linha própria; sem ela, a do ambiente.
  const r = lerZapi(corpo, agente.zapiInstancia?.trim() || undefined)
  if (r.tipo === 'ignorar') return { status: 200 }

  return {
    status: 200,
    trabalho: async () => {
      // O interruptor por empresa: sem canal conectado, a porta está fechada
      // mesmo com o token certo.
      if (agente.canal !== 'ZAPI') return
      const canal = deps.canal ?? escolherCanal(org, agente).canal

      if (r.tipo === 'humano') {
        const conversa = await abrirConversa(org.id, agente.id, r.telefone, { daEquipe: false })
        await comoOrg(org.id, (db) =>
          db.conversaAgente.update({
            where: { id: conversa.id },
            data: { humanoAte: new Date(Date.now() + HUMANO_MINUTOS * 60_000) },
          }),
        )
        return
      }

      return processarMensagem(
        { orgId: org.id, telefone: r.telefone, nome: r.nome, texto: r.texto, idExterno: r.idExterno },
        { ...deps, canal },
      )
    },
  }
}
