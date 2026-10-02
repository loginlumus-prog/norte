'use client'

// O cartão "Primeiros passos" do Painel. O que está feito vem do banco
// (servidor/primeiros-passos.ts); aqui só o "Esconder", que é da pessoa e do
// aparelho — guardado no navegador, por usuário. Esconder não apaga nada: o
// mesmo caminho continua em Produtos, Estoque, Equipe e no Assistente.

import { useEffect, useState } from 'react'
import Link from 'next/link'
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

  // O que já foi feito vira UMA linha de etiquetas: riscado, em fila, cada
  // passo pronto ocupava uma linha inteira e empurrava os números do dia
  // para baixo. A lista fica só com o que falta.
  const prontos = passos.filter((p) => p.feito)
  const faltam = passos.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => !p.feito)

  return (
    <section aria-label="Primeiros passos" className="realce flex flex-col gap-3 rounded-norte border border-marca/40 bg-superficie p-4 sm:p-5">
      <header className="flex items-center gap-3">
        <h3 className="shrink-0 text-[15px] leading-snug font-bold tracking-tight">Primeiros passos</h3>
        <span className="numero shrink-0 text-xs font-semibold text-tinta-2">
          {feitos} de {passos.length}
        </span>
        <div className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-superficie-2" aria-hidden>
          <div className="h-full rounded-full bg-bom-vivo" style={{ width: `${Math.round((feitos / passos.length) * 100)}%` }} />
        </div>
        <button type="button" onClick={esconder} className="shrink-0 rounded-norte border border-borda px-2 py-1 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta">
          Esconder
        </button>
      </header>
      {prontos.length > 0 && (
        <ul aria-label="Feitos" className="flex flex-wrap gap-1.5">
          {prontos.map((p) => (
            <li key={p.chave} className="inline-flex items-center gap-1.5 rounded-full bg-bom-fundo px-2.5 py-1 text-xs font-semibold text-bom">
              <span aria-hidden>✓</span>
              {p.titulo}
              <span className="sr-only"> — feito</span>
            </li>
          ))}
        </ul>
      )}
      <ol className="-mx-2 flex flex-col">
        {faltam.map(({ p, n }) => (
          <li key={p.chave} className="border-b border-borda-suave last:border-b-0">
            <Link
              href={p.href}
              className="group flex items-center gap-3 rounded-norte px-2 py-2 transition-colors hover:bg-superficie-2"
            >
              <span
                aria-hidden
                className="numero flex size-6 shrink-0 items-center justify-center rounded-full border border-borda text-xs font-bold text-tinta-2"
              >
                {n}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm leading-snug font-semibold text-tinta">
                  {p.titulo}
                  <span className="sr-only"> — falta</span>
                </span>
                <span className="text-xs leading-snug text-tinta-2">{p.detalhe}</span>
              </span>
              <span
                aria-hidden
                className="shrink-0 rounded-norte border border-borda bg-superficie px-2.5 py-1 text-xs font-semibold text-marca transition-colors group-hover:border-marca/40 group-hover:bg-marca-suave"
              >
                {p.acao} →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
