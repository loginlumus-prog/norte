'use server'

import { revalidatePath } from 'next/cache'
import { lerSessao } from '@/servidor/sessao'
import { comoOrg } from '@/servidor/banco'
import { registrarVenda, type PagamentoDaVenda } from '@/servidor/venda'
import { abrirCaixa, fecharCaixa, movimentarCaixa } from '@/servidor/caixa'
import type { FormaPagamento } from '@prisma/client'

async function sessaoDe(slug: string) {
  const s = await lerSessao(slug)
  if (!s) throw new Error('Sua sessão expirou. Entre de novo.')
  return s
}

export type Achado = {
  id: string
  codigo: string | null
  descricao: string
  medida: string
  preco: number
  saldo: number
}

/**
 * Busca do balcão: código de etiqueta, código de barras ou pedaço do nome.
 *
 * O código bate EXATO e vem primeiro na lista — quem leu a etiqueta com o
 * leitor quer aquele item, não uma lista de parecidos.
 */
export async function procurar(
  slug: string,
  unidadeId: string,
  termo: string,
): Promise<Achado[]> {
  const s = await sessaoDe(slug)
  const t = termo.trim()
  if (t.length < 2) return []

  return comoOrg(s.orgId, async (db) => {
    const vs = await db.variacao.findMany({
      where: {
        ativa: true,
        produto: { ativo: true },
        OR: [
          { codigo: { equals: t, mode: 'insensitive' } },
          { codigoBarras: t },
          { produto: { nome: { contains: t, mode: 'insensitive' } } },
        ],
      },
      take: 12,
      select: {
        id: true,
        codigo: true,
        ajustePreco: true,
        produto: { select: { nome: true, medida: true, precoVista: true } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
        estoques: { where: { unidadeId }, select: { quantidade: true } },
      },
    })

    const achados = vs.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      medida: v.produto.medida as string,
      descricao:
        v.opcoes.length > 0
          ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}`
          : v.produto.nome,
      preco: Number(v.produto.precoVista ?? 0) + Number(v.ajustePreco ?? 0),
      saldo: Number(v.estoques[0]?.quantidade ?? 0),
    }))

    // Código exato na frente: é o caso do leitor de código de barras.
    const exato = t.toUpperCase()
    return achados.sort((a, b) =>
      a.codigo?.toUpperCase() === exato ? -1 : b.codigo?.toUpperCase() === exato ? 1 : 0,
    )
  })
}

export type ItemEnviado = { variacaoId: string; quantidade: number; precoUnit: number }

export async function fecharVenda(
  slug: string,
  dados: {
    unidadeId: string
    caixaId: string | null
    itens: ItemEnviado[]
    pagamentos: { forma: string; valor: number }[]
    desconto: number
  },
) {
  const s = await sessaoDe(slug)

  const r = await registrarVenda(s, {
    unidadeId: dados.unidadeId,
    caixaId: dados.caixaId,
    itens: dados.itens,
    desconto: dados.desconto,
    pagamentos: dados.pagamentos.map((p) => ({
      forma: p.forma as FormaPagamento,
      valor: p.valor,
    })) as PagamentoDaVenda[],
  })

  if (r.ok) revalidatePath(`/${slug}/balcao`)
  return r
}

export async function abrir(slug: string, unidadeId: string, saldo: number) {
  const s = await sessaoDe(slug)
  const r = await abrirCaixa(s, unidadeId, saldo)
  revalidatePath(`/${slug}/balcao`)
  return r
}

export async function fechar(slug: string, caixaId: string, contado: number, obs?: string) {
  const s = await sessaoDe(slug)
  const r = await fecharCaixa(s, caixaId, contado, obs)
  revalidatePath(`/${slug}/balcao`)
  return r
}

export async function movimentar(
  slug: string,
  caixaId: string,
  tipo: 'SANGRIA' | 'SUPRIMENTO',
  valor: number,
  motivo: string,
) {
  const s = await sessaoDe(slug)
  await movimentarCaixa(s, caixaId, tipo, valor, motivo)
  revalidatePath(`/${slug}/balcao`)
}
