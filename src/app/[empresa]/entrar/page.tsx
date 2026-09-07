import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { Aviso } from '@/ui/base'
import { Formulario } from './Formulario'

export default async function Entrar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params
  const org = await acharOrgPorSlug(empresa)
  if (!org) notFound()

  const suspensa = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-7 rounded-norte shadow-norte"
            style={{ background: org.corMarca || 'var(--marca)' }}
          />
          <span className="text-lg font-bold tracking-tight text-tinta">{org.nome}</span>
        </div>
        <p className="text-sm text-tinta-2">Entre para continuar.</p>
      </header>

      {suspensa ? (
        <Aviso nivel="critico">
          O acesso desta empresa está suspenso. Fale com o responsável pela conta.
        </Aviso>
      ) : (
        <Formulario empresa={empresa} />
      )}

      <p className="text-xs text-tinta-3">
        Norte — cada empresa entra pelo próprio endereço.
      </p>
    </main>
  )
}
