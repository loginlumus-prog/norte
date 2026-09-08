'use client'

import { Marca } from '@/ui/Marca'

// A tela de quando alguma coisa quebra do lado do servidor.
//
// Sem ela, quem está no balcão vê o que eu vi hoje: "PrismaClientKnownRequestError
// — Can't reach database server at 127.0.0.1:5433", com caminho de arquivo e
// pilha. Isso não é uma tela para quem está com cliente na frente. É pior do
// que feio: parece que os DADOS sumiram, e a reação certa (esperar um minuto
// e tentar de novo) não passa pela cabeça de ninguém que lê aquilo.
//
// ── por que não dizer o que quebrou ──────────────────────────
// A mensagem de erro de verdade fica no log do servidor, não na tela. Texto
// de exceção entrega nome de tabela, de coluna e às vezes o endereço do banco
// — e essa tela pode ser aberta por qualquer pessoa. Quem precisa do detalhe
// tem o `digest` abaixo, que é o número que liga esta tela àquela linha do log.
export default function Quebrou({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-nav p-6 text-center">
      <Marca tamanho={30} nu claro />
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight text-nav-tinta">
          Deu problema aqui do nosso lado.
        </h1>
        <p className="leading-relaxed text-nav-tinta-2">
          Não foi você, e nada que já estava salvo se perdeu. Tente de novo em alguns
          segundos. Se continuar, chame o suporte e diga este código.
        </p>
      </div>

      <button
        onClick={reset}
        className="rounded-norte bg-marca px-5 py-2.5 text-sm font-semibold text-marca-tinta hover:bg-marca-forte"
      >
        Tentar de novo
      </button>

      {error.digest && (
        <p className="numero text-xs text-nav-tinta-2">código {error.digest}</p>
      )}
    </main>
  )
}
