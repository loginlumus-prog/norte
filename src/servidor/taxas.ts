// A taxa por forma de pagamento.
//
// ── o buraco que isto fecha ──────────────────────────────────
// O DRE mostrava o bruto do cartão. O que entra na conta da loja é menos: a
// maquininha fica com 1%, 2%, 4% conforme a forma e o parcelamento, e o Pix
// de conta empresarial também cobra. Sem a taxa, o lucro do mês estava
// errado PARA CIMA em toda loja que aceita cartão — o erro que ninguém
// percebe olhando a tela, só no extrato.
//
// Aqui a loja escreve a taxa uma vez e o DRE desconta sozinho, venda a
// venda, na linha "Financeiras". Quem preferir lançar a taxa à mão (pelo
// extrato da maquininha) zera os campos e continua como antes.
//
// Quatro linhas bastam: Pix, débito, crédito à vista, crédito parcelado. É
// onde a taxa muda de verdade; separar 2× de 12× seria precisão que a
// própria maquininha arredonda.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import type { FormaPagamento } from '@prisma/client'

export type Taxa = { forma: FormaPagamento; parcelas: number; percentual: number }

export const FORMAS_COM_TAXA: { forma: FormaPagamento; parcelas: number; rotulo: string; dica: string }[] = [
  { forma: 'PIX', parcelas: 1, rotulo: 'Pix', dica: 'Conta pessoal não cobra; conta empresarial costuma cobrar até 1%.' },
  { forma: 'DEBITO', parcelas: 1, rotulo: 'Cartão de débito', dica: 'Fica entre 1% e 2% na maioria das maquininhas.' },
  { forma: 'CREDITO', parcelas: 1, rotulo: 'Crédito à vista', dica: 'De 2% a 4%. É a taxa que mais pesa no mês.' },
  { forma: 'CREDITO', parcelas: 2, rotulo: 'Crédito parcelado (2× ou mais)', dica: 'Mais alta, e a maquininha paga em 30 dias por parcela.' },
]

/** A taxa que vale para um pagamento. Zero quando a loja não escreveu. */
export function taxaDe(taxas: Taxa[], forma: FormaPagamento, parcelas: number): number {
  const alvo = forma === 'CREDITO' && parcelas >= 2 ? 2 : 1
  const exata = taxas.find((t) => t.forma === forma && t.parcelas === alvo)
  if (exata) return exata.percentual
  // Crédito parcelado sem taxa própria usa a do crédito à vista.
  if (forma === 'CREDITO' && alvo === 2) {
    return taxas.find((t) => t.forma === 'CREDITO' && t.parcelas === 1)?.percentual ?? 0
  }
  return 0
}

/** A taxa em centavos, sobre um valor em centavos. Meio-para-cima, como a operadora. */
export function taxaEmCentavos(valorCent: number, percentual: number): number {
  if (valorCent <= 0 || percentual <= 0) return 0
  return Math.round((valorCent * percentual) / 100)
}

export async function taxasDaEmpresa(sessao: Sessao): Promise<Taxa[]> {
  return comoOrg(sessao.orgId, (db) => lerTaxas(db))
}

/** As taxas, de dentro de uma transação já aberta. */
export async function lerTaxas(db: BancoDaOrg): Promise<Taxa[]> {
  const linhas = await db.taxaPagamento.findMany({
    select: { forma: true, parcelas: true, percentual: true },
  })
  return linhas.map((l) => ({ forma: l.forma, parcelas: l.parcelas, percentual: Number(l.percentual) }))
}

export async function salvarTaxas(sessao: Sessao, taxas: Taxa[]) {
  exigir(sessao, 'empresa.configurar')
  const validas = taxas
    .filter((t) => FORMAS_COM_TAXA.some((f) => f.forma === t.forma && f.parcelas === t.parcelas))
    .map((t) => ({ ...t, percentual: Math.min(Math.max(Number(t.percentual) || 0, 0), 30) }))

  await comoOrg(sessao.orgId, async (db) => {
    for (const t of validas) {
      await db.taxaPagamento.upsert({
        where: { orgId_forma_parcelas: { orgId: sessao.orgId, forma: t.forma, parcelas: t.parcelas } },
        create: { orgId: sessao.orgId, forma: t.forma, parcelas: t.parcelas, percentual: t.percentual },
        update: { percentual: t.percentual },
      })
    }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.configurou',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        alvoNome: 'taxas de pagamento',
        depois: Object.fromEntries(validas.map((t) => [`${t.forma}${t.parcelas > 1 ? '_parcelado' : ''}`, t.percentual])),
      },
    })
  })
  return validas
}

export type TaxasDoPeriodo = {
  totalCent: number
  porForma: { forma: FormaPagamento; parcelado: boolean; valorCent: number; taxaCent: number; percentual: number }[]
}

/**
 * Quanto a loja pagou de taxa no período, calculado venda a venda.
 *
 * Recebe o `db` de quem já está numa transação (o DRE chama de dentro da
 * dele). Soma os pagamentos das vendas CONCLUÍDAS por forma e parcelamento,
 * e aplica a taxa de cada combinação.
 */
export async function taxasDoPeriodo(
  db: BancoDaOrg,
  unidadeIds: string[],
  de: Date,
  ate: Date,
): Promise<TaxasDoPeriodo> {
  const taxas = await lerTaxas(db)
  if (taxas.every((t) => t.percentual <= 0)) return { totalCent: 0, porForma: [] }

  const linhas = await db.$queryRaw<{ forma: FormaPagamento; parcelado: boolean; total: string }[]>`
    select p.forma, (p.forma = 'CREDITO' and p.parcelas >= 2) as parcelado, sum(p.valor) as total
      from pagamentos p join vendas v on v.id = p.venda_id
     where v.unidade_id = any(${unidadeIds}) and v.situacao = 'CONCLUIDA'
       and v.criada_em >= ${de} and v.criada_em <= ${ate}
     group by 1, 2
  `

  const porForma = linhas
    .map((l) => {
      const percentual = taxaDe(taxas, l.forma, l.parcelado ? 2 : 1)
      const valorCent = centavos(l.total)
      return { forma: l.forma, parcelado: l.parcelado, valorCent, taxaCent: taxaEmCentavos(valorCent, percentual), percentual }
    })
    .filter((l) => l.taxaCent > 0)

  return { totalCent: porForma.reduce((s, l) => s + l.taxaCent, 0), porForma }
}

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  CREDIARIO: 'Crediário',
  VALE: 'Vale de troca',
  TRANSFERENCIA: 'Transferência',
}

export { reais }
