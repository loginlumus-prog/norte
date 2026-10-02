import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { podeVerCustoDe } from '@/servidor/produto'
import { vendidoNaLoja } from '@/servidor/catalogo-loja'
import { escolherUnidade } from '@/servidor/unidade'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import type { Tema } from '@/ui/TrocaTema'
import { Planilha, type LinhaDaPlanilha } from './Planilha'

export const metadata: Metadata = { title: 'Editar em planilha' }

// Editar em planilha: o catálogo inteiro numa tabela, cada célula um campo.
//
// A ficha do produto continua sendo onde se mexe em grade, foto, medida e
// lojas. Aqui é o que se faz em lote — o dia da implantação, o reajuste de
// preço, a contagem da loja: nome, gaveta, preço, custo e o estoque DESTA loja.
// O estoque é por loja, então a tela trabalha sempre com uma escolhida.

export default async function EditarEmPlanilha({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'produto.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // O estoque é de UMA loja: sem escolha, a primeira que a pessoa vê.
  const onde = await escolherUnidade(sessao, empresa, typeof pedida === 'string' ? pedida : undefined, 'estoque.ver')
  const lojaId = onde.unidadeId ?? onde.opcoes[0]?.id ?? null
  const loja = onde.opcoes.find((u) => u.id === lojaId) ?? null

  const [categorias, todos, org] = await Promise.all([
    comoOrg(sessao.orgId, (db) => db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true } })),
    comoOrg(sessao.orgId, (db) =>
      db.produto.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        select: {
          id: true, nome: true, categoriaId: true, medida: true, servico: true, vendidoEm: true,
          precoVista: true, precoCartao: true, precoCrediario: true, custo: true,
          variacoes: {
            where: { ativa: true },
            orderBy: { codigo: 'asc' },
            select: {
              id: true, codigo: true,
              estoques: { where: { unidadeId: lojaId ?? '' }, select: { quantidade: true } },
            },
          },
        },
      }),
    ),
    comoOrg(sessao.orgId, (db) => db.org.findUnique({ where: { id: sessao.orgId }, select: { pinNasExcecoes: true } })),
  ])

  // Só o que ESTA loja vende — ou o que tem saldo nela (precisa aparecer para
  // alguém tirar de lá). Antes a tabela trazia o catálogo da empresa inteira
  // com a loja escolhida no alto: a gerente da loja de roupa via o picolé da
  // sorveteria, e podia digitar estoque dele na loja dela. Depósito guarda o
  // que as lojas vendem: nele, tudo. A régua é a mesma de Produtos e Estoque.
  const produtos = loja
    ? todos.filter(
        (p) =>
          loja.ehDeposito ||
          vendidoNaLoja(p.vendidoEm, loja.id) ||
          p.variacoes.some((v) => v.estoques.some((e) => Number(e.quantidade) !== 0)),
      )
    : todos

  const podeEditar = pode(sessao, 'produto.editar')
  const podeCadastrar = pode(sessao, 'produto.cadastrar')
  const podeEstoque = lojaId ? pode(sessao, 'estoque.ajustar', lojaId) : false
  // Três preços só aparecem na empresa que usa (cartão ou crediário diferente).
  const tresPrecos = produtos.some(
    (p) =>
      (p.precoCartao != null && Number(p.precoCartao) !== Number(p.precoVista)) ||
      (p.precoCrediario != null && Number(p.precoCrediario) !== Number(p.precoVista)),
  )

  const linhas: LinhaDaPlanilha[] = produtos.map((p) => {
    const unica = p.variacoes.length === 1 ? p.variacoes[0]! : null
    return {
      id: p.id,
      codigo: p.variacoes.length === 1 ? (unica!.codigo ?? '') : p.variacoes.map((v) => v.codigo).filter(Boolean).slice(0, 1)[0] ?? '',
      nome: p.nome,
      categoriaId: p.categoriaId,
      precoVista: Number(p.precoVista ?? 0),
      precoCartao: p.precoCartao == null ? null : Number(p.precoCartao),
      precoCrediario: p.precoCrediario == null ? null : Number(p.precoCrediario),
      // O custo de cada produto só para quem vê o custo DELE (o mesmo corte da
      // ficha): o gerente da loja de roupa não lê o custo do picolé.
      custo: p.custo != null && podeVerCustoDe(sessao, p.vendidoEm) ? Number(p.custo) : null,
      servico: p.servico,
      opcoes: p.variacoes.length,
      variacaoId: unica?.id ?? null,
      estoque: unica ? (unica.estoques[0] ? Number(unica.estoques[0].quantidade) : null) : null,
    }
  })

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/produtos`}
      tema={tema}
      titulo="Editar em planilha"
      acao={
        <span className="flex flex-wrap items-center gap-2">
          {onde.opcoes.length > 1 && <SeletorUnidade opcoes={onde.opcoes} atual={lojaId} />}
          <Link
            href={`/${slug}/produtos`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Voltar à lista
          </Link>
        </span>
      }
    >
      <Planilha
        slug={slug}
        linhas={linhas}
        categorias={categorias}
        loja={loja ? { id: loja.id, nome: loja.nome } : null}
        podePreco={pode(sessao, 'produto.preco')}
        podeEditar={podeEditar}
        podeCadastrar={podeCadastrar}
        podeEstoque={podeEstoque}
        tresPrecos={tresPrecos}
        pedePin={org?.pinNasExcecoes === true}
      />
    </Estrutura>
  )
}
