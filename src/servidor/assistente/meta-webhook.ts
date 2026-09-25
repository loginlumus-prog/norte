// A porta do WhatsApp OFICIAL: /api/whatsapp-meta (GET verifica, POST recebe).
//
// ═══════════════════════════════════════════════════════════════
//  UM ENDEREÇO PARA TODAS AS LOJAS
// ═══════════════════════════════════════════════════════════════
//
// Diferente do Z-API (um endereço secreto por empresa), a Meta manda tudo de
// todas as lojas para o endereço do APP do Norte. Então:
//
//   • quem prova que o POST veio da Meta é a ASSINATURA: HMAC-SHA256 do corpo
//     cru com a chave secreta do app (META_APP_SECRET), em tempo constante.
//     Sem ela, ou errada: 401, antes de ler o JSON e antes do banco;
//   • de quem é cada mensagem diz o `phone_number_id` do número que a
//     recebeu. A empresa sai da PORTARIA (./portaria.ts › org_do_numero_meta),
//     que só aceita o id exato e devolve id e slug — o `app_norte` não ganha
//     leitura nenhuma entre empresas. Daí em diante, tudo é `comoOrg` dela;
//   • a porta de cada empresa continua sendo o `canal` do Agente: se ele não
//     está em META (a loja desconectou), o que chegar para ela é descartado.
//
// ── o mesmo caminho das outras portas ────────────────────────
// Mensagem de cliente ou da equipe → `processarMensagem` (campanhas para
// cliente, assistente para a equipe). O que a loja mandou pelo app WhatsApp
// Business (coexistência, `smb_message_echoes`) → `marcarHumano`. Nada de
// regra duplicada aqui: esta porta só traduz o formato da Meta.
//
// ── responder rápido, trabalhar depois ───────────────────────
// A rota responde 200 na hora e entrega o trabalho ao `after()` do Next: a
// Meta reenvia o que demora a ser confirmado (por até 7 dias). Reenvio não
// duplica nada — a mensagem é gravada pelo id dela (wamid) e a segunda
// entrega volta 'duplicada'.

import { comoOrg } from '../banco'
import { marcarHumano, processarMensagem, type Dependencias, type Desfecho } from './conversa'
import { escolherCanal, SELECT_LINHA, type Canal } from './canal'
import { CanalMeta } from './meta'
import { assinaturaConfere, lerConfigMeta, lerWebhookMeta, respostaDoDesafio, semSegredo, type EventoMeta } from './meta-regras'
import { empresaDoNumeroMeta } from './portaria'

/** A verificação do endereço (GET). 404 com a Meta desligada: a porta nem existe. */
export function verificarWebhookMeta(params: URLSearchParams): { status: 200 | 403 | 404; corpo: string } {
  const cfg = lerConfigMeta()
  if (!cfg) return { status: 404, corpo: '' }
  const desafio = respostaDoDesafio(params, cfg.verifyToken)
  return desafio ? { status: 200, corpo: desafio } : { status: 403, corpo: '' }
}

export type PortaMeta = {
  status: 200 | 400 | 401 | 404
  trabalho?: () => Promise<ResumoMeta>
}

export type ResumoMeta = { mensagens: number; ecos: number; status: number; descartados: number; desfechos: Desfecho[] }

export type DependenciasMeta = Omit<Dependencias, 'canal'> & {
  /** Nos testes: um canal de mentira no lugar do da empresa. */
  canal?: Canal
  /** Nos testes: a portaria. */
  acharEmpresa?: (phoneNumberId: string) => Promise<{ id: string; slug: string } | null>
}

/** A decisão da porta (POST): assinatura, corpo, e o trabalho para depois. */
export function receberWebhookMeta(bruto: string, assinatura: string | null, deps: DependenciasMeta = {}): PortaMeta {
  const cfg = lerConfigMeta()
  if (!cfg) return { status: 404 }
  if (!assinaturaConfere(bruto, assinatura, cfg.appSecret)) return { status: 401 }
  let corpo: unknown
  try {
    corpo = JSON.parse(bruto)
  } catch {
    return { status: 400 }
  }
  const eventos = lerWebhookMeta(corpo)
  return { status: 200, trabalho: () => processarEventos(eventos, deps) }
}

/**
 * Processa os eventos em ordem, agrupados pelo número que recebeu. Um número
 * que não é de ninguém (ou de empresa que desconectou) é descartado inteiro;
 * um evento que quebra não leva os outros junto.
 */
export async function processarEventos(eventos: EventoMeta[], deps: DependenciasMeta = {}): Promise<ResumoMeta> {
  const resumo: ResumoMeta = { mensagens: 0, ecos: 0, status: 0, descartados: 0, desfechos: [] }
  const acharEmpresa = deps.acharEmpresa ?? empresaDoNumeroMeta
  const porNumero = new Map<string, EventoMeta[]>()

  for (const e of eventos) {
    if (e.tipo === 'ignorar') {
      resumo.descartados++
      continue
    }
    if (e.tipo === 'modelo') {
      // A tela lê a situação dos modelos direto da Meta; aqui é só o rastro.
      console.info(`[whatsapp-meta] modelo "${e.nome}" (${e.idioma ?? '?'}) na conta ${e.wabaId ?? '?'}: ${e.evento}${e.motivo ? ` — ${e.motivo}` : ''}`)
      continue
    }
    if (e.tipo === 'conta') {
      console.info(`[whatsapp-meta] conta ${e.wabaId ?? '?'}: ${e.evento}`)
      continue
    }
    const lista = porNumero.get(e.phoneNumberId) ?? []
    lista.push(e)
    porNumero.set(e.phoneNumberId, lista)
  }

  for (const [phoneNumberId, doNumero] of porNumero) {
    try {
      const org = await acharEmpresa(phoneNumberId)
      if (!org) {
        resumo.descartados += doNumero.length
        console.warn(`[whatsapp-meta] número ${phoneNumberId} não é de nenhuma empresa conectada; ${doNumero.length} evento(s) descartado(s)`)
        continue
      }
      const agente = await comoOrg(org.id, (db) =>
        db.agente.findUnique({ where: { orgId: org.id }, select: { id: true, canal: true, ...SELECT_LINHA } }),
      )
      // A porta desta empresa: só com o canal ligado no oficial, e para ESTE número.
      if (!agente || agente.canal !== 'META' || agente.metaPhoneNumberId !== phoneNumberId) {
        resumo.descartados += doNumero.length
        continue
      }
      const canal = deps.canal ?? escolherCanal(org, agente).canal

      for (const e of doNumero) {
        try {
          if (e.tipo === 'status') {
            resumo.status++
            // Rastro de entrega: o número vai mascarado, o id da mensagem
            // encurtado. A falha sai com o código da Meta (131047 = janela
            // fechada, 131026 = sem WhatsApp...), que é o que explica o porquê.
            if (e.status === 'failed') {
              console.warn(
                `[whatsapp-meta] ${org.id}: envio …${e.idExterno.slice(-12)} para ${e.destino} FALHOU` +
                  (e.erro ? ` (código ${e.erro.codigo ?? '?'}: ${e.erro.titulo})` : ''),
              )
            } else {
              console.info(`[whatsapp-meta] ${org.id}: envio …${e.idExterno.slice(-12)} para ${e.destino}: ${e.status}`)
            }
            continue
          }
          if (e.tipo === 'humano') {
            resumo.ecos++
            await marcarHumano(org.id, agente.id, e.telefone)
            continue
          }
          if (e.tipo !== 'mensagem') continue
          resumo.mensagens++
          const d = await processarMensagem(
            { orgId: org.id, telefone: e.telefone, nome: e.nome, texto: e.texto, idExterno: e.idExterno, anuncioId: e.anuncioId },
            { ...deps, canal },
          )
          resumo.desfechos.push(d)
          // Os tiques azuis só quando o Norte de fato tratou a mensagem.
          // Mensagem de cliente que ficou para a loja responder continua
          // "entregue" — quem lê é a pessoa da loja, e o tique é dela.
          if ((d.tipo === 'respondida' || d.tipo === 'campanha' || d.tipo === 'recado') && canal instanceof CanalMeta) {
            await canal.marcarLida(e.idExterno)
          }
        } catch (erro) {
          console.error(`[whatsapp-meta] ${org.id}: falhou ao processar um evento:`, semSegredo(erro instanceof Error ? erro.message : String(erro)))
        }
      }
    } catch (erro) {
      console.error(`[whatsapp-meta] número ${phoneNumberId}:`, semSegredo(erro instanceof Error ? erro.message : String(erro)))
    }
  }
  return resumo
}
