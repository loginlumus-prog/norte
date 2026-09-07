// Entrada de mercadoria.
//
// É a operação que enche o estoque, e ela toca três coisas que normalmente
// moram em telas diferentes:
//
//   1. o SALDO sobe;
//   2. o CUSTO da peça passa a ser o desta compra — é ele que vira CMV
//      quando a peça vender, e é dele que sai a margem do mês;
//   3. o FORNECEDOR passa a ter uma conta a pagar.
//
// Fazer as três de uma vez é o ponto: quem recebe a caixa do fornecedor faz
// isso uma vez por semana, e é o momento em que a informação está fresca.
// Separado em três telas, o custo nunca é atualizado e a conta é lançada de
// cabeça no fim do mês, com o valor errado.
//
// ── e as três têm permissões diferentes ─────────────────────
// Dar entrada é `estoque.ajustar`. Mexer no custo é `produto.preco`. Lançar a
// conta é `financeiro.lancar`. Quem só tem a primeira registra a entrada e o
// resto simplesmente não acontece — o resultado diz o que foi feito, para a
// tela não mentir que gravou tudo.

import { comoOrg } from './banco'
import { exigir, pode, type Sessao } from './permissao'
import { mexerEstoqueEm } from './estoque'
import { centavos, reais } from './dinheiro'

export type ItemEntrada = {
  variacaoId: string
  quantidade: number
  /** Quanto custou a unidade nesta compra. Sem isto, o custo fica como está. */
  custoUnit?: number | null
}

export type NovaEntrada = {
  unidadeId: string
  fornecedor?: string
  /** Número da nota ou do pedido. */
  documento?: string
  itens: ItemEntrada[]
  /** Gera a conta a pagar do fornecedor. */
  conta?: {
    categoriaId: string
    vencimento: Date
    jaPago: boolean
  }
}

export type ResultadoEntrada =
  | {
      ok: true
      itens: number
      /** Soma de quantidade × custo, em reais. */
      total: number
      custosAtualizados: number
      contaLancada: boolean
      /** O que não foi feito por falta de permissão, para a tela avisar. */
      naoFeito: string[]
    }
  | { ok: false; motivo: string }

export async function registrarEntrada(
  sessao: Sessao,
  e: NovaEntrada,
): Promise<ResultadoEntrada> {
  exigir(sessao, 'estoque.ajustar', e.unidadeId)

  const itens = e.itens.filter((i) => i.quantidade > 0)
  if (itens.length === 0) return { ok: false, motivo: 'Nenhum item com quantidade.' }

  const podeCusto = pode(sessao, 'produto.preco')
  const podeLancar = e.conta ? pode(sessao, 'financeiro.lancar', e.unidadeId) : true

  const naoFeito: string[] = []
  if (!podeCusto && itens.some((i) => i.custoUnit != null)) {
    naoFeito.push('o custo das peças (precisa de permissão de preço)')
  }
  if (e.conta && !podeLancar) {
    naoFeito.push('a conta a pagar do fornecedor (precisa de permissão do financeiro)')
  }

  return comoOrg(sessao.orgId, async (db) => {
    // Tudo numa transação: ou o saldo sobe, o custo muda e a conta nasce, ou
    // nada disso acontece. Meio-termo aqui é estoque que existe no sistema e
    // não foi pago, ou conta paga de mercadoria que não entrou.
    const variacoes = await db.variacao.findMany({
      where: { id: { in: itens.map((i) => i.variacaoId) } },
      select: { id: true, produtoId: true },
    })
    if (variacoes.length !== new Set(itens.map((i) => i.variacaoId)).size) {
      return { ok: false as const, motivo: 'Um dos itens não existe nesta empresa.' }
    }
    const produtoDe = new Map(variacoes.map((v) => [v.id, v.produtoId]))

    // ── 1. o saldo ──
    let totalCent = 0
    for (const i of itens) {
      const r = await mexerEstoqueEm(db, sessao, {
        variacaoId: i.variacaoId,
        unidadeId: e.unidadeId,
        tipo: 'ENTRADA',
        quantidade: i.quantidade,
        motivo: e.fornecedor ? `Entrada — ${e.fornecedor}` : 'Entrada de mercadoria',
        referencia: e.documento,
      })
      if (!r.ok) return { ok: false as const, motivo: 'Não deu para dar entrada neste item.' }
      if (i.custoUnit != null) totalCent += centavos(i.custoUnit) * i.quantidade
    }

    // ── 2. o custo ──
    // Vale o custo DESTA compra, não a média. Média esconde a alta do
    // fornecedor: a peça sobe 20% e a margem só cai devagar, sem ninguém
    // conseguir apontar quando começou.
    let custosAtualizados = 0
    if (podeCusto) {
      const jaFeitos = new Set<string>()
      for (const i of itens) {
        if (i.custoUnit == null) continue
        const produtoId = produtoDe.get(i.variacaoId)
        if (!produtoId || jaFeitos.has(produtoId)) continue
        await db.produto.update({
          where: { id: produtoId },
          data: { custo: reais(centavos(i.custoUnit)) },
        })
        jaFeitos.add(produtoId)
        custosAtualizados++
      }
    }

    // ── 3. a conta do fornecedor ──
    let contaLancada = false
    if (e.conta && podeLancar && totalCent > 0) {
      await db.lancamento.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: e.unidadeId,
          categoriaId: e.conta.categoriaId,
          tipo: 'DESPESA',
          descricao: e.fornecedor
            ? `Mercadoria — ${e.fornecedor}`
            : 'Entrada de mercadoria',
          valor: reais(totalCent),
          vencimento: e.conta.vencimento,
          pagoEm: e.conta.jaPago ? new Date() : null,
          fornecedor: e.fornecedor || null,
          documento: e.documento || null,
          quem: sessao.nome,
        },
      })
      contaLancada = true
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: e.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'estoque.entrada',
        alvoTipo: 'entrada',
        alvoNome: e.fornecedor || 'Entrada de mercadoria',
        valor: totalCent > 0 ? reais(totalCent) : null,
        motivo: e.documento || null,
        depois: { itens: itens.length, custosAtualizados, contaLancada },
      },
    })

    return {
      ok: true as const,
      itens: itens.length,
      total: reais(totalCent),
      custosAtualizados,
      contaLancada,
      naoFeito,
    }
  })
}

/**
 * O ponto em que a peça precisa ser reposta.
 *
 * Sem ele o sistema só avisa quando o saldo chega a zero — que é tarde: a
 * venda já foi perdida, e a reposição ainda vai demorar o prazo do
 * fornecedor. O mínimo é o que transforma "acabou" em "está acabando".
 */
export async function definirMinimo(
  sessao: Sessao,
  variacaoId: string,
  unidadeId: string,
  minimo: number,
) {
  exigir(sessao, 'estoque.ajustar', unidadeId)
  if (minimo < 0) throw new Error('O mínimo não pode ser negativo.')

  await comoOrg(sessao.orgId, (db) =>
    db.estoque.upsert({
      where: { variacaoId_unidadeId: { variacaoId, unidadeId } },
      create: { orgId: sessao.orgId, variacaoId, unidadeId, quantidade: 0, minimo },
      update: { minimo },
    }),
  )
}
