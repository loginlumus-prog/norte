'use client'

// A chave entre o modo simples e o avançado.
//
// Grava o cookie do aparelho e pede a página de novo ao servidor: o que muda
// com o modo (menu, painel, balcão) é decidido lá, então não adianta trocar
// só aqui na tela.

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { cx } from './base'
import type { Modo } from '@/servidor/modo'

const OPCOES: { valor: Modo; titulo: string; dica: string }[] = [
  { valor: 'simples', titulo: 'Simples', dica: 'O essencial, com botões grandes. Ideal para o balcão.' },
  { valor: 'avancado', titulo: 'Avançado', dica: 'Todas as telas, gráficos e colunas.' },
]

/** Na barra lateral, ou no cabeçalho de toda tela (onde mora hoje). */
type Tom = 'lado' | 'topo'

const TOM: Record<Tom, { caixa: string; ativo: string; parado: string }> = {
  lado: {
    caixa: 'grid grid-cols-2 border-lado-borda bg-lado-2',
    ativo: 'bg-lado text-lado-ativo shadow-norte',
    parado: 'text-lado-tinta-2 hover:text-lado-tinta',
  },
  topo: {
    caixa: 'inline-flex border-borda bg-superficie-2',
    ativo: 'bg-superficie text-marca shadow-norte',
    parado: 'text-tinta-3 hover:text-tinta',
  },
}

export function TrocaModo({ atual, tom = 'lado' }: { atual: Modo; tom?: Tom }) {
  const router = useRouter()
  const [indo, comecar] = useTransition()

  function escolher(m: Modo) {
    if (m === atual) return
    // 1 ano, e no site inteiro: o modo é do aparelho, não de uma empresa.
    document.cookie = `modo=${m}; path=/; max-age=31536000; samesite=lax`
    comecar(() => router.refresh())
  }

  return (
    <div
      role="group"
      aria-label="Modo da tela"
      aria-busy={indo || undefined}
      className={cx('w-fit gap-0.5 rounded-norte border p-0.5', TOM[tom].caixa, indo && 'opacity-70')}
    >
      {OPCOES.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => escolher(o.valor)}
          title={o.dica}
          aria-pressed={atual === o.valor}
          className={cx(
            'rounded px-2.5 py-1 text-xs font-semibold transition-colors',
            atual === o.valor ? TOM[tom].ativo : TOM[tom].parado,
          )}
        >
          {o.titulo}
        </button>
      ))}
    </div>
  )
}
