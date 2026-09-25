'use client'

// As peças que as telas do sistema por dentro repetem: o gráfico que responde
// ao mouse e ao teclado, o seletor de fichas e o cabeçalho de cada tela.

import { useId, useState, type ReactNode } from 'react'
import { cx } from '../../base'

/* ═══════════════════════════════════════════════════════════
   O gráfico
   ═══════════════════════════════════════════════════════════
   Barras ou linha, com a série do período anterior em cinza atrás. Passar o
   mouse — ou focar e andar com as setas — mostra a dica daquele ponto. A
   dica também vai para uma região viva, então o leitor de tela ouve o que o
   olho vê. */

export type Ponto = {
  rotulo: string
  valor: number | null
  anterior?: number
  /** Linha de baixo da dica: "12 vendas". */
  detalhe?: string
}

export function Grafico({
  pontos,
  tipo = 'barras',
  formatar,
  descricao,
  eixo,
  altura = 'h-36',
  nomeAnterior = 'período anterior',
}: {
  pontos: Ponto[]
  tipo?: 'barras' | 'linha'
  formatar: (v: number) => string
  /** O que o gráfico mostra, para quem não vê. */
  descricao: string
  /** Os rótulos de baixo: índice → texto, ou nada. */
  eixo: (i: number) => string | null
  altura?: string
  nomeAnterior?: string
}) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const id = useId().replace(/:/g, '')
  const n = pontos.length
  const teto = Math.max(1, ...pontos.map((p) => Math.max(p.valor ?? 0, p.anterior ?? 0))) * 1.08
  const p = ativo === null ? null : pontos[ativo]!
  const x = (i: number) => ((i + 0.5) / n) * 100
  const y = (v: number) => 100 - (v / teto) * 100

  const linha = (campo: 'valor' | 'anterior') =>
    pontos
      .map((pt, i) => {
        const v = pt[campo]
        return v === null || v === undefined ? null : `${x(i)},${y(v)}`
      })
      .filter(Boolean)
      .join(' ')

  const dica = p
    ? `${p.rotulo}: ${p.valor === null ? 'ainda não chegou' : formatar(p.valor)}${p.detalhe ? ` · ${p.detalhe}` : ''}${p.anterior !== undefined ? ` · ${nomeAnterior} ${formatar(p.anterior)}` : ''}`
    : ''

  function teclas(e: React.KeyboardEvent) {
    const i = ativo ?? n - 1
    const alvo =
      e.key === 'ArrowRight'
        ? Math.min(n - 1, i + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null
    if (alvo === null) return
    e.preventDefault()
    setAtivo(alvo)
  }

  return (
    <div>
      <div
        tabIndex={0}
        role="group"
        aria-roledescription="gráfico"
        aria-label={`${descricao}. Use as setas para ler cada ponto.`}
        onKeyDown={teclas}
        onFocus={() => setAtivo((a) => a ?? n - 1)}
        onBlur={() => setAtivo(null)}
        onMouseLeave={() => setAtivo(null)}
        className={cx('relative rounded-md', altura)}
      >
        {tipo === 'barras' ? (
          <div className="absolute inset-0 flex items-end gap-[3%]">
            {pontos.map((pt, i) => (
              <span
                key={i}
                onMouseEnter={() => setAtivo(i)}
                className={cx('relative h-full flex-1 rounded-t-[4px]', ativo === i && 'bg-marca-suave/60')}
              >
                {pt.anterior !== undefined && (
                  <span
                    className="absolute inset-x-0 bottom-0 h-full origin-bottom rounded-t-[4px] bg-superficie-3 transition-transform duration-500"
                    style={{ transform: `scaleY(${pt.anterior / teto})` }}
                  />
                )}
                {pt.valor !== null && (
                  <span
                    className={cx(
                      'absolute inset-x-[16%] bottom-0 h-full origin-bottom rounded-t-[3px] transition-[transform,background-color] duration-500',
                      ativo === i ? 'bg-marca-forte' : 'bg-marca',
                    )}
                    style={{ transform: `scaleY(${pt.valor / teto})` }}
                  />
                )}
              </span>
            ))}
          </div>
        ) : (
          <>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden
            >
              <defs>
                <linearGradient id={`area-${id}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--marca)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--marca)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={`${x(0)},100 ${linha('valor')} ${x(n - 1)},100`} fill={`url(#area-${id})`} />
              <polyline
                points={linha('anterior')}
                fill="none"
                stroke="var(--tinta-3)"
                strokeOpacity="0.55"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={linha('valor')}
                fill="none"
                stroke="var(--marca)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {p && p.valor !== null && (
              <>
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-borda"
                  style={{ left: `${x(ativo!)}%` }}
                />
                <span
                  aria-hidden
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-superficie bg-marca shadow-norte"
                  style={{ left: `${x(ativo!)}%`, top: `${y(p.valor)}%` }}
                />
              </>
            )}
            <div className="absolute inset-0 flex">
              {pontos.map((_, i) => (
                <span key={i} className="h-full flex-1" onMouseEnter={() => setAtivo(i)} />
              ))}
            </div>
          </>
        )}

        {p && (
          <span
            aria-hidden
            className="dica-grafico flex flex-col rounded-lg border border-borda bg-superficie px-2.5 py-1.5 text-[11px] leading-tight shadow-norte-alta"
            style={{
              left: `${x(ativo!)}%`,
              top: 0,
              bottom: 'auto',
              transform: `translate(${ativo! < n * 0.2 ? '-15%' : ativo! > n * 0.8 ? '-85%' : '-50%'}, calc(-100% - 6px))`,
            }}
          >
            <span className="text-tinta-3">{p.rotulo}</span>
            <span className="numero font-bold text-tinta">
              {p.valor === null ? 'ainda não chegou' : formatar(p.valor)}
            </span>
            {p.detalhe && <span className="text-tinta-2">{p.detalhe}</span>}
            {p.anterior !== undefined && (
              <span className="numero text-tinta-3">
                {nomeAnterior}: {formatar(p.anterior)}
              </span>
            )}
          </span>
        )}
        <span className="sr-only" aria-live="polite">
          {dica}
        </span>
      </div>
      <div className="relative mt-1.5 h-3.5 text-[9.5px] text-tinta-3" aria-hidden>
        {pontos.map((_, i) => {
          const r = eixo(i)
          return r ? (
            <span
              key={i}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${x(i)}%` }}
            >
              {r}
            </span>
          ) : null
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Fichas de filtro
   ═══════════════════════════════════════════════════════════ */

export function Fichas<T extends string>({
  opcoes,
  valor,
  onEscolher,
  rotulo,
  className,
}: {
  opcoes: { valor: T; texto: ReactNode }[]
  valor: T
  onEscolher: (v: T) => void
  rotulo: string
  className?: string
}) {
  return (
    <div role="group" aria-label={rotulo} className={cx('flex flex-wrap gap-1.5', className)}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onEscolher(o.valor)}
          className={cx(
            'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap transition-colors',
            valor === o.valor
              ? 'border-transparent bg-tinta text-superficie'
              : 'border-borda bg-superficie text-tinta-2 hover:border-tinta-3 hover:text-tinta',
          )}
        >
          {o.texto}
        </button>
      ))}
    </div>
  )
}

/** O título de cada tela, com o que fica à direita dele. */
export function Topo({ titulo, sub, children }: { titulo: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        {sub && <p className="text-[11px] text-tinta-3">{sub}</p>}
        <p className="font-display text-lg leading-tight font-bold tracking-tight text-titulo">{titulo}</p>
      </div>
      {children}
    </div>
  )
}

/** Um cartão de dentro das telas. */
export function Cartao({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl bg-superficie p-3.5 shadow-norte', className)}>{children}</div>
}

export const botaoMarca =
  'rounded-lg bg-marca px-3 py-1.5 text-[12.5px] font-semibold text-marca-tinta transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100'
export const botaoLinha =
  'rounded-lg border border-borda bg-superficie px-3 py-1.5 text-[12.5px] font-semibold text-tinta-2 transition-colors hover:border-tinta-3 hover:text-tinta'
