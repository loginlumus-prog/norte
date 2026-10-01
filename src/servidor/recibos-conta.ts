// A conta do recibo do crediário — pura, sem banco, para a tela do balcão e o
// servidor fazerem a MESMA conta (a tela mostra; o servidor refaz e grava).
//
// ── o atraso ─────────────────────────────────────────────────
// Por parcela, como o varejo cobra e como a vendedora explica em voz alta:
//   MULTA  uma vez só, em % do que restava (teto de 2%, CDC art. 52 § 1º);
//   JURO   ao mês, proporcional aos dias, contado do vencimento — ou do dia até
//          onde já foi cobrado (`jurosAte`), para não cobrar duas vezes os
//          mesmos dias de quem pagou metade semana passada;
//   CARÊNCIA  dias perdoados antes de a conta começar.
// Parcela que ainda não venceu não rende: quem adianta não paga atraso.
//
// ── o que vai para onde ──────────────────────────────────────
// A fila é: as parcelas MARCADAS primeiro (da mais antiga para a mais nova),
// depois as outras, também da mais antiga. Em cada parcela o dinheiro paga
// primeiro o atraso dela, depois abate o valor. Assim:
//   • marcou três e pagou menos: abate na ordem, a última fica parcial;
//   • pagou mais que as marcadas: a sobra cai nas mais antigas que faltam —
//     quem pagou a mais não perde o dinheiro dentro do sistema;
//   • não marcou nada ("só tenho cinquenta"): abate das mais antigas.
// O que não fecha é recusado com o número que resolve: dinheiro que não cobre
// nem o atraso da parcela seguinte (abater sem pagar o atraso seria perdoá-lo
// sem autorização), e dinheiro acima da dívida inteira.
//
// ── desconto e perdão ────────────────────────────────────────
// Os dois só nas MARCADAS, e os dois com autorização (quem confere é o
// servidor — ver recibos.ts):
//   • perdoar o atraso (todo, ou parte em R$): sai do juro primeiro, depois da
//     multa, da mais antiga para a mais nova, só nas parcelas que este
//     dinheiro alcança;
//   • desconto nas parcelas (em R$): abate sem dinheiro entrar — e só vale para
//     QUITAR as marcadas. Desconto em parcela que continua aberta vira uma
//     dívida que ninguém sabe explicar depois.

import { diaDaColuna as diaUTC, diaEmSP as diaSP, diasEntre as entre } from './dia'

const FORMAS_COM_MAQUININHA = ['PIX', 'DEBITO', 'CREDITO'] as const
export const temMaquininha = (forma: string) => (FORMAS_COM_MAQUININHA as readonly string[]).includes(forma)

/** Teto da multa — Código de Defesa do Consumidor, art. 52, § 1º. */
export const MULTA_MAXIMA_CREDIARIO = 2

export type RegraAtraso = {
  multaPct: number
  jurosMes: number
  carenciaDias: number
  arredondar: boolean
}

// ─────────────────────────────────────────────────────────────
// OS DIAS E O JURO (puros; a data vem como a coluna `date` devolve)
// ─────────────────────────────────────────────────────────────

/**
 * Dias de calendário vencidos. O dia do vencimento ainda não é atraso.
 *
 * `vencimento` é o valor da coluna `date` como o banco devolve (meia-noite
 * UTC do dia); `agora` é um instante, lido no calendário de São Paulo. Ver
 * `dia.ts` — antes disto a conta dava um dia a mais e o juro saía maior.
 */
export function diasDeAtraso(vencimento: Date, agora: Date): number {
  const dias = entre(diaUTC(vencimento), diaSP(agora))
  return dias > 0 ? dias : 0
}

/**
 * Dias de atraso que AINDA não pagaram juro: contados do vencimento ou do dia
 * até onde o juro já foi cobrado (`jurosAte`), o que vier depois.
 *
 * O caso: parcela de R$ 100 com 30 dias de atraso, a 2% ao mês. A pessoa paga
 * R$ 50 + R$ 2,00 de juro hoje. Uma semana depois, o juro sugerido é o de 7
 * dias sobre os 50 que restam (R$ 0,23) — e não o de 37 dias (R$ 1,23), que
 * cobraria de novo os 30 dias que ela já pagou.
 */
export function diasDeJuros(vencimento: Date, jurosAte: Date | null | undefined, agora: Date): number {
  const venc = diaUTC(vencimento)
  const ate = jurosAte ? diaUTC(jurosAte) : null
  const desde = ate && ate > venc ? ate : venc
  const dias = entre(desde, diaSP(agora))
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

export type Encargos = {
  /** Dias de atraso (o dia do vencimento ainda não é atraso). */
  dias: number
  /** Os dias que o juro de hoje cobre — sem os já pagos e sem a carência. */
  diasJuros: number
  multaC: number
  jurosC: number
}

/**
 * Multa e juro de HOJE para uma parcela, sobre o que resta.
 *
 * Dentro da carência, nada. Passou dela, a multa (se ainda não foi
 * resolvida) e o juro dos dias depois da carência — ou dos dias depois do
 * último juro cobrado, quando já houve um.
 */
export function encargosDeHoje(
  p: { restaC: number; vencimento: Date; jurosAte: Date | null; multaCobrada: boolean },
  regra: Pick<RegraAtraso, 'multaPct' | 'jurosMes' | 'carenciaDias'>,
  agora: Date,
): Encargos {
  const dias = diasDeAtraso(p.vencimento, agora)
  const carencia = Math.max(0, Math.floor(regra.carenciaDias || 0))
  if (p.restaC <= 0 || dias <= carencia) return { dias, diasJuros: 0, multaC: 0, jurosC: 0 }
  const jaCobrouDepois = !!p.jurosAte && diaUTC(p.jurosAte) > diaUTC(p.vencimento)
  const diasJuros = Math.max(0, diasDeJuros(p.vencimento, p.jurosAte, agora) - (jaCobrouDepois ? 0 : carencia))
  const jurosC = jurosDeAtraso(p.restaC, diasJuros, regra.jurosMes)
  const multaPct = Math.min(Math.max(regra.multaPct, 0), MULTA_MAXIMA_CREDIARIO)
  const multaC = p.multaCobrada ? 0 : Math.floor((p.restaC * multaPct) / 100)
  return { dias, diasJuros, multaC, jurosC }
}

// ─────────────────────────────────────────────────────────────
// O PLANO DO RECIBO
// ─────────────────────────────────────────────────────────────

/** Uma parcela em aberto, já com o atraso de hoje. A lista vem da mais antiga para a mais nova. */
export type ParcelaParaReceber = { id: string; restaC: number; multaC: number; jurosC: number }

/** O que a tela mostra ao marcar: a soma das marcadas, com o atraso. */
export type ContaDasMarcadas = {
  quantas: number
  principalC: number
  multaC: number
  jurosC: number
  /** Os centavos que o arredondamento pôs no juro (0 quando a loja não arredonda). */
  arredondamentoC: number
  /** principal + multa + juro (+ arredondamento). */
  totalC: number
}

/** O atraso de cada marcada, com o arredondamento já posto na última que tem atraso. */
function atrasoDasMarcadas(parcelas: ParcelaParaReceber[], marcadas: ReadonlySet<string>, arredondar: boolean) {
  const enc = new Map(parcelas.map((p) => [p.id, { multaC: p.multaC, jurosC: p.jurosC }]))
  let arredondamentoC = 0
  if (arredondar) {
    const comAtraso = parcelas.filter((p) => marcadas.has(p.id) && p.multaC + p.jurosC > 0)
    const soma = comAtraso.reduce((s, p) => s + p.multaC + p.jurosC, 0)
    if (soma > 0) {
      arredondamentoC = Math.ceil(soma / 10) * 10 - soma
      const ultima = enc.get(comAtraso[comAtraso.length - 1]!.id)!
      ultima.jurosC += arredondamentoC
    }
  }
  return { enc, arredondamentoC }
}

export function contaDasMarcadas(
  parcelas: ParcelaParaReceber[],
  marcadas: Iterable<string>,
  arredondar: boolean,
): ContaDasMarcadas {
  const m = new Set(marcadas)
  const { enc, arredondamentoC } = atrasoDasMarcadas(parcelas, m, arredondar)
  const r = { quantas: 0, principalC: 0, multaC: 0, jurosC: 0, arredondamentoC, totalC: 0 }
  for (const p of parcelas) {
    if (!m.has(p.id)) continue
    const e = enc.get(p.id)!
    r.quantas++
    r.principalC += p.restaC
    r.multaC += e.multaC
    r.jurosC += e.jurosC
  }
  r.totalC = r.principalC + r.multaC + r.jurosC
  return r
}

export type PedidoDoPlano = {
  /** Os ids marcados (a ordem não importa: a fila é sempre da mais antiga). */
  marcadas: Iterable<string>
  /** O dinheiro que entrou e abate (todas as formas somadas, sem o troco). */
  dinheiroC: number
  /** Perdoar TODO o atraso das marcadas. */
  perdoarAtraso?: boolean
  /** Perdoar parte do atraso das marcadas, em centavos. */
  descontoAtrasoC?: number
  /** Desconto no valor das marcadas, em centavos (só para quitá-las). */
  descontoC?: number
  arredondar?: boolean
  /**
   * Baixa externa: o atraso foi resolvido lá fora (ou não houve). O dinheiro
   * abate só o valor das parcelas, e não conta como perdão.
   */
  semAtraso?: boolean
}

export type LinhaDoPlano = {
  id: string
  multaC: number
  jurosC: number
  /** O que o dinheiro abateu do valor. */
  principalC: number
  /** O que o desconto abateu do valor (sem dinheiro). */
  descontoC: number
  /** O atraso que a conta pedia e não foi cobrado. */
  perdoadoC: number
  /** A parcela quitou (dinheiro + desconto alcançaram o que restava). */
  quita: boolean
  /** Havia atraso a cobrar nela hoje — e ele ficou resolvido (cobrado ou perdoado). */
  atrasoResolvido: boolean
}

export type RecusaDoPlano =
  | { motivo: 'nada' }
  | { motivo: 'passa_da_divida'; maximoC: number }
  | { motivo: 'nao_cobre_atraso'; minimoC: number; ateAquiC: number }
  | { motivo: 'desconto_sem_marcar' }
  | { motivo: 'desconto_demais'; maximoC: number }
  | { motivo: 'desconto_sem_quitar'; faltaC: number }

export type Plano =
  | {
      ok: true
      linhas: LinhaDoPlano[]
      dinheiroC: number
      principalC: number
      multaC: number
      jurosC: number
      descontoC: number
      perdoadoC: number
      arredondamentoC: number
    }
  | ({ ok: false } & RecusaDoPlano)

export function planejarRecebimento(parcelas: ParcelaParaReceber[], pedido: PedidoDoPlano): Plano {
  const marc = new Set(pedido.marcadas)
  const semAtraso = !!pedido.semAtraso
  const { enc, arredondamentoC } = semAtraso
    ? { enc: new Map(parcelas.map((p) => [p.id, { multaC: 0, jurosC: 0 }])), arredondamentoC: 0 }
    : atrasoDasMarcadas(parcelas, marc, !!pedido.arredondar)

  const marcadas = parcelas.filter((p) => marc.has(p.id))
  const atrasoMarcadasC = marcadas.reduce((s, p) => s + enc.get(p.id)!.multaC + enc.get(p.id)!.jurosC, 0)
  const restaMarcadasC = marcadas.reduce((s, p) => s + p.restaC, 0)

  let perdao = pedido.perdoarAtraso ? atrasoMarcadasC : Math.max(0, Math.floor(pedido.descontoAtrasoC ?? 0))
  let desconto = Math.max(0, Math.floor(pedido.descontoC ?? 0))
  if (semAtraso) perdao = 0
  if ((perdao > 0 || desconto > 0) && marcadas.length === 0) return { ok: false, motivo: 'desconto_sem_marcar' }
  if (!pedido.perdoarAtraso && perdao > atrasoMarcadasC) return { ok: false, motivo: 'desconto_demais', maximoC: atrasoMarcadasC }
  if (desconto > restaMarcadasC) return { ok: false, motivo: 'desconto_demais', maximoC: restaMarcadasC }

  let dinheiro = Math.max(0, Math.floor(pedido.dinheiroC))
  const fila = [...marcadas, ...parcelas.filter((p) => !marc.has(p.id))]
  const linhas: LinhaDoPlano[] = []
  let gastoC = 0

  for (const p of fila) {
    const marcada = marc.has(p.id)
    const e = enc.get(p.id)!
    const atrasoC = e.multaC + e.jurosC
    const descP = marcada ? Math.min(desconto, p.restaC) : 0
    if (dinheiro <= 0 && descP === 0) break
    const perd = marcada ? Math.min(perdao, atrasoC) : 0
    const custo = atrasoC - perd
    if (dinheiro < custo) {
      return { ok: false, motivo: 'nao_cobre_atraso', minimoC: gastoC + custo, ateAquiC: gastoC }
    }
    dinheiro -= custo
    const principalC = Math.min(dinheiro, p.restaC - descP)
    dinheiro -= principalC
    perdao -= perd
    desconto -= descP
    gastoC += custo + principalC
    const perdJuros = Math.min(perd, e.jurosC)
    linhas.push({
      id: p.id,
      jurosC: e.jurosC - perdJuros,
      multaC: e.multaC - (perd - perdJuros),
      principalC,
      descontoC: descP,
      perdoadoC: perd,
      quita: principalC + descP >= p.restaC,
      atrasoResolvido: atrasoC > 0,
    })
  }

  if (dinheiro > 0) return { ok: false, motivo: 'passa_da_divida', maximoC: gastoC }
  if (linhas.length === 0) return { ok: false, motivo: 'nada' }
  if ((pedido.descontoC ?? 0) > 0) {
    const abertas = marcadas.filter((p) => !linhas.some((l) => l.id === p.id && l.quita))
    if (abertas.length > 0) {
      // Quanto faltou de dinheiro para quitar todas as marcadas.
      const faltaC = marcadas.reduce((s, p) => {
        const l = linhas.find((x) => x.id === p.id)
        const e = enc.get(p.id)!
        return s + (l ? p.restaC - l.principalC - l.descontoC : p.restaC + e.multaC + e.jurosC)
      }, 0)
      return { ok: false, motivo: 'desconto_sem_quitar', faltaC }
    }
  }

  const soma = (k: 'principalC' | 'multaC' | 'jurosC' | 'descontoC' | 'perdoadoC') => linhas.reduce((s, l) => s + l[k], 0)
  return {
    ok: true,
    linhas,
    dinheiroC: gastoC,
    principalC: soma('principalC'),
    multaC: soma('multaC'),
    jurosC: soma('jurosC'),
    descontoC: soma('descontoC'),
    perdoadoC: soma('perdoadoC'),
    arredondamentoC: linhas.length ? arredondamentoC : 0,
  }
}

/** A frase da recusa, com o número que resolve. */
export function explicarRecusa(r: RecusaDoPlano, brl: (cent: number) => string): string {
  switch (r.motivo) {
    case 'nada':
      return 'Marque as parcelas ou digite quanto ela está pagando.'
    case 'passa_da_divida':
      return `Passa do que ela deve nesta loja: o máximo é ${brl(r.maximoC)}. O que sobrar em dinheiro é troco.`
    case 'nao_cobre_atraso':
      return r.ateAquiC > 0
        ? `Com este valor a próxima parcela não paga nem o atraso dela. Receba ${brl(r.ateAquiC)}, ou ${brl(r.minimoC)} ou mais — ou peça para perdoar o atraso.`
        : `Este valor não cobre nem o atraso da parcela mais antiga (${brl(r.minimoC)}). Receba ao menos isso — ou peça para perdoar o atraso.`
    case 'desconto_sem_marcar':
      return 'Desconto e perdão do atraso valem só para as parcelas marcadas. Marque as parcelas.'
    case 'desconto_demais':
      return `O desconto passa do que as marcadas devem: no máximo ${brl(r.maximoC)}.`
    case 'desconto_sem_quitar':
      return `Desconto é para quitar as marcadas: faltam ${brl(r.faltaC)} para fechar todas. Receba o total, ou desmarque alguma.`
  }
}

// ─────────────────────────────────────────────────────────────
// AS FORMAS: cada pedaço de dinheiro vira um recebimento
// ─────────────────────────────────────────────────────────────

export type FormaDoRecibo = { forma: string; valorC: number; maquininha?: string | null }

export type PedacoDoRecibo = {
  parcelaId: string
  forma: string
  maquininha: string | null
  valorC: number
  multaC: number
  jurosC: number
  descontoC: number
}

/**
 * Reparte o dinheiro das formas pelas parcelas do plano, na ordem: a primeira
 * forma paga as primeiras parcelas, e assim por diante. Cada pedaço (parcela ×
 * forma) é um recebimento — é o que deixa o fechamento somar por forma e a
 * ficha da parcela dizer como ela foi paga.
 *
 * Dentro da parcela, o pedaço paga a multa, depois o juro, depois o valor. O
 * desconto vai no primeiro pedaço dela; parcela quitada só com desconto ganha
 * um pedaço de valor zero (na primeira forma), para o desconto ter registro.
 */
export function repartirNasFormas(linhas: LinhaDoPlano[], formas: FormaDoRecibo[]): PedacoDoRecibo[] {
  const fila = formas.filter((f) => f.valorC > 0).map((f) => ({ ...f, sobraC: f.valorC }))
  const primeira = fila[0] ?? formas[0] ?? { forma: 'DINHEIRO', maquininha: null }
  const pedacos: PedacoDoRecibo[] = []
  let i = 0
  for (const l of linhas) {
    let multa = l.multaC
    let juros = l.jurosC
    let principal = l.principalC
    let desconto = l.descontoC
    let precisa = multa + juros + principal
    if (precisa === 0) {
      pedacos.push({ parcelaId: l.id, forma: primeira.forma, maquininha: primeira.maquininha ?? null, valorC: 0, multaC: 0, jurosC: 0, descontoC: desconto })
      continue
    }
    while (precisa > 0 && i < fila.length) {
      const f = fila[i]!
      const v = Math.min(precisa, f.sobraC)
      const m = Math.min(multa, v)
      const j = Math.min(juros, v - m)
      pedacos.push({ parcelaId: l.id, forma: f.forma, maquininha: f.maquininha ?? null, valorC: v, multaC: m, jurosC: j, descontoC: desconto })
      desconto = 0
      multa -= m
      juros -= j
      principal -= v - m - j
      precisa -= v
      f.sobraC -= v
      if (f.sobraC === 0) i++
    }
  }
  return pedacos
}
