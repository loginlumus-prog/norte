import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { Cartao, Situacao, Vazio, Ponto } from '@/ui/base'
import { Tira } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import { MENU } from '@/ui/menu'
import { escolherUnidade } from '@/servidor/unidade'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import type { Tema } from '@/ui/TrocaTema'

type SituacaoItem = 'acabaram' | 'minimo' | 'ok'

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
  searchParams: Promise<{ unidade?: string; q?: string; categoria?: string; situacao?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, q: qBruto, categoria: categoriaPedida, situacao: sitPedida } = await searchParams
  const q = (qBruto ?? '').trim()
  const situacao: SituacaoItem | null =
    sitPedida === 'acabaram' || sitPedida === 'minimo' || sitPedida === 'ok' ? sitPedida : null
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // O estoque é por loja. Sem este filtro, a tela somaria o saldo das duas e
  // o balconista da Loja Centro veria peça que está no Shopping.
  const onde = await escolherUnidade(sessao, empresa, pedida, 'produto.ver')

  // ── a lista, com o que a pessoa pediu ────────────────────
  // A busca cobre nome, marca e ETIQUETA. Etiqueta porque quem está com a
  // peça na mão lê o código dela, não o nome — e é assim que se acha "aquele
  // produto" em catálogo de 800 itens.
  const categorias = await comoOrg(sessao.orgId, (db) =>
    db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true } }),
  )
  const categoriaId = categorias.some((c) => c.id === categoriaPedida) ? categoriaPedida! : null

  const produtos = await comoOrg(sessao.orgId, (db) =>
    db.produto.findMany({
      where: {
        ativo: true,
        ...(categoriaId ? { categoriaId } : {}),
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
        id: true, nome: true, marca: true, medida: true,
        categoria: { select: { id: true, nome: true } },
        precoVista: true, precoCartao: true, precoCrediario: true,
        variacoes: {
          where: { ativa: true },
          orderBy: { codigo: 'asc' },
          select: {
            id: true, codigo: true, padrao: true,
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
  const listados = nivelPedido
    ? produtos
        .map((p) => ({ ...p, variacoes: p.variacoes.filter((v) => situacaoDe(v) === nivelPedido) }))
        .filter((p) => p.variacoes.length > 0)
    : produtos

  const atuais = { unidade: onde.unidadeId, q, categoria: categoriaId, situacao }
  const link = (mudanca: Record<string, string | null>) =>
    enderecoCom(`/${slug}/produtos`, atuais, mudanca)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/produtos`}
      tema={tema}
      titulo="Produtos"
      acao={
        <span className="flex items-center gap-2">
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
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
            { rotulo: 'acabaram', quantos: conta.critico, nivel: 'critico' },
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

      {listados.length === 0 && (q || categoriaId || situacao) && (
        <Cartao>
          <Vazio>
            {q ? `Nada com “${q}”` : 'Nada'}
            {situacao === 'acabaram' ? ' acabou' : situacao === 'minimo' ? ' no mínimo' : ''}
            {categoriaId ? ` em ${categorias.find((c) => c.id === categoriaId)?.nome}` : ''}.
          </Vazio>
        </Cartao>
      )}

      {listados.map((p) => {
        const total = p.variacoes.reduce(
          (s, v) => s + v.estoques.reduce((t, e) => t + Number(e.quantidade), 0),
          0,
        )
        const acabaram = p.variacoes.filter((v) => situacaoDe(v) === 'critico').length
        const noMinimo = p.variacoes.filter((v) => situacaoDe(v) === 'atencao').length

        return (
          <Cartao
            key={p.id}
            titulo={p.nome}
            acao={
              <span className="flex items-center gap-2 text-xs text-tinta-3">
                {podeEditar && (
                  <Link
                    href={`/${slug}/produtos/${p.id}`}
                    className="font-semibold text-marca underline-offset-2 hover:underline"
                  >
                    editar
                  </Link>
                )}
                {p.categoria && (
                  <Link href={link({ categoria: p.categoria.id })} className="hover:text-tinta">
                    {p.categoria.nome}
                  </Link>
                )}
                {p.marca && <span>{p.marca}</span>}
                {podeVerPreco && <span className="numero">{dinheiro(p.precoVista)} à vista</span>}
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
                      <span className="flex flex-wrap items-center gap-1.5">
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
