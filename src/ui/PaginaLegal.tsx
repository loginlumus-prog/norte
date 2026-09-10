// A casca das páginas de documento: termos e privacidade.
//
// Mesma barra e mesmo rodapé da página de venda, porque é o mesmo site — quem
// clica em "Termos" no meio de uma assinatura não pode ter a sensação de ter
// caído em outro lugar. O que muda é o miolo: coluna estreita, numeração de
// seção e nada competindo com a leitura.
//
// ── a tarja de rascunho ──────────────────────────────────────
// Enquanto a razão social e o CNPJ de quem assina não existirem, a página diz
// isso em cima, em vermelho, antes de qualquer texto. Documento que parece
// pronto e não está é o jeito mais fácil de entrar dinheiro em cima de um
// contrato que não vale — e a tarja não tem interruptor: ela some quando os
// campos forem preenchidos em src/servidor/legal.ts, e só assim.

import type { ReactNode } from 'react'
import { Marca } from '@/ui/Marca'
import { TrocaTema } from '@/ui/TrocaTema'
import { EMPRESA, IDENTIDADE_COMPLETA, REVISADO_EM } from '@/servidor/legal'

export function PaginaLegal({
  titulo,
  resumo,
  children,
}: {
  titulo: string
  /** Uma frase dizendo do que trata o documento, em português de gente. */
  resumo: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-superficie">
      <header className="sticky top-0 z-20 border-b border-borda bg-superficie/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="/" className="rounded-norte">
            <Marca tamanho={28} id="topo" />
          </a>
          <div className="flex items-center gap-3 sm:gap-4">
            <TrocaTema tom="papel" />
            <a href="/" className="text-sm font-medium text-tinta-2 hover:text-tinta">
              Voltar ao site
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 md:py-16">
        {!IDENTIDADE_COMPLETA && (
          <div
            role="note"
            className="mb-10 rounded-norte border border-critico-borda bg-critico-fundo px-5 py-4"
          >
            <p className="text-sm font-bold text-critico">Rascunho. Este documento ainda não vale.</p>
            <p className="pt-1.5 text-sm leading-relaxed text-tinta-2">
              Falta quem assina: razão social, CNPJ e endereço. Enquanto isso não existir, não há
              contrato — há um texto. Antes de cobrar de alguém, isto precisa ser preenchido e
              passar por advogado.
            </p>
          </div>
        )}

        <p className="text-xs font-bold tracking-[0.14em] text-marca uppercase">Norte</p>
        <h1 className="pt-2 text-4xl leading-[1.05] font-extrabold tracking-[-0.03em] text-balance">
          {titulo}
        </h1>
        <p className="max-w-2xl pt-4 text-lg leading-relaxed text-tinta-2">{resumo}</p>
        <p className="pt-5 text-[13px] text-tinta-3">
          Última revisão: {REVISADO_EM}
          {IDENTIDADE_COMPLETA && EMPRESA.razaoSocial ? ` · ${EMPRESA.razaoSocial}` : ''}
        </p>

        <div className="flex flex-col gap-10 pt-12">{children}</div>
      </main>

      <footer className="border-t border-borda bg-superficie">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Marca tamanho={22} id="rodape" />
          <nav className="flex gap-5 text-xs text-tinta-3">
            <a href="/termos" className="hover:text-tinta-2">
              Termos de uso
            </a>
            <a href="/privacidade" className="hover:text-tinta-2">
              Privacidade
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}

/**
 * Uma seção numerada.
 *
 * A numeração não é enfeite: contrato é documento que se cita por número
 * ("cláusula 7"), e sem número a única forma de apontar um trecho é copiar e
 * colar. O `id` também vira âncora, para dar link direto.
 */
export function Secao({
  n,
  titulo,
  children,
}: {
  n: number
  titulo: string
  children: ReactNode
}) {
  const id = `s${n}`
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="flex gap-3 text-xl leading-snug font-bold tracking-[-0.02em]">
        <a href={`#${id}`} className="numero shrink-0 text-tinta-3 hover:text-marca">
          {n}.
        </a>
        <span className="text-balance">{titulo}</span>
      </h2>
      <div className="flex flex-col gap-3.5 pt-3.5 pl-8 text-[15px] leading-relaxed text-tinta-2">
        {children}
      </div>
    </section>
  )
}

/** Uma lista de itens dentro de uma seção. */
export function Itens({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-tinta-3">{children}</ul>
}

/** Um ponto que a pessoa precisa mesmo ver — não um aviso legal genérico. */
export function Destaque({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-norte border border-borda bg-superficie-2 px-4 py-3.5 text-[15px] leading-relaxed text-tinta">
      {children}
    </div>
  )
}
