'use client'

// A barra de cima da tela de tarefas: qual quadro, qual loja, só as minhas,
// e o botão de quadro novo.
//
// Tudo aqui é ENDEREÇO (`?quadro=`, `?unidade=`, `?minhas=1`, `?novo=1`),
// nunca estado escondido: a gerente manda o link do quadro de abertura para
// a balconista e as duas abrem exatamente a mesma tela. Até cinco quadros
// viram abas; acima disso, uma lista — cinco abas cabem, doze estouram a
// barra no celular.

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import type { UnidadeVisivel } from '@/servidor/unidade'

const ABAS_ATE = 5

export type QuadroNaAba = { id: string; nome: string; cor: string | null; abertas: number }

export function Cabecalho({
  quadros,
  atual,
  unidades,
  unidadeAtual,
  mostrarSeletor,
  minhas,
  podeGerir,
  novoTitulo,
}: {
  quadros: QuadroNaAba[]
  atual: string | null
  unidades: UnidadeVisivel[]
  unidadeAtual: string | null
  mostrarSeletor: boolean
  minhas: boolean
  podeGerir: boolean
  /** O que o botão "Novo quadro" explica quando está desligado. */
  novoTitulo?: string
}) {
  const router = useRouter()
  const caminho = usePathname()
  const busca = useSearchParams()

  const com = (mudancas: Record<string, string | null>) => {
    const p = new URLSearchParams(busca.toString())
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null) p.delete(k)
      else p.set(k, v)
    }
    return `${caminho}${p.size ? `?${p}` : ''}`
  }

  const aba = (ativo: boolean) =>
    cx(
      'flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors',
      ativo ? 'bg-marca text-marca-tinta' : 'text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {quadros.length > 0 && quadros.length <= ABAS_ATE && (
        <nav aria-label="Quadro" className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-norte border border-borda bg-superficie p-0.5">
          {quadros.map((q) => (
            <Link key={q.id} href={com({ quadro: q.id, novo: null })} aria-current={q.id === atual ? 'page' : undefined} className={aba(q.id === atual)}>
              {q.cor && <span aria-hidden className="size-2 rounded-full" style={{ background: q.cor }} />}
              <span className="max-w-40 truncate">{q.nome}</span>
              {q.abertas > 0 && <span className={cx('numero text-[10px]', q.id === atual ? 'opacity-80' : 'text-tinta-3')}>{q.abertas}</span>}
            </Link>
          ))}
        </nav>
      )}
      {quadros.length > ABAS_ATE && (
        <select
          aria-label="Quadro"
          value={atual ?? ''}
          onChange={(e) => router.push(com({ quadro: e.target.value, novo: null }))}
          className="rounded-norte border border-borda bg-superficie px-2.5 py-1.5 text-sm font-semibold text-tinta"
        >
          {quadros.map((q) => (
            <option key={q.id} value={q.id}>
              {q.nome}
              {q.abertas > 0 ? ` (${q.abertas})` : ''}
            </option>
          ))}
        </select>
      )}

      {mostrarSeletor && <SeletorUnidade opcoes={unidades} atual={unidadeAtual} />}

      <Link
        href={com({ minhas: minhas ? null : '1' })}
        aria-pressed={minhas}
        title={minhas ? 'Mostrando só o que é seu. Clique para ver tudo.' : 'Só as tarefas em que você é a responsável'}
        className={cx(
          'rounded-norte border px-2.5 py-1.5 text-xs font-semibold transition-colors',
          minhas ? 'border-marca bg-marca-suave text-marca' : 'border-borda bg-superficie text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
        )}
      >
        Minhas tarefas
      </Link>

      {podeGerir &&
        (novoTitulo ? (
          <span
            title={novoTitulo}
            aria-disabled
            className="cursor-not-allowed rounded-norte border border-transparent px-3 py-1.5 text-xs font-semibold text-tinta-3"
          >
            Novo quadro
          </span>
        ) : (
          <Link href={com({ novo: '1' })} className="botao-marca rounded-norte px-3 py-1.5 text-xs font-semibold text-marca-tinta">
            Novo quadro
          </Link>
        ))}
    </div>
  )
}
