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

export function TrocaModo({ atual }: { atual: Modo }) {
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
      className="grid grid-cols-2 gap-0.5 rounded-norte border border-lado-borda bg-lado-2 p-0.5"
    >
      {OPCOES.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => escolher(o.valor)}
          title={o.dica}
          aria-pressed={atual === o.valor}
          className={cx(
            'rounded px-2 py-1 text-xs font-semibold transition-colors',
            atual === o.valor
              ? 'bg-lado text-lado-ativo shadow-norte'
              : 'text-lado-tinta-2 hover:text-lado-tinta',
          )}
        >
          {o.titulo}
        </button>
      ))}
    </div>
  )
}
