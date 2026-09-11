// A planilha do catálogo: uma linha por item (variação), com preço, custo,
// margem e saldo em cada loja que a pessoa vê.

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug, comoOrg } from '@/servidor/banco'
import { escolherUnidade } from '@/servidor/unidade'
import { pode } from '@/servidor/permissao'
import { csv, respostaCsv, type Celula } from '@/servidor/csv'

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const [empresa, sessao] = await Promise.all([acharOrgPorSlug(slug), sessaoViva(slug)])
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })
  if (!pode(sessao, 'produto.ver')) return new Response('Sem permissão para ver produtos.', { status: 403 })

  const q = new URL(req.url).searchParams
  const onde = await escolherUnidade(sessao, empresa, q.get('unidade') ?? undefined, 'produto.ver')
  const verCusto = pode(sessao, 'produto.preco')

  const variacoes = await comoOrg(sessao.orgId, (db) =>
    db.variacao.findMany({
      where: { produto: { ativo: true } },
      orderBy: [{ produto: { nome: 'asc' } }, { codigo: 'asc' }],
      take: 10000,
      select: {
        codigo: true, codigoBarras: true, ativa: true, ajustePreco: true,
        produto: {
          select: {
            nome: true, marca: true, medida: true, precoVista: true, precoCartao: true, precoCrediario: true, custo: true,
            categoria: { select: { nome: true } },
          },
        },
        opcoes: { select: { opcao: { select: { valor: true, eixo: { select: { ordem: true } } } } } },
        estoques: { where: { unidadeId: { in: onde.ids } }, select: { quantidade: true, minimo: true, unidadeId: true } },
      },
    }),
  )

  const cabecalho = [
    'Produto', 'Marca', 'Categoria', 'Variação', 'Código', 'Código de barras', 'Unidade', 'À vista', 'No cartão', 'No crediário',
    ...(verCusto ? ['Custo', 'Margem %'] : []),
    ...onde.opcoes.map((u) => `Estoque · ${u.nome}`),
    'Mínimo', 'Ativo',
  ]
  const linhas: Celula[][] = variacoes.map((v) => {
    const ajuste = Number(v.ajustePreco ?? 0)
    const vista = Number(v.produto.precoVista ?? 0) + ajuste
    const custo = v.produto.custo === null ? null : Number(v.produto.custo)
    const margem = custo !== null && vista > 0 ? ((vista - custo) / vista) * 100 : null
    return [
      v.produto.nome, v.produto.marca, v.produto.categoria?.nome ?? null,
      [...v.opcoes].sort((a, b) => a.opcao.eixo.ordem - b.opcao.eixo.ordem).map((o) => o.opcao.valor).join(' · ') || null,
      v.codigo, v.codigoBarras, v.produto.medida,
      vista, Number(v.produto.precoCartao ?? v.produto.precoVista ?? 0) + ajuste, Number(v.produto.precoCrediario ?? v.produto.precoCartao ?? v.produto.precoVista ?? 0) + ajuste,
      ...(verCusto ? [custo, margem === null ? null : Math.round(margem * 10) / 10] : []),
      ...onde.opcoes.map((u) => Number(v.estoques.find((e) => e.unidadeId === u.id)?.quantidade ?? 0)),
      v.estoques.reduce<number | null>((m, e) => (e.minimo === null ? m : Math.max(m ?? 0, Number(e.minimo))), null),
      v.ativa,
    ]
  })
  return respostaCsv(`produtos-${slug}`, csv(cabecalho, linhas))
}
