// A folha dos papéis do crediário e do caixa: carnê, recibo, fechamento.
//
// O mesmo desenho do comprovante da venda (vendas/[id]/comprovante): 80 mm de
// bobina térmica, letra monoespaçada, linha tracejada entre os blocos — e A4
// onde faz sentido (o carnê, que a cliente leva para casa e assina).
//
// A térmica come traço fino: tudo que importa (o valor, a linha de assinatura)
// sai em negrito ou com traço de 1px cheio.
//
// Sem a moldura do sistema: o menu não se imprime.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Imprimir } from '../../../ui/Imprimir'
import type { Credor } from '../../../servidor/recibos'

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
export const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
export const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)

export function Folha({
  nonce,
  voltar,
  imprimir,
  a4 = false,
  formatos,
  aviso,
  children,
}: {
  nonce?: string
  voltar: { href: string; rotulo: string }
  imprimir: boolean
  a4?: boolean
  /** Os dois tamanhos do papel, quando o documento tem os dois. */
  formatos?: { termica: string; a4: string }
  /** O que falta preencher — aparece na tela, nunca no papel. */
  aviso?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={a4 ? 'mx-auto max-w-[190mm] p-3 print:p-0' : 'mx-auto max-w-[80mm] p-3 print:p-0'}>
      {/* Com o bilhete (nonce) desta requisição: em produção a CSP só deixa
          entrar <style> que tenha o bilhete (ver src/proxy.ts). */}
      <style nonce={nonce}>{`
        @page { size: ${a4 ? 'A4' : '80mm auto'}; margin: ${a4 ? '12mm' : '4mm'}; }
        @media print { .nao-imprime { display: none !important; } body { background: #fff !important; } }
        .cupom { color: #000; background: #fff; font: ${a4 ? '10.5pt/1.45' : '9.5pt/1.35'} ui-monospace, 'Cascadia Mono', Consolas, monospace; }
        .cupom .linha { border-top: 1px dashed #000; margin: 6px 0; }
        .cupom .dupla { border-top: 3px double #000; margin: 8px 0; }
        .cupom table { width: 100%; border-collapse: collapse; }
        .cupom td { vertical-align: top; padding: 1px 0; }
        .cupom .num { text-align: right; white-space: nowrap; }
        .cupom .centro { text-align: center; }
        .cupom .titulo { text-align: center; font-weight: 700; font-size: ${a4 ? '13pt' : '11pt'}; letter-spacing: .04em; }
        .cupom .grande td { font-size: ${a4 ? '12pt' : '11pt'}; font-weight: 700; padding: 2px 0; }
        .cupom .miudo { font-size: ${a4 ? '8.5pt' : '7.5pt'}; }
        .cupom .falta { border: 1px solid #000; padding: 4px; font-weight: 700; }
        .cupom .assinatura { border-top: 1px solid #000; margin-top: ${a4 ? '18mm' : '12mm'}; padding-top: 2px; text-align: center; }
      `}</style>

      <div className="nao-imprime mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link href={voltar.href} className="text-sm text-tinta-2 hover:text-tinta">
          ← {voltar.rotulo}
        </Link>
        <div className="flex items-center gap-2">
          {formatos && (
            <span className="flex rounded-norte border border-borda text-xs">
              <Link href={formatos.termica} className={a4 ? 'px-2 py-1 text-tinta-2' : 'bg-marca px-2 py-1 font-semibold text-marca-tinta'}>
                80 mm
              </Link>
              <Link href={formatos.a4} className={a4 ? 'bg-marca px-2 py-1 font-semibold text-marca-tinta' : 'px-2 py-1 text-tinta-2'}>
                A4
              </Link>
            </span>
          )}
          <Imprimir automatico={imprimir} rotulo="Imprimir" />
        </div>
      </div>
      {aviso && <div className="nao-imprime mb-3">{aviso}</div>}

      <div className="cupom rounded-norte border border-borda p-3 print:rounded-none print:border-0 print:p-0">{children}</div>
    </div>
  )
}

/**
 * O cabeçalho com o credor: quem é a loja, para quem deve. O que faltar sai
 * como uma linha em branco para preencher à mão — o papel continua valendo, e
 * a tela pede o cadastro (o `aviso` da Folha).
 */
export function Credor({ c }: { c: Credor }) {
  const linha = (rotulo: string, v: string | null) => (v ? <div>{`${rotulo}${v}`}</div> : <div>{rotulo}______________________</div>)
  return (
    <div className="centro">
      <div style={{ fontWeight: 700, fontSize: '12pt' }}>{c.nome}</div>
      {c.razaoSocial ? c.razaoSocial !== c.nome && <div>{c.razaoSocial}</div> : linha('Razão social: ', null)}
      {linha('CNPJ ', c.cnpj)}
      {c.ie && <div>IE {c.ie}</div>}
      {linha('', c.endereco)}
      {linha('Tel. ', c.telefone)}
    </div>
  )
}

/** O aviso da tela quando a loja não tem os dados de credor. */
export function FaltaCredor({ c, slug }: { c: Credor; slug: string }) {
  if (c.faltando.length === 0) return null
  return (
    <div className="rounded-norte border border-atencao-borda bg-atencao-fundo p-3 text-sm text-atencao">
      Falta {c.faltando.join(', ')} desta loja. O papel sai com a linha em branco para preencher à mão —{' '}
      <Link href={`/${slug}/lojas`} className="font-semibold underline underline-offset-2">
        preencha em Lojas
      </Link>{' '}
      e ele passa a sair completo.
    </div>
  )
}
