// A conta da venda, sem tela.
//
// ── por que saiu do Balcao.tsx ───────────────────────────────
// O balcão agora tem duas caras — o simples, de botões grandes, e o avançado,
// de busca e tabela — e as duas fecham a MESMA venda. Se cada uma fizesse a
// própria conta de troco, cedo ou tarde uma delas daria troco diferente da
// outra para a mesma compra. Então a conta mora aqui, uma vez, e as duas telas
// só mostram o que ela diz.
//
// Tudo em centavos inteiros (ver servidor/dinheiro.ts). Nada aqui decide
// preço nem aceita venda: o servidor refaz tudo ao fechar. Isto é a conta que
// a tela mostra para a pessoa conferir com o cliente na frente.
//
// Os imports de valor são relativos, e não '@/…', de propósito: os testes
// rodam este arquivo direto, sem o apelido do Next.

import { multiplicar } from '../../../servidor/dinheiro'
import { tabelaDe } from '../../../servidor/preco'
import { plural } from '../../../ui/texto'
import type { Tabela } from '@/servidor/preco'

/** O mínimo de uma linha que a conta precisa. A linha de verdade tem mais. */
export type LinhaDaConta = {
  preco: number
  precos?: Record<Tabela, number>
  quantidade: number
  avulso?: boolean
}

export type PagoDaConta = {
  forma: string
  valor: number
  referencia?: string
  parcelas?: number
  /** Em qual maquininha caiu (Pix, débito, crédito) — ver servidor/maquininhas.ts. */
  maquininha?: string | null
  /** Crediário: o dia do 1º vencimento ('AAAA-MM-DD'). */
  primeiroVencimento?: string | null
}

/**
 * O que mexe no total além dos itens: o desconto (em R$ ou em %) e o
 * acréscimo (a etiqueta velha da peça que saiu da promoção).
 *
 * O desconto em % é guardado COMO %: a forma de pagamento muda a tabela, e
 * 10% do preço do cartão não é o mesmo dinheiro que 10% do à vista. Guardado
 * em reais, trocar Pix por Crédito deixaria o desconto do Pix valendo.
 */
export type Ajustes = { desconto: number; descontoEmPct?: boolean; acrescimo?: number }

const comoAjustes = (d: number | Ajustes): Ajustes => (typeof d === 'number' ? { desconto: d } : d)

/**
 * O desconto em centavos sobre uma base (as peças, na tabela da forma).
 * Em %, nunca passa de 100; em reais, nunca passa da base — venda negativa
 * não existe, é dinheiro saindo da gaveta.
 */
export function descontoEmCentavos(baseCent: number, a: Ajustes): number {
  const v = Number.isFinite(a.desconto) ? Math.max(a.desconto, 0) : 0
  const cents = a.descontoEmPct ? Math.round((baseCent * Math.min(v, 100)) / 100) : cent(v)
  return Math.min(cents, Math.max(baseCent, 0))
}

const acrescimoEmCentavos = (a: Ajustes) =>
  Number.isFinite(a.acrescimo) ? Math.max(cent(a.acrescimo ?? 0), 0) : 0

export const cent = (v: number) => Math.round(v * 100)

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * O preço desta linha nesta tabela. Avulso tem um preço só (quem digitou não
 * digitou três). Carrinho guardado antes da escada existir não tem `precos`:
 * vale o à vista que ele sempre teve.
 */
export const precoDe = (l: LinhaDaConta, t: Tabela) =>
  l.avulso ? l.preco : (l.precos?.[t] ?? l.preco)

export const linhaCent = (l: LinhaDaConta, t: Tabela) => multiplicar(cent(precoDe(l, t)), l.quantidade)

export const totalNa = (carrinho: LinhaDaConta[], t: Tabela) =>
  carrinho.reduce((s, l) => s + linhaCent(l, t), 0)

export type Conta = {
  tabela: Tabela
  /** Já escolheu alguma forma? Antes disso a tabela mostrada é a mais cara (ver `contar`). */
  escolheu: boolean
  totalCent: number
  descontoCent: number
  acrescimoCent: number
  /** Total com desconto e acréscimo, antes dos pontos. */
  comDescontoCent: number
  aPagarCent: number
  pagoCent: number
  /** Positivo: falta receber. Negativo: recebeu a mais. */
  faltaCent: number
  temDinheiro: boolean
  trocoCent: number
  /** Passou do total sem dinheiro na venda: não há de onde dar troco. Trava. */
  sobrouSemDinheiro: boolean
  escada: Record<Tabela, number>
  temEscada: boolean
  /**
   * Antes de escolher a forma: quanto a cliente economiza pagando à vista
   * (Pix, dinheiro) sobre o preço mostrado. Zero quando já escolheu.
   */
  economiaCent: number
}

/**
 * A conta inteira de uma vez.
 *
 * `pontosCent` entra pronto porque o valor do ponto é do programa da loja, e
 * quem sabe dele é pontos.ts — aqui só se subtrai.
 */
export function contar(
  carrinho: LinhaDaConta[],
  pagos: PagoDaConta[],
  desconto: number | Ajustes,
  pontosCent: number,
  /**
   * A tabela mostrada ANTES de escolher a forma. A loja de três preços mostra
   * o mais caro (o do crediário, ou o do cartão) e, embaixo, quanto se
   * economiza à vista: é o preço cheio que dá sentido ao desconto do Pix —
   * e venda nenhuma fecha sem forma escolhida, então ninguém paga este
   * número sem querer. Sem vir, à vista, como sempre foi.
   */
  semForma: Tabela = 'vista',
): Conta {
  const a = comoAjustes(desconto)
  // A tabela de preço vem das formas já escolhidas. Sem forma, a de `semForma`.
  const escolheu = pagos.length > 0
  const tabela = escolheu ? tabelaDe(pagos.map((p) => p.forma)) : semForma
  const totalCent = totalNa(carrinho, tabela)
  const descontoCent = descontoEmCentavos(totalCent, a)
  const acrescimoCent = acrescimoEmCentavos(a)
  const comDescontoCent = Math.max(totalCent - descontoCent + acrescimoCent, 0)
  const aPagarCent = Math.max(comDescontoCent - pontosCent, 0)
  const pagoCent = pagos.reduce((s, p) => s + cent(p.valor), 0)
  const faltaCent = aPagarCent - pagoCent

  // Troco só existe em dinheiro. Cartão e Pix não devolvem diferença — se
  // sobrar ali, é erro de digitação, e a venda tem que travar em vez de "dar
  // troco" de um valor que nunca entrou na gaveta.
  const temDinheiro = pagos.some((p) => p.forma === 'DINHEIRO')
  const trocoCent = temDinheiro ? Math.max(-faltaCent, 0) : 0
  const sobrouSemDinheiro = !temDinheiro && faltaCent < 0

  // A escada: os três totais. Só aparece quando são diferentes — loja que
  // cobra igual em tudo não precisa saber que a escada existe.
  const escada = {
    vista: totalNa(carrinho, 'vista'),
    cartao: totalNa(carrinho, 'cartao'),
    crediario: totalNa(carrinho, 'crediario'),
  }
  const temEscada = escada.cartao !== escada.vista || escada.crediario !== escada.vista
  const economiaCent = escolheu ? 0 : Math.max(escada[tabela] - escada.vista, 0)

  return {
    tabela,
    escolheu,
    totalCent,
    descontoCent,
    acrescimoCent,
    comDescontoCent,
    aPagarCent,
    pagoCent,
    faltaCent,
    temDinheiro,
    trocoCent,
    sobrouSemDinheiro,
    escada,
    temEscada,
    economiaCent,
  }
}

/**
 * Quanto falta se a forma `nova` entrar agora.
 *
 * A conta é feita na tabela que a NOVA forma puxa: escolher Crédito numa venda
 * à vista sobe o total, e o que falta tem que sair já com o total de cartão.
 */
export function faltaCom(
  carrinho: LinhaDaConta[],
  pagos: PagoDaConta[],
  nova: string,
  desconto: number | Ajustes,
  pontosCent: number,
): number {
  const a = comoAjustes(desconto)
  const t = tabelaDe([...pagos.map((p) => p.forma), nova])
  const base = totalNa(carrinho, t)
  const aPagarNa = Math.max(Math.max(base - descontoEmCentavos(base, a) + acrescimoEmCentavos(a), 0) - pontosCent, 0)
  return aPagarNa - pagos.reduce((s, p) => s + cent(p.valor), 0)
}

/**
 * O juro do crédito parcelado, em centavos — a mesma conta do servidor
 * (venda.ts, "o juro do crédito parcelado"): só em 2× ou mais, sobre o valor
 * deste pagamento, arredondado ao centavo.
 */
export function jurosDoCredito(valorCent: number, parcelas: number, pct: number): number {
  if (parcelas <= 1 || !(pct > 0) || valorCent <= 0) return 0
  return Math.round((valorCent * pct) / 100)
}

/** O nome da forma como a pessoa fala — "CREDIARIO" é o nome do banco, não o dela. */
export const NOME_DA_FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  CREDIARIO: 'Crediário',
  VALE: 'Vale-troca',
  TRANSFERENCIA: 'Transferência',
}

/**
 * Um pagamento numa linha, como se fala no balcão: "Crediário 3×",
 * "Crédito 2× · Stone", "Pix · Conta PJ". A maquininha vai junto porque é o
 * que a pessoa confere no fim do turno ("passou na Stone ou na Cielo?").
 */
export function rotuloDoPago(p: { forma: string; parcelas?: number | null; maquininha?: string | null }): string {
  const nome = NOME_DA_FORMA[p.forma] ?? p.forma
  const n = Math.max(1, Math.floor(p.parcelas ?? 1) || 1)
  // O crediário diz as vezes sempre (1× também é carnê); o crédito, só
  // parcelado — "Crédito 1×" é o crédito à vista de todo dia.
  const vezes = p.forma === 'CREDIARIO' || (p.forma === 'CREDITO' && n > 1) ? ` ${n}×` : ''
  const maq = p.maquininha?.trim() ? ` · ${p.maquininha.trim()}` : ''
  return `${nome}${vezes}${maq}`
}

/**
 * Como a venda foi paga, numa linha: a forma, ou "Dividido: Pix + Dinheiro".
 * É o que a tela de "venda concluída" mostra embaixo do número — antes saía o
 * nome do banco ("CREDIARIO"), que ninguém no balcão fala.
 */
export function rotuloDoPagamento(pagos: { forma: string; parcelas?: number | null; maquininha?: string | null }[]): string {
  const partes = pagos.map(rotuloDoPago)
  if (partes.length <= 1) return partes[0] ?? ''
  return `Dividido: ${partes.join(' + ')}`
}

/**
 * Os pagamentos como vão para o servidor.
 *
 * O troco não é pagamento: o que entra no sistema é o que FICA na gaveta. E ele
 * sai do último dinheiro, nunca do cartão. A subtração é em centavos — em real
 * quebrado, 100 − 17,10 dá 82,8999… e quem confere a gaveta vê o centavo torto.
 */
export function pagamentosParaEnviar(pagos: PagoDaConta[], trocoCent: number) {
  const limpos = pagos.map((p) => ({
    forma: p.forma,
    valor: p.valor,
    referencia: p.referencia,
    parcelas: p.parcelas,
    maquininha: p.maquininha ?? undefined,
    primeiroVencimento: p.primeiroVencimento ?? undefined,
  }))
  if (trocoCent === 0) return limpos
  const ultimoDinheiro = limpos.map((p) => p.forma).lastIndexOf('DINHEIRO')
  return limpos.map((p, i) =>
    i === ultimoDinheiro ? { ...p, valor: (cent(p.valor) - trocoCent) / 100 } : p,
  )
}

/**
 * As notas que a pessoa provavelmente vai entregar, para um toque só.
 *
 * Numa venda de R$ 83, o cliente dá 83 certinho, ou 85, 90, 100. Com o botão
 * pronto, a caixa não digita "100,00" com a fila esperando — e não erra a
 * vírgula. A primeira é sempre o valor exato; as outras são o próximo valor
 * redondo de cada nota comum (5, 10, 20, 50, 100), sem repetir. Quando o valor
 * já é redondo, entram as notas seguintes, que é o que acontece com R$ 100
 * pago com duas de cem.
 */
export function notasSugeridas(faltaCent: number, quantas = 4): number[] {
  if (faltaCent <= 0) return []
  const acima = (passo: number) => Math.ceil(faltaCent / passo) * passo
  const lista = [faltaCent]
  const juntar = (v: number) => {
    if (!lista.includes(v) && v > faltaCent) lista.push(v)
  }
  for (const passo of [500, 1000, 2000, 5000, 10000]) juntar(acima(passo))
  // Valor já redondo em nota de cem (R$ 100, R$ 200): nenhuma nota "acima"
  // apareceu. Entram as seguintes de cinquenta, até cem a mais — quem paga
  // R$ 100 com R$ 150 existe; com R$ 400, não.
  if (lista.length < 2) {
    for (let v = faltaCent + 5000; v <= faltaCent + 10000 && lista.length < quantas; v += 5000) {
      juntar(v)
    }
  }
  return lista.sort((a, b) => a - b).slice(0, quantas)
}

/**
 * Em que passo a venda está, para a tela acender o próximo.
 *
 * 1 — escolher como pagou; 2 — conferir o valor (e o troco, no dinheiro);
 * 3 — concluir. Sem item nenhum, 0: não há o que pagar ainda.
 */
export function passoAtual(o: {
  itens: number
  pagos: number
  faltaCent: number
  sobrouSemDinheiro: boolean
}): 0 | 1 | 2 | 3 {
  if (o.itens === 0) return 0
  if (o.pagos === 0) return 1
  if (o.faltaCent > 0 || o.sobrouSemDinheiro) return 2
  return 3
}

/**
 * O CPF confere (os dois dígitos verificadores)? A mesma conta de
 * `cpfValido` do servidor (servidor/cliente.ts), repetida aqui porque aquele
 * arquivo fala com o banco e não roda no navegador. O servidor confere de
 * novo ao fechar — esta é só para a tela avisar com a cliente na frente.
 */
export function cpfConfere(bruto: string): boolean {
  const d = bruto.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const digito = (ate: number) => {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10])
}

/** 'AAAA-MM' → 'mm/aaaa', o jeito de dizer "cliente desde 03/2024". */
const mesAno = (m: string | null | undefined) => (m && /^\d{4}-\d{2}$/.test(m) ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : null)

/**
 * O histórico em uma linha. Quem só tem compra trazida do sistema anterior (o
 * carnê importado) não é "primeira compra aqui": compra na loja há anos, só
 * que não por este sistema — e a vendedora que ouve "primeira compra" trata
 * como desconhecida a cliente de sempre.
 */
export function historicoDoCliente(
  c: { compras: number; gastou: number; anteriores?: number; desde?: string | null },
  p: { compra: string; compras: string; vendaFeminina: boolean },
): string {
  const trazidas = c.anteriores ?? 0
  const desde = trazidas > 0 ? mesAno(c.desde) : null
  const cliente = desde ? ` · cliente desde ${desde}` : ''
  if (c.compras > 0) return `${plural(c.compras, p.compra, p.compras)} · ${brl(c.gastou)}${cliente}`
  if (trazidas > 0) return `${plural(trazidas, p.compra, p.compras)} no sistema anterior${cliente}`
  return `${p.vendaFeminina ? 'primeira' : 'primeiro'} ${p.compra} aqui`
}
