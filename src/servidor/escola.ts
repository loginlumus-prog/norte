// A escola: turmas, matrículas e o responsável pelo aluno.
//
// ── o aluno é a ficha de sempre ──────────────────────────────
// Aluno é um `Cliente` com a palavra "aluno" na tela (vocabulario.ts). A
// matrícula liga a ficha a uma turma; a mensalidade (mensalidades.ts) nasce
// da matrícula. Uma ficha só por pessoa: a anonimização da LGPD, o
// consentimento e o livro de auditoria continuam num lugar só.
//
// ── o responsável ────────────────────────────────────────────
// Aluno quase sempre é menor de idade. Quem paga e quem a escola contata é o
// RESPONSÁVEL — e mensagem da escola vai para ele, nunca para a criança:
//   • o aviso da mensalidade (avisos-mensalidade.ts) sai para o telefone do
//     responsável, e só com o aceite DELE;
//   • a ficha de um aluno com responsável não vale como aceite de oferta
//     (ofertas.ts): nenhuma campanha começa pelo telefone da criança, nem que
//     alguém marque "aceita" nela.
// E guarda o mínimo (LGPD, art. 6º, III): nome, parentesco e contato. O CPF é
// opcional; o da criança nem se pede aqui.
//
// ── quem pode ────────────────────────────────────────────────
// A secretaria (BALCAO) matricula, tranca, cancela e anota o responsável
// (`escola.matricular`). O que mexe no preço — criar e editar turma, mudar o
// valor de uma matrícula, dar bolsa — é `escola.gerir`: desconto tem dono.
//
// Puro em cima (validação, transições), banco embaixo.

import type { SituacaoMatricula } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, soAsQuePode, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { colunaDoDia, diaDaColuna, diaEmSP } from './dia'
import { cpfValido, soDigitos } from './cliente'
import { chaveTelefone } from './assistente/telefone'
import { ehOrigemAceite, ORIGENS_ACEITE } from './ofertas'
import { ESCOLA_DESLIGADA, escolaLigada, gerarNaTransacao, mesesDaGeracao, descontoEmCentavos } from './mensalidades'

export type { SituacaoMatricula }

// ─────────────────────────────────────────────────────────────
// PURO
// ─────────────────────────────────────────────────────────────

export const TURNOS = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', integral: 'Integral' } as const
export type Turno = keyof typeof TURNOS
export const ehTurno = (v: unknown): v is Turno => typeof v === 'string' && Object.hasOwn(TURNOS, v)

export const ROTULO_MATRICULA: Record<SituacaoMatricula, string> = {
  ATIVA: 'Ativa',
  TRANCADA: 'Trancada',
  CANCELADA: 'Cancelada',
  CONCLUIDA: 'Concluída',
}

export const NIVEL_MATRICULA: Record<SituacaoMatricula, 'bom' | 'atencao' | 'critico' | 'neutro'> = {
  ATIVA: 'bom',
  TRANCADA: 'atencao',
  CANCELADA: 'neutro',
  CONCLUIDA: 'neutro',
}

/**
 * Para onde a matrícula pode ir. Cancelada e concluída não voltam: quem volta
 * a estudar faz matrícula nova (e o livro guarda as duas).
 */
const TRANSICOES: Record<SituacaoMatricula, readonly SituacaoMatricula[]> = {
  ATIVA: ['TRANCADA', 'CANCELADA', 'CONCLUIDA'],
  TRANCADA: ['ATIVA', 'CANCELADA'],
  CANCELADA: [],
  CONCLUIDA: [],
}
export const transicaoMatricula = (de: SituacaoMatricula, para: SituacaoMatricula) => TRANSICOES[de].includes(para)

/** Ocupa vaga na turma: a ativa e a trancada (quem trancou costuma voltar). */
export const OCUPAM_VAGA: readonly SituacaoMatricula[] = ['ATIVA', 'TRANCADA']

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "seg, qua e sex · 08:00–10:00". */
export function horarioDaTurma(t: { dias: number[]; horaInicio: string | null; horaFim: string | null }): string {
  const dias = [...new Set(t.dias)].filter((d) => d >= 0 && d <= 6).sort().map((d) => DIAS_CURTOS[d]!)
  const listaDias = dias.length <= 1 ? (dias[0] ?? '') : `${dias.slice(0, -1).join(', ')} e ${dias.at(-1)}`
  const horas = t.horaInicio ? (t.horaFim ? `${t.horaInicio}–${t.horaFim}` : `às ${t.horaInicio}`) : ''
  return [listaDias, horas].filter(Boolean).join(' · ')
}

/** Quase cheia: de 85% da capacidade para cima, ou faltando uma vaga. */
export function quaseCheia(ocupadas: number, capacidade: number | null): boolean {
  if (!capacidade || capacidade <= 0) return false
  return ocupadas >= capacidade - 1 || ocupadas / capacidade >= 0.85
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const DIA = /^\d{4}-\d{2}-\d{2}$/
const diaValido = (s: string) => DIA.test(s) && diaDaColuna(colunaDoDia(s)) === s

export type DadosTurma = {
  unidadeId: string
  nome: string
  curso?: string | null
  turno?: string | null
  professorId?: string | null
  dias?: number[]
  horaInicio?: string | null
  horaFim?: string | null
  capacidade?: number | null
  inicio?: string | null
  fim?: string | null
  mensalidade: number
  diaVencimento: number
  ativa?: boolean
}

export type TurmaLimpa = {
  unidadeId: string
  nome: string
  curso: string | null
  turno: Turno | null
  professorId: string | null
  dias: number[]
  horaInicio: string | null
  horaFim: string | null
  capacidade: number | null
  inicio: Date | null
  fim: Date | null
  mensalidade: number
  diaVencimento: number
  ativa: boolean
}

export function validarTurma(d: DadosTurma): { ok: true; limpo: TurmaLimpa } | { ok: false; erro: string } {
  const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const nome = txt(d.nome, 80)
  if (nome.length < 2) return { ok: false, erro: 'Dê um nome à turma: "1º ano A", "Inglês — terça e quinta".' }
  if (!d.unidadeId) return { ok: false, erro: 'Escolha a unidade da turma.' }
  const turno = d.turno ? (ehTurno(d.turno) ? d.turno : null) : null
  if (d.turno && !turno) return { ok: false, erro: 'Turno inválido.' }
  const dias = [...new Set((d.dias ?? []).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort()
  const horaInicio = txt(d.horaInicio, 5) || null
  const horaFim = txt(d.horaFim, 5) || null
  if (horaInicio && !HORA.test(horaInicio)) return { ok: false, erro: 'A hora de início é HH:MM.' }
  if (horaFim && !HORA.test(horaFim)) return { ok: false, erro: 'A hora do fim é HH:MM.' }
  if (horaInicio && horaFim && horaFim <= horaInicio) return { ok: false, erro: 'A aula termina antes de começar. Confira as horas.' }
  let capacidade: number | null = null
  if (d.capacidade !== null && d.capacidade !== undefined && String(d.capacidade) !== '') {
    capacidade = Number(d.capacidade)
    if (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 2000) return { ok: false, erro: 'A capacidade é um número de alunos, de 1 a 2000.' }
  }
  const inicioTxt = txt(d.inicio, 10)
  const fimTxt = txt(d.fim, 10)
  if (inicioTxt && !diaValido(inicioTxt)) return { ok: false, erro: 'A data de início não existe.' }
  if (fimTxt && !diaValido(fimTxt)) return { ok: false, erro: 'A data do fim não existe.' }
  if (inicioTxt && fimTxt && fimTxt < inicioTxt) return { ok: false, erro: 'O período termina antes de começar.' }
  if (typeof d.mensalidade !== 'number' || !Number.isFinite(d.mensalidade) || d.mensalidade < 0) {
    return { ok: false, erro: 'A mensalidade é um valor, zero ou mais.' }
  }
  const valorC = centavos(d.mensalidade)
  if (valorC > 9_999_999) return { ok: false, erro: 'Mensalidade alta demais. Confira os zeros.' }
  if (!Number.isInteger(d.diaVencimento) || d.diaVencimento < 1 || d.diaVencimento > 28) {
    return { ok: false, erro: 'O dia de vencimento vai de 1 a 28 — o 29, 30 e 31 não existem em todo mês.' }
  }
  return {
    ok: true,
    limpo: {
      unidadeId: d.unidadeId,
      nome,
      curso: txt(d.curso, 80) || null,
      turno,
      professorId: d.professorId || null,
      dias,
      horaInicio,
      horaFim,
      capacidade,
      inicio: inicioTxt ? colunaDoDia(inicioTxt) : null,
      fim: fimTxt ? colunaDoDia(fimTxt) : null,
      mensalidade: reais(valorC),
      diaVencimento: d.diaVencimento,
      ativa: d.ativa !== false,
    },
  }
}

export type DadosResponsavel = {
  nome: string
  parentesco?: string | null
  telefone?: string | null
  email?: string | null
  documento?: string | null
  /** O aceite do aviso da mensalidade, quando MUDA. */
  avisos?: { valor: 'SIM' | 'NAO'; origem: string | null } | null
}

export function validarResponsavel(d: DadosResponsavel):
  | { ok: true; limpo: { nome: string; parentesco: string | null; telefone: string | null; email: string | null; documento: string | null } }
  | { ok: false; erro: string } {
  const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const nome = txt(d.nome, 120)
  if (nome.length < 2) return { ok: false, erro: 'Escreva o nome do responsável.' }
  const telefone = soDigitos(txt(d.telefone, 30)) || null
  if (telefone && !chaveTelefone(telefone)) return { ok: false, erro: 'Esse telefone não tem a forma de um número com DDD.' }
  const email = txt(d.email, 160).toLowerCase() || null
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: 'Esse e-mail não tem a forma de um e-mail.' }
  const documento = soDigitos(txt(d.documento, 20)) || null
  if (documento && !cpfValido(documento)) return { ok: false, erro: 'Esse CPF não confere. Confira os números.' }
  if (!telefone && !email) return { ok: false, erro: 'Anote pelo menos um contato do responsável: telefone ou e-mail.' }
  return { ok: true, limpo: { nome, parentesco: txt(d.parentesco, 40) || null, telefone, email, documento } }
}

// ─────────────────────────────────────────────────────────────
// BANCO — o módulo, conferido no servidor
// ─────────────────────────────────────────────────────────────

/**
 * A Server Action é endereço público: o menu e a tela já somem sem o módulo,
 * e cada escrita confere de novo, de dentro da empresa.
 */
async function recusaDoModulo(db: BancoDaOrg, orgId: string): Promise<string | null> {
  const org = await db.org.findUnique({ where: { id: orgId }, select: { plano: true, modulos: true } })
  return escolaLigada(org) ? null : ESCOLA_DESLIGADA
}

// ─────────────────────────────────────────────────────────────
// BANCO — turmas
// ─────────────────────────────────────────────────────────────

export type TurmaNaLista = {
  id: string
  unidadeId: string
  unidade: string
  nome: string
  curso: string | null
  turno: string | null
  professorId: string | null
  professor: string | null
  dias: number[]
  horaInicio: string | null
  horaFim: string | null
  capacidade: number | null
  inicio: Date | null
  fim: Date | null
  mensalidade: number
  diaVencimento: number
  ativa: boolean
  /** Ativas + trancadas: é quem ocupa vaga. */
  ocupadas: number
  ativas: number
  vagas: number | null
}

export async function listarTurmas(
  sessao: Sessao,
  f: { unidadeIds: string[]; todas?: boolean },
): Promise<TurmaNaLista[]> {
  exigir(sessao, 'escola.ver')
  const lojas = soAsQuePode(sessao, 'escola.ver', f.unidadeIds)
  if (lojas.length === 0) return []
  const linhas = await comoOrg(sessao.orgId, async (db) => {
    const turmas = await db.turma.findMany({
      where: { unidadeId: { in: lojas }, ...(f.todas ? {} : { ativa: true }) },
      orderBy: [{ ativa: 'desc' }, { nome: 'asc' }],
      take: 500,
      select: {
        id: true, unidadeId: true, nome: true, curso: true, turno: true, professorId: true, dias: true,
        horaInicio: true, horaFim: true, capacidade: true, inicio: true, fim: true, mensalidade: true,
        diaVencimento: true, ativa: true,
        unidade: { select: { nome: true } },
        professor: { select: { nome: true } },
      },
    })
    const contagem = await db.matricula.groupBy({
      by: ['turmaId', 'situacao'],
      where: { turmaId: { in: turmas.map((t) => t.id) }, situacao: { in: [...OCUPAM_VAGA] } },
      _count: { _all: true },
    })
    return { turmas, contagem }
  })
  return linhas.turmas.map((t) => {
    const ativas = linhas.contagem.find((c) => c.turmaId === t.id && c.situacao === 'ATIVA')?._count._all ?? 0
    const trancadas = linhas.contagem.find((c) => c.turmaId === t.id && c.situacao === 'TRANCADA')?._count._all ?? 0
    const ocupadas = ativas + trancadas
    return {
      id: t.id,
      unidadeId: t.unidadeId,
      unidade: t.unidade.nome,
      nome: t.nome,
      curso: t.curso,
      turno: t.turno,
      professorId: t.professorId,
      professor: t.professor?.nome ?? null,
      dias: t.dias,
      horaInicio: t.horaInicio,
      horaFim: t.horaFim,
      capacidade: t.capacidade,
      inicio: t.inicio,
      fim: t.fim,
      mensalidade: reais(centavos(t.mensalidade)),
      diaVencimento: t.diaVencimento,
      ativa: t.ativa,
      ocupadas,
      ativas,
      vagas: t.capacidade ? Math.max(0, t.capacidade - ocupadas) : null,
    }
  })
}

export type AlunoDaTurma = {
  matriculaId: string
  alunoId: string
  nome: string
  nascimento: Date | null
  responsavel: string | null
  telefoneResponsavel: string | null
  situacao: SituacaoMatricula
  inicio: Date
  fim: Date | null
  valor: number
  desconto: number
  descontoPct: number
  descontoValor: number
  descontoMotivo: string | null
  diaVencimento: number
  motivoSaida: string | null
}

/** A turma, com os alunos. Nula se não existe ou é de unidade que a pessoa não vê. */
export async function acharTurma(sessao: Sessao, id: string) {
  exigir(sessao, 'escola.ver')
  const t = await comoOrg(sessao.orgId, (db) =>
    db.turma.findUnique({
      where: { id },
      select: {
        id: true, unidadeId: true, nome: true, curso: true, turno: true, professorId: true, dias: true,
        horaInicio: true, horaFim: true, capacidade: true, inicio: true, fim: true, mensalidade: true,
        diaVencimento: true, ativa: true,
        unidade: { select: { nome: true } },
        professor: { select: { nome: true } },
        matriculas: {
          orderBy: [{ situacao: 'asc' }, { aluno: { nome: 'asc' } }],
          select: {
            id: true, alunoId: true, situacao: true, inicio: true, fim: true, valor: true, diaVencimento: true,
            descontoPct: true, descontoValor: true, descontoMotivo: true, motivoSaida: true,
            aluno: { select: { nome: true, nascimento: true, responsavel: { select: { nome: true, telefone: true } } } },
          },
        },
      },
    }),
  )
  if (!t || !pode(sessao, 'escola.ver', t.unidadeId)) return null
  const alunos: AlunoDaTurma[] = t.matriculas.map((m) => {
    const valorC = centavos(m.valor)
    return {
      matriculaId: m.id,
      alunoId: m.alunoId,
      nome: m.aluno.nome,
      nascimento: m.aluno.nascimento,
      responsavel: m.aluno.responsavel?.nome ?? null,
      telefoneResponsavel: m.aluno.responsavel?.telefone ?? null,
      situacao: m.situacao,
      inicio: m.inicio,
      fim: m.fim,
      valor: reais(valorC),
      desconto: reais(descontoEmCentavos(valorC, Number(m.descontoPct), centavos(m.descontoValor))),
      descontoPct: Number(m.descontoPct),
      descontoValor: reais(centavos(m.descontoValor)),
      descontoMotivo: m.descontoMotivo,
      diaVencimento: m.diaVencimento,
      motivoSaida: m.motivoSaida,
    }
  })
  const ocupadas = alunos.filter((a) => OCUPAM_VAGA.includes(a.situacao)).length
  return {
    id: t.id,
    unidadeId: t.unidadeId,
    unidade: t.unidade.nome,
    nome: t.nome,
    curso: t.curso,
    turno: t.turno,
    professorId: t.professorId,
    professor: t.professor?.nome ?? null,
    dias: t.dias,
    horaInicio: t.horaInicio,
    horaFim: t.horaFim,
    capacidade: t.capacidade,
    inicio: t.inicio,
    fim: t.fim,
    mensalidade: reais(centavos(t.mensalidade)),
    diaVencimento: t.diaVencimento,
    ativa: t.ativa,
    ocupadas,
    vagas: t.capacidade ? Math.max(0, t.capacidade - ocupadas) : null,
    alunos,
  }
}

/**
 * Os professores de VÁRIAS unidades de uma vez, com a unidade de cada um —
 * para o formulário da turma trocar a lista quando a pessoa troca a unidade.
 * Só das unidades em que ela gere a escola.
 */
export async function professoresDasUnidades(sessao: Sessao, unidadeIds: string[]) {
  const lojas = soAsQuePode(sessao, 'escola.gerir', unidadeIds)
  if (lojas.length === 0) return []
  return comoOrg(sessao.orgId, (db) =>
    db.colaborador.findMany({
      where: { ativo: true, OR: [{ unidadeId: null }, { unidadeId: { in: lojas } }] },
      orderBy: { nome: 'asc' },
      take: 500,
      select: { id: true, nome: true, cargo: true, unidadeId: true },
    }),
  )
}

export type ResultadoTurma = { ok: true; id: string } | { ok: false; erro: string }

async function conferirProfessor(db: BancoDaOrg, professorId: string | null, unidadeId: string): Promise<string | null> {
  if (!professorId) return null
  const c = await db.colaborador.findUnique({ where: { id: professorId }, select: { ativo: true, unidadeId: true, nome: true } })
  if (!c || !c.ativo) return 'Esse professor não está na lista de Funcionários.'
  if (c.unidadeId && c.unidadeId !== unidadeId) return `${c.nome} trabalha em outra unidade.`
  return null
}

export async function criarTurma(sessao: Sessao, d: DadosTurma): Promise<ResultadoTurma> {
  const v = validarTurma(d)
  if (!v.ok) return v
  const t = v.limpo
  exigir(sessao, 'escola.gerir', t.unidadeId)
  return comoOrg(sessao.orgId, async (db) => {
    const recusa = await recusaDoModulo(db, sessao.orgId)
    if (recusa) return { ok: false as const, erro: recusa }
    const loja = await db.unidade.findFirst({ where: { id: t.unidadeId, ativa: true }, select: { id: true } })
    if (!loja) return { ok: false as const, erro: 'Essa unidade não existe ou está desativada.' }
    const prof = await conferirProfessor(db, t.professorId, t.unidadeId)
    if (prof) return { ok: false as const, erro: prof }
    const criada = await db.turma.create({ data: { orgId: sessao.orgId, ...t }, select: { id: true } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: t.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'turma.criou', alvoTipo: 'turma', alvoId: criada.id, alvoNome: t.nome, valor: t.mensalidade,
        depois: { capacidade: t.capacidade, mensalidade: t.mensalidade, diaVencimento: t.diaVencimento },
      },
    })
    return { ok: true as const, id: criada.id }
  })
}

/**
 * Edita a turma. A unidade não muda depois de ter aluno: a matrícula e a
 * mensalidade guardam a unidade, e é por ela que caixa e DRE contam.
 * A mensalidade PADRÃO muda só para quem se matricular daqui em diante.
 */
export async function editarTurma(sessao: Sessao, id: string, d: DadosTurma): Promise<ResultadoTurma> {
  const v = validarTurma(d)
  if (!v.ok) return v
  const t = v.limpo
  return comoOrg(sessao.orgId, async (db) => {
    const recusa = await recusaDoModulo(db, sessao.orgId)
    if (recusa) return { ok: false as const, erro: recusa }
    const antes = await db.turma.findUnique({
      where: { id },
      select: { unidadeId: true, nome: true, mensalidade: true, capacidade: true, ativa: true, _count: { select: { matriculas: true } } },
    })
    if (!antes) return { ok: false as const, erro: 'Essa turma não existe mais.' }
    exigir(sessao, 'escola.gerir', antes.unidadeId)
    exigir(sessao, 'escola.gerir', t.unidadeId)
    if (t.unidadeId !== antes.unidadeId && antes._count.matriculas > 0) {
      return { ok: false as const, erro: 'A turma já tem alunos: a unidade dela não muda. Crie a turma na outra unidade.' }
    }
    const prof = await conferirProfessor(db, t.professorId, t.unidadeId)
    if (prof) return { ok: false as const, erro: prof }
    await db.turma.update({ where: { id }, data: t })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: t.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'turma.alterou', alvoTipo: 'turma', alvoId: id, alvoNome: t.nome, valor: t.mensalidade,
        antes: { nome: antes.nome, mensalidade: Number(antes.mensalidade), capacidade: antes.capacidade, ativa: antes.ativa },
        depois: { nome: t.nome, mensalidade: t.mensalidade, capacidade: t.capacidade, ativa: t.ativa },
      },
    })
    return { ok: true as const, id }
  })
}

// ─────────────────────────────────────────────────────────────
// BANCO — matrículas
// ─────────────────────────────────────────────────────────────

export type DadosMatricula = {
  alunoId: string
  turmaId: string
  /** "AAAA-MM-DD". Vazio = hoje. */
  inicio?: string | null
  /** Vazio = o da turma. Diferente do da turma pede `escola.gerir`. */
  valor?: number | null
  diaVencimento?: number | null
  descontoPct?: number | null
  descontoValor?: number | null
  descontoMotivo?: string | null
  /** A turma está cheia e é isso mesmo. */
  confirmar?: boolean
}

export type ResultadoMatricula =
  | { ok: true; id: string; mensalidades: number }
  | { ok: false; erro: string; pedeConfirmacao?: boolean }

/** O erro do índice "o mesmo aluno não fica duas vezes na mesma turma". */
export function ehMatriculaRepetida(e: unknown): boolean {
  const x = e as { code?: unknown; meta?: unknown; message?: unknown } | null
  if (!x) return false
  return (x.code === 'P2002' || x.code === '23505') && `${JSON.stringify(x.meta ?? null)} ${String(x.message ?? '')}`.includes('matriculas_uma_viva')
}

function limparDesconto(d: { descontoPct?: number | null; descontoValor?: number | null; descontoMotivo?: string | null }) {
  const pct = Number(d.descontoPct ?? 0)
  const fixo = Number(d.descontoValor ?? 0)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false as const, erro: 'A bolsa em porcento vai de 0 a 100.' }
  if (!Number.isFinite(fixo) || fixo < 0) return { ok: false as const, erro: 'O desconto em reais é um valor, zero ou mais.' }
  const motivo = typeof d.descontoMotivo === 'string' ? d.descontoMotivo.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  const tem = pct > 0 || fixo > 0
  if (tem && motivo.length < 3) return { ok: false as const, erro: 'Toda bolsa ou desconto precisa de motivo: "irmão", "bolsa de mérito", "funcionário".' }
  return { ok: true as const, pct: Math.round(pct * 100) / 100, fixo: reais(centavos(fixo)), motivo: tem ? motivo : null, tem }
}

export async function matricular(sessao: Sessao, d: DadosMatricula, agora = new Date()): Promise<ResultadoMatricula> {
  const hoje = diaEmSP(agora)
  const inicio = (d.inicio ?? '').trim() || hoje
  if (!diaValido(inicio)) return { ok: false, erro: 'A data de início não existe.' }
  const desc = limparDesconto(d)
  if (!desc.ok) return desc
  if (d.diaVencimento != null && (!Number.isInteger(d.diaVencimento) || d.diaVencimento < 1 || d.diaVencimento > 28)) {
    return { ok: false, erro: 'O dia de vencimento vai de 1 a 28.' }
  }
  if (d.valor != null && (!Number.isFinite(d.valor) || d.valor < 0)) return { ok: false, erro: 'A mensalidade é um valor, zero ou mais.' }

  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const recusa = await recusaDoModulo(db, sessao.orgId)
      if (recusa) return { ok: false as const, erro: recusa }
      const turma = await db.turma.findUnique({
        where: { id: d.turmaId },
        select: { id: true, nome: true, unidadeId: true, ativa: true, capacidade: true, mensalidade: true, diaVencimento: true, fim: true },
      })
      if (!turma) return { ok: false as const, erro: 'Essa turma não existe mais.' }
      exigir(sessao, 'escola.matricular', turma.unidadeId)
      if (!turma.ativa) return { ok: false as const, erro: `A turma ${turma.nome} está encerrada: não recebe matrícula.` }
      if (turma.fim && diaDaColuna(turma.fim) < inicio) return { ok: false as const, erro: `A turma ${turma.nome} termina antes desse início.` }

      const valorC = d.valor != null ? centavos(d.valor) : centavos(turma.mensalidade)
      // Preço diferente do da turma, ou bolsa, é desconto — e desconto tem dono.
      if ((valorC !== centavos(turma.mensalidade) || desc.tem) && !pode(sessao, 'escola.gerir', turma.unidadeId)) {
        return { ok: false as const, erro: 'Mudar o valor ou dar bolsa é com quem gere a escola. Matricule pelo valor da turma, e peça a bolsa a quem pode dar.' }
      }

      const aluno = await db.cliente.findUnique({ where: { id: d.alunoId }, select: { id: true, nome: true, anonimizadoEm: true, ativo: true } })
      if (!aluno || aluno.anonimizadoEm) return { ok: false as const, erro: 'Esse cadastro não foi encontrado.' }

      if (turma.capacidade && !d.confirmar) {
        const ocupadas = await db.matricula.count({ where: { turmaId: turma.id, situacao: { in: [...OCUPAM_VAGA] } } })
        if (ocupadas >= turma.capacidade) {
          return {
            ok: false as const,
            pedeConfirmacao: true,
            erro: `A turma ${turma.nome} está cheia (${ocupadas} de ${turma.capacidade}). Se é isso mesmo, marque "é isso mesmo" e matricule de novo.`,
          }
        }
      }

      const nova = await db.matricula.create({
        data: {
          orgId: sessao.orgId,
          alunoId: aluno.id,
          turmaId: turma.id,
          unidadeId: turma.unidadeId,
          inicio: colunaDoDia(inicio),
          valor: reais(valorC),
          diaVencimento: d.diaVencimento ?? turma.diaVencimento,
          descontoPct: desc.pct,
          descontoValor: desc.fixo,
          descontoMotivo: desc.motivo,
          quemId: sessao.usuarioId,
          quem: sessao.nome,
        },
        select: { id: true },
      })
      if (!aluno.ativo) await db.cliente.update({ where: { id: aluno.id }, data: { ativo: true } })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId, unidadeId: turma.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
          acao: 'matricula.criou', alvoTipo: 'cliente', alvoId: aluno.id, alvoNome: aluno.nome, valor: reais(valorC),
          motivo: `turma ${turma.nome}${desc.motivo ? ` · desconto: ${desc.motivo}` : ''}`.slice(0, 300),
          depois: { matriculaId: nova.id, inicio, descontoPct: desc.pct, descontoValor: desc.fixo },
        },
      })
      // A mensalidade do mês de hoje e a do próximo nascem junto — a matrícula
      // de hoje já aparece em Mensalidades, sem esperar a rotina. Mês que já
      // passou não nasce: quem traz para o sistema o aluno que estuda desde
      // março não quer abrir, sem querer, seis meses de "atraso".
      const geradas = await gerarNaTransacao(db, sessao.orgId, mesesDaGeracao(agora), { usuarioId: sessao.usuarioId, nome: sessao.nome }, nova.id)
      return { ok: true as const, id: nova.id, mensalidades: geradas }
    })
  } catch (e) {
    if (ehMatriculaRepetida(e)) return { ok: false, erro: 'Este aluno já está matriculado nesta turma.' }
    throw e
  }
}

export type MudancaMatricula = { para: SituacaoMatricula; motivo?: string | null; dia?: string | null }

/** O começo do motivo da mensalidade dispensada pela saída — é por ele que a reativação a acha. */
const MOTIVO_DA_SAIDA = 'matrícula'

/**
 * Tranca, reativa, cancela ou conclui. Toda saída pede motivo.
 *
 * Saiu (trancou, cancelou, concluiu): as mensalidades DEPOIS do mês da saída
 * que não receberam nada são dispensadas — não se cobra o mês em que o aluno
 * não estava. A do próprio mês fica: se é devida ou não, a escola decide
 * (e dispensa à mão, com motivo). O que já venceu e não foi pago continua
 * devido — sair da escola não apaga dívida. Dispensar é de quem ajusta
 * mensalidade (`mensalidade.ajustar`).
 *
 * Reativou (a trancada volta): o que o trancamento dispensou, do mês da volta
 * em diante, volta a valer.
 */
export async function mudarMatricula(
  sessao: Sessao,
  id: string,
  m: MudancaMatricula,
  agora = new Date(),
): Promise<{ ok: true; dispensadas: number } | { ok: false; erro: string }> {
  const motivo = (m.motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  const dia = (m.dia ?? '').trim() || diaEmSP(agora)
  if (!diaValido(dia)) return { ok: false, erro: 'A data não existe.' }
  if (m.para !== 'ATIVA' && motivo.length < 3) return { ok: false, erro: 'Diga o motivo — ele fica na história do aluno.' }

  return comoOrg(sessao.orgId, async (db) => {
    const recusa = await recusaDoModulo(db, sessao.orgId)
    if (recusa) return { ok: false as const, erro: recusa }
    const x = await db.matricula.findUnique({
      where: { id },
      select: {
        id: true, situacao: true, unidadeId: true, alunoId: true, inicio: true, saidaEm: true,
        aluno: { select: { nome: true } }, turma: { select: { nome: true } },
      },
    })
    if (!x) return { ok: false as const, erro: 'Essa matrícula não existe mais.' }
    exigir(sessao, 'escola.matricular', x.unidadeId)
    if (!transicaoMatricula(x.situacao, m.para)) {
      return { ok: false as const, erro: `Matrícula ${ROTULO_MATRICULA[x.situacao].toLowerCase()} não vai para ${ROTULO_MATRICULA[m.para].toLowerCase()}.` }
    }
    if (dia < diaDaColuna(x.inicio)) return { ok: false as const, erro: 'A data é antes do início da matrícula.' }

    const sai = m.para !== 'ATIVA'
    // O que a saída dispensa: as mensalidades depois do mês da saída que não
    // receberam nada.
    const aDispensar = { matriculaId: id, mes: { gt: dia.slice(0, 7) }, quitadaEm: null, canceladaEm: null, pago: 0, abono: 0 }
    // Dispensar mensalidade é poder de quem AJUSTA mensalidade (o mesmo de
    // dispensar uma à mão). Sem isto, o Balcão — que matricula e tranca —
    // dispensava os meses seguintes trancando e reativando a matrícula.
    if (sai && !pode(sessao, 'mensalidade.ajustar', x.unidadeId) && (await db.mensalidade.count({ where: aDispensar })) > 0) {
      return {
        ok: false as const,
        erro: 'Sair da turma dispensa as mensalidades dos próximos meses, e isso é com quem ajusta mensalidade. Peça a quem pode.',
      }
    }
    const r = await db.matricula.updateMany({
      where: { id, situacao: x.situacao },
      data: sai
        ? {
            situacao: m.para,
            motivoSaida: motivo,
            saidaEm: agora,
            ...(m.para === 'TRANCADA' ? {} : { fim: colunaDoDia(dia) }),
          }
        : { situacao: 'ATIVA', motivoSaida: null, saidaEm: null },
    })
    if (r.count === 0) return { ok: false as const, erro: 'Alguém mudou esta matrícula agora. Recarregue a tela.' }

    let dispensadas = 0
    let devolvidas = 0
    if (sai) {
      const d = await db.mensalidade.updateMany({
        where: aDispensar,
        data: { canceladaEm: agora, motivoCancelamento: `${MOTIVO_DA_SAIDA} ${ROTULO_MATRICULA[m.para].toLowerCase()}: ${motivo}`.slice(0, 200) },
      })
      dispensadas = d.count
    } else if (x.saidaEm) {
      // Reativou: as mensalidades que o TRANCAMENTO dispensou, do mês da volta
      // em diante, voltam a valer. Sem isto elas ficavam canceladas para
      // sempre — e a geração não as refazia, porque (matrícula, mês) já
      // existe: o aluno estudava em novembro e novembro não era cobrado.
      // Só as que a saída dispensou (motivo e instante), não as dispensadas à
      // mão; os meses em que o aluno ficou fora continuam dispensados.
      const r = await db.mensalidade.updateMany({
        where: {
          matriculaId: id,
          mes: { gte: dia.slice(0, 7) },
          quitadaEm: null,
          canceladaEm: { gte: x.saidaEm },
          motivoCancelamento: { startsWith: MOTIVO_DA_SAIDA },
        },
        data: { canceladaEm: null, motivoCancelamento: null },
      })
      devolvidas = r.count
    }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: x.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: `matricula.${m.para.toLowerCase()}`, alvoTipo: 'cliente', alvoId: x.alunoId, alvoNome: x.aluno.nome,
        motivo: `turma ${x.turma.nome}${motivo ? `: ${motivo}` : ''}`.slice(0, 300),
        antes: { situacao: x.situacao },
        depois: { situacao: m.para, dia, mensalidadesDispensadas: dispensadas, ...(devolvidas ? { mensalidadesDeVolta: devolvidas } : {}), matriculaId: id },
      },
    })
    // Reativou: o mês de agora e o próximo nascem de novo, se faltarem.
    if (!sai) await gerarNaTransacao(db, sessao.orgId, mesesDaGeracao(agora), { usuarioId: sessao.usuarioId, nome: sessao.nome }, id)
    return { ok: true as const, dispensadas }
  })
}

/**
 * Muda o valor, o dia de vencimento ou a bolsa de uma matrícula — e acerta as
 * mensalidades dela que ainda não receberam nada, do mês de hoje em diante
 * (o mesmo desenho da conta recorrente). O que já recebeu é história.
 */
export async function editarMatricula(
  sessao: Sessao,
  id: string,
  d: { valor: number; diaVencimento: number; descontoPct?: number | null; descontoValor?: number | null; descontoMotivo?: string | null },
  agora = new Date(),
): Promise<{ ok: true; ajustadas: number } | { ok: false; erro: string }> {
  if (!Number.isFinite(d.valor) || d.valor < 0) return { ok: false, erro: 'A mensalidade é um valor, zero ou mais.' }
  if (!Number.isInteger(d.diaVencimento) || d.diaVencimento < 1 || d.diaVencimento > 28) return { ok: false, erro: 'O dia de vencimento vai de 1 a 28.' }
  const desc = limparDesconto(d)
  if (!desc.ok) return desc
  const valorC = centavos(d.valor)
  const mesAtual = diaEmSP(agora).slice(0, 7)

  return comoOrg(sessao.orgId, async (db) => {
    const recusa = await recusaDoModulo(db, sessao.orgId)
    if (recusa) return { ok: false as const, erro: recusa }
    const x = await db.matricula.findUnique({
      where: { id },
      select: { id: true, unidadeId: true, alunoId: true, situacao: true, valor: true, diaVencimento: true, descontoPct: true, descontoValor: true, inicio: true, aluno: { select: { nome: true } } },
    })
    if (!x) return { ok: false as const, erro: 'Essa matrícula não existe mais.' }
    exigir(sessao, 'escola.gerir', x.unidadeId)
    if (x.situacao === 'CANCELADA' || x.situacao === 'CONCLUIDA') return { ok: false as const, erro: 'Matrícula encerrada não muda de valor.' }

    await db.matricula.update({
      where: { id },
      data: { valor: reais(valorC), diaVencimento: d.diaVencimento, descontoPct: desc.pct, descontoValor: desc.fixo, descontoMotivo: desc.motivo },
    })
    const futuras = await db.mensalidade.findMany({
      where: { matriculaId: id, mes: { gte: mesAtual }, quitadaEm: null, canceladaEm: null, pago: 0, abono: 0 },
      select: { id: true, mes: true, _count: { select: { pagamentos: true } } },
    })
    const descC = descontoEmCentavos(valorC, desc.pct, centavos(desc.fixo))
    let ajustadas = 0
    for (const f of futuras) {
      if (f._count.pagamentos > 0) continue
      const [a, mm] = f.mes.split('-').map(Number) as [number, number]
      const ultimo = new Date(Date.UTC(a, mm, 0)).getUTCDate()
      const vencDia = `${f.mes}-${String(Math.min(d.diaVencimento, ultimo)).padStart(2, '0')}`
      const inicio = diaDaColuna(x.inicio)
      await db.mensalidade.update({
        where: { id: f.id },
        data: {
          valor: reais(valorC),
          desconto: reais(descC),
          vencimento: colunaDoDia(inicio.slice(0, 7) === f.mes && vencDia < inicio ? inicio : vencDia),
          // Vencimento novo: o aviso volta a valer para ele.
          avisoEm: null, aviso: null, avisoAtrasoEm: null, avisoAtraso: null,
        },
      })
      ajustadas++
    }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: x.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'matricula.alterou', alvoTipo: 'cliente', alvoId: x.alunoId, alvoNome: x.aluno.nome, valor: reais(valorC),
        motivo: desc.motivo ? `desconto: ${desc.motivo}` : null,
        antes: { valor: Number(x.valor), dia: x.diaVencimento, descontoPct: Number(x.descontoPct), descontoValor: Number(x.descontoValor) },
        depois: { valor: reais(valorC), dia: d.diaVencimento, descontoPct: desc.pct, descontoValor: desc.fixo, mensalidadesAjustadas: ajustadas, matriculaId: id },
      },
    })
    return { ok: true as const, ajustadas }
  })
}

// ─────────────────────────────────────────────────────────────
// BANCO — o responsável e a ficha escolar
// ─────────────────────────────────────────────────────────────

/**
 * Anota (ou muda) o responsável do aluno. O aceite do aviso da mensalidade
 * vai junto, com como a pessoa respondeu — é a prova (LGPD, art. 8º, § 2º).
 * Salvar a ficha por outro motivo não "aceita de novo".
 */
export async function salvarResponsavel(
  sessao: Sessao,
  alunoId: string,
  d: DadosResponsavel,
  agora = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'escola.matricular')
  const v = validarResponsavel(d)
  if (!v.ok) return v
  const r = v.limpo
  const avisos = d.avisos ?? null
  if (avisos && !ehOrigemAceite(avisos.origem)) return { ok: false, erro: 'Diga como o responsável respondeu sobre o aviso da mensalidade (no balcão, por telefone...).' }

  return comoOrg(sessao.orgId, async (db) => {
    const recusa = await recusaDoModulo(db, sessao.orgId)
    if (recusa) return { ok: false as const, erro: recusa }
    const aluno = await db.cliente.findUnique({
      where: { id: alunoId },
      select: { id: true, nome: true, anonimizadoEm: true, responsavel: { select: { id: true, nome: true, telefone: true, avisosWhatsapp: true } } },
    })
    if (!aluno || aluno.anonimizadoEm) return { ok: false as const, erro: 'Esse cadastro não foi encontrado.' }
    // A secretaria da unidade 3 não mexe no aluno que só estuda na unidade 5.
    const unidades = await db.matricula.findMany({ where: { alunoId }, select: { unidadeId: true }, distinct: ['unidadeId'] })
    if (unidades.length > 0 && !unidades.some((u) => pode(sessao, 'escola.matricular', u.unidadeId))) {
      return { ok: false as const, erro: 'Este aluno estuda em outra unidade.' }
    }

    const mudaAceite = avisos && avisos.valor !== aluno.responsavel?.avisosWhatsapp
    // Telefone novo: o aceite era do número antigo, e não passa para outro.
    const trocouTelefone = !!aluno.responsavel && chaveTelefone(aluno.responsavel.telefone) !== chaveTelefone(r.telefone)
    const aceite = mudaAceite
      ? { avisosWhatsapp: avisos!.valor, avisosEm: agora, avisosOrigem: avisos!.origem, avisosPor: sessao.nome }
      : trocouTelefone
        ? { avisosWhatsapp: 'NAO_PERGUNTADO' as const, avisosEm: null, avisosOrigem: null, avisosPor: null }
        : {}
    const salvo = await db.responsavel.upsert({
      where: { alunoId },
      create: { orgId: sessao.orgId, alunoId, ...r, ...aceite },
      update: { ...r, ...aceite },
      select: { id: true },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: aluno.responsavel ? 'responsavel.alterou' : 'responsavel.anotou',
        alvoTipo: 'cliente', alvoId: alunoId, alvoNome: aluno.nome,
        depois: {
          responsavelId: salvo.id,
          ...(mudaAceite ? { avisos: avisos!.valor, origem: ORIGENS_ACEITE[avisos!.origem as keyof typeof ORIGENS_ACEITE] } : {}),
          ...(trocouTelefone && !mudaAceite ? { aceiteZerado: 'telefone mudou' } : {}),
        },
      },
    })
    return { ok: true as const }
  })
}

export type FichaEscolar = {
  responsavel: {
    id: string
    nome: string
    parentesco: string | null
    telefone: string | null
    email: string | null
    documento: string | null
    avisos: 'SIM' | 'NAO' | 'NAO_PERGUNTADO'
    avisosEm: Date | null
    avisosOrigem: string | null
    avisosPor: string | null
  } | null
  matriculas: {
    id: string
    turmaId: string
    turma: string
    unidadeId: string
    unidade: string
    situacao: SituacaoMatricula
    inicio: Date
    fim: Date | null
    valor: number
    desconto: number
    descontoPct: number
    descontoValor: number
    descontoMotivo: string | null
    diaVencimento: number
    motivoSaida: string | null
  }[]
}

/** O que a ficha do aluno mostra da escola. Só as matrículas das unidades que a pessoa vê. */
export async function fichaEscolar(sessao: Sessao, alunoId: string): Promise<FichaEscolar> {
  exigir(sessao, 'escola.ver')
  const visiveis = unidadesQuePodem(sessao, 'escola.ver')
  const r = await comoOrg(sessao.orgId, async (db) => {
    const responsavel = await db.responsavel.findUnique({
      where: { alunoId },
      select: {
        id: true, nome: true, parentesco: true, telefone: true, email: true, documento: true,
        avisosWhatsapp: true, avisosEm: true, avisosOrigem: true, avisosPor: true,
      },
    })
    const matriculas = await db.matricula.findMany({
      where: { alunoId, ...(visiveis === 'todas' ? {} : { unidadeId: { in: visiveis } }) },
      orderBy: [{ situacao: 'asc' }, { inicio: 'desc' }],
      select: {
        id: true, turmaId: true, unidadeId: true, situacao: true, inicio: true, fim: true, valor: true,
        descontoPct: true, descontoValor: true, descontoMotivo: true, diaVencimento: true, motivoSaida: true,
        turma: { select: { nome: true } },
        unidade: { select: { nome: true } },
      },
    })
    return { responsavel, matriculas }
  })
  return {
    responsavel: r.responsavel
      ? {
          id: r.responsavel.id,
          nome: r.responsavel.nome,
          parentesco: r.responsavel.parentesco,
          telefone: r.responsavel.telefone,
          email: r.responsavel.email,
          documento: r.responsavel.documento,
          avisos: r.responsavel.avisosWhatsapp,
          avisosEm: r.responsavel.avisosEm,
          avisosOrigem: r.responsavel.avisosOrigem,
          avisosPor: r.responsavel.avisosPor,
        }
      : null,
    matriculas: r.matriculas.map((m) => {
      const valorC = centavos(m.valor)
      return {
        id: m.id,
        turmaId: m.turmaId,
        turma: m.turma.nome,
        unidadeId: m.unidadeId,
        unidade: m.unidade.nome,
        situacao: m.situacao,
        inicio: m.inicio,
        fim: m.fim,
        valor: reais(valorC),
        desconto: reais(descontoEmCentavos(valorC, Number(m.descontoPct), centavos(m.descontoValor))),
        descontoPct: Number(m.descontoPct),
        descontoValor: reais(centavos(m.descontoValor)),
        descontoMotivo: m.descontoMotivo,
        diaVencimento: m.diaVencimento,
        motivoSaida: m.motivoSaida,
      }
    }),
  }
}

/** Alunos do cadastro para matricular: oito no máximo, para achar quem se está digitando. */
export async function buscarAlunos(sessao: Sessao, termo: string) {
  exigir(sessao, 'escola.matricular')
  exigir(sessao, 'cliente.ver')
  const t = termo.trim().slice(0, 80)
  if (t.length < 2) return []
  return comoOrg(sessao.orgId, (db) =>
    db.cliente.findMany({
      where: { anonimizadoEm: null, nome: { contains: t, mode: 'insensitive' } },
      orderBy: { nome: 'asc' },
      take: 8,
      select: { id: true, nome: true, nascimento: true },
    }),
  )
}

/** Alunos com matrícula ativa, nas unidades — o número do painel. */
export async function alunosAtivos(sessao: Sessao, unidadeIds: string[]): Promise<number> {
  const lojas = soAsQuePode(sessao, 'escola.ver', unidadeIds)
  if (lojas.length === 0) return 0
  const r = await comoOrg(sessao.orgId, (db) =>
    db.matricula.findMany({ where: { unidadeId: { in: lojas }, situacao: 'ATIVA' }, select: { alunoId: true }, distinct: ['alunoId'] }),
  )
  return r.length
}
