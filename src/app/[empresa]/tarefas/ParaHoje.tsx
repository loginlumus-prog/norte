'use client'

// "Para hoje", no alto de Tarefas: o que é de quem abriu a tela e as diárias
// da loja (abrir e fechar), com a caixinha para marcar. Morava na barra do
// caixa; saiu de lá para o balcão ser só venda — e ganhou a tela dela.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/ui/base'
import { moverTarefaAcao } from './acoes'
import type { TarefaDeHoje } from '@/servidor/tarefas'

export function ParaHoje({ slug, tarefas }: { slug: string; tarefas: TarefaDeHoje[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  // A marca muda na hora; o servidor confirma em seguida.
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({})
  const router = useRouter()

  const feita = (t: TarefaDeHoje) => marcadas[t.id] ?? t.feita
  if (tarefas.length === 0) return null

  const alternar = (t: TarefaDeHoje) => {
    const vai = !feita(t)
    setMarcadas((m) => ({ ...m, [t.id]: vai }))
    setErro(null)
    comecar(async () => {
      const r = await moverTarefaAcao(slug, t.id, vai ? 'FEITO' : 'A_FAZER')
      if (r.erro) {
        setErro(r.erro)
        setMarcadas((m) => ({ ...m, [t.id]: !vai }))
      } else router.refresh()
    })
  }

  // Agrupadas pelo quadro e pelo grupo ("Abertura · Ao abrir").
  const grupos = new Map<string, TarefaDeHoje[]>()
  for (const t of tarefas) {
    const k = t.grupo ? `${t.quadroNome} · ${t.grupo}` : t.quadroNome
    grupos.set(k, [...(grupos.get(k) ?? []), t])
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[...grupos.entries()].map(([nome, lista]) => (
        <section key={nome} className="flex flex-col gap-1 rounded-norte border border-borda bg-superficie p-3">
          <h3 className="text-xs font-bold tracking-wide text-tinta-3 uppercase">{nome}</h3>
          <ul className="flex flex-col">
            {lista.map((t) => {
              const ok = feita(t)
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={ok}
                    disabled={indo && marcadas[t.id] !== undefined && marcadas[t.id] !== t.feita}
                    onClick={() => alternar(t)}
                    className="flex w-full items-center gap-3 rounded-norte px-2 py-2.5 text-left text-sm hover:bg-superficie-2"
                  >
                    <span
                      aria-hidden
                      className={cx(
                        'grid size-6 shrink-0 place-items-center rounded-norte border-2',
                        ok ? 'border-bom-vivo bg-bom-vivo text-white' : 'border-borda bg-superficie',
                      )}
                    >
                      {ok && (
                        <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                          <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className={cx('flex-1', ok ? 'text-tinta-3 line-through' : 'text-tinta')}>{t.titulo}</span>
                    {t.minha && <span className="text-[11.5px] font-semibold text-marca uppercase">sua</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {erro && <p className="text-xs text-critico sm:col-span-2 lg:col-span-3">{erro}</p>}
    </div>
  )
}
