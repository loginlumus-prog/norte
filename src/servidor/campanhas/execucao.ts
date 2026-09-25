// O motor ligado ao banco e ao WhatsApp.
//
// motor.ts sabe andar pelo roteiro; este arquivo sabe TRAVAR a execução,
// ler e gravar onde a pessoa está, contar as mensagens do dia, mandar pelo
// canal da empresa e acordar quem venceu.
//
// ── a trava ──────────────────────────────────────────────────
// A mesma execução pode ser empurrada por dois lados no mesmo segundo: a
// resposta da pessoa chegando pelo webhook e o relógio acordando a espera
// dela. Sem trava, as duas rodadas andariam o roteiro e a pessoa receberia
// tudo em dobro. A trava é uma coluna (`trava`, `travaEm`) reivindicada com
// UPDATE condicional — quem chega em segundo não acha linha para atualizar.
// Ela vence sozinha em TRAVA_VENCE_SEG (processo que morreu no meio não
// prende ninguém para sempre), e toda gravação confere que a trava ainda é
// dela: tirar a pessoa da campanha limpa a trava, e a rodada que estava no
// meio para sem mandar mais nada.
//
// ── transação curta ──────────────────────────────────────────
// Nada aqui manda mensagem DENTRO de um `comoOrg`: cada leitura e cada
// gravação abre e fecha a sua. Mandar pelo WhatsApp leva segundos, e uma
// transação aberta esse tempo todo seguraria uma conexão do pool pequeno.

import { randomUUID } from 'node:crypto'
import type { CampanhaExecucao } from '@prisma/client'
import { comoOrg } from '../banco'
import { inicioDeHojeEmSP } from '../dia'
import type { Canal } from '../assistente/canal'
import { paraEnvio, soDigitos } from '../assistente/telefone'
import {
  AJUSTES_PADRAO,
  STATUS_VIVOS,
  TRAVA_VENCE_SEG,
  ehViva,
  type Ajustes,
  type DadosMidia,
  type DadosPassar,
  type MotivoFim,
  type Status,
  type Vars,
} from './tipos'
import { inicioDo, lerGrafo } from './grafo'
import { lerHorario, type Horario } from './horario'
import { rodar, type Deps, type Envio, type EstadoExecucao, type Evento, type Resultado } from './motor'
import { esperaMinima, podeEnviar } from './freios'
import { urlDaMidia } from './midia'
import { humanoAteDoTelefone, humanoNoComando, marcarComHumano } from './humano'

/**
 * O relógio de verdade, trocável nos testes: o "digitando" de dois segundos
 * e o ritmo entre mensagens são `dormir`, e teste não precisa esperar.
 */
export const relogio = {
  dormir: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}

export type Contexto = {
  canal: Canal
  /** Instante fixo (testes, relógio). Sem ele, o relógio da máquina. */
  agora?: Date
}

const agoraDe = (ctx: Contexto) => () => ctx.agora ?? new Date()

// ─────────────────────────────────────────────────────────────
// LEITURAS
// ─────────────────────────────────────────────────────────────

export async function lerAjustesDaEmpresa(orgId: string): Promise<Ajustes> {
  const a = await comoOrg(orgId, (db) =>
    db.campanhaAjustes.findUnique({
      where: { orgId },
      select: { porContatoDia: true, porEmpresaDia: true, intervaloSeg: true },
    }),
  )
  return a ?? { ...AJUSTES_PADRAO }
}

/** Mensagens de campanha HOJE (São Paulo): para este contato, e da empresa toda. */
export async function contarHoje(orgId: string, chave: string, agora: Date): Promise<{ contato: number; empresa: number }> {
  const desde = inicioDeHojeEmSP(agora)
  return comoOrg(orgId, async (db) => {
    const doContato = await db.campanhaPasso.aggregate({
      where: { em: { gte: desde }, execucao: { telefone: chave } },
      _sum: { enviadas: true },
    })
    const daEmpresa = await db.campanhaPasso.aggregate({
      where: { em: { gte: desde } },
      _sum: { enviadas: true, internas: true },
    })
    return {
      contato: doContato._sum.enviadas ?? 0,
      empresa: (daEmpresa._sum.enviadas ?? 0) + (daEmpresa._sum.internas ?? 0),
    }
  })
}

/**
 * O horário da loja, entendido. A empresa pode ter várias lojas; a campanha
 * sai por UM número, então vale o horário da primeira loja aberta ao
 * público (a mesma que o assistente cita primeiro).
 */
export async function horarioDaEmpresa(orgId: string): Promise<{ texto: string | null; horario: Horario | null }> {
  const u = await comoOrg(orgId, (db) =>
    db.unidade.findFirst({
      where: { ativa: true, ehDeposito: false },
      orderBy: { criadaEm: 'asc' },
      select: { horario: true },
    }),
  )
  return { texto: u?.horario ?? null, horario: lerHorario(u?.horario) }
}

// ─────────────────────────────────────────────────────────────
// TRAVA E GRAVAÇÃO
// ─────────────────────────────────────────────────────────────

async function travar(orgId: string, id: string, agora: Date): Promise<string | null> {
  const token = randomUUID()
  const vence = new Date(agora.getTime() - TRAVA_VENCE_SEG * 1000)
  const r = await comoOrg(orgId, (db) =>
    db.campanhaExecucao.updateMany({
      where: {
        id,
        status: { in: [...STATUS_VIVOS] },
        OR: [{ trava: null }, { travaEm: { lt: vence } }],
      },
      data: { trava: token, travaEm: agora },
    }),
  )
  return r.count === 1 ? token : null
}

async function soltar(orgId: string, id: string, token: string) {
  await comoOrg(orgId, (db) =>
    db.campanhaExecucao.updateMany({ where: { id, trava: token }, data: { trava: null, travaEm: null } }),
  )
}

/** Encerra uma execução viva por fora do motor (parar, remover, trocar de funil). */
export async function encerrarViva(orgId: string, id: string, status: 'cancelada' | 'concluida' | 'erro', motivo: MotivoFim, agora = new Date()) {
  const r = await comoOrg(orgId, (db) =>
    db.campanhaExecucao.updateMany({
      where: { id, status: { in: [...STATUS_VIVOS] } },
      // A trava vai junto: a rodada que estiver no meio perde o direito de
      // gravar, e para (ver `salvar` no motor).
      data: { status, motivoFim: motivo, finalizadaEm: agora, proximoEm: null, trava: null, travaEm: null },
    }),
  )
  return r.count === 1
}

const paraEstado = (x: CampanhaExecucao): EstadoExecucao => ({
  id: x.id,
  campanhaId: x.campanhaId,
  nodeId: x.nodeId,
  status: x.status as Status,
  proximoEm: x.proximoEm,
  vars: (x.vars && typeof x.vars === 'object' ? x.vars : {}) as Vars,
  teste: x.teste,
  semente: x.telefone,
  motivoFim: (x.motivoFim as MotivoFim | null) ?? null,
})

/** O erro é o do índice "uma campanha viva por telefone"? */
export function ehJaViva(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const x = e as { code?: unknown; meta?: unknown; message?: unknown }
  if (x.code !== 'P2002' && x.code !== '23505') return false
  const onde = `${JSON.stringify(x.meta ?? null)} ${String(x.message ?? '')}`
  return onde.includes('campanha_execucoes_uma_viva') || onde.includes('telefone')
}

// ─────────────────────────────────────────────────────────────
// O TEXTO QUE A EQUIPE RECEBE
// ─────────────────────────────────────────────────────────────

export function textoParaEquipe(p: { campanha: string; nome: string | null; envio: string; ultima?: string | null }): string {
  const quem = p.nome?.trim() || 'Um contato'
  const linhas = [
    `*${quem}* quer falar com alguém da loja (campanha "${p.campanha}").`,
    `WhatsApp: https://wa.me/${soDigitos(p.envio)}`,
  ]
  if (p.ultima?.trim()) linhas.push(`Última mensagem: "${p.ultima.trim().slice(0, 300)}"`)
  linhas.push('As campanhas ficam 24 horas sem falar com esse número. Responda pelo seu WhatsApp.')
  return linhas.join('\n')
}

// ─────────────────────────────────────────────────────────────
// RODAR UMA EXECUÇÃO
// ─────────────────────────────────────────────────────────────

type Carregada = {
  exec: CampanhaExecucao
  campanha: { id: string; nome: string; ativa: boolean; grafo: unknown }
}

async function carregar(orgId: string, id: string): Promise<Carregada | null> {
  return comoOrg(orgId, async (db) => {
    const exec = await db.campanhaExecucao.findUnique({ where: { id } })
    if (!exec) return null
    const campanha = await db.campanha.findUnique({
      where: { id: exec.campanhaId },
      select: { id: true, nome: true, ativa: true, grafo: true },
    })
    return campanha ? { exec, campanha } : null
  })
}

/** Roda o motor numa execução JÁ TRAVADA com `token`, e solta no fim. */
async function rodarTravada(
  orgId: string,
  c: Carregada,
  token: string,
  evento: Evento,
  ctx: Contexto,
): Promise<Resultado> {
  const agora = agoraDe(ctx)
  const grafo = lerGrafo(c.campanha.grafo)
  const ajustes = await lerAjustesDaEmpresa(orgId)
  const { horario } = await horarioDaEmpresa(orgId)
  const chave = c.exec.telefone
  const envio = c.exec.envio
  let ultimoEnvio: Date | null = c.exec.ultimoEnvioEm
  const ultimaEntrada = c.exec.ultimaEntradaEm

  /** Os freios, e o ritmo. 'limite' = não sai, e a execução para. */
  const liberar = async (): Promise<boolean> => {
    const n = await contarHoje(orgId, chave, agora())
    const v = podeEnviar({
      ajustes,
      enviadasHojeContato: n.contato,
      enviadasHojeEmpresa: n.empresa,
      teste: c.exec.teste,
      // Toda execução nasce de uma mensagem da própria pessoa (a frase, o
      // anúncio) ou do teste do dono; "Ir para outra campanha" herda.
      iniciadaPeloContato: true,
      ultimaEntradaEm: ultimaEntrada,
      agora: agora(),
    })
    if (v !== 'ok') {
      console.warn(`[campanhas] ${orgId}: envio segurado (${v}) na execução ${c.exec.id}`)
      return false
    }
    const espera = esperaMinima(ultimoEnvio, agora(), ajustes.intervaloSeg)
    if (espera > 0) await relogio.dormir(espera)
    return true
  }

  const depois = (ok: boolean): Envio => {
    if (!ok) return 'falha'
    ultimoEnvio = ctx.agora ?? new Date()
    return 'ok'
  }

  const deps: Deps = {
    agora,
    dormir: relogio.dormir,
    horario,
    async enviarTexto(texto) {
      if (!(await liberar())) return 'limite'
      const r = await ctx.canal.enviar(envio, texto)
      return depois(r.ok)
    },
    async enviarMidia(d: DadosMidia, legenda: string) {
      if (!(await liberar())) return 'limite'
      const url = d.midiaId ? urlDaMidia(orgId, d.midiaId, agora()) : null
      if (ctx.canal.enviarMidia && url && d.tipo) {
        const r = await ctx.canal.enviarMidia(envio, { tipo: d.tipo, url, legenda: legenda || undefined, comoGravado: d.comoGravado })
        return depois(r.ok)
      }
      // Canal sem mídia (ou servidor sem NORTE_URL): vai a legenda, e o log diz.
      console.warn(
        `[campanhas] ${orgId}: ${ctx.canal.enviarMidia ? 'sem NORTE_URL para assinar a mídia' : `o canal ${ctx.canal.nome} não manda mídia`}; foi só a legenda`,
      )
      if (!legenda) return 'ok'
      const r = await ctx.canal.enviar(envio, legenda)
      return depois(r.ok)
    },
    async passarParaPessoa(d: DadosPassar, vars: Vars) {
      const pessoas = await comoOrg(orgId, (db) =>
        db.usuario.findMany({
          where: {
            ativo: true,
            telefone: { not: null },
            ...(d.para === 'donos' ? { acessos: { some: { papel: 'DONO' } } } : { id: { in: d.usuarioIds } }),
          },
          select: { telefone: true },
          take: 10,
        }),
      )
      if (pessoas.length === 0) console.warn(`[campanhas] ${orgId}: ninguém com telefone para receber o contato`)
      const texto = textoParaEquipe({
        campanha: c.campanha.nome,
        nome: typeof vars.nome === 'string' ? vars.nome : null,
        envio,
        ultima: typeof vars.resposta === 'string' ? vars.resposta : typeof vars.ultima === 'string' ? vars.ultima : null,
      })
      let saiu = 0
      for (const p of pessoas) {
        const numero = paraEnvio(p.telefone ?? '')
        if (!numero) continue
        const r = await ctx.canal.enviar(numero, texto)
        if (r.ok) saiu++
      }
      // O mesmo carimbo de quando a loja escreve pelo celular: por 24 horas
      // nenhuma campanha começa com este número, e o recado automático cala.
      await marcarComHumano(orgId, envio, agora())
      return saiu
    },
    async registrar(p) {
      await comoOrg(orgId, (db) =>
        db.campanhaPasso.create({
          data: {
            orgId,
            execucaoId: c.exec.id,
            campanhaId: c.campanha.id,
            nodeId: p.nodeId,
            tipo: p.tipo,
            saida: p.saida ?? null,
            enviadas: p.enviadas ?? 0,
            internas: p.internas ?? 0,
            em: agora(),
          },
        }),
      )
    },
    async salvar(e) {
      const final = !ehViva(e.status)
      const r = await comoOrg(orgId, (db) =>
        db.campanhaExecucao.updateMany({
          where: { id: e.id, trava: token },
          data: {
            nodeId: e.nodeId,
            status: e.status,
            proximoEm: e.proximoEm,
            vars: e.vars as object,
            motivoFim: e.motivoFim,
            ultimoEnvioEm: ultimoEnvio,
            ...(final ? { finalizadaEm: agora(), trava: null, travaEm: null } : { travaEm: agora() }),
          },
        }),
      )
      return r.count === 1
    },
  }

  try {
    return await rodar(grafo, paraEstado(c.exec), evento, deps)
  } finally {
    await soltar(orgId, c.exec.id, token)
  }
}

/**
 * Empurra uma execução que já existe: uma resposta, ou o relógio.
 * Nulo quando não deu para travar (outra rodada está nela) ou quando ela
 * não está mais viva.
 */
export async function andar(orgId: string, execucaoId: string, evento: Evento, ctx: Contexto): Promise<Resultado | null> {
  const agora = ctx.agora ?? new Date()
  let token = await travar(orgId, execucaoId, agora)
  // Resposta chegando enquanto a rodada anterior ainda manda o "digitando":
  // espera um pouco em vez de perder a resposta.
  for (let i = 0; !token && evento.tipo === 'resposta' && i < 6; i++) {
    await relogio.dormir(500)
    token = await travar(orgId, execucaoId, ctx.agora ?? new Date())
  }
  if (!token) return null

  const c = await carregar(orgId, execucaoId)
  if (!c || !ehViva(c.exec.status)) {
    await soltar(orgId, execucaoId, token)
    return null
  }
  // Alguém da loja pegou a conversa enquanto a pessoa esperava (o intervalo,
  // a resposta): o roteiro não volta a falar por cima dela.
  if (!c.exec.teste && humanoNoComando(await humanoAteDoTelefone(orgId, c.exec.telefone), ctx.agora ?? new Date())) {
    await encerrarViva(orgId, execucaoId, 'cancelada', 'humano_assumiu', ctx.agora ?? new Date())
    return null
  }
  // Campanha pausada: quem está dentro fica parado onde está. Teste do dono
  // roda mesmo pausada — é para isso que ele existe.
  if (!c.campanha.ativa && !c.exec.teste) {
    await soltar(orgId, execucaoId, token)
    return null
  }
  const r = await rodarTravada(orgId, c, token, evento, ctx)
  if (r.conectarPara) {
    await iniciar(
      orgId,
      r.conectarPara,
      { chave: c.exec.telefone, envio: c.exec.envio, nome: c.exec.nome },
      { teste: c.exec.teste, saltos: Number(r.estado.vars._saltos ?? 1), ultimaEntradaEm: c.exec.ultimaEntradaEm, conectado: true },
      ctx,
    )
  }
  return r
}

export type ContatoCampanha = { chave: string; envio: string; nome: string | null }

/**
 * Abre uma execução nova e anda até a primeira espera.
 *
 * Nulo quando a pessoa já tem uma campanha viva (o índice parcial recusa a
 * segunda) ou quando a campanha não existe / não tem início. Quem chama
 * encerra a anterior ANTES, quando a troca é de propósito.
 */
export async function iniciar(
  orgId: string,
  campanhaId: string,
  contato: ContatoCampanha,
  opcoes: { teste: boolean; saltos?: number; ultimaEntradaEm?: Date | null; conectado?: boolean },
  ctx: Contexto,
): Promise<Resultado | null> {
  const agora = ctx.agora ?? new Date()
  const campanha = await comoOrg(orgId, (db) =>
    db.campanha.findUnique({ where: { id: campanhaId }, select: { id: true, nome: true, ativa: true, grafo: true } }),
  )
  if (!campanha) return null
  // Pausada não recebe ninguém — nem por "Ir para outra campanha". O teste passa.
  if (!campanha.ativa && !opcoes.teste) return null
  const inicio = inicioDo(lerGrafo(campanha.grafo))
  if (!inicio) return null

  const token = randomUUID()
  let exec: CampanhaExecucao
  try {
    exec = await comoOrg(orgId, (db) =>
      db.campanhaExecucao.create({
        data: {
          orgId,
          campanhaId,
          telefone: contato.chave,
          envio: contato.envio,
          nome: contato.nome,
          nodeId: inicio.id,
          status: 'rodando',
          vars: { nome: contato.nome, ...(opcoes.saltos ? { _saltos: opcoes.saltos } : {}) },
          teste: opcoes.teste,
          trava: token,
          travaEm: agora,
          ultimaEntradaEm: opcoes.ultimaEntradaEm ?? agora,
          iniciadaEm: agora,
        },
      }),
    )
  } catch (e) {
    if (ehJaViva(e)) return null
    throw e
  }
  const r = await rodarTravada(orgId, { exec, campanha }, token, { tipo: 'iniciar' }, ctx)
  if (r.conectarPara) {
    await iniciar(
      orgId,
      r.conectarPara,
      contato,
      { teste: opcoes.teste, saltos: Number(r.estado.vars._saltos ?? 1), ultimaEntradaEm: exec.ultimaEntradaEm, conectado: true },
      ctx,
    )
  }
  return r
}

// ─────────────────────────────────────────────────────────────
// O RELÓGIO
// ─────────────────────────────────────────────────────────────

/** As execuções desta empresa que venceram agora (e as travadas por processo morto). */
export async function devidas(orgId: string, agora: Date, limite = 100): Promise<string[]> {
  const vence = new Date(agora.getTime() - TRAVA_VENCE_SEG * 1000)
  const linhas = await comoOrg(orgId, (db) =>
    db.campanhaExecucao.findMany({
      where: {
        AND: [
          {
            OR: [
              { status: { in: ['esperando', 'aguardando_resposta'] }, proximoEm: { lte: agora } },
              { status: 'rodando', iniciadaEm: { lt: vence } },
            ],
          },
          { OR: [{ trava: null }, { travaEm: { lt: vence } }] },
          { OR: [{ teste: true }, { campanha: { ativa: true } }] },
        ],
      },
      orderBy: { proximoEm: 'asc' },
      take: limite,
      select: { id: true },
    }),
  )
  return linhas.map((l) => l.id)
}

export type Batida = { empresas: number; acordadas: number; falhas: number }

/**
 * Acorda quem venceu, em todas as empresas. Chamado de minuto em minuto por
 * POST /api/campanhas/tick.
 *
 * Idempotente: quem já foi acordado tem `proximoEm` no futuro (ou acabou), e
 * a trava impede duas batidas simultâneas de pegarem a mesma execução.
 */
export async function tickCampanhasCom(
  agora: Date,
  deps: {
    empresas: () => Promise<{ id: string; slug: string }[]>
    /** O canal da empresa, ou nulo para pular a empresa (sem linha de verdade). */
    canalDe: (org: { id: string; slug: string }) => Promise<Canal | null>
    apta: (orgId: string) => Promise<boolean>
  },
): Promise<Batida> {
  const b: Batida = { empresas: 0, acordadas: 0, falhas: 0 }
  for (const org of await deps.empresas()) {
    try {
      if (!(await deps.apta(org.id))) continue
      const ids = await devidas(org.id, agora)
      if (ids.length === 0) continue
      const canal = await deps.canalDe(org)
      if (!canal) continue
      b.empresas++
      for (const id of ids) {
        try {
          const r = await andar(org.id, id, { tipo: 'acordar' }, { canal, agora })
          if (r?.andou) b.acordadas++
        } catch (e) {
          b.falhas++
          console.error(`[campanhas] execução ${id} falhou:`, e instanceof Error ? e.message : e)
        }
      }
    } catch (e) {
      b.falhas++
      console.error(`[campanhas] empresa ${org.id} falhou:`, e instanceof Error ? e.message : e)
    }
  }
  return b
}
