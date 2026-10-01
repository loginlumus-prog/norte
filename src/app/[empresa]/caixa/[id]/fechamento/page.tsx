import type { Metadata } from 'next'
import { Fragment } from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { turnoParaImprimir } from '@/servidor/caixa'
import { Folha, brl, quando } from '../../../crediario/Papel'

export const metadata: Metadata = { title: 'Fechamento do caixa' }

// O fechamento do turno, em papel de 80 mm — o que vai no envelope com o
// dinheiro da gaveta.
//
// Só de turno FECHADO: o papel mostra o esperado, e o esperado do turno
// aberto é justamente o que a contagem às cegas esconde de quem vai contar.
//
// Tudo que entrou, por forma e maquininha — as vendas e o crediário recebido
// —, para conferir com o extrato de cada máquina; e a conta da gaveta, que é
// só o dinheiro.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Débito', CREDITO: 'Crédito',
  CREDIARIO: 'Crediário', VALE: 'Vale de troca', TRANSFERENCIA: 'Transferência',
}
const nome = (f: { forma: string; maquininha: string | null }) => `${FORMA[f.forma] ?? f.forma}${f.maquininha ? ` · ${f.maquininha}` : ''}`

export default async function FechamentoPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>
  searchParams: Promise<{ imprimir?: string }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug, id } = await params
  const { imprimir } = await searchParams
  const { sessao } = await exigirEntrada(slug, { capacidade: 'caixa.ver' })

  const t = await turnoParaImprimir(sessao, id)
  if (!t) notFound()
  const c = t.conferencia
  const dif = t.diferenca
  const linhasGaveta: [string, number][] = [
    ['Abertura (troco)', c.abertura],
    ['Vendas em dinheiro', c.dinheiroVendido],
    ...(c.dinheiroRecebido ? ([['Crediário em dinheiro', c.dinheiroRecebido]] as [string, number][]) : []),
    ...(c.dinheiroMensalidades ? ([['Mensalidades em dinheiro', c.dinheiroMensalidades]] as [string, number][]) : []),
    ['Suprimentos', c.suprimentos],
    ['Sangrias', -c.sangrias],
  ]

  return (
    <Folha nonce={nonce} voltar={{ href: `/${slug}/caixa?turno=${t.id}&unidade=${t.unidadeId}`, rotulo: 'turnos do caixa' }} imprimir={imprimir === '1'}>
      <div className="centro">
        <div style={{ fontWeight: 700, fontSize: '12pt' }}>{t.unidade}</div>
      </div>
      <div className="dupla" />
      <div className="titulo">FECHAMENTO DE CAIXA</div>

      <div className="linha" />
      <table>
        <tbody>
          <tr>
            <td>Abriu</td>
            <td className="num">{quando(t.abertoEm)}</td>
          </tr>
          <tr>
            <td></td>
            <td className="num">{t.abertoPor}</td>
          </tr>
          <tr>
            <td>Fechou</td>
            <td className="num">{t.fechadoEm ? quando(t.fechadoEm) : '—'}</td>
          </tr>
          <tr>
            <td></td>
            <td className="num">{t.fechadoPor ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      <div className="linha" />
      <div className="miudo" style={{ fontWeight: 700 }}>
        VENDAS · {c.vendas} · {brl(c.vendidoTotal)}
      </div>
      <table>
        <tbody>
          {c.porMaquininha.length === 0 && (
            <tr>
              <td>Nenhuma venda</td>
              <td className="num">—</td>
            </tr>
          )}
          {c.porMaquininha.map((f) => (
            <tr key={`${f.forma}${f.maquininha ?? ''}`}>
              <td>{nome(f)}</td>
              <td className="num">{brl(f.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {c.recebidoCrediario > 0 && (
        <>
          <div className="linha" />
          <div className="miudo" style={{ fontWeight: 700 }}>
            CREDIÁRIO RECEBIDO · {c.recibos} recibo{c.recibos === 1 ? '' : 's'} · {brl(c.recebidoCrediario)}
          </div>
          <table>
            <tbody>
              {c.recebidoPorForma.map((f) => (
                <tr key={`${f.forma}${f.maquininha ?? ''}`}>
                  <td>{nome(f)}</td>
                  <td className="num">{brl(f.total)}</td>
                </tr>
              ))}
              {c.atrasoRecebido > 0 && (
                <tr>
                  <td className="miudo">dos quais multa e juros</td>
                  <td className="num miudo">{brl(c.atrasoRecebido)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* Cada máquina com vendas e crediário juntos: é o total que o extrato
          dela mostra. Só quando há o que conferir fora da gaveta. */}
      {c.maquininhas.length > 0 && (
        <>
          <div className="linha" />
          <div className="miudo" style={{ fontWeight: 700 }}>
            CONFERIR EM CADA MAQUININHA
          </div>
          <table>
            <tbody>
              {c.maquininhas.map((g) => (
                <Fragment key={g.maquininha ?? '-'}>
                  <tr>
                    <td style={{ fontWeight: 700 }}>{g.maquininha ?? 'Sem maquininha marcada'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {brl(g.total)}
                    </td>
                  </tr>
                  {g.formas.map((f) => (
                    <tr key={f.forma}>
                      <td>
                        &nbsp;&nbsp;{FORMA[f.forma] ?? f.forma}
                        {f.crediario > 0 && (
                          <span className="miudo">
                            {' '}
                            ({f.vendas > 0 ? `vendas ${brl(f.vendas)} + ` : ''}crediário {brl(f.crediario)})
                          </span>
                        )}
                      </td>
                      <td className="num">{brl(f.total)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}

      {c.recebidoMensalidades > 0 && (
        <>
          <div className="linha" />
          <table>
            <tbody>
              <tr>
                <td>Mensalidades recebidas</td>
                <td className="num">{brl(c.recebidoMensalidades)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {t.movimentos.length > 0 && (
        <>
          <div className="linha" />
          <div className="miudo" style={{ fontWeight: 700 }}>
            SANGRIAS E SUPRIMENTOS
          </div>
          <table>
            <tbody>
              {t.movimentos.map((m, i) => (
                <tr key={i}>
                  <td>
                    {m.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'} · {m.motivo}
                    <br />
                    <span className="miudo">
                      {quando(m.criadoEm)} · {m.quem}
                    </span>
                  </td>
                  <td className="num">
                    {m.tipo === 'SANGRIA' ? '- ' : ''}
                    {brl(m.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="dupla" />
      <div className="miudo" style={{ fontWeight: 700 }}>
        A GAVETA (só dinheiro)
      </div>
      <table>
        <tbody>
          {linhasGaveta.map(([r, v]) => (
            <tr key={r}>
              <td>{r}</td>
              <td className="num">{v < 0 ? `- ${brl(-v)}` : brl(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="grande">
        <tbody>
          <tr>
            <td>Esperado</td>
            <td className="num">{brl(t.saldoEsperado)}</td>
          </tr>
          <tr>
            <td>Contado</td>
            <td className="num">{brl(t.saldoContado)}</td>
          </tr>
          <tr>
            <td>{Math.abs(dif) < 0.005 ? 'BATEU' : dif < 0 ? 'FALTOU' : 'SOBROU'}</td>
            <td className="num">{brl(Math.abs(dif))}</td>
          </tr>
        </tbody>
      </table>
      {t.observacoes && <div className="miudo">Obs.: {t.observacoes}</div>}

      <div className="assinatura">
        <div>{t.fechadoPor ?? 'quem fechou'}</div>
      </div>
      <div className="assinatura">
        <div>quem conferiu</div>
      </div>
    </Folha>
  )
}
