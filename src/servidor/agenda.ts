// Agenda: o horário marcado.
//
// ── o que é ──────────────────────────────────────────────────
// A folha da recepção: "Joana, manicure com a Bia, sexta às 15h". O dia se lê
// em colunas, uma por profissional — é assim que o salão e o consultório
// pensam ("a Bia está livre às 16h?") —, e a semana, numa grade.
//
// ── ninguém atende duas pessoas na mesma hora ────────────────
// Marcar e remarcar pegam uma TRAVA por profissional
// (`pg_advisory_xact_lock`) e só então conferem se o horário encosta em
// outro. Duas recepcionistas marcando a Bia às 15h no mesmo segundo: uma
// espera a outra, e a segunda vê o horário ocupado. E o banco tem a mesma
// regra num gatilho (prisma/sql/rls.sql, `agenda_sem_choque`), para quem
// gravar por fora daqui. Encostar não é sobrepor: 9h–10h e 10h–11h cabem.
//
// ── o horário da loja ────────────────────────────────────────
// Vem da ficha da loja (`Unidade.horario`, o texto "Seg a sex 9h-18h, sáb
// 9h-13h"), lido pelo mesmo leitor das campanhas. Marcar fora dele é possível
// — a consulta das 19h combinada com o médico existe —, mas pede um "é isso
// mesmo". Horário que o leitor não entende não trava nada.
//
// ── a situação ───────────────────────────────────────────────
// MARCADO → CONFIRMADO (o cliente disse que vem) → ATENDIDO. Ou FALTOU, ou
// CANCELADO (desmarcado, com motivo). Nada se apaga: a falta e o desmarcado
// ficam na história, e é deles que sai "quem mais falta".
//
// ── e o dinheiro não passa por aqui ──────────────────────────
// "Atender e cobrar" abre o BALCÃO de sempre com o serviço já lançado; a
// venda, quando fecha, carimba este horário como atendido e guarda qual venda
// o cobrou (ver venda.ts). Não existe um segundo caminho para o dinheiro.
//
// Puro em cima, banco embaixo.

import type { SituacaoAgendamento } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, SemPermissao, unidadesQuePodem, type Sessao } from './permissao'
import { deSP, diaCurtoSP, diaEmSP, horaEmSP, somarDias } from './encomenda'
import { inicioDoDiaEmSP } from './dia'
import { lerHorario, type Horario } from './campanhas/horario'
import { soDigitos } from './cliente'
import { vendidoNaLoja } from './catalogo-loja'
import { centavos, reais } from './dinheiro'

export type { SituacaoAgendamento }

// ─────────────────────────────────────────────────────────────
// SITUAÇÃO
// ─────────────────────────────────────────────────────────────

export const SITUACOES_AGENDA: readonly SituacaoAgendamento[] = ['MARCADO', 'CONFIRMADO', 'ATENDIDO', 'FALTOU', 'CANCELADO']

export const ROTULO_AGENDA: Record<SituacaoAgendamento, string> = {
  MARCADO: 'Marcado',
  CONFIRMADO: 'Confirmado',
  ATENDIDO: 'Atendido',
  FALTOU: 'Faltou',
  CANCELADO: 'Desmarcado',
}

export const NIVEL_AGENDA: Record<SituacaoAgendamento, 'bom' | 'atencao' | 'critico' | 'neutro'> = {
  MARCADO: 'neutro',
  CONFIRMADO: 'bom',
  ATENDIDO: 'bom',
  FALTOU: 'critico',
  CANCELADO: 'neutro',
}

/** Os que ocupam a cadeira. Faltou e desmarcado deixam o horário livre. */
export const OCUPAM: readonly SituacaoAgendamento[] = ['MARCADO', 'CONFIRMADO', 'ATENDIDO']

export const ocupa = (s: SituacaoAgendamento) => OCUPAM.includes(s)

/**
 * Para onde cada situação vai. Confirmado volta para marcado (o clique
 * errado). Atendido, faltou e desmarcado não voltam: são história — quem
 * errou marca um horário novo, e o livro guarda os dois.
 */
const TRANSICOES: Record<SituacaoAgendamento, readonly SituacaoAgendamento[]> = {
  MARCADO: ['CONFIRMADO', 'ATENDIDO', 'FALTOU', 'CANCELADO'],
  CONFIRMADO: ['MARCADO', 'ATENDIDO', 'FALTOU', 'CANCELADO'],
  ATENDIDO: [],
  FALTOU: [],
  CANCELADO: [],
}

export const transicaoAgenda = (de: SituacaoAgendamento, para: SituacaoAgendamento) => TRANSICOES[de].includes(para)

export const ehFinalAgenda = (s: SituacaoAgendamento) => TRANSICOES[s].length === 0

// ─────────────────────────────────────────────────────────────
// HORÁRIOS (puro)
// ─────────────────────────────────────────────────────────────

export type Intervalo = { inicio: Date; fim: Date }

/** Encostar não é sobrepor: 9h–10h e 10h–11h cabem na mesma cadeira. */
export const sobrepoe = (a: Intervalo, b: Intervalo) => a.inicio < b.fim && b.inicio < a.fim

/** Minuto do dia em São Paulo. */
const minutoEmSP = (d: Date) => {
  const [h, m] = horaEmSP(d).split(':').map(Number) as [number, number]
  return h * 60 + m
}

const semanaDe = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay()

/** As janelas em que a loja abre num dia. Sem horário legível, o dia inteiro das 8h às 20h. */
export function janelasDoDia(horario: Horario | null, dia: string): [number, number][] {
  if (!horario) return [[8 * 60, 20 * 60]]
  return [...(horario[semanaDe(dia)] ?? [])].sort((a, b) => a[0] - b[0])
}

/** O horário cabe inteiro dentro de uma janela de funcionamento? Horário ilegível: sim. */
export function dentroDoHorario(horario: Horario | null, i: Intervalo): boolean {
  if (!horario) return true
  const dia = diaEmSP(i.inicio)
  if (diaEmSP(new Date(i.fim.getTime() - 1)) !== dia) return false
  const de = minutoEmSP(i.inicio)
  const ate = de + Math.round((i.fim.getTime() - i.inicio.getTime()) / 60_000)
  return janelasDoDia(horario, dia).some(([a, b]) => de >= a && ate <= b)
}

/**
 * Os horários livres de uma profissional num dia, de `passo` em `passo`
 * minutos, que cabem `duracao` inteira dentro do funcionamento da loja sem
 * encostar em ninguém — e que ainda não passaram.
 */
export function horariosLivres(
  p: { horario: Horario | null; dia: string; ocupados: Intervalo[]; duracaoMin: number; passoMin?: number },
  agora: Date,
): Date[] {
  const passo = p.passoMin ?? 30
  const base = inicioDoDiaEmSP(p.dia).getTime()
  const livres: Date[] = []
  for (const [de, ate] of janelasDoDia(p.horario, p.dia)) {
    for (let m = Math.ceil(de / passo) * passo; m + p.duracaoMin <= ate; m += passo) {
      const inicio = new Date(base + m * 60_000)
      const i = { inicio, fim: new Date(inicio.getTime() + p.duracaoMin * 60_000) }
      if (inicio < agora) continue
      if (p.ocupados.some((o) => sobrepoe(o, i))) continue
      livres.push(inicio)
    }
  }
  return livres
}

/** Duração que vale: a informada, senão a do serviço, senão meia hora. Entre 5 min e 12 h. */
export function duracaoValida(informada: number | null | undefined, doServico: number | null | undefined): number | null {
  const d = informada ?? doServico ?? 30
  if (!Number.isInteger(d) || d < 5 || d > 12 * 60) return null
  return d
}

// ─────────────────────────────────────────────────────────────
// VALIDAÇÃO
// ─────────────────────────────────────────────────────────────

export type DadosHorario = {
  unidadeId: string
  colaboradorId: string
  clienteId?: string | null
  clienteNome?: string | null
  telefone?: string | null
  produtoId?: string | null
  servico?: string | null
  /** "2026-09-26", relógio da loja. */
  dia: string
  /** "15:00", relógio da loja. */
  hora: string
  /** Em minutos. Sem ela, a do serviço do catálogo, senão 30. */
  duracaoMin?: number | null
  observacao?: string | null
  /** A pessoa viu "fora do horário da loja" (ou "já passou") e confirmou. */
  confirmar?: boolean
}

const limpar = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export type HorarioLimpo = {
  unidadeId: string
  colaboradorId: string
  clienteId: string | null
  clienteNome: string
  telefone: string | null
  produtoId: string | null
  servico: string
  inicio: Date
  duracaoMin: number | null
  observacao: string | null
}

/** A forma do que veio da tela. O que depende do banco (serviço, loja) é conferido depois. */
export function validarHorario(d: DadosHorario): { ok: true; limpo: HorarioLimpo } | { ok: false; erro: string } {
  const unidadeId = limpar(d.unidadeId, 64)
  if (!unidadeId) return { ok: false, erro: 'Escolha a loja.' }
  const colaboradorId = limpar(d.colaboradorId, 64)
  if (!colaboradorId) return { ok: false, erro: 'Escolha quem vai atender.' }
  const clienteId = limpar(d.clienteId, 64) || null
  const clienteNome = limpar(d.clienteNome, 120)
  if (!clienteId && clienteNome.length < 2) return { ok: false, erro: 'Para quem é o horário? Escolha no cadastro ou escreva o nome.' }
  const telefone = soDigitos(typeof d.telefone === 'string' ? d.telefone : '')
  if (telefone && (telefone.length < 10 || telefone.length > 11)) {
    return { ok: false, erro: 'O telefone precisa do DDD: 10 ou 11 números, como (71) 99999-0000.' }
  }
  const produtoId = limpar(d.produtoId, 64) || null
  const servico = limpar(d.servico, 120)
  if (!produtoId && servico.length < 2) return { ok: false, erro: 'Qual é o serviço? Escolha no catálogo ou escreva.' }
  const inicio = deSP(d.dia, d.hora)
  if (!inicio) return { ok: false, erro: 'Escolha um dia e uma hora que existam.' }
  if (d.duracaoMin != null && duracaoValida(d.duracaoMin, null) === null) {
    return { ok: false, erro: 'A duração vai de 5 minutos a 12 horas.' }
  }
  return {
    ok: true,
    limpo: {
      unidadeId,
      colaboradorId,
      clienteId,
      clienteNome,
      telefone: telefone || null,
      produtoId,
      servico,
      inicio,
      duracaoMin: d.duracaoMin ?? null,
      observacao: limpar(d.observacao, 500) || null,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// BANCO — leitura
// ─────────────────────────────────────────────────────────────

export type HorarioNaAgenda = {
  id: string
  unidadeId: string
  unidadeNome: string
  colaboradorId: string
  colaboradorNome: string
  clienteId: string | null
  clienteNome: string
  telefone: string | null
  produtoId: string | null
  servico: string
  inicio: Date
  fim: Date
  situacao: SituacaoAgendamento
  observacao: string | null
  motivo: string | null
  vendaId: string | null
  lembrete: string | null
  quem: string
}

const SELECT = {
  id: true, unidadeId: true, colaboradorId: true, clienteId: true, clienteNome: true, telefone: true,
  produtoId: true, servico: true, inicio: true, fim: true, situacao: true, observacao: true, motivo: true,
  vendaId: true, lembrete: true, quem: true,
  unidade: { select: { nome: true } },
  colaborador: { select: { nome: true } },
} as const

type Linha = {
  id: string; unidadeId: string; colaboradorId: string; clienteId: string | null; clienteNome: string
  telefone: string | null; produtoId: string | null; servico: string; inicio: Date; fim: Date
  situacao: SituacaoAgendamento; observacao: string | null; motivo: string | null; vendaId: string | null
  lembrete: string | null; quem: string; unidade: { nome: string }; colaborador: { nome: string }
}

const naAgenda = (a: Linha): HorarioNaAgenda => ({
  id: a.id,
  unidadeId: a.unidadeId,
  unidadeNome: a.unidade.nome,
  colaboradorId: a.colaboradorId,
  colaboradorNome: a.colaborador.nome,
  clienteId: a.clienteId,
  clienteNome: a.clienteNome,
  telefone: a.telefone,
  produtoId: a.produtoId,
  servico: a.servico,
  inicio: a.inicio,
  fim: a.fim,
  situacao: a.situacao,
  observacao: a.observacao,
  motivo: a.motivo,
  vendaId: a.vendaId,
  lembrete: a.lembrete,
  quem: a.quem,
})

/** Das lojas pedidas, só as que a pessoa alcança. Endereço colado não abre porta. */
function lojasDaAgenda(sessao: Sessao, unidadeIds: string[], cap: 'agenda.ver' | 'agenda.marcar' = 'agenda.ver') {
  const p = unidadesQuePodem(sessao, cap)
  return p === 'todas' ? unidadeIds : unidadeIds.filter((u) => p.includes(u))
}

export type FiltroAgenda = {
  unidadeIds: string[]
  de: Date
  /** Exclusivo. */
  ate: Date
  colaboradorId?: string | null
  clienteId?: string | null
  /** Com desmarcados e faltas. Padrão: sim — a agenda mostra a história do dia. */
  todos?: boolean
}

export async function listarAgenda(sessao: Sessao, f: FiltroAgenda): Promise<HorarioNaAgenda[]> {
  exigir(sessao, 'agenda.ver')
  const lojas = lojasDaAgenda(sessao, f.unidadeIds)
  if (lojas.length === 0) return []
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.agendamento.findMany({
      where: {
        unidadeId: { in: lojas },
        inicio: { gte: f.de, lt: f.ate },
        ...(f.colaboradorId ? { colaboradorId: f.colaboradorId } : {}),
        ...(f.clienteId ? { clienteId: f.clienteId } : {}),
        ...(f.todos === false ? { situacao: { in: [...OCUPAM] } } : {}),
      },
      orderBy: [{ inicio: 'asc' }, { colaboradorId: 'asc' }],
      take: 2000,
      select: SELECT,
    }),
  )
  return linhas.map(naAgenda)
}

/** Um horário, para remarcar. Nulo se não existe ou é de loja que a pessoa não vê. */
export async function acharHorario(sessao: Sessao, id: string): Promise<HorarioNaAgenda | null> {
  exigir(sessao, 'agenda.ver')
  const a = await comoOrg(sessao.orgId, (db) => db.agendamento.findUnique({ where: { id }, select: SELECT }))
  if (!a || !pode(sessao, 'agenda.ver', a.unidadeId)) return null
  return naAgenda(a)
}

export type Profissional = { id: string; nome: string; cargo: string | null }

/** Quem atende nesta loja: as colunas da agenda. Quem circula entre as lojas entra em todas. */
export async function profissionaisDaLoja(sessao: Sessao, unidadeId: string): Promise<Profissional[]> {
  exigir(sessao, 'agenda.ver', unidadeId)
  return comoOrg(sessao.orgId, (db) =>
    db.colaborador.findMany({
      where: { ativo: true, atende: true, OR: [{ unidadeId: null }, { unidadeId }] },
      orderBy: { nome: 'asc' },
      take: 60,
      select: { id: true, nome: true, cargo: true },
    }),
  )
}

export type ServicoDaLoja = { id: string; nome: string; duracaoMin: number | null; preco: number }

/** Os serviços do catálogo vendidos nesta loja, para escolher ao marcar. */
export async function servicosDaLoja(sessao: Sessao, unidadeId: string): Promise<ServicoDaLoja[]> {
  exigir(sessao, 'agenda.ver', unidadeId)
  const ps = await comoOrg(sessao.orgId, (db) =>
    db.produto.findMany({
      where: { ativo: true, servico: true, OR: [{ vendidoEm: { isEmpty: true } }, { vendidoEm: { has: unidadeId } }] },
      orderBy: { nome: 'asc' },
      take: 200,
      select: { id: true, nome: true, duracaoMin: true, precoVista: true },
    }),
  )
  return ps.map((p) => ({ id: p.id, nome: p.nome, duracaoMin: p.duracaoMin, preco: reais(centavos(p.precoVista ?? 0)) }))
}

/** O horário de funcionamento da loja, já lido. Nulo quando não há ou não se entende. */
export async function horarioDaLoja(sessao: Sessao, unidadeId: string): Promise<{ texto: string | null; horario: Horario | null }> {
  const u = await comoOrg(sessao.orgId, (db) => db.unidade.findUnique({ where: { id: unidadeId }, select: { horario: true } }))
  return { texto: u?.horario ?? null, horario: lerHorario(u?.horario) }
}

/**
 * Clientes do cadastro para escolher ao marcar. Oito no máximo: a lista é
 * para achar quem a recepção já está digitando, não para navegar.
 */
export async function buscarClientesParaAgenda(sessao: Sessao, termo: string) {
  exigir(sessao, 'agenda.marcar')
  exigir(sessao, 'cliente.ver')
  const t = termo.trim().slice(0, 80)
  if (t.length < 2) return []
  const digitos = soDigitos(t)
  return comoOrg(sessao.orgId, (db) =>
    db.cliente.findMany({
      where: {
        ativo: true,
        anonimizadoEm: null,
        OR: [{ nome: { contains: t, mode: 'insensitive' } }, ...(digitos.length >= 3 ? [{ telefone: { contains: digitos } }] : [])],
      },
      orderBy: { nome: 'asc' },
      take: 8,
      select: { id: true, nome: true, telefone: true },
    }),
  )
}

// ─────────────────────────────────────────────────────────────
// BANCO — marcar, remarcar, mudar
// ─────────────────────────────────────────────────────────────

export type ResultadoHorario =
  | { ok: true; id: string; inicio: Date; fim: Date }
  | { ok: false; erro: string; pedeConfirmacao?: boolean; ocupado?: boolean }

/** O erro do gatilho do banco (`agenda_sem_choque`), como chega pelo Prisma. */
export function ehHorarioOcupado(e: unknown): boolean {
  const x = e as { code?: unknown; message?: unknown; meta?: unknown } | null
  if (!x) return false
  const texto = `${String(x.message ?? '')} ${JSON.stringify(x.meta ?? '')}`
  return x.code === '23P01' || texto.includes('agendamentos_sem_choque') || texto.includes('horário ocupado')
}

const trava = (db: BancoDaOrg, colaboradorId: string) =>
  db.$executeRaw`select pg_advisory_xact_lock(hashtext(${'agenda:' + colaboradorId}))`

/**
 * Confere tudo o que depende do banco e grava — dentro da transação e da
 * trava da profissional. `id` = remarcar este horário.
 */
async function gravarHorario(
  db: BancoDaOrg,
  sessao: Sessao,
  e: HorarioLimpo,
  confirmar: boolean,
  agora: Date,
  id?: string,
): Promise<ResultadoHorario> {
  const loja = await db.unidade.findFirst({ where: { id: e.unidadeId, ativa: true }, select: { id: true, horario: true } })
  if (!loja) return { ok: false, erro: 'Essa loja não existe ou está fechada.' }

  const c = await db.colaborador.findUnique({
    where: { id: e.colaboradorId },
    select: { id: true, nome: true, ativo: true, atende: true, unidadeId: true },
  })
  if (!c || !c.ativo || !c.atende) return { ok: false, erro: 'Essa profissional não atende com horário marcado.' }
  if (c.unidadeId && c.unidadeId !== e.unidadeId) return { ok: false, erro: `${c.nome} não atende nesta loja.` }

  let servico = e.servico
  let duracaoServico: number | null = null
  if (e.produtoId) {
    const p = await db.produto.findUnique({
      where: { id: e.produtoId },
      select: { nome: true, ativo: true, servico: true, duracaoMin: true, vendidoEm: true },
    })
    if (!p || !p.ativo) return { ok: false, erro: 'Esse serviço não está mais no catálogo.' }
    if (!vendidoNaLoja(p.vendidoEm, e.unidadeId)) return { ok: false, erro: `${p.nome} não é oferecido nesta loja.` }
    servico = servico || p.nome
    duracaoServico = p.duracaoMin
  }
  const duracao = duracaoValida(e.duracaoMin, duracaoServico)
  if (duracao === null) return { ok: false, erro: 'A duração vai de 5 minutos a 12 horas.' }
  const fim = new Date(e.inicio.getTime() + duracao * 60_000)

  if (!confirmar) {
    if (e.inicio.getTime() < agora.getTime() - 5 * 60_000) {
      return {
        ok: false,
        pedeConfirmacao: true,
        erro: 'Esse horário já passou. Se é isso mesmo (um atendimento anotado depois), marque "é isso mesmo" e salve de novo.',
      }
    }
    const h = lerHorario(loja.horario)
    if (!dentroDoHorario(h, { inicio: e.inicio, fim })) {
      return {
        ok: false,
        pedeConfirmacao: true,
        erro: `Esse horário fica fora do funcionamento da loja (${loja.horario}). Se foi combinado assim, marque "é isso mesmo" e salve de novo.`,
      }
    }
  }

  let nome = e.clienteNome
  let telefone = e.telefone
  if (e.clienteId) {
    const cli = await db.cliente.findUnique({ where: { id: e.clienteId }, select: { nome: true, telefone: true, anonimizadoEm: true } })
    if (!cli || cli.anonimizadoEm) return { ok: false, erro: 'Esse cadastro não foi encontrado.' }
    nome = cli.nome
    telefone = telefone ?? (cli.telefone ? soDigitos(cli.telefone) || null : null)
  }

  // A trava da profissional, e só depois a conferência: quem chegou antes
  // grava, quem chegou depois vê o horário ocupado.
  await trava(db, c.id)
  const choque = await db.agendamento.findFirst({
    where: {
      colaboradorId: c.id,
      situacao: { in: [...OCUPAM] },
      inicio: { lt: fim },
      fim: { gt: e.inicio },
      ...(id ? { id: { not: id } } : {}),
    },
    select: { clienteNome: true, inicio: true, fim: true },
  })
  if (choque) {
    return {
      ok: false,
      ocupado: true,
      erro: `${c.nome} já tem ${choque.clienteNome} das ${horaEmSP(choque.inicio)} às ${horaEmSP(choque.fim)}. Escolha outro horário ou outra profissional.`,
    }
  }

  const dados = {
    unidadeId: e.unidadeId,
    colaboradorId: c.id,
    clienteId: e.clienteId,
    clienteNome: nome,
    telefone,
    produtoId: e.produtoId,
    servico,
    inicio: e.inicio,
    fim,
    observacao: e.observacao,
  }

  if (id) {
    const antes = await db.agendamento.findUnique({ where: { id }, select: { inicio: true, colaboradorId: true, situacao: true } })
    if (!antes) return { ok: false, erro: 'Esse horário não existe mais.' }
    const r = await db.agendamento.updateMany({
      where: { id, situacao: antes.situacao },
      // Remarcou: o lembrete volta a valer para o horário novo.
      data: { ...dados, ...(antes.inicio.getTime() !== e.inicio.getTime() ? { lembreteEm: null, lembrete: null } : {}) },
    })
    if (r.count === 0) return { ok: false, erro: 'Alguém mudou este horário agora. Recarregue a tela.' }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: e.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'agenda.remarcou', alvoTipo: 'agendamento', alvoId: id, alvoNome: `${nome}: ${servico}`.slice(0, 200),
        antes: { inicio: antes.inicio.toISOString(), colaboradorId: antes.colaboradorId },
        depois: { inicio: e.inicio.toISOString(), colaboradorId: c.id, duracao },
      },
    })
    return { ok: true, id, inicio: e.inicio, fim }
  }

  const novo = await db.agendamento.create({
    data: { orgId: sessao.orgId, ...dados, quem: sessao.nome, quemId: sessao.usuarioId },
    select: { id: true },
  })
  await db.auditoria.create({
    data: {
      orgId: sessao.orgId, unidadeId: e.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
      acao: 'agenda.marcou', alvoTipo: 'agendamento', alvoId: novo.id, alvoNome: `${nome}: ${servico}`.slice(0, 200),
      depois: { inicio: e.inicio.toISOString(), colaborador: c.nome, duracao },
    },
  })
  return { ok: true, id: novo.id, inicio: e.inicio, fim }
}

/** Marca um horário novo. */
export async function marcarHorario(sessao: Sessao, d: DadosHorario, agora = new Date()): Promise<ResultadoHorario> {
  const v = validarHorario(d)
  if (!v.ok) return v
  exigir(sessao, 'agenda.marcar', v.limpo.unidadeId)
  try {
    return await comoOrg(sessao.orgId, (db) => gravarHorario(db, sessao, v.limpo, !!d.confirmar, agora))
  } catch (e) {
    // O gatilho do banco pegou o que a conferência não pegou (quem gravou
    // por fora da trava): mesma resposta, a de gente.
    if (ehHorarioOcupado(e)) return { ok: false, ocupado: true, erro: 'Esse horário acabou de ser ocupado. Escolha outro.' }
    throw e
  }
}

/** Muda dia, hora, profissional ou serviço de um horário que ainda está de pé. */
export async function remarcarHorario(sessao: Sessao, id: string, d: DadosHorario, agora = new Date()): Promise<ResultadoHorario> {
  exigir(sessao, 'agenda.marcar')
  const atual = await comoOrg(sessao.orgId, (db) =>
    db.agendamento.findUnique({ where: { id }, select: { unidadeId: true, situacao: true } }),
  )
  if (!atual) return { ok: false, erro: 'Esse horário não existe mais.' }
  if (!pode(sessao, 'agenda.marcar', atual.unidadeId)) throw new SemPermissao('agenda.marcar', atual.unidadeId)
  if (ehFinalAgenda(atual.situacao)) {
    return { ok: false, erro: `Este horário já está ${ROTULO_AGENDA[atual.situacao].toLowerCase()} e não muda mais. Marque um novo.` }
  }
  // A loja não muda na remarcação: é outro horário, em outra casa.
  const v = validarHorario({ ...d, unidadeId: atual.unidadeId })
  if (!v.ok) return v
  try {
    return await comoOrg(sessao.orgId, (db) => gravarHorario(db, sessao, v.limpo, !!d.confirmar, agora, id))
  } catch (e) {
    if (ehHorarioOcupado(e)) return { ok: false, ocupado: true, erro: 'Esse horário acabou de ser ocupado. Escolha outro.' }
    throw e
  }
}

export type MudancaAgenda =
  | { para: 'CONFIRMADO' | 'MARCADO' | 'ATENDIDO' | 'FALTOU' }
  | { para: 'CANCELADO'; motivo: string }

const ACAO: Record<SituacaoAgendamento, string> = {
  MARCADO: 'agenda.voltou',
  CONFIRMADO: 'agenda.confirmou',
  ATENDIDO: 'agenda.atendeu',
  FALTOU: 'agenda.faltou',
  CANCELADO: 'agenda.desmarcou',
}

/** Anda o horário um passo: confirmado, atendido, faltou, desmarcado (com motivo). */
export async function mudarSituacaoAgenda(
  sessao: Sessao,
  id: string,
  m: MudancaAgenda,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'agenda.marcar')
  const motivo = m.para === 'CANCELADO' ? limpar(m.motivo, 300) : ''
  if (m.para === 'CANCELADO' && motivo.length < 3) return { ok: false, erro: 'Escreva por que o horário foi desmarcado.' }

  return comoOrg(sessao.orgId, async (db) => {
    const a = await db.agendamento.findUnique({
      where: { id },
      select: { unidadeId: true, situacao: true, clienteNome: true, servico: true, inicio: true },
    })
    if (!a) return { ok: false as const, erro: 'Esse horário não existe mais.' }
    if (!pode(sessao, 'agenda.marcar', a.unidadeId)) throw new SemPermissao('agenda.marcar', a.unidadeId)
    if (!transicaoAgenda(a.situacao, m.para)) {
      return {
        ok: false as const,
        erro: ehFinalAgenda(a.situacao)
          ? `Este horário já está ${ROTULO_AGENDA[a.situacao].toLowerCase()}.`
          : 'Essa mudança não é possível.',
      }
    }
    const r = await db.agendamento.updateMany({
      where: { id, situacao: a.situacao },
      data: { situacao: m.para, ...(m.para === 'CANCELADO' ? { motivo } : {}) },
    })
    if (r.count === 0) return { ok: false as const, erro: 'Alguém mudou este horário agora. Recarregue a tela.' }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: a.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: ACAO[m.para], alvoTipo: 'agendamento', alvoId: id,
        alvoNome: `${a.clienteNome}: ${a.servico}`.slice(0, 200),
        antes: { situacao: a.situacao }, depois: { situacao: m.para, inicio: a.inicio.toISOString() },
        motivo: motivo || null,
      },
    })
    return { ok: true as const }
  })
}

/**
 * O que o balcão precisa para "Atender e cobrar": o cliente e o serviço do
 * catálogo (a variação padrão dele). Nulo se o horário não pode ser cobrado —
 * já foi, foi desmarcado, ou é de loja que a pessoa não vende.
 */
export async function horarioParaCobrar(sessao: Sessao, id: string) {
  const a = await comoOrg(sessao.orgId, (db) =>
    db.agendamento.findUnique({
      where: { id },
      select: {
        id: true, unidadeId: true, situacao: true, vendaId: true, clienteId: true, clienteNome: true, servico: true, inicio: true,
        colaborador: { select: { nome: true } },
        produto: {
          select: {
            id: true, ativo: true,
            variacoes: { where: { ativa: true }, orderBy: [{ padrao: 'desc' }, { codigo: 'asc' }], take: 1, select: { id: true } },
          },
        },
      },
    }),
  )
  if (!a || a.vendaId || !ocupa(a.situacao)) return null
  if (!pode(sessao, 'venda.criar', a.unidadeId)) return null
  return {
    id: a.id,
    unidadeId: a.unidadeId,
    clienteId: a.clienteId,
    clienteNome: a.clienteNome,
    servico: a.servico,
    rotulo: `${a.clienteNome} — ${a.servico} com ${a.colaborador.nome}, ${diaCurtoSP(a.inicio)} às ${horaEmSP(a.inicio)}`,
    variacaoId: a.produto?.ativo ? (a.produto.variacoes[0]?.id ?? null) : null,
  }
}

// ─────────────────────────────────────────────────────────────
// O DIA — para o painel, a rotina da manhã e o assistente
// ─────────────────────────────────────────────────────────────

export type ResumoDoDia = {
  total: number
  confirmados: number
  atendidos: number
  faltas: number
  desmarcados: number
  /** Os próximos que ainda vão acontecer hoje, do mais cedo ao mais tarde. */
  proximos: HorarioNaAgenda[]
  /** Por profissional: os horários livres que ainda restam hoje (até 6). */
  livres: { colaboradorId: string; nome: string; horarios: Date[] }[]
}

/** A conta do dia, sem banco — o painel e a rotina da manhã dizem a mesma coisa. */
export function resumirDia(
  lista: HorarioNaAgenda[],
  profissionais: Profissional[],
  horario: Horario | null,
  dia: string,
  agora: Date,
  duracaoPadrao = 30,
): ResumoDoDia {
  const doDia = lista.filter((a) => diaEmSP(a.inicio) === dia)
  const vivos = doDia.filter((a) => ocupa(a.situacao))
  return {
    total: vivos.length,
    confirmados: doDia.filter((a) => a.situacao === 'CONFIRMADO').length,
    atendidos: doDia.filter((a) => a.situacao === 'ATENDIDO').length,
    faltas: doDia.filter((a) => a.situacao === 'FALTOU').length,
    desmarcados: doDia.filter((a) => a.situacao === 'CANCELADO').length,
    proximos: vivos.filter((a) => a.situacao !== 'ATENDIDO' && a.fim > agora).sort((a, b) => a.inicio.getTime() - b.inicio.getTime()),
    livres: profissionais.map((p) => ({
      colaboradorId: p.id,
      nome: p.nome,
      horarios: horariosLivres(
        { horario, dia, ocupados: vivos.filter((a) => a.colaboradorId === p.id), duracaoMin: duracaoPadrao },
        agora,
      ).slice(0, 6),
    })),
  }
}

/** O dia de uma loja, pronto: a agenda, quem atende e os livres. */
export async function agendaDoDia(sessao: Sessao, unidadeId: string, dia: string, agora = new Date()): Promise<ResumoDoDia> {
  const lista = await listarAgenda(sessao, {
    unidadeIds: [unidadeId],
    de: inicioDoDiaEmSP(dia),
    ate: inicioDoDiaEmSP(somarDias(dia, 1)),
  })
  const profs = await profissionaisDaLoja(sessao, unidadeId)
  const { horario } = await horarioDaLoja(sessao, unidadeId)
  return resumirDia(lista, profs, horario, dia, agora)
}

export { diaCurtoSP, diaEmSP, horaEmSP, somarDias }
