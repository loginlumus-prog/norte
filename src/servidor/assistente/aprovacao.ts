// A equipe pede, o dono aprova — o caminho do pedido pelo WhatsApp.
//
// ── a decisão ────────────────────────────────────────────────
// O que o assistente propõe, só o DONO confirma (ver `ehDono` em poderes.ts e
// `responderProposta` em agente.ts). Mas quem está no balcão quando o
// fornecedor entrega, quando o cliente pede a encomenda, quando o freezer
// derrete, é a equipe. Então qualquer pessoa da equipe pode PEDIR pelo
// assistente; o pedido vira proposta, e a proposta vai para o dono.
//
// ── o caminho ────────────────────────────────────────────────
//   1. a balconista pede ("perdi 3 picolés, derreteram");
//   2. a ferramenta monta a proposta (sem escrever nada), com o resumo do
//      SERVIDOR e o código ("KP42");
//   3. `encaminharAosDonos` manda a cada dono com telefone confirmado: quem
//      pediu, o resumo e "Responda SIM KP42 ou NÃO KP42";
//   4. a balconista lê que o pedido foi para o dono (`fechoDoPedido`);
//   5. o dono responde no WhatsApp (respostas.ts) ou na tela — e quem pediu
//      recebe o desfecho (`avisarQuemPediu`).
//
// ── quem recebe ──────────────────────────────────────────────
// Os mesmos do relatório das 8h e do aviso de crédito: dono ativo com o
// telefone CONFIRMADO pela própria pessoa (`donosComTelefone`). Número só
// digitado não recebe pedido de aprovação — um dígito errado mandaria o
// pedido (e o SIM) para um desconhecido.
//
// Toda mensagem sai por `enviarEGravar` — a mesma porta, o mesmo teto do dia —
// com o modelo aprovado do aviso para o WhatsApp oficial fora da janela de
// 24 horas (o dono quase nunca escreveu para o número da loja no dia).

import type { Agente } from '@prisma/client'
import { comoOrg } from '../banco'
import type { Resposta } from '../agente'
import type { Sessao } from '../permissao'
import { canalPara, type Canal } from './canal'
import { abrirConversa, donosComTelefone, enviarEGravar } from './contexto'
import { SELECT_TELEFONE, telefoneValido } from './confirmacao'
import { modeloDeAviso } from './meta-regras'
import { codigoDaProposta } from './propostas'
import type { Equipe } from './regras'

/** O começo da mensagem que leva o pedido ao dono. É por ele que o SIM acha o pedido. */
export const PREFIXO_PEDIDO_AO_DONO = '*Pedido para aprovar*'

/** O código dentro do pedido encaminhado ("Responda *SIM KP42*"). */
const CODIGO_NO_PEDIDO = /\*SIM ([A-Z]{2}\d{2})\*/

type Org = { id: string; nome: string }
type Conversa = { id: string; telefone: string }

/** O texto que vai ao dono, para UMA proposta. */
export function textoDoPedido(quemPediu: string, p: { id: string; resumo: string }): string {
  const c = codigoDaProposta(p.id)
  return [
    `${PREFIXO_PEDIDO_AO_DONO} — ${quemPediu} pediu pelo assistente:`,
    p.resumo,
    `Responda *SIM ${c}* para aprovar ou *NÃO ${c}* para recusar.`,
  ].join('\n')
}

/**
 * Leva cada proposta que ainda espera a cada dono com telefone confirmado.
 * Quem pediu não recebe o próprio pedido (o dono que pede é o caminho de
 * sempre, e nem passa por aqui). Devolve quantos donos receberam ao menos
 * uma — zero quer dizer que o pedido ficou só na tela do assistente.
 *
 * Nunca levanta: o pedido já está gravado, e a falha de envio não pode
 * derrubar a resposta de quem pediu (que diz, então, que o dono aprova na
 * tela).
 */
export async function encaminharAosDonos(
  org: Org,
  agente: Pick<Agente, 'id' | 'orgId' | 'mensagensDia'>,
  quem: Equipe,
  ids: string[],
  canal: Canal,
): Promise<number> {
  if (ids.length === 0) return 0
  try {
    const vivas = await comoOrg(org.id, (db) =>
      db.propostaAgente.findMany({
        where: { id: { in: ids }, situacao: 'AGUARDANDO', respondidaEm: null },
        orderBy: { criadaEm: 'asc' },
        select: { id: true, resumo: true },
      }),
    )
    if (vivas.length === 0) return 0
    const donos = (await donosComTelefone(org.id)).filter((d) => d.usuarioId !== quem.sessao.usuarioId)
    let avisados = 0
    for (const dono of donos) {
      const conversa = await abrirConversa(org.id, agente.id, dono.telefone, { nome: dono.nome, daEquipe: true })
      let recebeu = false
      for (const p of vivas) {
        const texto = textoDoPedido(quem.nome, p)
        const saida = await enviarEGravar(canal, agente, conversa, texto, modeloDeAviso(org.nome, texto))
        recebeu ||= saida.enviada
      }
      if (recebeu) avisados++
    }
    return avisados
  } catch (erro) {
    console.error(`[assistente] ${org.id}: o pedido ao dono não saiu:`, erro instanceof Error ? erro.message : erro)
    return 0
  }
}

/**
 * O fim da mensagem de quem pediu (e não é dono): o resumo do SERVIDOR, o
 * código e para onde o pedido foi. É o `fechoDasPropostas` da equipe — lá o
 * dono confirma com SIM; aqui quem pediu só fica sabendo que espera, e pode
 * desistir com NÃO.
 */
export async function fechoDoPedido(orgId: string, ids: string[], donosAvisados: number): Promise<string> {
  if (ids.length === 0) return ''
  const vivas = await comoOrg(orgId, (db) =>
    db.propostaAgente.findMany({
      where: { id: { in: ids }, situacao: 'AGUARDANDO', respondidaEm: null },
      orderBy: { criadaEm: 'asc' },
      select: { id: true, resumo: true },
    }),
  )
  if (vivas.length === 0) return ''
  const onde =
    donosAvisados > 0
      ? 'Só o dono aprova: mandei para ele, e te aviso aqui quando ele responder.'
      : 'Só o dono aprova, e nenhum dono recebe pelo WhatsApp agora: ele aprova na tela do assistente.'
  const primeiro = codigoDaProposta(vivas[0]!.id)
  if (vivas.length === 1) {
    return [
      `*Pedido para o dono aprovar:* ${vivas[0]!.resumo}`,
      `Código *${primeiro}*. ${onde} Para desistir, responda *NÃO ${primeiro}*.`,
    ].join('\n')
  }
  return [
    '*Pedidos para o dono aprovar:*',
    ...vivas.map((p) => `• *${codigoDaProposta(p.id)}* — ${p.resumo}`),
    `${onde} Para desistir de um, responda NÃO e o código (ex.: *NÃO ${primeiro}*).`,
  ].join('\n')
}

/**
 * Os códigos dos pedidos que chegaram a ESTA conversa (a do dono) desde
 * `desde`. É o que deixa o "sim" sem código do dono valer para o pedido que
 * ele acabou de receber — e só para ele.
 */
export async function codigosEncaminhados(orgId: string, conversa: Conversa, desde: Date): Promise<Set<string>> {
  const linhas = await comoOrg(orgId, (db) =>
    db.mensagemAgente.findMany({
      where: { conversaId: conversa.id, de: 'AGENTE', texto: { startsWith: PREFIXO_PEDIDO_AO_DONO }, criadaEm: { gte: desde } },
      orderBy: { criadaEm: 'desc' },
      take: 20,
      select: { texto: true },
    }),
  )
  return new Set(linhas.map((l) => CODIGO_NO_PEDIDO.exec(l.texto)?.[1]).filter((c): c is string => !!c))
}

/** A frase do desfecho para quem pediu. Nula = não há o que avisar (o pedido nem foi respondido). */
export function textoDoDesfecho(
  quemRespondeu: string,
  p: { id: string; resumo: string },
  aceita: boolean,
  r: Resposta,
): string | null {
  const c = codigoDaProposta(p.id)
  if (r.ok) {
    return aceita
      ? `${quemRespondeu} aprovou o seu pedido *${c}*. Feito: ${r.feito ?? p.resumo}`
      : `${quemRespondeu} recusou o seu pedido *${c}*. Nada foi feito: ${p.resumo}`
  }
  if (r.motivo === 'falhou' && aceita) {
    return `${quemRespondeu} aprovou o seu pedido *${c}*, mas não deu para fazer: ${r.recado ?? 'o erro ficou marcado na tela do assistente.'}`
  }
  return null
}

/**
 * Depois do SIM (ou do NÃO) do dono: quem pediu fica sabendo pelo WhatsApp.
 * Só quando quem pediu é outra pessoa, ativa, com telefone confirmado — e só
 * com o assistente ligado. O canal vem de quem chama (a conversa do dono) ou,
 * pela tela, é o da empresa.
 *
 * Nunca levanta: o que o dono decidiu já está feito, e o aviso é cortesia.
 */
export async function avisarQuemPediu(
  org: Org & { slug: string },
  propostaId: string,
  quemRespondeu: Pick<Sessao, 'usuarioId' | 'nome'>,
  aceita: boolean,
  r: Resposta,
  canal?: Canal,
): Promise<boolean> {
  try {
    const achado = await comoOrg(org.id, async (db) => {
      const proposta = await db.propostaAgente.findUnique({
        where: { id: propostaId },
        select: { id: true, resumo: true, usuarioId: true },
      })
      if (!proposta?.usuarioId || proposta.usuarioId === quemRespondeu.usuarioId) return null
      const pessoa = await db.usuario.findUnique({
        where: { id: proposta.usuarioId },
        select: { nome: true, ativo: true, ...SELECT_TELEFONE },
      })
      const agente = await db.agente.findUnique({ where: { orgId: org.id } })
      return { proposta, pessoa, agente }
    })
    if (!achado?.pessoa?.ativo || !achado.pessoa.telefone || !telefoneValido(achado.pessoa)) return false
    if (!achado.agente?.ativo) return false
    const texto = textoDoDesfecho(quemRespondeu.nome, achado.proposta, aceita, r)
    if (!texto) return false
    const saida = canal ?? (await canalPara(org))
    const conversa = await abrirConversa(org.id, achado.agente.id, achado.pessoa.telefone, {
      nome: achado.pessoa.nome,
      daEquipe: true,
    })
    const s = await enviarEGravar(saida, achado.agente, conversa, texto, modeloDeAviso(org.nome, texto))
    return s.enviada
  } catch (erro) {
    console.error(`[assistente] ${org.id}: o aviso a quem pediu não saiu:`, erro instanceof Error ? erro.message : erro)
    return false
  }
}
