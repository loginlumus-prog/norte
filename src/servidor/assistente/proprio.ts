// O lado do Norte da conexão por QR Code: o que o conector entrega (as
// mensagens recebidas) e o que ele guarda aqui (a sessão cifrada).
//
// Quem chama isto é a API interna em src/app/api/whatsapp-proprio/[orgId],
// DEPOIS de conferir a assinatura HMAC do conector (./conector.ts). Aqui
// dentro o pedido já é do conector; o que falta decidir é se a empresa existe
// e se ela está, de fato, falando pelo QR Code.
//
// ── a mensagem recebida ──────────────────────────────────────
// É o MESMO caminho do webhook do Z-API: `processarMensagem` para o que o
// cliente (ou o dono) escreveu, `marcarHumano` quando alguém da loja
// respondeu pelo próprio celular. Só muda a leitura do corpo, que aqui é a
// forma que o conector já normalizou (conector/src/normalizar.ts).
//
// ── a sessão ─────────────────────────────────────────────────
// O pacote que o Baileys precisa para reconectar sem QR. Quem o tem FALA pelo
// WhatsApp da loja, então ele entra cifrado (AES-256-GCM, NORTE_CIFRA) com a
// empresa e o campo no contexto: copiado para a linha de outra empresa, não
// abre. E o RLS garante que a leitura de uma empresa nem enxerga a da outra.

import { comoOrg } from '../banco'
import { cifrar, decifrar, temCifra } from '../cifra'
import { marcarHumano, processarMensagem, type Dependencias, type Desfecho } from './conversa'
import { escolherCanal, SELECT_LINHA, type Canal } from './canal'

// ─────────────────────────────────────────────────────────────
// A EMPRESA DO ENDEREÇO
// ─────────────────────────────────────────────────────────────

/** Id de empresa: cuid (ou os ids curtos do exemplo). Fora disto, nem consulta. */
const FORMATO_ORG = /^[A-Za-z0-9_-]{1,64}$/
export const formatoDeOrg = (v: unknown): v is string => typeof v === 'string' && FORMATO_ORG.test(v)

/** A empresa existe? (Pelo próprio carimbo: o RLS de `orgs` só mostra ela mesma.) */
export async function empresaExiste(orgId: string): Promise<boolean> {
  if (!formatoDeOrg(orgId)) return false
  const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { id: true } }))
  return !!org
}

// ─────────────────────────────────────────────────────────────
// A MENSAGEM QUE O CONECTOR ENTREGA
// ─────────────────────────────────────────────────────────────

export type DoConector =
  | { tipo: 'mensagem'; telefone: string; nome: string | null; texto: string; idExterno: string; anuncioId: string | null }
  | { tipo: 'humano'; telefone: string }
  | { tipo: 'ignorar'; motivo: string }

/**
 * O corpo do conector, conferido campo a campo — assinatura certa não quer
 * dizer corpo bem formado (um conector com defeito também assina).
 */
export function lerDoConector(corpo: unknown): DoConector {
  if (!corpo || typeof corpo !== 'object') return { tipo: 'ignorar', motivo: 'corpo vazio' }
  const c = corpo as Record<string, unknown>
  if (c.tipo !== 'mensagem') return { tipo: 'ignorar', motivo: 'tipo desconhecido' }
  const telefone = typeof c.telefone === 'string' ? c.telefone.replace(/\D/g, '') : ''
  if (telefone.length < 10 || telefone.length > 15) return { tipo: 'ignorar', motivo: 'sem telefone' }
  if (c.deMim === true) return { tipo: 'humano', telefone }

  const id = typeof c.id === 'string' ? c.id.trim() : ''
  const texto = typeof c.texto === 'string' ? c.texto.slice(0, 4_000) : ''
  if (!id || id.length > 128 || !texto.trim()) return { tipo: 'ignorar', motivo: 'sem id ou sem texto' }
  const nome = typeof c.nome === 'string' && c.nome.trim() ? c.nome.trim().slice(0, 80) : null
  const anuncioId =
    typeof c.anuncioId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.anuncioId) ? c.anuncioId : null
  return { tipo: 'mensagem', telefone, nome, texto, idExterno: id, anuncioId }
}

export type PortaProprio = {
  status: 200 | 404
  /** Roda depois de responder (o `after()` da rota), como no webhook do Z-API. */
  trabalho?: () => Promise<Desfecho | void>
}

/**
 * A decisão da porta do conector. Empresa que não existe ou sem assistente:
 * 404. Existe mas NÃO está no QR Code (desconectou, ou voltou para o Z-API):
 * 200 e descarta — o interruptor é o `canal` do Agente, como no Z-API.
 */
export async function receberDoConector(
  orgId: string,
  corpo: unknown,
  deps: Omit<Dependencias, 'canal'> & { canal?: Canal },
): Promise<PortaProprio> {
  if (!formatoDeOrg(orgId)) return { status: 404 }
  const lido = await comoOrg(orgId, async (db) => {
    const org = await db.org.findUnique({ where: { id: orgId }, select: { id: true, slug: true } })
    if (!org) return null
    const agente = await db.agente.findUnique({
      where: { orgId },
      select: { id: true, canal: true, ...SELECT_LINHA },
    })
    return agente ? { org, agente } : null
  })
  if (!lido) return { status: 404 }
  const { org, agente } = lido

  const r = lerDoConector(corpo)
  if (r.tipo === 'ignorar' || agente.canal !== 'PROPRIO') return { status: 200 }

  return {
    status: 200,
    trabalho: async () => {
      if (r.tipo === 'humano') return marcarHumano(org.id, agente.id, r.telefone)
      const canal = deps.canal ?? escolherCanal(org, agente).canal
      return processarMensagem(
        {
          orgId: org.id,
          telefone: r.telefone,
          nome: r.nome,
          texto: r.texto,
          idExterno: r.idExterno,
          anuncioId: r.anuncioId,
        },
        { ...deps, canal },
      )
    },
  }
}

// ─────────────────────────────────────────────────────────────
// A SESSÃO CIFRADA
// ─────────────────────────────────────────────────────────────

/** Prende o texto cifrado à empresa E ao campo. */
export const contextoDaSessao = (orgId: string) => `sessao_whatsapp:${orgId}:dados`

/** O pacote do Baileys, comprimido, passa longe disto; maior é outra coisa. */
export const MAXIMO_SESSAO = 12 * 1024 * 1024

export type SessaoLida = { dados: string; versao: number }

/**
 * A sessão guardada, aberta. Nulo quando não há — e também quando não abre
 * (chave trocada, texto mexido, linha copiada de outra empresa): para o
 * conector, as duas coisas são "sem sessão, precisa de QR".
 */
export async function lerSessaoWhatsapp(orgId: string): Promise<SessaoLida | null> {
  const linha = await comoOrg(orgId, (db) =>
    db.sessaoWhatsapp.findUnique({ where: { orgId }, select: { dadosCifrados: true, versao: true } }),
  )
  if (!linha) return null
  const dados = decifrar(linha.dadosCifrados, contextoDaSessao(orgId))
  if (dados === null) {
    console.error(`[whatsapp-proprio] a sessão da empresa ${orgId} não abre com a chave deste servidor`)
    return null
  }
  return { dados, versao: Number(linha.versao) }
}

export type Gravacao = 'ok' | 'velha' | 'sem_cifra' | 'invalida'

/**
 * Guarda a sessão, cifrada. Recusa versão mais velha (ou igual) à guardada:
 * pedido repetido ou fora de ordem não volta a sessão para trás.
 */
export async function gravarSessaoWhatsapp(orgId: string, dados: unknown, versao: unknown): Promise<Gravacao> {
  if (typeof dados !== 'string' || !dados || dados.length > MAXIMO_SESSAO || !/^[A-Za-z0-9+/=]+$/.test(dados)) return 'invalida'
  if (typeof versao !== 'number' || !Number.isSafeInteger(versao) || versao <= 0) return 'invalida'
  if (!temCifra()) return 'sem_cifra'
  const cifrado = cifrar(dados, contextoDaSessao(orgId))
  return comoOrg(orgId, async (db) => {
    const atual = await db.sessaoWhatsapp.findUnique({ where: { orgId }, select: { versao: true } })
    if (atual && atual.versao >= BigInt(versao)) return 'velha' as const
    await db.sessaoWhatsapp.upsert({
      where: { orgId },
      create: { orgId, dadosCifrados: cifrado, versao: BigInt(versao) },
      update: { dadosCifrados: cifrado, versao: BigInt(versao) },
    })
    return 'ok' as const
  })
}

/** Esquece a sessão (o celular desconectou, ou o dono clicou "Desconectar"). */
export async function apagarSessaoWhatsapp(orgId: string): Promise<void> {
  await comoOrg(orgId, (db) => db.sessaoWhatsapp.deleteMany({ where: { orgId } }))
}
