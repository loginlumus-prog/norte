// A casca da área de parceiros: a mesma barra do site, com o nome da área ao
// lado da marca — quem chega por aqui sabe que está no Norte, mas não no
// sistema de uma loja.

import type { ReactNode } from 'react'
import { Marca } from '@/ui/Marca'
import { Preferencias } from '@/ui/Preferencias'

export function Casca({ children, direita, largo = false }: { children: ReactNode; direita?: ReactNode; largo?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="border-b border-borda bg-superficie/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-5">
          <a href="/parceiros" className="flex items-center gap-2.5 rounded-norte">
            <Marca tamanho={26} id="topo" />
            <span className="border-l border-borda pl-2.5 text-sm font-semibold text-tinta-2">Parceiros</span>
          </a>
          <div className="flex items-center gap-3 sm:gap-4">
            <Preferencias />
            {direita ?? (
              <a href="/" className="text-sm font-medium text-tinta-2 hover:text-tinta">
                Voltar ao site
              </a>
            )}
          </div>
        </div>
      </header>
      <main className={'mx-auto w-full flex-1 px-4 py-8 sm:px-5 lg:py-12 ' + (largo ? 'max-w-6xl' : 'max-w-5xl')}>{children}</main>
      <footer className="border-t border-borda">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-xs text-tinta-3 sm:px-5">
          <a href="/parceiros/termos" className="hover:text-tinta-2">
            Termos do programa
          </a>
          <a href="/termos" className="hover:text-tinta-2">
            Termos de uso
          </a>
          <a href="/privacidade" className="hover:text-tinta-2">
            Privacidade
          </a>
        </div>
      </footer>
    </div>
  )
}

/** O cartão branco dos formulários (cadastro, entrar, senha). */
export function CartaoForm({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return (
    <div className="entra mx-auto flex w-full max-w-[460px] flex-col gap-6 rounded-3xl border border-borda bg-superficie p-6 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_24px_48px_-12px_rgb(16_24_40/0.14)] sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-titulo">{titulo}</h1>
        {sub && <p className="text-sm text-tinta-2">{sub}</p>}
      </header>
      {children}
    </div>
  )
}
