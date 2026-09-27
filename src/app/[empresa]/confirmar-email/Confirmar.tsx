'use client'

import { useActionState } from 'react'
import { Botao, Aviso } from '@/ui/base'
import { confirmarAcao, type EstadoConfirmacao } from './acoes'

export function Confirmar({ slug, token }: { slug: string; token: string }) {
  const [estado, agir, pendente] = useActionState<EstadoConfirmacao>(confirmarAcao.bind(null, slug, token), {})
  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      <Botao type="submit" largo carregando={pendente} className="h-12 rounded-xl text-[15px]">
        {pendente ? 'Confirmando…' : 'Confirmar meu e-mail'}
      </Botao>
    </form>
  )
}
