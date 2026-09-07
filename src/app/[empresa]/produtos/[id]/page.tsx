import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharProduto, eixosDaEmpresa } from '@/servidor/produto'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao } from '@/ui/base'
import { Secao } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import type { Tema } from '@/ui/TrocaTema'
import { Editor, type ProdutoNaTela } from '../Editor'

/** Decimal do banco vira o texto que a pessoa digitou: "49,90". */
const emReais = (v: unknown) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','))

export default async function FichaProduto({
  params,
}: {
  params: Promise<{ empresa: string; id: string }>
}) {
  const { empresa: slug, id } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  if (!pode(sessao, 'produto.editar')) notFound()

  const [produto, eixos, categorias] = await Promise.all([
    acharProduto(sessao, id),
    eixosDaEmpresa(sessao),
    comoOrg(sessao.orgId, (db) =>
      db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true } }),
    ),
  ])

  if (!produto) notFound()

  // Quais opções estão marcadas hoje: sai da grade que existe, não de uma
  // lista guardada à parte. Guardar em dois lugares é como os dois divergem.
  const marcadas: Record<string, string[]> = {}
  const porOpcao = new Map<string, string>()
  for (const e of eixos) for (const o of e.opcoes) porOpcao.set(o.id, e.id)
  for (const v of produto.variacoes) {
    if (!v.ativa) continue
    for (const o of v.opcoes) {
      const eixoId = porOpcao.get(o.opcaoId)
      if (!eixoId) continue
      if (!marcadas[eixoId]) marcadas[eixoId] = []
      if (!marcadas[eixoId].includes(o.opcaoId)) marcadas[eixoId].push(o.opcaoId)
    }
  }

  const valorDe = new Map(eixos.flatMap((e) => e.opcoes.map((o) => [o.id, o] as const)))

  const naTela: ProdutoNaTela = {
    id: produto.id,
    nome: produto.nome,
    marca: produto.marca ?? '',
    descricao: produto.descricao ?? '',
    categoriaId: produto.categoriaId ?? '',
    medida: produto.medida,
    precoVista: emReais(produto.precoVista),
    precoCartao: emReais(produto.precoCartao),
    precoCrediario: emReais(produto.precoCrediario),
    custo: emReais(produto.custo),
    ativo: produto.ativo,
    marcadas,
    comHistorico: produto.variacoes.length,
  }

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/produtos`}
      tema={tema}
      titulo={produto.nome}
    >
      <Secao titulo="A grade de hoje">
        <Cartao
          titulo="Itens na prateleira"
          acao={
            <span className="numero text-xs font-semibold text-tinta-3">
              {produto.variacoes.filter((v) => v.ativa).length} ativo(s)
            </span>
          }
        >
          <Tabela
            colunas={[
              {
                chave: 'item',
                titulo: 'Item',
                celula: (v) =>
                  v.padrao ? (
                    <span className="text-tinta-3">sem variação</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {v.opcoes.map((o) => {
                        const op = valorDe.get(o.opcaoId)
                        return (
                          <span key={o.opcaoId} className="inline-flex items-center gap-1">
                            {op?.hex && (
                              <span
                                aria-hidden
                                className="size-3 rounded-full border border-borda"
                                style={{ background: op.hex }}
                              />
                            )}
                            <span>{op?.valor ?? '—'}</span>
                          </span>
                        )
                      })}
                    </span>
                  ),
              },
              {
                chave: 'codigo',
                titulo: 'Etiqueta',
                largura: '8rem',
                celula: (v) => <span className="font-mono text-xs">{v.codigo ?? '—'}</span>,
              },
              {
                chave: 'saldo',
                titulo: 'Em estoque',
                numero: true,
                largura: '9rem',
                celula: (v) => {
                  const q = v.estoques.reduce((t, e) => t + Number(e.quantidade), 0)
                  return <span className="numero text-sm">{q}</span>
                },
              },
              {
                chave: 'situacao',
                titulo: '',
                largura: '7rem',
                celula: (v) =>
                  v.ativa ? (
                    <Situacao nivel="bom">à venda</Situacao>
                  ) : (
                    <Situacao nivel="neutro">fora</Situacao>
                  ),
              },
            ]}
            linhas={produto.variacoes}
            chave={(v) => v.id}
            vazio="Este produto ainda não tem nenhum item."
          />
        </Cartao>
      </Secao>

      <Secao titulo="Editar">
        <Editor slug={slug} eixos={eixos} categorias={categorias} produto={naTela} />
      </Secao>
    </Estrutura>
  )
}
