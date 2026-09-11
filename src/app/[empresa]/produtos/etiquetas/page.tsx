import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { svgCode128 } from '@/servidor/codigo-barras'
import { Imprimir } from '@/ui/Imprimir'

// As etiquetas, para imprimir.
//
// Quem vende por etiqueta precisa imprimi-la — e imprimir em casa é folha A4
// de adesivo (50 × 30 mm, o tamanho mais vendido) ou a impressora térmica
// (Elgin L42 Pro e parentes), que pede uma etiqueta por página. Os dois
// formatos saem daqui; a diferença é só o `@page`.
//
// O código de barras é Code 128 do código interno (CAM003), ou o EAN quando a
// peça tem. É o que o leitor do balcão lê, e é o que a busca do balcão acha.
//
// Sem a moldura do sistema: isto é papel. O menu não se imprime.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function Etiquetas({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{
    produto?: string
    variacao?: string
    categoria?: string
    q?: string
    unidade?: string
    copias?: string
    formato?: string
    imprimir?: string
  }>
}) {
  const { empresa: slug } = await params
  const p = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  if (!pode(sessao, 'produto.ver')) notFound()

  const onde = await escolherUnidade(sessao, empresa, p.unidade, 'produto.ver')
  const formato = p.formato === 'termica' ? 'termica' : 'a4'
  const copias = p.copias === 'estoque' ? 'estoque' : 'uma'
  const q = (p.q ?? '').trim()

  // Algum recorte é obrigatório: imprimir o catálogo inteiro sem querer são
  // oitocentas etiquetas e uma folha de adesivo perdida.
  if (!p.produto && !p.variacao && !p.categoria && !q) notFound()

  const variacoes = await comoOrg(sessao.orgId, (db) =>
    db.variacao.findMany({
      where: {
        ativa: true,
        produto: { ativo: true, ...(p.produto ? { id: p.produto } : {}), ...(p.categoria ? { categoriaId: p.categoria } : {}) },
        ...(p.variacao ? { id: p.variacao } : {}),
        ...(q
          ? { OR: [{ codigo: { equals: q, mode: 'insensitive' } }, { produto: { nome: { contains: q, mode: 'insensitive' } } }] }
          : {}),
      },
      orderBy: [{ produto: { nome: 'asc' } }, { codigo: 'asc' }],
      take: 400,
      select: {
        id: true, codigo: true, codigoBarras: true, ajustePreco: true,
        produto: { select: { nome: true, precoVista: true } },
        opcoes: { select: { opcao: { select: { valor: true, eixo: { select: { ordem: true } } } } } },
        estoques: { where: { unidadeId: { in: onde.ids } }, select: { quantidade: true } },
      },
    }),
  )

  // Uma etiqueta por item, ou uma por peça em estoque (para etiquetar a
  // caixa que acabou de chegar). Teto de 400 para a folha não virar rolo.
  const etiquetas = variacoes.flatMap((v) => {
    const saldo = v.estoques.reduce((s, e) => s + Number(e.quantidade), 0)
    const n = copias === 'estoque' ? Math.min(Math.max(Math.round(saldo), 0), 100) : 1
    const codigo = v.codigoBarras ?? v.codigo ?? ''
    if (!codigo) return []
    return Array.from({ length: n }, (_, i) => ({
      chave: `${v.id}-${i}`,
      nome: v.produto.nome,
      variacao: [...v.opcoes].sort((a, b) => a.opcao.eixo.ordem - b.opcao.eixo.ordem).map((o) => o.opcao.valor).join(' · '),
      codigo,
      preco: Number(v.produto.precoVista ?? 0) + Number(v.ajustePreco ?? 0),
      svg: svgCode128(codigo, { altura: 34, modulo: 1, margem: 6 }),
    }))
  }).slice(0, 400)

  const trocar = (m: Record<string, string | null>) => {
    const s = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...p, ...m })) if (v) s.set(k, v)
    s.delete('imprimir')
    return `/${slug}/produtos/etiquetas?${s.toString()}`
  }

  return (
    <div className="mx-auto max-w-5xl p-4 print:p-0">
      <style>{`
        @media print {
          .nao-imprime { display: none !important; }
          body { background: #fff !important; }
        }
        ${
          formato === 'termica'
            ? `@page { size: 50mm 30mm; margin: 0; }
               .folha { display: block; }
               .etiqueta { width: 50mm; height: 30mm; page-break-after: always; border: none !important; margin: 0; }`
            : `@page { size: A4; margin: 8mm; }
               .folha { display: grid; grid-template-columns: repeat(auto-fill, 50mm); gap: 2mm; justify-content: start; }
               .etiqueta { width: 50mm; height: 30mm; break-inside: avoid; }`
        }
        .etiqueta { box-sizing: border-box; padding: 1.5mm 2mm; display: flex; flex-direction: column; justify-content: space-between; color: #000; background: #fff; overflow: hidden; }
        .etiqueta .nome { font: 600 8pt/1.1 system-ui, sans-serif; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .etiqueta .var { font: 500 7pt/1.1 system-ui, sans-serif; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .etiqueta .barra svg { width: 100%; height: 9mm; display: block; }
        .etiqueta .pe { display: flex; justify-content: space-between; align-items: baseline; font: 7pt/1 ui-monospace, monospace; }
        .etiqueta .pe b { font: 700 10pt/1 system-ui, sans-serif; }
      `}</style>

      <div className="nao-imprime mb-4 flex flex-wrap items-center justify-between gap-3 rounded-norte border border-borda bg-superficie p-3">
        <div className="flex flex-col gap-1 text-sm">
          <b className="text-tinta">
            {etiquetas.length} etiqueta{etiquetas.length === 1 ? '' : 's'}
            {etiquetas.length === 400 ? ' (o máximo por vez)' : ''}
          </b>
          <span className="flex flex-wrap gap-x-3 text-xs text-tinta-2">
            <span>
              formato:{' '}
              <Link href={trocar({ formato: null })} className={formato === 'a4' ? 'font-bold text-tinta' : 'underline'}>
                folha A4 (50×30 mm)
              </Link>{' '}
              ·{' '}
              <Link href={trocar({ formato: 'termica' })} className={formato === 'termica' ? 'font-bold text-tinta' : 'underline'}>
                impressora térmica
              </Link>
            </span>
            <span>
              cópias:{' '}
              <Link href={trocar({ copias: null })} className={copias === 'uma' ? 'font-bold text-tinta' : 'underline'}>
                uma por item
              </Link>{' '}
              ·{' '}
              <Link href={trocar({ copias: 'estoque' })} className={copias === 'estoque' ? 'font-bold text-tinta' : 'underline'}>
                uma por peça em estoque
              </Link>
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${slug}/produtos`} className="text-sm text-tinta-2 hover:text-tinta">
            ← voltar
          </Link>
          <Imprimir automatico={p.imprimir === '1'} rotulo="Imprimir etiquetas" />
        </div>
      </div>

      {etiquetas.length === 0 ? (
        <p className="nao-imprime py-10 text-center text-sm text-tinta-3">
          Nenhum item com código para etiquetar nesse recorte.
        </p>
      ) : (
        <div className="folha">
          {etiquetas.map((e) => (
            <div key={e.chave} className="etiqueta rounded-sm border border-borda print:rounded-none">
              <div>
                <div className="nome">{e.nome}</div>
                {e.variacao && <div className="var">{e.variacao}</div>}
              </div>
              {/* O SVG é nosso, gerado de um código ASCII já filtrado — não há
                  texto de usuário solto dentro dele além do aria-label escapado. */}
              <div className="barra" dangerouslySetInnerHTML={{ __html: e.svg }} />
              <div className="pe">
                <span>{e.codigo}</span>
                <b>{brl(e.preco)}</b>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
