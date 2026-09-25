// Crediário: vender fiado com parcelas escritas, e receber.
//
// ── o que é, e o que não é ───────────────────────────────────
// É a venda paga em CREDIARIO: nasce com as parcelas já escritas — quantas,
// de quanto, para quando — e cada recebimento fica ligado à parcela que
// abateu. Não é cartão de crédito parcelado (isso é CREDITO, e a maquininha
// é quem parcela). É a loja emprestando, e por isso exige cliente com nome.
//
// ── juros ────────────────────────────────────────────────────
// Parcelar não custa nada ao cliente aqui: o preço "no crediário" do produto
// já embute o risco. O que existe é juro de ATRASO — X% ao mês sobre o que
// ficou vencido, proporcional aos dias — e quem recebe pode mudar o valor
// com a pessoa na frente, porque cobrança é conversa, não fórmula.
//
// ── recebimento parcial ──────────────────────────────────────
// "Só tenho cinquenta hoje" é frase de todo dia. A parcela aceita pagamento
// parcial: o que entra abate, o resto continua vencendo. A parcela só quita
// quando o abatido alcança o valor.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, numeroDaBusca, pode, textoDaBusca, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { colunaDoDia, diaDaColuna, diaEmSP, diasEntre, somarDias } from './dia'
import type { FormaPagamento } from '@prisma/client'

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

/**
 * Dias de calendário vencidos. O dia do vencimento ainda não é atraso.
 *
 * `vencimento` é o valor da coluna `date` como o banco devolve (meia-noite
 * UTC do dia); `agora` é um instante, lido no calendário de São Paulo. Ver
 * `dia.ts` — antes disto a conta dava um dia a mais e o juro saía maior.
 */
export function diasDeAtraso(vencimento: Date, agora: Date): number {
  const dias = diasEntre(diaDaColuna(vencimento), diaEmSP(agora))
  return dias > 0 ? dias : 0
}

/**
 * Juro de atraso, em centavos: pctMes ao mês, proporcional aos dias, sobre o
 * que resta. Para baixo — a sobra fica com o cliente, nunca cobrada a mais.
 */
export function jurosDeAtraso(restanteCent: number, dias: number, pctMes: number): number {
  if (restanteCent <= 0 || dias <= 0 || pctMes <= 0) return 0
  return Math.floor((restanteCent * pctMes * dias) / (100 * 30))
}

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
  juros: number
  resta: number
  situacao: SituacaoParcela
  diasAtraso: number
  /** O juro sugerido para receber hoje, com a taxa da empresa. */
  jurosHoje: number
}

export type FiltroParcelas = {
  unidadeIds: string[]
  situacao?: SituacaoParcela | null
  /** Nome do cliente ou número da venda. */
  q?: string | null
  clienteId?: string | null
}

export async function listarParcelas(sessao: Sessao, f: FiltroParcelas): Promise<ParcelaNaLista[]> {
  exigir(sessao, 'crediario.ver')
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'crediario.ver', u))
  if (permitidas.length === 0) return []

  const q = textoDaBusca(f.q)
  const numero = numeroDaBusca(q)
  const agora = new Date()

  return comoOrg(sessao.orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: { crediarioJurosMes: true },
    })
    const pct = Number(org.crediarioJurosMes)

    const parcelas = await db.parcela.findMany({
      where: {
        unidadeId: { in: permitidas },
        ...(f.clienteId ? { clienteId: f.clienteId } : {}),
        ...(f.situacao === 'quitada'
          ? { quitadaEm: { not: null } }
          : f.situacao === 'vencida'
            ? { quitadaEm: null, vencimento: { lt: colunaDoDia(diaEmSP()) } }
            : f.situacao === 'aberta'
              ? { quitadaEm: null }
              : {}),
        ...(numero !== null
          ? { venda: { numero } }
          : q
            ? { cliente: { nome: { contains: q, mode: 'insensitive' } } }
            : {}),
      },
      orderBy: [{ quitadaEm: 'asc' }, { vencimento: 'asc' }],
      take: 500,
      select: {
        id: true, vendaId: true, clienteId: true, unidadeId: true, numero: true, de: true,
        vencimento: true, valor: true, pago: true, juros: true, quitadaEm: true,
        venda: { select: { numero: true } },
        cliente: { select: { nome: true, telefone: true } },
        unidade: { select: { nome: true } },
      },
    })

    return parcelas.map((p) => {
      const valorC = centavos(p.valor)
      const pagoC = centavos(p.pago)
      const restaC = Math.max(valorC - pagoC, 0)
      const quitada = p.quitadaEm !== null
      const dias = quitada ? 0 : diasDeAtraso(p.vencimento, agora)
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
        juros: reais(centavos(p.juros)),
        resta: reais(restaC),
        situacao: quitada ? 'quitada' : dias > 0 ? 'vencida' : 'aberta',
        diasAtraso: dias,
        jurosHoje: reais(jurosDeAtraso(restaC, dias, pct)),
      }
    })
  })
}

export type ResumoCrediario = {
  emAberto: number
  vencido: number
  aVencer7: number
  clientesDevendo: number
  clientesAtrasados: number
  parcelasVencidas: number
}

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
      select: { clienteId: true, vencimento: true, valor: true, pago: true },
    })
    const r = { ...vazio }
    const devendo = new Set<string>()
    const atrasados = new Set<string>()
    for (const p of abertas) {
      const resta = centavos(p.valor) - centavos(p.pago)
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
    select: { clienteId: true, vencimento: true, valor: true, pago: true },
  })
  for (const p of abertas) {
    const resta = centavos(p.valor) - centavos(p.pago)
    if (resta <= 0) continue
    const atual = mapa.get(p.clienteId) ?? { devendo: 0, vencido: 0 }
    atual.devendo += resta
    if (diaDaColuna(p.vencimento) < hoje) atual.vencido += resta
    mapa.set(p.clienteId, atual)
  }
  for (const [k, v] of mapa) mapa.set(k, { devendo: reais(v.devendo), vencido: reais(v.vencido) })
  return mapa
}

// ─────────────────────────────────────────────────────────────
// RECEBER
// ─────────────────────────────────────────────────────────────

export type Recebido =
  | { ok: true; restante: number; quitada: boolean; juros: number }
  | { ok: false; motivo: 'nao_achada' | 'ja_quitada' | 'valor_invalido' | 'passa_do_resto' | 'caixa_fechado' }

/**
 * Recebe (parte de) uma parcela.
 *
 * `valor` é o que entrou no total; `juros` é a parte dele que é juro de
 * atraso. O que sobra abate a parcela. Em dinheiro, precisa de caixa aberto
 * na unidade — o dinheiro entra na gaveta e o fechamento tem que saber.
 */
export async function receberParcela(
  sessao: Sessao,
  p: { parcelaId: string; valor: number; juros: number; forma: FormaPagamento },
): Promise<Recebido> {
  // `centavos(NaN)` estoura com o erro cru do conversor; aqui é recusa.
  if (!Number.isFinite(p.valor) || !Number.isFinite(p.juros)) return { ok: false, motivo: 'valor_invalido' }
  const valorC = centavos(p.valor)
  const jurosC = Math.max(0, centavos(p.juros))
  const principalC = valorC - jurosC
  if (!(valorC > 0) || principalC <= 0) return { ok: false, motivo: 'valor_invalido' }

  return comoOrg(sessao.orgId, async (db) => {
    const parcela = await db.parcela.findUnique({
      where: { id: p.parcelaId },
      select: {
        id: true, unidadeId: true, numero: true, de: true, valor: true, pago: true, quitadaEm: true,
        venda: { select: { numero: true } },
        cliente: { select: { id: true, nome: true } },
      },
    })
    if (!parcela) return { ok: false as const, motivo: 'nao_achada' as const }
    exigir(sessao, 'crediario.receber', parcela.unidadeId)
    if (parcela.quitadaEm) return { ok: false as const, motivo: 'ja_quitada' as const }

    const restaC = centavos(parcela.valor) - centavos(parcela.pago)
    if (principalC > restaC) return { ok: false as const, motivo: 'passa_do_resto' as const }

    let caixaId: string | null = null
    if (p.forma === 'DINHEIRO') {
      const caixa = await db.caixa.findFirst({
        where: { unidadeId: parcela.unidadeId, aberto: true },
        select: { id: true },
      })
      if (!caixa) return { ok: false as const, motivo: 'caixa_fechado' as const }
      caixaId = caixa.id
    }

    // A parcela é gravada ANTES do recebimento, e só se o `pago` ainda for o
    // que foi lido. Dois recebimentos da mesma parcela ao mesmo tempo (o
    // clique duplo no "Receber", ou duas pessoas no balcão) liam o mesmo
    // `pago` e gravavam o mesmo total: nasciam dois recebimentos — o caixa
    // contava o dinheiro duas vezes — e a parcela abatia uma só. Com a
    // condição, o segundo não acha mais a linha como ela estava, e desiste.
    const novoPagoC = centavos(parcela.pago) + principalC
    const quitada = novoPagoC >= centavos(parcela.valor)
    const gravou = await db.parcela.updateMany({
      where: { id: parcela.id, pago: parcela.pago, quitadaEm: null },
      data: {
        pago: reais(novoPagoC),
        juros: { increment: reais(jurosC) },
        quitadaEm: quitada ? new Date() : null,
      },
    })
    if (gravou.count === 0) return { ok: false as const, motivo: 'ja_quitada' as const }

    await db.recebimento.create({
      data: {
        orgId: sessao.orgId,
        parcelaId: parcela.id,
        caixaId,
        forma: p.forma,
        valor: reais(valorC),
        juros: reais(jurosC),
        quem: sessao.nome,
      },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: parcela.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'crediario.recebeu',
        alvoTipo: 'cliente',
        alvoId: parcela.cliente.id,
        alvoNome: parcela.cliente.nome,
        valor: reais(valorC),
        motivo: `parcela ${parcela.numero}/${parcela.de} da venda ${parcela.venda.numero}${
          jurosC > 0 ? ` · juros ${reais(jurosC).toFixed(2)}` : ''
        }${quitada ? ' · quitada' : ' · parcial'}`,
      },
    })

    return { ok: true as const, restante: reais(restaC - principalC), quitada, juros: reais(jurosC) }
  })
}

/** A configuração do crediário da empresa, para a tela e para o balcão. */
export async function configCrediario(sessao: Sessao) {
  const org = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: { crediarioJurosMes: true, crediarioMaxParcelas: true, crediarioDiasEntre: true },
    }),
  )
  return {
    jurosMes: Number(org.crediarioJurosMes),
    maxParcelas: org.crediarioMaxParcelas,
    diasEntre: org.crediarioDiasEntre,
  }
}

export async function salvarConfigCrediario(
  sessao: Sessao,
  c: { jurosMes: number; maxParcelas: number; diasEntre: number },
) {
  exigir(sessao, 'empresa.configurar')
  const jurosMes = Math.min(Math.max(Number(c.jurosMes) || 0, 0), 20)
  const maxParcelas = Math.min(Math.max(Math.round(Number(c.maxParcelas) || 1), 1), 24)
  const diasEntre = Math.min(Math.max(Math.round(Number(c.diasEntre) || 30), 7), 90)
  await comoOrg(sessao.orgId, async (db) => {
    await db.org.update({
      where: { id: sessao.orgId },
      data: { crediarioJurosMes: jurosMes, crediarioMaxParcelas: maxParcelas, crediarioDiasEntre: diasEntre },
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
        depois: { jurosMes, maxParcelas, diasEntre },
      },
    })
  })
  return { jurosMes, maxParcelas, diasEntre }
}
