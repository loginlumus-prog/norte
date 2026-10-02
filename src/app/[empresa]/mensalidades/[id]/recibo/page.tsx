import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { comoOrg } from '@/servidor/banco'
import { moduloLigado } from '@/servidor/modulos'
import { colunaDoDia, diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { acharMensalidade, mesPorExtenso, ROTULO_SITUACAO } from '@/servidor/mensalidades'
import { Imprimir } from '@/ui/Imprimir'

export const metadata: Metadata = { title: 'Recibo da mensalidade' }

// O recibo da mensalidade, para imprimir (ou salvar em PDF).
//
// Não é nota fiscal e diz isso. É o papel que o responsável guarda — e o que
// ele leva ao imposto de renda, por isso sai com o CPF dele quando a escola
// anotou. Um recibo por mensalidade, com CADA pagamento dela (a parcial de
// ontem e o resto de hoje), para a conta fechar no papel.
//
// Sem a moldura do sistema: o menu não se imprime.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito', TRANSFERENCIA: 'Transferência',
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
const documento = (d: string | null | undefined) => {
  if (!d) return null
  const s = d.replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
  return d
}

export default async function Recibo({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>
  searchParams: Promise<{ imprimir?: string }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug, id } = await params
  const { imprimir } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'mensalidade.ver' })
  if (!moduloLigado(empresa, 'escola')) semAcesso(slug, 'modulo-escola')

  const m = await acharMensalidade(sessao, id)
  if (!m) notFound()
  const org = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { nome: true, razaoSocial: true, documento: true, telefone: true, whatsapp: true } }),
  )

  const recebido = m.pagamentos.reduce((s, p) => s + p.valor, 0)
  const endereco = [
    [m.loja.endereco, m.loja.numero].filter(Boolean).join(', '),
    m.loja.bairro,
    [m.loja.cidade, m.loja.estado].filter(Boolean).join(' - '),
  ]
    .filter(Boolean)
    .join(' · ')
  const doc = documento(m.loja.documento ?? org.documento)

  return (
    <div className="mx-auto max-w-[170mm] p-4 print:p-0">
      <style nonce={nonce}>{`
        @page { size: A4; margin: 15mm; }
        @media print { .nao-imprime { display: none !important; } body { background: #fff !important; } }
        .recibo { color: #000; background: #fff; font: 10.5pt/1.45 system-ui, sans-serif; }
        .recibo table { width: 100%; border-collapse: collapse; }
        .recibo th, .recibo td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ccc; }
        .recibo .num { text-align: right; white-space: nowrap; }
      `}</style>

      <div className="nao-imprime mb-3 flex items-center justify-between gap-2">
        <Link href={`/${slug}/mensalidades`} className="text-sm text-tinta-2 hover:text-tinta">
          ← mensalidades
        </Link>
        <Imprimir automatico={imprimir === '1'} rotulo="Imprimir recibo" />
      </div>

      <div className="recibo rounded-norte border border-borda p-6 print:rounded-none print:border-0 print:p-0">
        <div className="flex flex-col gap-0.5">
          <div style={{ fontWeight: 700, fontSize: '14pt' }}>{org.razaoSocial ?? empresa.nome}</div>
          {doc && <div>CNPJ/CPF {doc}</div>}
          {endereco && <div>{endereco}</div>}
          {(m.loja.telefone ?? org.whatsapp ?? org.telefone) && <div>Tel. {m.loja.telefone ?? org.whatsapp ?? org.telefone}</div>}
        </div>

        <h1 style={{ fontSize: '16pt', fontWeight: 700, margin: '18px 0 8px' }}>RECIBO · {brl(recebido)}</h1>
        <p>
          Recebemos de <b>{m.responsavel ?? m.aluno}</b>
          {m.responsavelDoc ? `, CPF ${documento(m.responsavelDoc)},` : ''} a importância de <b>{brl(recebido)}</b>, referente à mensalidade de{' '}
          <b>{mesPorExtenso(m.mes)}</b> de <b>{m.aluno}</b>
          {m.parentesco && m.responsavel ? ` (${m.parentesco})` : ''}, turma {m.turma}
          {m.curso ? ` (${m.curso})` : ''}, com vencimento em {mostrarDiaDaColuna(m.vencimento, 'longo')}.
        </p>

        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Forma</th>
              <th className="num">Mensalidade</th>
              <th className="num">Juro e multa</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {m.pagamentos.map((p) => (
              <tr key={p.id}>
                <td>{quando(p.criadoEm)}</td>
                <td>{FORMA[p.forma] ?? p.forma}</td>
                <td className="num">{brl(p.valor - p.juros - p.multa)}</td>
                <td className="num">{p.juros + p.multa > 0 ? brl(p.juros + p.multa) : '—'}</td>
                <td className="num">{brl(p.valor)}</td>
              </tr>
            ))}
            {m.pagamentos.length === 0 && (
              <tr>
                <td colSpan={5}>Nenhum pagamento registrado nesta mensalidade.</td>
              </tr>
            )}
          </tbody>
        </table>

        <table style={{ marginTop: 14 }}>
          <tbody>
            <tr>
              <td>Mensalidade</td>
              <td className="num">{brl(m.valor)}</td>
            </tr>
            {m.desconto > 0 && (
              <tr>
                <td>Bolsa / desconto</td>
                <td className="num">− {brl(m.desconto)}</td>
              </tr>
            )}
            {m.abono > 0 && (
              <tr>
                <td>Desconto de pontualidade</td>
                <td className="num">− {brl(m.abono)}</td>
              </tr>
            )}
            <tr>
              <td>
                <b>Situação</b>
              </td>
              <td className="num">
                <b>{m.situacao === 'paga' ? 'paga' : m.situacao === 'cancelada' ? 'dispensada' : `${ROTULO_SITUACAO[m.situacao]} · falta ${brl(m.resta)}`}</b>
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ marginTop: 28 }}>
          {m.loja.cidade ? `${m.loja.cidade}, ` : ''}
          {mostrarDiaDaColuna(colunaDoDia(diaEmSP()), 'longo')}
        </p>
        <p style={{ marginTop: 40, borderTop: '1px solid #000', width: '60%', paddingTop: 4 }}>{org.razaoSocial ?? empresa.nome}</p>
        <p style={{ marginTop: 18, fontSize: '8.5pt', color: '#444' }}>Este recibo não é nota fiscal.</p>
      </div>
    </div>
  )
}
