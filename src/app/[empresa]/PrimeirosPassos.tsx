'use client'

// O cartão "Primeiros passos" do Painel. O que está feito vem do banco
// (servidor/primeiros-passos.ts); aqui só o "Esconder", que é da pessoa e do
// aparelho — guardado no navegador, por usuário. Esconder não apaga nada: o
// mesmo caminho continua em Produtos, Estoque, Equipe e no Assistente.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cx } from '@/ui/base'
import type { PrimeiroPasso } from '@/servidor/primeiros-passos'

export function PrimeirosPassos({ passos, chave }: { passos: PrimeiroPasso[]; chave: string }) {
  // Começa escondido até ler o navegador: quem já escondeu não vê o cartão
  // piscar na tela a cada visita.
  const [escondido, setEscondido] = useState<boolean | null>(null)
  const nome = `norte:primeiros-passos:${chave}`

  useEffect(() => {
    let v = false
    try {
      v = window.localStorage.getItem(nome) === '1'
    } catch {
      // Navegador sem armazenamento (aba anônima, bloqueio): o cartão aparece.
    }
    setEscondido(v)
  }, [nome])

  const feitos = passos.filter((p) => p.feito).length
  if (escondido !== false || passos.length === 0 || feitos === passos.length) return null

  const esconder = () => {
    try {
      window.localStorage.setItem(nome, '1')
    } catch {
      // sem armazenamento, esconde só até recarregar
    }
    setEscondido(true)
  }

  return (
    <section aria-label="Primeiros passos" className="realce flex flex-col gap-3 rounded-norte border border-marca/40 bg-superficie p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[15px] leading-snug font-bold tracking-tight">Primeiros passos</h3>
          <p className="text-xs text-tinta-3">
            {feitos} de {passos.length} feitos — o que falta para o Norte trabalhar por você.
          </p>
        </div>
        <button type="button" onClick={esconder} className="rounded-norte px-2 py-1 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta">
          Esconder
        </button>
      </header>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-superficie-2" aria-hidden>
        <div className="h-full rounded-full bg-bom-vivo" style={{ width: `${Math.round((feitos / passos.length) * 100)}%` }} />
      </div>
      <ol className="-mx-2 flex flex-col">
        {passos.map((p, i) => (
          <li key={p.chave} className="border-b border-borda-suave last:border-b-0">
            <Link
              href={p.href}
              className={cx('group flex items-center gap-3 rounded-norte px-2 py-2 transition-colors hover:bg-superficie-2', p.feito && 'opacity-70')}
            >
              <span
                aria-hidden
                className={cx(
                  'numero flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  p.feito ? 'bg-bom-vivo text-white' : 'border border-borda text-tinta-2',
                )}
              >
                {p.feito ? '✓' : i + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cx('text-sm leading-snug font-semibold', p.feito ? 'text-tinta-2 line-through decoration-tinta-3' : 'text-tinta')}>
                  {p.titulo}
                  <span className="sr-only">{p.feito ? ' — feito' : ' — falta'}</span>
                </span>
                {!p.feito && <span className="text-xs leading-snug text-tinta-2">{p.detalhe}</span>}
              </span>
              {!p.feito && (
                <span
                  aria-hidden
                  className="shrink-0 rounded-norte border border-borda bg-superficie px-2.5 py-1 text-xs font-semibold text-marca transition-colors group-hover:border-marca/40 group-hover:bg-marca-suave"
                >
                  {p.acao} →
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
