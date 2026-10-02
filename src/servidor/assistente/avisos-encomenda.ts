// Os avisos da encomenda pelo WhatsApp: à equipe, quando chega pedido pelo
// catálogo; à cliente, quando a loja aceita, apronta ou cancela.
//
// ── à equipe ─────────────────────────────────────────────────
// Quem precisa saber do pedido novo é quem responde pela loja dele: o DONO
// (de todas, ou daquela) e o GERENTE daquela loja, com o telefone CONFIRMADO
// (ver confirmacao.ts — número só digitado não recebe pedido de cliente). O
// texto é pronto, sem IA: código, itens, total, retirada ou entrega e a hora.
// E termina dizendo como responder: ACEITAR ou PRONTO, que `respostas.ts`
// trata sem modelo nenhum, com a permissão de quem respondeu conferida pelos
// mesmos serviços da tela.
//
// ── à cliente ────────────────────────────────────────────────
// Só para o pedido do CATÁLOGO: foi ela quem deixou o telefone pedindo para
// acompanhar. Encomenda de balcão não recebe nada daqui — o balcão avisa do
// jeito dele. É mensagem de serviço, sobre o pedido que ela fez, e mesmo
// assim passa pelas travas:
//   • quem pediu para não receber mensagem (PARAR) não recebe — a mesma
//     regra do recado automático;
//   • no WhatsApp oficial, fora da janela de 24 horas, não sai (o canal
//     recusa texto livre, e não há modelo aprovado para isto) — fica para a
//     página de acompanhamento, que mostra a situação de qualquer jeito;
//   • o mesmo aviso do mesmo pedido não sai duas vezes, e um teto por dia
//     segura o laço que mandaria dez;
//   • tudo conta no teto de mensagens do dia da empresa (`enviarEGravar`).
//
// ── nunca lança ──────────────────────────────────────────────
// Quem chama é o catálogo (o pedido acabou de nascer) e a tela de Encomendas
// (a loja acabou de aceitar). O pedido JÁ está gravado: um WhatsApp fora do
// ar não pode desfazer nem travar isso. Tudo aqui dentro é engolido e vai
// para o log — sem nome, sem telefone, sem texto.

import type { Agente } from '@prisma/client'
import { comoOrg } from '../banco'
import { codigoEncomenda } from '../encomenda'
import { mostrar } from '../dinheiro'
import { pode } from '../permissao'
import { moduloLigado } from '../modulos'
import { estaNaLista } from '../ofertas'
import { inicioDeHojeEmSP } from '../dia'
import { baseDoSite } from '../campanhas/midia'
import { resumoDoErro } from '../registro'
import { escolherCanal, type Canal } from './canal'
import { modeloDeAviso } from './meta-regras'
import { SELECT_TELEFONE, telefoneValido } from './confirmacao'
import { abrirConversa, carregarContexto, empresaApta, enviarEGravar, sessaoDoUsuario, type Contexto } from './contexto'
import { chaveTelefone, paraEnvio, soDigitos } from './telefone'
import { comoRecebe, itensEmTexto, primeiroNome } from './encomenda-texto'

/** Como começa o aviso à equipe. `respostas.ts` acha por aqui os pedidos avisados. */
export const PREFIXO_PEDIDO_NOVO = 'Pedido novo pelo catálogo'

/** Avisos à mesma cliente por dia, somando todos os pedidos dela. */
const MAXIMO_CLIENTE_DIA = 6

export type EventoCliente = 'ACEITA' | 'PRONTA' | 'CANCELADA'

/** Só para os testes: o canal de mentira no lugar do da empresa. */
export type DependenciasAviso = { canal?: Canal; agora?: Date }

const brl = (v: number) => mostrar(Math.round(v * 100))

type Apta = Contexto & { agente: Agente }

/** A empresa pode avisar agora? Assistente apto e um WhatsApp ligado. */
async function empresaQueAvisa(orgId: string): Promise<Apta | null> {
  const ctx = await carregarContexto(orgId)
  if (!ctx || !empresaApta(ctx)) return null
  if (ctx.agente.canal === 'NENHUM') return null
  if (!moduloLigado(ctx.org, 'encomenda')) return null
  return ctx
}

async function lerPedido(orgId: string, encomendaId: string) {
  return comoOrg(orgId, (db) =>
    db.encomenda.findUnique({
      where: { id: encomendaId },
      select: {
        id: true,
        unidadeId: true,
        origem: true,
        clienteNome: true,
        telefone: true,
        descricao: true,
        valor: true,
        para: true,
        entrega: true,
        situacao: true,
        acompanhamento: true,
        unidade: { select: { nome: true } },
        itens: { select: { descricao: true, quantidade: true }, take: 12 },
      },
    }),
  )
}

// ─────────────────────────────────────────────────────────────
// À EQUIPE
// ─────────────────────────────────────────────────────────────

/** O texto do aviso à equipe. Puro. */
export function textoDoPedidoNovo(
  e: { id: string; descricao: string; valor: number; para: Date; entrega: boolean; itens: { descricao: string; quantidade: number }[] },
  agora: Date,
  loja?: string | null,
): string {
  return (
    `${PREFIXO_PEDIDO_NOVO} (${codigoEncomenda(e.id)})${loja ? `, ${loja}` : ''}: ${itensEmTexto(e.itens, e.descricao, 300)}. ` +
    `Total ${brl(e.valor)} — ${comoRecebe(e, agora)}. Responda ACEITAR, PRONTO ou abra Encomendas.`
  )
}

/**
 * Quem da equipe recebe o pedido desta loja: DONO (de todas ou dela) e
 * GERENTE dela, ativos, com telefone confirmado — e que de fato veem as
 * vendas da loja (a régua da tela, conferida na sessão de agora).
 */
async function quemSabeDaLoja(orgId: string, unidadeId: string) {
  const agora = new Date()
  const linhas = await comoOrg(orgId, (db) =>
    db.usuario.findMany({
      where: {
        ativo: true,
        telefone: { not: null },
        telefoneConfirmadoEm: { not: null },
        acessos: {
          some: {
            OR: [
              { papel: 'DONO', unidadeId: null },
              { papel: 'DONO', unidadeId },
              { papel: 'GERENTE', unidadeId },
              { papel: 'GERENTE', unidadeId: null },
            ],
          },
        },
      },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, ...SELECT_TELEFONE },
    }),
  )
  const saida: { nome: string; telefone: string }[] = []
  for (const u of linhas) {
    if (!u.telefone || !telefoneValido(u, agora)) continue
    const sessao = await sessaoDoUsuario(orgId, u.id)
    if (!sessao || !pode(sessao, 'venda.ver', unidadeId)) continue
    saida.push({ nome: sessao.nome, telefone: paraEnvio(u.telefone) ?? soDigitos(u.telefone) })
  }
  return saida
}

/**
 * Pedido novo pelo catálogo → WhatsApp para quem responde pela loja.
 * Nunca lança; empresa sem assistente apto ou sem WhatsApp ligado: nada.
 */
export async function avisarEquipeDoPedido(orgId: string, encomendaId: string, deps: DependenciasAviso = {}): Promise<void> {
  try {
    const ctx = await empresaQueAvisa(orgId)
    if (!ctx) return
    const e = await lerPedido(orgId, encomendaId)
    if (!e || e.origem !== 'CATALOGO' || (e.situacao !== 'ABERTA' && e.situacao !== 'PRONTA')) return

    const agora = deps.agora ?? new Date()
    const codigo = codigoEncomenda(e.id)
    // O mesmo pedido avisado duas vezes (o catálogo chamou de novo): não.
    const jaFoi = await comoOrg(orgId, (db) =>
      db.mensagemAgente.count({
        where: { de: 'AGENTE', texto: { startsWith: `${PREFIXO_PEDIDO_NOVO} (${codigo})` } },
      }),
    )
    if (jaFoi > 0) return

    const lojas = await comoOrg(orgId, (db) => db.unidade.count({ where: { ativa: true, ehDeposito: false } }))
    const texto = textoDoPedidoNovo(
      {
        id: e.id,
        descricao: e.descricao,
        valor: Number(e.valor),
        para: e.para,
        entrega: e.entrega,
        itens: e.itens.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade) })),
      },
      agora,
      lojas > 1 ? e.unidade.nome : null,
    )
    const canal = deps.canal ?? escolherCanal(ctx.org, ctx.agente).canal
    for (const d of await quemSabeDaLoja(orgId, e.unidadeId)) {
      try {
        const conversa = await abrirConversa(orgId, ctx.agente.id, d.telefone, { nome: d.nome, daEquipe: true })
        // No WhatsApp oficial, fora da janela de 24 h, sai como o modelo de
        // aviso — o mesmo das rotinas.
        await enviarEGravar(canal, ctx.agente, conversa, texto, modeloDeAviso(ctx.org.nome, texto))
      } catch (erro) {
        console.error(`[avisos-encomenda] ${orgId}: aviso à equipe não saiu:`, resumoDoErro(erro))
      }
    }
  } catch (erro) {
    console.error(`[avisos-encomenda] ${orgId}: aviso do pedido falhou:`, resumoDoErro(erro))
  }
}

// ─────────────────────────────────────────────────────────────
// À CLIENTE
// ─────────────────────────────────────────────────────────────

/** A marca de cada aviso no texto: é por ela que o segundo igual não sai. */
const MARCA: Record<EventoCliente, string> = {
  ACEITA: 'recebeu seu pedido',
  PRONTA: 'está pronto',
  CANCELADA: 'foi cancelado',
}

/** O texto do aviso à cliente. Puro. */
export function textoParaCliente(
  e: { id: string; clienteNome: string; entrega: boolean; para: Date },
  evento: EventoCliente,
  loja: string,
  link: string | null,
  agora: Date,
): string {
  const codigo = codigoEncomenda(e.id)
  const oi = primeiroNome(e.clienteNome) ? `Oi, ${primeiroNome(e.clienteNome)}! ` : 'Oi! '
  const acompanhe = link ? ` Acompanhe por aqui: ${link}` : ''
  if (evento === 'ACEITA') {
    return `${oi}A ${loja} ${MARCA.ACEITA} ${codigo} — ${comoRecebe(e, agora)}.${acompanhe}`
  }
  if (evento === 'PRONTA') {
    return `${oi}Seu pedido ${codigo} ${MARCA.PRONTA}${e.entrega ? ' e sai para a entrega' : ' para retirar na loja'}.${acompanhe}`
  }
  return `${oi}Seu pedido ${codigo} na ${loja} ${MARCA.CANCELADA}. Qualquer dúvida, é só responder esta mensagem.${acompanhe}`
}

/**
 * A loja aceitou, aprontou ou cancelou → WhatsApp para a cliente do catálogo.
 * Nunca lança; sem assistente apto, sem WhatsApp, sem telefone, pedido de
 * balcão, cliente que pediu para não receber, janela fechada: nada sai.
 */
export async function avisarClienteDaEncomenda(
  orgId: string,
  encomendaId: string,
  evento: EventoCliente,
  deps: DependenciasAviso = {},
): Promise<void> {
  try {
    const ctx = await empresaQueAvisa(orgId)
    if (!ctx) return
    const e = await lerPedido(orgId, encomendaId)
    if (!e || e.origem !== 'CATALOGO' || !e.telefone) return
    const chave = chaveTelefone(e.telefone)
    const numero = paraEnvio(e.telefone)
    if (!chave || !numero) return
    if (await estaNaLista(orgId, chave)) return

    const agora = deps.agora ?? new Date()
    const codigo = codigoEncomenda(e.id)
    const conversa = await abrirConversa(orgId, ctx.agente.id, numero, { nome: e.clienteNome })
    const { igual, hoje } = await comoOrg(orgId, async (db) => {
      const igual = await db.mensagemAgente.count({
        where: { conversaId: conversa.id, de: 'AGENTE', AND: [{ texto: { contains: codigo } }, { texto: { contains: MARCA[evento] } }] },
      })
      const hoje = await db.mensagemAgente.count({
        where: { conversaId: conversa.id, de: 'AGENTE', criadaEm: { gte: inicioDeHojeEmSP(agora) } },
      })
      return { igual, hoje }
    })
    if (igual > 0 || hoje >= MAXIMO_CLIENTE_DIA) return

    const base = baseDoSite()
    const link = base && e.acompanhamento ? `${base}/${ctx.org.slug}/pedido/${e.acompanhamento}` : null
    const texto = textoParaCliente(e, evento, ctx.org.nome, link, agora)
    const canal = deps.canal ?? escolherCanal(ctx.org, ctx.agente).canal
    // Sem modelo: no WhatsApp oficial, fora da janela, o canal recusa e nada
    // sai — a página de acompanhamento continua dizendo a situação.
    const s = await enviarEGravar(canal, ctx.agente, conversa, texto)
    if (!s.enviada && s.motivo !== 'janela_fechada') {
      console.warn(`[avisos-encomenda] ${orgId}: aviso à cliente não saiu (${s.motivo ?? 'canal'})`)
    }
  } catch (erro) {
    console.error(`[avisos-encomenda] ${orgId}: aviso à cliente falhou:`, resumoDoErro(erro))
  }
}
