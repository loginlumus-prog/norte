import Link from 'next/link'

// Raiz do site. Cada empresa vive no próprio endereço (/nome-da-empresa),
// então aqui não há sistema — só a porta de entrada.
export default function Inicio() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-tinta">Norte</h1>
      <p className="text-tinta-2">
        Cada empresa entra pelo próprio endereço. Se você recebeu um convite, use o link que
        chegou para você.
      </p>
      <p className="text-sm text-tinta-3">
        Ambiente de desenvolvimento:{' '}
        <Link href="/exemplo/entrar" className="font-medium text-marca underline underline-offset-2">
          /exemplo/entrar
        </Link>
      </p>
    </main>
  )
}
