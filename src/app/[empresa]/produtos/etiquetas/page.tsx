import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { comoOrg } from '@/servidor/banco'
import { pode, textoDaBusca } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { ondeOCodigo } from '@/servidor/etiqueta'
import { codigoDoProduto } from '@/servidor/etiqueta-layout'
import { centavos } from '@/servidor/dinheiro'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { plural } from '@/ui/texto'
import { EtiquetasSimples } from './Simples'
import { EtiquetasDaLoja, type ProdutoDaLoja } from './DaLoja'

export const metadata: Metadata = { title: 'Etiquetas' }

// As etiquetas, para imprimir. Dois modelos:
//
//  · DA LOJA — o papel de gôndola da loja que vende em três preços: o código
//    grande, o nome e à vista/Pix, cartão até Nx e crediário, com o selo
//    "ECONOMIZE X% À VISTA" (servidor/etiqueta-layout.ts). É o padrão de
//    quem tem os três preços diferentes: a equipe e a cliente já leem assim;
//  · SIMPLES — nome, variação, código de barras e só o à vista, em folha A4
//    ou na térmica 50×30 (Simples.tsx). O de quem vende por um preço só.
//
// Sem a moldura do sistema: isto é papel. O menu não se imprime.

type Modelo = 'loja' | 'simples'

/** Produtos por impressão. Um lote maior que isto é catálogo, não etiqueta. */
const MAXIMO_DE_PRODUTOS = 200

const texto = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim().slice(0, 200) || undefined : undefined)

export default async function Etiquetas({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug } = await params
  const bruto = await searchParams
  // O endereço é do usuário. `produto` pode vir REPETIDO — é o lote marcado
  // na lista de produtos —, e só ele aceita lista. Nos outros, lista no
  // `where` do Prisma derrubava a tela: só texto passa, o resto some.
  const ids = [
    ...new Set(
      (Array.isArray(bruto.produto) ? bruto.produto : [bruto.produto])
        .map(texto)
        .filter((v): v is string => !!v && /^[\w-]{1,64}$/.test(v)),
    ),
  ].slice(0, MAXIMO_DE_PRODUTOS)
  const p = {
    variacao: texto(bruto.variacao),
    categoria: texto(bruto.categoria),
    unidade: texto(bruto.unidade),
    copias: texto(bruto.copias),
    formato: texto(bruto.formato),
    imprimir: texto(bruto.imprimir),
    modelo: texto(bruto.modelo),
  }
  const { empresa, sessao } = await exigirEntrada(slug)
  if (!pode(sessao, 'produto.ver')) semAcesso(slug, 'cargo')

  const onde = await escolherUnidade(sessao, empresa, p.unidade, 'produto.ver')
  const q = textoDaBusca(texto(bruto.q))

  // Algum recorte é obrigatório: imprimir o catálogo inteiro sem querer são
  // oitocentas etiquetas e uma folha de adesivo perdida. Sem recorte, a
  // tela diz como escolher — antes caía no "link errado ou sem acesso", que
  // parece sistema quebrado para quem só clicou em "Etiquetas".
  if (!ids.length && !p.variacao && !p.categoria && !q) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
        <h1 className="text-lg font-bold tracking-tight text-tinta">Etiquetas</h1>
        <p className="text-sm leading-relaxed text-tinta-2">
          Escolha o que etiquetar: busque pelo nome ou pela etiqueta abaixo, ou marque os produtos em Produtos e clique
          em &ldquo;Imprimir etiquetas&rdquo;. Imprimir o catálogo inteiro de uma vez não é oferecido de propósito — são
          centenas de etiquetas e um rolo perdido.
        </p>
        <form className="flex flex-wrap gap-2">
          {onde.unidadeId && <input type="hidden" name="unidade" value={onde.unidadeId} />}
          {p.modelo && <input type="hidden" name="modelo" value={p.modelo} />}
          <input
            name="q"
            placeholder="Nome ou etiqueta"
            aria-label="O que etiquetar"
            className="min-w-[14rem] flex-1 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
          />
          <button
            type="submit"
            className="rounded-norte border border-borda bg-superficie px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Ver etiquetas
          </button>
        </form>
        <Link href={`/${slug}/produtos`} className="text-sm font-medium text-marca underline-offset-2 hover:underline">
          ← voltar para Produtos
        </Link>
      </div>
    )
  }

  // O modelo da loja é o padrão de quem tem os três preços DIFERENTES em
  // algum produto: é a etiqueta que existe para mostrar a diferença.
  const modelo: Modelo =
    p.modelo === 'loja' || p.modelo === 'simples'
      ? p.modelo
      : (await temTresPrecos(sessao.orgId))
        ? 'loja'
        : 'simples'

  const linkDe = (mudanca: Record<string, string | null>) => {
    const s = new URLSearchParams()
    for (const id of ids) s.append('produto', id)
    const resto: Record<string, string | null | undefined> = {
      variacao: p.variacao, categoria: p.categoria, q: q || null, unidade: p.unidade,
      copias: p.copias, formato: p.formato, modelo: p.modelo, ...mudanca,
    }
    for (const [k, v] of Object.entries(resto)) if (v) s.set(k, v)
    return `/${slug}/produtos/etiquetas?${s.toString()}`
  }
  const voltar =
    ids.length === 1 && pode(sessao, 'produto.editar')
      ? `/${slug}/produtos/${ids[0]}`
      : `/${slug}/produtos${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`

  const escolhaDoModelo = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta-2">
      modelo:
      {/* <a>, e não <Link>: o modelo simples leva a folha de impressão no
          <style> com o bilhete desta página — ver Simples.tsx. */}
      <a href={linkDe({ modelo: 'loja' })} className={modelo === 'loja' ? 'font-bold text-tinta' : 'underline'}>
        da loja — três preços
      </a>
      ·
      <a href={linkDe({ modelo: 'simples' })} className={modelo === 'simples' ? 'font-bold text-tinta' : 'underline'}>
        simples — código de barras e preço à vista
      </a>
    </span>
  )

  if (modelo === 'simples') {
    return (
      <EtiquetasSimples
        orgId={sessao.orgId}
        unidadeIds={onde.ids}
        ids={ids}
        variacao={p.variacao}
        categoria={p.categoria}
        q={q}
        formato={p.formato === 'termica' ? 'termica' : 'a4'}
        copias={p.copias === 'estoque' ? 'estoque' : 'uma'}
        imprimir={p.imprimir === '1'}
        nonce={nonce}
        linkDe={linkDe}
        voltar={voltar}
        cabecalho={escolhaDoModelo}
      />
    )
  }

  // ── o modelo da loja ─────────────────────────────────────
  // "CARTÃO ATÉ Nx": o teto do crédito que o balcão oferece (Configurações › Balcão).
  const conf = await comoOrg(sessao.orgId, (db) =>
    db.org.findUnique({ where: { id: sessao.orgId }, select: { creditoMaxParcelas: true } }),
  )
  const lidos = await comoOrg(sessao.orgId, (db) =>
    db.produto.findMany({
      where: {
        ativo: true,
        ...(ids.length ? { id: { in: ids } } : {}),
        ...(p.categoria ? { categoriaId: p.categoria } : {}),
        ...(p.variacao ? { variacoes: { some: { id: p.variacao } } } : {}),
        ...(q
          ? {
              OR: [
                { nome: { contains: q, mode: 'insensitive' } },
                { referencia: { contains: q, mode: 'insensitive' } },
                // O código inteiro, a etiqueta da grade e o pedaço dela — a mesma régua do balcão.
                { variacoes: { some: { OR: ondeOCodigo(q) } } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      take: MAXIMO_DE_PRODUTOS + 1,
      select: {
        id: true, nome: true, referencia: true, precoVista: true, precoCartao: true, precoCrediario: true,
        categoria: { select: { nome: true } },
        variacoes: {
          where: { ativa: true },
          orderBy: { codigo: 'asc' },
          select: {
            id: true, codigo: true, codigoBarras: true, ajustePreco: true,
            opcoes: { select: { opcao: { select: { valor: true, ordem: true, eixo: { select: { ordem: true } } } } } },
            estoques: { where: { unidadeId: { in: onde.ids } }, select: { quantidade: true } },
          },
        },
      },
    }),
  )
  const passou = lidos.length > MAXIMO_DE_PRODUTOS
  // O lote marcado sai na ordem em que veio; a busca, por nome.
  const ordem = new Map(ids.map((id, i) => [id, i]))
  const produtos: ProdutoDaLoja[] = lidos
    .slice(0, MAXIMO_DE_PRODUTOS)
    .sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0))
    .map((prod) => {
      const opcoesEmOrdem = (v: (typeof prod.variacoes)[number]) =>
        [...v.opcoes].sort((a, b) => a.opcao.eixo.ordem - b.opcao.eixo.ordem)
      // Na ordem da grade (P, M, G; 34, 35, 36), não na do código: é a
      // ordem em que as peças saem "pelo estoque" e se repetem em roda.
      const variacoes = [...prod.variacoes].sort((a, b) => {
        const oa = opcoesEmOrdem(a).map((o) => o.opcao.ordem)
        const ob = opcoesEmOrdem(b).map((o) => o.opcao.ordem)
        for (let i = 0; i < Math.max(oa.length, ob.length); i++) if ((oa[i] ?? 0) !== (ob[i] ?? 0)) return (oa[i] ?? 0) - (ob[i] ?? 0)
        return (a.codigo ?? '').localeCompare(b.codigo ?? '')
      })
      // O código que o leitor e o balcão acham: o interno, ou o EAN quando só ele existe.
      const codigoDe = (v: (typeof variacoes)[number]) => v.codigo ?? v.codigoBarras ?? null
      const ajuste = (v: (typeof variacoes)[number]) => centavos(v.ajustePreco ?? 0)
      return {
        id: prod.id,
        nome: prod.nome,
        referencia: prod.referencia,
        categoria: prod.categoria?.nome ?? null,
        // A raiz sai de TODAS as variações: etiquetar só o 38 da calça ainda imprime o código da calça.
        codigo: codigoDoProduto(variacoes.map(codigoDe)),
        semPreco: !(Number(prod.precoVista) > 0),
        variacoes: variacoes
          .filter((v) => !p.variacao || v.id === p.variacao)
          .map((v) => ({
            codigo: codigoDe(v),
            opcoes: opcoesEmOrdem(v).map((o) => o.opcao.valor).join(' · ') || null,
            vista: centavos(prod.precoVista ?? 0) + ajuste(v),
            cartao: prod.precoCartao != null ? centavos(prod.precoCartao) + ajuste(v) : null,
            crediario: prod.precoCrediario != null ? centavos(prod.precoCrediario) + ajuste(v) : null,
            saldo: v.estoques.reduce((s, e) => s + Number(e.quantidade), 0),
          })),
      }
    })
    .filter((prod) => prod.variacoes.length > 0)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-norte border border-borda bg-superficie p-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-bold tracking-tight text-tinta">
            Etiquetas{' '}
            <span className="text-sm font-medium text-tinta-3">
              · {produtos.length === 1 ? produtos[0]!.nome : plural(produtos.length, 'produto', 'produtos')}
            </span>
          </h1>
          {escolhaDoModelo}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onde.mostrarSeletor && (
            <span className="flex items-center gap-1.5 text-xs text-tinta-3">
              estoque de
              <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />
            </span>
          )}
          <Link href={voltar} className="text-sm text-tinta-2 hover:text-tinta">
            ← voltar
          </Link>
        </div>
      </div>

      {passou && (
        <p className="rounded-norte border border-atencao-borda bg-atencao-fundo p-3 text-sm text-tinta">
          A busca achou mais de {MAXIMO_DE_PRODUTOS} produtos; aparecem os primeiros {MAXIMO_DE_PRODUTOS}, por nome. Para os
          outros, busque mais específico ou marque os produtos na lista.
        </p>
      )}

      {produtos.length === 0 ? (
        <p className="py-10 text-center text-sm text-tinta-3">Nenhum produto à venda nesse recorte.</p>
      ) : (
        <EtiquetasDaLoja produtos={produtos} parcelasCartao={conf?.creditoMaxParcelas ?? 1} nonce={nonce} />
      )}
    </div>
  )
}

/** Algum produto à venda com o preço do cartão ou do crediário diferente do à vista. */
async function temTresPrecos(orgId: string): Promise<boolean> {
  const linhas = await comoOrg(orgId, (db) =>
    db.$queryRaw<{ tem: boolean }[]>`
      select exists (
        select 1 from produtos
         where org_id = ${orgId} and ativo
           and (preco_cartao <> preco_vista or preco_crediario <> preco_vista)
      ) as tem
    `,
  )
  return linhas[0]?.tem === true
}
