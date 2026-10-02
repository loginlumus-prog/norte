// A planilha do catálogo: uma linha por item (variação), com preço, custo,
// margem e saldo em cada loja da vista.
//
// Com `?unidade=` ela é a planilha DAQUELA loja: só o que a loja vende (ou o
// que tem saldo nela) e só a coluna de estoque dela. Antes saía o catálogo da
// empresa inteira, com uma coluna de "Estoque · Loja X" para cada loja que a
// pessoa enxerga — zerada, porque o saldo só vinha da escolhida.

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug, comoOrg } from '@/servidor/banco'
import { escolherUnidade } from '@/servidor/unidade'
import { unidadesQuePodem } from '@/servidor/permissao'
import { podeVerCustoDe, saldoNaVista } from '@/servidor/produto'
import { csv, respostaCsv, type Celula } from '@/servidor/csv'
import { filtrosUsados, podeExportar, registrarExportacao } from '@/servidor/exportacao'

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const [empresa, sessao] = await Promise.all([acharOrgPorSlug(slug), sessaoViva(slug)])
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })
  if (!podeExportar(sessao, 'produtos')) return new Response('Sem permissão para ver produtos.', { status: 403 })

  const q = new URL(req.url).searchParams
  const onde = await escolherUnidade(sessao, empresa, q.get('unidade') ?? undefined, 'produto.ver')
  // As lojas da vista: a escolhida, ou todas as que a pessoa vê.
  const lojas = onde.opcoes.filter((u) => onde.ids.includes(u.id))
  const vistaInteira = onde.unidadeId === null && unidadesQuePodem(sessao, 'produto.ver') === 'todas'

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
            vendidoEm: true, feitoNoDia: true,
            categoria: { select: { nome: true } },
          },
        },
        opcoes: { select: { opcao: { select: { valor: true, eixo: { select: { ordem: true } } } } } },
        estoques: { where: { unidadeId: { in: onde.ids } }, select: { quantidade: true, minimo: true, unidadeId: true } },
      },
    }),
  )

  // A mesma régua de Produtos e Estoque (`saldoNaVista`): entra o que alguma
  // loja da vista vende, ou o que tem saldo nela.
  const daVista = variacoes.filter(
    (v) =>
      saldoNaVista(
        v.produto.vendidoEm,
        v.estoques.map((e) => ({ unidadeId: e.unidadeId, quantidade: Number(e.quantidade), minimo: e.minimo === null ? null : Number(e.minimo) })),
        lojas,
        vistaInteira,
        v.produto.feitoNoDia,
      ).aparece,
  )

  // O custo (e a margem) só sai para quem vê o custo de pelo menos um produto
  // da planilha; e, linha a linha, só do produto que a pessoa pode ver — o
  // mesmo corte da ficha (`podeVerCustoDe`).
  const verCusto = daVista.some((v) => podeVerCustoDe(sessao, v.produto.vendidoEm))

  const cabecalho = [
    'Produto', 'Marca', 'Categoria', 'Variação', 'Código', 'Código de barras', 'Unidade', 'À vista', 'No cartão', 'No crediário',
    ...(verCusto ? ['Custo', 'Margem %'] : []),
    ...lojas.map((u) => `Estoque · ${u.nome}`),
    'Mínimo', 'Ativo',
  ]
  const linhas: Celula[][] = daVista.map((v) => {
    const ajuste = Number(v.ajustePreco ?? 0)
    const vista = Number(v.produto.precoVista ?? 0) + ajuste
    const veEste = podeVerCustoDe(sessao, v.produto.vendidoEm)
    const custo = !veEste || v.produto.custo === null ? null : Number(v.produto.custo)
    const margem = custo !== null && vista > 0 ? ((vista - custo) / vista) * 100 : null
    return [
      v.produto.nome, v.produto.marca, v.produto.categoria?.nome ?? null,
      [...v.opcoes].sort((a, b) => a.opcao.eixo.ordem - b.opcao.eixo.ordem).map((o) => o.opcao.valor).join(' · ') || null,
      v.codigo, v.codigoBarras, v.produto.medida,
      vista, Number(v.produto.precoCartao ?? v.produto.precoVista ?? 0) + ajuste, Number(v.produto.precoCrediario ?? v.produto.precoCartao ?? v.produto.precoVista ?? 0) + ajuste,
      ...(verCusto ? [custo, margem === null ? null : Math.round(margem * 10) / 10] : []),
      ...lojas.map((u) => Number(v.estoques.find((e) => e.unidadeId === u.id)?.quantidade ?? 0)),
      v.estoques.reduce<number | null>((m, e) => (e.minimo === null ? m : Math.max(m ?? 0, Number(e.minimo))), null),
      v.ativa,
    ]
  })
  await registrarExportacao(sessao, 'produtos', { linhas: linhas.length, filtros: filtrosUsados(q), unidadeId: onde.unidadeId })
  return respostaCsv(`produtos-${slug}`, csv(cabecalho, linhas))
}
