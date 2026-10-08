// O "SIM" no WhatsApp — e o ACEITAR / PRONTO do pedido do catálogo.
//
// A proposta do assistente sempre pôde ser confirmada na tela. Pela conversa,
// o dono que mandou "comprei 10 kg de picanha" quer responder "sim" ali
// mesmo, e é isto que trata essa resposta — ANTES do modelo, sem modelo
// nenhum. O modelo nunca confirma nada: ele não tem ferramenta para isso, e
// a frase "sim" nem chega a ele quando há proposta esperando.
//
// ── quem pode dizer sim, e a qual proposta ───────────────────
// Só o DONO aprova (ver `ehDono` em poderes.ts — e `responderProposta`
// confere de novo, também pela tela). O sim sem código do dono vale para o
// que ELE pediu na última hora e para o pedido da equipe que chegou a ele
// nesta conversa na última hora (aprovacao.ts): o "ok" de amanhã não
// confirma a conta de hoje. Com o código ("sim KP42"), o dono alcança
// qualquer proposta que espera na empresa — inclusive a da rotina das 9h.
//
// Quem NÃO é dono não aprova nem o que pediu: o "sim" dele volta dizendo que
// o pedido espera o dono, e nada executa. O "não" dele desiste do próprio
// pedido. Pedido de outra pessoa ele não alcança. Quando o dono responde a
// um pedido da equipe, quem pediu recebe o desfecho no WhatsApp.
//
// A confirmação é `responderProposta` — o MESMO caminho da tela —, com a
// sessão de quem respondeu montada do banco agora (os papéis de agora, não
// os de quando pediu). Então tudo o que a tela confere vale aqui: a
// capacidade da pessoa, o teto de agora, a validade, e a proposta TOMADA
// antes de executar (o sim no WhatsApp e o clique na tela ao mesmo tempo não
// executam duas vezes).
//
// Uma proposta esperando: "sim" confirma, "não" recusa. Várias: a resposta
// lista cada uma com o CÓDIGO dela (ver propostas.ts), e "sim KP42" escolhe.
// O número de lista ("sim 2") não escolhe mais: a lista encolhia a cada
// resposta e o "2" da lista antiga virava outra proposta. Nenhuma: a
// mensagem segue para o modelo, como qualquer outra.
//
// O "ok", "isso", "pode" (e o "não" sem código) são frouxos: costumam
// responder a OUTRA pergunta do modelo ("quer que eu veja o Norte também?").
// Eles só valem quando a última mensagem do assistente nesta conversa foi
// a da proposta, e só há ela esperando. Fora disso, vão para o modelo.
//
// ── ACEITAR e PRONTO ─────────────────────────────────────────
// O aviso do pedido novo do catálogo (avisos-encomenda.ts) termina com
// "Responda ACEITAR, PRONTO ou abra Encomendas". A resposta é o próprio
// comando de uma pessoa da equipe — não há modelo no meio para confirmar —,
// e vai pelos MESMOS serviços da tela de Encomendas (`marcarVista`,
// `mudarSituacao`), que conferem a loja e a permissão de quem respondeu.
// Sem código, vale o pedido avisado NESTA conversa nas últimas 24 horas; com
// mais de um, a resposta pergunta qual.

import type { Agente } from '@prisma/client'
import { comoOrg } from '../banco'
import { ehDono, responderProposta, type Resposta } from '../agente'
import { codigoEncomenda, marcarVista, mudarSituacao } from '../encomenda'
import { moduloLigado } from '../modulos'
import { SemPermissao } from '../permissao'
import { resumoDoErro } from '../registro'
import type { Canal } from './canal'
import { enviarEGravar, type Contexto } from './contexto'
import type { Equipe } from './regras'
import { acharPeloCodigo } from './ferramentas-loja'
import { avisarClienteDaEncomenda, PREFIXO_PEDIDO_NOVO } from './avisos-encomenda'
import { codigoDaProposta } from './propostas'
import { avisarQuemPediu, codigosEncaminhados } from './aprovacao'

/** Até quanto tempo depois de pedir o "sim" na conversa vale. */
export const MINUTOS_DO_SIM = 60
/** Até quanto tempo depois do aviso o ACEITAR sem código acha o pedido. */
const HORAS_DO_ATALHO = 24

// ─────────────────────────────────────────────────────────────
// A LEITURA (pura)
// ─────────────────────────────────────────────────────────────

/** Sem acento, sem caixa, sem pontuação nem emoji: "Sim!! 👍" → "sim". */
const limpar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** O sim que só pode ser sim. */
const SIM_FORTE = ['sim', 'confirmo', 'confirma', 'confirmar', 'confirmado', 'pode lancar', 'pode sim', 'sim pode', 'pode confirmar']
/** O sim que também responde a outras perguntas: só vale logo depois da proposta. */
const SIM_FROUXO = ['pode', 'ok', 'okay', 'isso', 'isso mesmo']
const SIM = [...SIM_FORTE, ...SIM_FROUXO]
const NAO = ['nao', 'cancela', 'cancelar', 'nao pode', 'nao quero']

/** "KP42" (o código da proposta), ou o número da lista antiga ("o 2", "n 2", "2"). */
const ALVO = String.raw`(?:\s+(?:([a-z]{2})\s?(\d{2})|(?:o|a|numero|n)?\s*(\d{1,2})))?`
const RESPOSTA = new RegExp(`^(${[...SIM, ...NAO].sort((a, b) => b.length - a.length).join('|')})${ALVO}$`)

export type RespostaCurta = {
  aceita: boolean
  /** O código da proposta, em maiúsculas ("KP42"). */
  codigo: string | null
  /** O número de uma lista antiga. Não escolhe nada: a resposta mostra os códigos. */
  numero: number | null
  /** "ok", "isso", "pode", "não": só valem logo depois da proposta. */
  frouxa: boolean
}

/**
 * A mensagem INTEIRA é um sim ou um não (com o código, opcional)? Frase com
 * mais coisa ("sim, mas muda a data") não é: vai para o modelo, que entende.
 */
export function lerRespostaCurta(texto: string): RespostaCurta | null {
  const t = limpar(texto)
  if (!t || t.length > 30) return null
  const m = RESPOSTA.exec(t)
  if (!m) return null
  const palavra = m[1]!
  const aceita = !NAO.includes(palavra)
  return {
    aceita,
    codigo: m[2] && m[3] ? `${m[2]}${m[3]}`.toUpperCase() : null,
    numero: m[4] ? Number(m[4]) : null,
    frouxa: !aceita || SIM_FROUXO.includes(palavra),
  }
}

export type AtalhoEncomenda = { acao: 'aceitar' | 'pronta'; codigo: string | null; numero: number | null }

const ACEITAR = ['aceitar', 'aceito', 'aceita', 'aceite']
const PRONTO = ['pronto', 'pronta', 'ta pronto', 'ta pronta', 'esta pronto', 'esta pronta']

/** "ACEITAR", "aceito ENC-A1B2C3", "pronto 2". A mensagem inteira, de novo. */
export function lerAtalhoEncomenda(texto: string): AtalhoEncomenda | null {
  const t = limpar(texto)
  if (!t || t.length > 40) return null
  const palavra = [...ACEITAR, ...PRONTO].sort((a, b) => b.length - a.length).find((p) => t === p || t.startsWith(`${p} `))
  if (!palavra) return null
  const acao = ACEITAR.includes(palavra) ? 'aceitar' : 'pronta'
  const resto = t.slice(palavra.length).trim()
  if (!resto) return { acao, codigo: null, numero: null }
  const n = /^(?:o |a |numero |n )?(\d{1,2})$/.exec(resto)
  if (n) return { acao, codigo: null, numero: Number(n[1]) }
  // Código só com o ENC na frente (limpar() tira o hífen: "enc a1b2c3"):
  // sem ele, "aceito cartao" viraria o código "cartao".
  const c = /^enc\s*([a-z0-9]{6})$/.exec(resto)
  return c ? { acao, codigo: c[1]!, numero: null } : null
}

// ─────────────────────────────────────────────────────────────
// A RESPOSTA
// ─────────────────────────────────────────────────────────────

export type Atalho = { tipo: 'atalho'; texto: string; enviada: boolean }

type Conversa = { id: string; telefone: string }

/**
 * Trata a mensagem se ela for a resposta a uma proposta (ou o ACEITAR /
 * PRONTO de um pedido). Nulo = não era: segue para o modelo.
 *
 * `eco`: a linha "Ouvi: …" quando a mensagem veio de áudio.
 */
export async function responderPeloWhatsApp(
  ctx: Contexto & { agente: Agente },
  quem: Equipe,
  conversa: Conversa,
  texto: string,
  canal: Canal,
  eco?: string | null,
): Promise<Atalho | null> {
  const curta = lerRespostaCurta(texto)
  const resposta = curta
    ? await responderAProposta(ctx, quem, conversa, curta, canal)
    : await atalhoDeEncomenda(ctx, quem, conversa, texto)
  if (resposta === null) return null
  const saida = await enviarEGravar(canal, ctx.agente, conversa, eco ? `${eco}\n\n${resposta}` : resposta)
  return { tipo: 'atalho', texto: resposta, enviada: saida.enviada }
}

/** Resumo de proposta numa linha de lista: cortado, que a lista é para escolher. */
const linha = (resumo: string) => (resumo.length > 220 ? `${resumo.slice(0, 219).trimEnd()}…` : resumo)

function lista(propostas: { id: string; resumo: string; usuarioId?: string | null }[], eu?: string): string {
  const primeiro = codigoDaProposta(propostas[0]!.id)
  const todasMinhas = !eu || propostas.every((p) => p.usuarioId === eu)
  return [
    todasMinhas ? `Tem ${propostas.length} propostas suas esperando:` : `Tem ${propostas.length} propostas esperando a sua resposta:`,
    ...propostas.map((p) => `• *${codigoDaProposta(p.id)}* — ${linha(p.resumo)}`),
    `Responda SIM e o código (ex.: SIM ${primeiro}) para confirmar uma, ou NÃO e o código para cancelar.`,
  ].join('\n')
}

/** A recusa de quem não é dono tentando aprovar. */
export const SO_O_DONO = 'Só o dono aprova o que o assistente propõe.'

/** A frase que volta depois de `responderProposta`. */
export function fraseDaResposta(r: Resposta, aceita: boolean, resumo: string): string {
  if (r.ok) {
    if (!aceita) return `Certo, cancelei. Nada foi feito: ${linha(resumo)}`
    return `Feito: ${r.feito ?? linha(resumo)}`
  }
  switch (r.motivo) {
    case 'so_o_dono':
      return SO_O_DONO
    case 'sem_permissao':
      return 'Isso não é do seu acesso pela tela, então também não por aqui. Quem pode confirma na tela do assistente — a proposta continua lá.'
    case 'expirada':
      return 'Essa proposta venceu (vale 24 horas). Me peça de novo que eu monto outra.'
    case 'ja_respondida':
      return 'Essa proposta já foi respondida.'
    case 'nao_existe':
      return 'Não achei essa proposta.'
    default:
      return r.recado
        ? `Não deu: ${r.recado}`
        : 'Não deu para fazer isso agora. A proposta ficou marcada com o erro na tela do assistente.'
  }
}

type Esperando = { id: string; resumo: string; expiraEm: Date; usuarioId: string | null; criadaEm: Date }

const SELECT_ESPERANDO = { id: true, resumo: true, expiraEm: true, usuarioId: true, criadaEm: true } as const

/**
 * As que esperam resposta na empresa, de qualquer pessoa (e as da rotina) —
 * para achar pelo código. Até um pouco além da validade: a vencida responde
 * "venceu", e não "não achei".
 */
async function esperandoNaEmpresa(orgId: string, agora: Date): Promise<Esperando[]> {
  return comoOrg(orgId, (db) =>
    db.propostaAgente.findMany({
      where: { situacao: 'AGUARDANDO', respondidaEm: null, criadaEm: { gte: new Date(agora.getTime() - 25 * 3600_000) } },
      orderBy: { criadaEm: 'asc' },
      take: 300,
      select: SELECT_ESPERANDO,
    }),
  )
}

/** A última coisa que o assistente disse nesta conversa traz este código? */
async function ultimaMensagemTraz(orgId: string, conversa: Conversa, codigo: string): Promise<boolean> {
  const ultima = await comoOrg(orgId, (db) =>
    db.mensagemAgente.findFirst({
      where: { conversaId: conversa.id, de: 'AGENTE' },
      orderBy: { criadaEm: 'desc' },
      select: { texto: true },
    }),
  )
  return !!ultima?.texto.includes(codigo)
}

async function responderAProposta(
  ctx: Contexto & { agente: Agente },
  quem: Equipe,
  conversa: Conversa,
  curta: RespostaCurta,
  canal: Canal,
): Promise<string | null> {
  const orgId = ctx.org.id
  const agora = new Date()
  const desde = new Date(agora.getTime() - MINUTOS_DO_SIM * 60_000)
  const minhas = await comoOrg(orgId, (db) =>
    db.propostaAgente.findMany({
      where: {
        usuarioId: quem.sessao.usuarioId,
        situacao: 'AGUARDANDO',
        respondidaEm: null,
        criadaEm: { gte: desde },
      },
      orderBy: { criadaEm: 'asc' },
      take: 10,
      select: SELECT_ESPERANDO,
    }),
  )
  if (!ehDono(quem.sessao)) return respostaDeQuemPede(ctx, quem, conversa, curta, minhas, agora)

  // O dono: as que ele pediu, e os pedidos da equipe que chegaram a ELE,
  // nesta conversa, há pouco (ver aprovacao.ts). Pelo código, qualquer uma
  // que espera na empresa — inclusive a da rotina das 9h.
  const codigos = await codigosEncaminhados(orgId, conversa, desde)
  const encaminhadas =
    codigos.size === 0 ? [] : (await esperandoNaEmpresa(orgId, agora)).filter((p) => codigos.has(codigoDaProposta(p.id)))
  const vistas = new Set<string>()
  const recentes = [...minhas, ...encaminhadas]
    .filter((p) => !vistas.has(p.id) && !!vistas.add(p.id))
    .sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime())

  const eu = quem.sessao.usuarioId
  const valendo = recentes.filter((p) => p.expiraEm > agora)
  let alvo: Esperando | undefined
  if (curta.codigo !== null) {
    // O código escolhe sem ambiguidade — e vale até para "ok KP42".
    let achadas = recentes.filter((p) => codigoDaProposta(p.id) === curta.codigo)
    if (achadas.length === 0) {
      achadas = (await esperandoNaEmpresa(orgId, agora)).filter((p) => codigoDaProposta(p.id) === curta.codigo)
    }
    if (achadas.length > 1) return 'Esse código bate com mais de uma proposta. Confirme pela tela do assistente.'
    alvo = achadas[0]
    if (!alvo) {
      return valendo.length > 0
        ? `Não achei a proposta ${curta.codigo}.\n${lista(valendo, eu)}`
        : `Não achei a proposta ${curta.codigo}.`
    }
  } else if (recentes.length === 0) {
    // Nada que o dono pediu (ou recebeu) há pouco: o "ok" é só um ok.
    return null
  } else if (curta.numero !== null && valendo.length > 0) {
    // Número de lista não escolhe mais (a lista mudava a cada resposta):
    // mostra os códigos e a pessoa responde de novo.
    return valendo.length === 1
      ? `Para não confundir, responda com o código: SIM ${codigoDaProposta(valendo[0]!.id)} (${linha(valendo[0]!.resumo)}).`
      : lista(valendo, eu)
  } else if (curta.frouxa) {
    // "ok", "isso", "pode", "não": só se a proposta foi a ÚLTIMA coisa que
    // o assistente disse aqui, e só há ela. Senão era resposta a outra pergunta.
    if (valendo.length !== 1) return null
    if (!(await ultimaMensagemTraz(orgId, conversa, codigoDaProposta(valendo[0]!.id)))) return null
    alvo = valendo[0]
  } else if (valendo.length === 0) {
    // Só vencidas: `responderProposta` diz isso e marca a proposta.
    alvo = recentes.at(-1)
  } else if (valendo.length === 1) {
    alvo = valendo[0]
  } else {
    return lista(valendo, eu)
  }

  const r = await responderProposta(quem.sessao, ctx.org, alvo!.id, curta.aceita)
  if (!r.ok && r.motivo === 'falhou' && !r.recado && r.detalhe) {
    console.error(`[assistente] ${orgId}: o sim pelo WhatsApp falhou na execução`)
  }
  // O pedido era de outra pessoa da equipe: ela fica sabendo do desfecho.
  if (alvo!.usuarioId && alvo!.usuarioId !== eu) {
    await avisarQuemPediu(ctx.org, alvo!.id, quem.sessao, curta.aceita, r, canal)
  }
  return fraseDaResposta(r, curta.aceita, alvo!.resumo)
}

/**
 * O SIM (ou o NÃO) de quem NÃO é dono. Ele não aprova nada — nem o que ele
 * mesmo pediu: o SIM responde que o pedido espera o dono, sem executar. O
 * NÃO desiste do próprio pedido (recusar não faz nada, e a fila do dono fica
 * limpa). Pedido de outra pessoa, nem uma coisa nem outra.
 *
 * As mesmas réguas do dono para o que é frouxo: "ok", "pode" e "não" sem
 * código só valem logo depois do pedido; fora disso, vão para o modelo.
 */
async function respostaDeQuemPede(
  ctx: Contexto & { agente: Agente },
  quem: Equipe,
  conversa: Conversa,
  curta: RespostaCurta,
  minhas: Esperando[],
  agora: Date,
): Promise<string | null> {
  const orgId = ctx.org.id
  const eu = quem.sessao.usuarioId
  const valendo = minhas.filter((p) => p.expiraEm > agora)
  let alvo: Esperando | undefined
  if (curta.codigo !== null) {
    const achadas = (await esperandoNaEmpresa(orgId, agora)).filter((p) => codigoDaProposta(p.id) === curta.codigo)
    if (achadas.length > 1) return 'Esse código bate com mais de um pedido. O dono resolve pela tela do assistente.'
    alvo = achadas[0]
    if (!alvo) return minhas.length > 0 ? `Não achei o pedido ${curta.codigo}.` : null
    if (alvo.usuarioId !== eu) return SO_O_DONO
  } else if (valendo.length === 0) {
    return null
  } else if (curta.frouxa || curta.numero !== null) {
    if (valendo.length !== 1) return null
    if (!(await ultimaMensagemTraz(orgId, conversa, codigoDaProposta(valendo[0]!.id)))) return null
    alvo = valendo[0]
  } else if (valendo.length === 1) {
    alvo = valendo[0]
  } else if (curta.aceita) {
    return [
      'Os seus pedidos esperam a aprovação do dono — só o dono aprova:',
      ...valendo.map((p) => `• *${codigoDaProposta(p.id)}* — ${linha(p.resumo)}`),
      'Assim que ele responder, eu te aviso aqui.',
    ].join('\n')
  } else {
    return [
      `Tem ${valendo.length} pedidos seus esperando o dono:`,
      ...valendo.map((p) => `• *${codigoDaProposta(p.id)}* — ${linha(p.resumo)}`),
      `Para desistir de um, responda NÃO e o código (ex.: NÃO ${codigoDaProposta(valendo[0]!.id)}).`,
    ].join('\n')
  }

  const c = codigoDaProposta(alvo!.id)
  if (curta.aceita) {
    return `O pedido *${c}* está esperando a aprovação do dono — só o dono aprova o que o assistente propõe. Assim que ele responder, eu te aviso aqui.`
  }
  const r = await responderProposta(quem.sessao, ctx.org, alvo!.id, false)
  if (r.ok) return `Certo, desisti do pedido *${c}*. Nada foi feito: ${linha(alvo!.resumo)}`
  return fraseDaResposta(r, false, alvo!.resumo)
}

// ── ACEITAR / PRONTO ─────────────────────────────────────────

const CODIGO_NO_AVISO = new RegExp(`^${PREFIXO_PEDIDO_NOVO} \\(ENC-([A-Z0-9]{6})\\)`)

async function atalhoDeEncomenda(
  ctx: Contexto & { agente: Agente },
  quem: Equipe,
  conversa: Conversa,
  texto: string,
): Promise<string | null> {
  const a = lerAtalhoEncomenda(texto)
  if (!a || !moduloLigado(ctx.org, 'encomenda')) return null
  const orgId = ctx.org.id
  const sessao = quem.sessao

  type Achada = Extract<Awaited<ReturnType<typeof acharPeloCodigo>>, { encomenda: unknown }>['encomenda']
  const serve = (e: Achada) =>
    (e.situacao === 'ABERTA' || e.situacao === 'PRONTA') &&
    (a.acao === 'aceitar' ? e.origem === 'CATALOGO' && !e.vistaEm : e.situacao === 'ABERTA')

  let alvo: Achada | undefined
  if (a.codigo) {
    const r = await acharPeloCodigo(sessao, a.codigo)
    if ('erro' in r) return r.erro!
    alvo = r.encomenda
  } else {
    // Os pedidos avisados NESTA conversa, nas últimas 24 horas.
    const avisos = await comoOrg(orgId, (db) =>
      db.mensagemAgente.findMany({
        where: {
          conversaId: conversa.id,
          de: 'AGENTE',
          texto: { startsWith: PREFIXO_PEDIDO_NOVO },
          criadaEm: { gte: new Date(Date.now() - HORAS_DO_ATALHO * 3600_000) },
        },
        orderBy: { criadaEm: 'asc' },
        take: 20,
        select: { texto: true },
      }),
    )
    const codigos = [...new Set(avisos.map((m) => CODIGO_NO_AVISO.exec(m.texto)?.[1]).filter((c): c is string => !!c))]
    // Sem pedido avisado aqui: "pronto" é só uma palavra. O modelo responde.
    if (codigos.length === 0) return null
    const candidatos: Achada[] = []
    for (const c of codigos) {
      const r = await acharPeloCodigo(sessao, c)
      if (!('erro' in r) && serve(r.encomenda)) candidatos.push(r.encomenda)
    }
    if (candidatos.length === 0) {
      return a.acao === 'aceitar' ? 'Os pedidos que avisei já foram aceitos.' : 'Os pedidos que avisei já não estão a fazer.'
    }
    if (a.numero !== null) {
      alvo = candidatos[a.numero - 1]
      if (!alvo) return `Não tenho o pedido ${a.numero} na lista.`
    } else if (candidatos.length === 1) {
      alvo = candidatos[0]
    } else {
      const verbo = a.acao === 'aceitar' ? 'ACEITAR' : 'PRONTO'
      return [
        'Qual deles?',
        ...candidatos.map((e, i) => `${i + 1}) ${codigoEncomenda(e.id)}`),
        `Responda ${verbo} 1, ${verbo} 2... ou ${verbo} com o código.`,
      ].join('\n')
    }
  }

  const e = alvo!
  const codigo = codigoEncomenda(e.id)
  if (!serve(e)) {
    return a.acao === 'aceitar'
      ? e.origem !== 'CATALOGO'
        ? `A ${codigo} foi anotada no balcão — não há o que aceitar.`
        : `O pedido ${codigo} já foi aceito.`
      : `A ${codigo} não está a fazer (está ${e.situacao === 'PRONTA' ? 'pronta' : 'encerrada'}).`
  }

  try {
    if (a.acao === 'aceitar') {
      const r = await marcarVista(sessao, e.id)
      if (!r.ok) return `Não deu: ${r.erro}`
    } else {
      const r = await mudarSituacao(sessao, e.id, { para: 'PRONTA' })
      if (!r.ok) return `Não deu: ${r.erro}`
      if (e.origem === 'CATALOGO' && !e.vistaEm) await marcarVista(sessao, e.id).catch(() => undefined)
    }
  } catch (erro) {
    if (erro instanceof SemPermissao) return 'Isso não é do seu acesso nas encomendas dessa loja.'
    console.error(`[assistente] ${orgId}: o ${a.acao} pelo WhatsApp falhou:`, resumoDoErro(erro))
    return 'Não deu para fazer isso agora. Tente pela tela de Encomendas.'
  }

  const avisa = e.origem === 'CATALOGO' && !!e.telefone
  if (avisa) await avisarClienteDaEncomenda(orgId, e.id, a.acao === 'aceitar' ? 'ACEITA' : 'PRONTA')
  const feito = a.acao === 'aceitar' ? `pedido ${codigo} aceito.` : `encomenda ${codigo} marcada como pronta.`
  return `Feito: ${feito}${avisa ? ' A cliente recebe o aviso pelo WhatsApp.' : ''}`
}
