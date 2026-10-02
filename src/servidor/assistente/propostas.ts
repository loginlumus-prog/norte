// A proposta vista da CONVERSA: o código curto que a pessoa responde, a
// proposta corrigida que aposenta a anterior, e o fecho fixo da mensagem.
//
// ── o código ─────────────────────────────────────────────────
// A lista numerada ("sim 1", "sim 2") mudava de número a cada resposta: com
// três propostas, "sim 1" confirmava a primeira, a lista encolhia, e o "sim 2"
// que a pessoa digitou olhando a lista ANTIGA executava a terceira. Agora cada
// proposta tem um código que não muda (duas letras e dois números, "KP42"),
// tirado do próprio id — nada a guardar, e o mesmo código na tela, na lista e
// no fecho da mensagem.
//
// ── a correção aposenta a anterior ───────────────────────────
// "Comprei 10 kg de picanha" → proposta; "não, são 12" → outra proposta. As
// duas ficavam esperando, e confirmar as duas punha 22 kg no estoque. A
// proposta nova do MESMO tipo, da MESMA pessoa, vence as que ela deixou
// esperando (EXPIRADA, com o motivo escrito).
//
// ── o fecho fixo ─────────────────────────────────────────────
// O SIM confirma a proposta do SERVIDOR, mas a pessoa lê o texto do MODELO —
// e o modelo pode descrever outra coisa ("10 kg" quando a proposta diz 12).
// Então o resumo que vale vai no fim da mensagem, escrito pelo servidor,
// com o código. O que a pessoa confirma é o que ela leu.

import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { comoOrg } from '../banco'

/** Sem I, L, O e Q: não se confundem com 1 e 0 no WhatsApp. */
const LETRAS = 'ABCDEFGHJKMNPRSTUVWXYZ'

/** "KP42": o código curto e fixo da proposta, tirado do id. */
export function codigoDaProposta(id: string): string {
  const h = createHash('sha256').update(`proposta:${id}`).digest()
  const n = ((h[2]! << 8) | h[3]!) % 100
  return `${LETRAS[h[0]! % LETRAS.length]}${LETRAS[h[1]! % LETRAS.length]}${String(n).padStart(2, '0')}`
}

/**
 * A proposta nova vence as que a mesma pessoa deixou esperando, do mesmo
 * tipo. `mesmoAlvo` estreita: a encomenda A aceita não aposenta o aceite da
 * encomenda B. Devolve quantas aposentou, para a ferramenta contar ao modelo.
 */
export async function aposentarAnteriores(
  orgId: string,
  p: { usuarioId: string; poder: string; novaId: string; mesmoAlvo?: { campo: string; valor: string } },
): Promise<number> {
  const where: Prisma.PropostaAgenteWhereInput = {
    usuarioId: p.usuarioId,
    poder: p.poder,
    situacao: 'AGUARDANDO',
    respondidaEm: null,
    id: { not: p.novaId },
    ...(p.mesmoAlvo ? { dados: { path: [p.mesmoAlvo.campo], equals: p.mesmoAlvo.valor } } : {}),
  }
  const r = await comoOrg(orgId, (db) =>
    db.propostaAgente.updateMany({
      where,
      data: {
        situacao: 'EXPIRADA',
        respondidaEm: new Date(),
        quemRespondeu: 'Assistente',
        erro: `Substituída pela proposta ${codigoDaProposta(p.novaId)}.`,
      },
    }),
  )
  return r.count
}

/**
 * O fim da mensagem quando o laço criou proposta: o resumo do SERVIDOR e o
 * código, escritos aqui — nunca deixados ao modelo. Só as que ainda esperam
 * (a corrigida no mesmo laço já saiu).
 */
export async function fechoDasPropostas(orgId: string, ids: string[]): Promise<string> {
  if (ids.length === 0) return ''
  const vivas = await comoOrg(orgId, (db) =>
    db.propostaAgente.findMany({
      where: { id: { in: ids }, situacao: 'AGUARDANDO', respondidaEm: null },
      orderBy: { criadaEm: 'asc' },
      select: { id: true, resumo: true },
    }),
  )
  if (vivas.length === 0) return ''
  if (vivas.length === 1) {
    const c = codigoDaProposta(vivas[0]!.id)
    return `*Para confirmar:* ${vivas[0]!.resumo}\nResponda *SIM ${c}* para confirmar ou *NÃO ${c}* para cancelar.`
  }
  return [
    '*Para confirmar:*',
    ...vivas.map((p) => `• *${codigoDaProposta(p.id)}* — ${p.resumo}`),
    `Responda SIM e o código (ex.: *SIM ${codigoDaProposta(vivas[0]!.id)}*) para confirmar, ou NÃO e o código para cancelar.`,
  ].join('\n')
}

/** O que a ferramenta diz ao modelo depois de propor: o fecho é do servidor. */
export const RECADO_DO_FECHO =
  'O resumo exato e o código de confirmação vão anexados pelo sistema ao fim da sua mensagem: ' +
  'não repita o resumo nem peça o SIM você mesmo — diga em uma frase curta o que montou.'
