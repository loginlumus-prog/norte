import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharVenda } from '@/servidor/venda'
import { comoOrg } from '@/servidor/banco'
import { Imprimir } from '@/ui/Imprimir'

// O comprovante da venda, em papel de 80 mm.
//
// Não é nota fiscal e diz isso em letra legível: é a via do cliente, o que
// ele leva para trocar depois e o que a loja imprime na bobina térmica. A
// nota fiscal (NFC-e) é outro papel, com outro caminho, e não se confunde
// com este de propósito.
//
// Sem a moldura do sistema. O menu não se imprime.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito',
  CREDIARIO: 'Crediário', VALE: 'Vale de troca', TRANSFERENCIA: 'Transferência',
}
const MEDIDA: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

const brl = (v: unknown) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (v: unknown, medida: string) => {
  const n = Number(v)
  const t = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace('.', ',')
  return `${t} ${MEDIDA[medida] ?? ''}`.trim()
}
const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
const cnpj = (d: string | null) => {
  if (!d) return null
  const s = d.replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
  return d
}

export default async function Comprovante({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>
  searchParams: Promise<{ imprimir?: string }>
}) {
  const { empresa: slug, id } = await params
  const { imprimir } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.ver' })

  const v = await acharVenda(sessao, id)
  if (!v) notFound()

  const [org, unidade] = await Promise.all([
    comoOrg(sessao.orgId, (db) =>
      db.org.findUniqueOrThrow({
        where: { id: sessao.orgId },
        select: { nome: true, razaoSocial: true, documento: true, telefone: true, whatsapp: true },
      }),
    ),
    comoOrg(sessao.orgId, (db) =>
      db.unidade.findUnique({
        where: { id: v.unidadeId },
        select: {
          nome: true, apelido: true, documento: true, endereco: true, numero: true, bairro: true,
          cidade: true, estado: true, telefone: true,
        },
      }),
    ),
  ])

  const endereco = unidade
    ? [
        [unidade.endereco, unidade.numero].filter(Boolean).join(', '),
        unidade.bairro,
        [unidade.cidade, unidade.estado].filter(Boolean).join(' - '),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const documento = cnpj(unidade?.documento ?? org.documento)
  const telefone = unidade?.telefone ?? org.whatsapp ?? org.telefone
  const devolvido = v.devolucoes.reduce((s, d) => s + Number(d.valor), 0)

  return (
    <div className="mx-auto max-w-[80mm] p-3 print:p-0">
      <style>{`
        @page { size: 80mm auto; margin: 4mm; }
        @media print { .nao-imprime { display: none !important; } body { background: #fff !important; } }
        .cupom { color: #000; background: #fff; font: 9.5pt/1.35 ui-monospace, 'Cascadia Mono', Consolas, monospace; }
        .cupom .linha { border-top: 1px dashed #000; margin: 6px 0; }
        .cupom table { width: 100%; border-collapse: collapse; }
        .cupom td { vertical-align: top; padding: 1px 0; }
        .cupom .num { text-align: right; white-space: nowrap; }
      `}</style>

      <div className="nao-imprime mb-3 flex items-center justify-between gap-2">
        <Link href={`/${slug}/vendas/${v.id}`} className="text-sm text-tinta-2 hover:text-tinta">
          ← ficha da venda
        </Link>
        <Imprimir automatico={imprimir === '1'} rotulo="Imprimir" />
      </div>

      <div className="cupom rounded-norte border border-borda p-3 print:rounded-none print:border-0 print:p-0">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: '12pt' }}>{unidade?.apelido ?? empresa.nome}</div>
          {org.razaoSocial && org.razaoSocial !== empresa.nome && <div>{org.razaoSocial}</div>}
          {documento && <div>CNPJ/CPF {documento}</div>}
          {endereco && <div>{endereco}</div>}
          {telefone && <div>Tel. {telefone}</div>}
        </div>

        <div className="linha" />
        <table>
          <tbody>
            <tr>
              <td>Venda</td>
              <td className="num">
                <b>nº {v.numero}</b>
              </td>
            </tr>
            <tr>
              <td>Data</td>
              <td className="num">{quando(v.criadaEm)}</td>
            </tr>
            {v.vendedorNome && (
              <tr>
                <td>Atendimento</td>
                <td className="num">{v.vendedorNome}</td>
              </tr>
            )}
            {v.cliente && (
              <tr>
                <td>Cliente</td>
                <td className="num">{v.cliente.nome}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="linha" />
        <table>
          <tbody>
            {v.itens.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.descricao}
                  <br />
                  <span style={{ color: '#333' }}>
                    {qtd(i.quantidade, i.medida)} × {brl(i.precoUnit)}
                    {i.codigo ? ` · ${i.codigo}` : ''}
                  </span>
                </td>
                <td className="num">{brl(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="linha" />
        <table>
          <tbody>
            {(Number(v.desconto) > 0 || Number(v.descontoPontos) > 0) && (
              <tr>
                <td>Subtotal</td>
                <td className="num">{brl(v.subtotal)}</td>
              </tr>
            )}
            {Number(v.desconto) > 0 && (
              <tr>
                <td>Desconto</td>
                <td className="num">- {brl(v.desconto)}</td>
              </tr>
            )}
            {Number(v.descontoPontos) > 0 && (
              <tr>
                <td>Pontos ({v.pontosUsados})</td>
                <td className="num">- {brl(v.descontoPontos)}</td>
              </tr>
            )}
            <tr>
              <td>
                <b>TOTAL</b>
              </td>
              <td className="num">
                <b style={{ fontSize: '12pt' }}>{brl(v.total)}</b>
              </td>
            </tr>
            {v.pagamentos.map((p) => (
              <tr key={p.id}>
                <td>
                  {FORMA[p.forma] ?? p.forma}
                  {p.parcelas > 1 ? ` ${p.parcelas}×` : ''}
                  {p.vale ? ` ${p.vale.codigo}` : ''}
                </td>
                <td className="num">{brl(p.valor)}</td>
              </tr>
            ))}
            {devolvido > 0 && (
              <tr>
                <td>Devolvido depois</td>
                <td className="num">- {brl(devolvido)}</td>
              </tr>
            )}
            {v.pontosGanhos > 0 && (
              <tr>
                <td>Pontos ganhos</td>
                <td className="num">+{v.pontosGanhos}</td>
              </tr>
            )}
          </tbody>
        </table>

        {v.parcelas && v.parcelas.length > 0 && (
          <>
            <div className="linha" />
            <div>
              <b>Crediário</b>
            </div>
            <table>
              <tbody>
                {v.parcelas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      parcela {p.numero}/{p.de} · vence{' '}
                      {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(p.vencimento)}
                    </td>
                    <td className="num">{brl(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="linha" />
        <div style={{ textAlign: 'center', fontSize: '8pt', color: '#333' }}>
          {v.situacao === 'CANCELADA' ? (
            <div style={{ fontWeight: 700 }}>VENDA CANCELADA</div>
          ) : null}
          <div>Documento sem valor fiscal.</div>
          <div>Troca com este comprovante.</div>
          <div style={{ marginTop: 4 }}>Norte · sistema de gestão</div>
        </div>
      </div>
    </div>
  )
}
