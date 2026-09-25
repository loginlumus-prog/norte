// O que a tela do assistente mostra e faz sobre a CONEXÃO: se ele está de
// fato ligado ao mundo, o endereço do webhook, a mensagem de teste, as
// rotinas e as últimas conversas.
//
// Toda função aqui começa conferindo `agente.configurar`: é a mesma
// capacidade que abre a tela, e Server Action é endereço público — o botão
// escondido não protege nada.

import type { TipoGatilho } from '@prisma/client'
import { comoOrg } from '../banco'
import { exigir, type Sessao } from '../permissao'
import { temChaveIA } from '../ia'
import { zapiDa, canalPara } from './canal'
import { enderecoDoWebhook, temSegredoWebhook } from './webhook'
import { abrirConversa, enviarEGravar } from './contexto'
import { chaveTelefone, mascarar } from './telefone'
import { DIAS_SUMIDO } from './rotinas'

// ─────────────────────────────────────────────────────────────
// O ESTADO
// ─────────────────────────────────────────────────────────────

export type EstadoConexao = {
  /** A frase de cima: o que falta, na ordem em que se resolve. */
  situacao: 'sem_agente' | 'sem_chave' | 'sem_canal' | 'sem_webhook' | 'desconectado' | 'desligado' | 'pronto'
  chaveIA: boolean
  canalReal: boolean
  segredoWebhook: boolean
  rotinasSegredo: boolean
  conectado: boolean
  ativo: boolean
  /** O telefone de quem está vendo, mascarado; nulo se não cadastrou. */
  meuTelefone: string | null
}

export async function estadoDaConexao(sessao: Sessao): Promise<EstadoConexao> {
  exigir(sessao, 'agente.configurar')
  const { agente, eu, slug } = await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { canal: true, ativo: true },
    })
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { telefone: true } })
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { slug: true } })
    return { agente, eu, slug: org.slug }
  })

  const chaveIA = temChaveIA()
  const canalReal = zapiDa(slug)
  const segredoWebhook = temSegredoWebhook()
  const conectado = agente?.canal === 'ZAPI'
  const situacao: EstadoConexao['situacao'] = !agente
    ? 'sem_agente'
    : !chaveIA
      ? 'sem_chave'
      : !canalReal
        ? 'sem_canal'
        : !segredoWebhook
          ? 'sem_webhook'
          : !conectado
            ? 'desconectado'
            : !agente.ativo
              ? 'desligado'
              : 'pronto'

  return {
    situacao,
    chaveIA,
    canalReal,
    segredoWebhook,
    rotinasSegredo: (process.env.ROTINAS_SEGREDO ?? '').trim().length >= 32,
    conectado,
    ativo: agente?.ativo ?? false,
    meuTelefone: eu?.telefone && chaveTelefone(eu.telefone) ? mascarar(eu.telefone) : null,
  }
}

// ─────────────────────────────────────────────────────────────
// CONECTAR E DESCONECTAR
// ─────────────────────────────────────────────────────────────

/**
 * Liga o canal e devolve o endereço do webhook para colar no Z-API.
 *
 * O endereço só aparece como RESPOSTA desta ação, nunca impresso na página:
 * ele é a senha da porta. Quem precisar dele de novo clica de novo — e cada
 * vez fica no livro de auditoria, com nome e hora.
 */
export async function conectarCanal(
  sessao: Sessao,
  base: string,
  slug: string,
): Promise<{ ok: true; endereco: string } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  const endereco = enderecoDoWebhook(base, slug)
  if (!endereco) return { ok: false, erro: 'O servidor ainda não tem o WEBHOOK_SEGREDO configurado. Fale com o suporte do Norte.' }

  const agente = await comoOrg(sessao.orgId, (db) =>
    db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true, nome: true, canal: true } }),
  )
  if (!agente) return { ok: false, erro: 'Crie o assistente antes de conectar.' }

  await comoOrg(sessao.orgId, async (db) => {
    await db.agente.update({ where: { id: agente.id }, data: { canal: 'ZAPI' } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: agente.canal === 'ZAPI' ? 'agente.webhook.mostrou' : 'agente.canal.conectou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        antes: { canal: agente.canal },
        depois: { canal: 'ZAPI' },
      },
    })
  })
  return { ok: true, endereco }
}

/** Fecha a porta desta empresa: o webhook passa a descartar tudo. */
export async function desconectarCanal(sessao: Sessao) {
  exigir(sessao, 'agente.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true, nome: true, canal: true } })
    if (!agente || agente.canal === 'NENHUM') return
    await db.agente.update({ where: { id: agente.id }, data: { canal: 'NENHUM' } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.canal.desconectou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        antes: { canal: agente.canal },
        depois: { canal: 'NENHUM' },
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// A MENSAGEM DE TESTE
// ─────────────────────────────────────────────────────────────

/**
 * Manda "estou aqui" para o telefone de QUEM clicou — e só para ele.
 *
 * Não aceita número digitado: um botão que manda mensagem para qualquer
 * número vira ferramenta de spam com o WhatsApp da loja.
 */
export async function mensagemDeTeste(sessao: Sessao): Promise<{ ok: true; recado: string } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  const { agente, eu, slug } = await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({ where: { orgId: sessao.orgId } })
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { telefone: true, nome: true } })
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { slug: true } })
    return { agente, eu, slug: org.slug }
  })
  if (!agente) return { ok: false, erro: 'Crie o assistente antes de testar.' }
  if (!eu?.telefone || !chaveTelefone(eu.telefone)) {
    return { ok: false, erro: 'Cadastre o seu telefone (com DDD) na tela Equipe para receber o teste.' }
  }

  const canal = canalPara(slug)
  const conversa = await abrirConversa(sessao.orgId, agente.id, eu.telefone, { nome: eu.nome, daEquipe: true })
  const s = await enviarEGravar(
    canal,
    agente,
    conversa,
    `Oi, ${eu.nome.split(' ')[0]}! Aqui é ${agente.nome}, o assistente da loja. Se esta mensagem chegou, a conexão está funcionando.`,
  )
  if (!s.enviada) {
    return {
      ok: false,
      erro: s.motivo === 'teto_mensagens' ? 'Ele já mandou o máximo de mensagens de hoje.' : 'O canal recusou o envio. Confira a instância no Z-API.',
    }
  }
  return {
    ok: true,
    recado: canal.real
      ? `Mensagem enviada para ${mascarar(eu.telefone)}.`
      : 'Não há Z-API configurado neste servidor: a mensagem ficou só no histórico abaixo, nada saiu de verdade.',
  }
}

// ─────────────────────────────────────────────────────────────
// AS ROTINAS
// ─────────────────────────────────────────────────────────────

/** As rotinas que existem de verdade. As outras do enum ainda não têm código. */
export const ROTINAS_NA_TELA: { tipo: TipoGatilho; titulo: string; resumo: string }[] = [
  { tipo: 'RELATORIO', titulo: 'Relatório de manhã e à noite', resumo: 'Às 8h, como foi ontem. Às 20h, como foi hoje. Para os donos com telefone cadastrado.' },
  { tipo: 'RUPTURA', titulo: 'Aviso de que vai faltar peça', resumo: 'Às 9h, o que acaba antes de a reposição chegar — e a proposta de compra, se ele tiver esse poder.' },
  { tipo: 'CLIENTE_SUMIDO', titulo: 'Cliente sumido', resumo: 'Segunda, às 10h: quem comprava quase todo mês e parou de vir.' },
]

export type GatilhoNaTela = { tipo: TipoGatilho; ativo: boolean; dias: number | null; ultimoDisparo: string | null }

export async function gatilhosDaTela(sessao: Sessao): Promise<GatilhoNaTela[]> {
  exigir(sessao, 'agente.configurar')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.gatilhoAgente.findMany({ select: { tipo: true, ativo: true, dias: true, ultimoDisparo: true } }),
  )
  return ROTINAS_NA_TELA.map((r) => {
    const g = linhas.find((l) => l.tipo === r.tipo)
    return {
      tipo: r.tipo,
      // Sem linha = ligado. É o padrão da coluna e o que o plano vende.
      ativo: g?.ativo ?? true,
      dias: g?.dias ?? (r.tipo === 'CLIENTE_SUMIDO' ? DIAS_SUMIDO : null),
      ultimoDisparo: g?.ultimoDisparo?.toISOString() ?? null,
    }
  })
}

export async function salvarGatilhos(
  sessao: Sessao,
  escolha: { tipo: TipoGatilho; ativo: boolean; dias?: number | null }[],
) {
  exigir(sessao, 'agente.configurar')
  const validos = new Set(ROTINAS_NA_TELA.map((r) => r.tipo))
  await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true } })
    if (!agente) throw new Error('Crie o assistente antes de ligar rotinas.')
    for (const g of escolha) {
      if (!validos.has(g.tipo)) continue
      const dias = g.dias != null && Number.isFinite(g.dias) ? Math.min(365, Math.max(7, Math.round(g.dias))) : null
      await db.gatilhoAgente.upsert({
        where: { agenteId_tipo: { agenteId: agente.id, tipo: g.tipo } },
        create: { orgId: sessao.orgId, agenteId: agente.id, tipo: g.tipo, ativo: g.ativo, dias },
        update: { ativo: g.ativo, dias },
      })
    }
    // Ligar e desligar rotina muda o que o assistente manda sozinho para a
    // equipe e para os clientes — é configuração, e configuração vai para o
    // livro, como as outras do assistente.
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.rotinas',
        alvoTipo: 'agente',
        alvoId: agente.id,
        depois: escolha.filter((g) => validos.has(g.tipo)).map((g) => ({ tipo: g.tipo, ativo: g.ativo, dias: g.dias ?? null })),
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// AS ÚLTIMAS CONVERSAS
// ─────────────────────────────────────────────────────────────

export type ConversaNaTela = {
  id: string
  quem: string
  telefone: string
  daEquipe: boolean
  ultimaEm: string
  mensagens: { de: 'PESSOA' | 'AGENTE' | 'SISTEMA'; texto: string; em: string }[]
}

/**
 * As últimas conversas, com as últimas mensagens de cada uma.
 *
 * O telefone sai mascarado: a tela serve para conferir o que ELE disse, não
 * para virar agenda de contatos de quem só configura o assistente.
 */
export async function conversasRecentes(sessao: Sessao, quantas = 8): Promise<ConversaNaTela[]> {
  exigir(sessao, 'agente.configurar')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.conversaAgente.findMany({
      orderBy: { ultimaEm: 'desc' },
      take: quantas,
      select: {
        id: true,
        nome: true,
        telefone: true,
        daEquipe: true,
        ultimaEm: true,
        mensagens: { orderBy: { criadaEm: 'desc' }, take: 6, select: { de: true, texto: true, criadaEm: true } },
      },
    }),
  )
  return linhas.map((c) => ({
    id: c.id,
    quem: c.nome ?? 'sem nome',
    telefone: mascarar(c.telefone),
    daEquipe: c.daEquipe,
    ultimaEm: c.ultimaEm.toISOString(),
    mensagens: c.mensagens
      .reverse()
      .map((m) => ({ de: m.de, texto: m.texto.slice(0, 600), em: m.criadaEm.toISOString() })),
  }))
}
