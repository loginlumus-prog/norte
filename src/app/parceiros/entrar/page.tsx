import type { Metadata } from 'next'
import { Casca, CartaoForm } from '../Casca'
import { FormEntrar } from '../Formularios'

export const metadata: Metadata = { title: 'Entrar · Parceiros do Norte' }

export default function EntrarParceiro() {
  return (
    <Casca>
      <CartaoForm titulo="Entrar no painel de parceiro" sub="Seus clientes, suas comissões e o seu link.">
        <FormEntrar />
      </CartaoForm>
    </Casca>
  )
}
