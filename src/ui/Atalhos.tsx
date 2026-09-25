'use client'

// Os atalhos do painel simples, e a porta entre os dois painéis.
//
// ── por que atalho no painel ─────────────────────────────────
// Quem abre o sistema de manhã veio fazer UMA coisa: vender, dar entrada no
// que chegou, lançar o boleto. Procurar isso no menu é ler uma lista de
// dezesseis itens para achar o que se faz todo dia. O atalho é o botão
// grande que já está onde o olho cai, e só aparece para quem pode — botão
// que leva a "este endereço não abre" é pior que botão nenhum.
//
// Vender é o maior e o único azul: é o que a loja existe para fazer, e dois
// botões azuis são dois "principais", o que quer dizer nenhum.
//
// Sem ícone. O painel é dado, tipografia e cor — nenhum desenho. O que diz
// o que o botão faz é o VERBO grande ("Vender", "Dar entrada"), e a seta diz
// que é para clicar.
//
// Este arquivo é de cliente só por causa da troca de modo, que grava cookie.
// Os atalhos em si não têm estado.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition, type ReactNode } from 'react'
import { cx } from './base'
import type { Modo } from '@/servidor/modo'

export type ChaveAtalho = 'vender' | 'entrada' | 'produto' | 'conta' | 'tarefa'

export type Atalho = { chave: ChaveAtalho; href: string; titulo: string; resumo: string }

export function Atalhos({ itens }: { itens: Atalho[] }) {
  if (itens.length === 0) return null
  // Vender ocupa a linha inteira; os outros vão dois a dois. Se sobrar um
  // sozinho na última linha, ele fecha a linha em vez de deixar um buraco.
  const menores = itens.filter((a) => a.chave !== 'vender').length
  const ultimo = itens[itens.length - 1]
  return (
    <ul className="grid grid-cols-2 gap-3">
      {itens.map((a) => {
        const principal = a.chave === 'vender'
        const largo = principal || (a === ultimo && menores % 2 === 1)
        return (
          <li key={a.chave} className={cx(largo && 'col-span-2')}>
            {principal ? (
              <Link
                href={a.href}
                className="botao-marca flex h-full items-center gap-4 rounded-norte px-5 py-4 text-marca-tinta"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-lg leading-tight font-bold">{a.titulo}</span>
                  <span className="text-xs leading-snug opacity-85">{a.resumo}</span>
                </span>
                <span aria-hidden className="ml-auto text-xl font-bold">→</span>
              </Link>
            ) : (
              <Link
                href={a.href}
                className={cx(
                  'group realce flex h-full items-end justify-between gap-2 rounded-norte border border-borda bg-superficie px-3.5 py-3.5',
                  'transition-colors hover:border-marca/40 hover:bg-marca-suave',
                )}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm leading-tight font-bold text-tinta">{a.titulo}</span>
                  <span className="text-xs leading-snug text-tinta-2">{a.resumo}</span>
                </span>
                <span aria-hidden className="shrink-0 text-base font-bold text-marca transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * O link discreto no pé do painel: "Ver o painel completo" / "Voltar ao
 * simples". Grava o MESMO cookie da chave da barra lateral (`TrocaModo`) —
 * o modo é do aparelho, e as duas portas têm de dar no mesmo lugar — e pede a
 * página de novo ao servidor, que é onde o painel decide o que mostrar.
 */
export function IrParaModo({ para, children }: { para: Modo; children: ReactNode }) {
  const router = useRouter()
  const [indo, comecar] = useTransition()
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `modo=${para}; path=/; max-age=31536000; samesite=lax`
        comecar(() => router.refresh())
      }}
      aria-busy={indo || undefined}
      disabled={indo}
      className="inline-flex items-center gap-1.5 rounded-norte px-2 py-1 text-sm font-medium text-marca underline-offset-4 hover:underline disabled:opacity-60"
    >
      {para === 'simples' && <span aria-hidden>←</span>}
      {children}
      {para === 'avancado' && <span aria-hidden>→</span>}
    </button>
  )
}
