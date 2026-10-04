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
// A causa mais comum de erro "do nada" não é defeito: é a página ter ficado
// aberta enquanto o sistema era atualizado. O navegador ainda tem o código
// antigo e chama o servidor pelo endereço antigo ("Failed to find Server
// Action"); o servidor novo não o conhece. "Tentar de novo" repete a mesma
// chamada e dá o mesmo erro — o que resolve é RECARREGAR a página.
const PAGINA_VELHA = /Server Action|older or newer deployment|Failed to fetch|NetworkError|Load failed|ChunkLoadError|Loading chunk/i

export default function Quebrou({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const paginaVelha = PAGINA_VELHA.test(`${error?.name ?? ''} ${error?.message ?? ''}`)
  return (
    <main className="relative flex min-h-dvh bg-fundo flex-col items-center justify-center gap-6 overflow-hidden p-6 text-center">
      <div className="relative">
        <Marca tamanho={30} />
      </div>
      <div className="relative flex max-w-md flex-col gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {paginaVelha ? 'O sistema acabou de ser atualizado.' : 'Deu problema aqui do nosso lado.'}
        </h1>
        <p className="leading-relaxed text-tinta-2">
          {paginaVelha
            ? 'Esta página estava aberta antes da atualização (ou a internet oscilou). Nada do que já estava salvo se perdeu: é só recarregar a página e fazer de novo.'
            : 'Não foi você, e nada que já estava salvo se perdeu. Tente de novo em alguns segundos. Se continuar, chame o suporte e diga este código.'}
        </p>
      </div>

      <button
        onClick={paginaVelha ? () => window.location.reload() : reset}
        className="botao-marca relative rounded-norte px-5 py-2.5 text-sm font-semibold text-marca-tinta"
      >
        {paginaVelha ? 'Recarregar a página' : 'Tentar de novo'}
      </button>

      {error.digest && (
        <p className="numero text-xs text-tinta-3">código {error.digest}</p>
      )}
    </main>
  )
}
