// A planilha do financeiro: os lançamentos do mês olhado, com os filtros da
// tela. É o que o contador pede todo mês, e o que faltava para a empresa
// levar os dados dela inteiros (vendas, produtos, estoque e clientes já
// tinham planilha; o dinheiro que entra e sai por fora da venda, não).
//
// Mesmos filtros e mesma régua de loja da tela (listarLancamentos), sem o
// teto de 500 linhas dela. Fica no livro (exportacao.ts).

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug } from '@/servidor/banco'
import { escolherUnidade } from '@/servidor/unidade'
import { listarLancamentos } from '@/servidor/financeiro'
import { SemPermissao } from '@/servidor/permissao'
import { csv, respostaCsv } from '@/servidor/csv'
import { filtrosUsados, podeExportar, registrarExportacao } from '@/servidor/exportacao'

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const empresa = await acharOrgPorSlug(slug)
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  const sessao = await sessaoViva(slug)
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })
  if (!podeExportar(sessao, 'financeiro')) return new Response('Sem permissão para ver o financeiro.', { status: 403 })

  const q = new URL(req.url).searchParams
  // O mês como a tela lê: fora do formato, o corrente.
  const mesBruto = q.get('mes') ?? ''
  const agora = new Date()
  const [ano, mes] = (/^\d{4}-(0?[1-9]|1[0-2])$/.test(mesBruto) ? mesBruto : `${agora.getFullYear()}-${agora.getMonth() + 1}`)
    .split('-')
    .map(Number) as [number, number]
  const tipo = q.get('tipo')
  const situacao = q.get('situacao')
  const onde = await escolherUnidade(sessao, empresa, q.get('unidade') ?? undefined, 'financeiro.ver')

  try {
    const linhas = await listarLancamentos(
      sessao,
      {
        unidadeIds: onde.ids,
        ano,
        mes,
        tipo: tipo === 'DESPESA' || tipo === 'RECEITA' ? tipo : null,
        situacao: situacao === 'aberto' || situacao === 'pago' ? situacao : null,
        categoriaId: q.get('categoria'),
        q: q.get('q'),
      },
      50_000,
    )
    const corpo = csv(
      ['Vencimento', 'Tipo', 'Categoria', 'Descrição', 'Fornecedor', 'Documento', 'Valor', 'Pago em', 'Situação', 'Recorrente', 'Lançado por'],
      linhas.map((l) => [
        l.vencimento, l.tipo === 'DESPESA' ? 'despesa' : 'receita', l.categoria, l.descricao, l.fornecedor, l.documento,
        l.valor, l.pagoEm, l.pagoEm ? 'pago' : 'em aberto', l.recorrente, l.quem,
      ]),
    )
    await registrarExportacao(sessao, 'financeiro', { linhas: linhas.length, filtros: filtrosUsados(q), unidadeId: onde.unidadeId })
    return respostaCsv(`financeiro-${slug}-${ano}-${String(mes).padStart(2, '0')}`, corpo)
  } catch (e) {
    if (e instanceof SemPermissao) return new Response('Sem permissão para ver o financeiro.', { status: 403 })
    throw e
  }
}
