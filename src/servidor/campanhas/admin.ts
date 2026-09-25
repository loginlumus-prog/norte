// O que a TELA faz com campanhas: listar, criar, salvar, ativar, apagar,
// testar, e ver quem está dentro.
//
// Toda função começa conferindo a sessão (`agente.configurar`) e o plano:
// Server Action é endereço público, e o que chega do navegador é pedido,
// não ordem. O desenho é limpo por `lerGrafo`/`lerGatilho` e conferido por
// `pendencias` de novo aqui — a tela confere para ajudar, o servidor confere
// para valer.
//
// Cada mudança vai para o livro de auditoria (campanha.criou, .alterou,
// .ativou, .pausou, .apagou, .testou).

import type { Prisma } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from '../banco'
import { exigir, type Sessao } from '../permissao'
import { inicioDeHojeEmSP } from '../dia'
import type { Canal } from '../assistente/canal'
import { chaveTelefone, mascarar, paraEnvio, soDigitos } from '../assistente/telefone'
import {
  AJUSTES_PADRAO,
  GATILHO_NOVO,
  ROTULO_NO,
  STATUS_VIVOS,
  type Ajustes,
  type Gatilho,
  type Grafo,
  type MotivoFim,
  type Status,
} from './tipos'
import { conflitosDeGatilho, lerGatilho } from './casar'
import { acharNo, grafoNovo, lerGrafo, pendencias, temErro, type Pendencia } from './grafo'
import { lerAjustes } from './freios'
import { exigirCampanhasLiberadas } from './acesso'
import { encerrarViva, horarioDaEmpresa, iniciar } from './execucao'
import { caminhoDaMidia } from './midia'

const auditar = (
  db: BancoDaOrg,
  sessao: Sessao,
  acao: string,
  alvo: { id: string; nome: string },
  extra: { antes?: Prisma.InputJsonValue; depois?: Prisma.InputJsonValue; motivo?: string } = {},
) =>
  db.auditoria.create({
    data: {
      orgId: sessao.orgId,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao,
      alvoTipo: 'campanha',
      alvoId: alvo.id,
      alvoNome: alvo.nome,
      ...extra,
    },
  })

async function podeMexer(sessao: Sessao) {
  exigir(sessao, 'agente.configurar')
  return exigirCampanhasLiberadas(sessao.orgId)
}

// ─────────────────────────────────────────────────────────────
// A LISTA
// ─────────────────────────────────────────────────────────────

export type LinhaCampanha = {
  id: string
  nome: string
  pasta: string | null
  ativa: boolean
  gatilho: Gatilho
  atualizadaEm: Date
  entraram: number
  dentro: number
  paraPessoa: number
  concluiram: number
}

/** As campanhas da empresa com os números de cada uma — contados, nunca guardados. */
export async function listarCampanhas(sessao: Sessao): Promise<LinhaCampanha[]> {
  exigir(sessao, 'agente.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const campanhas = await db.campanha.findMany({
      orderBy: [{ ativa: 'desc' }, { atualizadaEm: 'desc' }],
      select: { id: true, nome: true, pasta: true, ativa: true, gatilho: true, atualizadaEm: true },
    })
    // Uma consulta agrupada só (sem Promise.all dentro da transação).
    const grupos = await db.campanhaExecucao.groupBy({
      by: ['campanhaId', 'status', 'motivoFim'],
      where: { teste: false },
      _count: { _all: true },
    })
    return campanhas.map((c) => {
      const meus = grupos.filter((g) => g.campanhaId === c.id)
      const soma = (f: (g: (typeof meus)[number]) => boolean) => meus.filter(f).reduce((s, g) => s + g._count._all, 0)
      return {
        ...c,
        gatilho: lerGatilho(c.gatilho),
        entraram: soma(() => true),
        dentro: soma((g) => (STATUS_VIVOS as readonly string[]).includes(g.status)),
        paraPessoa: soma((g) => g.motivoFim === 'humano'),
        concluiram: soma((g) => g.status === 'concluida' && g.motivoFim === 'fim'),
      }
    })
  })
}

// ─────────────────────────────────────────────────────────────
// CRIAR, DUPLICAR, APAGAR
// ─────────────────────────────────────────────────────────────

const nomeLimpo = (nome: string) => {
  const n = nome.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!n) throw new Error('Dê um nome à campanha.')
  return n
}

export async function criarCampanha(sessao: Sessao, nome: string): Promise<string> {
  await podeMexer(sessao)
  const n = nomeLimpo(nome)
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.campanha.create({
      data: {
        orgId: sessao.orgId,
        nome: n,
        ativa: false,
        gatilho: { ...GATILHO_NOVO } as Prisma.InputJsonValue,
        grafo: grafoNovo() as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, nome: true },
    })
    await auditar(db, sessao, 'campanha.criou', c)
    return c.id
  })
}

export async function duplicarCampanha(sessao: Sessao, id: string): Promise<string> {
  await podeMexer(sessao)
  return comoOrg(sessao.orgId, async (db) => {
    const o = await db.campanha.findUnique({ where: { id }, select: { nome: true, pasta: true, gatilho: true, grafo: true } })
    if (!o) throw new Error('Essa campanha não existe mais.')
    // A cópia nasce PAUSADA e sem frase: duas ativas com a mesma frase é
    // exatamente o que `conflitosDeGatilho` proíbe.
    const g = lerGatilho(o.gatilho)
    const c = await db.campanha.create({
      data: {
        orgId: sessao.orgId,
        nome: nomeLimpo(`${o.nome} (cópia)`),
        pasta: o.pasta,
        ativa: false,
        gatilho: { ...g, frases: [], anuncioIds: [] } as Prisma.InputJsonValue,
        grafo: lerGrafo(o.grafo) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, nome: true },
    })
    await auditar(db, sessao, 'campanha.criou', c, { motivo: `cópia de "${o.nome}"` })
    return c.id
  })
}

/** Apagar leva o histórico junto. Por isso não se apaga com gente dentro. */
export async function apagarCampanha(sessao: Sessao, id: string): Promise<void> {
  await podeMexer(sessao)
  await comoOrg(sessao.orgId, async (db) => {
    const c = await db.campanha.findUnique({ where: { id }, select: { id: true, nome: true } })
    if (!c) return
    const dentro = await db.campanhaExecucao.count({ where: { campanhaId: id, status: { in: [...STATUS_VIVOS] } } })
    if (dentro > 0) {
      throw new Error(`Há ${dentro} ${dentro === 1 ? 'pessoa' : 'pessoas'} dentro desta campanha. Tire-as em "Contatos dentro agora" ou espere terminarem.`)
    }
    // Outra campanha que leva para esta ficaria com o bloco "Ir para" apontando para o nada.
    const outras = await db.campanha.findMany({ where: { id: { not: id } }, select: { nome: true, grafo: true } })
    const quemAponta = outras.filter((o) => lerGrafo(o.grafo).nodes.some((n) => n.tipo === 'conectar' && n.dados.campanhaId === id))
    if (quemAponta.length > 0) {
      throw new Error(`A campanha "${quemAponta[0]!.nome}" leva para esta. Mude o bloco "Ir para outra campanha" dela antes de apagar.`)
    }
    await db.campanha.delete({ where: { id } })
    await auditar(db, sessao, 'campanha.apagou', c)
  })
}

// ─────────────────────────────────────────────────────────────
// O EDITOR
// ─────────────────────────────────────────────────────────────

export type ParaEditor = {
  campanha: { id: string; nome: string; pasta: string | null; ativa: boolean; gatilho: Gatilho; grafo: Grafo }
  outras: { id: string; nome: string }[]
  equipe: { id: string; nome: string; temTelefone: boolean; dono: boolean }[]
  midias: { id: string; nome: string; tipo: string; tamanho: number; previa: string | null }[]
  horario: { texto: string | null; entendido: boolean }
  meuTelefone: string | null
}

export async function lerParaEditor(sessao: Sessao, id: string): Promise<ParaEditor | null> {
  exigir(sessao, 'agente.configurar')
  const horario = await horarioDaEmpresa(sessao.orgId)
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.campanha.findUnique({ where: { id } })
    if (!c) return null
    const outras = await db.campanha.findMany({ where: { id: { not: id } }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
    const usuarios = await db.usuario.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, telefone: true, acessos: { select: { papel: true } } },
    })
    const midias = await db.midia.findMany({
      orderBy: { criadaEm: 'desc' },
      take: 50,
      select: { id: true, nome: true, tipo: true, tamanho: true },
    })
    const eu = usuarios.find((u) => u.id === sessao.usuarioId)
    return {
      campanha: { id: c.id, nome: c.nome, pasta: c.pasta, ativa: c.ativa, gatilho: lerGatilho(c.gatilho), grafo: lerGrafo(c.grafo) },
      outras,
      equipe: usuarios
        .filter((u) => !u.acessos.every((a) => a.papel === 'SUPORTE'))
        .map((u) => ({ id: u.id, nome: u.nome, temTelefone: !!chaveTelefone(u.telefone), dono: u.acessos.some((a) => a.papel === 'DONO') })),
      midias: midias.map((m) => ({ ...m, previa: caminhoDaMidia(sessao.orgId, m.id) })),
      horario: { texto: horario.texto, entendido: horario.horario !== null },
      meuTelefone: eu?.telefone && chaveTelefone(eu.telefone) ? mascarar(eu.telefone) : null,
    }
  })
}

export type Salvamento = { ok: true; pendencias: Pendencia[] } | { ok: false; erro: string; pendencias?: Pendencia[] }

/** As outras campanhas ATIVAS da empresa, para conferir conflito de frase. */
async function outrasAtivas(db: BancoDaOrg, id: string) {
  const ativas = await db.campanha.findMany({ where: { ativa: true, id: { not: id } }, select: { id: true, nome: true, gatilho: true } })
  return ativas.map((a) => ({ id: a.id, nome: a.nome, gatilho: lerGatilho(a.gatilho) }))
}

async function conferir(db: BancoDaOrg, id: string, gatilho: Gatilho, grafo: Grafo, horarioEntendido: boolean) {
  const campanhas = await db.campanha.findMany({ where: { id: { not: id } }, select: { id: true, nome: true } })
  return pendencias(grafo, {
    campanhaId: id,
    campanhas,
    frases: gatilho.frases,
    anuncioIds: gatilho.anuncioIds,
    tipoGatilho: gatilho.tipo,
    horarioEntendido,
  })
}

/**
 * Grava nome, gatilho e desenho. Campanha PAUSADA grava mesmo com pendência
 * (é rascunho); ATIVA só grava sem erro e sem conflito de frase — senão a
 * mudança iria para o cliente quebrada no segundo seguinte.
 */
export async function salvarCampanha(
  sessao: Sessao,
  id: string,
  dados: { nome: string; pasta?: string | null; gatilho: unknown; grafo: unknown },
): Promise<Salvamento> {
  await podeMexer(sessao)
  const nome = nomeLimpo(dados.nome)
  const pasta = (dados.pasta ?? '').trim().slice(0, 40) || null
  const gatilho = lerGatilho(dados.gatilho)
  const grafo = lerGrafo(dados.grafo)
  const { horario } = await horarioDaEmpresa(sessao.orgId)
  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.campanha.findUnique({ where: { id }, select: { id: true, nome: true, ativa: true, gatilho: true } })
    if (!antes) return { ok: false as const, erro: 'Essa campanha não existe mais.' }
    const ps = await conferir(db, id, gatilho, grafo, horario !== null)
    if (antes.ativa) {
      if (temErro(ps)) return { ok: false as const, erro: 'A campanha está ativa: resolva as pendências antes de salvar (ou pause).', pendencias: ps }
      const conflitos = conflitosDeGatilho({ id, nome, gatilho }, await outrasAtivas(db, id))
      if (conflitos.length) return { ok: false as const, erro: conflitos[0]!, pendencias: ps }
    }
    await db.campanha.update({
      where: { id },
      data: { nome, pasta, gatilho: gatilho as Prisma.InputJsonValue, grafo: grafo as unknown as Prisma.InputJsonValue },
    })
    await auditar(db, sessao, 'campanha.alterou', { id, nome }, {
      antes: { nome: antes.nome, gatilho: antes.gatilho as Prisma.InputJsonValue },
      depois: { nome, gatilho: gatilho as Prisma.InputJsonValue, blocos: grafo.nodes.length },
    })
    return { ok: true as const, pendencias: ps }
  })
}

/** Ativar confere tudo; pausar sempre pode. Quem está dentro de uma pausada fica parado onde está. */
export async function ativarCampanha(sessao: Sessao, id: string, ativa: boolean): Promise<Salvamento> {
  await podeMexer(sessao)
  const { horario } = await horarioDaEmpresa(sessao.orgId)
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.campanha.findUnique({ where: { id }, select: { id: true, nome: true, ativa: true, gatilho: true, grafo: true } })
    if (!c) return { ok: false as const, erro: 'Essa campanha não existe mais.' }
    const gatilho = lerGatilho(c.gatilho)
    const ps = await conferir(db, id, gatilho, lerGrafo(c.grafo), horario !== null)
    if (ativa) {
      if (temErro(ps)) return { ok: false as const, erro: 'Resolva as pendências antes de ativar.', pendencias: ps }
      const conflitos = conflitosDeGatilho({ id, nome: c.nome, gatilho }, await outrasAtivas(db, id))
      if (conflitos.length) return { ok: false as const, erro: conflitos[0]!, pendencias: ps }
    }
    if (c.ativa !== ativa) {
      await db.campanha.update({ where: { id }, data: { ativa } })
      await auditar(db, sessao, ativa ? 'campanha.ativou' : 'campanha.pausou', c)
    }
    return { ok: true as const, pendencias: ps }
  })
}

// ─────────────────────────────────────────────────────────────
// QUEM ESTÁ DENTRO
// ─────────────────────────────────────────────────────────────

export type Dentro = {
  id: string
  nome: string | null
  telefone: string
  bloco: string
  status: Status
  desde: Date
  proximoEm: Date | null
  teste: boolean
}

export async function contatosDentro(sessao: Sessao, campanhaId: string): Promise<Dentro[]> {
  exigir(sessao, 'agente.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.campanha.findUnique({ where: { id: campanhaId }, select: { grafo: true } })
    if (!c) return []
    const g = lerGrafo(c.grafo)
    const linhas = await db.campanhaExecucao.findMany({
      where: { campanhaId, status: { in: [...STATUS_VIVOS] } },
      orderBy: { iniciadaEm: 'desc' },
      take: 200,
      select: { id: true, nome: true, envio: true, nodeId: true, status: true, iniciadaEm: true, proximoEm: true, teste: true },
    })
    return linhas.map((l) => {
      const no = acharNo(g, l.nodeId)
      return {
        id: l.id,
        nome: l.nome,
        telefone: mascarar(l.envio),
        bloco: no ? ROTULO_NO[no.tipo] : 'bloco apagado',
        status: l.status as Status,
        desde: l.iniciadaEm,
        proximoEm: l.proximoEm,
        teste: l.teste,
      }
    })
  })
}

export async function removerContato(sessao: Sessao, execucaoId: string): Promise<void> {
  await podeMexer(sessao)
  const alvo = await comoOrg(sessao.orgId, (db) =>
    db.campanhaExecucao.findUnique({ where: { id: execucaoId }, select: { campanha: { select: { id: true, nome: true } } } }),
  )
  if (!alvo) return
  const tirou = await encerrarViva(sessao.orgId, execucaoId, 'cancelada', 'removido' satisfies MotivoFim)
  if (tirou) {
    await comoOrg(sessao.orgId, (db) => auditar(db, sessao, 'campanha.alterou', alvo.campanha, { motivo: 'tirou um contato da campanha' }))
  }
}

// ─────────────────────────────────────────────────────────────
// TESTAR COM MEU NÚMERO
// ─────────────────────────────────────────────────────────────

/**
 * Começa a campanha para o telefone de quem está testando, ignorando a
 * reentrada e a pausa (é teste). Não conta nos números da lista. Se o número
 * estava dentro de outra campanha, sai dela antes ('teste').
 */
export async function testarCampanha(sessao: Sessao, id: string, canal: Canal): Promise<{ ok: true; aviso?: string } | { ok: false; erro: string }> {
  await podeMexer(sessao)
  const { horario } = await horarioDaEmpresa(sessao.orgId)
  const dados = await comoOrg(sessao.orgId, async (db) => {
    const c = await db.campanha.findUnique({ where: { id }, select: { id: true, nome: true, gatilho: true, grafo: true } })
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { telefone: true, nome: true } })
    const ps = c ? await conferir(db, id, lerGatilho(c.gatilho), lerGrafo(c.grafo), horario !== null) : []
    return { c, eu, ps }
  })
  if (!dados.c) return { ok: false, erro: 'Essa campanha não existe mais.' }
  if (temErro(dados.ps)) return { ok: false, erro: 'Resolva as pendências antes de testar.' }
  const chave = chaveTelefone(dados.eu?.telefone)
  if (!chave || !dados.eu?.telefone) return { ok: false, erro: 'Seu cadastro não tem telefone. Ponha o seu WhatsApp em Equipe e teste de novo.' }

  const viva = await comoOrg(sessao.orgId, (db) =>
    db.campanhaExecucao.findFirst({ where: { telefone: chave, status: { in: [...STATUS_VIVOS] } }, select: { id: true } }),
  )
  if (viva) await encerrarViva(sessao.orgId, viva.id, 'cancelada', 'teste')

  const r = await iniciar(
    sessao.orgId,
    id,
    { chave, envio: paraEnvio(dados.eu.telefone) ?? soDigitos(dados.eu.telefone), nome: dados.eu.nome },
    { teste: true },
    { canal },
  )
  await comoOrg(sessao.orgId, (db) => auditar(db, sessao, 'campanha.testou', dados.c!))
  if (!r) return { ok: false, erro: 'Não deu para começar o teste. Tente de novo em alguns segundos.' }
  return {
    ok: true,
    ...(canal.real ? {} : { aviso: 'O WhatsApp não está conectado neste servidor: nada saiu de verdade (o teste ficou só no registro).' }),
  }
}

// ─────────────────────────────────────────────────────────────
// OS FREIOS DA EMPRESA
// ─────────────────────────────────────────────────────────────

export async function lerAjustesDaTela(sessao: Sessao): Promise<Ajustes & { hojeEmpresa: number }> {
  exigir(sessao, 'agente.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const a = await db.campanhaAjustes.findUnique({ where: { orgId: sessao.orgId } })
    const hoje = await db.campanhaPasso.aggregate({
      where: { em: { gte: inicioDeHojeEmSP() } },
      _sum: { enviadas: true, internas: true },
    })
    return {
      porContatoDia: a?.porContatoDia ?? AJUSTES_PADRAO.porContatoDia,
      porEmpresaDia: a?.porEmpresaDia ?? AJUSTES_PADRAO.porEmpresaDia,
      intervaloSeg: a?.intervaloSeg ?? AJUSTES_PADRAO.intervaloSeg,
      hojeEmpresa: (hoje._sum.enviadas ?? 0) + (hoje._sum.internas ?? 0),
    }
  })
}

export async function salvarAjustes(sessao: Sessao, bruto: Partial<Record<keyof Ajustes, unknown>>): Promise<Ajustes> {
  await podeMexer(sessao)
  const a = lerAjustes(bruto, AJUSTES_PADRAO)
  await comoOrg(sessao.orgId, async (db) => {
    await db.campanhaAjustes.upsert({ where: { orgId: sessao.orgId }, create: { orgId: sessao.orgId, ...a }, update: a })
    await auditar(db, sessao, 'campanha.alterou', { id: sessao.orgId, nome: 'limites das campanhas' }, { depois: a })
  })
  return a
}
