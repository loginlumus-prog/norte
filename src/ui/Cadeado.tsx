// O que o plano não abre APARECE — trancado.
//
// ── a regra ──────────────────────────────────────────────────
// Esconder o que o plano não tem ensina que o sistema é pequeno. Mostrar
// trancado, com um exemplo por trás e o nome do plano que abre, ensina o que
// existe — e é a melhor propaganda que o plano de cima pode ter.
//
// A cortesia é uma só: TRANCADO NUNCA PARECE QUEBRADO. Tem cadeado, tem o
// nome do plano com o artigo certo, tem o botão que leva aos planos. Nada de
// cinza sem explicação, nada de botão que não responde.
//
// ── duas peças ───────────────────────────────────────────────
//   Cadeado   a etiqueta miúda: "do Balcão para cima". Para cabeçalho de
//             coluna, botão desligado, linha de formulário.
//   Trancado  o bloco inteiro: o EXEMPLO por trás, embaçado, e o convite na
//             frente. O que vai dentro é amostra — dado inventado para mostrar
//             a forma — nunca dado de verdade que o plano não pagou.
//
// Nenhuma das duas tem estado nem efeito: servem tanto em página de servidor
// quanto dentro de componente de cliente.
//
// ── e o link, só para quem abre os planos ────────────────────
// A tela de Assinatura abre para quem configura a empresa ou cuida do
// dinheiro (`podeVerPlanos`). Para a balconista, o cadeado que levava até lá
// caía em "este endereço não abre" — trancado que parece QUEBRADO, o que a
// regra acima proíbe. Com `verPlanos` falso, o cadeado continua dizendo o
// plano, sem link, e o bloco diz quem troca de plano.

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Plano } from '@prisma/client'
import { LIBERACOES, doPlano, liberado, planoQueAbre, type Liberacao } from '@/servidor/planos'
import { cx } from './base'

export function IconeCadeado({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="7" width="10" height="7" rx="1.6" />
      <path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" />
      <circle cx="8" cy="10.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** A etiqueta miúda: "do Balcão para cima". Leva aos planos. */
export function Cadeado({
  chave,
  slug,
  verPlanos = true,
  className,
}: {
  chave: Liberacao
  slug: string
  /** Quem olha abre a tela de Assinatura? Sem isso, etiqueta sem link. */
  verPlanos?: boolean
  className?: string
}) {
  const p = planoQueAbre(chave)
  const titulo = `${LIBERACOES[chave].titulo}: ${doPlano(p.codigo)} para cima`
  const classe = cx(
    'inline-flex items-center gap-1 rounded-full border border-borda bg-superficie-2 px-1.5 py-0.5',
    'text-[10px] font-semibold whitespace-nowrap text-tinta-3',
    verPlanos && 'hover:border-marca/40 hover:text-tinta',
    className,
  )
  const miolo = (
    <>
      <IconeCadeado className="size-3 shrink-0" />
      {doPlano(p.codigo)} para cima
    </>
  )
  return verPlanos ? (
    <Link href={`/${slug}/assinatura`} title={titulo} className={classe}>
      {miolo}
    </Link>
  ) : (
    <span title={titulo} className={classe}>
      {miolo}
    </span>
  )
}

/**
 * O bloco inteiro trancado.
 *
 * Quando o plano abre, devolve os filhos e mais nada — quem chama não precisa
 * de `if`. Quando não abre, os filhos viram amostra embaçada e o convite
 * entra na frente.
 */
export function Trancado({
  chave,
  plano,
  slug,
  resumo,
  verPlanos = true,
  children,
}: {
  chave: Liberacao
  plano: Plano
  slug: string
  /** Quem olha abre a tela de Assinatura? Sem isso, o convite diz quem troca de plano. */
  verPlanos?: boolean
  /** Uma frase sobre o que a pessoa ganharia. Opcional. */
  resumo?: string
  /** O EXEMPLO. Amostra, nunca dado real do plano de cima. */
  children: ReactNode
}) {
  if (liberado(plano, chave)) return <>{children}</>

  const p = planoQueAbre(chave)
  const titulo = LIBERACOES[chave].titulo

  return (
    <div
      className="relative overflow-hidden rounded-norte"
      role="group"
      aria-label={`${titulo} — ${doPlano(p.codigo)} para cima`}
    >
      {/* A amostra: embaçada e sem cor, mas com a forma inteira. É ela que
          diz "isto existe" antes de qualquer texto. `inert` tira do teclado
          e do leitor de tela — amostra não é conteúdo. */}
      <div inert className="pointer-events-none min-h-32 opacity-55 blur-[2.5px] saturate-50 select-none">
        {children}
      </div>

      <div
        className="absolute inset-0 flex items-center justify-center p-4"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--fundo) 55%, transparent) 40%, color-mix(in srgb, var(--fundo) 85%, transparent) 100%)',
        }}
      >
        <div className="realce flex max-w-sm flex-col items-center gap-2 rounded-norte border border-borda bg-superficie px-5 py-4 text-center shadow-norte-alta">
          <span className="grid size-9 place-items-center rounded-full bg-marca-suave text-marca">
            <IconeCadeado className="size-4" />
          </span>
          <p className="text-sm font-bold text-tinta">
            {titulo} é {doPlano(p.codigo)} para cima
          </p>
          {resumo && <p className="text-xs leading-relaxed text-tinta-2">{resumo}</p>}
          {verPlanos ? (
            <Link
              href={`/${slug}/assinatura`}
              className="botao-marca mt-1 rounded-norte px-4 py-2 text-xs font-semibold text-marca-tinta"
            >
              Ver os planos
            </Link>
          ) : (
            <p className="text-xs text-tinta-3">Quem responde pela empresa troca de plano em Assinatura.</p>
          )}
        </div>
      </div>
    </div>
  )
}
