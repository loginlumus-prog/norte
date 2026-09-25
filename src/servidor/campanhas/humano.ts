// "Uma pessoa da loja está conversando com este número."
//
// O estado mora num lugar só: `ConversaAgente.humanoAte`, o mesmo campo que
// o roteamento grava quando alguém da loja escreve pelo celular (ver
// `marcarHumano` em assistente/conversa.ts) e que cala o recado automático.
// As campanhas LEEM esse campo — enquanto ele estiver no futuro, nenhuma
// campanha começa, e a que estava viva é encerrada ('humano_assumiu'): uma
// pessoa conversando manda mais do que o roteiro — e ESCREVEM nele quando o
// bloco "Passar para uma pessoa" chama a equipe. Nada de segundo estado.
//
// Grava com o mesmo UPDATE de `marcarHumano` (abrir a conversa pela chave do
// telefone, empurrar `humanoAte` para 24 h à frente), sem importar
// conversa.ts: ela importa as campanhas, e a volta faria um ciclo.

import { comoOrg } from '../banco'
import { abrirConversa } from '../assistente/contexto'
import { humanoAteDepoisDe } from '../assistente/recado'
import { chaveTelefone } from '../assistente/telefone'

/** Uma pessoa da loja está com a conversa agora? PURO. */
export const humanoNoComando = (humanoAte: Date | null | undefined, agora: Date): boolean =>
  !!humanoAte && humanoAte.getTime() > agora.getTime()

/** Até quando uma pessoa da loja está com este telefone (a maior marca entre as conversas dele). */
export async function humanoAteDoTelefone(orgId: string, chave: string): Promise<Date | null> {
  const linhas = await comoOrg(orgId, (db) =>
    db.conversaAgente.findMany({
      where: { telefone: { endsWith: chave.slice(-8) }, humanoAte: { not: null } },
      select: { telefone: true, humanoAte: true },
    }),
  )
  let maior: Date | null = null
  for (const l of linhas) {
    if (chaveTelefone(l.telefone) !== chave || !l.humanoAte) continue
    if (!maior || l.humanoAte > maior) maior = l.humanoAte
  }
  return maior
}

/** A campanha chamou uma pessoa: o mesmo carimbo de quando a loja escreve pelo celular. */
export async function marcarComHumano(orgId: string, telefone: string, agora: Date): Promise<void> {
  const agente = await comoOrg(orgId, (db) => db.agente.findUnique({ where: { orgId }, select: { id: true } }))
  if (!agente) return
  const conversa = await abrirConversa(orgId, agente.id, telefone, {})
  await comoOrg(orgId, (db) =>
    db.conversaAgente.update({ where: { id: conversa.id }, data: { humanoAte: humanoAteDepoisDe(agora) } }),
  )
}
