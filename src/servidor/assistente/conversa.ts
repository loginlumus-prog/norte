// O laço da conversa: chega uma mensagem, e o caminho depende de QUEM mandou.
//
//   EQUIPE  — telefone de um usuário ativo (ver `acharInterlocutor`). Vai para
//             o assistente de IA, com as ferramentas que a pessoa usaria na
//             tela: o dono pergunta, confere, pede proposta.
//   CLIENTE — NUNCA chega ao modelo. A mensagem vai para as campanhas
//             (`campanhas/entrada.ts`: roteiro com começo e fim, que o
//             próprio cliente dispara com a palavra-chave ou pelo anúncio).
//             Se nenhuma campanha tratou, o assistente fica calado — quem
//             responde é uma pessoa da loja, no WhatsApp da loja. A única
//             exceção é o recado fixo, se a loja ligou (ver `recado.ts`).
//
// ── por que cliente não conversa com a IA ────────────────────
// Decisão de produto, e ela é a mais barata de cumprir: conversa livre com
// cliente é custo por mensagem que a loja não controla, resposta que a loja
// não leu antes e um atendimento que compete com o da própria equipe. Então
// não existe prompt de cliente, nem ferramenta de cliente — o caminho não
// existe, e o que não existe não precisa de trava.
//
// ── a ordem das conferências (para a equipe) ─────────────────
// É a ordem do que é mais barato recusar:
//
//   1. a empresa pode ter assistente agora?        (plano, módulo, ligado)
//   2. esta mensagem já foi processada?            (o mesmo id, de novo)
//   3. ainda cabe mensagem hoje, nesta conversa?
//   4. tem chave, crédito e teto de gasto?         (sem isso a IA nem é chamada)
//
// Só depois disso o modelo entra. E quando entra, recebe SÓ as ferramentas
// que a empresa ligou, que o módulo permite e que a pessoa do outro lado
// poderia usar na tela. O que ele pedir fora disso volta como erro — e nada
// é executado.
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
import { receberDeCliente, testeVivo } from '../campanhas/entrada'
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
import { agoraEmSP, ferramentasParaModelo, montarSistema, poderDaFerramenta, poderesDaConversa, type Equipe } from './regras'
import { executarFerramenta } from './ferramentas'
import { decidirRecado, humanoAteDepoisDe, recadoDe, type DecisaoRecado } from './recado'
import { mesmoTelefone } from './telefone'

/** Voltas de ferramenta por mensagem. Mais que isso é o modelo andando em círculo. */
export const MAXIMO_VOLTAS = 5
/** Mensagens do histórico que voltam para o modelo. O resto custa e não ajuda. */
const HISTORICO = 20
/** Respostas por conversa por dia. Um robô do outro lado não passa daqui. */
export const MAXIMO_POR_CONVERSA_DIA = 40
/** Texto que chega além disto é cortado: ninguém digita 4 mil letras no WhatsApp. */
const MAXIMO_ENTRADA = 4000

export const PREFIXO_AVISO_DONO = 'Aviso do assistente:'
const RECADO_RECUSA = 'Com isso eu não consigo ajudar por aqui.'
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
  /** O anúncio de onde a pessoa veio (clique para o WhatsApp), quando o provedor diz. */
  anuncioId?: string | null
}

export type Dependencias = {
  canal: Canal
  /** A API da Anthropic. Nos testes, uma de mentira. */
  buscar?: typeof fetch
}

/** Cliente fora de campanha, e nada automático sai para ele. */
export type MotivoSilencio = Extract<DecisaoRecado, { manda: false }>['motivo'] | 'falha_campanha'

export type Desfecho =
  | { tipo: 'ignorada'; motivo: 'empresa' | 'teto_conversa' }
  | { tipo: 'duplicada' }
  // ── cliente ──
  | { tipo: 'campanha' }
  | { tipo: 'recado'; enviada: boolean }
  | { tipo: 'silencio'; motivo: MotivoSilencio }
  // ── equipe ──
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

  // ── idempotência ─────────────────────────────────────────
  // Vale para os dois caminhos: a entrega repetida não pode disparar a
  // campanha duas vezes, nem chamar o modelo duas vezes. `skipDuplicates` é
  // ON CONFLICT DO NOTHING: a entrega repetida não levanta erro (erro dentro
  // da transação a deixaria inutilizável), só volta zero linhas.
  const texto = e.texto.trim().slice(0, MAXIMO_ENTRADA)
  const gravadas = await comoOrg(e.orgId, (db) =>
    db.mensagemAgente.createMany({
      data: [{ id: idDaMensagem(e.orgId, e.idExterno), orgId: e.orgId, conversaId: conversa.id, de: 'PESSOA', texto }],
      skipDuplicates: true,
    }),
  )
  if (gravadas.count === 0) return { tipo: 'duplicada' }

  if (quem.tipo === 'cliente') {
    return atenderCliente(agente, conversa, { nome: quem.nome, texto, anuncioId: e.anuncioId ?? null }, deps.canal)
  }

  // O dono testando a própria campanha ("Testar com meu número"): o número
  // dele é de equipe, mas enquanto houver uma execução de TESTE viva para ele,
  // a resposta é do roteiro. Sem isto o teste que espera "sim" parava para
  // sempre, porque o "sim" ia para o assistente. Fora do teste, nada muda.
  if (await testeVivo(e.orgId, e.telefone)) {
    const r = await receberDeCliente({
      orgId: e.orgId,
      agenteId: agente.id,
      telefone: conversa.telefone,
      nome: quem.nome,
      texto,
      anuncioId: e.anuncioId ?? null,
      canal: deps.canal,
    })
    if (r.tratou) return { tipo: 'campanha' }
  }
  return conversarComEquipe(ctx, quem, conversa, texto, deps)
}

// ─────────────────────────────────────────────────────────────
// CLIENTE: campanha, recado fixo ou silêncio — nunca o modelo
// ─────────────────────────────────────────────────────────────

async function atenderCliente(
  agente: Agente,
  conversa: { id: string; telefone: string; humanoAte: Date | null },
  m: { nome: string | null; texto: string; anuncioId: string | null },
  canal: Canal,
): Promise<Desfecho> {
  const agora = new Date()

  // A campanha decide sozinha se a mensagem é dela (palavra-chave, anúncio,
  // passo de um roteiro em andamento). Ela vem ANTES da marca de "alguém da
  // loja escreveu": quem manda a palavra-chave pediu o roteiro.
  try {
    const r = await receberDeCliente({
      orgId: agente.orgId,
      agenteId: agente.id,
      telefone: conversa.telefone,
      nome: m.nome,
      texto: m.texto,
      anuncioId: m.anuncioId,
      canal,
      agora,
    })
    if (r.tratou) return { tipo: 'campanha' }
  } catch (erro) {
    // Na dúvida, calado: um recado por cima de uma campanha que quebrou no
    // meio confunde mais do que o silêncio — e a equipe vê a mensagem.
    console.error(`[assistente] ${agente.orgId}: a campanha falhou:`, erro instanceof Error ? erro.message : erro)
    return { tipo: 'silencio', motivo: 'falha_campanha' }
  }

  const recado = recadoDe(agente)
  // Sem recado ligado, nem consulta: o caso comum custa zero.
  const ultimaNossa = recado
    ? await comoOrg(agente.orgId, (db) =>
        db.mensagemAgente.findFirst({
          where: { conversaId: conversa.id, de: 'AGENTE' },
          orderBy: { criadaEm: 'desc' },
          select: { criadaEm: true },
        }),
      )
    : null
  const d = decidirRecado({ recado, humanoAte: conversa.humanoAte, ultimaNossa: ultimaNossa?.criadaEm ?? null, agora })
  if (!d.manda) return { tipo: 'silencio', motivo: d.motivo }

  const saida = await enviarEGravar(canal, agente, conversa, d.texto)
  return { tipo: 'recado', enviada: saida.enviada }
}

/**
 * Alguém da loja escreveu para esta pessoa pelo celular da loja.
 *
 * Guarda na própria conversa (`humanoAte`) até quando o recado fica calado:
 * 24 horas a partir de agora, empurradas a cada nova mensagem da loja. Não
 * mexe em "é da equipe ou não" — quem decide isso é o telefone de quem
 * MANDA, na próxima mensagem dele.
 *
 * O assistente da equipe não olha esta marca: a dona que escreve para o
 * número da loja está falando com o assistente, mesmo que alguém tenha
 * respondido a ela pelo celular antes.
 */
export async function marcarHumano(orgId: string, agenteId: string, telefone: string, agora = new Date()) {
  const conversa = await abrirConversa(orgId, agenteId, telefone, {})
  await comoOrg(orgId, (db) =>
    db.conversaAgente.update({ where: { id: conversa.id }, data: { humanoAte: humanoAteDepoisDe(agora) } }),
  )
}

// ─────────────────────────────────────────────────────────────
// EQUIPE: o assistente de IA
// ─────────────────────────────────────────────────────────────

async function conversarComEquipe(
  ctx: Contexto & { agente: Agente },
  quem: Equipe,
  conversa: { id: string; telefone: string },
  texto: string,
  deps: Dependencias,
): Promise<Desfecho> {
  const orgId = ctx.org.id
  const agente = ctx.agente

  // ── teto da conversa ─────────────────────────────────────
  // O dia é o de São Paulo, não o da máquina (ver `inicioDeHojeEmSP`).
  const inicio = inicioDeHojeEmSP()
  const respondidasHoje = await comoOrg(orgId, (db) =>
    db.mensagemAgente.count({ where: { conversaId: conversa.id, de: 'AGENTE', criadaEm: { gte: inicio } } }),
  )
  if (respondidasHoje >= MAXIMO_POR_CONVERSA_DIA) return { tipo: 'ignorada', motivo: 'teto_conversa' }

  // ── chave, crédito, teto de gasto ────────────────────────
  // Antes da chamada, sempre. Depois da chamada o dinheiro já foi.
  const veredito = await podeGastarHoje(orgId)
  const semChave = !temChaveIA()
  if (semChave || !veredito.pode) {
    const motivo = semChave ? 'sem_chave' : (veredito.motivo as 'sem_credito' | 'teto_do_dia' | 'sem_agente')
    const recado = semChave
      ? 'O assistente está sem a chave de IA configurada no servidor. Fale com o suporte do Norte.'
      : veredito.recado
    await recusarSemIA(ctx, agente, deps.canal, conversa, recado)
    return { tipo: 'recusada', motivo }
  }

  // ── o modelo ─────────────────────────────────────────────
  const poderes = poderesDaConversa(paraConfig(agente), ctx.org, quem)
  const ferramentas = ferramentasParaModelo(poderes)
  const sistema = montarSistema(agente, ctx.loja, quem)
  const mensagens = await historicoParaModelo(orgId, conversa.id, texto)

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
      if (volta > 0 && !(await podeGastarHoje(orgId)).pode) {
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
      await registrarConsumoIA(orgId, agente.id, r.modelo, r.uso)

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
        // inventado, poder desligado, poder que a pessoa não tem na tela —
        // tudo cai aqui, e nada é executado.
        if (!poder || !poderes.includes(poder)) {
          console.warn(`[assistente] ${orgId}: modelo pediu ferramenta fora da mesa`)
          resultados.push({
            type: 'tool_result',
            tool_use_id: pedido.id,
            content: 'Ferramenta indisponível nesta conversa. Diga à pessoa que isso não é possível por aqui.',
            is_error: true,
          })
          continue
        }
        const entrada = pedido.input && typeof pedido.input === 'object' ? (pedido.input as Record<string, unknown>) : {}
        const res = await executarFerramenta(orgId, ctx.org, quem, poder, entrada)
        if (res.propostaId) propostas.push(res.propostaId)
        resultados.push({ type: 'tool_result', tool_use_id: pedido.id, content: res.texto, ...(res.erro ? { is_error: true } : {}) })
      }
      // Todos os resultados numa mensagem só: separar ensina o modelo a
      // parar de pedir em paralelo.
      mensagens.push({ role: 'user', content: resultados })
    }
  } catch (erro) {
    if (!(erro instanceof FalhaIA)) {
      console.error(`[assistente] ${orgId}: o laço falhou:`, erro instanceof Error ? erro.message : erro)
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
 * Sem IA: nada de modelo. Quem perguntou ouve o motivo de verdade — é da
 * equipe, e o motivo é da loja dela. E o dono é avisado, uma vez por dia,
 * porque é o único que resolve.
 */
async function recusarSemIA(
  ctx: Contexto,
  agente: Agente,
  canal: Canal,
  conversa: { id: string; telefone: string },
  recado: string,
) {
  await enviarEGravar(canal, agente, conversa, recado)

  // Campanha e recado fixo não usam IA: eles continuam, e o aviso não diz o
  // contrário.
  const aviso = `${PREFIXO_AVISO_DONO} ${recado} Enquanto isso, o assistente não responde as perguntas da equipe pelo WhatsApp.`
  const jaFoi = await comoOrg(ctx.org.id, (db) =>
    db.mensagemAgente.count({
      where: { de: 'AGENTE', texto: { startsWith: PREFIXO_AVISO_DONO }, criadaEm: { gte: inicioDeHojeEmSP() } },
    }),
  )
  if (jaFoi > 0) return

  for (const dono of await donosComTelefone(ctx.org.id)) {
    // O dono que acabou de mandar a mensagem já recebeu o motivo acima.
    if (mesmoTelefone(dono.telefone, conversa.telefone)) continue
    const c = await abrirConversa(ctx.org.id, agente.id, dono.telefone, { nome: dono.nome, daEquipe: true })
    await enviarEGravar(canal, agente, c, aviso)
  }
}
