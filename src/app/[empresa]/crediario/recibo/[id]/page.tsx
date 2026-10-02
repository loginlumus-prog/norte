import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharRecibo } from '@/servidor/recibos'
import { pode } from '@/servidor/permissao'
import { Folha, Credor, FaltaCredor, brl, dia, diaCurto, quando } from '../../Papel'
import { Estornar } from './Estornar'

export const metadata: Metadata = { title: 'Recibo do crediário' }

// O recibo do que a cliente pagou de crediário, em papel de 80 mm.
//
// É a prova DELA: o que pagou, de quais parcelas, quanto disso foi atraso, e o
// que ainda deve. O saldo é o do momento do recibo (fotografado), e "as que
// faltam" são as de hoje — reimpresso amanhã, o papel mostra o que faltava
// pagar quando foi impresso, com a data da impressão.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito',
  TRANSFERENCIA: 'Transferência',
}

export default async function ReciboPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>
  searchParams: Promise<{ imprimir?: string }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug, id } = await params
  const { imprimir } = await searchParams
  const { sessao } = await exigirEntrada(slug, { capacidade: 'crediario.ver' })

  const r = await acharRecibo(sessao, id)
  if (!r) notFound()

  const somaFace = r.parcelas.reduce((s, p) => s + p.abatido, 0)

  return (
    <Folha
      nonce={nonce}
      voltar={{ href: `/${slug}/crediario?cliente=${r.cliente.id}`, rotulo: 'crediário da cliente' }}
      imprimir={imprimir === '1'}
      aviso={
        <div className="flex flex-col gap-2">
          <FaltaCredor c={r.credor} slug={slug} />
          {/* O estorno do recibo lançado errado: só na tela, só para quem pode cancelar venda na loja dele. */}
          {pode(sessao, 'venda.cancelar', r.unidadeId) && (
            <Estornar slug={slug} reciboId={r.id} clienteId={r.cliente.id} codigo={r.codigo} />
          )}
        </div>
      }
    >
      <Credor c={r.credor} />

      <div className="dupla" />
      <div className="titulo">{r.externo ? 'BAIXA DE PAGAMENTO FEITO FORA' : 'RECIBO DE PAGAMENTO'}</div>
      <div className="centro">crediário · {r.codigo}</div>

      <div className="linha" />
      <table>
        <tbody>
          <tr>
            <td>{r.externo ? 'Pago em' : 'Data'}</td>
            <td className="num">{r.externo && r.pagoEm ? dia(r.pagoEm) : quando(r.criadoEm)}</td>
          </tr>
          <tr>
            <td>Cliente</td>
            <td className="num">{r.cliente.nome}</td>
          </tr>
          {/* O CPF sai sempre, mesmo vazio: há clientes com o mesmo nome, e o
              papel precisa dizer de quem é o pagamento. */}
          <tr>
            <td>CPF</td>
            <td className="num">{r.cliente.cpf ?? '—'}</td>
          </tr>
          <tr>
            <td>Recebido por</td>
            <td className="num">{r.quem}</td>
          </tr>
          {r.externo && r.referencia && (
            <tr>
              <td>Referência</td>
              <td className="num">{r.referencia}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="linha" />
      <table>
        <tbody>
          <tr>
            <td>Devia antes</td>
            <td className="num">{brl(r.saldoAntes)}</td>
          </tr>
        </tbody>
      </table>
      <div className="miudo" style={{ fontWeight: 700, marginTop: 4 }}>
        PARCELAS PAGAS
      </div>
      <table>
        <tbody>
          {r.parcelas.map((p) => (
            <tr key={p.id}>
              <td>
                Compra {p.vendaNumero} · parc. {p.numero}/{p.de}
                <br />
                <span className="miudo">
                  venc. {diaCurto(p.vencimento)} · {p.emAtraso ? 'em atraso' : 'em dia'}
                  {p.quitou ? ' · quitada' : ' · parcial'}
                </span>
              </td>
              <td className="num">{brl(p.abatido)}</td>
            </tr>
          ))}
          <tr>
            <td>Abatido da dívida</td>
            <td className="num">{brl(somaFace)}</td>
          </tr>
        </tbody>
      </table>

      <div className="linha" />
      <table>
        <tbody>
          {/* Multa e juro saem sempre, com "—" quando não houve: são campos do
              recibo, e ela tem de enxergar por que pagou mais que a parcela. */}
          <tr>
            <td>Multa</td>
            <td className="num">{r.multa > 0 ? brl(r.multa) : '—'}</td>
          </tr>
          <tr>
            <td>Juros</td>
            <td className="num">{r.juros > 0 ? brl(r.juros) : '—'}</td>
          </tr>
          {r.perdoado > 0 && (
            <tr>
              <td>Atraso perdoado</td>
              <td className="num">- {brl(r.perdoado)}</td>
            </tr>
          )}
          {r.desconto > 0 && (
            <tr>
              <td>Desconto</td>
              <td className="num">- {brl(r.desconto)}</td>
            </tr>
          )}
          {r.autorizadoPor && (
            <tr>
              <td colSpan={2} className="miudo">
                Autorizado por {r.autorizadoPor}
                {r.motivo ? `: ${r.motivo}` : ''}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <table className="grande">
        <tbody>
          <tr>
            <td>{r.externo ? 'PAGO FORA' : 'VALOR PAGO'}</td>
            <td className="num">{brl(r.valor)}</td>
          </tr>
        </tbody>
      </table>
      {!r.externo && (
        <table>
          <tbody>
            {r.formas.map((f) => (
              <tr key={`${f.forma}${f.maquininha ?? ''}`}>
                <td>
                  {FORMA[f.forma] ?? f.forma}
                  {f.maquininha ? ` · ${f.maquininha}` : ''}
                </td>
                <td className="num">{brl(f.valor)}</td>
              </tr>
            ))}
            {r.troco > 0 && (
              <tr>
                <td>Troco</td>
                <td className="num">{brl(r.troco)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div className="dupla" />
      {r.saldoDepois > 0 ? (
        <>
          <table className="grande">
            <tbody>
              <tr>
                <td>AINDA DEVE</td>
                <td className="num">{brl(r.saldoDepois)}</td>
              </tr>
            </tbody>
          </table>
          {r.faltam.length > 0 && (
            <>
              <div className="miudo" style={{ fontWeight: 700, marginTop: 4 }}>
                PARCELAS QUE FALTAM (em {quando(new Date())})
              </div>
              <table>
                <tbody>
                  {r.faltam.map((f) => (
                    <tr key={`${f.vendaNumero}-${f.numero}-${f.vencimento}`}>
                      <td>
                        {diaCurto(f.vencimento)} · compra {f.vendaNumero} · {f.numero}/{f.de}
                      </td>
                      <td className="num">{brl(f.resta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      ) : (
        <div className="titulo">CREDIÁRIO QUITADO NESTA LOJA</div>
      )}

      <div className="linha" />
      <div className="centro miudo">
        <div>Guarde este recibo.</div>
        <div>Documento sem valor fiscal.</div>
      </div>
    </Folha>
  )
}
