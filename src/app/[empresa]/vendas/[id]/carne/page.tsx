import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { carneDaVenda } from '@/servidor/recibos'
import { Folha, Credor, FaltaCredor, brl, dia, quando } from '../../../crediario/Papel'

export const metadata: Metadata = { title: 'Carnê' }

// O carnê da compra no crediário: o papel que a cliente ASSINA e leva.
//
// Não é o cupom da venda com as parcelas grudadas no fim: são documentos com
// trabalhos diferentes. O cupom é a via da compra (troca, garantia); o carnê é
// a dívida — quem deve, a quem, quanto e quando, com a confissão de dívida e a
// linha de assinatura. Por isso ele traz o CNPJ e o endereço da LOJA (o
// credor) e o CPF de quem compra: nome sozinho não identifica, há clientes
// com o mesmo nome.
//
// Reimpresso depois, mostra as parcelas como estão hoje: a paga sai marcada.

export default async function CarnePagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>
  searchParams: Promise<{ imprimir?: string; formato?: string }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug, id } = await params
  const { imprimir, formato } = await searchParams
  const { sessao } = await exigirEntrada(slug, { capacidade: 'venda.ver' })

  const c = await carneDaVenda(sessao, id)
  if (!c) {
    // Venda que existe, mas sem carnê (paga à vista, sem cliente): a tela diz
    // isso, em vez de "o link está errado".
    const v = /^[\w-]{1,64}$/.test(id)
      ? await comoOrg(sessao.orgId, (db) => db.venda.findUnique({ where: { id }, select: { unidadeId: true } }))
      : null
    if (v && pode(sessao, 'venda.ver', v.unidadeId)) semAcesso(slug, 'sem-carne', `/${slug}/vendas/${id}`)
    notFound()
  }

  const a4 = formato === 'a4'
  const base = `/${slug}/vendas/${id}/carne`
  const abertas = c.parcelas.filter((p) => !p.quitada)
  const somaCarne = c.parcelas.reduce((s, p) => s + p.valor, 0)
  const restaCarne = abertas.reduce((s, p) => s + p.resta, 0)
  const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  const credorNome = c.credor.razaoSocial ?? c.credor.nome

  return (
    <Folha
      nonce={nonce}
      voltar={{ href: `/${slug}/vendas/${id}`, rotulo: 'ficha da venda' }}
      imprimir={imprimir === '1'}
      a4={a4}
      formatos={{ termica: base, a4: `${base}?formato=a4` }}
      aviso={
        <>
          <FaltaCredor c={c.credor} slug={slug} />
          {!c.cliente.cpf && (
            <div className="mt-2 rounded-norte border border-atencao-borda bg-atencao-fundo p-3 text-sm text-atencao">
              A cliente está sem CPF no cadastro. O carnê sai com a linha em branco — o CPF é o que identifica quem
              assinou. Dá para completar na ficha dela.
            </div>
          )}
        </>
      }
    >
      <Credor c={c.credor} />

      <div className="dupla" />
      <div className="titulo">CARNÊ DO CREDIÁRIO</div>
      <div className="centro">compra parcelada na loja</div>
      {c.situacao === 'CANCELADA' && <div className="titulo">COMPRA CANCELADA</div>}

      <div className="linha" />
      <table>
        <tbody>
          <tr>
            <td>Data</td>
            <td className="num">{quando(c.criadaEm)}</td>
          </tr>
          <tr>
            <td>Compra</td>
            <td className="num">
              <b>nº {c.vendaNumero}</b>
            </td>
          </tr>
          <tr>
            <td>Cliente</td>
            <td className="num">{c.cliente.nome}</td>
          </tr>
          <tr>
            <td>CPF</td>
            <td className="num">{c.cliente.cpf ?? '___.___.___-__'}</td>
          </tr>
          {c.vendedor && (
            <tr>
              <td>Atendimento</td>
              <td className="num">{c.vendedor}</td>
            </tr>
          )}
        </tbody>
      </table>

      {c.itens.length > 0 && (
        <>
          <div className="linha" />
          <div className="miudo" style={{ fontWeight: 700 }}>
            O QUE FOI COMPRADO
          </div>
          <table>
            <tbody>
              {c.itens.map((i, n) => (
                <tr key={n}>
                  <td>
                    {i.descricao}
                    {i.codigo ? <span className="miudo"> · cód {i.codigo}</span> : null}
                    {i.quantidade !== 1 && <span className="miudo"> · {i.quantidade.toLocaleString('pt-BR')} un</span>}
                  </td>
                  <td className="num">{brl(i.total)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total da compra</b>
                </td>
                <td className="num">
                  <b>{brl(c.total)}</b>
                </td>
              </tr>
              {c.pagoAgora > 0.005 && (
                <tr>
                  <td>Pago na hora</td>
                  <td className="num">{brl(c.pagoAgora)}</td>
                </tr>
              )}
              <tr>
                <td>Financiado</td>
                <td className="num">{brl(c.financiado)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <div className="linha" />
      <div className="miudo" style={{ fontWeight: 700 }}>
        SUAS PARCELAS
      </div>
      <table className="grande">
        <tbody>
          {c.parcelas.map((p) => (
            <tr key={p.numero}>
              <td>
                {p.numero}/{p.de} · {dia(p.vencimento)}
              </td>
              <td className="num">{p.quitada ? 'PAGA' : brl(p.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <tbody>
          <tr>
            <td>Total do carnê ({c.parcelas.length}×)</td>
            <td className="num">{brl(somaCarne)}</td>
          </tr>
          {restaCarne > 0.005 && restaCarne < somaCarne - 0.005 && (
            <tr>
              <td>Falta pagar deste carnê</td>
              <td className="num">{brl(restaCarne)}</td>
            </tr>
          )}
          {c.saldoNaLoja > restaCarne + 0.005 && (
            <tr>
              <td>Saldo total na loja (todas as compras)</td>
              <td className="num">{brl(c.saldoNaLoja)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="linha" />
      <div className="miudo" style={{ fontWeight: 700 }}>
        COMO PAGAR
      </div>
      <div className="miudo">
        Na loja, até o dia do vencimento, com este carnê. Pague antes, se quiser: parcela adiantada não paga nada a mais.
        {(c.regra.multaPct > 0 || c.regra.jurosMes > 0) && (
          <>
            {' '}
            Depois do vencimento
            {c.regra.carenciaDias > 0 ? ` (e de ${c.regra.carenciaDias} dia${c.regra.carenciaDias === 1 ? '' : 's'} de tolerância)` : ''}:
            {c.regra.multaPct > 0 && ` multa de ${pct(c.regra.multaPct)}, uma vez`}
            {c.regra.multaPct > 0 && c.regra.jurosMes > 0 && ', e'}
            {c.regra.jurosMes > 0 && ` juro de ${pct(c.regra.jurosMes)} ao mês, proporcional aos dias`}.
          </>
        )}
      </div>

      <div className="linha" />
      <div className="miudo">
        Reconheço a dívida acima com {credorNome}, que pagarei nas datas indicadas. Em caso de atraso, concordo com a multa
        e o juro descritos, e com a inclusão do meu nome nos serviços de proteção ao crédito depois do aviso.
      </div>
      <div className="assinatura">
        <div>
          <b>{c.cliente.nome}</b>
        </div>
        <div>CPF: {c.cliente.cpf ?? '___.___.___-__'}</div>
      </div>

      <div className="linha" />
      <div className="centro miudo">
        <div>Documento sem valor fiscal.</div>
        <div>A nota fiscal é emitida à parte.</div>
      </div>
    </Folha>
  )
}
