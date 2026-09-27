'use client'

import './globals.css'

// A última rede: quando quebra o PRÓPRIO layout raiz (e não uma tela), o
// error.tsx não tem onde se pendurar e o Next mostraria a página branca dele,
// em inglês. Esta substitui o documento inteiro — por isso traz <html> e
// <body> — e diz o mesmo que a tela de erro comum, com o mesmo código.
export default function QuebrouTudo({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR" data-tema="claro">
      <body>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-fundo p-6 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">Deu problema aqui do nosso lado.</h1>
          <p className="max-w-md leading-relaxed text-tinta-2">
            Não foi você, e nada que já estava salvo se perdeu. Tente de novo em alguns segundos. Se continuar,
            chame o suporte e diga este código.
          </p>
          <button
            onClick={reset}
            className="botao-marca rounded-norte px-5 py-2.5 text-sm font-semibold text-marca-tinta"
          >
            Tentar de novo
          </button>
          {error.digest && <p className="numero text-xs text-tinta-3">código {error.digest}</p>}
        </main>
      </body>
    </html>
  )
}
