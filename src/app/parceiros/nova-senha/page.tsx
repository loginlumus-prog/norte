import type { Metadata } from 'next'
import { Casca, CartaoForm } from '../Casca'
import { FormNovaSenha } from '../Formularios'

export const metadata: Metadata = { title: 'Senha nova · Parceiros do Norte' }

export default async function NovaSenhaParceiro({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams
  return (
    <Casca>
      <CartaoForm titulo="Escolha a senha nova">
        {c ? (
          <FormNovaSenha codigo={c.slice(0, 100)} />
        ) : (
          <p className="text-sm text-tinta-2">
            Este endereço está incompleto. Abra o link do e-mail de novo, ou{' '}
            <a href="/parceiros/esqueci" className="font-semibold text-marca hover:underline">
              peça outro
            </a>
            .
          </p>
        )}
      </CartaoForm>
    </Casca>
  )
}
