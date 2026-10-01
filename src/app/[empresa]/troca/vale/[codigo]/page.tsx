import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { valeParaImprimir } from '@/servidor/troca'
import { mostrarDiaDaColuna } from '@/servidor/dia'
import { Imprimir } from '@/ui/Imprimir'

export const metadata: Metadata = { title: 'Vale-troca' }

// O papel do vale-troca, em 80 mm: o que sobrou de uma troca (ou de uma
// devolução) e que a cliente leva para gastar depois. O código é o que o
// balcão digita — grande, sem letra ambígua (ver `gerarCodigoDeVale`). Com a
// cliente escolhida, o balcão já oferece o vale sozinho; o papel é para
// quando ela volta sem cadastro, ou para ela saber quanto tem.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
const cnpj = (d: string | null) => {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  return d || null
}

export default async function PapelDoVale({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; codigo: string }>
  searchParams: Promise<{ imprimir?: string }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug, codigo } = await params
  const { imprimir } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.criar' })

  const v = await valeParaImprimir(sessao, decodeURIComponent(codigo))
  if (!v) notFound()
  const doc = cnpj(v.loja?.documento ?? null)

  return (
    <div className="mx-auto max-w-[80mm] p-3 print:p-0">
      {/* Com o bilhete (nonce): em produção a CSP só deixa entrar <style> que o tenha — ver comprovante/page.tsx. */}
      <style nonce={nonce}>{`
        @page { size: 80mm auto; margin: 4mm; }
        @media print { .nao-imprime { display: none !important; } body { background: #fff !important; } }
        .cupom { color: #000; background: #fff; font: 9.5pt/1.35 ui-monospace, 'Cascadia Mono', Consolas, monospace; }
        .cupom .linha { border-top: 1px dashed #000; margin: 6px 0; }
        .cupom table { width: 100%; border-collapse: collapse; }
        .cupom td { vertical-align: top; padding: 1px 0; }
        .cupom .num { text-align: right; white-space: nowrap; }
      `}</style>

      <div className="nao-imprime mb-3 flex items-center justify-between gap-2">
        <Link href={`/${slug}/troca`} className="text-sm text-tinta-2 hover:text-tinta">
          ← troca
        </Link>
        <Imprimir automatico={imprimir === '1'} rotulo="Imprimir" />
      </div>

      <div className="cupom rounded-norte border border-borda p-3 print:rounded-none print:border-0 print:p-0">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: '12pt' }}>{v.loja?.apelido ?? v.loja?.nome ?? empresa.nome}</div>
          {doc && <div>CNPJ {doc}</div>}
          {v.loja?.telefone && <div>Tel. {v.loja.telefone}</div>}
        </div>
        <div className="linha" />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: '13pt', letterSpacing: '0.08em' }}>VALE-TROCA</div>
          <div style={{ fontWeight: 700, fontSize: '20pt', letterSpacing: '0.12em', margin: '6px 0' }}>{v.codigo}</div>
          <div style={{ fontWeight: 700, fontSize: '14pt' }}>{brl(v.saldo)}</div>
          {v.saldo < v.valor && <div>(de {brl(v.valor)}; o resto já foi usado)</div>}
        </div>
        <div className="linha" />
        <table>
          <tbody>
            {v.cliente && (
              <tr>
                <td>Cliente</td>
                <td className="num">{v.cliente}</td>
              </tr>
            )}
            <tr>
              <td>Emitido</td>
              <td className="num">{quando(v.criadoEm)}</td>
            </tr>
            {v.daVenda !== null && (
              <tr>
                <td>Da troca da venda</td>
                <td className="num">nº {v.daVenda}</td>
              </tr>
            )}
            {v.validade && (
              <tr>
                <td>
                  <b>Vale até</b>
                </td>
                <td className="num">
                  <b>{mostrarDiaDaColuna(v.validade, 'longo')}</b>
                </td>
              </tr>
            )}
            <tr>
              <td>Atendimento</td>
              <td className="num">{v.quem}</td>
            </tr>
          </tbody>
        </table>
        <div className="linha" />
        <div style={{ textAlign: 'center', fontSize: '8pt', color: '#333' }}>
          <div>Apresente este código no caixa: ele paga uma compra{v.valePorLoja && v.loja ? ` nesta loja (${v.loja.nome})` : ''}.</div>
          <div>Documento sem valor fiscal.</div>
        </div>
      </div>
    </div>
  )
}
