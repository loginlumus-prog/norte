import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { lerModo } from '@/servidor/modo'
import { comoOrg } from '@/servidor/banco'
import { vocabularioDaEmpresa, vocabularioDoEndereco } from '@/servidor/vocabulario'
import { pode, textoDaBusca, unidadesQuePodem } from '@/servidor/permissao'
import { podeVerCustoDe, saldoNaVista } from '@/servidor/produto'
import { palavra, plural } from '@/ui/texto'
import { VoltarAVenda } from './VoltarAVenda'
import { Excluir } from './Excluir'
import { EtiquetasEmLote } from './etiquetas/EmLote'
import { Estrutura } from '@/ui/Estrutura'
import { Aviso, Cartao, Situacao, Vazio, Ponto, cx } from '@/ui/base'
import { Tabela } from '@/ui/Tabela'
import { MENU } from '@/ui/menu'
import { escolherUnidade } from '@/servidor/unidade'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { Paginas } from '@/ui/Paginas'
import { ondeOCodigo } from '@/servidor/etiqueta'
import { fatiar, lerPagina } from '@/ui/paginacao'
import type { Tema } from '@/ui/TrocaTema'
import { CartaoFiltro } from '@/ui/premium'
import { fotoUrl } from '@/servidor/catalogo'

// "Serviços e materiais" na clínica (vocabulario.ts).
export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  return { title: (await vocabularioDoEndereco((await params).empresa)).Produtos }
}

type SituacaoItem = 'acabaram' | 'minimo' | 'ok'
type Ordem = 'nome' | 'vendidos' | 'estoque' | 'preco'
type Pendencia = 'sem-categoria' | 'sem-custo' | 'sem-ean' | 'sem-venda'

const MEDIDA: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

/** Cartões por página. Cada um traz a grade inteira do produto. */
const POR_PAGINA = 40

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
    mostrar?: string
    pagina?: string
    excluido?: string
  }>
}) {
  const { empresa: slug } = await params
  const {
    unidade: pedida, q: qBruto, categoria: categoriaPedida, situacao: sitPedida,
    marca: marcaPedida, ordem: ordemPedida, pendencia: pendenciaPedida, mostrar: mostrarPedido,
    pagina: paginaPedida, excluido,
  } = await searchParams
  // `?q=a&q=b` chega como lista; ver `textoDaBusca`.
  const q = textoDaBusca(qBruto)
  // Fora de venda: o que alguém tirou do balcão. Sem esta vista, tirar de
  // venda não tinha volta pela tela — toda lista mostra só o que está à venda.
  const fora = mostrarPedido === 'fora'
  const unidadePedida = typeof pedida === 'string' ? pedida : undefined
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
  // "Serviços e materiais", "+ Novo serviço ou material" na clínica (vocabulario.ts).
  const vocab = await vocabularioDaEmpresa(sessao.orgId)

  // O estoque é por loja. Sem este filtro, a tela somaria o saldo das duas e
  // o balconista da Loja Centro veria peça que está no Shopping.
  const onde = await escolherUnidade(sessao, empresa, unidadePedida, 'produto.ver')

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
        ativo: !fora,
        ...(categoriaId ? { categoriaId } : {}),
        ...(marca ? { marca } : {}),
        ...(q
          ? {
              OR: [
                { nome: { contains: q, mode: 'insensitive' } },
                { marca: { contains: q, mode: 'insensitive' } },
                { referencia: { contains: q, mode: 'insensitive' } },
                // O código inteiro, a etiqueta da grade e o pedaço dela
                // ("56522" acha 0056522) — a mesma régua do balcão (etiqueta.ts).
                { variacoes: { some: { OR: ondeOCodigo(q) } } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, marca: true, medida: true, custo: true, vendidoEm: true, servico: true,
        usoInterno: true, feitoNoDia: true, fotoId: true,
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

  // O saldo e a situação de cada variação saem de `saldoNaVista` — a mesma
  // conta do Estoque, para as duas telas dizerem o mesmo número à mesma
  // pessoa. A variação que nenhuma loja da vista vende, e que não tem saldo
  // nela, não aparece: "acabou" do que a loja nem vende é alarme falso.
  const lojasDaVista = onde.opcoes.filter((u) => onde.ids.includes(u.id))
  const vistaInteira = onde.unidadeId === null && unidadesQuePodem(sessao, 'produto.ver') === 'todas'
  const comSaldo = produtos
    .map((p) => ({
      ...p,
      variacoes: p.variacoes
        .map((v) => {
          const na = saldoNaVista(
            p.vendidoEm,
            v.estoques.map((e) => ({ unidadeId: e.unidadeId, quantidade: Number(e.quantidade), minimo: e.minimo === null ? null : Number(e.minimo) })),
            lojasDaVista,
            vistaInteira || fora,
            p.feitoNoDia,
          )
          // Serviço não tem estoque: nunca "acabou" (a manicure não some da
          // prateleira). Fica na lista, que é o catálogo, mas fora da conta.
          return { ...v, na: p.servico ? { ...na, nivel: 'bom' as const } : na }
        })
        .filter((v) => v.na.aparece),
    }))
    .filter((p) => fora || p.variacoes.length > 0)

  const totalDe = (p: { variacoes: { na: { saldo: number } }[] }) => p.variacoes.reduce((s, v) => s + v.na.saldo, 0)
  const margemDe = (p: { precoVista: unknown; custo: unknown }) => {
    const preco = Number(p.precoVista ?? 0)
    if (p.custo == null || preco <= 0) return null
    return ((preco - Number(p.custo)) / preco) * 100
  }

  // Conta a situação de cada variação uma vez, para a tira de cima e para o
  // cabeçalho de cada produto falarem a mesma coisa.
  const situacaoDe = (v: { na: { nivel: 'critico' | 'atencao' | 'bom' } }) => v.na.nivel
  const todas = comSaldo.filter((p) => !p.servico).flatMap((p) => p.variacoes)
  const conta = {
    bom: todas.filter((v) => situacaoDe(v) === 'bom' && !v.na.semLancamento).length,
    semLancamento: todas.filter((v) => v.na.semLancamento).length,
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
    ? comSaldo
        .map((p) => ({ ...p, variacoes: p.variacoes.filter((v) => situacaoDe(v) === nivelPedido && !(nivelPedido === 'bom' && v.na.semLancamento)) }))
        .filter((p) => p.variacoes.length > 0)
    : comSaldo

  // As pendências de cadastro: o que falta preencher para o sistema fazer
  // o que promete. Sem custo não há margem; sem categoria o balcão em grade
  // não tem aba; sem código de barras o leitor não lê.
  const pendente = (p: (typeof comSaldo)[number]) =>
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
  // Desenha uma página por vez: cada produto é um cartão com a grade inteira,
  // e 900 deles (7 mil variações) faziam a tela pesar 25 MB. A conta de cima
  // (tira, pendências) continua sobre a lista toda — ver ui/paginacao.ts.
  const fatia = fatiar(listados, lerPagina(paginaPedida), POR_PAGINA)
  const pendencias = {
    semCategoria: comSaldo.filter((p) => !p.categoria).length,
    semCusto: comSaldo.filter((p) => p.custo == null).length,
    semEan: comSaldo.filter((p) => p.variacoes.some((v) => !v.codigoBarras)).length,
    semVenda: comSaldo.filter((p) => !vendidos30.has(p.id)).length,
  }

  const atuais = {
    unidade: onde.unidadeId, q, categoria: categoriaId, situacao, marca,
    ordem: ordem === 'nome' ? null : ordem, pendencia, mostrar: fora ? 'fora' : null,
  }
  // O que a busca precisa carregar escondida: TODO filtro da tela menos o
  // próprio `q`. Antes iam só loja, categoria e situação — buscar apagava a
  // marca, a pendência, a ordem escolhidas.
  const { q: _q, ...manterNaBusca } = atuais
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
      titulo={vocab.Produtos}
      acao={
        <span className="flex flex-wrap items-center gap-2">
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
          {/* As etiquetas dos produtos marcados na lista (a caixa de cada cartão). */}
          {!fora && <EtiquetasEmLote acao={`/${slug}/produtos/etiquetas`} unidade={onde.unidadeId} />}
          {(q || categoriaId) && (
            // <a>: página de impressão abre inteira — ver etiquetas/page.tsx.
            <a
              href={linkEtiquetas}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Imprimir as etiquetas do que está filtrado"
            >
              Etiquetas
            </a>
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
          {(pode(sessao, 'produto.editar') || pode(sessao, 'produto.cadastrar') || pode(sessao, 'estoque.ajustar')) && (
            // A planilha: nome, gaveta, preço, custo e estoque de muitos de uma
            // vez, e cadastro em sequência. A ficha fica para grade e foto.
            <Link
              href={`/${slug}/produtos/rapida${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Editar nome, preço e estoque de vários produtos numa tabela"
            >
              Editar em planilha
            </Link>
          )}
          {pode(sessao, 'produto.cadastrar') && (
            // O catálogo que já existe em outro lugar (sistema antigo,
            // planilha, relatório) entra de uma vez — ver produtos/importar.
            <Link
              href={`/${slug}/produtos/importar`}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Trazer o catálogo de uma planilha (Excel, CSV) ou do sistema antigo"
            >
              Importar
            </Link>
          )}
          {pode(sessao, 'produto.cadastrar') && (
            <Link
              href={`/${slug}/produtos/novo`}
              className="botao-marca rounded-norte px-3 py-1.5 text-sm font-semibold text-marca-tinta"
            >
              + {vocab.novoProduto}
            </Link>
          )}
        </span>
      }
    >
      {/* Sem a tira de contagens no topo: as mesmas contas já estão nas
          fichas do filtro logo abaixo (acabaram, no mínimo, com estoque). */}

      {excluido === '1' && (
        <Aviso nivel="bom">
          Produto excluído. Se precisar dele de novo: filtro &ldquo;fora de venda&rdquo; → Editar → Produto à venda
          (ou o botão Reativar).
        </Aviso>
      )}

      {/* ── busca e filtros ── */}
      <div className="flex flex-col gap-2">
        <Busca
          valor={q}
          placeholder="Nome, marca ou etiqueta"
          rotulo="Buscar produto"
          manter={manterNaBusca}
          limparEm={link({ q: null })}
        />
        {/* O estoque em cartões: o número que a dona olha primeiro, e o
            cartão é o filtro. Conta itens da grade (cada tamanho/sabor). */}
        {!fora && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <CartaoFiltro href={link({ situacao: null })} ativo={situacao === null} cor="indigo" icone="sacola" numero={conta.critico + conta.atencao + conta.bom + conta.semLancamento} rotulo="Tudo" detalhe="itens à venda" />
            <CartaoFiltro href={link({ situacao: 'acabaram' })} ativo={situacao === 'acabaram'} cor="vermelho" icone="sono" numero={conta.critico} rotulo="Acabaram" detalhe="sem saldo" />
            <CartaoFiltro href={link({ situacao: 'minimo' })} ativo={situacao === 'minimo'} cor="ambar" icone="relogio" numero={conta.atencao} rotulo="No mínimo" detalhe="hora de repor" />
            <CartaoFiltro href={link({ situacao: 'ok' })} ativo={situacao === 'ok'} cor="verde" icone="estrela" numero={conta.bom} rotulo="Com estoque" detalhe="tudo certo" />
          </div>
        )}
        <Fichas
          opcoes={[
            { valor: null, rotulo: 'à venda' },
            { valor: 'fora', rotulo: 'fora de venda' },
          ]}
          atual={fora ? 'fora' : null}
          linkDe={(v) => link({ mostrar: v, situacao: null })}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">

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
        {/* Marca, pendência e ordem ficam atrás de "Mais filtros", como as
            categorias do Financeiro: abertas, eram três fileiras de fichas
            antes do primeiro produto (meia tela no celular). Com um deles
            escolhido, nasce aberto — filtro ativo não se esconde. */}
        {(!simples || marca || pendencia || ordem !== 'nome') && (
        <details open={!!(marca || pendencia || ordem !== 'nome')} className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-borda px-3 py-1.5 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta [&::-webkit-details-marker]:hidden">
            Mais filtros
            <span aria-hidden className="text-tinta-3 transition-transform group-open:rotate-180">▾</span>
          </summary>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 pt-2">
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
              { valor: 'vendidos', rotulo: `${vocab.maisVendidos.toLowerCase()} (30 dias)` },
              { valor: 'estoque', rotulo: 'mais estoque' },
              { valor: 'preco', rotulo: 'maior preço' },
            ]}
            atual={ordem === 'nome' ? null : ordem}
            linkDe={(v) => link({ ordem: v })}
          />
        </div>
        </details>
        )}
      </div>

      {fora && (
        <p className="text-sm text-tinta-2">
          Fora de venda: somem do balcão e continuam nos relatórios. &ldquo;Reativar&rdquo; devolve
          com a grade e o saldo.
        </p>
      )}

      {fora && listados.length === 0 && !q && !categoriaId && !marca && !pendencia && (
        <Cartao>
          <Vazio>Nenhum produto fora de venda.</Vazio>
        </Cartao>
      )}

      {!fora && produtos.length === 0 && !q && !categoriaId && (
        <Cartao>
          <Vazio
            acao={
              pode(sessao, 'produto.cadastrar') ? (
                // Quem chega de outro sistema não começa do zero: o catálogo
                // vem inteiro da planilha. Um por um continua ao lado.
                <span className="flex flex-wrap items-center justify-center gap-2">
                  <Link
                    href={`/${slug}/produtos/importar`}
                    className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta"
                  >
                    Trazer de outra planilha ou sistema
                  </Link>
                  <Link
                    href={`/${slug}/produtos/novo`}
                    className="rounded-norte border border-borda bg-superficie px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
                  >
                    Cadastrar um por um
                  </Link>
                </span>
              ) : undefined
            }
          >
            Nenhum {vocab.produto} cadastrado ainda. Tem o catálogo numa planilha ou no sistema antigo? Traga tudo de uma vez.
          </Vazio>
        </Cartao>
      )}

      {!fora && produtos.length > 0 && comSaldo.length === 0 && !q && !categoriaId && !marca && (
        <Cartao>
          <Vazio>Nenhum produto vendido nesta loja. O que cada loja vende se escolhe na ficha do produto, em &ldquo;Vendido em&rdquo;.</Vazio>
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

      <Paginas p={fatia} linkDe={(n) => link({ pagina: String(n) })} rotulo={vocab.produtos} />
      {fatia.itens.map((p) => {
        const total = totalDe(p)
        const acabaram = p.variacoes.filter((v) => situacaoDe(v) === 'critico').length
        const noMinimo = p.variacoes.filter((v) => situacaoDe(v) === 'atencao').length
        const margem = margemDe(p)
        const vendeu = vendidos30.get(p.id)
        // O custo é do produto, e só quem responde por alguma loja que o
        // vende lê — ver `podeVerCustoDe`.
        const podeVerCusto = podeVerCustoDe(sessao, p.vendidoEm)

        return (
          <article key={p.id} className="caixa-viva cartao-produto overflow-hidden rounded-2xl border border-borda bg-superficie">
            <div className="flex flex-wrap items-center gap-4 p-3.5 sm:flex-nowrap">
              {/* A foto (ou as iniciais na cor do nome): o produto se reconhece
                  de longe, antes de ler. */}
              <Link href={podeEditar ? `/${slug}/produtos/${p.id}` : '#'} className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-borda-suave bg-superficie-2" tabIndex={-1} aria-hidden>
                {p.fotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fotoUrl(slug, p.fotoId)!} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="produto-iniciais grid h-full w-full place-items-center text-lg font-extrabold">
                    {p.nome.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('') || '·'}
                  </span>
                )}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {podeEditar ? (
                    <Link href={`/${slug}/produtos/${p.id}`} className="truncate text-[15px] font-bold text-tinta hover:text-marca">
                      {p.nome}
                    </Link>
                  ) : (
                    <span className="truncate text-[15px] font-bold text-tinta">{p.nome}</span>
                  )}
                  {!simples && p.categoria && (
                    <Link href={link({ categoria: p.categoria.id })} className="etiqueta-cor rounded-full px-2 py-0.5 text-[11px] font-semibold">
                      {p.categoria.nome}
                    </Link>
                  )}
                  {!simples && p.marca && <span className="text-xs text-tinta-3">{p.marca}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {podeVerPreco && (
                    <span className="numero rounded-lg bg-superficie-2 px-2 py-1 font-bold text-tinta">{dinheiro(p.precoVista)}</span>
                  )}
                  {/* Material de uso não vende: margem dele é número sem uso. */}
                  {!simples && podeVerCusto && !p.usoInterno &&
                    (margem === null ? (
                      <Link href={`/${slug}/produtos/${p.id}`} className="rounded-lg bg-atencao-fundo px-2 py-1 font-semibold text-atencao" title="Sem custo cadastrado, não há margem">
                        sem custo
                      </Link>
                    ) : (
                      <span className={cx('numero rounded-lg px-2 py-1 font-semibold', margem < 20 ? 'bg-critico-fundo text-critico' : margem < 40 ? 'bg-atencao-fundo text-atencao' : 'bg-bom-fundo text-bom')}>
                        margem {margem.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
                      </span>
                    ))}
                  {!simples && p.usoInterno ? (
                    <span className="rounded-lg bg-superficie-2 px-2 py-1 text-tinta-2" title="Tem estoque e entra em compras e no material usado; não aparece no balcão">material de uso</span>
                  ) : !simples ? (
                    <span className="numero rounded-lg bg-superficie-2 px-2 py-1 text-tinta-2" title="Vendido nos últimos 30 dias, nesta loja">
                      {p.servico
                        ? vendeu
                          ? `${plural(vendeu, 'vez', 'vezes')} em 30 dias`
                          : 'nenhuma vez em 30 dias'
                        : vendeu
                          ? `${quantidade(vendeu, p.medida)} ${palavra(vendeu, 'vendido', 'vendidos')} em 30 dias`
                          : 'sem venda em 30 dias'}
                    </span>
                  ) : null}
                  {!simples && p.feitoNoDia && <span className="rounded-lg bg-superficie-2 px-2 py-1 text-tinta-2" title="A sobra sai ao fechar; zerado não é falta">feito no dia</span>}
                  {acabaram > 0 && <Ponto nivel="critico" quantos={acabaram} titulo="acabaram" />}
                  {noMinimo > 0 && <Ponto nivel="atencao" quantos={noMinimo} titulo="no mínimo" />}
                </div>
              </div>
              {/* O saldo, grande, à direita: é a pergunta da tela. */}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {fora ? (
                  <Situacao nivel="neutro">fora de venda</Situacao>
                ) : p.servico ? (
                  <Situacao nivel="neutro">serviço</Situacao>
                ) : p.variacoes.length > 0 && p.variacoes.every((v) => v.na.semLancamento) ? (
                  <Situacao nivel="neutro">sem estoque lançado</Situacao>
                ) : (
                  <span className={cx('numero text-xl leading-none font-extrabold', total > 0 ? 'text-tinta' : p.feitoNoDia ? 'text-tinta-3' : 'text-critico')}>
                    {quantidade(total, p.medida)}
                    <span className="ml-1 text-[11px] font-semibold text-tinta-3">{onde.unidadeId ? 'aqui' : 'no total'}</span>
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-xs">
                  {podeEditar && (
                    <Link href={`/${slug}/produtos/${p.id}`} className="botao-vivo rounded-lg border border-borda bg-superficie px-2.5 py-1 font-semibold text-tinta hover:border-marca hover:text-marca">
                      Editar
                    </Link>
                  )}
                  {fora && podeEditar && <VoltarAVenda slug={slug} produtoId={p.id} />}
                  {!fora && (
                    <>
                      {/* <a>: página de impressão abre inteira — ver etiquetas/page.tsx. */}
                      <a
                        href={`/${slug}/produtos/etiquetas?produto=${p.id}${onde.unidadeId ? `&unidade=${onde.unidadeId}` : ''}`}
                        className="botao-vivo rounded-lg border border-borda bg-superficie px-2 py-1 font-semibold text-tinta-2 hover:text-tinta"
                        title="Imprimir a etiqueta deste produto"
                      >
                        Etiqueta
                      </a>
                      {/* Marca para o lote: o formulário é o "Imprimir etiquetas" lá em cima (etiquetas/EmLote.tsx). */}
                      <input
                        type="checkbox"
                        form="etiquetas-lote"
                        name="produto"
                        value={p.id}
                        aria-label={`Marcar ${p.nome} para imprimir etiquetas`}
                        title="Marcar para imprimir as etiquetas junto"
                        className="size-4 accent-marca"
                      />
                    </>
                  )}
                  {!fora && podeEditar && (
                    <Excluir slug={slug} produtoId={p.id} nome={p.nome} medida={MEDIDA[p.medida] ?? ''} estoque={p.servico ? 0 : total} compacto />
                  )}
                </span>
              </div>
            </div>
            {/* A grade (tamanho, sabor, cor) fica recolhida: abre sozinha
                quando algum item acabou ou está no mínimo. Produto sem
                variação não precisa da tabela — o saldo já está ao lado. */}
            {p.variacoes.length > 1 || (p.variacoes[0] && !p.variacoes[0].padrao) ? (
              <details open={acabaram + noMinimo > 0} className="group border-t border-borda-suave">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="text-tinta-3 transition-transform group-open:rotate-90">›</span>
                  {plural(p.variacoes.length, 'variação', 'variações')}
                </summary>
                <div className="px-3.5 pb-3.5">
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
                  celula: (v) => (
                    p.servico ? (
                      <span className="text-xs text-tinta-3">serviço</span>
                    ) : (
                      v.na.doDia ? (
                        <Situacao nivel="neutro">feito no dia</Situacao>
                      ) : v.na.semLancamento ? (
                        <Situacao nivel="neutro">sem estoque lançado</Situacao>
                      ) : (
                        <Situacao nivel={situacaoDe(v)}>
                          {v.na.saldo <= 0 ? 'acabou' : quantidade(v.na.saldo, p.medida)}
                        </Situacao>
                      )
                    )
                  ),
                },
              ]}
              linhas={p.variacoes}
              chave={(v) => v.id}
              vazio="Este produto não tem nenhuma variação ativa."
            />
                </div>
              </details>
            ) : null}
          </article>
        )
      })}
      <Paginas p={fatia} linkDe={(n) => link({ pagina: String(n) })} rotulo={vocab.produtos} />
    </Estrutura>
  )
}
