// A planilha do estoque: o que tem, onde, e quanto vale a preço de custo.
// É a folha do balanço — a pessoa imprime, conta a prateleira e volta para
// corrigir o que não bateu.

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug, comoOrg } from '@/servidor/banco'
import { escolherUnidade } from '@/servidor/unidade'
import { pode } from '@/servidor/permissao'
import { csv, respostaCsv } from '@/servidor/csv'

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const [empresa, sessao] = await Promise.all([acharOrgPorSlug(slug), sessaoViva(slug)])
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })
  if (!pode(sessao, 'estoque.ver')) return new Response('Sem permissão para ver o estoque.', { status: 403 })

  const q = new URL(req.url).searchParams
  const onde = await escolherUnidade(sessao, empresa, q.get('unidade') ?? undefined, 'estoque.ver')
  const verCusto = pode(sessao, 'produto.preco') || pode(sessao, 'financeiro.ver')

  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.estoque.findMany({
      where: { unidadeId: { in: onde.ids }, variacao: { ativa: true, produto: { ativo: true } } },
      orderBy: [{ variacao: { produto: { nome: 'asc' } } }, { variacao: { codigo: 'asc' } }],
      take: 20000,
      select: {
        quantidade: true, minimo: true, atualizadoEm: true,
        unidade: { select: { nome: true } },
        variacao: {
          select: {
            codigo: true, codigoBarras: true,
            produto: { select: { nome: true, medida: true, custo: true, categoria: { select: { nome: true } } } },
            opcoes: { select: { opcao: { select: { valor: true, eixo: { select: { ordem: true } } } } } },
          },
        },
      },
    }),
  )

  const corpo = csv(
    ['Loja', 'Produto', 'Categoria', 'Variação', 'Código', 'Código de barras', 'Unidade', 'Saldo', 'Mínimo', ...(verCusto ? ['Custo unit.', 'Valor parado'] : []), 'Contado (preencha)', 'Atualizado em'],
    linhas.map((l) => {
      const custo = l.variacao.produto.custo === null ? null : Number(l.variacao.produto.custo)
      const saldo = Number(l.quantidade)
      return [
        l.unidade.nome, l.variacao.produto.nome, l.variacao.produto.categoria?.nome ?? null,
        [...l.variacao.opcoes].sort((a, b) => a.opcao.eixo.ordem - b.opcao.eixo.ordem).map((o) => o.opcao.valor).join(' · ') || null,
        l.variacao.codigo, l.variacao.codigoBarras, l.variacao.produto.medida, saldo,
        l.minimo === null ? null : Number(l.minimo),
        ...(verCusto ? [custo, custo === null ? null : saldo * custo] : []),
        '', l.atualizadoEm,
      ]
    }),
  )
  return respostaCsv(`estoque-${slug}${onde.unidadeId ? `-${onde.titulo}` : ''}`, corpo)
}
