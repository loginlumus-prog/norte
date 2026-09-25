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
//   • o token é um HMAC-SHA256 do slug com um segredo que só o servidor tem
//     (WEBHOOK_SEGREDO). Sem o segredo não se fabrica token de empresa
//     nenhuma, nem conhecendo o de outra;
//   • a conferência acontece ANTES de qualquer leitura no banco, com
//     comparação de tempo constante. Token errado e empresa inexistente dão a
//     mesma resposta (401), então a porta não serve para descobrir quais
//     empresas existem;
//   • nada disso vai para log.
//
// ── por que derivado, e não guardado ─────────────────────────
// O certo seria o que o convite faz: token aleatório, só o resumo no banco,
// trocável a qualquer hora. Mas o schema NÃO tem campo para isso (o Agente
// tem canal e número, e nada que signifique "segredo do webhook"), e
// improvisar num campo com outro significado é como se cria o defeito que
// ninguém entende daqui a um ano. Derivar do segredo do servidor não guarda
// nada — se o banco vazar, não há token para roubar — e custa uma coisa, que
// fica escrita: não dá para trocar o token de UMA empresa. Trocar o
// WEBHOOK_SEGREDO troca o de todas. O que existe por empresa é o interruptor:
// `canal = NENHUM` fecha a porta dela (o endereço continua igual, mas a
// mensagem é descartada). Coluna própria, com o resumo do token, é migração
// para quem cuida do schema.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { acharOrgPorSlug, comoOrg } from '../banco'
import { abrirConversa } from './contexto'
import { processarMensagem, type Dependencias, type Desfecho } from './conversa'

// ─────────────────────────────────────────────────────────────
// O TOKEN
// ─────────────────────────────────────────────────────────────

/** Segredo curto é segredo adivinhável. Abaixo disto, a porta fica fechada. */
const MINIMO_SEGREDO = 32

function segredo(): string | null {
  const s = (process.env.WEBHOOK_SEGREDO ?? '').trim()
  return s.length >= MINIMO_SEGREDO ? s : null
}

export const temSegredoWebhook = () => segredo() !== null

/** O token desta empresa. Nulo se o servidor não tem segredo configurado. */
export function tokenDoWebhook(slug: string): string | null {
  const s = segredo()
  if (!s) return null
  return createHmac('sha256', s).update(`whatsapp:${slug}`).digest('base64url')
}

/** Confere sem vazar tempo. Qualquer coisa fora do formato é simplesmente "não". */
export function conferirToken(slug: string, token: string): boolean {
  const certo = tokenDoWebhook(slug)
  if (!certo || typeof token !== 'string') return false
  const a = Buffer.from(certo)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function enderecoDoWebhook(base: string, slug: string): string | null {
  const t = tokenDoWebhook(slug)
  return t ? `${base.replace(/\/$/, '')}/api/whatsapp/${encodeURIComponent(slug)}/${t}` : null
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
export function lerZapi(corpo: unknown): Recebida {
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
  const instancia = (process.env.ZAPI_INSTANCIA ?? '').trim()
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

/**
 * A decisão da porta. É síncrona até o 401 de propósito: token errado não
 * encosta no banco — nem na portaria.
 */
export function receberWebhook(slug: string, token: string, corpo: unknown, deps: Dependencias): Porta {
  if (!conferirToken(slug, token)) return { status: 401 }

  const r = lerZapi(corpo)
  if (r.tipo === 'ignorar') return { status: 200 }

  return {
    status: 200,
    trabalho: async () => {
      const org = await acharOrgPorSlug(slug)
      if (!org) return
      // O interruptor por empresa: sem canal conectado, a porta está fechada
      // mesmo com o token certo.
      const agente = await comoOrg(org.id, (db) =>
        db.agente.findUnique({ where: { orgId: org.id }, select: { id: true, canal: true } }),
      )
      if (!agente || agente.canal !== 'ZAPI') return

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
        deps,
      )
    },
  }
}
