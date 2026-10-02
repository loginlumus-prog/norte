// Mensalidades: a de cada mês nasce sozinha, e receber é dinheiro entrando.
//
// ── quando nasce ─────────────────────────────────────────────
// A do mês corrente e a do próximo, para toda matrícula ATIVA — ao abrir a
// tela de Mensalidades (quem mexe nelas) e na rotina de hora em hora
// (/api/rotinas), para a escola que ninguém abriu no dia 1º. É a regra das
// contas recorrentes (recorrentes.ts): o mês nasce quando chega, e mudar o
// valor da matrícula não obriga a corrigir onze linhas futuras.
//
// ── por que rodar duas vezes não cobra duas vezes ────────────
// Duas garantias, uma em cima da outra. A trava do Postgres por empresa
// (advisory lock) faz a segunda geração esperar a primeira e já encontrar
// tudo escrito; o único (matrícula, mês) no banco é a garantia final — vale
// também para quem grava por fora da trava, e o `skipDuplicates` transforma
// a colisão em "já existia", em vez de erro.
//
// ── a conta de cada mês ──────────────────────────────────────
//   devido = valor − desconto (a bolsa, fotografada no mês)
//   resta  = devido − pago − abono
// Juro e multa de atraso ficam FORA do devido, como no crediário: são o
// atraso, não a mensalidade. E a régua é a mesma de lá:
//   • MULTA uma vez só (% do que restava no primeiro recebimento atrasado).
//     Quem recebeu e dispensou a multa, dispensou: o recebimento seguinte não
//     cobra de novo (`multaCobrada`);
//   • JURO ao mês, proporcional aos dias, contado do vencimento ou do dia até
//     onde já foi cobrado (`jurosAte`) — senão quem paga metade hoje paga de
//     novo, na semana que vem, o juro dos mesmos dias;
//   • quem recebe pode cobrar MENOS do que a conta sugere (cobrança é
//     conversa), nunca mais.
// E a escola não pune o aluno pela dívida: a Lei 9.870/99 (art. 6º) proíbe
// reter documento ou suspender prova por inadimplência. Aqui a dívida é só
// dinheiro — nada no sistema tranca a matrícula de quem está devendo.
//
// ── o desconto de pontualidade ───────────────────────────────
// Opcional (Configurações). Vale para quem paga a mensalidade INTEIRA até o
// vencimento, num recebimento só. Ele abate (`abono`), mas não é dinheiro: o
// DRE conta o que entrou.
//
// ── para onde o dinheiro vai ─────────────────────────────────
//   • em espécie, na gaveta do caixa ABERTO da unidade (sem caixa aberto, é
//     recusado — como a parcela do crediário); o fechamento conta;
//   • no DRE, na linha "Mensalidades" (o que abateu) e em "Outras receitas"
//     (juro e multa) — ver `calcularDRE` em financeiro.ts, que é a mesma conta
//     do mês, do gráfico e do fechamento;
//   • no cartão e no Pix, com a taxa que valia no dia (`taxaPct`), que o DRE
//     desconta em "Financeiras" (ver taxas.ts).
//
// Puro em cima (datas, contas, situação), banco embaixo.

import type { FormaPagamento, Plano } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, soAsQuePode, textoDaBusca, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { colunaDoDia, diaDaColuna, diaEmSP, diasEntre, inicioDoDiaEmSP } from './dia'
import { diasDeJuros, jurosDeAtraso } from './crediario'
import { mesSeguinte, mesValido, vencimentoNoMes } from './recorrentes'
import { travarCaixaAberto } from './caixa'
import { lerTaxas, taxaDe } from './taxas'
import { moduloLigado } from './modulos'
import { planoLibera } from './planos'
import { registrarErro } from './registro'

// ─────────────────────────────────────────────────────────────
// A REGRA DA EMPRESA
// ─────────────────────────────────────────────────────────────

/** Tetos da multa e do juro — ver o cabeçalho de `Org.mensalidadeMultaPct`. */
export const MULTA_MAXIMA = 2
export const JUROS_MAXIMO = 1
export const PONTUALIDADE_MAXIMA = 20

export type RegraMensalidade = { multaPct: number; jurosMes: number; pontualidadePct: number }

/** A Escola existe nesta empresa? Módulo ligado E plano que tem. */
export function escolaLigada(org: { plano: Plano; modulos: string[] } | null | undefined): boolean {
  return !!org && moduloLigado(org, 'escola') && planoLibera(org.plano, 'escola')
}

export const ESCOLA_DESLIGADA = 'Alunos e mensalidades está desligado nesta empresa. Quem responde pela empresa liga em Configurações.'

// ─────────────────────────────────────────────────────────────
// AS CONTAS (puras)
// ─────────────────────────────────────────────────────────────

/**
 * A bolsa em centavos: o porcento sobre o valor, mais o valor fixo — nunca
 * mais do que a mensalidade inteira. Porcento arredonda para o mais perto
 * (como a calculadora de quem conferir).
 */
export function descontoEmCentavos(valorC: number, pct: number, fixoC: number): number {
  if (valorC <= 0) return 0
  const doPct = pct > 0 ? Math.round((valorC * Math.min(pct, 100)) / 100) : 0
  return Math.min(valorC, doPct + Math.max(0, fixoC))
}

/**
 * O vencimento da mensalidade de `mes` para quem vence no dia `dia`.
 *
 * No mês em que a matrícula começa, a mensalidade não nasce vencida: quem se
 * matricula dia 25 numa turma que vence dia 10 paga a primeira no dia em que
 * se matriculou, e não "com 15 dias de atraso".
 */
export function vencimentoDaMensalidade(dia: number, mes: string, inicio: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number]
  const venc = diaDaColuna(vencimentoNoMes(dia, a, m))
  return inicio.slice(0, 7) === mes && venc < inicio ? inicio : venc
}

export type MatriculaParaGerar = {
  id: string
  situacao: string
  /** "AAAA-MM-DD" */
  inicio: string
  fim: string | null
  diaVencimento: number
  /**
   * "AAAA-MM-DD" do dia em que a SAÍDA foi registrada (cancelou, concluiu).
   * Só importa para a matrícula que saiu com data de saída no futuro.
   */
  saida?: string | null
}

/**
 * Quais matrículas precisam da mensalidade de `mes`, e com que vencimento.
 *
 * As ATIVAS; só se o mês cai dentro da matrícula (do mês do início até o
 * mês do fim); e só as que ainda não têm a do mês — é isto que torna a
 * geração idempotente, e o único do banco é a garantia final.
 *
 * E a cancelada (ou concluída) com data de saída no FUTURO, até o mês dessa
 * data: quem avisa em outubro que sai em 15/12 estuda até dezembro, e
 * dezembro se paga. Antes a geração parava no dia do aviso, e dezembro nunca
 * nascia. Só os meses DEPOIS do mês em que a saída foi registrada — os de
 * antes a matrícula ativa já gerou, e um mês dispensado à mão não volta.
 */
export function aGerarNoMes(
  matriculas: MatriculaParaGerar[],
  jaGeradas: ReadonlySet<string>,
  mes: string,
): { matriculaId: string; vencimento: string }[] {
  if (!mesValido(mes)) return []
  const saida: { matriculaId: string; vencimento: string }[] = []
  for (const m of matriculas) {
    const saiuDepois =
      (m.situacao === 'CANCELADA' || m.situacao === 'CONCLUIDA') && !!m.fim && !!m.saida && m.saida.slice(0, 7) < mes
    if (m.situacao !== 'ATIVA' && !saiuDepois) continue
    if (jaGeradas.has(`${m.id}|${mes}`)) continue
    if (m.inicio.slice(0, 7) > mes) continue
    if (m.fim && m.fim.slice(0, 7) < mes) continue
    saida.push({ matriculaId: m.id, vencimento: vencimentoDaMensalidade(m.diaVencimento, mes, m.inicio) })
  }
  return saida
}

/** Os meses que a geração cobre: o de agora (em São Paulo) e o próximo. */
export function mesesDaGeracao(agora = new Date()): string[] {
  const atual = diaEmSP(agora).slice(0, 7)
  return [atual, mesSeguinte(atual)]
}

export type ContaDaMensalidade = {
  devidoC: number
  pagoC: number
  abonoC: number
  restaC: number
}

export function contaDaMensalidade(m: { valor: unknown; desconto: unknown; pago: unknown; abono: unknown }): ContaDaMensalidade {
  const devidoC = Math.max(0, centavos(m.valor as number) - centavos(m.desconto as number))
  const pagoC = centavos(m.pago as number)
  const abonoC = centavos(m.abono as number)
  return { devidoC, pagoC, abonoC, restaC: Math.max(0, devidoC - pagoC - abonoC) }
}

export type Encargos = {
  /** Dias de atraso (o dia do vencimento ainda não é atraso). */
  dias: number
  /** Os dias que o juro de hoje cobre — sem os que já pagaram juro antes. */
  diasJuros: number
  jurosC: number
  multaC: number
}

/**
 * Juro e multa sugeridos para receber HOJE, sobre o que resta.
 *
 * A multa sai uma vez só: `multaCobrada` diz que um recebimento atrasado
 * anterior já resolveu (cobrou ou dispensou). Para baixo nos dois — a sobra
 * fica com quem paga.
 */
export function encargosDeHoje(
  m: { restaC: number; vencimento: Date; jurosAte: Date | null; multaCobrada: boolean },
  regra: Pick<RegraMensalidade, 'multaPct' | 'jurosMes'>,
  agora: Date,
): Encargos {
  if (m.restaC <= 0) return { dias: 0, diasJuros: 0, jurosC: 0, multaC: 0 }
  const dias = Math.max(0, diasEntre(diaDaColuna(m.vencimento), diaEmSP(agora)))
  if (dias === 0) return { dias: 0, diasJuros: 0, jurosC: 0, multaC: 0 }
  const diasJuros = diasDeJuros(m.vencimento, m.jurosAte, agora)
  const jurosC = jurosDeAtraso(m.restaC, diasJuros, Math.min(regra.jurosMes, JUROS_MAXIMO))
  const multaC = m.multaCobrada ? 0 : Math.floor((m.restaC * Math.min(regra.multaPct, MULTA_MAXIMA)) / 100)
  return { dias, diasJuros, jurosC, multaC }
}

/**
 * O desconto de pontualidade possível HOJE: a regra da empresa sobre o
 * devido, para quem ainda não pagou nada e está no dia do vencimento ou
 * antes. Zero em qualquer outro caso.
 */
export function abonoDeHoje(
  m: { devidoC: number; pagoC: number; abonoC: number; vencimento: Date },
  pct: number,
  agora: Date,
): number {
  if (pct <= 0 || m.pagoC > 0 || m.abonoC > 0 || m.devidoC <= 0) return 0
  if (diaEmSP(agora) > diaDaColuna(m.vencimento)) return 0
  return Math.floor((m.devidoC * Math.min(pct, PONTUALIDADE_MAXIMA)) / 100)
}

export type SituacaoMensalidade = 'paga' | 'atrasada' | 'vence_hoje' | 'a_receber' | 'cancelada'

export function situacaoDaMensalidade(
  m: { quitadaEm: Date | null; canceladaEm: Date | null; vencimento: Date; restaC: number },
  agora: Date,
): SituacaoMensalidade {
  if (m.canceladaEm) return 'cancelada'
  if (m.quitadaEm || m.restaC <= 0) return 'paga'
  const v = diaDaColuna(m.vencimento)
  const hoje = diaEmSP(agora)
  return v < hoje ? 'atrasada' : v === hoje ? 'vence_hoje' : 'a_receber'
}

export const ROTULO_SITUACAO: Record<SituacaoMensalidade, string> = {
  paga: 'paga',
  atrasada: 'em atraso',
  vence_hoje: 'vence hoje',
  a_receber: 'a receber',
  cancelada: 'dispensada',
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-09" → "setembro de 2026"; `curto` → "set/2026". */
export function mesPorExtenso(mes: string, curto = false): string {
  const [a, m] = mes.split('-').map(Number) as [number, number]
  const nome = MESES[m - 1] ?? mes
  return curto ? `${nome.slice(0, 3)}/${a}` : `${nome} de ${a}`
}

/** "2026-09" → "2026-08". */
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7)
}

// ─────────────────────────────────────────────────────────────
// BANCO — a regra da empresa
// ─────────────────────────────────────────────────────────────

async function lerRegra(db: BancoDaOrg, orgId: string): Promise<RegraMensalidade & { plano: Plano; modulos: string[] }> {
  const o = await db.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { plano: true, modulos: true, mensalidadeMultaPct: true, mensalidadeJurosMes: true, mensalidadePontualidadePct: true },
  })
  return {
    plano: o.plano,
    modulos: o.modulos,
    multaPct: Number(o.mensalidadeMultaPct),
    jurosMes: Number(o.mensalidadeJurosMes),
    pontualidadePct: Number(o.mensalidadePontualidadePct),
  }
}

export async function regraDaEmpresa(sessao: Sessao): Promise<RegraMensalidade> {
  const r = await comoOrg(sessao.orgId, (db) => lerRegra(db, sessao.orgId))
  return { multaPct: r.multaPct, jurosMes: r.jurosMes, pontualidadePct: r.pontualidadePct }
}

export type ConfigMensalidade = RegraMensalidade & { avisoAtivo: boolean; avisoDias: number; atrasoDias: number }

export async function configMensalidade(sessao: Sessao): Promise<ConfigMensalidade> {
  const o = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: {
        mensalidadeMultaPct: true, mensalidadeJurosMes: true, mensalidadePontualidadePct: true,
        avisoMensalidadeAtivo: true, avisoMensalidadeDias: true, avisoAtrasoDias: true,
      },
    }),
  )
  return {
    multaPct: Number(o.mensalidadeMultaPct),
    jurosMes: Number(o.mensalidadeJurosMes),
    pontualidadePct: Number(o.mensalidadePontualidadePct),
    avisoAtivo: o.avisoMensalidadeAtivo,
    avisoDias: o.avisoMensalidadeDias,
    atrasoDias: o.avisoAtrasoDias,
  }
}

/** Os números vêm do formulário: cada um é limitado ao que a lei e a tela aceitam. */
export function limparConfig(c: Partial<ConfigMensalidade>): ConfigMensalidade {
  const num = (v: unknown, min: number, max: number, padrao: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : padrao
  }
  const inteiro = (v: unknown, min: number, max: number, padrao: number) => Math.round(num(v, min, max, padrao))
  return {
    multaPct: Math.round(num(c.multaPct, 0, MULTA_MAXIMA, 2) * 100) / 100,
    jurosMes: Math.round(num(c.jurosMes, 0, JUROS_MAXIMO, 1) * 100) / 100,
    pontualidadePct: Math.round(num(c.pontualidadePct, 0, PONTUALIDADE_MAXIMA, 0) * 100) / 100,
    avisoAtivo: c.avisoAtivo === true,
    avisoDias: inteiro(c.avisoDias, 1, 10, 3),
    atrasoDias: inteiro(c.atrasoDias, 0, 30, 5),
  }
}

export async function salvarConfigMensalidade(sessao: Sessao, pedido: Partial<ConfigMensalidade>): Promise<ConfigMensalidade> {
  exigir(sessao, 'empresa.configurar')
  const c = limparConfig(pedido)
  await comoOrg(sessao.orgId, async (db) => {
    await db.org.update({
      where: { id: sessao.orgId },
      data: {
        mensalidadeMultaPct: c.multaPct,
        mensalidadeJurosMes: c.jurosMes,
        mensalidadePontualidadePct: c.pontualidadePct,
        avisoMensalidadeAtivo: c.avisoAtivo,
        avisoMensalidadeDias: c.avisoDias,
        avisoAtrasoDias: c.atrasoDias,
      },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'empresa.configurou', alvoTipo: 'empresa', alvoId: sessao.orgId, alvoNome: 'mensalidades',
        depois: c,
      },
    })
  })
  return c
}

// ─────────────────────────────────────────────────────────────
// BANCO — gerar
// ─────────────────────────────────────────────────────────────

/**
 * Escreve, dentro de uma transação que já existe, as mensalidades que faltam
 * nos `meses`. `matriculaId` limita a uma matrícula (a que acabou de nascer).
 * Devolve quantas escreveu.
 */
export async function gerarNaTransacao(
  db: BancoDaOrg,
  orgId: string,
  meses: string[],
  quem: { usuarioId: string | null; nome: string },
  matriculaId?: string,
): Promise<number> {
  // Uma geração por empresa de cada vez — ver o cabeçalho.
  await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`mensalidades:${orgId}`}))`
  const validos = meses.filter(mesValido)
  if (validos.length === 0) return 0

  // A ativa, e a que saiu com data de saída num dos meses pedidos ou depois
  // (ver `aGerarNoMes`).
  const primeiroMes = [...validos].sort()[0]!
  const matriculas = await db.matricula.findMany({
    where: {
      OR: [
        { situacao: 'ATIVA' },
        { situacao: { in: ['CANCELADA', 'CONCLUIDA'] }, fim: { gte: colunaDoDia(`${primeiroMes}-01`) } },
      ],
      ...(matriculaId ? { id: matriculaId } : {}),
    },
    select: {
      id: true, alunoId: true, unidadeId: true, situacao: true, inicio: true, fim: true, diaVencimento: true,
      valor: true, descontoPct: true, descontoValor: true, saidaEm: true,
    },
  })
  if (matriculas.length === 0) return 0

  const ja = await db.mensalidade.findMany({
    where: { matriculaId: { in: matriculas.map((m) => m.id) }, mes: { in: validos } },
    select: { matriculaId: true, mes: true },
  })
  const jaGeradas = new Set(ja.map((j) => `${j.matriculaId}|${j.mes}`))
  const porId = new Map(matriculas.map((m) => [m.id, m]))
  const paraGerar = matriculas.map((m) => ({
    id: m.id,
    situacao: m.situacao,
    inicio: diaDaColuna(m.inicio),
    fim: m.fim ? diaDaColuna(m.fim) : null,
    diaVencimento: m.diaVencimento,
    saida: m.saidaEm ? diaEmSP(m.saidaEm) : null,
  }))

  const linhas: {
    orgId: string; matriculaId: string; alunoId: string; unidadeId: string; mes: string
    vencimento: Date; valor: number; desconto: number
  }[] = []
  for (const mes of validos) {
    for (const f of aGerarNoMes(paraGerar, jaGeradas, mes)) {
      const m = porId.get(f.matriculaId)!
      const valorC = centavos(m.valor)
      linhas.push({
        orgId,
        matriculaId: m.id,
        alunoId: m.alunoId,
        unidadeId: m.unidadeId,
        mes,
        vencimento: colunaDoDia(f.vencimento),
        valor: reais(valorC),
        desconto: reais(descontoEmCentavos(valorC, Number(m.descontoPct), centavos(m.descontoValor))),
      })
    }
  }
  if (linhas.length === 0) return 0

  const r = await db.mensalidade.createMany({ data: linhas, skipDuplicates: true })
  if (r.count > 0) {
    await db.auditoria.create({
      data: {
        orgId,
        usuarioId: quem.usuarioId,
        quem: quem.nome,
        autor: 'SISTEMA',
        acao: 'mensalidade.gerou',
        alvoTipo: 'mes',
        alvoId: validos.join(','),
        alvoNome: `${r.count} ${r.count === 1 ? 'mensalidade' : 'mensalidades'}`,
        valor: reais(linhas.reduce((s, l) => s + centavos(l.valor) - centavos(l.desconto), 0)),
        depois: { quantas: r.count, meses: validos },
      },
    })
  }
  return r.count
}

/**
 * A geração de uma empresa, sem sessão — a rotina de hora em hora. Confere o
 * módulo dentro da empresa: desligada, não escreve nada.
 */
export async function gerarMensalidadesDaEmpresa(orgId: string, agora = new Date()): Promise<number> {
  return comoOrg(orgId, async (db) => {
    const org = await db.org.findUnique({ where: { id: orgId }, select: { plano: true, modulos: true, situacao: true } })
    if (!escolaLigada(org) || org!.situacao === 'SUSPENSA' || org!.situacao === 'CANCELADA') return 0
    return gerarNaTransacao(db, orgId, mesesDaGeracao(agora), { usuarioId: null, nome: 'Mensalidades do mês' })
  })
}

/**
 * O que a tela chama ao abrir. Só para quem MEXE nas mensalidades — quem só
 * lê (o contador) não escreve nada ao abrir a tela. Nunca derruba a tela:
 * gerar é conveniência, e a rotina de hora em hora gera de qualquer jeito.
 */
export async function garantirMensalidades(sessao: Sessao, agora = new Date()): Promise<number> {
  if (!pode(sessao, 'escola.matricular') && !pode(sessao, 'mensalidade.receber') && !pode(sessao, 'mensalidade.ajustar')) return 0
  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { plano: true, modulos: true } })
      if (!escolaLigada(org)) return 0
      return gerarNaTransacao(db, sessao.orgId, mesesDaGeracao(agora), { usuarioId: sessao.usuarioId, nome: sessao.nome })
    })
  } catch (e) {
    registrarErro('mensalidades.gerar', e)
    return 0
  }
}

// ─────────────────────────────────────────────────────────────
// BANCO — ler
// ─────────────────────────────────────────────────────────────

/** Das lojas pedidas, as que a pessoa alcança; 'todas' vira a lista pedida. */
function lojas(sessao: Sessao, pedidas: string[], cap: 'mensalidade.ver' | 'mensalidade.receber' = 'mensalidade.ver') {
  return soAsQuePode(sessao, cap, pedidas)
}

export type MensalidadeNaLista = {
  id: string
  alunoId: string
  aluno: string
  responsavel: string | null
  telefoneResponsavel: string | null
  turmaId: string
  turma: string
  unidadeId: string
  unidade: string
  mes: string
  vencimento: Date
  valor: number
  desconto: number
  devido: number
  pago: number
  abono: number
  juros: number
  multa: number
  resta: number
  situacao: SituacaoMensalidade
  diasAtraso: number
  diasJuros: number
  /** Sugeridos para receber hoje, com a regra da empresa. */
  jurosHoje: number
  multaHoje: number
  abonoHoje: number
  quitadaEm: Date | null
  motivoCancelamento: string | null
  /** Tem recebimento: não se dispensa mais. */
  temPagamento: boolean
}

export type FiltroMensalidades = {
  unidadeIds: string[]
  /** "AAAA-MM". Ignorado quando `situacao` é 'atrasada' — o atraso não tem mês. */
  mes?: string | null
  situacao?: SituacaoMensalidade | 'abertas' | null
  turmaId?: string | null
  alunoId?: string | null
  /** Nome do aluno ou do responsável. */
  q?: string | null
}

const SELECT_MENSALIDADE = {
  id: true, alunoId: true, unidadeId: true, mes: true, vencimento: true, valor: true, desconto: true,
  pago: true, abono: true, juros: true, multa: true, multaCobrada: true, jurosAte: true,
  quitadaEm: true, canceladaEm: true, motivoCancelamento: true,
  aluno: { select: { nome: true, responsavel: { select: { nome: true, telefone: true } } } },
  matricula: { select: { turmaId: true, turma: { select: { nome: true } } } },
  unidade: { select: { nome: true } },
  _count: { select: { pagamentos: true } },
} as const

type LinhaDoBanco = {
  id: string; alunoId: string; unidadeId: string; mes: string; vencimento: Date
  valor: unknown; desconto: unknown; pago: unknown; abono: unknown; juros: unknown; multa: unknown
  multaCobrada: boolean; jurosAte: Date | null; quitadaEm: Date | null; canceladaEm: Date | null
  motivoCancelamento: string | null
  aluno: { nome: string; responsavel: { nome: string; telefone: string | null } | null }
  matricula: { turmaId: string; turma: { nome: string } }
  unidade: { nome: string }
  _count: { pagamentos: number }
}

function naLista(m: LinhaDoBanco, regra: RegraMensalidade, agora: Date): MensalidadeNaLista {
  const c = contaDaMensalidade(m)
  const sit = situacaoDaMensalidade({ ...m, restaC: c.restaC }, agora)
  const aberta = sit !== 'paga' && sit !== 'cancelada'
  const e = aberta ? encargosDeHoje({ restaC: c.restaC, vencimento: m.vencimento, jurosAte: m.jurosAte, multaCobrada: m.multaCobrada }, regra, agora) : null
  const abono = aberta ? abonoDeHoje({ ...c, vencimento: m.vencimento }, regra.pontualidadePct, agora) : 0
  return {
    id: m.id,
    alunoId: m.alunoId,
    aluno: m.aluno.nome,
    responsavel: m.aluno.responsavel?.nome ?? null,
    telefoneResponsavel: m.aluno.responsavel?.telefone ?? null,
    turmaId: m.matricula.turmaId,
    turma: m.matricula.turma.nome,
    unidadeId: m.unidadeId,
    unidade: m.unidade.nome,
    mes: m.mes,
    vencimento: m.vencimento,
    valor: reais(centavos(m.valor as number)),
    desconto: reais(centavos(m.desconto as number)),
    devido: reais(c.devidoC),
    pago: reais(c.pagoC),
    abono: reais(c.abonoC),
    juros: reais(centavos(m.juros as number)),
    multa: reais(centavos(m.multa as number)),
    resta: reais(c.restaC),
    situacao: sit,
    diasAtraso: e?.dias ?? 0,
    diasJuros: e?.diasJuros ?? 0,
    jurosHoje: reais(e?.jurosC ?? 0),
    multaHoje: reais(e?.multaC ?? 0),
    abonoHoje: reais(abono),
    quitadaEm: m.quitadaEm,
    motivoCancelamento: m.motivoCancelamento,
    temPagamento: m._count.pagamentos > 0,
  }
}

export async function listarMensalidades(sessao: Sessao, f: FiltroMensalidades, agora = new Date()): Promise<MensalidadeNaLista[]> {
  exigir(sessao, 'mensalidade.ver')
  const permitidas = lojas(sessao, f.unidadeIds)
  if (permitidas.length === 0) return []
  const q = textoDaBusca(f.q)
  const hoje = colunaDoDia(diaEmSP(agora))
  const atrasadas = f.situacao === 'atrasada'

  return comoOrg(sessao.orgId, async (db) => {
    const regra = await lerRegra(db, sessao.orgId)
    const linhas = await db.mensalidade.findMany({
      where: {
        unidadeId: { in: permitidas },
        ...(atrasadas
          ? { quitadaEm: null, canceladaEm: null, vencimento: { lt: hoje } }
          : f.mes && mesValido(f.mes)
            ? { mes: f.mes }
            : {}),
        ...(f.situacao === 'paga' ? { quitadaEm: { not: null } } : {}),
        ...(f.situacao === 'cancelada' ? { canceladaEm: { not: null } } : {}),
        ...(f.situacao === 'abertas' || f.situacao === 'a_receber' ? { quitadaEm: null, canceladaEm: null } : {}),
        ...(f.turmaId ? { matricula: { turmaId: f.turmaId } } : {}),
        ...(f.alunoId ? { alunoId: f.alunoId } : {}),
        ...(q
          ? {
              OR: [
                { aluno: { nome: { contains: q, mode: 'insensitive' as const } } },
                { aluno: { responsavel: { nome: { contains: q, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ vencimento: 'asc' }, { aluno: { nome: 'asc' } }],
      take: 1000,
      select: SELECT_MENSALIDADE,
    })
    const saida = linhas.map((m) => naLista(m as unknown as LinhaDoBanco, regra, agora))
    // "A receber" na tela é o que ainda não venceu (o que venceu tem o filtro dele).
    return f.situacao === 'a_receber' ? saida.filter((m) => m.situacao === 'a_receber' || m.situacao === 'vence_hoje') : saida
  })
}

/** Uma mensalidade, para o recibo. Nula se não existe ou é de loja que a pessoa não vê. */
export async function acharMensalidade(sessao: Sessao, id: string, agora = new Date()) {
  exigir(sessao, 'mensalidade.ver')
  const r = await comoOrg(sessao.orgId, async (db) => {
    const regra = await lerRegra(db, sessao.orgId)
    const m = await db.mensalidade.findUnique({
      where: { id },
      select: {
        ...SELECT_MENSALIDADE,
        matricula: { select: { turmaId: true, turma: { select: { nome: true, curso: true } } } },
        aluno: { select: { nome: true, responsavel: { select: { nome: true, telefone: true, documento: true, parentesco: true } } } },
        unidade: { select: { nome: true, documento: true, endereco: true, numero: true, bairro: true, cidade: true, estado: true, telefone: true } },
        pagamentos: {
          orderBy: { criadoEm: 'asc' },
          select: { id: true, forma: true, valor: true, juros: true, multa: true, abono: true, quem: true, criadoEm: true },
        },
      },
    })
    return m ? { m, regra } : null
  })
  if (!r || !pode(sessao, 'mensalidade.ver', r.m.unidadeId)) return null
  const { m, regra } = r
  return {
    ...naLista(m as unknown as LinhaDoBanco, regra, agora),
    curso: m.matricula.turma.curso,
    responsavelDoc: m.aluno.responsavel?.documento ?? null,
    parentesco: m.aluno.responsavel?.parentesco ?? null,
    loja: m.unidade,
    pagamentos: m.pagamentos.map((p) => ({
      id: p.id,
      forma: p.forma,
      valor: reais(centavos(p.valor)),
      juros: reais(centavos(p.juros)),
      multa: reais(centavos(p.multa)),
      abono: reais(centavos(p.abono)),
      quem: p.quem,
      criadoEm: p.criadoEm,
    })),
  }
}

export type ResumoMensalidades = {
  mes: string
  /** As do mês (sem as dispensadas). */
  doMes: { quantas: number; devido: number; recebido: number; aReceber: number; pagas: number }
  /** Tudo que venceu e não foi pago, de qualquer mês. */
  atraso: { quantas: number; total: number; alunos: number }
  /** Dinheiro que ENTROU (por data do recebimento), com juro e multa. */
  recebidoHoje: number
  recebidoNoMes: number
  vencemHoje: { quantas: number; total: number }
  porTurma: { turmaId: string; turma: string; devido: number; recebido: number; aberto: number; atrasadas: number }[]
}

/** Os números de cima da tela, do painel e do relatório da manhã. */
export async function resumoMensalidades(sessao: Sessao, unidadeIds: string[], mes: string, agora = new Date()): Promise<ResumoMensalidades> {
  exigir(sessao, 'mensalidade.ver')
  const permitidas = lojas(sessao, unidadeIds)
  const vazio: ResumoMensalidades = {
    mes,
    doMes: { quantas: 0, devido: 0, recebido: 0, aReceber: 0, pagas: 0 },
    atraso: { quantas: 0, total: 0, alunos: 0 },
    recebidoHoje: 0,
    recebidoNoMes: 0,
    vencemHoje: { quantas: 0, total: 0 },
    porTurma: [],
  }
  if (permitidas.length === 0 || !mesValido(mes)) return vazio
  const hoje = diaEmSP(agora)
  const inicioHoje = inicioDoDiaEmSP(hoje)
  const inicioMes = inicioDoDiaEmSP(`${mes}-01`)
  const fimMes = inicioDoDiaEmSP(`${mesSeguinte(mes)}-01`)

  return comoOrg(sessao.orgId, async (db) => {
    const doMes = await db.mensalidade.findMany({
      where: { unidadeId: { in: permitidas }, mes, canceladaEm: null },
      select: { valor: true, desconto: true, pago: true, abono: true, quitadaEm: true, vencimento: true, matricula: { select: { turmaId: true, turma: { select: { nome: true } } } } },
    })
    const abertas = await db.mensalidade.findMany({
      where: { unidadeId: { in: permitidas }, quitadaEm: null, canceladaEm: null, vencimento: { lte: colunaDoDia(hoje) } },
      select: { alunoId: true, vencimento: true, valor: true, desconto: true, pago: true, abono: true, matricula: { select: { turmaId: true } } },
    })
    const entrou = await db.$queryRaw<{ hoje: string | null; mes: string | null }[]>`
      select sum(valor) filter (where criado_em >= ${inicioHoje}) as hoje,
             sum(valor) filter (where criado_em >= ${inicioMes} and criado_em < ${fimMes}) as mes
        from pagamentos_mensalidade
       where unidade_id = any(${permitidas}) and criado_em >= ${inicioHoje < inicioMes ? inicioHoje : inicioMes}
    `

    const r = structuredClone(vazio)
    const turmas = new Map<string, ResumoMensalidades['porTurma'][number]>()
    for (const m of doMes) {
      const c = contaDaMensalidade(m)
      r.doMes.quantas++
      r.doMes.devido += c.devidoC
      r.doMes.recebido += c.pagoC
      r.doMes.aReceber += c.restaC
      if (m.quitadaEm || c.restaC <= 0) r.doMes.pagas++
      const t = turmas.get(m.matricula.turmaId) ?? { turmaId: m.matricula.turmaId, turma: m.matricula.turma.nome, devido: 0, recebido: 0, aberto: 0, atrasadas: 0 }
      t.devido += c.devidoC
      t.recebido += c.pagoC
      t.aberto += c.restaC
      turmas.set(m.matricula.turmaId, t)
    }
    const alunos = new Set<string>()
    for (const m of abertas) {
      const c = contaDaMensalidade(m)
      if (c.restaC <= 0) continue
      const v = diaDaColuna(m.vencimento)
      if (v === hoje) {
        r.vencemHoje.quantas++
        r.vencemHoje.total += c.restaC
        continue
      }
      r.atraso.quantas++
      r.atraso.total += c.restaC
      alunos.add(m.alunoId)
      const t = turmas.get(m.matricula.turmaId)
      if (t) t.atrasadas++
    }
    r.atraso.alunos = alunos.size
    const e = entrou[0]
    return {
      mes,
      doMes: {
        quantas: r.doMes.quantas,
        devido: reais(r.doMes.devido),
        recebido: reais(r.doMes.recebido),
        aReceber: reais(r.doMes.aReceber),
        pagas: r.doMes.pagas,
      },
      atraso: { quantas: r.atraso.quantas, total: reais(r.atraso.total), alunos: r.atraso.alunos },
      recebidoHoje: reais(centavos(e?.hoje ?? 0)),
      recebidoNoMes: reais(centavos(e?.mes ?? 0)),
      vencemHoje: { quantas: r.vencemHoje.quantas, total: reais(r.vencemHoje.total) },
      porTurma: [...turmas.values()]
        .map((t) => ({ ...t, devido: reais(t.devido), recebido: reais(t.recebido), aberto: reais(t.aberto) }))
        .sort((a, b) => a.turma.localeCompare(b.turma, 'pt-BR')),
    }
  })
}

// ─────────────────────────────────────────────────────────────
// BANCO — receber
// ─────────────────────────────────────────────────────────────

export const FORMAS_DE_MENSALIDADE: FormaPagamento[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'TRANSFERENCIA']

export type PedidoDeRecebimento = {
  mensalidadeId: string
  /** O total que entrou. */
  valor: number
  /** A parte do total que é juro e multa (quem recebe pode cobrar menos). */
  juros: number
  multa: number
  forma: FormaPagamento
  /** Pedir o desconto de pontualidade (só vale quem paga tudo até o vencimento). */
  pontualidade?: boolean
}

export type Recebido =
  | { ok: true; pagamentoId: string; restante: number; quitada: boolean; juros: number; multa: number; abono: number }
  | {
      ok: false
      motivo:
        | 'nao_achada' | 'desligada' | 'ja_quitada' | 'cancelada' | 'valor_invalido' | 'passa_do_resto'
        | 'caixa_fechado' | 'mudou' | 'forma_invalida' | 'juros_acima' | 'multa_acima' | 'sem_pontualidade'
    }

export const RECUSA_RECEBIMENTO: Record<Exclude<Recebido, { ok: true }>['motivo'], string> = {
  nao_achada: 'Mensalidade não encontrada.',
  desligada: ESCOLA_DESLIGADA,
  ja_quitada: 'Esta mensalidade já estava paga.',
  cancelada: 'Esta mensalidade foi dispensada: não se recebe.',
  valor_invalido: 'O valor recebido precisa ser maior que o juro e a multa.',
  passa_do_resto: 'Está recebendo mais do que a mensalidade deve.',
  caixa_fechado: 'Para receber em dinheiro o caixa desta unidade precisa estar aberto. Abra o caixa no Balcão — ou escolha como pagou (Pix, cartão, transferência).',
  mudou: 'Esta mensalidade mudou agora (outro recebimento). Nada foi recebido: confira o valor e receba de novo.',
  forma_invalida: 'Escolha como recebeu.',
  juros_acima: 'O juro passa do que a regra da escola cobra hoje. Dá para cobrar menos, nunca mais.',
  multa_acima: 'A multa passa do que a regra da escola cobra (e ela é uma vez só). Dá para cobrar menos, nunca mais.',
  sem_pontualidade: 'O desconto de pontualidade vale só para quem paga a mensalidade inteira até o vencimento.',
}

/**
 * Recebe (parte de) uma mensalidade.
 *
 * O mesmo desenho do crediário: a linha da mensalidade é gravada ANTES do
 * pagamento, e só se o `pago` e o `abono` ainda forem os que foram lidos — o
 * clique duplo (ou duas pessoas na secretaria) não recebe duas vezes nem abate
 * uma vez só com dois pagamentos. Em dinheiro, o turno fica preso até o fim
 * (`travarCaixaAberto`): o dinheiro não cai num caixa que outro tablet está
 * fechando neste segundo.
 */
export async function receberMensalidade(sessao: Sessao, p: PedidoDeRecebimento, agora = new Date()): Promise<Recebido> {
  if (!FORMAS_DE_MENSALIDADE.includes(p.forma)) return { ok: false, motivo: 'forma_invalida' }
  if (![p.valor, p.juros, p.multa].every(Number.isFinite)) return { ok: false, motivo: 'valor_invalido' }
  const valorC = centavos(p.valor)
  const jurosC = Math.max(0, centavos(p.juros))
  const multaC = Math.max(0, centavos(p.multa))
  const principalC = valorC - jurosC - multaC
  if (!(valorC > 0) || principalC <= 0) return { ok: false, motivo: 'valor_invalido' }

  return comoOrg(sessao.orgId, async (db) => {
    const regra = await lerRegra(db, sessao.orgId)
    if (!escolaLigada(regra)) return { ok: false as const, motivo: 'desligada' as const }

    const m = await db.mensalidade.findUnique({
      where: { id: p.mensalidadeId },
      select: {
        id: true, unidadeId: true, alunoId: true, mes: true, vencimento: true, valor: true, desconto: true,
        pago: true, abono: true, multaCobrada: true, jurosAte: true, quitadaEm: true, canceladaEm: true,
        aluno: { select: { nome: true } },
        matricula: { select: { turma: { select: { nome: true } } } },
      },
    })
    if (!m) return { ok: false as const, motivo: 'nao_achada' as const }
    exigir(sessao, 'mensalidade.receber', m.unidadeId)
    if (m.canceladaEm) return { ok: false as const, motivo: 'cancelada' as const }
    if (m.quitadaEm) return { ok: false as const, motivo: 'ja_quitada' as const }

    const c = contaDaMensalidade(m)
    if (c.restaC <= 0) return { ok: false as const, motivo: 'ja_quitada' as const }
    const e = encargosDeHoje({ restaC: c.restaC, vencimento: m.vencimento, jurosAte: m.jurosAte, multaCobrada: m.multaCobrada }, regra, agora)
    if (jurosC > e.jurosC) return { ok: false as const, motivo: 'juros_acima' as const }
    if (multaC > e.multaC) return { ok: false as const, motivo: 'multa_acima' as const }

    let abonoC = 0
    if (p.pontualidade) {
      abonoC = abonoDeHoje({ ...c, vencimento: m.vencimento }, regra.pontualidadePct, agora)
      // O desconto é para quem paga TUDO, até o vencimento, de uma vez.
      if (abonoC <= 0 || principalC + abonoC !== c.restaC) return { ok: false as const, motivo: 'sem_pontualidade' as const }
    }
    if (principalC + abonoC > c.restaC) return { ok: false as const, motivo: 'passa_do_resto' as const }

    let caixaId: string | null = null
    if (p.forma === 'DINHEIRO') {
      caixaId = await travarCaixaAberto(db, m.unidadeId)
      if (!caixaId) return { ok: false as const, motivo: 'caixa_fechado' as const }
    }
    const taxaPct = p.forma === 'PIX' || p.forma === 'DEBITO' || p.forma === 'CREDITO' ? taxaDe(await lerTaxas(db), p.forma, 1) : null

    const novoPagoC = c.pagoC + principalC
    const novoAbonoC = c.abonoC + abonoC
    const quitada = novoPagoC + novoAbonoC >= c.devidoC
    const atrasado = e.dias > 0
    const gravou = await db.mensalidade.updateMany({
      where: { id: m.id, pago: m.pago, abono: m.abono, quitadaEm: null, canceladaEm: null },
      data: {
        pago: reais(novoPagoC),
        abono: reais(novoAbonoC),
        juros: { increment: reais(jurosC) },
        multa: { increment: reais(multaC) },
        // Recebimento atrasado resolve a multa, cobrada ou dispensada: ela é
        // uma vez só. E o juro cobrado hoje cobre o atraso ATÉ hoje.
        ...(atrasado ? { multaCobrada: true } : {}),
        ...(jurosC > 0 ? { jurosAte: colunaDoDia(diaEmSP(agora)) } : {}),
        quitadaEm: quitada ? agora : null,
      },
    })
    if (gravou.count === 0) return { ok: false as const, motivo: 'mudou' as const }

    const pg = await db.pagamentoMensalidade.create({
      data: {
        orgId: sessao.orgId,
        mensalidadeId: m.id,
        unidadeId: m.unidadeId,
        caixaId,
        forma: p.forma,
        valor: reais(valorC),
        juros: reais(jurosC),
        multa: reais(multaC),
        abono: reais(abonoC),
        taxaPct,
        quemId: sessao.usuarioId,
        quem: sessao.nome,
        criadoEm: agora,
      },
      select: { id: true },
    })

    const extras = [
      jurosC > 0 ? `juros ${reais(jurosC).toFixed(2)}` : '',
      multaC > 0 ? `multa ${reais(multaC).toFixed(2)}` : '',
      abonoC > 0 ? `pontualidade −${reais(abonoC).toFixed(2)}` : '',
    ].filter(Boolean)
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: m.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'mensalidade.recebeu',
        alvoTipo: 'cliente',
        alvoId: m.alunoId,
        alvoNome: m.aluno.nome,
        valor: reais(valorC),
        motivo: `mensalidade ${mesPorExtenso(m.mes, true)} · ${m.matricula.turma.nome}${extras.length ? ` · ${extras.join(' · ')}` : ''}${quitada ? ' · paga' : ' · parcial'}`.slice(0, 300),
        depois: { mensalidadeId: m.id, pagamentoId: pg.id, forma: p.forma },
      },
    })

    return {
      ok: true as const,
      pagamentoId: pg.id,
      restante: reais(c.restaC - principalC - abonoC),
      quitada,
      juros: reais(jurosC),
      multa: reais(multaC),
      abono: reais(abonoC),
    }
  })
}

/**
 * Dispensa a mensalidade de um mês (o aluno entrou no fim do mês, a escola
 * perdoou), com motivo. Só a que não recebeu nada: dinheiro que entrou não
 * some com um clique — isso é conversa e lançamento.
 */
export async function dispensarMensalidade(
  sessao: Sessao,
  id: string,
  motivo: string,
  agora = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const m = (motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (m.length < 3) return { ok: false, erro: 'Diga por que a mensalidade está sendo dispensada.' }
  return comoOrg(sessao.orgId, async (db) => {
    const regra = await lerRegra(db, sessao.orgId)
    if (!escolaLigada(regra)) return { ok: false as const, erro: ESCOLA_DESLIGADA }
    const x = await db.mensalidade.findUnique({
      where: { id },
      select: { id: true, unidadeId: true, alunoId: true, mes: true, valor: true, desconto: true, canceladaEm: true, quitadaEm: true, aluno: { select: { nome: true } }, _count: { select: { pagamentos: true } } },
    })
    if (!x) return { ok: false as const, erro: 'Mensalidade não encontrada.' }
    exigir(sessao, 'mensalidade.ajustar', x.unidadeId)
    if (x.canceladaEm) return { ok: false as const, erro: 'Esta mensalidade já estava dispensada.' }
    if (x.quitadaEm || x._count.pagamentos > 0) {
      return { ok: false as const, erro: 'Esta mensalidade já recebeu dinheiro: não se dispensa. O que entrou continua no caixa e no resultado.' }
    }
    const r = await db.mensalidade.updateMany({
      where: { id, canceladaEm: null, quitadaEm: null, pago: 0 },
      data: { canceladaEm: agora, motivoCancelamento: m },
    })
    if (r.count === 0) return { ok: false as const, erro: 'Esta mensalidade mudou agora. Recarregue a tela.' }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: x.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'mensalidade.dispensou', alvoTipo: 'cliente', alvoId: x.alunoId, alvoNome: x.aluno.nome,
        valor: reais(centavos(x.valor) - centavos(x.desconto)),
        motivo: `mensalidade ${mesPorExtenso(x.mes, true)}: ${m}`.slice(0, 300),
        depois: { mensalidadeId: x.id },
      },
    })
    return { ok: true as const }
  })
}

// ─────────────────────────────────────────────────────────────
// BANCO — o carnê
// ─────────────────────────────────────────────────────────────

export type LinhaDoCarne = { mes: string; vencimento: string; turma: string; valor: number; desconto: number; devido: number; gerada: boolean; situacao: SituacaoMensalidade | 'prevista' }

/**
 * O carnê do aluno: as mensalidades de `meses` meses a partir do mês de
 * agora. As que já nasceram vêm do banco (com a situação); as seguintes são
 * PREVISÃO — a mesma conta da geração, sobre a matrícula de hoje. O papel diz
 * isso: valor de mês futuro muda se a matrícula mudar.
 */
export async function carneDoAluno(sessao: Sessao, alunoId: string, meses = 12, agora = new Date()) {
  exigir(sessao, 'mensalidade.ver')
  const visiveis = unidadesQuePodem(sessao, 'mensalidade.ver')
  const r = await comoOrg(sessao.orgId, async (db) => {
    const aluno = await db.cliente.findUnique({
      where: { id: alunoId },
      select: { id: true, nome: true, anonimizadoEm: true, responsavel: { select: { nome: true, documento: true } } },
    })
    if (!aluno) return null
    // Quem não vê matrícula NENHUMA deste aluno (de qualquer situação) não lê
    // o carnê — nem o nome e o documento do responsável. Antes qualquer id de
    // cliente da empresa devolvia o cabeçalho, com o nome, para o Balcão de
    // outra escola.
    const alguma = await db.matricula.count({
      where: { alunoId, ...(visiveis === 'todas' ? {} : { unidadeId: { in: visiveis } }) },
    })
    if (alguma === 0) return null
    const matriculas = await db.matricula.findMany({
      where: {
        alunoId,
        // A ativa, e a que avisou a saída para um dia que ainda não chegou:
        // ela ainda tem meses a pagar (ver `aGerarNoMes`).
        OR: [
          { situacao: 'ATIVA' },
          { situacao: { in: ['CANCELADA', 'CONCLUIDA'] }, fim: { gte: colunaDoDia(`${diaEmSP(agora).slice(0, 7)}-01`) } },
        ],
        ...(visiveis === 'todas' ? {} : { unidadeId: { in: visiveis } }),
      },
      select: {
        id: true, situacao: true, inicio: true, fim: true, diaVencimento: true, valor: true, descontoPct: true, descontoValor: true, unidadeId: true,
        saidaEm: true,
        turma: { select: { nome: true } },
        unidade: { select: { nome: true } },
      },
    })
    const geradas = await db.mensalidade.findMany({
      where: { matriculaId: { in: matriculas.map((m) => m.id) } },
      select: { matriculaId: true, mes: true, vencimento: true, valor: true, desconto: true, pago: true, abono: true, quitadaEm: true, canceladaEm: true },
    })
    return { aluno, matriculas, geradas }
  })
  if (!r) return null
  const primeiro = diaEmSP(agora).slice(0, 7)
  const lista: (LinhaDoCarne & { unidade: string })[] = []
  let mes = primeiro
  for (let i = 0; i < Math.min(Math.max(meses, 1), 24); i++) {
    for (const m of r.matriculas) {
      const g = r.geradas.find((x) => x.matriculaId === m.id && x.mes === mes)
      if (g) {
        const c = contaDaMensalidade(g)
        lista.push({
          mes, vencimento: diaDaColuna(g.vencimento), turma: m.turma.nome, unidade: m.unidade.nome,
          valor: reais(centavos(g.valor)), desconto: reais(centavos(g.desconto)), devido: reais(c.devidoC), gerada: true,
          situacao: situacaoDaMensalidade({ ...g, restaC: c.restaC }, agora),
        })
        continue
      }
      const f = aGerarNoMes(
        [{
          id: m.id, situacao: m.situacao, inicio: diaDaColuna(m.inicio), fim: m.fim ? diaDaColuna(m.fim) : null,
          diaVencimento: m.diaVencimento, saida: m.saidaEm ? diaEmSP(m.saidaEm) : null,
        }],
        new Set(),
        mes,
      )[0]
      if (!f) continue
      const valorC = centavos(m.valor)
      const descC = descontoEmCentavos(valorC, Number(m.descontoPct), centavos(m.descontoValor))
      lista.push({
        mes, vencimento: f.vencimento, turma: m.turma.nome, unidade: m.unidade.nome,
        valor: reais(valorC), desconto: reais(descC), devido: reais(valorC - descC), gerada: false, situacao: 'prevista',
      })
    }
    mes = mesSeguinte(mes)
  }
  return { aluno: r.aluno, linhas: lista.filter((l) => l.situacao !== 'cancelada') }
}

// ─────────────────────────────────────────────────────────────
// BANCO — o que o painel e o relatório perguntam
// ─────────────────────────────────────────────────────────────

/** Quem está atrasado, do maior para o menor — para o assistente e a cobrança. */
export async function atrasadas(sessao: Sessao, unidadeIds: string[], agora = new Date()) {
  const lista = await listarMensalidades(sessao, { unidadeIds, situacao: 'atrasada' }, agora)
  const porAluno = new Map<string, { alunoId: string; aluno: string; responsavel: string | null; meses: string[]; total: number; dias: number }>()
  for (const m of lista) {
    const a = porAluno.get(m.alunoId) ?? { alunoId: m.alunoId, aluno: m.aluno, responsavel: m.responsavel, meses: [], total: 0, dias: 0 }
    a.meses.push(m.mes)
    a.total = reais(centavos(a.total) + centavos(m.resta))
    a.dias = Math.max(a.dias, m.diasAtraso)
    porAluno.set(m.alunoId, a)
  }
  const alunos = [...porAluno.values()].sort((a, b) => b.total - a.total || a.aluno.localeCompare(b.aluno, 'pt-BR'))
  return { quantas: lista.length, total: reais(lista.reduce((s, m) => s + centavos(m.resta), 0)), alunos }
}

/** O dia de hoje de mensalidade: o que vence hoje e o que está em atraso. */
export async function mensalidadesDoDia(sessao: Sessao, unidadeIds: string[], agora = new Date()) {
  const r = await resumoMensalidades(sessao, unidadeIds, diaEmSP(agora).slice(0, 7), agora)
  return { vencemHoje: r.vencemHoje, atraso: r.atraso }
}
