import type { Metadata } from 'next'
import { Casca, CartaoForm } from '../Casca'
import { FormEsqueci } from '../Formularios'

export const metadata: Metadata = { title: 'Esqueci a senha · Parceiros do Norte' }

export default function EsqueciParceiro() {
  return (
    <Casca>
      <CartaoForm titulo="Esqueci a senha" sub="Mandamos um link para você escolher uma senha nova.">
        <FormEsqueci />
      </CartaoForm>
    </Casca>
  )
}
