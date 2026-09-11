'use client'

// A barra do caixa, em cima do balcão.
//
// É a fileira que o sistema de referência tem e o nosso não tinha: de que
// horas o caixa está aberto, quantas vendas e quanto já passou, quanto deve
// ter na gaveta AGORA — e os quatro gestos do turno (sangria, suprimento,
// troca, fechar) a um toque, em vez de escondidos numa outra tela.
//
// "Na gaveta" é o número que a pessoa mais olha durante o dia: é o que
// decide se já está na hora de fazer uma sangria antes de acumular dinheiro
// demais no balcão.

import Link from 'next/link'
import { useState } from 'react'
import { Situacao, cx } from '@/ui/base'
import { Movimento } from './Caixa'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d)

export function BarraCaixa({
  slug,
  unidadeId,
  caixa,
  conferencia,
  podeOperar,
}: {
  slug: string
  unidadeId: string
  caixa: { id: string; abertoEm: Date; abertoPor: string }
  conferencia: { vendas: number; vendidoTotal: number; esperado: number }
  podeOperar: boolean
}) {
  const [painel, setPainel] = useState<'SANGRIA' | 'SUPRIMENTO' | null>(null)
  const [feito, setFeito] = useState<string | null>(null)

  const horas = (Date.now() - new Date(caixa.abertoEm).getTime()) / 36e5
  const dias = Math.floor(horas / 24)

  const botao =
    'rounded-norte border border-borda bg-superficie px-2.5 py-1.5 text-xs font-semibold text-tinta hover:bg-superficie-2'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-norte border border-borda bg-superficie px-3 py-2">
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold tracking-wide text-tinta-3 uppercase">
            caixa desde {hora(new Date(caixa.abertoEm))}
          </span>
          <span className="numero self-start text-sm font-semibold text-tinta">
            {conferencia.vendas} venda{conferencia.vendas === 1 ? '' : 's'} · {brl(conferencia.vendidoTotal)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold tracking-wide text-tinta-3 uppercase">na gaveta</span>
          <span className="numero self-start text-sm font-semibold text-tinta">{brl(conferencia.esperado)}</span>
        </div>
        <span className="text-xs text-tinta-3">{caixa.abertoPor}</span>
        {dias >= 1 && (
          <Situacao nivel="atencao">
            aberto há {dias} dia{dias === 1 ? '' : 's'}
          </Situacao>
        )}

        {podeOperar && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPainel((p) => (p === 'SANGRIA' ? null : 'SANGRIA'))}
              aria-pressed={painel === 'SANGRIA'}
              className={cx(botao, painel === 'SANGRIA' && 'bg-superficie-2')}
            >
              ↓ Sangria
            </button>
            <button
              type="button"
              onClick={() => setPainel((p) => (p === 'SUPRIMENTO' ? null : 'SUPRIMENTO'))}
              aria-pressed={painel === 'SUPRIMENTO'}
              className={cx(botao, painel === 'SUPRIMENTO' && 'bg-superficie-2')}
            >
              ↑ Suprimento
            </button>
            {/* Troca começa achando a compra, não numa tela em branco: é da
                venda que sai o que a pessoa pagou e o que pode levar no lugar. */}
            <Link href={`/${slug}/vendas?unidade=${unidadeId}`} className={botao}>
              ⇄ Troca
            </Link>
            <Link
              href={`/${slug}/balcao?caixa=fechar&unidade=${unidadeId}`}
              className="rounded-norte border border-critico-borda bg-critico-fundo px-2.5 py-1.5 text-xs font-semibold text-critico hover:brightness-95"
            >
              Fechar caixa
            </Link>
          </div>
        )}
      </div>

      {feito && !painel && (
        <p className="text-xs font-medium text-bom">{feito}</p>
      )}

      {painel && (
        <Movimento
          slug={slug}
          caixaId={caixa.id}
          tipoInicial={painel}
          aoRegistrar={(tipo, valor) => {
            setFeito(
              tipo === 'SANGRIA'
                ? `Sangria de ${brl(valor)} registrada.`
                : `Suprimento de ${brl(valor)} registrado.`,
            )
            setPainel(null)
          }}
        />
      )}
    </div>
  )
}
