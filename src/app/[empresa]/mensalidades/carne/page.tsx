import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { comoOrg } from '@/servidor/banco'
import { moduloLigado } from '@/servidor/modulos'
import { colunaDoDia, mostrarDiaDaColuna } from '@/servidor/dia'
import { carneDoAluno, mesPorExtenso } from '@/servidor/mensalidades'
import { Imprimir } from '@/ui/Imprimir'

export const metadata: Metadata = { title: 'Carnê' }

// O carnê do aluno: as mensalidades dos próximos doze meses, uma por linha,
// para o responsável pendurar na geladeira.
//
// As que já nasceram vêm com a situação (paga, a receber); as seguintes são
// PREVISÃO — a mesma conta da geração, sobre a matrícula de hoje — e o papel
// diz isso: valor de mês futuro muda se a matrícula mudar. Não é boleto:
// ninguém paga "pelo carnê"; ele diz quanto e quando.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function Carne({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ aluno?: string; imprimir?: string }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug } = await params
  const { aluno: alunoId, imprimir } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'mensalidade.ver' })
  if (!moduloLigado(empresa, 'escola')) semAcesso(slug, 'modulo-escola')
  if (!alunoId) semAcesso(slug, 'sem-aluno')
  if (!/^[\w-]{1,64}$/.test(alunoId)) notFound()

  const c = await carneDoAluno(sessao, alunoId, 12)
  if (!c) notFound()
  const org = await comoOrg(sessao.orgId, (db) => db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { nome: true, razaoSocial: true } }))

  return (
    <div className="mx-auto max-w-[170mm] p-4 print:p-0">
      <style nonce={nonce}>{`
        @page { size: A4; margin: 15mm; }
        @media print { .nao-imprime { display: none !important; } body { background: #fff !important; } }
        .carne { color: #000; background: #fff; font: 10.5pt/1.45 system-ui, sans-serif; }
        .carne table { width: 100%; border-collapse: collapse; }
        .carne th, .carne td { text-align: left; padding: 5px 6px; border-bottom: 1px dashed #999; }
        .carne .num { text-align: right; white-space: nowrap; }
      `}</style>

      <div className="nao-imprime mb-3 flex items-center justify-between gap-2">
        <Link href={`/${slug}/clientes/${alunoId}`} className="text-sm text-tinta-2 hover:text-tinta">
          ← ficha
        </Link>
        <Imprimir automatico={imprimir === '1'} rotulo="Imprimir carnê" />
      </div>

      <div className="carne rounded-norte border border-borda p-6 print:rounded-none print:border-0 print:p-0">
        <div style={{ fontWeight: 700, fontSize: '14pt' }}>{org.razaoSocial ?? empresa.nome}</div>
        <h1 style={{ fontSize: '15pt', fontWeight: 700, margin: '12px 0 2px' }}>Carnê de mensalidades</h1>
        <p>
          <b>{c.aluno.nome}</b>
          {c.aluno.responsavel ? ` · responsável: ${c.aluno.responsavel.nome}` : ''}
        </p>

        {c.linhas.length === 0 ? (
          <p style={{ marginTop: 16 }}>Nenhuma matrícula ativa: não há mensalidade para mostrar.</p>
        ) : (
          <table style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Turma</th>
                <th>Vence</th>
                <th className="num">Valor</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {c.linhas.map((l) => (
                <tr key={`${l.mes}-${l.turma}`}>
                  <td>{mesPorExtenso(l.mes)}</td>
                  <td>{l.turma}</td>
                  <td>{mostrarDiaDaColuna(colunaDoDia(l.vencimento), 'curto')}</td>
                  <td className="num">
                    {brl(l.devido)}
                    {l.desconto > 0 ? <span style={{ color: '#555' }}> (de {brl(l.valor)})</span> : null}
                  </td>
                  <td>{l.situacao === 'prevista' ? 'previsão' : l.situacao === 'paga' ? 'paga' : l.situacao === 'atrasada' ? 'em atraso' : 'a pagar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ marginTop: 16, fontSize: '8.5pt', color: '#444' }}>
          “Previsão” é a mensalidade de um mês que ainda não chegou, pela matrícula de hoje: se a matrícula mudar, o valor muda. Este carnê
          não é boleto nem nota fiscal.
        </p>
      </div>
    </div>
  )
}
