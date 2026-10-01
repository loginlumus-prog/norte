// Crediário: vender fiado com parcelas escritas, e receber.
//
// ── o que é, e o que não é ───────────────────────────────────
// É a venda paga em CREDIARIO: nasce com as parcelas já escritas — quantas,
// de quanto, para quando — e cada recebimento fica ligado à parcela que
// abateu. Não é cartão de crédito parcelado (isso é CREDITO, e a maquininha
// é quem parcela). É a loja emprestando, e por isso exige cliente com nome.
//
// ── atraso ───────────────────────────────────────────────────
// Parcelar não custa nada ao cliente aqui: o preço "no crediário" do produto
// já embute o risco. O que existe é o ATRASO — multa uma vez e juro ao mês,
// proporcional aos dias (ver recibos-conta.ts). Cobrança é conversa: quem
// negocia o crediário pode perdoar o atraso ou dar desconto, e quem só
// recebe pede a autorização dela na hora (recibos.ts).
//
// ── recebimento parcial ──────────────────────────────────────
// "Só tenho cinquenta hoje" é frase de todo dia. A parcela aceita pagamento
// parcial: o que entra abate, o resto continua vencendo. A parcela só quita
// quando o abatido alcança o valor.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, numeroDaBusca, pode, textoDaBusca, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { colunaDoDia, diaDaColuna, diaEmSP, somarDias } from './dia'
import { encargosDeHoje, MULTA_MAXIMA_CREDIARIO } from './recibos-conta'
import { regraDoAtraso, receberVarias } from './recibos'
import type { FormaPagamento, Prisma } from '@prisma/client'

// ─────────────────────────────────────────────────────────────
// AS CONTAS (puras)
// ─────────────────────────────────────────────────────────────

export type ParcelaMontada = { numero: number; de: number; vencimento: Date; valorCent: number }

/**
 * Divide o total em N parcelas iguais, em centavos inteiros. O que não
 * divide certo vai um centavo por vez para as PRIMEIRAS parcelas — a loja
 * recebe o resto antes, não depois.
 *
 * Os vencimentos andam em dias de calendário (não em 24h), a partir do dia de
 * HOJE EM SÃO PAULO, e saem prontos para a coluna `date`: meia-noite UTC do
 * dia, que é como o banco grava e devolve. Antes eram a meia-noite do fuso do
 * servidor — o dia certo só enquanto o servidor estivesse em São Paulo; num
 * servidor em UTC, a venda das 22h ganhava parcelas vencendo um dia depois.
 */
export function montarParcelas(
  totalCent: number,
  n: number,
  hoje: Date,
  diasEntre: number,
): ParcelaMontada[] {
  if (n < 1 || totalCent <= 0) return []
  const base = Math.floor(totalCent / n)
  const resto = totalCent - base * n
  const inicio = diaEmSP(hoje)
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    de: n,
    vencimento: colunaDoDia(somarDias(inicio, diasEntre * (i + 1))),
    valorCent: base + (i < resto ? 1 : 0),
  }))
}

// Os dias e o juro moram em recibos-conta.ts (puro, para a tela do balcão
// fazer a mesma conta); daqui saem com o nome de sempre.
export { diasDeAtraso, diasDeJuros, jurosDeAtraso, encargosDeHoje } from './recibos-conta'


// ─────────────────────────────────────────────────────────────
// LER
// ─────────────────────────────────────────────────────────────

export type SituacaoParcela = 'aberta' | 'vencida' | 'quitada'

export type ParcelaNaLista = {
  id: string
  vendaId: string
  vendaNumero: number
  clienteId: string
  cliente: string
  telefone: string | null
  unidade: string
  unidadeId: string
  numero: number
  de: number
  vencimento: Date
  valor: number
  pago: number
  /** Abatido sem dinheiro (desconto autorizado). */
  desconto: number
  juros: number
  multa: number
  resta: number
  situacao: SituacaoParcela
  diasAtraso: number
  /**
   * Os dias que o juro de hoje cobre: os de atraso menos os que já pagaram
   * juro num recebimento anterior (ver `diasDeJuros`) e menos a carência.
   */
  diasJuros: number
  /** A cobrança desta pessoa está pausada (crediario-gestao.ts): a dívida segue, o chamado não. */
  cobrancaPausada: boolean
  /** O juro sugerido para receber hoje, com a regra da empresa. */
  jurosHoje: number
  /** A multa de hoje (zero se já foi resolvida num recebimento anterior). */
  multaHoje: number
  quitadaEm: Date | null
}

export type FiltroParcelas = {
  unidadeIds: string[]
  situacao?: SituacaoParcela | null
  /** Nome do cliente ou número da venda. */
  q?: string | null
  clienteId?: string | null
  /**
   * A página da lista (a partir de 1) e o tamanho dela. Sem `porPagina`, vêm
   * as 500 primeiras — o caso da ficha do cliente, que nunca chega perto.
   * A tela do Crediário pagina SEMPRE: com o carnê de uma loja de verdade (8
   * mil parcelas em aberto) o teto de 500 cortava a lista calado, e a parcela
   * de 2026 de quem devia desde 2023 nunca aparecia.
   */
  pagina?: number
  porPagina?: number
}

/** O filtro da lista, num lugar só: a lista e a contagem precisam contar as mesmas parcelas. */
function ondeDasParcelas(f: FiltroParcelas, permitidas: string[], agora: Date): Prisma.ParcelaWhereInput {
  const q = textoDaBusca(f.q)
  const numero = numeroDaBusca(q)
  return {
    unidadeId: { in: permitidas },
    ...(f.clienteId ? { clienteId: f.clienteId } : {}),
    ...(f.situacao === 'quitada'
      ? { quitadaEm: { not: null } }
      : f.situacao === 'vencida'
        ? { quitadaEm: null, vencimento: { lt: colunaDoDia(diaEmSP(agora)) } }
        : f.situacao === 'aberta'
          ? { quitadaEm: null }
          : {}),
    ...(numero !== null
      ? { venda: { numero } }
      : q
        ? { cliente: { nome: { contains: q, mode: 'insensitive' } } }
        : {}),
  }
}

/** Quantas parcelas o filtro acha — o "de quantas" da paginação. */
export async function contarParcelas(sessao: Sessao, f: FiltroParcelas, agora = new Date()): Promise<number> {
  exigir(sessao, 'crediario.ver')
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'crediario.ver', u))
  if (permitidas.length === 0) return 0
  return comoOrg(sessao.orgId, (db) => db.parcela.count({ where: ondeDasParcelas(f, permitidas, agora) }))
}

export async function listarParcelas(sessao: Sessao, f: FiltroParcelas, agora = new Date()): Promise<ParcelaNaLista[]> {
  exigir(sessao, 'crediario.ver')
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'crediario.ver', u))
  if (permitidas.length === 0) return []

  const porPagina = f.porPagina && f.porPagina > 0 ? Math.floor(f.porPagina) : null
  const pagina = Math.max(1, Math.floor(f.pagina ?? 1) || 1)

  return comoOrg(sessao.orgId, async (db) => {
    const regra = await regraDoAtraso(db, sessao.orgId)

    const parcelas = await db.parcela.findMany({
      where: ondeDasParcelas(f, permitidas, agora),
      // O id desempata: sem ele, duas parcelas do mesmo dia podiam trocar de
      // página entre um clique e outro — uma aparecia duas vezes, a outra nunca.
      orderBy: [{ quitadaEm: 'asc' }, { vencimento: 'asc' }, { id: 'asc' }],
      skip: porPagina ? (pagina - 1) * porPagina : 0,
      take: porPagina ?? 500,
      select: {
        id: true, vendaId: true, clienteId: true, unidadeId: true, numero: true, de: true,
        vencimento: true, valor: true, pago: true, desconto: true, juros: true, multa: true,
        jurosAte: true, multaCobrada: true, quitadaEm: true,
        venda: { select: { numero: true } },
        cliente: { select: { nome: true, telefone: true, cobrancaPausadaEm: true } },
        unidade: { select: { nome: true } },
      },
    })

    return parcelas.map((p) => {
      const valorC = centavos(p.valor)
      const pagoC = centavos(p.pago)
      const descontoC = centavos(p.desconto)
      const restaC = Math.max(valorC - pagoC - descontoC, 0)
      const quitada = p.quitadaEm !== null
      const e = quitada
        ? { dias: 0, diasJuros: 0, multaC: 0, jurosC: 0 }
        : encargosDeHoje({ restaC, vencimento: p.vencimento, jurosAte: p.jurosAte, multaCobrada: p.multaCobrada }, regra, agora)
      return {
        id: p.id,
        vendaId: p.vendaId,
        vendaNumero: p.venda.numero,
        clienteId: p.clienteId,
        cliente: p.cliente.nome,
        telefone: p.cliente.telefone,
        unidade: p.unidade.nome,
        unidadeId: p.unidadeId,
        numero: p.numero,
        de: p.de,
        vencimento: p.vencimento,
        valor: reais(valorC),
        pago: reais(pagoC),
        desconto: reais(descontoC),
        juros: reais(centavos(p.juros)),
        multa: reais(centavos(p.multa)),
        resta: reais(restaC),
        situacao: quitada ? 'quitada' : e.dias > 0 ? 'vencida' : 'aberta',
        diasAtraso: e.dias,
        diasJuros: e.diasJuros,
        cobrancaPausada: !!p.cliente.cobrancaPausadaEm,
        jurosHoje: reais(e.jurosC),
        multaHoje: reais(e.multaC),
        quitadaEm: p.quitadaEm,
      }
    })
  })
}

export type Devedor = { id: string; nome: string; resta: number; vencido: number }

/**
 * Quem deve mais, para a conversa de cobrança começar pelo maior: primeiro
 * quem tem mais VENCIDO, depois quem deve mais no total. Quem está com a
 * cobrança pausada (acordo, advogado) fica fora — a lista é de quem COBRAR.
 *
 * Somado no banco, sobre TODAS as parcelas em aberto. A tela fazia a conta em
 * cima da lista que ela mostrava — as 500 primeiras —, e com o carnê de uma
 * loja de verdade "quem deve mais" saía de um pedaço dele.
 */
export async function maioresDevedores(sessao: Sessao, unidadeIds: string[], limite = 6, agora = new Date()): Promise<Devedor[]> {
  exigir(sessao, 'crediario.ver')
  const permitidas = unidadeIds.filter((u) => pode(sessao, 'crediario.ver', u))
  if (permitidas.length === 0) return []
  const hoje = colunaDoDia(diaEmSP(agora))
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.$queryRaw<{ id: string; nome: string; resta: string; vencido: string }[]>`
      select c.id, c.nome,
             sum(p.valor - p.pago - p.desconto) as resta,
             coalesce(sum(p.valor - p.pago - p.desconto) filter (where p.vencimento < ${hoje}), 0) as vencido
        from parcelas p join clientes c on c.id = p.cliente_id
       where p.unidade_id = any(${permitidas}) and p.quitada_em is null
         and c.cobranca_pausada_em is null
       group by c.id, c.nome
      having sum(p.valor - p.pago - p.desconto) > 0
       order by 4 desc, 3 desc, c.nome
       limit ${Math.max(1, Math.floor(limite))}
    `,
  )
  return linhas.map((l) => ({ id: l.id, nome: l.nome, resta: reais(centavos(l.resta)), vencido: reais(centavos(l.vencido)) }))
}

export type ResumoCrediario = {
  emAberto: number
  vencido: number
  aVencer7: number
  clientesDevendo: number
  clientesAtrasados: number
  parcelasVencidas: number
}

/** O que resta de uma parcela: o valor menos o pago e o desconto. */
const restaDe = (p: { valor: unknown; pago: unknown; desconto: unknown }) =>
  centavos(p.valor as number) - centavos(p.pago as number) - centavos(p.desconto as number)

/** Os números de cima da tela. */
export async function resumoCrediario(sessao: Sessao, unidadeIds: string[]): Promise<ResumoCrediario> {
  exigir(sessao, 'crediario.ver')
  const permitidas = unidadeIds.filter((u) => pode(sessao, 'crediario.ver', u))
  const vazio = { emAberto: 0, vencido: 0, aVencer7: 0, clientesDevendo: 0, clientesAtrasados: 0, parcelasVencidas: 0 }
  if (permitidas.length === 0) return vazio

  const hoje = diaEmSP()
  const em7 = somarDias(hoje, 8)

  return comoOrg(sessao.orgId, async (db) => {
    const abertas = await db.parcela.findMany({
      where: { unidadeId: { in: permitidas }, quitadaEm: null },
      select: { clienteId: true, vencimento: true, valor: true, pago: true, desconto: true },
    })
    const r = { ...vazio }
    const devendo = new Set<string>()
    const atrasados = new Set<string>()
    for (const p of abertas) {
      const resta = restaDe(p)
      if (resta <= 0) continue
      r.emAberto += resta
      devendo.add(p.clienteId)
      const dia = diaDaColuna(p.vencimento)
      if (dia < hoje) {
        r.vencido += resta
        r.parcelasVencidas++
        atrasados.add(p.clienteId)
      } else if (dia < em7) {
        r.aVencer7 += resta
      }
    }
    return {
      emAberto: reais(r.emAberto),
      vencido: reais(r.vencido),
      aVencer7: reais(r.aVencer7),
      clientesDevendo: devendo.size,
      clientesAtrasados: atrasados.size,
      parcelasVencidas: r.parcelasVencidas,
    }
  })
}

/**
 * Quanto cada cliente deve, para o balcão avisar "EM DIA" ou "ATRASADO" na
 * hora de escolher a pessoa. Recebe o `db` de quem já está numa transação.
 */
export async function situacaoDosClientes(
  db: BancoDaOrg,
  clienteIds: string[],
): Promise<Map<string, { devendo: number; vencido: number }>> {
  const mapa = new Map<string, { devendo: number; vencido: number }>()
  if (clienteIds.length === 0) return mapa
  const hoje = diaEmSP()
  const abertas = await db.parcela.findMany({
    where: { clienteId: { in: clienteIds }, quitadaEm: null },
    select: { clienteId: true, vencimento: true, valor: true, pago: true, desconto: true },
  })
  for (const p of abertas) {
    const resta = restaDe(p)
    if (resta <= 0) continue
    const atual = mapa.get(p.clienteId) ?? { devendo: 0, vencido: 0 }
    atual.devendo += resta
    if (diaDaColuna(p.vencimento) < hoje) atual.vencido += resta
    mapa.set(p.clienteId, atual)
  }
  for (const [k, v] of mapa) mapa.set(k, { devendo: reais(v.devendo), vencido: reais(v.vencido) })
  return mapa
}

export type SituacaoDeCredito = {
  clienteId: string
  nome: string
  /** O que ela deve NESTA loja: tudo, e o que já venceu. */
  devendo: number
  vencido: number
  parcelasVencidas: number
  /** Multa + juro de hoje sobre as vencidas (a conta da regra da empresa). */
  atrasoHoje: number
  /** Dias da parcela mais atrasada. */
  diasMaisAntiga: number
  /** O que ela deve nas outras lojas que a pessoa enxerga. */
  outrasLojas: { unidadeId: string; nome: string; devendo: number; vencido: number }[]
  /** A cobrança dela está pausada (acordo, advogado): o balcão avisa sem cobrar. */
  cobrancaPausada: boolean
}

/**
 * "Ela já deve": o aviso do balcão quando a cliente escolhida tem crediário
 * em aberto. Quanto deve nesta loja, quanto disso venceu, o atraso de hoje —
 * e o que deve nas outras lojas, só para saber (cada loja recebe o dela).
 * Nulo quando ela não deve nada em lugar nenhum que a pessoa enxergue.
 */
export async function situacaoDeCredito(
  sessao: Sessao,
  clienteId: string,
  unidadeId: string,
  agora = new Date(),
): Promise<SituacaoDeCredito | null> {
  exigir(sessao, 'crediario.ver')
  const visiveis = unidadesQuePodem(sessao, 'crediario.ver')
  if (visiveis.length === 0) return null
  return comoOrg(sessao.orgId, async (db) => {
    const regra = await regraDoAtraso(db, sessao.orgId)
    const abertas = await db.parcela.findMany({
      where: { clienteId, quitadaEm: null, ...(visiveis === 'todas' ? {} : { unidadeId: { in: visiveis } }) },
      select: {
        unidadeId: true, vencimento: true, valor: true, pago: true, desconto: true, jurosAte: true, multaCobrada: true,
        cliente: { select: { nome: true, cobrancaPausadaEm: true } },
        unidade: { select: { nome: true } },
      },
    })
    if (abertas.length === 0) return null
    const aqui = { devendo: 0, vencido: 0, vencidas: 0, atraso: 0, dias: 0 }
    const outras = new Map<string, { unidadeId: string; nome: string; devendo: number; vencido: number }>()
    for (const p of abertas) {
      const restaC = restaDe(p)
      if (restaC <= 0) continue
      const e = encargosDeHoje({ restaC, vencimento: p.vencimento, jurosAte: p.jurosAte, multaCobrada: p.multaCobrada }, regra, agora)
      if (p.unidadeId === unidadeId) {
        aqui.devendo += restaC
        if (e.dias > 0) {
          aqui.vencido += restaC
          aqui.vencidas++
          aqui.atraso += e.multaC + e.jurosC
          aqui.dias = Math.max(aqui.dias, e.dias)
        }
      } else {
        const o = outras.get(p.unidadeId) ?? { unidadeId: p.unidadeId, nome: p.unidade.nome, devendo: 0, vencido: 0 }
        o.devendo += restaC
        if (e.dias > 0) o.vencido += restaC
        outras.set(p.unidadeId, o)
      }
    }
    if (aqui.devendo === 0 && outras.size === 0) return null
    return {
      clienteId,
      nome: abertas[0]!.cliente.nome,
      devendo: reais(aqui.devendo),
      vencido: reais(aqui.vencido),
      parcelasVencidas: aqui.vencidas,
      atrasoHoje: reais(aqui.atraso),
      diasMaisAntiga: aqui.dias,
      outrasLojas: [...outras.values()].map((o) => ({ ...o, devendo: reais(o.devendo), vencido: reais(o.vencido) })),
      cobrancaPausada: !!abertas[0]!.cliente.cobrancaPausadaEm,
    }
  })
}

// ─────────────────────────────────────────────────────────────
// RECEBER UMA PARCELA (o caminho antigo, por cima do recibo)
// ─────────────────────────────────────────────────────────────

export type Recebido =
  | { ok: true; restante: number; quitada: boolean; juros: number; reciboId: string }
  | { ok: false; motivo: 'nao_achada' | 'ja_quitada' | 'valor_invalido' | 'passa_do_resto' | 'juros_acima' | 'recusado'; erro?: string }

/**
 * Recebe (parte de) UMA parcela — o jeito de antes, para quem chama com uma
 * parcela só. Por baixo é o recibo (recibos.ts): mesma trava, mesmo turno,
 * mesma regra de autorização.
 *
 * `valor` é o que entrou no total; `juros` é a parte dele que é atraso (multa
 * + juro). Cobrar MENOS atraso do que a regra pede é perdão: precisa de quem
 * negocia o crediário. Mais do que a regra, nunca.
 */
export async function receberParcela(
  sessao: Sessao,
  p: { parcelaId: string; valor: number; juros: number; forma: FormaPagamento; motivo?: string },
  agora = new Date(),
): Promise<Recebido> {
  // `centavos(NaN)` estoura com o erro cru do conversor; aqui é recusa.
  if (!Number.isFinite(p.valor) || !Number.isFinite(p.juros)) return { ok: false, motivo: 'valor_invalido' }
  const valorC = centavos(p.valor)
  const jurosC = Math.max(0, centavos(p.juros))
  const principalC = valorC - jurosC
  if (!(valorC > 0) || principalC <= 0) return { ok: false, motivo: 'valor_invalido' }

  const parcela = await comoOrg(sessao.orgId, async (db) => {
    const x = await db.parcela.findUnique({
      where: { id: p.parcelaId },
      select: { id: true, clienteId: true, unidadeId: true, vencimento: true, valor: true, pago: true, desconto: true, jurosAte: true, multaCobrada: true, quitadaEm: true },
    })
    if (!x) return null
    return { ...x, regra: await regraDoAtraso(db, sessao.orgId) }
  })
  if (!parcela) return { ok: false, motivo: 'nao_achada' }
  exigir(sessao, 'crediario.receber', parcela.unidadeId)
  if (parcela.quitadaEm) return { ok: false, motivo: 'ja_quitada' }
  const restaC = restaDe(parcela)
  if (principalC > restaC) return { ok: false, motivo: 'passa_do_resto' }
  const e = encargosDeHoje({ restaC, vencimento: parcela.vencimento, jurosAte: parcela.jurosAte, multaCobrada: parcela.multaCobrada }, parcela.regra, agora)
  const sugeridoC = e.multaC + e.jurosC
  if (jurosC > sugeridoC) return { ok: false, motivo: 'juros_acima' }

  const r = await receberVarias(
    sessao,
    {
      clienteId: parcela.clienteId,
      unidadeId: parcela.unidadeId,
      parcelaIds: [parcela.id],
      formas: [{ forma: p.forma, valor: reais(valorC) }],
      descontoAtraso: reais(sugeridoC - jurosC),
      motivo: p.motivo ?? (jurosC < sugeridoC ? 'atraso combinado no recebimento' : null),
    },
    agora,
  )
  if (!r.ok) return { ok: false, motivo: 'recusado', erro: r.erro }
  return { ok: true, restante: reais(restaC - principalC), quitada: principalC >= restaC, juros: reais(jurosC), reciboId: r.reciboId }
}

// ─────────────────────────────────────────────────────────────
// A REGRA DA EMPRESA
// ─────────────────────────────────────────────────────────────

export type ConfigCrediario = {
  jurosMes: number
  maxParcelas: number
  diasEntre: number
  multaPct: number
  carenciaDias: number
  arredondar: boolean
}

/** A configuração do crediário da empresa, para a tela e para o balcão. */
export async function configCrediario(sessao: Sessao): Promise<ConfigCrediario> {
  const org = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: {
        crediarioJurosMes: true, crediarioMaxParcelas: true, crediarioDiasEntre: true,
        crediarioMultaPct: true, crediarioCarenciaDias: true, crediarioArredondar: true,
      },
    }),
  )
  return {
    jurosMes: Number(org.crediarioJurosMes),
    maxParcelas: org.crediarioMaxParcelas,
    diasEntre: org.crediarioDiasEntre,
    multaPct: Number(org.crediarioMultaPct),
    carenciaDias: org.crediarioCarenciaDias,
    arredondar: org.crediarioArredondar,
  }
}

/**
 * Grava a regra. Os campos do atraso (multa, carência, arredondar) são
 * opcionais: quem não os manda (a tela antiga de Configurações) não os apaga.
 */
export async function salvarConfigCrediario(
  sessao: Sessao,
  c: { jurosMes: number; maxParcelas: number; diasEntre: number; multaPct?: number; carenciaDias?: number; arredondar?: boolean },
) {
  exigir(sessao, 'empresa.configurar')
  const jurosMes = Math.min(Math.max(Number(c.jurosMes) || 0, 0), 20)
  const maxParcelas = Math.min(Math.max(Math.round(Number(c.maxParcelas) || 1), 1), 24)
  const diasEntre = Math.min(Math.max(Math.round(Number(c.diasEntre) || 30), 7), 90)
  const atraso = {
    ...(c.multaPct !== undefined
      ? { crediarioMultaPct: Math.round(Math.min(Math.max(Number(c.multaPct) || 0, 0), MULTA_MAXIMA_CREDIARIO) * 100) / 100 }
      : {}),
    ...(c.carenciaDias !== undefined ? { crediarioCarenciaDias: Math.min(Math.max(Math.round(Number(c.carenciaDias) || 0), 0), 30) } : {}),
    ...(c.arredondar !== undefined ? { crediarioArredondar: !!c.arredondar } : {}),
  }
  await comoOrg(sessao.orgId, async (db) => {
    await db.org.update({
      where: { id: sessao.orgId },
      data: { crediarioJurosMes: jurosMes, crediarioMaxParcelas: maxParcelas, crediarioDiasEntre: diasEntre, ...atraso },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.configurou',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        alvoNome: 'crediário',
        depois: { jurosMes, maxParcelas, diasEntre, ...atraso },
      },
    })
  })
  return { jurosMes, maxParcelas, diasEntre }
}
