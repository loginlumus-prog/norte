// A navegação entre páginas de uma lista grande. Ver paginacao.ts.
//
// Links de verdade, sem JavaScript: cada página é um endereço. Some quando a
// lista cabe numa página só — "página 1 de 1" é ruído.

import Link from 'next/link'
import { vizinhas, type Pagina } from './paginacao'
import { cx } from './base'

const n = (v: number) => v.toLocaleString('pt-BR')

export function Paginas({
  p,
  linkDe,
  rotulo = 'itens',
}: {
  p: Pagina
  linkDe: (pagina: number) => string
  /** O que está sendo contado: "produtos", "clientes", "parcelas". */
  rotulo?: string
}) {
  if (p.paginas <= 1) return null
  const botao = 'rounded-norte border px-2.5 py-1 text-xs font-semibold'
  return (
    <nav aria-label="Páginas da lista" className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-tinta-3">
        <span className="numero">{n(p.de)}–{n(p.ate)}</span> de <span className="numero">{n(p.total)}</span> {rotulo}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {p.pagina > 1 ? (
          <Link href={linkDe(p.pagina - 1)} className={cx(botao, 'border-borda bg-superficie text-tinta hover:bg-superficie-2')}>
            ‹ anterior
          </Link>
        ) : (
          <span aria-hidden className={cx(botao, 'border-transparent text-tinta-3')}>‹ anterior</span>
        )}
        {vizinhas(p.pagina, p.paginas).map((v, i) =>
          v === null ? (
            <span key={`r${i}`} aria-hidden className="px-1 text-xs text-tinta-3">…</span>
          ) : (
            <Link
              key={v}
              href={linkDe(v)}
              aria-current={v === p.pagina ? 'page' : undefined}
              aria-label={`Página ${v}`}
              className={cx(
                botao,
                'numero',
                v === p.pagina ? 'border-marca/40 bg-marca-suave text-marca' : 'border-transparent text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
              )}
            >
              {v}
            </Link>
          ),
        )}
        {p.pagina < p.paginas ? (
          <Link href={linkDe(p.pagina + 1)} className={cx(botao, 'border-borda bg-superficie text-tinta hover:bg-superficie-2')}>
            próxima ›
          </Link>
        ) : (
          <span aria-hidden className={cx(botao, 'border-transparent text-tinta-3')}>próxima ›</span>
        )}
      </span>
    </nav>
  )
}
