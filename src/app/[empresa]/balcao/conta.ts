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
import type { Tabela } from '@/servidor/preco'

/** O mínimo de uma linha que a conta precisa. A linha de verdade tem mais. */
export type LinhaDaConta = {
  preco: number
  precos?: Record<Tabela, number>
  quantidade: number
  avulso?: boolean
}

export type PagoDaConta = { forma: string; valor: number; referencia?: string; parcelas?: number }

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
  totalCent: number
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
  desconto: number,
  pontosCent: number,
): Conta {
  // A tabela de preço vem das formas já escolhidas. Sem forma, à vista.
  const tabela = tabelaDe(pagos.map((p) => p.forma))
  const totalCent = totalNa(carrinho, tabela)
  const comDescontoCent = Math.max(totalCent - cent(desconto), 0)
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

  return {
    tabela,
    totalCent,
    comDescontoCent,
    aPagarCent,
    pagoCent,
    faltaCent,
    temDinheiro,
    trocoCent,
    sobrouSemDinheiro,
    escada,
    temEscada,
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
  desconto: number,
  pontosCent: number,
): number {
  const t = tabelaDe([...pagos.map((p) => p.forma), nova])
  const aPagarNa = Math.max(Math.max(totalNa(carrinho, t) - cent(desconto), 0) - pontosCent, 0)
  return aPagarNa - pagos.reduce((s, p) => s + cent(p.valor), 0)
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
