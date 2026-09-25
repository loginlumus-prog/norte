import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { lerModo } from '@/servidor/modo'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { Cartao, Situacao, Vazio, Ponto, cx } from '@/ui/base'
import { Tira } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import { MENU } from '@/ui/menu'
import { escolherUnidade } from '@/servidor/unidade'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import type { Tema } from '@/ui/TrocaTema'

type SituacaoItem = 'acabaram' | 'minimo' | 'ok'
type Ordem = 'nome' | 'vendidos' | 'estoque' | 'preco'
type Pendencia = 'sem-categoria' | 'sem-custo' | 'sem-ean' | 'sem-venda'

const MEDIDA: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

const dinheiro = (v: unknown) =>
  v == null ? '—' : `R$ ${Number(v).toFixed(2).replace('.', ',')}`

/** Quantidade sai sem casas quando é inteira: "12", não "12,000". */
const quantidade = (v: unknown, medida: string) => {
  const n = Number(v)
  const texto = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace('.', ',')
  return `${texto} ${MEDIDA[medida] ?? ''}`
}

export default async function Produtos({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{
    unidade?: string
    q?: string
    categoria?: string
    situacao?: string
    marca?: string
    ordem?: string
    pendencia?: string
  }>
}) {
  const { empresa: slug } = await params
  const {
    unidade: pedida, q: qBruto, categoria: categoriaPedida, situacao: sitPedida,
    marca: marcaPedida, ordem: ordemPedida, pendencia: pendenciaPedida,
  } = await searchParams
  const q = (qBruto ?? '').trim()
  const situacao: SituacaoItem | null =
    sitPedida === 'acabaram' || sitPedida === 'minimo' || sitPedida === 'ok' ? sitPedida : null
  const ordem: Ordem = ordemPedida === 'vendidos' || ordemPedida === 'estoque' || ordemPedida === 'preco' ? ordemPedida : 'nome'
  const pendencia: Pendencia | null =
    pendenciaPedida === 'sem-categoria' || pendenciaPedida === 'sem-custo' || pendenciaPedida === 'sem-ean' || pendenciaPedida === 'sem-venda'
      ? pendenciaPedida
      : null
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'produto.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  // No simples a lista mostra o que o balcão pergunta — tem? quanto custa?
  // — e esconde o que é de quem cuida do cadastro: margem, marca, pendência,
  // ordenação, planilha. Filtro já escolhido continua à vista, senão a
  // pessoa que veio por um link não saberia por que a lista está curta.
  const simples = (await lerModo()) === 'simples'

  // O estoque é por loja. Sem este filtro, a tela somaria o saldo das duas e
  // o balconista da Loja Centro veria peça que está no Shopping.
  const onde = await escolherUnidade(sessao, empresa, pedida, 'produto.ver')

  // ── a lista, com o que a pessoa pediu ────────────────────
  // A busca cobre nome, marca e ETIQUETA. Etiqueta porque quem está com a
  // peça na mão lê o código dela, não o nome — e é assim que se acha "aquele
  // produto" em catálogo de 800 itens.
  const trintaDias = new Date(Date.now() - 30 * 864e5)
  const [categorias, marcas, vendidosBrutos] = await Promise.all([
    comoOrg(sessao.orgId, (db) =>
      db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true } }),
    ),
    comoOrg(sessao.orgId, (db) =>
      db.produto.findMany({
        where: { ativo: true, marca: { not: null } },
        distinct: ['marca'],
        orderBy: { marca: 'asc' },
        select: { marca: true },
      }),
    ),
    // Quanto cada produto vendeu nos últimos 30 dias, para ordenar e para
    // achar o que não vendeu nada — é a lista de quem precisa de promoção.
    comoOrg(sessao.orgId, (db) =>
      db.$queryRaw<{ produto_id: string; quantidade: string }[]>`
        select va.produto_id, sum(i.quantidade) as quantidade
          from venda_itens i
          join vendas v on v.id = i.venda_id
          join variacoes va on va.id = i.variacao_id
         where v.situacao = 'CONCLUIDA' and v.criada_em >= ${trintaDias}
           and v.unidade_id = any(${onde.ids})
         group by 1
      `,
    ),
  ])
  const categoriaId = categorias.some((c) => c.id === categoriaPedida) ? categoriaPedida! : null
  const marca = marcas.some((m) => m.marca === marcaPedida) ? marcaPedida! : null
  const vendidos30 = new Map(vendidosBrutos.map((v) => [v.produto_id, Number(v.quantidade)]))

  const produtos = await comoOrg(sessao.orgId, (db) =>
    db.produto.findMany({
      where: {
        ativo: true,
        ...(categoriaId ? { categoriaId } : {}),
        ...(marca ? { marca } : {}),
        ...(q
          ? {
              OR: [
                { nome: { contains: q, mode: 'insensitive' } },
                { marca: { contains: q, mode: 'insensitive' } },
                {
                  variacoes: {
                    some: {
                      OR: [{ codigo: { equals: q, mode: 'insensitive' } }, { codigoBarras: q }],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, marca: true, medida: true, custo: true,
        categoria: { select: { id: true, nome: true } },
        precoVista: true, precoCartao: true, precoCrediario: true,
        variacoes: {
          where: { ativa: true },
          orderBy: { codigo: 'asc' },
          select: {
            id: true, codigo: true, codigoBarras: true, padrao: true,
            opcoes: {
              select: { opcao: { select: { valor: true, hex: true, eixo: { select: { nome: true, ordem: true } } } } },
            },
            estoques: {
              where: { unidadeId: { in: onde.ids } },
              select: { quantidade: true, minimo: true, unidadeId: true },
            },
          },
        },
      },
    }),
  )

  const podeVerPreco = pode(sessao, 'produto.ver')
  const podeEditar = pode(sessao, 'produto.editar')
  const podeVerCusto = pode(sessao, 'produto.preco')

  const totalDe = (p: { variacoes: { estoques: { quantidade: unknown }[] }[] }) =>
    p.variacoes.reduce((s, v) => s + v.estoques.reduce((t, e) => t + Number(e.quantidade), 0), 0)
  const margemDe = (p: { precoVista: unknown; custo: unknown }) => {
    const preco = Number(p.precoVista ?? 0)
    if (p.custo == null || preco <= 0) return null
    return ((preco - Number(p.custo)) / preco) * 100
  }

  // Conta a situação de cada variação uma vez, para a tira de cima e para o
  // cabeçalho de cada produto falarem a mesma coisa.
  const situacaoDe = (v: { estoques: { quantidade: unknown; minimo: unknown }[] }) => {
    const q = v.estoques.reduce((t, e) => t + Number(e.quantidade), 0)
    const min = Number(v.estoques[0]?.minimo ?? 0)
    if (q <= 0) return 'critico' as const
    if (min > 0 && q <= min) return 'atencao' as const
    return 'bom' as const
  }
  const todas = produtos.flatMap((p) => p.variacoes)
  const conta = {
    bom: todas.filter((v) => situacaoDe(v) === 'bom').length,
    atencao: todas.filter((v) => situacaoDe(v) === 'atencao').length,
    critico: todas.filter((v) => situacaoDe(v) === 'critico').length,
  }

  // O filtro de situação é aplicado DEPOIS da conta de cima, de propósito:
  // a tira continua dizendo o quadro inteiro ("12 acabaram") enquanto a lista
  // mostra só o pedido. Filtrar antes faria a tira dizer "12 acabaram" com
  // "12 acabaram" embaixo — e a pessoa perderia a noção do todo.
  //
  // E filtra as VARIAÇÕES, não só o produto: pedindo "acabaram", a camiseta
  // aparece só com o tamanho que acabou, e não com a grade inteira.
  const nivelPedido = situacao === 'acabaram' ? 'critico' : situacao === 'minimo' ? 'atencao' : situacao === 'ok' ? 'bom' : null
  const porSituacao = nivelPedido
    ? produtos
        .map((p) => ({ ...p, variacoes: p.variacoes.filter((v) => situacaoDe(v) === nivelPedido) }))
        .filter((p) => p.variacoes.length > 0)
    : produtos

  // As pendências de cadastro: o que falta preencher para o sistema fazer
  // o que promete. Sem custo não há margem; sem categoria o balcão em grade
  // não tem aba; sem código de barras o leitor não lê.
  const pendente = (p: (typeof produtos)[number]) =>
    pendencia === 'sem-categoria' ? !p.categoria
    : pendencia === 'sem-custo' ? p.custo == null
    : pendencia === 'sem-ean' ? p.variacoes.some((v) => !v.codigoBarras)
    : pendencia === 'sem-venda' ? !vendidos30.has(p.id)
    : true
  const listados = porSituacao
    .filter(pendente)
    .sort((a, b) =>
      ordem === 'vendidos' ? (vendidos30.get(b.id) ?? 0) - (vendidos30.get(a.id) ?? 0)
      : ordem === 'estoque' ? totalDe(b) - totalDe(a)
      : ordem === 'preco' ? Number(b.precoVista ?? 0) - Number(a.precoVista ?? 0)
      : a.nome.localeCompare(b.nome),
    )
  const pendencias = {
    semCategoria: produtos.filter((p) => !p.categoria).length,
    semCusto: produtos.filter((p) => p.custo == null).length,
    semEan: produtos.filter((p) => p.variacoes.some((v) => !v.codigoBarras)).length,
    semVenda: produtos.filter((p) => !vendidos30.has(p.id)).length,
  }

  const atuais = {
    unidade: onde.unidadeId, q, categoria: categoriaId, situacao, marca,
    ordem: ordem === 'nome' ? null : ordem, pendencia,
  }
  const link = (mudanca: Record<string, string | null>) =>
    enderecoCom(`/${slug}/produtos`, atuais, mudanca)
  const linkEtiquetas = enderecoCom(`/${slug}/produtos/etiquetas`, { unidade: onde.unidadeId, q, categoria: categoriaId })

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/produtos`}
      tema={tema}
      titulo="Produtos"
      acao={
        <span className="flex flex-wrap items-center gap-2">
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
          {(q || categoriaId) && (
            <Link
              href={linkEtiquetas}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Imprimir as etiquetas do que está filtrado"
            >
              Etiquetas
            </Link>
          )}
          {!simples && (
            <a
              href={`/${slug}/produtos/exportar${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Baixar o catálogo em planilha"
            >
              Planilha
            </a>
          )}
          {podeEditar && (
            <Link
              href={`/${slug}/produtos/novo`}
              className="botao-marca rounded-norte px-3 py-1.5 text-sm font-semibold text-marca-tinta"
            >
              + Novo produto
            </Link>
          )}
        </span>
      }
    >
      {produtos.length > 0 && (
        <Tira
          itens={[
            { rotulo: 'com estoque', quantos: conta.bom, nivel: 'bom' },
            { rotulo: 'no mínimo', quantos: conta.atencao, nivel: 'atencao' },
            { rotulo: 'acabaram', um: 'acabou', quantos: conta.critico, nivel: 'critico' },
          ]}
        />
      )}

      {/* ── busca e filtros ── */}
      <div className="flex flex-col gap-2">
        <Busca
          valor={q}
          placeholder="Nome, marca ou etiqueta"
          rotulo="Buscar produto"
          manter={{ unidade: onde.unidadeId, categoria: categoriaId, situacao }}
          limparEm={link({ q: null })}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Fichas
            opcoes={[
              { valor: null, rotulo: 'tudo' },
              { valor: 'acabaram', rotulo: 'acabaram', quantos: conta.critico },
              { valor: 'minimo', rotulo: 'no mínimo', quantos: conta.atencao },
              { valor: 'ok', rotulo: 'com estoque', quantos: conta.bom },
            ]}
            atual={situacao}
            linkDe={(v) => link({ situacao: v })}
          />
          {categorias.length > 0 && (
            <Fichas
              opcoes={[
                { valor: null, rotulo: 'todas as categorias' },
                ...categorias.map((c) => ({ valor: c.id, rotulo: c.nome })),
              ]}
              atual={categoriaId}
              linkDe={(v) => link({ categoria: v })}
            />
          )}
        </div>
        {(!simples || marca || pendencia || ordem !== 'nome') && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          {/* Marca só vira filtro com poucas marcas: quarenta fichas de marca
              é uma parede, e aí a busca por nome resolve melhor. */}
          {marcas.length > 1 && marcas.length <= 12 && (
            <Fichas
              rotulo="Marca"
              opcoes={[{ valor: null, rotulo: 'todas' }, ...marcas.map((m) => ({ valor: m.marca!, rotulo: m.marca! }))]}
              atual={marca}
              linkDe={(v) => link({ marca: v })}
            />
          )}
          <Fichas
            rotulo="Pendência"
            opcoes={[
              { valor: null, rotulo: 'nenhuma' },
              { valor: 'sem-venda', rotulo: 'sem venda em 30 dias', quantos: pendencias.semVenda },
              { valor: 'sem-custo', rotulo: 'sem custo', quantos: pendencias.semCusto },
              { valor: 'sem-categoria', rotulo: 'sem categoria', quantos: pendencias.semCategoria },
              { valor: 'sem-ean', rotulo: 'sem código de barras', quantos: pendencias.semEan },
            ]}
            atual={pendencia}
            linkDe={(v) => link({ pendencia: v })}
          />
          <Fichas
            rotulo="Ordenar por"
            opcoes={[
              { valor: null, rotulo: 'nome' },
              { valor: 'vendidos', rotulo: 'mais vendidos (30 dias)' },
              { valor: 'estoque', rotulo: 'mais estoque' },
              { valor: 'preco', rotulo: 'maior preço' },
            ]}
            atual={ordem === 'nome' ? null : ordem}
            linkDe={(v) => link({ ordem: v })}
          />
        </div>
        )}
      </div>

      {produtos.length === 0 && !q && !categoriaId && (
        <Cartao>
          <Vazio
            acao={
              podeEditar ? (
                <Link
                  href={`/${slug}/produtos/novo`}
                  className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta"
                >
                  Cadastrar o primeiro
                </Link>
              ) : undefined
            }
          >
            Nenhum produto cadastrado ainda.
          </Vazio>
        </Cartao>
      )}

      {listados.length === 0 && (q || categoriaId || situacao || marca || pendencia) && (
        <Cartao>
          <Vazio>
            {q ? `Nada com “${q}”` : 'Nada'}
            {situacao === 'acabaram' ? ' acabou' : situacao === 'minimo' ? ' no mínimo' : ''}
            {categoriaId ? ` em ${categorias.find((c) => c.id === categoriaId)?.nome}` : ''}
            {marca ? ` da ${marca}` : ''}
            {pendencia ? ' com essa pendência' : ''}.
          </Vazio>
        </Cartao>
      )}

      {listados.map((p) => {
        const total = totalDe(p)
        const acabaram = p.variacoes.filter((v) => situacaoDe(v) === 'critico').length
        const noMinimo = p.variacoes.filter((v) => situacaoDe(v) === 'atencao').length
        const margem = margemDe(p)
        const vendeu = vendidos30.get(p.id)

        return (
          <Cartao
            key={p.id}
            titulo={p.nome}
            acao={
              <span className="flex flex-wrap items-center gap-2 text-xs text-tinta-3">
                {podeEditar && (
                  <Link
                    href={`/${slug}/produtos/${p.id}`}
                    className="font-semibold text-marca underline-offset-2 hover:underline"
                  >
                    editar
                  </Link>
                )}
                {!simples && (
                  <Link
                    href={`/${slug}/produtos/etiquetas?produto=${p.id}${onde.unidadeId ? `&unidade=${onde.unidadeId}` : ''}`}
                    className="hover:text-tinta"
                    title="Imprimir etiquetas deste produto"
                  >
                    etiquetas
                  </Link>
                )}
                {!simples && p.categoria && (
                  <Link href={link({ categoria: p.categoria.id })} className="hover:text-tinta">
                    {p.categoria.nome}
                  </Link>
                )}
                {!simples && p.marca && <span>{p.marca}</span>}
                {podeVerPreco && <span className="numero">{dinheiro(p.precoVista)} à vista</span>}
                {!simples && podeVerCusto &&
                  (margem === null ? (
                    <Link href={`/${slug}/produtos/${p.id}`} className="text-atencao hover:underline" title="Sem custo cadastrado, não há margem">
                      sem custo
                    </Link>
                  ) : (
                    <span className={cx('numero', margem < 20 ? 'text-critico' : margem < 40 ? 'text-atencao' : 'text-bom')}>
                      margem {margem.toFixed(0)}%
                    </span>
                  ))}
                {!simples && (
                  <span className="numero" title="Vendido nos últimos 30 dias, nesta loja">
                    {vendeu ? `${quantidade(vendeu, p.medida)} vendidos em 30 dias` : 'sem venda em 30 dias'}
                  </span>
                )}
                {acabaram > 0 && <Ponto nivel="critico" quantos={acabaram} titulo="acabaram" />}
                {noMinimo > 0 && <Ponto nivel="atencao" quantos={noMinimo} titulo="no mínimo" />}
                <Situacao nivel={total > 0 ? 'bom' : 'critico'}>
                  {quantidade(total, p.medida)} {onde.unidadeId ? 'aqui' : 'no total'}
                </Situacao>
              </span>
            }
          >
            <Tabela
              colunas={[
                {
                  chave: 'variacao',
                  titulo: p.variacoes[0]?.padrao ? 'Item' : 'Variação',
                  celula: (v) =>
                    v.padrao ? (
                      <span className="text-tinta-3">sem variação</span>
                    ) : (
                      // Sem quebra: "Azul" numa linha e "M" na outra lê como
                      // duas coisas. A tabela rola de lado se precisar.
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        {[...v.opcoes]
                          .sort((a, b) => a.opcao.eixo.ordem - b.opcao.eixo.ordem)
                          .map((o, i) => (
                            <span key={i} className="inline-flex items-center gap-1">
                              {o.opcao.hex && (
                                <span
                                  aria-hidden
                                  className="size-3 rounded-full border border-borda"
                                  style={{ background: o.opcao.hex }}
                                />
                              )}
                              {/* cor E texto: a bolinha sozinha exclui quem não distingue */}
                              <span>{o.opcao.valor}</span>
                            </span>
                          ))}
                      </span>
                    ),
                },
                {
                  chave: 'codigo',
                  titulo: 'Etiqueta',
                  celula: (v) => <span className="font-mono text-xs">{v.codigo ?? '—'}</span>,
                },
                {
                  chave: 'saldo',
                  titulo: 'Em estoque',
                  numero: true,
                  celula: (v) => {
                    const q = v.estoques.reduce((t, e) => t + Number(e.quantidade), 0)
                    const nivel = situacaoDe(v)
                    return (
                      <Situacao nivel={nivel}>
                        {q <= 0 ? 'acabou' : quantidade(q, p.medida)}
                      </Situacao>
                    )
                  },
                },
              ]}
              linhas={p.variacoes}
              chave={(v) => v.id}
              vazio="Este produto não tem nenhuma variação ativa."
            />
          </Cartao>
        )
      })}
    </Estrutura>
  )
}
