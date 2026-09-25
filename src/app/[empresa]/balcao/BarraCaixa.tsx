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
  meta = null,
  compacta = false,
}: {
  slug: string
  unidadeId: string
  caixa: { id: string; abertoEm: Date; abertoPor: string }
  conferencia: { vendas: number; vendidoTotal: number; esperado: number }
  podeOperar: boolean
  /** A meta do mês de quem está no caixa. Nula sem módulo de metas ou sem meta. */
  meta?: { valor: number; vendido: number } | null
  /**
   * O jeito do balcão simples: uma linha só, com os gestos do turno atrás do
   * botão "Caixa". A sorveteria olha a gaveta duas vezes por turno; a venda,
   * duzentas. A linha fina deixa a altura para os produtos.
   */
  compacta?: boolean
}) {
  const [painel, setPainel] = useState<'SANGRIA' | 'SUPRIMENTO' | null>(null)
  const [feito, setFeito] = useState<string | null>(null)
  const [gestos, setGestos] = useState(!compacta)

  const horas = (Date.now() - new Date(caixa.abertoEm).getTime()) / 36e5
  const dias = Math.floor(horas / 24)

  const botao =
    'rounded-norte border border-borda bg-superficie px-2.5 py-1.5 text-xs font-semibold text-tinta hover:bg-superficie-2'

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cx(
          'flex flex-wrap items-center gap-x-5 gap-y-2 rounded-norte border border-borda bg-superficie px-3 py-2',
          compacta && 'rounded-2xl',
        )}
      >
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold tracking-wide text-tinta-3 uppercase">
            caixa desde {hora(new Date(caixa.abertoEm))}
          </span>
          <span className="numero text-sm font-semibold text-tinta">
            {conferencia.vendas} venda{conferencia.vendas === 1 ? '' : 's'} · {brl(conferencia.vendidoTotal)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold tracking-wide text-tinta-3 uppercase">na gaveta</span>
          <span className="numero text-sm font-semibold text-tinta">{brl(conferencia.esperado)}</span>
        </div>
        <span className={cx('text-xs text-tinta-3', compacta && 'hidden sm:inline')}>{caixa.abertoPor}</span>
        {meta && (
          <div className={cx('flex-col', compacta ? 'hidden md:flex' : 'flex')} title="Sua meta do mês, líquida de devolução">
            <span className="text-[10px] font-semibold tracking-wide text-tinta-3 uppercase">sua meta do mês</span>
            <span className="numero text-sm font-semibold text-tinta">
              {brl(meta.vendido)} <span className="text-tinta-3">de {brl(meta.valor)}</span>{' '}
              {meta.vendido >= meta.valor ? (
                <span className="text-bom">· bateu</span>
              ) : (
                <span className="text-tinta-2">· faltam {brl(meta.valor - meta.vendido)}</span>
              )}
            </span>
          </div>
        )}
        {dias >= 1 && (
          <Situacao nivel="atencao">
            aberto há {dias} dia{dias === 1 ? '' : 's'}
          </Situacao>
        )}

        {podeOperar && compacta && (
          <button
            type="button"
            onClick={() => {
              setGestos((g) => !g)
              setPainel(null)
            }}
            aria-expanded={gestos}
            className={cx(botao, 'ml-auto inline-flex min-h-10 items-center gap-1.5 px-3 text-sm', gestos && 'bg-superficie-2')}
          >
            Caixa
            <svg aria-hidden viewBox="0 0 12 12" className={cx('size-3 transition-transform', gestos && 'rotate-180')} fill="none">
              <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {podeOperar && gestos && (
          <div className={cx('flex flex-wrap items-center gap-1.5', compacta ? 'w-full justify-end' : 'ml-auto')}>
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
