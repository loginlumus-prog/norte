// A planilha das vendas: uma linha por item vendido.
//
// Rota GET porque planilha se baixa por link — a pessoa clica e o arquivo
// desce. A mesma checagem de sessão e permissão de qualquer tela, porque o
// endereço é público: o `exigir` dentro de `listarItensVendidos` decide.

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug } from '@/servidor/banco'
import { escolherUnidade } from '@/servidor/unidade'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { listarItensVendidos } from '@/servidor/venda'
import { SemPermissao } from '@/servidor/permissao'
import { csv, respostaCsv } from '@/servidor/csv'
import type { FormaPagamento, SituacaoVenda } from '@prisma/client'

const FORMAS: FormaPagamento[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'CREDIARIO', 'VALE', 'TRANSFERENCIA']

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const [empresa, sessao] = await Promise.all([acharOrgPorSlug(slug), sessaoViva(slug)])
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })

  const q = new URL(req.url).searchParams
  const onde = await escolherUnidade(sessao, empresa, q.get('unidade') ?? undefined, 'venda.ver')
  const j = janela(lerPeriodo(q.get('periodo')))
  const sit = q.get('situacao')
  const forma = q.get('forma')

  try {
    const itens = await listarItensVendidos(sessao, {
      unidadeIds: onde.ids,
      de: j.de,
      ate: j.ate,
      q: q.get('q'),
      situacao: sit === 'CONCLUIDA' || sit === 'CANCELADA' ? (sit as SituacaoVenda) : null,
      vendedorId: q.get('vendedor'),
      // A forma vem do endereço: fora da lista, o Prisma recusava o valor e a
      // planilha virava erro de servidor. Fora da lista é "todas".
      forma: FORMAS.includes(forma as FormaPagamento) ? (forma as FormaPagamento) : null,
    })
    const corpo = csv(
      ['Venda', 'Data', 'Loja', 'Situação', 'Cliente', 'Vendedor', 'Item', 'Código', 'Unidade', 'Quantidade', 'Preço unit.', 'Total do item', 'Custo unit.', 'Formas de pagamento', 'Total da venda'],
      itens.map((i) => [
        i.numero, i.criadaEm, i.unidade, i.situacao === 'CANCELADA' ? 'cancelada' : 'concluída', i.cliente, i.vendedor,
        i.descricao, i.codigo, i.medida, i.quantidade, i.precoUnit, i.total, i.custoUnit, i.formas, i.totalVenda,
      ]),
    )
    return respostaCsv(`vendas-${slug}-${j.chave}`, corpo)
  } catch (e) {
    if (e instanceof SemPermissao) return new Response('Sem permissão para ver vendas.', { status: 403 })
    throw e
  }
}
