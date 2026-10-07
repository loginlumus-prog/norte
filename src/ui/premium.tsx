// Peças de tela com mais vida: o cartão-filtro colorido (número grande que é
// também o botão do filtro) e o avatar de iniciais. Sem hook: servem às
// páginas do servidor.
//
// A cor de cada cartão diz o ASSUNTO, não o estado: "sumidos" é âmbar porque
// pede atenção, "devendo" é vermelho, "compram" é verde. O escolhido ganha o
// contorno e o fundo da cor dele — o olho acha o filtro aceso sem ler.

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { cx } from './base'

export type CorDoCartao = 'indigo' | 'verde' | 'ambar' | 'rosa' | 'vermelho' | 'ceu' | 'violeta' | 'ardosia'

export const COR: Record<CorDoCartao, string> = {
  indigo: '#6366f1',
  verde: '#10b981',
  ambar: '#f59e0b',
  rosa: '#ec4899',
  vermelho: '#ef4444',
  ceu: '#0ea5e9',
  violeta: '#8b5cf6',
  ardosia: '#64748b',
}

/** Os desenhos dos cartões: traço de 1.8 na grade de 20. */
export const ICONE = {
  pessoas: <><circle cx="7.5" cy="7" r="3" /><path d="M2 16.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><path d="M13.5 4.2a3 3 0 0 1 0 5.6M15.5 12.4c1.4.6 2.3 2 2.5 4.1" /></>,
  sacola: <><path d="M4 6.5h12l-1 10.5H5z" /><path d="M7.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5" /></>,
  relogio: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4.2l2.8 1.8" /></>,
  bolo: <><path d="M3.5 17h13v-6.5h-13z" /><path d="M3.5 13.5c1.6 1 3 1 4.3 0s3-1 4.4 0 2.7 1 4.3 0" /><path d="M10 10.5V7.5" /><path d="M10 4.2c.9.8.9 1.9 0 2.6-.9-.7-.9-1.8 0-2.6z" /></>,
  moeda: <><circle cx="10" cy="10" r="7" /><path d="M12.4 7.6c-.5-.7-1.3-1-2.4-1-1.4 0-2.4.7-2.4 1.8 0 2.6 5 1.3 5 3.9 0 1.1-1.1 1.9-2.6 1.9-1.1 0-2-.4-2.6-1.1M10 5v1.6M10 13.8v1.4" /></>,
  estrela: <path d="M10 2.8l2.2 4.5 4.9.7-3.6 3.5.9 4.9L10 14.1l-4.4 2.3.9-4.9L2.9 8l4.9-.7z" />,
  novo: <><circle cx="10" cy="10" r="7" /><path d="M10 6.8v6.4M6.8 10h6.4" /></>,
  sono: <><path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" /></>,
} satisfies Record<string, ReactNode>

export function CartaoFiltro({
  href,
  ativo,
  cor,
  icone,
  numero,
  rotulo,
  detalhe,
}: {
  href: string
  ativo: boolean
  cor: CorDoCartao
  icone: keyof typeof ICONE
  numero: number | string
  rotulo: string
  detalhe?: string
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? 'true' : undefined}
      style={{ '--c': COR[cor] } as CSSProperties}
      className={cx(
        'cartao-vivo group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border p-3.5 text-left',
        ativo
          ? 'border-[var(--c)] bg-[color-mix(in_oklab,var(--c)_9%,var(--superficie))] shadow-[0_10px_24px_-16px_var(--c)]'
          : 'border-borda bg-superficie hover:border-[color-mix(in_oklab,var(--c)_45%,var(--borda))]',
      )}
    >
      {/* O brilho da cor no canto: discreto, só para o cartão ter cor. */}
      <span aria-hidden className="pointer-events-none absolute -top-8 -right-8 size-24 rounded-full bg-[var(--c)] opacity-[0.07] transition-opacity group-hover:opacity-[0.13]" />
      <span className="flex items-center justify-between gap-2">
        <span
          className={cx(
            'grid size-9 place-items-center rounded-xl transition-transform group-hover:scale-105',
            ativo ? 'bg-[var(--c)] text-white shadow-[0_6px_14px_-6px_var(--c)]' : 'bg-[color-mix(in_oklab,var(--c)_14%,transparent)] text-[var(--c)]',
          )}
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {ICONE[icone]}
          </svg>
        </span>
        <span className="numero text-2xl leading-none font-extrabold tracking-tight text-tinta">{typeof numero === 'number' ? numero.toLocaleString('pt-BR') : numero}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-tinta">{rotulo}</span>
        {detalhe ? <span className="truncate text-xs text-tinta-3">{detalhe}</span> : null}
      </span>
    </Link>
  )
}

const TONS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316']

/** As iniciais num círculo; a cor sai do nome, então a mesma pessoa tem sempre a mesma cor. */
export function Avatar({ nome, tamanho = 36, apagado = false }: { nome: string; tamanho?: number; apagado?: boolean }) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const iniciais = ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase() || '·'
  let h = 0
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const cor = TONS[h % TONS.length]!
  return (
    <span
      aria-hidden
      className={cx('grid shrink-0 place-items-center rounded-full font-bold text-white', apagado && 'opacity-50 grayscale')}
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: Math.round(tamanho * 0.36),
        background: `linear-gradient(140deg, color-mix(in oklab, ${cor} 75%, white), ${cor})`,
        boxShadow: `0 4px 10px -5px ${cor}`,
      }}
    >
      {iniciais}
    </span>
  )
}
