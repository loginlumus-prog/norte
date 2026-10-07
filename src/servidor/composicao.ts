// O item que "monta na hora": a "Casquinha + Água" não fica pronta na
// prateleira — sai 1 casquinha e 1 água no momento da venda.
//
// Sem isto, cada item da grade tinha estoque próprio: a sorveteria com 100
// casquinhas lançava 100 em "Casquinha simples", 100 em "Casquinha + Água"…
// e nenhum número batia com o freezer. Com a composição, quem tem estoque é
// a casquinha e a água; o item composto vende e baixa o que leva.
//
// A regra:
//   • Item com composição não tem estoque próprio: venda, cancelamento,
//     devolução e troca mexem nos COMPONENTES (`expandir`).
//   • Um nível só: componente não pode ser composto (a conta não vira árvore).
//   • O custo do item composto é a soma do custo dos componentes.
//   • A composição de AGORA vale para devolver: mudar o que o item leva
//     depois da venda devolve pelo jeito novo. É raro, e o livro mostra.

import { Prisma } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, type Sessao } from './permissao'

export type Baixa = { variacaoId: string; quantidade: number }

const descreverVariacao = (v: { produto: { nome: string }; opcoes: { opcao: { valor: string } }[] }) =>
  v.opcoes.length ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}` : v.produto.nome

/**
 * Troca os itens compostos pelos componentes. O que não tem composição passa
 * igual. Devolve também o nome de cada componente (para a recusa "sem
 * estoque" dizer qual falta) e o custo de cada item composto.
 */
export async function expandir(
  db: BancoDaOrg,
  itens: Baixa[],
): Promise<{
  baixas: Baixa[]
  nomes: Map<string, string>
  custoDoComposto: Map<string, number | null>
  compostos: Set<string>
  /** O que UMA unidade de cada composto leva: componente → quantidade. */
  receita: Map<string, Map<string, number>>
}> {
  const ids = [...new Set(itens.map((i) => i.variacaoId))]
  const linhas = ids.length
    ? await db.composicao.findMany({
        where: { variacaoId: { in: ids } },
        select: {
          variacaoId: true,
          componenteId: true,
          quantidade: true,
          componente: {
            select: {
              custo: true,
              produto: { select: { nome: true, custo: true } },
              opcoes: { select: { opcao: { select: { valor: true } } } },
            },
          },
        },
      })
    : []
  const doItem = new Map<string, typeof linhas>()
  for (const l of linhas) doItem.set(l.variacaoId, [...(doItem.get(l.variacaoId) ?? []), l])

  const nomes = new Map<string, string>()
  const custoDoComposto = new Map<string, number | null>()
  for (const [id, comps] of doItem) {
    let custo: number | null = 0
    for (const c of comps) {
      nomes.set(c.componenteId, descreverVariacao(c.componente))
      const cu = c.componente.custo ?? c.componente.produto.custo
      custo = cu == null || custo == null ? null : custo + Number(cu) * Number(c.quantidade)
    }
    custoDoComposto.set(id, custo == null ? null : Math.round(custo * 10000) / 10000)
  }

  const baixas: Baixa[] = []
  for (const i of itens) {
    const comps = doItem.get(i.variacaoId)
    if (!comps) {
      baixas.push(i)
      continue
    }
    for (const c of comps) {
      baixas.push({ variacaoId: c.componenteId, quantidade: Math.round(i.quantidade * Number(c.quantidade) * 1000) / 1000 })
    }
  }
  const receita = new Map([...doItem].map(([id, comps]) => [id, new Map(comps.map((c) => [c.componenteId, Number(c.quantidade)]))]))
  return { baixas, nomes, custoDoComposto, compostos: new Set(doItem.keys()), receita }
}

// ─────────────────────────────────────────────────────────────
// A FICHA
// ─────────────────────────────────────────────────────────────

export type ComponenteNaTela = { componenteId: string; descricao: string; medida: string; quantidade: number }

/** O que cada item do produto leva, para a ficha. */
export async function composicaoDoProduto(sessao: Sessao, produtoId: string): Promise<Record<string, ComponenteNaTela[]>> {
  exigir(sessao, 'produto.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const ls = await db.composicao.findMany({
      where: { variacao: { produtoId } },
      orderBy: { id: 'asc' },
      select: {
        variacaoId: true,
        componenteId: true,
        quantidade: true,
        componente: {
          select: {
            produto: { select: { nome: true, medida: true } },
            opcoes: { select: { opcao: { select: { valor: true } } } },
          },
        },
      },
    })
    const saida: Record<string, ComponenteNaTela[]> = {}
    for (const l of ls) {
      ;(saida[l.variacaoId] ??= []).push({
        componenteId: l.componenteId,
        descricao: descreverVariacao(l.componente),
        medida: l.componente.produto.medida,
        quantidade: Number(l.quantidade),
      })
    }
    return saida
  })
}

export class ComposicaoRecusada extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'ComposicaoRecusada'
  }
}

/** Troca o que o item leva (lista vazia = volta a ter estoque próprio). */
export async function definirComposicao(
  sessao: Sessao,
  variacaoId: string,
  componentes: { componenteId: string; quantidade: number }[],
): Promise<void> {
  exigir(sessao, 'produto.editar')
  const limpos = new Map<string, number>()
  for (const c of componentes.slice(0, 20)) {
    if (!c || typeof c.componenteId !== 'string') continue
    const q = Number(c.quantidade)
    if (!Number.isFinite(q) || q <= 0 || q > 10_000) throw new ComposicaoRecusada('A quantidade de cada componente precisa ser maior que zero.')
    limpos.set(c.componenteId, Math.round(q * 1000) / 1000)
  }
  if (limpos.has(variacaoId)) throw new ComposicaoRecusada('Um item não pode levar ele mesmo.')

  await comoOrg(sessao.orgId, async (db) => {
    const item = await db.variacao.findUnique({
      where: { id: variacaoId },
      select: { id: true, produto: { select: { nome: true, servico: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } },
    })
    if (!item) throw new ComposicaoRecusada('Este item não existe mais. Recarregue a página.')
    if (item.produto.servico) throw new ComposicaoRecusada('Serviço não tem estoque para baixar.')
    // Um nível só: o item que já é componente de outro não vira composto.
    if (limpos.size > 0) {
      const ehComponente = await db.composicao.findFirst({ where: { componenteId: variacaoId }, select: { id: true } })
      if (ehComponente) throw new ComposicaoRecusada('Este item já é usado na composição de outro. Um item composto não pode ser componente.')
    }
    const ids = [...limpos.keys()]
    const comps = ids.length
      ? await db.variacao.findMany({
          where: { id: { in: ids } },
          select: { id: true, produto: { select: { servico: true } }, composicao: { select: { id: true }, take: 1 } },
        })
      : []
    if (comps.length !== ids.length) throw new ComposicaoRecusada('Um dos componentes não existe mais.')
    if (comps.some((c) => c.produto.servico)) throw new ComposicaoRecusada('Serviço não pode ser componente.')
    if (comps.some((c) => c.composicao.length > 0)) throw new ComposicaoRecusada('Um dos componentes já é composto. Use os itens que têm estoque.')

    const antes = await db.composicao.findMany({ where: { variacaoId }, select: { componenteId: true, quantidade: true } })
    // Virar composto com saldo próprio deixava as peças presas: daí em diante
    // a venda baixa os componentes, e o saldo do próprio item nunca mais sai.
    if (limpos.size > 0 && antes.length === 0) {
      const presos = await db.estoque.findMany({
        where: { variacaoId, quantidade: { not: 0 } },
        select: { quantidade: true, unidade: { select: { nome: true } } },
      })
      if (presos.length > 0) {
        throw new ComposicaoRecusada(
          `Este item ainda tem estoque próprio (${presos.map((p) => `${p.unidade.nome}: ${Number(p.quantidade).toLocaleString('pt-BR')}`).join('; ')}). ` +
            'Zere antes na tela de Estoque e depois monte a composição.',
        )
      }
    }
    await db.composicao.deleteMany({ where: { variacaoId } })
    if (limpos.size > 0) {
      await db.composicao.createMany({
        data: [...limpos].map(([componenteId, quantidade]) => ({
          orgId: sessao.orgId,
          variacaoId,
          componenteId,
          quantidade: new Prisma.Decimal(quantidade),
        })),
      })
    }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'produto.composicao',
        alvoTipo: 'variacao',
        alvoId: variacaoId,
        alvoNome: descreverVariacao(item),
        antes: antes.map((a) => ({ componenteId: a.componenteId, quantidade: Number(a.quantidade) })),
        depois: [...limpos].map(([componenteId, quantidade]) => ({ componenteId, quantidade })),
      },
    })
  })
}

/** Busca o que pode ser componente: item com estoque (não serviço, não composto). */
export async function procurarComponentes(sessao: Sessao, termo: string): Promise<{ id: string; descricao: string; medida: string }[]> {
  exigir(sessao, 'produto.ver')
  const t = String(termo ?? '').trim().slice(0, 60)
  if (t.length < 2) return []
  return comoOrg(sessao.orgId, async (db) => {
    const vs = await db.variacao.findMany({
      where: {
        ativa: true,
        composicao: { none: {} },
        produto: { ativo: true, servico: false },
        OR: [{ codigo: { equals: t, mode: 'insensitive' } }, { produto: { nome: { contains: t, mode: 'insensitive' } } }],
      },
      orderBy: [{ produto: { nome: 'asc' } }, { codigo: 'asc' }],
      take: 12,
      select: {
        id: true,
        produto: { select: { nome: true, medida: true } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
      },
    })
    return vs.map((v) => ({ id: v.id, descricao: descreverVariacao(v), medida: v.produto.medida }))
  })
}

/**
 * O saldo do item composto no balcão: quantos dá para montar com o que os
 * componentes têm NESTA loja (a casquinha com 80 e a água com 30 dão 30
 * "Casquinha + Água"). Troca, nos itens lidos, a lista `estoques` — é ela que
 * o balcão lê para dizer "acabou". Componente sem saldo lançado conta zero.
 */
export async function aplicarSaldoDosCompostos(
  db: BancoDaOrg,
  variacoes: { id: string; estoques: { quantidade: Prisma.Decimal }[] }[],
  unidadeId: string,
): Promise<void> {
  const ids = [...new Set(variacoes.map((v) => v.id))]
  if (ids.length === 0) return
  const ls = await db.composicao.findMany({
    where: { variacaoId: { in: ids } },
    select: { variacaoId: true, componenteId: true, quantidade: true },
  })
  if (ls.length === 0) return
  const saldos = await db.estoque.findMany({
    where: { unidadeId, variacaoId: { in: [...new Set(ls.map((l) => l.componenteId))] } },
    select: { variacaoId: true, quantidade: true },
  })
  const tem = new Map(saldos.map((s) => [s.variacaoId, Number(s.quantidade)]))
  const montaveis = new Map<string, number>()
  for (const l of ls) {
    const n = Math.floor(((tem.get(l.componenteId) ?? 0) / Number(l.quantidade)) * 1000) / 1000
    montaveis.set(l.variacaoId, Math.min(montaveis.get(l.variacaoId) ?? Infinity, n))
  }
  for (const v of variacoes) {
    const n = montaveis.get(v.id)
    if (n !== undefined) v.estoques = [{ quantidade: new Prisma.Decimal(Math.max(n, 0)) }]
  }
}
