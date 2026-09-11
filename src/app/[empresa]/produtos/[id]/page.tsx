import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharProduto, eixosDaEmpresa, comoVende, estoqueDoProduto } from '@/servidor/produto'
import { listarMovimentos, ROTULO_MOVIMENTO } from '@/servidor/estoque'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, cx } from '@/ui/base'
import { Secao, Numero, brl } from '@/ui/painel'
import { Linhas } from '@/ui/Graficos'
import { Tabela } from '@/ui/Tabela'
import type { Tema } from '@/ui/TrocaTema'
import { Editor, type ProdutoNaTela } from '../Editor'

/** Decimal do banco vira o texto que a pessoa digitou: "49,90". */
const emReais = (v: unknown) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','))

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

/** Os 90 dias, todos, para a linha não pular o dia que não vendeu. */
function noventaDias(linhas: { dia: string; quantidade: number; total: number }[]) {
  const por = new Map(linhas.map((l) => [l.dia, l]))
  const hoje = new Date()
  const saida: { rotulo: string; quantidade: number; total: number }[] = []
  for (let i = 89; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - i)
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const l = por.get(chave)
    saida.push({ rotulo: `${chave.slice(8, 10)}/${chave.slice(5, 7)}`, quantidade: l?.quantidade ?? 0, total: l?.total ?? 0 })
  }
  return saida
}

export default async function FichaProduto({
  params,
}: {
  params: Promise<{ empresa: string; id: string }>
}) {
  const { empresa: slug, id } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  if (!pode(sessao, 'produto.editar')) notFound()

  const noventa = new Date()
  noventa.setDate(noventa.getDate() - 90)
  const [produto, eixos, categorias, vende, porLoja, movimentos] = await Promise.all([
    acharProduto(sessao, id),
    eixosDaEmpresa(sessao),
    comoOrg(sessao.orgId, (db) =>
      db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true } }),
    ),
    comoVende(sessao, id),
    pode(sessao, 'estoque.ver') ? estoqueDoProduto(sessao, id) : Promise.resolve([]),
    pode(sessao, 'estoque.ver')
      ? comoOrg(sessao.orgId, (db) => db.unidade.findMany({ where: { ativa: true }, select: { id: true } })).then((us) =>
          listarMovimentos(sessao, { unidadeIds: us.map((u) => u.id), de: noventa, ate: new Date(Date.now() + 864e5), produtoId: id }),
        )
      : Promise.resolve([]),
  ])

  if (!produto) notFound()

  const dias = noventaDias(vende.porDia)
  const lojas = [...new Map(porLoja.map((l) => [l.unidadeId, l.unidade])).entries()]
  const margem90 = vende.total90 > 0 ? ((vende.total90 - vende.custo90) / vende.total90) * 100 : null
  const diasSemVender = vende.ultimaVenda ? Math.floor((Date.now() - vende.ultimaVenda.getTime()) / 864e5) : null

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
      acao={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/${slug}/produtos`} className="text-sm font-medium text-tinta-2 hover:text-tinta">
            ← produtos
          </Link>
          <Link
            href={`/${slug}/produtos/etiquetas?produto=${produto.id}`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Etiquetas
          </Link>
        </span>
      }
    >
      {/* ── COMO VENDE ──
          A ficha sem isto é cadastro. "Vale repor?" e "por quanto está saindo?"
          se respondem aqui, antes de qualquer campo de edição. */}
      <Secao titulo="Como vende">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo="Últimos 30 dias"
            valor={brl(vende.total30)}
            detalhe={`${vende.qtd30.toLocaleString('pt-BR')} vendido${vende.qtd30 === 1 ? '' : 's'}`}
          />
          <Numero rotulo="Últimos 90 dias" valor={brl(vende.total90)} detalhe={`${vende.qtd90.toLocaleString('pt-BR')} vendidos`} />
          {pode(sessao, 'produto.preco') && (
            <Numero
              rotulo="Margem em 90 dias"
              valor={margem90 === null ? '—' : `${margem90.toFixed(0)}%`}
              detalhe={margem90 === null ? 'sem venda ou sem custo' : `${brl(vende.total90 - vende.custo90)} sobre o custo`}
              nivel={margem90 === null ? undefined : margem90 < 20 ? 'critico' : margem90 < 40 ? 'atencao' : 'bom'}
            />
          )}
          <Numero
            rotulo="Última venda"
            valor={diasSemVender === null ? 'nunca' : diasSemVender === 0 ? 'hoje' : `${diasSemVender}d`}
            detalhe={diasSemVender === null ? 'ainda não vendeu' : 'atrás'}
            nivel={diasSemVender !== null && diasSemVender >= 30 ? 'atencao' : undefined}
          />
        </div>
        {vende.qtd90 > 0 && (
          <Cartao caixa titulo="Quantidade vendida por dia · 90 dias">
            <Linhas
              rotulos={dias.map((d) => d.rotulo)}
              series={[{ nome: 'Vendidos', cor: 'var(--marca)', valores: dias.map((d) => d.quantidade) }]}
              formato={produto.medida === 'KG' ? 'kg' : 'un'}
              altura={110}
            />
          </Cartao>
        )}
      </Secao>

      {lojas.length > 1 && (
        <Secao titulo="Onde está" resumo="O saldo de cada item em cada loja. Transferir é na tela de estoque.">
          <Cartao caixa>
            <Tabela
              colunas={[
                {
                  chave: 'item',
                  titulo: 'Item',
                  celula: (v: (typeof produto.variacoes)[number]) => (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-tinta-3">{v.codigo}</span>
                      {v.padrao ? <span className="text-tinta-3">sem variação</span> : v.opcoes.map((o) => valorDe.get(o.opcaoId)?.valor ?? '—').join(' · ')}
                    </span>
                  ),
                },
                ...lojas.map(([unidadeId, nome]) => ({
                  chave: unidadeId,
                  titulo: nome,
                  numero: true,
                  largura: '7rem',
                  celula: (v: (typeof produto.variacoes)[number]) => {
                    const l = porLoja.find((x) => x.variacaoId === v.id && x.unidadeId === unidadeId)
                    const q = l?.quantidade ?? 0
                    return (
                      <span className={cx('numero', q <= 0 ? 'text-critico' : l?.minimo && q <= l.minimo ? 'text-atencao' : 'text-tinta')}>
                        {q}
                      </span>
                    )
                  },
                })),
              ]}
              linhas={produto.variacoes.filter((v) => v.ativa)}
              chave={(v) => v.id}
            />
          </Cartao>
        </Secao>
      )}

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

      {movimentos.length > 0 && (
        <Secao titulo="Últimos movimentos" resumo="Os 90 dias deste produto no estoque: o que entrou, saiu e foi corrigido.">
          <Cartao caixa>
            <ul className="flex flex-col divide-y divide-borda-suave text-sm">
              {movimentos.slice(0, 20).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-tinta">
                      <span className="text-tinta-3">{quando(m.criadoEm)} · </span>
                      {ROTULO_MOVIMENTO[m.tipo]}
                      {m.codigo ? <span className="font-mono text-xs text-tinta-3"> {m.codigo}</span> : null}
                      {lojas.length > 1 ? <span className="text-tinta-3"> · {m.unidade}</span> : null}
                    </span>
                    <span className="text-xs text-tinta-3">
                      {m.motivo} · {m.quem}
                    </span>
                  </span>
                  <span className={cx('numero shrink-0 font-semibold', m.quantidade < 0 ? 'text-critico' : 'text-bom')}>
                    {m.quantidade > 0 ? '+' : ''}
                    {m.quantidade}
                    <span className="ml-2 text-xs font-normal text-tinta-3">ficou {m.saldoDepois}</span>
                  </span>
                </li>
              ))}
            </ul>
            {movimentos.length > 20 && (
              <p className="pt-2 text-xs text-tinta-3">
                Mostrando 20 de {movimentos.length}. O resto está em{' '}
                <Link href={`/${slug}/estoque?q=${encodeURIComponent(produto.nome)}&periodo=90d`} className="font-medium text-marca underline-offset-2 hover:underline">
                  Estoque › Movimentos
                </Link>
                .
              </p>
            )}
          </Cartao>
        </Secao>
      )}

      <Secao titulo="Editar">
        <Editor slug={slug} eixos={eixos} categorias={categorias} produto={naTela} />
      </Secao>
    </Estrutura>
  )
}
