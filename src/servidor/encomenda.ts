// Encomendas: o pedido que sai depois.
//
// ── o que é ──────────────────────────────────────────────────
// O caderno do balcão: "bolo de chocolate 2 kg, escrito Parabéns Ana, sábado
// às 15h, pagou R$ 50 de sinal". A lista abre pelo que vence primeiro, porque
// a pergunta de quem abre é "o que eu tenho de entregar hoje?" — e a pior
// coisa que pode acontecer com uma encomenda é passar da hora sem ninguém ver.
//
// ── a hora é a de São Paulo, sempre ──────────────────────────
// "Sábado às 15h" é a hora do relógio da loja. O banco guarda em UTC (é o que
// o Prisma faz com DateTime), e o servidor pode estar em qualquer fuso — em
// produção ele já rodou em Londres. Por isso NADA aqui usa `getHours()` ou
// `new Date(ano, mes, dia)`: todo dia e toda hora passam por `diaEmSP`,
// `horaEmSP` e `deSP`, que perguntam ao Intl pelo fuso da loja. Assim o
// agrupamento "Hoje / Amanhã" não depende de onde o servidor acordou.
//
// ── o sinal é dinheiro que entrou, e entra no financeiro na hora ─
// A decisão: o sinal vira um `Lancamento` de RECEITA, já pago, na categoria de
// "outras receitas" (grupo RECEITA_OUTRA do DRE), com a loja da encomenda.
//
// Por quê. O DRE é por regime de caixa: conta o que entrou e saiu no mês. O
// sinal ENTROU — na gaveta ou no Pix — no dia em que a encomenda foi anotada.
// Se ele só aparecesse na entrega, a encomenda anotada em setembro e entregue
// em outubro deixaria setembro com dinheiro a mais no caixa e a menos no
// resultado; e a encomenda cancelada em que a loja fica com o sinal nunca
// apareceria em lugar nenhum. O DRE mentiria nos dois casos.
//
// E por que não conta duas vezes: a regra de `financeiro.ts` é que receita de
// VENDA não vira lançamento, porque mora em `vendas`. O sinal não é venda — é
// adiantamento. Na entrega, o que falta é recebido no balcão como venda, e a
// tela diz com todas as letras "lance no balcão só o que falta". Sinal
// (outras receitas) + venda do restante = o valor da encomenda, uma vez só.
//
// Mudar o sinal depois (editar, ou cancelar devolvendo) não reescreve o
// lançamento antigo: gera outro, com a diferença. Dinheiro que entrou em
// setembro continua tendo entrado em setembro; a devolução de outubro sai em
// outubro. É assim que o extrato do banco conta, e é com ele que o DRE tem de
// bater.
//
// O lançamento é escrito aqui, na mesma transação da encomenda, e não por
// `lancar()`: quem anota encomenda é o balcão, que não tem (nem deve ter)
// `financeiro.lancar`. É o mesmo raciocínio de a venda gravar a própria
// receita: dinheiro recebido com a pessoa na frente é trabalho de balcão.
//
// Puro em cima (datas, grupos, validação, transições), banco embaixo.

import type { SituacaoEncomenda, TipoLancamento } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, SemPermissao, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { CATEGORIAS_PADRAO } from './financeiro'
import { soDigitos } from './cliente'

export type { SituacaoEncomenda }

// ─────────────────────────────────────────────────────────────
// SITUAÇÃO
// ─────────────────────────────────────────────────────────────

export const SITUACOES_ENCOMENDA: readonly SituacaoEncomenda[] = ['ABERTA', 'PRONTA', 'ENTREGUE', 'CANCELADA']

export const ROTULO_ENCOMENDA: Record<SituacaoEncomenda, string> = {
  ABERTA: 'A fazer',
  PRONTA: 'Pronta',
  ENTREGUE: 'Entregue',
  CANCELADA: 'Cancelada',
}

/**
 * A cor da pílula. "A fazer" é neutro: é o estado normal de uma encomenda, e
 * pintar o normal ensina a ignorar a cor. Pronta é atenção — está esperando o
 * cliente, e encomenda pronta esquecida é bolo que estraga. Entregue é o que
 * concluiu. Cancelada volta ao neutro: não pede mais nada de ninguém.
 * (Atrasada não é situação, é hora: ela ganha o vermelho na tela.)
 */
export const NIVEL_ENCOMENDA: Record<SituacaoEncomenda, 'bom' | 'atencao' | 'critico' | 'neutro'> = {
  ABERTA: 'neutro',
  PRONTA: 'atencao',
  ENTREGUE: 'bom',
  CANCELADA: 'neutro',
}

/** Entregue e cancelada não voltam: o bolo saiu, ou o pedido morreu. */
export const FINAIS: readonly SituacaoEncomenda[] = ['ENTREGUE', 'CANCELADA']

export const ehFinal = (s: SituacaoEncomenda) => FINAIS.includes(s)

/**
 * Para onde cada situação pode ir.
 *
 * PRONTA → ABERTA existe para desfazer o clique errado ("marquei a do sábado
 * em vez da de hoje"). ENTREGUE e CANCELADA não saem: voltar uma entrega
 * reabriria dinheiro que já foi para o balcão, e desfazer um cancelamento
 * ressuscitaria um sinal que talvez já tenha sido devolvido. Quem errou nesses
 * casos anota uma encomenda nova — e o livro de auditoria guarda as duas.
 */
const TRANSICOES: Record<SituacaoEncomenda, readonly SituacaoEncomenda[]> = {
  ABERTA: ['PRONTA', 'ENTREGUE', 'CANCELADA'],
  PRONTA: ['ABERTA', 'ENTREGUE', 'CANCELADA'],
  ENTREGUE: [],
  CANCELADA: [],
}

export const transicaoPermitida = (de: SituacaoEncomenda, para: SituacaoEncomenda) =>
  TRANSICOES[de].includes(para)

export const situacaoEncomendaValida = (s: unknown): s is SituacaoEncomenda =>
  typeof s === 'string' && (SITUACOES_ENCOMENDA as readonly string[]).includes(s)

// ─────────────────────────────────────────────────────────────
// DINHEIRO
// ─────────────────────────────────────────────────────────────

/** O que falta receber, em reais. Nunca negativo: sinal maior que o valor é erro barrado antes. */
export function faltaPagar(valor: number | string | { toString(): string }, sinal: number | string | { toString(): string }): number {
  return reais(Math.max(centavos(valor) - centavos(sinal), 0))
}

// ─────────────────────────────────────────────────────────────
// DATAS NO FUSO DA LOJA
// ─────────────────────────────────────────────────────────────

export const ZONA = 'America/Sao_Paulo'

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** "2026-09-26" — o dia no relógio da loja. Compara como texto. */
export const diaEmSP = (d: Date): string => fmtDia.format(d)

/** "15:00" — a hora no relógio da loja. */
export const horaEmSP = (d: Date): string => fmtHora.format(d)

/** Quantos minutos São Paulo está à frente (negativo: atrás) do UTC naquele instante. */
function desvioSP(instante: Date): number {
  const [a, m, d] = diaEmSP(instante).split('-').map(Number) as [number, number, number]
  const [h, mi] = horaEmSP(instante).split(':').map(Number) as [number, number]
  const comoSeFosseUTC = Date.UTC(a, m - 1, d, h, mi)
  return Math.round((comoSeFosseUTC - Math.floor(instante.getTime() / 60000) * 60000) / 60000)
}

/**
 * "2026-09-26" + "15:00" (relógio da loja) → o instante certo, em UTC.
 *
 * Pergunta o desvio ao Intl em vez de escrever "-03:00" na mão: o Brasil já
 * teve horário de verão e pode voltar a ter, e a conta escrita à mão erraria
 * a hora de toda encomenda de novembro sem ninguém perceber. Devolve null para
 * data ou hora que não existem ("2026-02-30", "25:00").
 */
export function deSP(dia: string, hora: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(hora)) return null
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  const [h, mi] = hora.split(':').map(Number) as [number, number]
  if (h > 23 || mi > 59) return null
  const chute = Date.UTC(a, m - 1, d, h, mi)
  // Duas passadas: o desvio do chute pode ser o do outro lado de uma virada
  // de horário; a segunda acerta.
  let t = chute - desvioSP(new Date(chute)) * 60000
  t = chute - desvioSP(new Date(t)) * 60000
  const r = new Date(t)
  // A volta tem de dar o mesmo dia e a mesma hora — é o que barra 30 de fevereiro.
  if (diaEmSP(r) !== dia || horaEmSP(r) !== hora) return null
  return r
}

/** "2026-09-26" + n dias → "2026-09-28". Conta no calendário, sem fuso. */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "sex 26/09" — o dia da semana ajuda mais que a data para quem pensa "sábado". */
export function diaCurtoSP(d: Date): string {
  const [a, m, dd] = diaEmSP(d).split('-').map(Number) as [number, number, number]
  const semana = SEMANA[new Date(Date.UTC(a, m - 1, dd)).getUTCDay()]!
  return `${semana} ${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
// GRUPOS DA LISTA
// ─────────────────────────────────────────────────────────────

export type GrupoEncomenda = 'atrasadas' | 'hoje' | 'amanha' | 'semana' | 'depois' | 'passadas'

export const TITULO_GRUPO: Record<GrupoEncomenda, string> = {
  atrasadas: 'Atrasadas',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  semana: 'Esta semana',
  depois: 'Depois',
  passadas: 'Já passaram',
}

const ORDEM_GRUPOS: GrupoEncomenda[] = ['atrasadas', 'hoje', 'amanha', 'semana', 'depois', 'passadas']

/**
 * Em que faixa a encomenda cai.
 *
 * ATRASADA é por HORA, não por dia: o bolo das 10h que às 14h não saiu está
 * atrasado, mesmo sendo "de hoje" — é exatamente o que precisa gritar.
 * Entregue e cancelada nunca atrasam (não há mais o que fazer); as que já
 * passaram vão para "Já passaram", que só aparece quando a pessoa pede para
 * ver as concluídas.
 *
 * "Esta semana" é a semana que vem PELA FRENTE — de depois de amanhã até o
 * sexto dia a partir de hoje —, e não "até domingo": no sábado, a semana do
 * calendário acabaria amanhã e a faixa ficaria vazia justo quando a loja está
 * montando os pedidos da semana seguinte.
 */
export function grupoDa(e: { para: Date; situacao: SituacaoEncomenda }, agora: Date): GrupoEncomenda {
  const final = ehFinal(e.situacao)
  if (!final && e.para.getTime() < agora.getTime()) return 'atrasadas'
  const dia = diaEmSP(e.para)
  const hoje = diaEmSP(agora)
  if (dia < hoje) return 'passadas'
  if (dia === hoje) return final && e.para.getTime() < agora.getTime() ? 'passadas' : 'hoje'
  if (dia === somarDias(hoje, 1)) return 'amanha'
  if (dia <= somarDias(hoje, 6)) return 'semana'
  return 'depois'
}

/**
 * A lista em faixas, na ordem de urgência, cada faixa pelo que vence primeiro.
 * "Já passaram" vai do mais recente para o mais antigo — é histórico, e
 * histórico se lê de trás para frente. Faixa vazia não aparece.
 */
export function agrupar<T extends { para: Date; situacao: SituacaoEncomenda }>(
  lista: T[],
  agora: Date,
): { chave: GrupoEncomenda; titulo: string; itens: T[] }[] {
  const por = new Map<GrupoEncomenda, T[]>()
  for (const e of lista) {
    const g = grupoDa(e, agora)
    const l = por.get(g) ?? []
    l.push(e)
    por.set(g, l)
  }
  return ORDEM_GRUPOS.filter((g) => por.has(g)).map((g) => {
    const itens = [...por.get(g)!].sort((a, b) =>
      g === 'passadas' ? b.para.getTime() - a.para.getTime() : a.para.getTime() - b.para.getTime(),
    )
    return { chave: g, titulo: TITULO_GRUPO[g], itens }
  })
}

export type ResumoEncomendas = {
  atrasadas: number
  hoje: number
  /** Amanhã e o resto da semana pela frente: o que já dá para ir preparando. */
  semana: number
  /** Soma do que falta receber das encomendas em aberto. */
  aReceber: number
  /** Quantas têm alguma coisa a receber. */
  comSaldo: number
}

/** As contagens da tira. Só olha o que está em aberto: o que já saiu não pede nada. */
export function resumirEncomendas(
  lista: { para: Date; situacao: SituacaoEncomenda; valor: number; sinal: number }[],
  agora: Date,
): ResumoEncomendas {
  const r: ResumoEncomendas = { atrasadas: 0, hoje: 0, semana: 0, aReceber: 0, comSaldo: 0 }
  let aReceberC = 0
  for (const e of lista) {
    if (ehFinal(e.situacao)) continue
    const g = grupoDa(e, agora)
    if (g === 'atrasadas') r.atrasadas++
    else if (g === 'hoje') r.hoje++
    else if (g === 'amanha' || g === 'semana') r.semana++
    const falta = centavos(e.valor) - centavos(e.sinal)
    if (falta > 0) {
      aReceberC += falta
      r.comSaldo++
    }
  }
  r.aReceber = reais(aReceberC)
  return r
}

// ─────────────────────────────────────────────────────────────
// VALIDAÇÃO
// ─────────────────────────────────────────────────────────────

export type DadosEncomenda = {
  unidadeId: string
  clienteId?: string | null
  clienteNome?: string | null
  telefone?: string | null
  descricao: string
  valor: number
  sinal?: number | null
  /** "2026-09-26", no relógio da loja. */
  dia: string
  /** "15:00", no relógio da loja. */
  hora: string
  entrega: boolean
  endereco?: string | null
  observacao?: string | null
  /** A pessoa viu o aviso de "essa data já passou" e confirmou. */
  confirmarPassado?: boolean
}

export type EncomendaLimpa = {
  unidadeId: string
  clienteId: string | null
  clienteNome: string
  telefone: string | null
  descricao: string
  valorC: number
  sinalC: number
  para: Date
  entrega: boolean
  endereco: string | null
  observacao: string | null
}

const limpar = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/**
 * Confere tudo que vem da tela. O servidor não confia no formulário: é aqui
 * que o sinal maior que o valor, a data inventada e o valor negativo morrem.
 *
 * Data no passado é aceita SÓ com `confirmarPassado` — há um caso legítimo
 * (anotar depois a encomenda que já foi combinada de boca e está atrasada),
 * mas na maioria das vezes é o ano errado no campo, e encomenda com data
 * errada é a que não sai. Na edição, manter a data que já estava não pede
 * confirmação de novo: `paraAnterior` é a data gravada.
 */
export function validarEncomenda(
  d: DadosEncomenda,
  agora: Date,
  paraAnterior?: Date | null,
): { ok: true; limpo: EncomendaLimpa } | { ok: false; erro: string; pedeConfirmacao?: boolean } {
  const descricao = limpar(d.descricao, 500)
  if (!descricao) return { ok: false, erro: 'Descreva a encomenda: o que é, tamanho, sabor, o que vai escrito.' }

  const clienteId = limpar(d.clienteId, 64) || null
  const clienteNome = limpar(d.clienteNome, 120)
  if (!clienteId && !clienteNome) return { ok: false, erro: 'Para quem é? Escolha o cliente ou escreva o nome.' }

  const telefoneD = soDigitos(typeof d.telefone === 'string' ? d.telefone : '')
  if (telefoneD && (telefoneD.length < 10 || telefoneD.length > 11)) {
    return { ok: false, erro: 'O telefone precisa do DDD: 10 ou 11 números, como (71) 99999-0000.' }
  }

  if (typeof d.valor !== 'number' || !Number.isFinite(d.valor) || d.valor < 0) {
    return { ok: false, erro: 'O valor precisa ser zero ou mais.' }
  }
  const sinalN = d.sinal ?? 0
  if (typeof sinalN !== 'number' || !Number.isFinite(sinalN) || sinalN < 0) {
    return { ok: false, erro: 'O sinal precisa ser zero ou mais.' }
  }
  const valorC = centavos(d.valor)
  const sinalC = centavos(sinalN)
  if (valorC > 99_999_999) return { ok: false, erro: 'Valor alto demais. Confira os zeros.' }
  if (sinalC > valorC) return { ok: false, erro: 'O sinal não pode ser maior que o valor da encomenda.' }

  const para = deSP(d.dia, d.hora)
  if (!para) return { ok: false, erro: 'Escolha um dia e uma hora que existam.' }

  const mesmaData = paraAnterior && paraAnterior.getTime() === para.getTime()
  if (!mesmaData && para.getTime() < agora.getTime() && !d.confirmarPassado) {
    return {
      ok: false,
      pedeConfirmacao: true,
      erro: 'Essa data e hora já passaram. Se é isso mesmo (uma encomenda combinada antes e anotada agora), marque "a data já passou, é isso mesmo" e salve de novo.',
    }
  }

  const endereco = limpar(d.endereco, 300) || null
  if (d.entrega && !endereco) return { ok: false, erro: 'Para entregar, escreva o endereço.' }

  return {
    ok: true,
    limpo: {
      unidadeId: limpar(d.unidadeId, 64),
      clienteId,
      clienteNome,
      telefone: telefoneD || null,
      descricao,
      valorC,
      sinalC,
      para,
      entrega: !!d.entrega,
      endereco: d.entrega ? endereco : null,
      observacao: limpar(d.observacao, 1000) || null,
    },
  }
}

/** O link do WhatsApp. Número brasileiro sem o 55 ganha o 55; sem telefone, nada. */
export function linkWhatsApp(telefone: string | null | undefined): string | null {
  const d = soDigitos(telefone ?? '')
  if (d.length < 10) return null
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`
}

/** Um código curto para achar o lançamento do sinal no financeiro. */
export const codigoEncomenda = (id: string) => `ENC-${id.slice(-6).toUpperCase()}`

// ─────────────────────────────────────────────────────────────
// BANCO
// ─────────────────────────────────────────────────────────────

export type EncomendaNaLista = {
  id: string
  unidadeId: string
  unidadeNome: string
  clienteId: string | null
  clienteNome: string
  telefone: string | null
  descricao: string
  valor: number
  sinal: number
  falta: number
  para: Date
  entrega: boolean
  endereco: string | null
  situacao: SituacaoEncomenda
  observacao: string | null
  concluidaEm: Date | null
  quem: string
}

export type FiltroEncomendas = {
  unidadeIds: string[]
  /** 'abertas' (a fazer + prontas) é o padrão; 'todas' inclui entregues e canceladas. */
  situacao?: SituacaoEncomenda | 'abertas' | 'todas' | null
  q?: string | null
}

/** Das lojas pedidas, só as que esta pessoa alcança. Endereço colado não abre porta. */
function lojasPermitidas(sessao: Sessao, unidadeIds: string[], cap: 'venda.ver' | 'venda.criar' = 'venda.ver') {
  const permitidas = unidadesQuePodem(sessao, cap)
  return permitidas === 'todas' ? unidadeIds : unidadeIds.filter((u) => permitidas.includes(u))
}

const SELECT = {
  id: true, unidadeId: true, clienteId: true, clienteNome: true, telefone: true, descricao: true,
  valor: true, sinal: true, para: true, entrega: true, endereco: true, situacao: true,
  observacao: true, concluidaEm: true, quem: true,
  unidade: { select: { nome: true } },
} as const

type Linha = {
  id: string; unidadeId: string; clienteId: string | null; clienteNome: string; telefone: string | null
  descricao: string; valor: { toString(): string }; sinal: { toString(): string }; para: Date; entrega: boolean
  endereco: string | null; situacao: SituacaoEncomenda; observacao: string | null; concluidaEm: Date | null
  quem: string; unidade: { nome: string }
}

const naLista = (e: Linha): EncomendaNaLista => ({
  id: e.id,
  unidadeId: e.unidadeId,
  unidadeNome: e.unidade.nome,
  clienteId: e.clienteId,
  clienteNome: e.clienteNome,
  telefone: e.telefone,
  descricao: e.descricao,
  valor: reais(centavos(e.valor)),
  sinal: reais(centavos(e.sinal)),
  falta: faltaPagar(e.valor, e.sinal),
  para: e.para,
  entrega: e.entrega,
  endereco: e.endereco,
  situacao: e.situacao,
  observacao: e.observacao,
  concluidaEm: e.concluidaEm,
  quem: e.quem,
})

/**
 * A lista da tela. Abertas por padrão, do que vence primeiro para o último;
 * concluídas (entregues, canceladas) do mais recente para trás, porque aí a
 * pergunta é "o que saiu ontem?".
 */
export async function listarEncomendas(sessao: Sessao, f: FiltroEncomendas): Promise<EncomendaNaLista[]> {
  exigir(sessao, 'venda.ver')
  const lojas = lojasPermitidas(sessao, f.unidadeIds)
  if (lojas.length === 0) return []

  const sit = f.situacao ?? 'abertas'
  const q = f.q?.trim().slice(0, 80) ?? ''
  const digitos = soDigitos(q)
  const concluidas = sit === 'ENTREGUE' || sit === 'CANCELADA'

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.encomenda.findMany({
      where: {
        unidadeId: { in: lojas },
        ...(sit === 'abertas'
          ? { situacao: { in: ['ABERTA', 'PRONTA'] as SituacaoEncomenda[] } }
          : sit === 'todas'
            ? {}
            : { situacao: sit }),
        ...(q
          ? {
              AND: [
                {
                  OR: [
                    { clienteNome: { contains: q, mode: 'insensitive' as const } },
                    { descricao: { contains: q, mode: 'insensitive' as const } },
                    ...(digitos.length >= 3 ? [{ telefone: { contains: digitos } }] : []),
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: { para: concluidas ? 'desc' : 'asc' },
      take: 500,
      select: SELECT,
    })
    return linhas.map(naLista)
  })
}

/** A tira do topo: sempre sobre TODAS as abertas das lojas visíveis, sem o filtro da busca. */
export async function resumoEncomendas(sessao: Sessao, unidadeIds: string[], agora = new Date()): Promise<ResumoEncomendas> {
  exigir(sessao, 'venda.ver')
  const lojas = lojasPermitidas(sessao, unidadeIds)
  if (lojas.length === 0) return { atrasadas: 0, hoje: 0, semana: 0, aReceber: 0, comSaldo: 0 }

  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.encomenda.findMany({
      where: { unidadeId: { in: lojas }, situacao: { in: ['ABERTA', 'PRONTA'] } },
      select: { para: true, situacao: true, valor: true, sinal: true },
      take: 5000,
    }),
  )
  return resumirEncomendas(
    linhas.map((l) => ({ ...l, valor: reais(centavos(l.valor)), sinal: reais(centavos(l.sinal)) })),
    agora,
  )
}

/** Uma encomenda, para editar. Null se não existe ou é de loja que a pessoa não vê. */
export async function acharEncomenda(sessao: Sessao, id: string): Promise<EncomendaNaLista | null> {
  exigir(sessao, 'venda.ver')
  const e = await comoOrg(sessao.orgId, (db) => db.encomenda.findUnique({ where: { id }, select: SELECT }))
  if (!e || !pode(sessao, 'venda.ver', e.unidadeId)) return null
  return naLista(e)
}

/**
 * Clientes do cadastro, para escolher na encomenda. Oito no máximo: a lista
 * é para achar alguém cujo nome a pessoa já está digitando, não para navegar.
 */
export async function buscarClientesParaEncomenda(
  sessao: Sessao,
  termo: string,
): Promise<{ id: string; nome: string; telefone: string | null }[]> {
  exigir(sessao, 'venda.criar')
  exigir(sessao, 'cliente.ver')
  const t = termo.trim().slice(0, 80)
  if (t.length < 2) return []
  const digitos = soDigitos(t)
  return comoOrg(sessao.orgId, (db) =>
    db.cliente.findMany({
      where: {
        ativo: true,
        OR: [
          { nome: { contains: t, mode: 'insensitive' } },
          ...(digitos.length >= 3 ? [{ telefone: { contains: digitos } }] : []),
        ],
      },
      orderBy: { nome: 'asc' },
      take: 8,
      select: { id: true, nome: true, telefone: true },
    }),
  )
}

/* ── o dinheiro do sinal no financeiro ───────────────────────── */

/**
 * A categoria onde o sinal (ou a devolução dele) entra.
 *
 * Receita: a de "outras receitas" (grupo RECEITA_OUTRA), preferindo uma que a
 * empresa tenha chamado de encomenda ou sinal. Devolução: "outras despesas"
 * (grupo OUTRA) — não é custo de mercadoria nem despesa operacional de verdade,
 * e não pode sumir da conta, senão o sinal devolvido continuaria somando no
 * resultado.
 *
 * Empresa sem categoria nenhuma ganha as categorias padrão aqui mesmo: o
 * balcão não pode ficar sem anotar a encomenda porque ninguém abriu o
 * financeiro ainda.
 */
async function categoriaDoSinal(db: BancoDaOrg, orgId: string, tipo: TipoLancamento): Promise<string> {
  const grupo = tipo === 'RECEITA' ? 'RECEITA_OUTRA' : 'OUTRA'
  const padrao = tipo === 'RECEITA' ? 'Outras receitas' : 'Outras despesas'
  const achar = async () => {
    const cats = await db.categoriaFinanceira.findMany({
      where: { tipo, grupo, ativa: true },
      orderBy: { ordem: 'asc' },
      select: { id: true, nome: true },
    })
    return cats.find((c) => /encomenda|sinal/i.test(c.nome)) ?? cats.find((c) => c.nome === padrao) ?? cats[0]
  }

  const achada = await achar()
  if (achada) return achada.id

  if ((await db.categoriaFinanceira.count()) === 0) {
    await db.categoriaFinanceira.createMany({
      data: CATEGORIAS_PADRAO.map((c, i) => ({ orgId, ...c, ordem: i })),
    })
    const semeada = await achar()
    if (semeada) return semeada.id
  }

  const nome = tipo === 'RECEITA' ? 'Sinal de encomenda' : 'Devolução de sinal'
  const criada = await db.categoriaFinanceira.upsert({
    where: { orgId_nome: { orgId, nome } },
    update: { ativa: true },
    create: { orgId, nome, tipo, grupo, ordem: 99 },
    select: { id: true },
  })
  return criada.id
}

/** A data de hoje na loja, como a coluna DATE espera (meia-noite UTC do dia). */
const hojeComoDate = (agora: Date) => new Date(`${diaEmSP(agora)}T00:00:00.000Z`)

/**
 * Grava a entrada (ou a saída) do sinal como lançamento já pago, com a loja
 * da encomenda. Sempre DENTRO da transação de quem chama — se a encomenda não
 * gravar, o dinheiro também não.
 */
async function registrarSinal(
  db: BancoDaOrg,
  sessao: Sessao,
  e: { id: string; unidadeId: string; clienteNome: string; descricao: string },
  tipo: TipoLancamento,
  valorC: number,
  motivo: string,
  agora: Date,
) {
  if (valorC <= 0) return
  const categoriaId = await categoriaDoSinal(db, sessao.orgId, tipo)
  const hoje = hojeComoDate(agora)
  const descricao = `${motivo} — ${e.clienteNome}: ${e.descricao}`.slice(0, 200)
  const l = await db.lancamento.create({
    data: {
      orgId: sessao.orgId,
      unidadeId: e.unidadeId,
      categoriaId,
      tipo,
      descricao,
      valor: reais(valorC),
      vencimento: hoje,
      pagoEm: hoje,
      documento: codigoEncomenda(e.id),
      observacoes: 'Gerado pela encomenda. Não lance de novo no balcão.',
      quem: sessao.nome,
    },
    select: { id: true },
  })
  await db.auditoria.create({
    data: {
      orgId: sessao.orgId,
      unidadeId: e.unidadeId,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao: tipo === 'RECEITA' ? 'financeiro.receita' : 'financeiro.despesa',
      alvoTipo: 'lancamento',
      alvoId: l.id,
      alvoNome: descricao,
      valor: reais(valorC),
    },
  })
}

/* ── anotar e editar ─────────────────────────────────────────── */

export type Resultado = { ok: true; id: string } | { ok: false; erro: string; pedeConfirmacao?: boolean }

/** Anota a encomenda. O sinal, se houver, entra no financeiro na mesma transação. */
export async function criarEncomenda(sessao: Sessao, d: DadosEncomenda, agora = new Date()): Promise<Resultado> {
  exigir(sessao, 'venda.criar', d.unidadeId || undefined)
  if (!d.unidadeId) return { ok: false, erro: 'Escolha a loja da encomenda.' }

  const v = validarEncomenda(d, agora)
  if (!v.ok) return v
  const e = v.limpo

  return comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findFirst({ where: { id: e.unidadeId, ativa: true }, select: { id: true } })
    if (!loja) return { ok: false as const, erro: 'Essa loja não existe ou está desativada.' }

    let nome = e.clienteNome
    let telefone = e.telefone
    if (e.clienteId) {
      // O cadastro manda no nome; o telefone digitado na hora ganha, porque
      // é o que o cliente acabou de dizer.
      const c = await db.cliente.findUnique({ where: { id: e.clienteId }, select: { nome: true, telefone: true } })
      if (!c) return { ok: false as const, erro: 'Esse cliente não foi encontrado.' }
      nome = c.nome
      telefone = telefone ?? (c.telefone ? soDigitos(c.telefone) || null : null)
    }

    const criada = await db.encomenda.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: e.unidadeId,
        clienteId: e.clienteId,
        clienteNome: nome,
        telefone,
        descricao: e.descricao,
        valor: reais(e.valorC),
        sinal: reais(e.sinalC),
        para: e.para,
        entrega: e.entrega,
        endereco: e.endereco,
        observacao: e.observacao,
        quem: sessao.nome,
      },
      select: { id: true },
    })

    await registrarSinal(
      db, sessao,
      { id: criada.id, unidadeId: e.unidadeId, clienteNome: nome, descricao: e.descricao },
      'RECEITA', e.sinalC, 'Sinal de encomenda', agora,
    )

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: e.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'encomenda.criou',
        alvoTipo: 'encomenda',
        alvoId: criada.id,
        alvoNome: `${nome}: ${e.descricao}`.slice(0, 200),
        valor: reais(e.valorC),
        depois: {
          para: e.para.toISOString(),
          valor: reais(e.valorC),
          sinal: reais(e.sinalC),
          entrega: e.entrega,
        },
      },
    })
    return { ok: true as const, id: criada.id }
  })
}

/**
 * Muda o que foi anotado. Só enquanto está em aberto ou pronta: o que foi
 * entregue ou cancelado é histórico.
 *
 * A loja não muda na edição — mudar a encomenda de loja é mudar quem vai
 * fazer, e o sinal já entrou no caixa da primeira. Quem precisa disso cancela
 * e anota na outra.
 */
export async function editarEncomenda(
  sessao: Sessao,
  id: string,
  d: Omit<DadosEncomenda, 'unidadeId'>,
  agora = new Date(),
): Promise<Resultado> {
  exigir(sessao, 'venda.criar')

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.encomenda.findUnique({
      where: { id },
      select: {
        unidadeId: true, clienteId: true, clienteNome: true, telefone: true, descricao: true, valor: true,
        sinal: true, para: true, entrega: true, endereco: true, observacao: true, situacao: true,
      },
    })
    if (!antes) return { ok: false as const, erro: 'Essa encomenda não existe mais.' }
    if (!pode(sessao, 'venda.criar', antes.unidadeId)) throw new SemPermissao('venda.criar', antes.unidadeId)
    if (ehFinal(antes.situacao)) {
      return { ok: false as const, erro: `Esta encomenda já está ${ROTULO_ENCOMENDA[antes.situacao].toLowerCase()} e não muda mais.` }
    }

    const v = validarEncomenda({ ...d, unidadeId: antes.unidadeId }, agora, antes.para)
    if (!v.ok) return v
    const e = v.limpo

    let nome = e.clienteNome
    let telefone = e.telefone
    if (e.clienteId) {
      const c = await db.cliente.findUnique({ where: { id: e.clienteId }, select: { nome: true, telefone: true } })
      if (!c) return { ok: false as const, erro: 'Esse cliente não foi encontrado.' }
      nome = c.nome
      telefone = telefone ?? (c.telefone ? soDigitos(c.telefone) || null : null)
    }

    // Guarda contra dois cliques em telas diferentes: só grava se ninguém
    // concluiu a encomenda entre a leitura e agora.
    const r = await db.encomenda.updateMany({
      where: { id, situacao: antes.situacao },
      data: {
        clienteId: e.clienteId,
        clienteNome: nome,
        telefone,
        descricao: e.descricao,
        valor: reais(e.valorC),
        sinal: reais(e.sinalC),
        para: e.para,
        entrega: e.entrega,
        endereco: e.endereco,
        observacao: e.observacao,
      },
    })
    if (r.count === 0) return { ok: false as const, erro: 'Alguém mudou esta encomenda agora. Recarregue a tela.' }

    // A diferença do sinal é dinheiro que se moveu HOJE: mais sinal entrou,
    // ou parte dele voltou para o cliente. O lançamento antigo fica como está.
    const difC = e.sinalC - centavos(antes.sinal)
    const alvo = { id, unidadeId: antes.unidadeId, clienteNome: nome, descricao: e.descricao }
    if (difC > 0) await registrarSinal(db, sessao, alvo, 'RECEITA', difC, 'Complemento de sinal', agora)
    if (difC < 0) await registrarSinal(db, sessao, alvo, 'DESPESA', -difC, 'Devolução de parte do sinal', agora)

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: antes.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'encomenda.alterou',
        alvoTipo: 'encomenda',
        alvoId: id,
        alvoNome: `${nome}: ${e.descricao}`.slice(0, 200),
        valor: reais(e.valorC),
        antes: {
          clienteNome: antes.clienteNome,
          descricao: antes.descricao,
          valor: Number(antes.valor),
          sinal: Number(antes.sinal),
          para: antes.para.toISOString(),
          entrega: antes.entrega,
          endereco: antes.endereco,
        },
        depois: {
          clienteNome: nome,
          descricao: e.descricao,
          valor: reais(e.valorC),
          sinal: reais(e.sinalC),
          para: e.para.toISOString(),
          entrega: e.entrega,
          endereco: e.endereco,
        },
      },
    })
    return { ok: true as const, id }
  })
}

/* ── pronta, entregue, cancelada ─────────────────────────────── */

export type Mudanca =
  | { para: 'PRONTA' }
  | { para: 'ABERTA' }
  | { para: 'ENTREGUE' }
  | { para: 'CANCELADA'; motivo: string; devolveuSinal: boolean }

const ACAO_DA_MUDANCA: Record<SituacaoEncomenda, string> = {
  ABERTA: 'encomenda.alterou',
  PRONTA: 'encomenda.pronta',
  ENTREGUE: 'encomenda.entregou',
  CANCELADA: 'encomenda.cancelou',
}

/**
 * Anda a encomenda um passo.
 *
 * Cancelar pede `venda.cancelar` — o mesmo poder de cancelar uma venda, porque
 * o efeito é parecido: o pedido some e, às vezes, dinheiro volta. Motivo é
 * obrigatório pelo mesmo motivo. Se a loja devolveu o sinal, a devolução
 * entra no financeiro como saída de hoje; se ficou com ele (o cliente
 * desistiu em cima da hora), o sinal continua sendo receita, que é o que é.
 */
export async function mudarSituacao(
  sessao: Sessao,
  id: string,
  m: Mudanca,
  agora = new Date(),
): Promise<{ ok: true; falta: number } | { ok: false; erro: string }> {
  const cap = m.para === 'CANCELADA' ? 'venda.cancelar' : 'venda.criar'
  exigir(sessao, cap)
  const motivo = m.para === 'CANCELADA' ? m.motivo.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  if (m.para === 'CANCELADA' && motivo.length < 3) {
    return { ok: false, erro: 'Escreva o motivo do cancelamento.' }
  }

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.encomenda.findUnique({
      where: { id },
      select: {
        unidadeId: true, situacao: true, clienteNome: true, descricao: true, valor: true, sinal: true, observacao: true,
      },
    })
    if (!antes) return { ok: false as const, erro: 'Essa encomenda não existe mais.' }
    if (!pode(sessao, cap, antes.unidadeId)) throw new SemPermissao(cap, antes.unidadeId)
    if (!transicaoPermitida(antes.situacao, m.para)) {
      return {
        ok: false as const,
        erro: ehFinal(antes.situacao)
          ? `Esta encomenda já está ${ROTULO_ENCOMENDA[antes.situacao].toLowerCase()}.`
          : 'Essa mudança não é possível.',
      }
    }

    const r = await db.encomenda.updateMany({
      where: { id, situacao: antes.situacao },
      data: {
        situacao: m.para,
        concluidaEm: m.para === 'ENTREGUE' ? agora : null,
        ...(m.para === 'CANCELADA'
          ? { observacao: [antes.observacao, `Cancelada: ${motivo}`].filter(Boolean).join('\n').slice(0, 1300) }
          : {}),
      },
    })
    if (r.count === 0) return { ok: false as const, erro: 'Alguém mudou esta encomenda agora. Recarregue a tela.' }

    const sinalC = centavos(antes.sinal)
    if (m.para === 'CANCELADA' && m.devolveuSinal && sinalC > 0) {
      await registrarSinal(
        db, sessao,
        { id, unidadeId: antes.unidadeId, clienteNome: antes.clienteNome, descricao: antes.descricao },
        'DESPESA', sinalC, 'Devolução do sinal', agora,
      )
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: antes.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: ACAO_DA_MUDANCA[m.para],
        alvoTipo: 'encomenda',
        alvoId: id,
        alvoNome: `${antes.clienteNome}: ${antes.descricao}`.slice(0, 200),
        valor: Number(antes.valor),
        antes: { situacao: antes.situacao },
        depois: {
          situacao: m.para,
          ...(m.para === 'CANCELADA' ? { devolveuSinal: m.devolveuSinal && sinalC > 0 } : {}),
        },
        motivo: motivo || null,
      },
    })
    return { ok: true as const, falta: faltaPagar(antes.valor, antes.sinal) }
  })
}
