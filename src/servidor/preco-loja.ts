// O preço do produto NESTA loja.
//
// A rede da sorveteria tem lojas em praças diferentes: o açaí do shopping não
// custa o mesmo que o do bairro. O produto continua com um preço só (o "geral");
// a loja que precisa de outro ganha uma linha em `precos_na_loja`, e toda conta
// que cobra — o balcão, a venda, a troca — troca o geral pelo dela antes de
// fazer a conta. Sem linha, nada muda.
//
// A diferença de cada item da grade (`Variacao.ajustePreco`) continua somando
// por cima, igual: o "+ R$ 2 no copo de 500" vale em toda loja.

import { Prisma } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, unidadesQuePodem, type Sessao } from './permissao'

type ComPreco = {
  id?: string
  precoVista: Prisma.Decimal | null
  precoCartao?: Prisma.Decimal | null
  precoCrediario?: Prisma.Decimal | null
}

/**
 * Troca, nos produtos lidos, o preço geral pelo da loja (onde houver). Mexe
 * nos objetos que recebeu — é o mesmo objeto que a conta vai ler logo depois.
 * Precisa do `id` do produto no select.
 */
export async function aplicarPrecoDaLoja(db: BancoDaOrg, produtos: ComPreco[], unidadeId: string | null | undefined): Promise<void> {
  if (!unidadeId) return
  const ids = [...new Set(produtos.map((p) => p.id).filter((x): x is string => !!x))]
  if (ids.length === 0) return
  const linhas = await db.precoNaLoja.findMany({
    where: { unidadeId, produtoId: { in: ids } },
    select: { produtoId: true, precoVista: true, precoCartao: true, precoCrediario: true },
  })
  if (linhas.length === 0) return
  const da = new Map(linhas.map((l) => [l.produtoId, l]))
  for (const p of produtos) {
    const l = p.id ? da.get(p.id) : undefined
    if (!l) continue
    p.precoVista = l.precoVista
    // A loja tem a tabela DELA: cartão e crediário vazios cobram o à vista
    // da loja (ver `precoNaTabela`), não o cartão geral — que podia ficar
    // abaixo do à vista dela.
    if ('precoCartao' in p) p.precoCartao = l.precoCartao
    if ('precoCrediario' in p) p.precoCrediario = l.precoCrediario
  }
}

export type PrecoDaLoja = {
  unidadeId: string
  vista: number
  cartao: number | null
  crediario: number | null
}

/** Os preços próprios das lojas para um produto — a ficha mostra e edita. */
export async function precosDasLojas(sessao: Sessao, produtoId: string): Promise<PrecoDaLoja[]> {
  exigir(sessao, 'produto.ver')
  const lojas = unidadesQuePodem(sessao, 'produto.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const ls = await db.precoNaLoja.findMany({
      where: { produtoId, ...(lojas === 'todas' ? {} : { unidadeId: { in: lojas } }) },
      select: { unidadeId: true, precoVista: true, precoCartao: true, precoCrediario: true },
    })
    return ls.map((l) => ({
      unidadeId: l.unidadeId,
      vista: Number(l.precoVista),
      cartao: l.precoCartao != null ? Number(l.precoCartao) : null,
      crediario: l.precoCrediario != null ? Number(l.precoCrediario) : null,
    }))
  })
}

export class PrecoDaLojaRecusado extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'PrecoDaLojaRecusado'
  }
}

const TETO = 1_000_000

/**
 * Define (ou tira, com `null`) o preço do produto numa loja. Quem muda preço
 * NAQUELA loja (`produto.preco` nela) decide — o gerente do shopping acerta o
 * preço do shopping sem mexer no do bairro.
 */
export async function definirPrecoNaLoja(
  sessao: Sessao,
  produtoId: string,
  unidadeId: string,
  precos: { vista: number; cartao: number | null; crediario: number | null } | null,
): Promise<void> {
  exigir(sessao, 'produto.preco', unidadeId)
  if (precos) {
    const { vista, cartao, crediario } = precos
    for (const [nome, v] of [['à vista', vista], ['cartão', cartao], ['crediário', crediario]] as const) {
      if (v === null) continue
      if (!Number.isFinite(v) || v <= 0) throw new PrecoDaLojaRecusado(`O preço ${nome} precisa ser maior que zero.`)
      if (v > TETO) throw new PrecoDaLojaRecusado(`O preço ${nome} está alto demais. Confira os zeros.`)
    }
  }

  await comoOrg(sessao.orgId, async (db) => {
    const produto = await db.produto.findUnique({ where: { id: produtoId }, select: { id: true, nome: true, precoVista: true } })
    if (!produto) throw new PrecoDaLojaRecusado('Este produto não existe mais. Recarregue a página.')
    const loja = await db.unidade.findUnique({ where: { id: unidadeId }, select: { id: true, nome: true } })
    if (!loja) throw new PrecoDaLojaRecusado('Essa loja não existe.')
    const antes = await db.precoNaLoja.findUnique({
      where: { produtoId_unidadeId: { produtoId, unidadeId } },
      select: { id: true, precoVista: true, precoCartao: true, precoCrediario: true },
    })
    const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d))

    if (!precos) {
      if (!antes) return
      await db.precoNaLoja.delete({ where: { id: antes.id } })
    } else {
      const dados = {
        precoVista: new Prisma.Decimal(precos.vista.toFixed(2)),
        precoCartao: precos.cartao == null ? null : new Prisma.Decimal(precos.cartao.toFixed(2)),
        precoCrediario: precos.crediario == null ? null : new Prisma.Decimal(precos.crediario.toFixed(2)),
        quem: sessao.nome,
      }
      if (antes) await db.precoNaLoja.update({ where: { id: antes.id }, data: dados })
      else await db.precoNaLoja.create({ data: { orgId: sessao.orgId, produtoId, unidadeId, ...dados } })
    }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'produto.preco.loja',
        alvoTipo: 'produto',
        alvoId: produtoId,
        alvoNome: `${produto.nome} · ${loja.nome}`,
        antes: antes
          ? { vista: num(antes.precoVista), cartao: num(antes.precoCartao), crediario: num(antes.precoCrediario) }
          : { geral: num(produto.precoVista) },
        depois: precos ?? { geral: num(produto.precoVista) },
      },
    })
  })
}

/** Quem pode mudar o preço desta loja — a ficha esconde o lápis de quem não pode. */
export const podePrecoNaLoja = (sessao: Sessao, unidadeId: string) => pode(sessao, 'produto.preco', unidadeId)
