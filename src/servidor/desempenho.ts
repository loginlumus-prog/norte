// Desempenho da equipe em estrelas.
//
// ── o que é ──────────────────────────────────────────────────
// Uma nota de 0 a 5 por pessoa por mês, feita de três coisas que o sistema já
// sabe: quanto da meta ela fez, quantas tarefas entregou no prazo e em quantos
// dias entrou no sistema. É a "estrelinha" que a dona da loja dá de cabeça no
// fim do mês — só que com a conta aberta ao lado, para ninguém achar que é
// implicância.
//
// ── por que a conta é aberta ─────────────────────────────────
// Nota que cai do céu vira briga. Cada estrela aqui vem com os motivos
// ("bateu 104% da meta", "faltou 3 dias") e com os pesos que a formaram. Quem
// discorda discorda de um número que pode conferir, não de uma opinião.
//
// ── por que os pesos são estes ───────────────────────────────
// Meta pesa metade porque venda é o que paga a loja. Tarefa pesa 30% porque é
// o que faz a loja funcionar quando não tem cliente na frente. Presença pesa
// 20% e é o menor de propósito: entrar no sistema é sinal fraco — a pessoa
// pode estar na loja sem abrir o computador. Ela existe para separar quem
// esteve de quem sumiu, não para ser ponto eletrônico.
//
// ── o que sai da conta sai dos pesos ─────────────────────────
// Pessoa sem meta não é punida por não ter meta: o peso da meta é dividido
// entre os outros dois. Sem tarefa, idem. A nota é sempre sobre o que EXISTE
// para medir — e quando não existe nada, a resposta é "sem dados", nunca zero
// estrela, porque zero é um julgamento e "sem dados" é a verdade.
//
// A conta é pura (`estrelas`) e está testada em tests/desempenho.test.ts. O
// banco só entra para reunir os insumos.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, PODERES, type Papel, type Sessao } from './permissao'
import { mesChave, metasDoMes, type MetaDaPessoa } from './metas'

// ─────────────────────────────────────────────────────────────
// A CONTA
// ─────────────────────────────────────────────────────────────

export type Insumos = {
  /** Progresso da meta do mês, 0..1+. Nulo = sem meta, ou módulo desligado. */
  meta: number | null
  /** Tarefas em que a pessoa é a responsável, no mês. Nulo = nenhuma. */
  tarefas: { atribuidas: number; feitas: number; noPrazo: number; atrasadasAbertas: number } | null
  /** Dias em que entrou no sistema, e quantos dias do mês contam (teto 26). */
  presenca: { dias: number; de: number } | null
}

export type Componente = 'meta' | 'tarefas' | 'presenca'

export type Nota = {
  /** 0 a 5, em meios: 0, 0,5, 1 … 5. */
  estrelas: number
  /** Cada componente que entrou, de 0 a 1. */
  notas: Partial<Record<Componente, number>>
  /** O peso de cada componente que entrou. Somam 1. */
  pesos: Partial<Record<Componente, number>>
  /** Frases curtas que explicam a nota, na ordem dos componentes. */
  motivos: string[]
}

/** Os pesos de partida. Quem falta sai, e os que ficam são reescalados. */
export const PESOS: Record<Componente, number> = { meta: 0.5, tarefas: 0.3, presenca: 0.2 }

/**
 * Quantos dias de um mês contam para presença.
 *
 * Ninguém trabalha 31 dias. Vinte e seis é o mês cheio de quem folga um dia
 * por semana — a escala mais comum no comércio. Acima disso a pessoa não
 * ganha nada; abaixo, cada dia sem entrar conta como falta.
 */
export const TETO_DIAS = 26

export function estrelas(i: Insumos): Nota {
  const notas: Nota['notas'] = {}
  const motivos: string[] = []

  if (i.meta !== null) {
    // Bater a meta vale 1; passar não vale estrela a mais. O que passa da
    // meta é comissão, e comissão já paga em dinheiro.
    notas.meta = Math.min(Math.max(i.meta, 0), 1)
    const pct = Math.round(i.meta * 100)
    motivos.push(i.meta >= 1 ? `bateu ${pct}% da meta` : `fez ${pct}% da meta`)
  }

  const t = i.tarefas
  if (t && t.atribuidas > 0) {
    // Feita no prazo vale 1, feita atrasada vale meio: entregar tarde ainda
    // é entregar. Atrasada em aberto desconta 0,1 cada — é a única coisa
    // aqui que TIRA ponto, porque é a única que ainda dá para resolver.
    const foraDoPrazo = Math.max(t.feitas - t.noPrazo, 0)
    const bruta = (t.noPrazo + 0.5 * foraDoPrazo) / t.atribuidas
    notas.tarefas = Math.min(Math.max(bruta - 0.1 * t.atrasadasAbertas, 0), 1)
    motivos.push(`${t.noPrazo} de ${t.atribuidas} ${t.atribuidas === 1 ? 'tarefa' : 'tarefas'} no prazo`)
    if (foraDoPrazo > 0) motivos.push(`${foraDoPrazo} fora do prazo`)
    if (t.atrasadasAbertas > 0) {
      motivos.push(`${t.atrasadasAbertas} ${t.atrasadasAbertas === 1 ? 'atrasada' : 'atrasadas'} em aberto`)
    }
  }

  const p = i.presenca
  if (p && p.de > 0) {
    notas.presenca = Math.min(Math.max(p.dias / p.de, 0), 1)
    const faltas = Math.max(p.de - p.dias, 0)
    motivos.push(faltas === 0 ? `sem falta em ${p.de} dias` : `faltou ${faltas} ${faltas === 1 ? 'dia' : 'dias'}`)
  }

  const entram = Object.keys(notas) as Componente[]
  if (entram.length === 0) return { estrelas: 0, notas: {}, pesos: {}, motivos: ['sem dados no mês'] }

  const somaPesos = entram.reduce((s, c) => s + PESOS[c], 0)
  const pesos: Nota['pesos'] = {}
  let total = 0
  for (const c of entram) {
    pesos[c] = PESOS[c] / somaPesos
    total += pesos[c]! * notas[c]!
  }
  return { estrelas: emMeios(total), notas, pesos, motivos }
}

/** 0..1 → 0..5, no meio de estrela mais próximo. */
function emMeios(fracao: number): number {
  // O epsilon segura a fronteira: 0,5 + 0,15 dá 0,6499999… em ponto
  // flutuante, e arredondaria para baixo por acidente de representação.
  return Math.round(fracao * 10 + 1e-9) / 2
}

/** Nota sem nenhum componente: a pessoa existe, o mês não disse nada dela. */
export const semDados = (n: Nota): boolean => Object.keys(n.notas).length === 0

/** Quatro estrelas é bom; duas e meia ainda merece conversa; abaixo, alerta. */
export function NIVEL(estrelas: number): 'bom' | 'atencao' | 'critico' {
  return estrelas >= 4 ? 'bom' : estrelas >= 2.5 ? 'atencao' : 'critico'
}

/**
 * Quantos dias do mês já contam para presença.
 *
 * No mês corrente, os dias corridos até hoje — cobrar 26 dias no dia 5 seria
 * dar zero para todo mundo. Em mês passado, o mês inteiro. Mês futuro é zero:
 * ninguém entrou num mês que não começou, e zero tira a presença da conta.
 */
export function diasDoMesAte(hoje: Date, mes: string): number {
  const atual = mesChave(hoje)
  if (mes > atual) return 0
  if (mes === atual) return Math.min(hoje.getDate(), TETO_DIAS)
  const [a, m] = mes.split('-').map(Number)
  return Math.min(new Date(a!, m!, 0).getDate(), TETO_DIAS)
}

/** Os últimos `n` meses terminando em `mes`: ("2026-09", 3) → jul, ago, set. */
export function ultimosMeses(mes: string, n: number): string[] {
  const [a, m] = mes.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => mesChave(new Date(a!, m! - n + i, 1)))
}

// ─────────────────────────────────────────────────────────────
// OS INSUMOS, DO BANCO
// ─────────────────────────────────────────────────────────────

export type PessoaComNota = { usuarioId: string; nome: string; nota: Nota; insumos: Insumos }
export type NotasDoMes = { mes: string; pessoas: PessoaComNota[] }

export type Opcoes = {
  /** O módulo de metas está ligado nesta empresa? Desligado, a meta sai da conta. */
  metas: boolean
  /** Só estas lojas: as vendas e as tarefas delas. Sem isto, a empresa inteira. */
  unidadeIds?: string[]
  /** As metas do mês, se quem chama já as leu — o painel lê; não vale ler duas vezes. */
  metasProntas?: MetaDaPessoa[]
}

// A mesma regra de `metasDoMes`: quem vende é quem tem papel com 'venda.criar'.
// Repetida aqui porque lá ela é privada — e porque a lista de quem entra na
// nota tem que ser a mesma lista da seção de metas, senão alguém aparece numa
// e some da outra.
const PAPEIS_QUE_VENDEM = (Object.keys(PODERES) as Papel[]).filter((p) => PODERES[p].includes('venda.criar'))

/**
 * "AAAA-MM-DD" de hoje no relógio da loja.
 *
 * A auditoria e a tarefa gravam em UTC; "hoje" e "que dia foi" se decidem em
 * São Paulo, como o painel já faz (ver o comentário de fuso em painel.ts).
 */
function hojeEmSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora)
}

type Janela = { de: Date; ate: Date; deDia: string; ateDia: string }

/** A MESMA janela de `metasDoMes`, para o realizado bater com a seção de metas. */
function janelaDoMes(mes: string): Janela {
  const [a, m] = mes.split('-').map(Number)
  const ate = new Date(a!, m!, 1)
  return { de: new Date(a!, m! - 1, 1), ate, deDia: `${mes}-01`, ateDia: `${mesChave(ate)}-01` }
}

type LinhaTarefa = {
  unidade_id: string | null
  responsavel_id: string
  atribuidas: number
  feitas: number
  no_prazo: number
  atrasadas_abertas: number
}

/**
 * Tarefas do mês por (loja do quadro, responsável).
 *
 * Entram as concluídas no mês e as ainda abertas com prazo no mês — é isso
 * que a pessoa tinha para fazer. "No prazo" é o dia da conclusão, no relógio
 * de São Paulo, até o dia do prazo. Tarefa feita sem prazo conta no prazo:
 * não havia prazo a perder.
 *
 * Agrupada pela loja do quadro porque a comparação entre lojas precisa disso;
 * quem quer o total soma as linhas (ver `somarTarefas`).
 */
async function lerTarefas(db: BancoDaOrg, j: Janela, hoje: string, uni: string[] | null): Promise<LinhaTarefa[]> {
  return db.$queryRaw<LinhaTarefa[]>`
    select q.unidade_id, t.responsavel_id,
           count(*)::int as atribuidas,
           (count(*) filter (where t.situacao = 'FEITO'))::int as feitas,
           (count(*) filter (where t.situacao = 'FEITO'
              and (t.prazo is null
                   or (t.concluida_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date <= t.prazo)))::int as no_prazo,
           (count(*) filter (where t.situacao <> 'FEITO' and t.prazo < ${hoje}::date))::int as atrasadas_abertas
      from tarefas t
      join quadros q on q.id = t.quadro_id
     where t.responsavel_id is not null
       and ((t.situacao = 'FEITO' and t.concluida_em >= ${j.de} and t.concluida_em < ${j.ate})
         or (t.situacao <> 'FEITO' and t.prazo >= ${j.deDia}::date and t.prazo < ${j.ateDia}::date))
       and (${uni === null} or q.unidade_id = any(${uni ?? []}))
     group by 1, 2
  `
}

function somarTarefas(linhas: LinhaTarefa[]): Insumos['tarefas'] {
  if (linhas.length === 0) return null
  const s = { atribuidas: 0, feitas: 0, noPrazo: 0, atrasadasAbertas: 0 }
  for (const l of linhas) {
    s.atribuidas += l.atribuidas
    s.feitas += l.feitas
    s.noPrazo += l.no_prazo
    s.atrasadasAbertas += l.atrasadas_abertas
  }
  return s.atribuidas > 0 ? s : null
}

/**
 * Dias distintos em que cada pessoa entrou no sistema, no mês.
 *
 * Não há livro de ponto; o que há é o registro 'sessao.entrou' da auditoria.
 * Dois logins no mesmo dia são um dia — e o dia é o de São Paulo, senão quem
 * entra às 22h conta no dia seguinte.
 */
async function lerPresenca(db: BancoDaOrg, j: Janela): Promise<Map<string, number>> {
  const linhas = await db.$queryRaw<{ usuario_id: string; dias: number }[]>`
    select a.usuario_id,
           count(distinct (a.criado_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date)::int as dias
      from auditoria a
     where a.acao = 'sessao.entrou' and a.usuario_id is not null
       and a.criado_em >= ${j.de} and a.criado_em < ${j.ate}
     group by 1
  `
  return new Map(linhas.map((l) => [l.usuario_id, l.dias]))
}

const chaveLoja = (unidadeId: string, usuarioId: string) => `${unidadeId}|${usuarioId}`

/**
 * Vendido líquido de devolução por (loja, vendedor), em reais.
 *
 * Só serve quando a leitura é POR LOJA: a meta da pessoa é uma só, mas o
 * realizado se reparte pelas lojas onde ela vendeu. Sem filtro de loja, o
 * progresso vem direto de `metasDoMes` — a mesma conta da seção de metas.
 */
async function lerLiquidoPorLoja(db: BancoDaOrg, j: Janela, uni: string[]): Promise<Map<string, number>> {
  const vendas = await db.$queryRaw<{ unidade_id: string; vendedor_id: string; total: string }[]>`
    select v.unidade_id, v.vendedor_id, sum(v.total) as total
      from vendas v
     where v.situacao = 'CONCLUIDA' and v.vendedor_id is not null
       and v.unidade_id = any(${uni})
       and v.criada_em >= ${j.de} and v.criada_em < ${j.ate}
     group by 1, 2
  `
  const devolucoes = await db.$queryRaw<{ unidade_id: string; vendedor_id: string; total: string }[]>`
    select v.unidade_id, v.vendedor_id, sum(d.valor) as total
      from devolucoes d join vendas v on v.id = d.venda_id
     where v.vendedor_id is not null and v.unidade_id = any(${uni})
       and d.criada_em >= ${j.de} and d.criada_em < ${j.ate}
     group by 1, 2
  `
  const liquido = new Map<string, number>()
  for (const v of vendas) liquido.set(chaveLoja(v.unidade_id, v.vendedor_id), Number(v.total))
  for (const d of devolucoes) {
    const k = chaveLoja(d.unidade_id, d.vendedor_id)
    liquido.set(k, Math.max((liquido.get(k) ?? 0) - Number(d.total), 0))
  }
  return liquido
}

/**
 * Junta os três insumos de uma pessoa.
 *
 * Zero entrada, sem meta e sem tarefa, NÃO é falta: é ausência de dado. A
 * pessoa pode nem usar o sistema — a venda dela é lançada por outro, ou ela
 * só tem o papel e ainda não começou. Nesse caso a presença sai e a nota vira
 * "sem dados". Com meta ou tarefa no mês, zero entrada é falta de verdade.
 */
function montar(o: { meta: number | null; tarefas: LinhaTarefa[]; dias: number; de: number }): Insumos {
  const tarefas = somarTarefas(o.tarefas)
  const nadaAlem = o.meta === null && tarefas === null && o.dias === 0
  return {
    meta: o.meta,
    tarefas,
    presenca: nadaAlem || o.de === 0 ? null : { dias: o.dias, de: o.de },
  }
}

/** Da maior para a menor; entre iguais, quem tem dado antes de quem não tem; depois o nome. */
const porEstrelas = (a: PessoaComNota, b: PessoaComNota) =>
  b.nota.estrelas - a.nota.estrelas ||
  Number(semDados(a.nota)) - Number(semDados(b.nota)) ||
  a.nome.localeCompare(b.nome, 'pt-BR')

/**
 * As estrelas de cada pessoa da equipe, no mês.
 *
 * Entra quem está ativo E (vende ou teve tarefa no mês). O contador que só
 * olha o financeiro não aparece — não teria insumo nenhum e a linha só diria
 * "sem dados".
 */
export async function desempenhoDoMes(
  sessao: Sessao,
  mes: string,
  opcoes: Opcoes,
  agora = new Date(),
): Promise<NotasDoMes> {
  exigir(sessao, 'equipe.ver')
  const uni = opcoes.unidadeIds ?? null
  if (uni && uni.length === 0) return { mes, pessoas: [] }

  // As metas vêm de `metasDoMes`, de propósito: é a mesma conta da seção de
  // metas, com a mesma herança de mês. Dois números diferentes para a mesma
  // meta na mesma tela e a pessoa desconfia dos dois. Lida ANTES do comoOrg
  // porque ela abre o dela — comoOrg dentro de comoOrg trava (ver banco.ts).
  const metas = opcoes.metas ? (opcoes.metasProntas ?? (await metasDoMes(sessao, mes))) : []
  const metaDe = new Map(metas.map((m) => [m.usuarioId, m]))

  const j = janelaDoMes(mes)
  const hoje = hojeEmSaoPaulo(agora)
  const de = diasDoMesAte(agora, mes)

  return comoOrg(sessao.orgId, async (db) => {
    const tarefas = await lerTarefas(db, j, hoje, uni)
    const presenca = await lerPresenca(db, j)
    const liquidoNaLoja = uni && opcoes.metas ? await lerLiquidoPorLoja(db, j, uni) : null

    const comTarefa = [...new Set(tarefas.map((t) => t.responsavel_id))]
    const pessoas = await db.usuario.findMany({
      where: {
        ativo: true,
        OR: [{ acessos: { some: { papel: { in: PAPEIS_QUE_VENDEM } } } }, { id: { in: comTarefa } }],
      },
      select: { id: true, nome: true },
    })

    return {
      mes,
      pessoas: pessoas
        .map((p) => {
          const m = metaDe.get(p.id)
          let meta: number | null = null
          if (m && m.valor > 0) {
            meta = liquidoNaLoja
              ? uni!.reduce((s, u) => s + (liquidoNaLoja.get(chaveLoja(u, p.id)) ?? 0), 0) / m.valor
              : m.progresso
          }
          const insumos = montar({
            meta,
            tarefas: tarefas.filter((t) => t.responsavel_id === p.id),
            dias: presenca.get(p.id) ?? 0,
            de,
          })
          return { usuarioId: p.id, nome: p.nome, insumos, nota: estrelas(insumos) }
        })
        .sort(porEstrelas),
    }
  })
}

export type Tendencia = {
  meses: string[]
  /** Por pessoa, uma nota por mês na ordem de `meses`. Nulo = sem dados naquele mês. */
  porPessoa: Record<string, (number | null)[]>
}

/**
 * As notas dos últimos meses, de toda a equipe de uma vez.
 *
 * Um mês por vez, cada um com o próprio comoOrg — um DEPOIS do outro, nunca
 * um dentro do outro. Quem já leu o mês corrente passa em `atual` e ele não
 * é lido de novo.
 */
export async function tendenciaDaEquipe(
  sessao: Sessao,
  mes: string,
  meses = 3,
  opcoes: Opcoes,
  atual?: NotasDoMes,
): Promise<Tendencia> {
  exigir(sessao, 'equipe.ver')
  const lista = ultimosMeses(mes, meses)
  const porMes: NotasDoMes[] = []
  for (const m of lista) {
    // `metasProntas` é do mês pedido; para os outros meses a meta é lida.
    porMes.push(
      atual && atual.mes === m
        ? atual
        : await desempenhoDoMes(sessao, m, { metas: opcoes.metas, unidadeIds: opcoes.unidadeIds }),
    )
  }
  const porPessoa: Tendencia['porPessoa'] = {}
  for (const id of new Set(porMes.flatMap((d) => d.pessoas.map((p) => p.usuarioId)))) {
    porPessoa[id] = porMes.map((d) => {
      const p = d.pessoas.find((x) => x.usuarioId === id)
      return p && !semDados(p.nota) ? p.nota.estrelas : null
    })
  }
  return { meses: lista, porPessoa }
}

/** A tendência de UMA pessoa: as notas dos últimos meses até `mes`. */
export async function tendencia(
  sessao: Sessao,
  usuarioId: string,
  meses = 3,
  opcoes: Opcoes,
  mes = mesChave(new Date()),
): Promise<{ mes: string; estrelas: number | null }[]> {
  const t = await tendenciaDaEquipe(sessao, mes, meses, opcoes)
  return t.meses.map((m, i) => ({ mes: m, estrelas: t.porPessoa[usuarioId]?.[i] ?? null }))
}

export type NotaDaLoja = {
  unidadeId: string
  nome: string
  /** Média das estrelas de quem trabalhou na loja no mês. Nula sem ninguém. */
  media: number | null
  pessoas: number
}

/**
 * A média de estrelas de cada loja, para a rede comparar.
 *
 * A pessoa entra na conta da loja onde VENDEU ou TEVE TAREFA no mês — não da
 * loja do cadastro dela, porque gerente de rede roda loja. A meta dela é uma
 * só, então cada loja recebe a fatia que ela vendeu ali contra a meta
 * inteira; a tarefa é a do quadro da loja (quadro da empresa inteira não é de
 * loja nenhuma e fica de fora); a presença não tem loja e vale igual em todas.
 *
 * Uma passada só no banco, agrupada por loja — chamar `desempenhoDoMes` loja
 * a loja seria duas transações por loja, e rede tem vinte.
 */
export async function desempenhoPorLoja(
  sessao: Sessao,
  mes: string,
  lojas: { id: string; nome: string }[],
  opcoes: Opcoes,
  agora = new Date(),
): Promise<NotaDaLoja[]> {
  exigir(sessao, 'equipe.ver')
  if (lojas.length === 0) return []

  const metas = opcoes.metas ? (opcoes.metasProntas ?? (await metasDoMes(sessao, mes))) : []
  const metaDe = new Map(metas.map((m) => [m.usuarioId, m]))
  const j = janelaDoMes(mes)
  const hoje = hojeEmSaoPaulo(agora)
  const de = diasDoMesAte(agora, mes)
  const uni = lojas.map((l) => l.id)

  return comoOrg(sessao.orgId, async (db) => {
    const tarefas = await lerTarefas(db, j, hoje, uni)
    const presenca = await lerPresenca(db, j)
    const liquido = opcoes.metas ? await lerLiquidoPorLoja(db, j, uni) : new Map<string, number>()

    // Quem apareceu em alguma loja, e ainda está na empresa.
    const candidatos = new Set<string>(tarefas.map((t) => t.responsavel_id))
    for (const k of liquido.keys()) candidatos.add(k.slice(k.indexOf('|') + 1))
    const ativos = new Set(
      (await db.usuario.findMany({ where: { ativo: true, id: { in: [...candidatos] } }, select: { id: true } })).map((u) => u.id),
    )

    return lojas
      .map((l) => {
        const ids = new Set<string>()
        for (const t of tarefas) if (t.unidade_id === l.id && ativos.has(t.responsavel_id)) ids.add(t.responsavel_id)
        for (const id of ativos) if (liquido.has(chaveLoja(l.id, id))) ids.add(id)

        const notas: number[] = []
        for (const id of ids) {
          const m = metaDe.get(id)
          const meta = m && m.valor > 0 ? (liquido.get(chaveLoja(l.id, id)) ?? 0) / m.valor : null
          const insumos = montar({
            meta,
            tarefas: tarefas.filter((t) => t.responsavel_id === id && t.unidade_id === l.id),
            dias: presenca.get(id) ?? 0,
            de,
          })
          const n = estrelas(insumos)
          if (!semDados(n)) notas.push(n.estrelas)
        }
        return {
          unidadeId: l.id,
          nome: l.nome,
          pessoas: notas.length,
          media: notas.length ? notas.reduce((s, x) => s + x, 0) / notas.length : null,
        }
      })
      .sort((a, b) => (b.media ?? -1) - (a.media ?? -1) || a.nome.localeCompare(b.nome, 'pt-BR'))
  })
}
