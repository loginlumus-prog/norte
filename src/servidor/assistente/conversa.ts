// O laço da conversa: chega uma mensagem, sai (ou não) uma resposta.
//
// A ordem das conferências é a ordem do que é mais barato recusar:
//
//   1. a empresa pode ter assistente agora?        (plano, módulo, ligado)
//   2. esta mensagem já foi processada?            (o mesmo id, de novo)
//   3. tem gente da loja atendendo esta conversa?  (ele cala)
//   4. ainda cabe mensagem hoje, nesta conversa?
//   5. tem chave, crédito e teto de gasto?         (sem isso a IA nem é chamada)
//
// Só depois disso o modelo entra. E quando entra, recebe SÓ as ferramentas
// que a empresa ligou, que o módulo permite, que servem para quem fala e que
// a pessoa do outro lado poderia usar na tela. O que ele pedir fora disso
// volta como erro — e nada é executado.
//
// ── erro nunca vaza ──────────────────────────────────────────
// Falha da IA vira uma frase educada para quem mandou a mensagem. Nome de
// modelo, status HTTP, corpo de erro, nome de ferramenta: nada disso chega ao
// WhatsApp. O detalhe fica no log do servidor.

import { createHash } from 'node:crypto'
import type { Agente } from '@prisma/client'
import { comoOrg } from '../banco'
import { inicioDeHojeEmSP } from '../dia'
import { podeGastarHoje, paraConfig } from '../agente'
import {
  conversarComFerramentas,
  FalhaIA,
  RECADO_FALHA_ASSISTENTE,
  temChaveIA,
  type BlocoPergunta,
  type BlocoResposta,
  type MensagemAPI,
} from '../ia'
import type { Canal } from './canal'
import {
  abrirConversa,
  acharInterlocutor,
  carregarContexto,
  donosComTelefone,
  empresaApta,
  enviarEGravar,
  registrarConsumoIA,
  type Contexto,
} from './contexto'
import { agoraEmSP, ferramentasParaModelo, montarSistema, poderDaFerramenta, poderesDaConversa, type Interlocutor } from './regras'
import { executarFerramenta } from './ferramentas'
import { mesmoTelefone } from './telefone'

/** Voltas de ferramenta por mensagem. Mais que isso é o modelo andando em círculo. */
export const MAXIMO_VOLTAS = 5
/** Mensagens do histórico que voltam para o modelo. O resto custa e não ajuda. */
const HISTORICO = 20
/** Respostas por conversa por dia. Um robô do outro lado não passa daqui. */
export const MAXIMO_POR_CONVERSA_DIA = 40
/** Texto que chega além disto é cortado: ninguém digita 4 mil letras no WhatsApp. */
const MAXIMO_ENTRADA = 4000

export const RECADO_CLIENTE_SEM_ASSISTENTE =
  'Oi! Recebi sua mensagem. Alguém da loja te responde assim que puder.'
export const PREFIXO_AVISO_DONO = 'Aviso do assistente:'
const RECADO_RECUSA = 'Com isso eu não consigo ajudar por aqui. Alguém da loja pode te responder.'
const RECADO_VOLTAS = 'Me enrolei com esse pedido. Pode me dizer de outro jeito, mais curto?'

export type Entrada = {
  orgId: string
  /** Como o WhatsApp entregou: 55 + DDD + número. */
  telefone: string
  /** O nome que a pessoa usa no WhatsApp. Não prova nada — só enfeita. */
  nome: string | null
  texto: string
  /** O id da mensagem no provedor. É o que torna a entrega repetida inofensiva. */
  idExterno: string
}

export type Dependencias = {
  canal: Canal
  /** A API da Anthropic. Nos testes, uma de mentira. */
  buscar?: typeof fetch
}

export type Desfecho =
  | { tipo: 'ignorada'; motivo: 'empresa' | 'humano' | 'teto_conversa' }
  | { tipo: 'duplicada' }
  | { tipo: 'recusada'; motivo: 'sem_chave' | 'sem_credito' | 'teto_do_dia' | 'sem_agente' }
  | { tipo: 'respondida'; texto: string; enviada: boolean; propostas: string[] }

/**
 * O id da mensagem no NOSSO banco sai do id do provedor.
 *
 * É o próprio identificador da mensagem — a mesma mensagem, o mesmo id — e a
 * chave primária faz o resto: a segunda entrega bate no índice e não grava.
 * O resumo (e não o id cru) porque o id do provedor não é nosso: pode ter
 * qualquer tamanho e qualquer caractere.
 */
export const idDaMensagem = (orgId: string, idExterno: string) =>
  'wa_' + createHash('sha256').update(`${orgId}:${idExterno}`).digest('hex').slice(0, 32)

export async function processarMensagem(e: Entrada, deps: Dependencias): Promise<Desfecho> {
  const ctx = await carregarContexto(e.orgId)
  if (!ctx || !empresaApta(ctx)) return { tipo: 'ignorada', motivo: 'empresa' }
  const agente = ctx.agente

  const { quem, clienteId } = await acharInterlocutor(e.orgId, e.telefone, e.nome)
  const conversa = await abrirConversa(e.orgId, agente.id, e.telefone, {
    nome: quem.tipo === 'equipe' ? quem.nome : e.nome,
    daEquipe: quem.tipo === 'equipe',
    clienteId,
  })

  // ── 2. idempotência ──────────────────────────────────────
  // `skipDuplicates` é ON CONFLICT DO NOTHING: a entrega repetida não
  // levanta erro (erro dentro da transação a deixaria inutilizável), só
  // volta zero linhas.
  const texto = e.texto.trim().slice(0, MAXIMO_ENTRADA)
  const gravadas = await comoOrg(e.orgId, (db) =>
    db.mensagemAgente.createMany({
      data: [{ id: idDaMensagem(e.orgId, e.idExterno), orgId: e.orgId, conversaId: conversa.id, de: 'PESSOA', texto }],
      skipDuplicates: true,
    }),
  )
  if (gravadas.count === 0) return { tipo: 'duplicada' }

  // ── 3. gente da loja atendendo ───────────────────────────
  if (conversa.humanoAte && conversa.humanoAte > new Date()) return { tipo: 'ignorada', motivo: 'humano' }

  // ── 4. teto da conversa ──────────────────────────────────
  // O dia é o de São Paulo, não o da máquina (ver `inicioDeHojeEmSP`).
  const inicio = inicioDeHojeEmSP()
  const respondidasHoje = await comoOrg(e.orgId, (db) =>
    db.mensagemAgente.count({ where: { conversaId: conversa.id, de: 'AGENTE', criadaEm: { gte: inicio } } }),
  )
  if (respondidasHoje >= MAXIMO_POR_CONVERSA_DIA) return { tipo: 'ignorada', motivo: 'teto_conversa' }

  // ── 5. chave, crédito, teto de gasto ─────────────────────
  // Antes da chamada, sempre. Depois da chamada o dinheiro já foi.
  const veredito = await podeGastarHoje(e.orgId)
  const semChave = !temChaveIA()
  if (semChave || !veredito.pode) {
    const motivo = semChave ? 'sem_chave' : (veredito.motivo as 'sem_credito' | 'teto_do_dia' | 'sem_agente')
    const recado = semChave
      ? 'O assistente está sem a chave de IA configurada no servidor. Fale com o suporte do Norte.'
      : veredito.recado
    await recusarSemIA(ctx, agente, deps.canal, quem, conversa, recado)
    return { tipo: 'recusada', motivo }
  }

  // ── o modelo ─────────────────────────────────────────────
  const poderes = poderesDaConversa(paraConfig(agente), ctx.org, quem)
  const ferramentas = ferramentasParaModelo(poderes)
  const sistema = montarSistema(agente, ctx.loja, quem)
  const mensagens = await historicoParaModelo(e.orgId, conversa.id, texto)

  const propostas: string[] = []
  let resposta = ''
  try {
    for (let volta = 0; ; volta++) {
      if (volta >= MAXIMO_VOLTAS) {
        resposta = RECADO_VOLTAS
        break
      }
      // A partir da segunda volta, confere de novo: o laço de ferramentas é
      // justamente onde um defeito queima dinheiro em sequência.
      if (volta > 0 && !(await podeGastarHoje(e.orgId)).pode) {
        resposta = RECADO_FALHA_ASSISTENTE
        break
      }

      const r = await conversarComFerramentas({
        modelo: agente.modelo,
        sistema,
        ferramentas,
        mensagens,
        // WhatsApp é conversa curta: esforço baixo responde mais rápido e
        // gasta menos, e continua chamando ferramenta quando precisa.
        esforco: 'low',
        buscar: deps.buscar,
      })
      await registrarConsumoIA(e.orgId, agente.id, r.modelo, r.uso)

      if (r.parada === 'refusal') {
        resposta = RECADO_RECUSA
        break
      }

      const pedidos = r.conteudo.filter(
        (b): b is Extract<BlocoResposta, { type: 'tool_use' }> => b.type === 'tool_use',
      )
      if (r.parada !== 'tool_use' || pedidos.length === 0) {
        resposta = textoDe(r.conteudo) || RECADO_FALHA_ASSISTENTE
        break
      }

      // O turno do modelo volta INTEIRO, com o pensamento dele: tirar bloco
      // quebra a assinatura e a próxima chamada é recusada.
      mensagens.push({ role: 'assistant', content: r.conteudo })

      const resultados: BlocoPergunta[] = []
      for (const pedido of pedidos) {
        const poder = poderDaFerramenta(pedido.name)
        // A trava: pediu o que não estava na mesa, recebe erro. Nome
        // inventado, poder desligado, poder de equipe em conversa de cliente
        // — tudo cai aqui, e nada é executado.
        if (!poder || !poderes.includes(poder)) {
          console.warn(`[assistente] ${e.orgId}: modelo pediu ferramenta fora da mesa`)
          resultados.push({
            type: 'tool_result',
            tool_use_id: pedido.id,
            content: 'Ferramenta indisponível nesta conversa. Diga à pessoa que isso não é possível por aqui.',
            is_error: true,
          })
          continue
        }
        const entrada = pedido.input && typeof pedido.input === 'object' ? (pedido.input as Record<string, unknown>) : {}
        const res = await executarFerramenta(e.orgId, ctx.org, quem, poder, entrada)
        if (res.propostaId) propostas.push(res.propostaId)
        resultados.push({ type: 'tool_result', tool_use_id: pedido.id, content: res.texto, ...(res.erro ? { is_error: true } : {}) })
      }
      // Todos os resultados numa mensagem só: separar ensina o modelo a
      // parar de pedir em paralelo.
      mensagens.push({ role: 'user', content: resultados })
    }
  } catch (erro) {
    if (!(erro instanceof FalhaIA)) {
      console.error(`[assistente] ${e.orgId}: o laço falhou:`, erro instanceof Error ? erro.message : erro)
    }
    resposta = RECADO_FALHA_ASSISTENTE
  }

  const saida = await enviarEGravar(deps.canal, agente, conversa, resposta)
  return { tipo: 'respondida', texto: resposta, enviada: saida.enviada, propostas }
}

const textoDe = (blocos: BlocoResposta[]) =>
  blocos
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()

/**
 * O histórico como o modelo espera: alternando pessoa e assistente, e
 * começando pela pessoa.
 *
 * A hora vai só na ÚLTIMA mensagem, e não no sistema: o prefixo inteiro da
 * conversa fica igual entre uma mensagem e outra, e é esse prefixo igual que
 * o cache relê por um décimo do preço.
 */
async function historicoParaModelo(orgId: string, conversaId: string, atual: string): Promise<MensagemAPI[]> {
  const linhas = await comoOrg(orgId, (db) =>
    db.mensagemAgente.findMany({
      where: { conversaId, de: { in: ['PESSOA', 'AGENTE'] } },
      orderBy: { criadaEm: 'desc' },
      take: HISTORICO + 1,
      select: { de: true, texto: true },
    }),
  )
  // A mais recente é a que acabou de chegar; ela entra com a hora, no fim.
  const anteriores = linhas.slice(1).reverse()
  const msgs: MensagemAPI[] = anteriores.map((m) =>
    m.de === 'PESSOA' ? { role: 'user', content: m.texto } : { role: 'assistant', content: m.texto },
  )
  // A conversa pode ter começado por ELE (o relatório das 8h). A API exige
  // que a primeira fala seja da pessoa; em vez de jogar fora o relatório —
  // que é exatamente o assunto quando a dona responde "e por que caiu?" —
  // abre-se com uma linha que diz o que aconteceu.
  if (msgs[0]?.role === 'assistant') {
    msgs.unshift({ role: 'user', content: '(a conversa começou com uma mensagem automática do assistente)' })
  }
  msgs.push({ role: 'user', content: `[${agoraEmSP(new Date())}]\n${atual}` })
  return msgs
}

/**
 * Sem IA: nada de modelo, e cada um recebe o recado que lhe cabe.
 *
 * O cliente ouve uma frase neutra, UMA vez por dia por conversa — ele não
 * tem nada a ver com o crédito da loja, e dizer "acabou o crédito" a ele
 * seria expor a loja. Quem é da equipe ouve o motivo de verdade. E o dono é
 * avisado, uma vez por dia, porque é o único que resolve.
 */
async function recusarSemIA(
  ctx: Contexto,
  agente: Agente,
  canal: Canal,
  quem: Interlocutor,
  conversa: { id: string; telefone: string },
  recado: string,
) {
  const inicio = inicioDeHojeEmSP()

  if (quem.tipo === 'equipe') {
    await enviarEGravar(canal, agente, conversa, recado)
  } else {
    const jaAvisado = await comoOrg(ctx.org.id, (db) =>
      db.mensagemAgente.count({
        where: { conversaId: conversa.id, de: 'AGENTE', texto: RECADO_CLIENTE_SEM_ASSISTENTE, criadaEm: { gte: inicio } },
      }),
    )
    if (jaAvisado === 0) await enviarEGravar(canal, agente, conversa, RECADO_CLIENTE_SEM_ASSISTENTE)
  }

  const aviso = `${PREFIXO_AVISO_DONO} ${recado} Enquanto isso, quem manda mensagem para a loja fica sem resposta automática.`
  const jaFoi = await comoOrg(ctx.org.id, (db) =>
    db.mensagemAgente.count({
      where: { de: 'AGENTE', texto: { startsWith: PREFIXO_AVISO_DONO }, criadaEm: { gte: inicio } },
    }),
  )
  if (jaFoi > 0) return

  for (const dono of await donosComTelefone(ctx.org.id)) {
    // O dono que acabou de mandar a mensagem já recebeu o motivo acima.
    if (quem.tipo === 'equipe' && mesmoTelefone(dono.telefone, conversa.telefone)) continue
    const c = await abrirConversa(ctx.org.id, agente.id, dono.telefone, { nome: dono.nome, daEquipe: true })
    await enviarEGravar(canal, agente, c, aviso)
  }
}
