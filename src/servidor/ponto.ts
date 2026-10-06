// Funcionários e ponto: quem trabalha aqui, e quando entrou e saiu.
//
// ── o colaborador não é o usuário ────────────────────────────
// Usuário é quem ENTRA no sistema. Colaborador é quem TRABALHA — e a manicure
// que nunca vai abrir o Norte existe do mesmo jeito: tem agenda, bate ponto e
// entra na folha do mês. Quando a pessoa tem conta, as duas fichas se ligam e
// ela bate o próprio ponto; sem conta, quem bate é o gestor, e a batida diz
// isso (`origem`).
//
// A ficha existe mesmo com o módulo de ponto DESLIGADO: é a lista de
// profissionais da Agenda. Desligar o ponto some com as horas, não com as
// pessoas (ver modulos.ts).
//
// ── controle interno, e a tela diz ───────────────────────────
// Isto não é um REP certificado (Portaria MTP 671/2021): não emite
// comprovante assinado nem arquivo para fiscalização. É o caderno de ponto da
// empresa, com uma coisa que o caderno não tem: nada se apaga. Batida errada
// se anula com motivo; a que faltou entra como AJUSTE, com motivo; e o banco
// recusa DELETE e qualquer reescrita (prisma/sql/rls.sql).
//
// ── a conta do mês ───────────────────────────────────────────
// A batida é um instante; a folha é uma lista de TURNOS (entrada → saída). O
// turno que passa da meia-noite é do dia em que COMEÇOU: a recepcionista que
// entra às 22h e sai às 6h trabalhou oito horas na terça, não duas na terça e
// seis na quarta — é assim que a escala dela foi combinada. Entrada sem saída
// fica pendente (e aparece), nunca vira horas inventadas.
//
// Puro em cima (turnos, folha), banco embaixo.

import type { OrigemPonto, TipoPonto } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, SemPermissao, unidadesQuePodem, type Capacidade, type Sessao } from './permissao'
import { colunaDoDia, diaDaColuna, diaEmSP, inicioDoDiaEmSP, somarDias } from './dia'
import { deSP, horaEmSP } from './encomenda'
import { soDigitos } from './cliente'

export type { OrigemPonto, TipoPonto }

// ─────────────────────────────────────────────────────────────
// A CONTA (puro)
// ─────────────────────────────────────────────────────────────

/**
 * Depois disto, entrada sem saída deixa de ser "trabalhando agora" e passa a
 * ser "esqueceu de bater a saída". Dezesseis horas cobre o plantão mais longo
 * de uma clínica pequena sem aceitar como turno a entrada de anteontem.
 */
export const TURNO_MAXIMO_HORAS = 16

export type Batida = { id: string; tipo: TipoPonto; em: Date }

export type Turno = {
  entrada: Date | null
  saida: Date | null
  /** Só do turno fechado. Aberto e pendente não viram horas. */
  minutos: number
  /** O dia do turno: o da ENTRADA (ou o da saída, na saída sem entrada). */
  dia: string
  situacao: 'fechado' | 'aberto' | 'sem_saida' | 'sem_entrada'
}

/**
 * As batidas (já sem as anuladas) viram turnos, na ordem do relógio.
 *
 *   entrada → saída               fechado
 *   entrada → entrada             a primeira fica "sem saída"
 *   saída sem entrada antes       "sem entrada"
 *   entrada no fim, recente       "aberto" (trabalhando agora)
 *   entrada no fim, antiga        "sem saída"
 *
 * Turno fechado mais longo que TURNO_MAXIMO_HORAS também é suspeito — mas é o
 * que foi batido: entra nas horas, e a folha deixa ver.
 */
export function montarTurnos(batidas: Batida[], agora: Date): Turno[] {
  const ordem = [...batidas].sort((a, b) => a.em.getTime() - b.em.getTime() || (a.tipo === 'ENTRADA' ? -1 : 1))
  const turnos: Turno[] = []
  let aberta: Date | null = null
  for (const b of ordem) {
    if (b.tipo === 'ENTRADA') {
      if (aberta) turnos.push({ entrada: aberta, saida: null, minutos: 0, dia: diaEmSP(aberta), situacao: 'sem_saida' })
      aberta = b.em
      continue
    }
    if (!aberta) {
      turnos.push({ entrada: null, saida: b.em, minutos: 0, dia: diaEmSP(b.em), situacao: 'sem_entrada' })
      continue
    }
    turnos.push({
      entrada: aberta,
      saida: b.em,
      minutos: Math.max(0, Math.round((b.em.getTime() - aberta.getTime()) / 60_000)),
      dia: diaEmSP(aberta),
      situacao: 'fechado',
    })
    aberta = null
  }
  if (aberta) {
    const recente = agora.getTime() - aberta.getTime() < TURNO_MAXIMO_HORAS * 3_600_000 && aberta <= agora
    turnos.push({ entrada: aberta, saida: null, minutos: 0, dia: diaEmSP(aberta), situacao: recente ? 'aberto' : 'sem_saida' })
  }
  return turnos
}

/** O que a pessoa deveria bater agora: saída se está com turno aberto, senão entrada. */
export function proximaBatida(batidas: Batida[], agora: Date): TipoPonto {
  const t = montarTurnos(batidas, agora)
  return t.at(-1)?.situacao === 'aberto' ? 'SAIDA' : 'ENTRADA'
}

export type DiaDaFolha = {
  dia: string
  /** Minutos combinados neste dia da semana (0 = sem jornada). */
  previsto: number
  trabalhado: number
  /** O que passou do combinado neste dia. Sem jornada, zero — não há régua. */
  extra: number
  /** Tinha jornada, o dia já acabou, e não houve batida nenhuma. */
  falta: boolean
  /** Turno sem saída ou saída sem entrada: alguém precisa ajustar. */
  pendente: boolean
  /** Dia abonado (folga, atestado, feriado): o motivo. A jornada do dia vira zero. */
  abono: string | null
  turnos: Turno[]
}

export type Folha = {
  mes: string
  dias: DiaDaFolha[]
  totais: {
    trabalhado: number
    /** Combinado nos dias do mês que já chegaram (até hoje, inclusive). */
    previsto: number
    /** Combinado no mês inteiro. */
    previstoMes: number
    extras: number
    faltas: number
    pendencias: number
    /** trabalhado − previsto: positivo, sobra; negativo, deve horas. */
    diferenca: number
  }
  /** Está trabalhando agora (turno aberto). */
  aberto: Turno | null
}

/** Os dias de um mês 'AAAA-MM', em texto. */
export function diasDoMes(mes: string): string[] {
  const primeiro = `${mes}-01`
  const out: string[] = []
  for (let d = primeiro; d.slice(0, 7) === mes; d = somarDias(d, 1)) out.push(d)
  return out
}

const semanaDe = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay()

/**
 * A folha do mês de uma pessoa.
 *
 * `batidas` pode (e deve) vir com um dia de folga de cada lado do mês: o
 * turno que começou no último dia do mês anterior e acabou no dia 1º é do mês
 * anterior, e só dá para saber isso vendo a entrada dele.
 *
 * `jornadaMin` tem sete posições (domingo a sábado); vazia = sem jornada.
 *
 * `desde` é o primeiro dia de trabalho (ou o do cadastro): antes dele a pessoa
 * não trabalhava aqui, e o dia não tem jornada nem falta — a contratada no
 * dia 20 não chega com treze faltas.
 *
 * `abonos` são os dias que não contam (folga, atestado, feriado), com o motivo:
 * a jornada do dia vira zero, e o dia sem batida deixa de ser falta.
 */
export function folhaDoMes(
  batidas: Batida[],
  jornadaMin: readonly number[],
  mes: string,
  agora: Date,
  desde?: string,
  abonos?: ReadonlyMap<string, string>,
): Folha {
  const hoje = diaEmSP(agora)
  const turnos = montarTurnos(batidas, agora)
  const porDia = new Map<string, Turno[]>()
  for (const t of turnos) {
    const l = porDia.get(t.dia) ?? []
    l.push(t)
    porDia.set(t.dia, l)
  }
  const temJornada = jornadaMin.some((m) => m > 0)
  const dias: DiaDaFolha[] = []
  const totais = { trabalhado: 0, previsto: 0, previstoMes: 0, extras: 0, faltas: 0, pendencias: 0, diferenca: 0 }
  for (const dia of diasDoMes(mes)) {
    const abono = abonos?.get(dia) ?? null
    const previsto = temJornada && !abono && (!desde || dia >= desde) ? Math.max(0, jornadaMin[semanaDe(dia)] ?? 0) : 0
    totais.previstoMes += previsto
    if (dia > hoje) continue
    const ts = porDia.get(dia) ?? []
    const trabalhado = ts.reduce((s, t) => s + t.minutos, 0)
    const pendente = ts.some((t) => t.situacao === 'sem_saida' || t.situacao === 'sem_entrada')
    const falta = previsto > 0 && dia < hoje && ts.length === 0
    const extra = previsto > 0 ? Math.max(0, trabalhado - previsto) : 0
    totais.trabalhado += trabalhado
    totais.previsto += previsto
    totais.extras += extra
    if (falta) totais.faltas++
    if (pendente) totais.pendencias++
    dias.push({ dia, previsto, trabalhado, extra, falta, pendente, abono, turnos: ts })
  }
  totais.diferenca = totais.trabalhado - totais.previsto
  const ultimo = turnos.at(-1)
  return { mes, dias, totais, aberto: ultimo?.situacao === 'aberto' ? ultimo : null }
}

/** "7h30", "45 min", "0h" — minutos em horas de relógio, do jeito da folha. */
export function horas(minutos: number): string {
  const m = Math.round(Math.abs(minutos))
  const sinal = minutos < 0 ? '−' : ''
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0 && r > 0) return `${sinal}${r} min`
  return `${sinal}${h}h${r > 0 ? String(r).padStart(2, '0') : ''}`
}

/**
 * A jornada que veio da tela: sete campos em horas ("8", "4,5", "") → minutos.
 * Vazio ou zero é folga. Mais de 16 horas num dia não é jornada, é erro.
 */
export function lerJornada(campos: readonly string[]): { ok: true; jornada: number[] } | { ok: false; erro: string } {
  if (campos.length !== 7) return { ok: false, erro: 'A jornada tem sete dias.' }
  const jornada: number[] = []
  for (const bruto of campos) {
    const t = bruto.trim().replace(',', '.')
    if (!t) {
      jornada.push(0)
      continue
    }
    const h = Number(t)
    if (!Number.isFinite(h) || h < 0 || h > 16) return { ok: false, erro: 'Cada dia da jornada vai de 0 a 16 horas.' }
    jornada.push(Math.round(h * 60))
  }
  return { ok: true, jornada: jornada.every((m) => m === 0) ? [] : jornada }
}

/** O mês de 'AAAA-MM' que veio do endereço, ou o mês de hoje. */
export function mesValido(v: unknown, agora: Date): string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : diaEmSP(agora).slice(0, 7)
}

// ─────────────────────────────────────────────────────────────
// QUEM PODE, POR COLABORADOR
// ─────────────────────────────────────────────────────────────

/**
 * Pode isto com ESTA pessoa?
 *
 * O colaborador de uma loja é da loja: o gerente dela pode. O que circula
 * entre as lojas (`unidadeId` nulo) é da empresa inteira, e só quem responde
 * por todas pode — é a mesma régua de `podeConcederAcesso`, pelo mesmo motivo:
 * "sem loja" não pode virar "em alguma loja".
 */
export function podeNoColaborador(
  sessao: Sessao,
  capacidade: Capacidade,
  c: { unidadeId: string | null },
): boolean {
  if (c.unidadeId) return pode(sessao, capacidade, c.unidadeId)
  return unidadesQuePodem(sessao, capacidade) === 'todas'
}

// ─────────────────────────────────────────────────────────────
// OS COLABORADORES
// ─────────────────────────────────────────────────────────────

export type ColaboradorNaLista = {
  id: string
  nome: string
  cargo: string | null
  /** Só para quem vê a equipe. */
  telefone: string | null
  unidadeId: string | null
  unidadeNome: string | null
  usuarioId: string | null
  usuarioNome: string | null
  atende: boolean
  jornadaMin: number[]
  ativo: boolean
}

/**
 * Quem trabalha nas lojas pedidas (e quem circula entre elas).
 *
 * Abre para quem tem QUALQUER uma destas: ver a equipe, ver a agenda, bater o
 * próprio ponto, ver as horas (o contador) — é a lista de pessoas da casa, a mesma que a agenda mostra
 * em colunas. O telefone só vai para quem vê a equipe.
 */
export async function listarColaboradores(
  sessao: Sessao,
  f: { unidadeIds: string[]; inativos?: boolean; soQuemAtende?: boolean },
): Promise<ColaboradorNaLista[]> {
  if (!pode(sessao, 'equipe.ver') && !pode(sessao, 'agenda.ver') && !pode(sessao, 'ponto.proprio') && !pode(sessao, 'ponto.ver')) {
    throw new SemPermissao('equipe.ver')
  }
  const verTelefone = pode(sessao, 'equipe.ver')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.colaborador.findMany({
      where: {
        ...(f.inativos ? {} : { ativo: true }),
        ...(f.soQuemAtende ? { atende: true } : {}),
        OR: [{ unidadeId: null }, { unidadeId: { in: f.unidadeIds } }],
      },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      take: 300,
      select: {
        id: true, nome: true, cargo: true, telefone: true, unidadeId: true, usuarioId: true, atende: true,
        jornadaMin: true, ativo: true,
        unidade: { select: { nome: true } },
        usuario: { select: { nome: true } },
      },
    }),
  )
  return linhas.map((c) => ({
    id: c.id,
    nome: c.nome,
    cargo: c.cargo,
    telefone: verTelefone ? c.telefone : null,
    unidadeId: c.unidadeId,
    unidadeNome: c.unidade?.nome ?? null,
    usuarioId: c.usuarioId,
    usuarioNome: c.usuario?.nome ?? null,
    atende: c.atende,
    jornadaMin: c.jornadaMin,
    ativo: c.ativo,
  }))
}

/** A ficha ligada à conta de quem está na tela, se houver. */
export async function meuColaborador(sessao: Sessao) {
  return comoOrg(sessao.orgId, (db) =>
    db.colaborador.findUnique({
      where: { usuarioId: sessao.usuarioId },
      select: { id: true, nome: true, unidadeId: true, ativo: true, jornadaMin: true },
    }),
  )
}

export type DadosColaborador = {
  nome: string
  cargo?: string | null
  telefone?: string | null
  unidadeId?: string | null
  usuarioId?: string | null
  atende: boolean
  jornadaMin: number[]
  ativo?: boolean
}

const limpar = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export type ResultadoColaborador = { ok: true; id: string } | { ok: false; erro: string }

/**
 * Cadastra ou muda a ficha de quem trabalha.
 *
 * Pede `equipe.gerir` NA LOJA da pessoa — antes e depois, quando a loja muda:
 * o gerente da loja 3 não transfere a manicure da loja 5 para a dele.
 */
export async function salvarColaborador(
  sessao: Sessao,
  d: DadosColaborador,
  id?: string,
): Promise<ResultadoColaborador> {
  exigir(sessao, 'equipe.gerir')
  const nome = limpar(d.nome, 80)
  if (nome.length < 2) return { ok: false, erro: 'Escreva o nome de quem trabalha.' }
  const telefone = soDigitos(typeof d.telefone === 'string' ? d.telefone : '')
  if (telefone && (telefone.length < 10 || telefone.length > 11)) {
    return { ok: false, erro: 'O telefone precisa do DDD: 10 ou 11 números.' }
  }
  if (d.jornadaMin.length !== 0 && (d.jornadaMin.length !== 7 || d.jornadaMin.some((m) => !Number.isInteger(m) || m < 0 || m > 16 * 60))) {
    return { ok: false, erro: 'A jornada não confere.' }
  }
  const unidadeId = limpar(d.unidadeId, 64) || null
  const usuarioId = limpar(d.usuarioId, 64) || null
  if (!podeNoColaborador(sessao, 'equipe.gerir', { unidadeId })) {
    return { ok: false, erro: unidadeId ? 'Você não cuida da equipe desta loja.' : 'Só quem responde por todas as lojas cadastra quem circula entre elas.' }
  }

  return comoOrg(sessao.orgId, async (db) => {
    if (unidadeId) {
      const loja = await db.unidade.findFirst({ where: { id: unidadeId, ativa: true }, select: { id: true } })
      if (!loja) return { ok: false as const, erro: 'Essa loja não existe ou está fechada.' }
    }
    if (usuarioId) {
      const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { ativo: true, colaborador: { select: { id: true } } } })
      if (!u || !u.ativo) return { ok: false as const, erro: 'Essa conta não existe ou está desativada.' }
      if (u.colaborador && u.colaborador.id !== id) return { ok: false as const, erro: 'Essa conta já está ligada a outra ficha.' }
    }
    const dados = {
      nome,
      cargo: limpar(d.cargo, 60) || null,
      telefone: telefone || null,
      unidadeId,
      usuarioId,
      atende: !!d.atende,
      jornadaMin: d.jornadaMin,
      ...(d.ativo !== undefined ? { ativo: d.ativo } : {}),
    }
    let alvo: string
    if (id) {
      const antes = await db.colaborador.findUnique({ where: { id }, select: { unidadeId: true, nome: true, ativo: true } })
      if (!antes) return { ok: false as const, erro: 'Essa ficha não existe mais.' }
      if (!podeNoColaborador(sessao, 'equipe.gerir', antes)) throw new SemPermissao('equipe.gerir', antes.unidadeId ?? undefined)
      await db.colaborador.update({ where: { id }, data: dados })
      alvo = id
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId, unidadeId: unidadeId ?? antes.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
          acao: 'colaborador.alterou', alvoTipo: 'colaborador', alvoId: id, alvoNome: nome,
          antes: { nome: antes.nome, unidadeId: antes.unidadeId, ativo: antes.ativo },
          depois: { nome, unidadeId, ativo: d.ativo ?? antes.ativo, atende: !!d.atende },
        },
      })
    } else {
      const c = await db.colaborador.create({ data: { orgId: sessao.orgId, ...dados }, select: { id: true } })
      alvo = c.id
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId, unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
          acao: 'colaborador.criou', alvoTipo: 'colaborador', alvoId: c.id, alvoNome: nome,
          depois: { unidadeId, atende: !!d.atende, comConta: !!usuarioId },
        },
      })
    }
    return { ok: true as const, id: alvo }
  })
}

/** As contas da equipe que ainda não têm ficha — para ligar no cadastro. */
export async function contasSemFicha(sessao: Sessao, incluir?: string | null) {
  exigir(sessao, 'equipe.gerir')
  return comoOrg(sessao.orgId, (db) =>
    db.usuario.findMany({
      where: { ativo: true, OR: [{ colaborador: null }, ...(incluir ? [{ id: incluir }] : [])] },
      orderBy: { nome: 'asc' },
      take: 200,
      select: { id: true, nome: true },
    }),
  )
}

// ─────────────────────────────────────────────────────────────
// AS BATIDAS
// ─────────────────────────────────────────────────────────────

const SELECT_COLAB = { id: true, nome: true, unidadeId: true, usuarioId: true, ativo: true, jornadaMin: true, criadoEm: true, inicioEm: true } as const

/** O primeiro dia de trabalho: o escolhido na ficha, ou o do cadastro. */
const desdeDe = (c: { criadoEm: Date; inicioEm: Date | null }) => (c.inicioEm ? diaDaColuna(c.inicioEm) : diaEmSP(c.criadoEm))

/** Os dias abonados de várias pessoas entre dois dias ('AAAA-MM-DD'), por pessoa. */
async function abonosDe(db: BancoDaOrg, colaboradorIds: string[], de: string, ate: string) {
  const linhas = colaboradorIds.length
    ? await db.abonoPonto.findMany({
        where: { colaboradorId: { in: colaboradorIds }, dia: { gte: colunaDoDia(de), lte: colunaDoDia(ate) } },
        select: { colaboradorId: true, dia: true, motivo: true },
      })
    : []
  const por = new Map<string, Map<string, string>>()
  for (const l of linhas) {
    const m = por.get(l.colaboradorId) ?? new Map<string, string>()
    m.set(diaDaColuna(l.dia), l.motivo)
    por.set(l.colaboradorId, m)
  }
  return por
}

async function batidasDe(db: BancoDaOrg, colaboradorId: string, de: Date, ate: Date): Promise<(Batida & { origem: OrigemPonto; quem: string; motivo: string | null; anuladoEm: Date | null; motivoAnulacao: string | null; anuladoPor: string | null })[]> {
  const linhas = await db.registroPonto.findMany({
    where: { colaboradorId, em: { gte: de, lt: ate } },
    orderBy: { em: 'asc' },
    take: 2000,
    select: { id: true, tipo: true, em: true, origem: true, quem: true, motivo: true, anuladoEm: true, motivoAnulacao: true, anuladoPor: true },
  })
  return linhas
}

const validas = <T extends { anuladoEm: Date | null }>(l: T[]) => l.filter((b) => !b.anuladoEm)

export type ResultadoPonto = { ok: true; tipo: TipoPonto; em: Date } | { ok: false; erro: string }

/**
 * Bate o ponto — o próprio, ou o de alguém (o gestor, por quem não tem conta).
 *
 * `esperado` é o que a TELA mostrava ("Bater entrada"). Se não bate com o
 * estado de agora, a batida é recusada: o clique duplo, ou a outra aba que já
 * bateu, não vira uma entrada e uma saída no mesmo segundo.
 */
export async function baterPonto(
  sessao: Sessao,
  p: { colaboradorId: string; esperado: TipoPonto; unidadeId?: string | null },
  agora = new Date(),
): Promise<ResultadoPonto> {
  if (p.esperado !== 'ENTRADA' && p.esperado !== 'SAIDA') return { ok: false, erro: 'Batida inválida.' }
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.colaborador.findUnique({ where: { id: p.colaboradorId }, select: SELECT_COLAB })
    if (!c || !c.ativo) return { ok: false as const, erro: 'Essa pessoa não está mais na equipe.' }
    const propria = !!c.usuarioId && c.usuarioId === sessao.usuarioId
    if (propria) {
      if (!pode(sessao, 'ponto.proprio')) throw new SemPermissao('ponto.proprio')
    } else if (!podeNoColaborador(sessao, 'ponto.gerir', c)) {
      throw new SemPermissao('ponto.gerir', c.unidadeId ?? undefined)
    }
    // A mesma pessoa, em dois aparelhos ao mesmo tempo: um espera o outro.
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${'ponto:' + c.id}))`
    const recentes = validas(await batidasDe(db, c.id, new Date(agora.getTime() - 3 * 86_400_000), new Date(agora.getTime() + 60_000)))
    const devia = proximaBatida(recentes, agora)
    if (devia !== p.esperado) {
      const ultima = recentes.at(-1)
      return {
        ok: false as const,
        erro: ultima
          ? `A ${ultima.tipo === 'ENTRADA' ? 'entrada' : 'saída'} já foi batida às ${horaEmSP(ultima.em)}. Recarregue a tela.`
          : 'A tela estava desatualizada. Recarregue e bata de novo.',
      }
    }
    const unidadeId = limpar(p.unidadeId, 64) || c.unidadeId
    await db.registroPonto.create({
      data: {
        orgId: sessao.orgId,
        colaboradorId: c.id,
        unidadeId,
        tipo: p.esperado,
        em: agora,
        origem: propria ? 'PROPRIO' : 'GESTOR',
        quemId: sessao.usuarioId,
        quem: sessao.nome,
      },
    })
    // O gestor batendo por alguém é o que precisa ter nome no livro: a
    // própria pessoa batendo é a regra, e já fica na batida.
    if (!propria) {
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId, unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
          acao: 'ponto.bateu', alvoTipo: 'colaborador', alvoId: c.id, alvoNome: c.nome,
          depois: { tipo: p.esperado, em: agora.toISOString(), origem: 'GESTOR' },
        },
      })
    }
    return { ok: true as const, tipo: p.esperado, em: agora }
  })
}

/**
 * A batida que faltou, lançada depois — sempre com motivo.
 *
 * Não apaga nem muda nada: é uma linha nova, marcada AJUSTE, com quem lançou.
 * Data no futuro não entra (ajuste é do que já aconteceu).
 */
export async function ajustarPonto(
  sessao: Sessao,
  p: { colaboradorId: string; tipo: TipoPonto; dia: string; hora: string; motivo: string },
  agora = new Date(),
): Promise<ResultadoPonto> {
  exigir(sessao, 'ponto.gerir')
  if (p.tipo !== 'ENTRADA' && p.tipo !== 'SAIDA') return { ok: false, erro: 'Escolha entrada ou saída.' }
  const motivo = limpar(p.motivo, 300)
  if (motivo.length < 5) return { ok: false, erro: 'Escreva o motivo do ajuste — ele fica na folha.' }
  const em = deSP(p.dia, p.hora)
  if (!em) return { ok: false, erro: 'Escolha um dia e uma hora que existam.' }
  if (em.getTime() > agora.getTime() + 60_000) return { ok: false, erro: 'Ajuste é do que já aconteceu: a hora não pode ser no futuro.' }

  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.colaborador.findUnique({ where: { id: p.colaboradorId }, select: SELECT_COLAB })
    if (!c) return { ok: false as const, erro: 'Essa pessoa não foi encontrada.' }
    if (!podeNoColaborador(sessao, 'ponto.gerir', c)) throw new SemPermissao('ponto.gerir', c.unidadeId ?? undefined)
    await db.registroPonto.create({
      data: {
        orgId: sessao.orgId, colaboradorId: c.id, unidadeId: c.unidadeId, tipo: p.tipo, em,
        origem: 'AJUSTE', motivo, quemId: sessao.usuarioId, quem: sessao.nome,
      },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: c.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'ponto.ajustou', alvoTipo: 'colaborador', alvoId: c.id, alvoNome: c.nome, motivo,
        depois: { tipo: p.tipo, em: em.toISOString() },
      },
    })
    return { ok: true as const, tipo: p.tipo, em }
  })
}

/** Anula uma batida errada. Ela continua na folha, riscada, com o motivo. */
export async function anularBatida(
  sessao: Sessao,
  registroId: string,
  motivoBruto: string,
  agora = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'ponto.gerir')
  const motivo = limpar(motivoBruto, 300)
  if (motivo.length < 5) return { ok: false, erro: 'Escreva por que esta batida está errada.' }
  return comoOrg(sessao.orgId, async (db) => {
    const r = await db.registroPonto.findUnique({
      where: { id: registroId },
      select: { id: true, tipo: true, em: true, anuladoEm: true, colaborador: { select: SELECT_COLAB } },
    })
    if (!r) return { ok: false as const, erro: 'Essa batida não existe.' }
    if (!podeNoColaborador(sessao, 'ponto.gerir', r.colaborador)) throw new SemPermissao('ponto.gerir', r.colaborador.unidadeId ?? undefined)
    if (r.anuladoEm) return { ok: false as const, erro: 'Essa batida já foi anulada.' }
    const feito = await db.registroPonto.updateMany({
      where: { id: r.id, anuladoEm: null },
      data: { anuladoEm: agora, anuladoPor: sessao.nome, motivoAnulacao: motivo },
    })
    if (feito.count === 0) return { ok: false as const, erro: 'Essa batida já foi anulada.' }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: r.colaborador.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'ponto.anulou', alvoTipo: 'colaborador', alvoId: r.colaborador.id, alvoNome: r.colaborador.nome, motivo,
        antes: { tipo: r.tipo, em: r.em.toISOString() },
      },
    })
    return { ok: true as const }
  })
}

const DIA = /^\d{4}-\d{2}-\d{2}$/
const diaQueExiste = (dia: string) => DIA.test(dia) && diaDaColuna(colunaDoDia(dia)) === dia

/**
 * Abona um dia: folga, atestado, feriado, "ainda não trabalhava". A jornada
 * do dia vira zero e o dia sem batida deixa de ser falta. As batidas do dia,
 * se houver, continuam contando como trabalhadas.
 *
 * Abonar de novo o mesmo dia troca o motivo.
 */
export async function abonarDia(
  sessao: Sessao,
  p: { colaboradorId: string; dia: string; motivo: string },
  agora = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'ponto.gerir')
  const motivo = limpar(p.motivo, 120)
  if (motivo.length < 3) return { ok: false, erro: 'Escreva o motivo (folga, atestado, feriado…).' }
  if (!diaQueExiste(p.dia)) return { ok: false, erro: 'Escolha um dia que exista.' }
  if (p.dia > somarDias(diaEmSP(agora), 60)) return { ok: false, erro: 'Abone no máximo 60 dias para frente.' }

  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.colaborador.findUnique({ where: { id: p.colaboradorId }, select: SELECT_COLAB })
    if (!c) return { ok: false as const, erro: 'Essa pessoa não foi encontrada.' }
    if (!podeNoColaborador(sessao, 'ponto.gerir', c)) throw new SemPermissao('ponto.gerir', c.unidadeId ?? undefined)
    const dia = colunaDoDia(p.dia)
    await db.abonoPonto.upsert({
      where: { colaboradorId_dia: { colaboradorId: c.id, dia } },
      create: { orgId: sessao.orgId, colaboradorId: c.id, dia, motivo, quem: sessao.nome },
      update: { motivo, quem: sessao.nome },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: c.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'ponto.abonou', alvoTipo: 'colaborador', alvoId: c.id, alvoNome: c.nome, motivo,
        depois: { dia: p.dia },
      },
    })
    return { ok: true as const }
  })
}

/** Tira o abono: o dia volta a contar a jornada (e a falta, se não houve batida). */
export async function desfazerAbono(
  sessao: Sessao,
  p: { colaboradorId: string; dia: string },
): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'ponto.gerir')
  if (!diaQueExiste(p.dia)) return { ok: false, erro: 'Dia inválido.' }
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.colaborador.findUnique({ where: { id: p.colaboradorId }, select: SELECT_COLAB })
    if (!c) return { ok: false as const, erro: 'Essa pessoa não foi encontrada.' }
    if (!podeNoColaborador(sessao, 'ponto.gerir', c)) throw new SemPermissao('ponto.gerir', c.unidadeId ?? undefined)
    const antes = await db.abonoPonto.findUnique({
      where: { colaboradorId_dia: { colaboradorId: c.id, dia: colunaDoDia(p.dia) } },
      select: { id: true, motivo: true },
    })
    if (!antes) return { ok: true as const }
    await db.abonoPonto.delete({ where: { id: antes.id } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: c.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'ponto.desabonou', alvoTipo: 'colaborador', alvoId: c.id, alvoNome: c.nome,
        antes: { dia: p.dia, motivo: antes.motivo },
      },
    })
    return { ok: true as const }
  })
}

/**
 * O primeiro dia de trabalho. Antes dele a folha não cobra jornada nem
 * falta. Sem isto valia o dia do cadastro — quem foi cadastrado antes de
 * começar chegava com faltas de dias em que nem trabalhava aqui.
 */
export async function definirInicio(
  sessao: Sessao,
  p: { colaboradorId: string; dia: string },
): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'ponto.gerir')
  if (!diaQueExiste(p.dia)) return { ok: false, erro: 'Escolha um dia que exista.' }
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.colaborador.findUnique({ where: { id: p.colaboradorId }, select: SELECT_COLAB })
    if (!c) return { ok: false as const, erro: 'Essa pessoa não foi encontrada.' }
    if (!podeNoColaborador(sessao, 'ponto.gerir', c)) throw new SemPermissao('ponto.gerir', c.unidadeId ?? undefined)
    const antes = desdeDe(c)
    if (antes === p.dia) return { ok: true as const }
    await db.colaborador.update({ where: { id: c.id }, data: { inicioEm: colunaDoDia(p.dia) } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: c.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'ponto.inicio', alvoTipo: 'colaborador', alvoId: c.id, alvoNome: c.nome,
        antes: { inicio: antes }, depois: { inicio: p.dia },
      },
    })
    return { ok: true as const }
  })
}

// ─────────────────────────────────────────────────────────────
// A FOLHA
// ─────────────────────────────────────────────────────────────

export type BatidaNaFolha = {
  id: string
  tipo: TipoPonto
  em: Date
  origem: OrigemPonto
  quem: string
  motivo: string | null
  anulada: { em: Date; por: string | null; motivo: string | null } | null
}

/**
 * A folha do mês de uma pessoa: a conta (`folhaDoMes`) e as batidas cruas,
 * com as anuladas riscadas — a folha mostra a trilha, não só o resultado.
 *
 * Abre para a própria pessoa (bater ponto é dela) e para quem vê as horas da
 * loja dela. Ninguém mais.
 */
export async function folhaDe(
  sessao: Sessao,
  colaboradorId: string,
  mes: string,
  agora = new Date(),
): Promise<{
  colaborador: { id: string; nome: string; unidadeId: string | null; jornadaMin: number[]; inicio: string }
  folha: Folha
  batidas: BatidaNaFolha[]
} | null> {
  const de = inicioDoDiaEmSP(somarDias(`${mes}-01`, -1))
  const fimDoMes = diasDoMes(mes).at(-1)!
  const ate = inicioDoDiaEmSP(somarDias(fimDoMes, 2))
  const r = await comoOrg(sessao.orgId, async (db) => {
    const c = await db.colaborador.findUnique({ where: { id: colaboradorId }, select: SELECT_COLAB })
    if (!c) return null
    const propria = !!c.usuarioId && c.usuarioId === sessao.usuarioId && pode(sessao, 'ponto.proprio')
    if (!propria && !podeNoColaborador(sessao, 'ponto.ver', c)) return null
    const linhas = await batidasDe(db, c.id, de, ate)
    const abonos = await abonosDe(db, [c.id], `${mes}-01`, fimDoMes)
    return { c, linhas, abonos: abonos.get(c.id) }
  })
  if (!r) return null
  const folha = folhaDoMes(validas(r.linhas), r.c.jornadaMin, mes, agora, desdeDe(r.c), r.abonos)
  const inicioMes = inicioDoDiaEmSP(`${mes}-01`)
  const fimMes = inicioDoDiaEmSP(somarDias(fimDoMes, 1))
  return {
    colaborador: { id: r.c.id, nome: r.c.nome, unidadeId: r.c.unidadeId, jornadaMin: r.c.jornadaMin, inicio: desdeDe(r.c) },
    folha,
    batidas: r.linhas
      .filter((b) => b.em >= inicioMes && b.em < fimMes)
      .map((b) => ({
        id: b.id,
        tipo: b.tipo,
        em: b.em,
        origem: b.origem,
        quem: b.quem,
        motivo: b.motivo,
        anulada: b.anuladoEm ? { em: b.anuladoEm, por: b.anuladoPor, motivo: b.motivoAnulacao } : null,
      })),
  }
}

export type LinhaDoMes = {
  colaboradorId: string
  nome: string
  cargo: string | null
  unidadeNome: string | null
  semConta: boolean
  totais: Folha['totais']
  aberto: Date | null
  temJornada: boolean
}

/**
 * O mês de todo mundo das lojas pedidas, uma linha por pessoa — a tela que o
 * dono (e o contador) abre para fechar a folha.
 */
export async function resumoDoMes(
  sessao: Sessao,
  unidadeIds: string[],
  mes: string,
  agora = new Date(),
): Promise<LinhaDoMes[]> {
  exigir(sessao, 'ponto.ver')
  const de = inicioDoDiaEmSP(somarDias(`${mes}-01`, -1))
  const ate = inicioDoDiaEmSP(somarDias(diasDoMes(mes).at(-1)!, 2))
  const r = await comoOrg(sessao.orgId, async (db) => {
    const cs = await db.colaborador.findMany({
      where: { ativo: true, OR: [{ unidadeId: null }, { unidadeId: { in: unidadeIds } }] },
      orderBy: { nome: 'asc' },
      take: 300,
      select: { ...SELECT_COLAB, cargo: true, unidade: { select: { nome: true } } },
    })
    const visiveis = cs.filter((c) => podeNoColaborador(sessao, 'ponto.ver', c))
    const batidas = visiveis.length
      ? await db.registroPonto.findMany({
          where: { colaboradorId: { in: visiveis.map((c) => c.id) }, em: { gte: de, lt: ate }, anuladoEm: null },
          orderBy: { em: 'asc' },
          take: 20_000,
          select: { id: true, colaboradorId: true, tipo: true, em: true },
        })
      : []
    const abonos = await abonosDe(db, visiveis.map((c) => c.id), `${mes}-01`, diasDoMes(mes).at(-1)!)
    return { visiveis, batidas, abonos }
  })
  const por = new Map<string, Batida[]>()
  for (const b of r.batidas) {
    const l = por.get(b.colaboradorId) ?? []
    l.push(b)
    por.set(b.colaboradorId, l)
  }
  return r.visiveis.map((c) => {
    const f = folhaDoMes(por.get(c.id) ?? [], c.jornadaMin, mes, agora, desdeDe(c), r.abonos.get(c.id))
    return {
      colaboradorId: c.id,
      nome: c.nome,
      cargo: c.cargo,
      unidadeNome: c.unidade?.nome ?? null,
      semConta: !c.usuarioId,
      totais: f.totais,
      aberto: f.aberto?.entrada ?? null,
      temJornada: c.jornadaMin.some((m) => m > 0),
    }
  })
}

/**
 * Quem está trabalhando agora: turno aberto (entrada sem saída, recente).
 * Para o painel, o assistente e a tela de funcionários.
 */
export async function trabalhandoAgora(
  sessao: Sessao,
  unidadeIds: string[],
  agora = new Date(),
): Promise<{ colaboradorId: string; nome: string; desde: Date }[]> {
  if (!pode(sessao, 'ponto.ver')) return []
  const de = new Date(agora.getTime() - TURNO_MAXIMO_HORAS * 3_600_000)
  const r = await comoOrg(sessao.orgId, async (db) => {
    const cs = await db.colaborador.findMany({
      where: { ativo: true, OR: [{ unidadeId: null }, { unidadeId: { in: unidadeIds } }] },
      select: SELECT_COLAB,
      take: 300,
    })
    const visiveis = cs.filter((c) => podeNoColaborador(sessao, 'ponto.ver', c))
    const batidas = visiveis.length
      ? await db.registroPonto.findMany({
          where: { colaboradorId: { in: visiveis.map((c) => c.id) }, em: { gte: de, lte: agora }, anuladoEm: null },
          orderBy: { em: 'asc' },
          select: { id: true, colaboradorId: true, tipo: true, em: true },
        })
      : []
    return { visiveis, batidas }
  })
  const saida: { colaboradorId: string; nome: string; desde: Date }[] = []
  for (const c of r.visiveis) {
    const t = montarTurnos(r.batidas.filter((b) => b.colaboradorId === c.id), agora).at(-1)
    if (t?.situacao === 'aberto' && t.entrada) saida.push({ colaboradorId: c.id, nome: c.nome, desde: t.entrada })
  }
  return saida.sort((a, b) => a.desde.getTime() - b.desde.getTime())
}

/** O estado do ponto de UMA pessoa agora: o botão da tela sabe o que oferecer. */
export async function estadoDoPonto(sessao: Sessao, colaboradorId: string, agora = new Date()) {
  const r = await comoOrg(sessao.orgId, async (db) => {
    const c = await db.colaborador.findUnique({ where: { id: colaboradorId }, select: SELECT_COLAB })
    if (!c) return null
    const linhas = validas(await batidasDe(db, c.id, new Date(agora.getTime() - 3 * 86_400_000), new Date(agora.getTime() + 60_000)))
    return { c, linhas }
  })
  if (!r) return null
  const t = montarTurnos(r.linhas, agora).at(-1)
  return {
    proxima: proximaBatida(r.linhas, agora),
    desde: t?.situacao === 'aberto' ? t.entrada : null,
    ultima: r.linhas.at(-1) ?? null,
  }
}

/** "22:00" do instante, e o dia curto — para a folha escrever a batida. */
export { horaEmSP }
export const diaDoMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
export const inicioDoMes = (mes: string) => inicioDoDiaEmSP(`${mes}-01`)
export const hojeEmSP = (agora = new Date()) => diaEmSP(agora)
