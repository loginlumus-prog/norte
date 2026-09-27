import Link from 'next/link'
import type { ReactNode } from 'react'
import { Marca } from './Marca'

// A moldura das telas de conta que abrem SEM sessão: esqueci a senha, senha
// nova, confirmar o e-mail. É o modo simples da tela de entrar — o cartão no
// meio, a inicial da empresa na cor dela, a luz suave do fundo — para a
// pessoa reconhecer que continua no mesmo lugar. Sem desenho: a presença
// vem da tipografia e da marca da empresa, como lá.

export function CartaoDeConta({
  empresa,
  titulo,
  subtitulo,
  children,
  rodape,
}: {
  empresa: { nome: string; slug: string; corMarca?: string | null }
  titulo: string
  subtitulo?: string
  children: ReactNode
  /** Embaixo do cartão. Padrão: voltar para a tela de entrar. */
  rodape?: ReactNode
}) {
  const cor = empresa.corMarca || 'var(--marca)'
  const inicial = empresa.nome.trim().charAt(0).toUpperCase() || 'N'
  const luz = {
    background: `radial-gradient(60rem 32rem at 50% -12%, color-mix(in srgb, var(--marca) 11%, transparent) 0%, transparent 65%), radial-gradient(36rem 24rem at 100% 100%, color-mix(in srgb, ${cor} 8%, transparent) 0%, transparent 70%), var(--fundo)`,
  }

  return (
    <main className="flex min-h-dvh flex-col bg-fundo" style={luz}>
      <div className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Marca tamanho={28} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-16">
        <div className="entra flex w-full max-w-[420px] flex-col gap-6 rounded-3xl border border-borda bg-superficie p-6 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_24px_48px_-12px_rgb(16_24_40/0.14)] sm:p-9">
          <header className="flex items-center gap-3.5">
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-2xl text-xl font-extrabold text-white shadow-norte"
              style={{ background: cor }}
            >
              {inicial}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-semibold tracking-wide text-tinta-3 uppercase">{empresa.nome}</span>
              <h1 className="text-lg leading-tight font-bold tracking-tight text-titulo">{titulo}</h1>
            </span>
          </header>
          {subtitulo && <p className="-mt-2 text-sm leading-relaxed text-tinta-2">{subtitulo}</p>}
          {children}
        </div>
        {rodape ?? (
          <Link
            href={`/${empresa.slug}/entrar`}
            className="text-sm font-medium text-tinta-2 underline-offset-4 hover:text-tinta hover:underline"
          >
            Voltar para entrar
          </Link>
        )}
      </div>
    </main>
  )
}
