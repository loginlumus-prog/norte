'use client'

// "Tarefas" na barra do caixa: o que é de quem está no balcão e as diárias
// da loja (abrir e fechar), com a caixinha para marcar. Antes, para dar baixa
// em "conferir o troco", a atendente saía da tela de venda, achava Tarefas no
// menu e abria o menu da situação — e não fazia.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/ui/base'
import { Folha } from './Folha'
import { moverTarefaAcao } from '../tarefas/acoes'
import type { TarefaDeHoje } from '@/servidor/tarefas'

export function TarefasDeHoje({ slug, tarefas }: { slug: string; tarefas: TarefaDeHoje[] }) {
  const [aberta, setAberta] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  // A marca muda na hora; o servidor confirma em seguida.
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({})
  const router = useRouter()

  const feita = (t: TarefaDeHoje) => marcadas[t.id] ?? t.feita
  const faltam = tarefas.filter((t) => !feita(t)).length
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
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className={cx(
          'inline-flex min-h-9 items-center gap-1.5 rounded-norte border px-2.5 py-1.5 text-xs font-semibold',
          faltam > 0 ? 'border-marca/40 bg-marca-suave text-marca' : 'border-borda bg-superficie text-tinta-2',
        )}
      >
        <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 8.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {faltam > 0 ? `Tarefas · faltam ${faltam}` : 'Tarefas feitas'}
      </button>

      <Folha aberta={aberta} aoFechar={() => setAberta(false)} titulo="Tarefas de hoje" subtitulo={faltam > 0 ? `Faltam ${faltam}` : 'Tudo feito'}>
        <div className="flex flex-col gap-4">
          {[...grupos.entries()].map(([nome, lista]) => (
            <section key={nome} className="flex flex-col gap-1">
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
                        {t.minha && <span className="text-[10px] font-semibold text-marca uppercase">sua</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {erro && <p className="text-xs text-critico">{erro}</p>}
        </div>
      </Folha>
    </>
  )
}
