'use client'

// O menu no celular.
//
// A barra lateral só existe de `md` para cima. Abaixo disso a tela inteira é
// trabalho, e a navegação vive numa gaveta que abre por cima — o desenho que
// todo aplicativo de telefone usa, e que ninguém precisa aprender.
//
// ── o que ela recebe ─────────────────────────────────────────
// A lista de itens vem PRONTA do servidor, como filhos. Ela não sabe o que
// tem dentro nem precisa: a permissão já foi decidida lá, e a mesma lista que
// vai para a barra lateral vem para cá. Um menu só, dois lugares.
//
// ── três coisas que fecham a gaveta ──────────────────────────
// Tocar fora, apertar Esc, e NAVEGAR. A terceira é a que se esquece: sem ela
// a pessoa toca em "Produtos", a página troca por baixo, e a gaveta continua
// aberta tampando o que ela pediu para ver.

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cx } from './base'

export function Gaveta({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  const [aberta, setAberta] = useState(false)
  const caminho = usePathname()

  // Navegou: fecha. O `caminho` muda quando a página troca.
  useEffect(() => {
    setAberta(false)
  }, [caminho])

  useEffect(() => {
    if (!aberta) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberta(false)
    }
    document.addEventListener('keydown', esc)
    // A página de trás não rola enquanto a gaveta está aberta: senão o dedo
    // que arrasta a lista do menu arrasta a tela inteira junto.
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = antes
    }
  }, [aberta])

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-label={`Abrir o menu — ${rotulo}`}
        aria-expanded={aberta}
        aria-controls="gaveta-menu"
        className="flex size-9 shrink-0 items-center justify-center rounded-norte text-nav-tinta hover:bg-nav-2"
      >
        {/* Três traços. Desenhados aqui para não depender de fonte de ícone. */}
        <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {/* Sempre no DOM, só muda de lugar: assim a animação de entrar funciona
          e o leitor de tela não perde a referência. */}
      <div
        aria-hidden={!aberta}
        onClick={() => setAberta(false)}
        className={cx(
          'fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden',
          aberta ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <div
        id="gaveta-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!aberta}
        className={cx(
          'nav-fundo fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-0.5 overflow-y-auto p-2.5',
          'transition-transform duration-200 ease-out md:hidden',
          aberta ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-1.5 pt-1 pb-2">
          <span className="text-[15px] font-extrabold tracking-[-0.035em] text-nav-tinta">Menu</span>
          <button
            type="button"
            onClick={() => setAberta(false)}
            aria-label="Fechar o menu"
            className="flex size-8 items-center justify-center rounded-norte text-nav-tinta-2 hover:bg-nav-2 hover:text-nav-tinta"
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
