// Contas recorrentes: o que se paga todo mês sem ninguém precisar lembrar.
//
// ── o que é ──────────────────────────────────────────────────
// Aluguel dia 5, internet dia 12, contador dia 20. A loja cadastra UMA vez, e
// o sistema escreve o lançamento de cada mês sozinho — como conta a pagar, em
// aberto, com o vencimento certo. O dono continua dando baixa ("Paguei") como
// em qualquer conta; o que some é o trabalho de lançar a mesma coisa doze
// vezes por ano, e o esquecimento que vira multa.
//
// ── quando gera ──────────────────────────────────────────────
// Ao abrir o Financeiro: o mês corrente e o próximo, se faltarem — é o que
// "A vencer" (15 dias) precisa enxergar na virada do mês. E o mês que a
// pessoa estiver olhando, se for futuro: quem abre fevereiro para saber
// quanto vai pagar quer ver o aluguel de fevereiro lá. `gerarRecorrentesDoMes`
// é exportada sozinha para um agendador (cron) chamar no dia 1º no futuro,
// sem depender de alguém abrir a tela.
//
// ── por que rodar duas vezes não duplica ─────────────────────
// O vínculo é recorrente + mês: `Lancamento.recorrenteId` aponta para a conta
// que o gerou e o `vencimento` diz o mês. Antes de escrever, a geração lê o que
// já existe daquele mês e pula. Duas abas abrindo o Financeiro no mesmo
// segundo seriam duas transações lendo "não existe" ao mesmo tempo — por isso
// a geração segura uma trava do Postgres (advisory lock) por empresa e mês:
// a segunda espera a primeira terminar e já encontra tudo escrito.
//
// ── o que NÃO gera ───────────────────────────────────────────
// • conta pausada (`ativo = false`);
// • mês cujo vencimento passa do `ateEm` ("o financiamento acaba em março");
// • vencimento anterior ao dia em que a conta foi cadastrada. Cadastrar hoje,
//   dia 24, o aluguel que vence dia 5 não cria um aluguel de setembro já
//   vencido: esse, se ainda não foi pago, a pessoa lançou (ou lança) à mão.
//   Conta vencida que o sistema inventa é alarme falso, e alarme falso ensina
//   a ignorar o vermelho.
//
// ── datas ────────────────────────────────────────────────────
// `vencimento` é coluna DATE. O Prisma escreve e lê DATE como meia-noite UTC
// do dia, então toda data aqui é `Date.UTC(ano, mes - 1, dia)` e toda
// comparação é pela chave "AAAA-MM-DD" desse UTC. Nunca `new Date(ano, mes,
// dia)`: isso é meia-noite do fuso do SERVIDOR, e o servidor já rodou em
// Londres.

import type { TipoLancamento } from '@prisma/client'
import { comoOrg } from './banco'
import { exigir, pode, SemPermissao, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'

// ─────────────────────────────────────────────────────────────
// DATAS
// ─────────────────────────────────────────────────────────────

const fmtDiaSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** "2026-09-24" — hoje no relógio da loja, não do servidor. */
export const hojeNaLoja = (agora = new Date()): string => fmtDiaSP.format(agora)

/** A chave "AAAA-MM-DD" de uma coluna DATE lida do banco (meia-noite UTC). */
export const chaveDate = (d: Date): string => d.toISOString().slice(0, 10)

/**
 * Uma conta (coluna DATE) está vencida, vence hoje, ou ainda vai vencer?
 *
 * Compara DIA com DIA, em texto: o dia do vencimento (meia-noite UTC, como o
 * Prisma lê DATE) contra o dia de hoje no relógio da LOJA. Comparar a data do
 * banco com a meia-noite do servidor fazia a conta de hoje (00:00 UTC) parecer
 * anterior à meia-noite de São Paulo (03:00 UTC) — "vencida" desde a
 * madrugada, e o grupo "vence hoje" sempre vazio.
 */
export function situacaoDoVencimento(vencimento: Date, agora = new Date()): 'vencida' | 'hoje' | 'a vencer' {
  const v = chaveDate(vencimento)
  const hoje = hojeNaLoja(agora)
  return v < hoje ? 'vencida' : v === hoje ? 'hoje' : 'a vencer'
}

/** "2026-09" de uma coluna DATE. */
export const mesDaDate = (d: Date): string => d.toISOString().slice(0, 7)

/** "2026-09" → "2026-10". */
export function mesSeguinte(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7)
}

/** Aceita só "AAAA-MM" de verdade. */
export const mesValido = (m: unknown): m is string =>
  typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

/**
 * O vencimento de uma conta de dia `dia` no mês `mes` (1-12) de `ano`.
 *
 * Dia 31 em fevereiro cai no último dia de fevereiro (28, ou 29 no bissexto);
 * dia 31 em abril cai no dia 30. É o que o boleto de verdade faz — e é o que
 * impede o JavaScript de empurrar a conta calado para 3 de março.
 * Devolve meia-noite UTC do dia: o formato de uma coluna DATE.
 */
export function vencimentoNoMes(dia: number, ano: number, mes: number): Date {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const d = Math.min(Math.max(Math.trunc(dia), 1), ultimo)
  return new Date(Date.UTC(ano, mes - 1, d))
}

// ─────────────────────────────────────────────────────────────
// O QUE GERAR — puro
// ─────────────────────────────────────────────────────────────

export type RecorrenteParaGerar = {
  id: string
  ativo: boolean
  diaVencimento: number
  /** Coluna DATE: meia-noite UTC do último dia em que ainda gera. */
  ateEm: Date | null
  /** Quando foi cadastrada. Vencimento antes deste dia (na loja) não é gerado. */
  criadoEm: Date
}

/**
 * Quais contas ainda precisam do lançamento de `mes` ("AAAA-MM"), e com que
 * vencimento.
 *
 * `jaGerados` é o que o banco já tem: lançamentos com `recorrenteId`, pelo
 * vencimento. Recorrente que já tem lançamento no mês fica de fora — é isto
 * que torna a geração idempotente.
 */
export function aGerar(
  recorrentes: RecorrenteParaGerar[],
  jaGerados: { recorrenteId: string | null; vencimento: Date }[],
  mes: string,
): { recorrenteId: string; vencimento: Date }[] {
  if (!mesValido(mes)) return []
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  const feitos = new Set(
    jaGerados.filter((g) => g.recorrenteId).map((g) => `${g.recorrenteId}|${mesDaDate(g.vencimento)}`),
  )

  const saida: { recorrenteId: string; vencimento: Date }[] = []
  for (const r of recorrentes) {
    if (!r.ativo) continue
    if (feitos.has(`${r.id}|${mes}`)) continue
    const vencimento = vencimentoNoMes(r.diaVencimento, ano, m)
    const chave = chaveDate(vencimento)
    if (r.ateEm && chave > chaveDate(r.ateEm)) continue
    if (chave < hojeNaLoja(r.criadoEm)) continue
    saida.push({ recorrenteId: r.id, vencimento })
  }
  return saida
}

/** O primeiro vencimento que uma conta nova vai ter — para a tela avisar. */
export function primeiroVencimento(dia: number, agora = new Date()): Date {
  const hoje = hojeNaLoja(agora)
  const mes = hoje.slice(0, 7)
  const [a, m] = mes.split('-').map(Number) as [number, number]
  const este = vencimentoNoMes(dia, a, m)
  if (chaveDate(este) >= hoje) return este
  const [a2, m2] = mesSeguinte(mes).split('-').map(Number) as [number, number]
  return vencimentoNoMes(dia, a2, m2)
}

// ─────────────────────────────────────────────────────────────
// VALIDAÇÃO
// ─────────────────────────────────────────────────────────────

export type DadosRecorrente = {
  descricao: string
  categoriaId: string
  valor: number
  diaVencimento: number
  fornecedor?: string | null
  /** Nulo = conta da empresa inteira (contador, sistema). */
  unidadeId?: string | null
  /** "AAAA-MM-DD" ou vazio = para sempre. */
  ateEm?: string | null
}

export function validarRecorrente(
  d: DadosRecorrente,
): { ok: true; limpo: Omit<DadosRecorrente, 'ateEm'> & { ateEm: Date | null; valorC: number } } | { ok: false; erro: string } {
  const descricao = typeof d.descricao === 'string' ? d.descricao.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  if (!descricao) return { ok: false, erro: 'Descreva a conta: "Aluguel da loja", "Internet".' }
  if (!d.categoriaId) return { ok: false, erro: 'Escolha a categoria. É ela que decide a linha do resultado.' }
  if (typeof d.valor !== 'number' || !Number.isFinite(d.valor) || d.valor <= 0) {
    return { ok: false, erro: 'O valor precisa ser maior que zero.' }
  }
  const valorC = centavos(d.valor)
  if (valorC > 99_999_999) return { ok: false, erro: 'Valor alto demais. Confira os zeros.' }
  if (!Number.isInteger(d.diaVencimento) || d.diaVencimento < 1 || d.diaVencimento > 31) {
    return { ok: false, erro: 'O dia do vencimento vai de 1 a 31.' }
  }
  let ateEm: Date | null = null
  if (d.ateEm) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.ateEm)) return { ok: false, erro: 'A data de "até quando" não é válida.' }
    ateEm = new Date(`${d.ateEm}T00:00:00.000Z`)
    if (Number.isNaN(ateEm.getTime()) || chaveDate(ateEm) !== d.ateEm) {
      return { ok: false, erro: 'A data de "até quando" não existe.' }
    }
  }
  const fornecedor = typeof d.fornecedor === 'string' ? d.fornecedor.trim().slice(0, 120) || null : null
  return {
    ok: true,
    limpo: {
      descricao,
      categoriaId: d.categoriaId,
      valor: reais(valorC),
      valorC,
      diaVencimento: d.diaVencimento,
      fornecedor,
      unidadeId: d.unidadeId || null,
      ateEm,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// BANCO
// ─────────────────────────────────────────────────────────────

export type RecorrenteNaLista = {
  id: string
  descricao: string
  categoriaId: string
  categoria: string
  tipo: TipoLancamento
  valor: number
  diaVencimento: number
  fornecedor: string | null
  unidadeId: string | null
  ativo: boolean
  /** "AAAA-MM-DD" ou nulo. */
  ateEm: string | null
  /** Quantos lançamentos já gerou. */
  gerados: number
}

/** As lojas que esta pessoa vê no financeiro, ou 'todas'. Conta sem loja é da empresa e todo mundo vê. */
function escopo(sessao: Sessao) {
  const permitidas = unidadesQuePodem(sessao, 'financeiro.ver')
  return permitidas === 'todas' ? {} : { OR: [{ unidadeId: null }, { unidadeId: { in: permitidas } }] }
}

export async function listarRecorrentes(sessao: Sessao, unidadeIds: string[]): Promise<RecorrenteNaLista[]> {
  exigir(sessao, 'financeiro.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.recorrente.findMany({
      where: {
        AND: [escopo(sessao), { OR: [{ unidadeId: null }, { unidadeId: { in: unidadeIds } }] }],
      },
      orderBy: [{ ativo: 'desc' }, { diaVencimento: 'asc' }, { descricao: 'asc' }],
      select: {
        id: true, descricao: true, categoriaId: true, tipo: true, valor: true, diaVencimento: true,
        fornecedor: true, unidadeId: true, ativo: true, ateEm: true,
        categoria: { select: { nome: true } },
        _count: { select: { lancamentos: true } },
      },
    })
    return linhas.map((r) => ({
      id: r.id,
      descricao: r.descricao,
      categoriaId: r.categoriaId,
      categoria: r.categoria.nome,
      tipo: r.tipo,
      valor: Number(r.valor),
      diaVencimento: r.diaVencimento,
      fornecedor: r.fornecedor,
      unidadeId: r.unidadeId,
      ativo: r.ativo,
      ateEm: r.ateEm ? chaveDate(r.ateEm) : null,
      gerados: r._count.lancamentos,
    }))
  })
}

/**
 * Escreve os lançamentos de `mes` que faltam. Devolve quantos escreveu.
 *
 * Pede só `financeiro.ver`, e é de propósito: quem DECIDIU a conta foi quem a
 * cadastrou, com `financeiro.lancar`. Aqui é o calendário virando a folha — o
 * gerente que abre o Financeiro no dia 1º não está lançando nada, está vendo
 * o mês que chegou. Gera só as contas das lojas que a pessoa alcança (e as da
 * empresa inteira); a de outra loja é gerada quando alguém de lá abrir, ou
 * pelo agendador.
 */
export async function gerarRecorrentesDoMes(sessao: Sessao, mes: string): Promise<number> {
  exigir(sessao, 'financeiro.ver')
  if (!mesValido(mes)) throw new Error('Mês inválido.')
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  const de = new Date(Date.UTC(ano, m - 1, 1))
  const ate = new Date(Date.UTC(ano, m, 1))

  return comoOrg(sessao.orgId, async (db) => {
    // Uma geração por empresa e mês de cada vez — ver o cabeçalho.
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`recorrentes:${sessao.orgId}:${mes}`}))`

    const recorrentes = await db.recorrente.findMany({
      where: { ativo: true, ...escopo(sessao) },
      select: {
        id: true, ativo: true, diaVencimento: true, ateEm: true, criadoEm: true,
        categoriaId: true, unidadeId: true, tipo: true, descricao: true, valor: true, fornecedor: true,
      },
    })
    if (recorrentes.length === 0) return 0

    const jaGerados = await db.lancamento.findMany({
      where: { recorrenteId: { in: recorrentes.map((r) => r.id) }, vencimento: { gte: de, lt: ate } },
      select: { recorrenteId: true, vencimento: true },
    })

    const faltam = aGerar(recorrentes, jaGerados, mes)
    if (faltam.length === 0) return 0

    const porId = new Map(recorrentes.map((r) => [r.id, r]))
    await db.lancamento.createMany({
      data: faltam.map((f) => {
        const r = porId.get(f.recorrenteId)!
        return {
          orgId: sessao.orgId,
          unidadeId: r.unidadeId,
          categoriaId: r.categoriaId,
          tipo: r.tipo,
          descricao: r.descricao,
          valor: r.valor,
          vencimento: f.vencimento,
          pagoEm: null,
          fornecedor: r.fornecedor,
          recorrenteId: r.id,
          // Quem abriu a tela não lançou nada: o autor é o sistema, e o nome
          // de quem disparou fica na auditoria.
          quem: 'Conta recorrente',
        }
      }),
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        autor: 'SISTEMA',
        acao: 'financeiro.recorrente.gerou',
        alvoTipo: 'mes',
        alvoId: mes,
        alvoNome: `${faltam.length} conta${faltam.length === 1 ? '' : 's'} de ${mes}`,
        valor: reais(faltam.reduce((s, f) => s + centavos(porId.get(f.recorrenteId)!.valor), 0)),
        depois: { quantos: faltam.length, recorrentes: faltam.map((f) => f.recorrenteId) },
      },
    })
    return faltam.length
  })
}

/**
 * O que a tela do Financeiro chama ao abrir: o mês corrente, o seguinte e,
 * se a pessoa estiver olhando um mês futuro (até um ano à frente), esse
 * também. Nunca derruba a tela — gerar é conveniência, a lista tem de abrir
 * mesmo que isto falhe.
 */
export async function garantirRecorrentes(sessao: Sessao, mesOlhado?: string | null, agora = new Date()): Promise<number> {
  exigir(sessao, 'financeiro.ver')
  const atual = hojeNaLoja(agora).slice(0, 7)
  const meses = [atual, mesSeguinte(atual)]
  let limite = atual
  for (let i = 0; i < 12; i++) limite = mesSeguinte(limite)
  if (mesValido(mesOlhado) && mesOlhado > meses[1]! && mesOlhado <= limite) meses.push(mesOlhado)

  let total = 0
  for (const mes of meses) {
    try {
      total += await gerarRecorrentesDoMes(sessao, mes)
    } catch (e) {
      console.error('[recorrentes] não gerou', mes, e)
    }
  }
  return total
}

/* ── cadastrar, editar, pausar ─────────────────────────────── */

export async function criarRecorrente(sessao: Sessao, d: DadosRecorrente): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  exigir(sessao, 'financeiro.lancar', d.unidadeId || undefined)
  const v = validarRecorrente(d)
  if (!v.ok) return v
  const r = v.limpo

  return comoOrg(sessao.orgId, async (db) => {
    const cat = await db.categoriaFinanceira.findFirst({
      where: { id: r.categoriaId, ativa: true },
      select: { tipo: true },
    })
    if (!cat) return { ok: false as const, erro: 'Essa categoria não existe.' }
    if (r.unidadeId) {
      const loja = await db.unidade.findFirst({ where: { id: r.unidadeId, ativa: true }, select: { id: true } })
      if (!loja) return { ok: false as const, erro: 'Essa loja não existe.' }
    }

    const criada = await db.recorrente.create({
      data: {
        orgId: sessao.orgId,
        categoriaId: r.categoriaId,
        unidadeId: r.unidadeId ?? null,
        tipo: cat.tipo,
        descricao: r.descricao,
        valor: r.valor,
        diaVencimento: r.diaVencimento,
        fornecedor: r.fornecedor ?? null,
        ateEm: r.ateEm,
      },
      select: { id: true },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: r.unidadeId ?? null,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'financeiro.recorrente.criou',
        alvoTipo: 'recorrente',
        alvoId: criada.id,
        alvoNome: r.descricao,
        valor: r.valor,
        depois: { dia: r.diaVencimento, valor: r.valor, ateEm: r.ateEm ? chaveDate(r.ateEm) : null },
      },
    })
    return { ok: true as const, id: criada.id }
  })
}

/**
 * Muda a conta — e acerta os lançamentos dela que ainda não foram pagos, de
 * hoje em diante.
 *
 * Sem isso, o aluguel que subiu hoje continuaria com o valor velho no mês que
 * vem (que já foi gerado), e o dono veria o número errado justo na conta que
 * acabou de corrigir. O que já foi pago, ou já venceu, fica como está: é
 * histórico. Se a conta foi pausada ou o "até quando" encurtou, os lançamentos
 * futuros em aberto que não valem mais saem — conta cancelada não pode
 * continuar aparecendo em "A vencer".
 */
export async function editarRecorrente(
  sessao: Sessao,
  id: string,
  d: DadosRecorrente & { ativo: boolean },
  agora = new Date(),
): Promise<{ ok: true; ajustados: number; removidos: number } | { ok: false; erro: string }> {
  exigir(sessao, 'financeiro.lancar')
  const v = validarRecorrente(d)
  if (!v.ok) return v
  const r = v.limpo
  const hoje = new Date(`${hojeNaLoja(agora)}T00:00:00.000Z`)

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.recorrente.findUnique({
      where: { id },
      select: {
        unidadeId: true, descricao: true, valor: true, diaVencimento: true, categoriaId: true,
        fornecedor: true, ativo: true, ateEm: true,
      },
    })
    if (!antes) return { ok: false as const, erro: 'Essa conta não existe mais.' }
    if (!pode(sessao, 'financeiro.lancar', antes.unidadeId ?? undefined)) {
      throw new SemPermissao('financeiro.lancar', antes.unidadeId ?? undefined)
    }
    if (r.unidadeId && !pode(sessao, 'financeiro.lancar', r.unidadeId)) {
      throw new SemPermissao('financeiro.lancar', r.unidadeId)
    }
    const cat = await db.categoriaFinanceira.findFirst({ where: { id: r.categoriaId, ativa: true }, select: { tipo: true } })
    if (!cat) return { ok: false as const, erro: 'Essa categoria não existe.' }

    await db.recorrente.update({
      where: { id },
      data: {
        categoriaId: r.categoriaId,
        unidadeId: r.unidadeId ?? null,
        tipo: cat.tipo,
        descricao: r.descricao,
        valor: r.valor,
        diaVencimento: r.diaVencimento,
        fornecedor: r.fornecedor ?? null,
        ativo: d.ativo,
        ateEm: r.ateEm,
      },
    })

    // Os lançamentos em aberto, de hoje em diante, que esta conta já gerou.
    const futuros = await db.lancamento.findMany({
      where: { recorrenteId: id, pagoEm: null, vencimento: { gte: hoje } },
      select: { id: true, vencimento: true },
    })
    const saem: string[] = []
    let ajustados = 0
    for (const l of futuros) {
      const [a, m] = mesDaDate(l.vencimento).split('-').map(Number) as [number, number]
      const venc = vencimentoNoMes(r.diaVencimento, a, m)
      if (!d.ativo || (r.ateEm && chaveDate(venc) > chaveDate(r.ateEm))) {
        saem.push(l.id)
        continue
      }
      await db.lancamento.update({
        where: { id: l.id },
        data: {
          categoriaId: r.categoriaId,
          unidadeId: r.unidadeId ?? null,
          tipo: cat.tipo,
          descricao: r.descricao,
          valor: r.valor,
          vencimento: venc,
          fornecedor: r.fornecedor ?? null,
        },
      })
      ajustados++
    }
    if (saem.length > 0) await db.lancamento.deleteMany({ where: { id: { in: saem }, pagoEm: null } })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: r.unidadeId ?? antes.unidadeId ?? null,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'financeiro.recorrente.alterou',
        alvoTipo: 'recorrente',
        alvoId: id,
        alvoNome: r.descricao,
        valor: r.valor,
        antes: {
          descricao: antes.descricao,
          valor: Number(antes.valor),
          dia: antes.diaVencimento,
          ativo: antes.ativo,
          ateEm: antes.ateEm ? chaveDate(antes.ateEm) : null,
        },
        depois: {
          descricao: r.descricao,
          valor: r.valor,
          dia: r.diaVencimento,
          ativo: d.ativo,
          ateEm: r.ateEm ? chaveDate(r.ateEm) : null,
          lancamentosAjustados: ajustados,
          lancamentosRemovidos: saem.length,
        },
      },
    })
    return { ok: true as const, ajustados, removidos: saem.length }
  })
}

/**
 * Pausa ou retoma. É a mesma edição com o resto igual — assim pausar também
 * tira de "A vencer" os lançamentos futuros em aberto, e retomar deixa a
 * próxima abertura do Financeiro gerar o que faltar.
 */
export async function alternarRecorrente(sessao: Sessao, id: string, ativo: boolean, agora = new Date()) {
  exigir(sessao, 'financeiro.lancar')
  const atual = await comoOrg(sessao.orgId, (db) =>
    db.recorrente.findUnique({
      where: { id },
      select: {
        descricao: true, categoriaId: true, valor: true, diaVencimento: true, fornecedor: true,
        unidadeId: true, ateEm: true,
      },
    }),
  )
  if (!atual) return { ok: false as const, erro: 'Essa conta não existe mais.' }
  return editarRecorrente(
    sessao,
    id,
    {
      descricao: atual.descricao,
      categoriaId: atual.categoriaId,
      valor: Number(atual.valor),
      diaVencimento: atual.diaVencimento,
      fornecedor: atual.fornecedor,
      unidadeId: atual.unidadeId,
      ateEm: atual.ateEm ? chaveDate(atual.ateEm) : null,
      ativo,
    },
    agora,
  )
}
