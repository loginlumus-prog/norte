'use client'

import { useActionState } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { entrarAcao, type EstadoEntrada } from './acoes'

export function Formulario({ empresa }: { empresa: string }) {
  const [estado, agir, pendente] = useActionState<EstadoEntrada, FormData>(entrarAcao, {})

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <Campo
        rotulo="E-mail"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={estado.email}
        required
        autoFocus
      />
      <Campo rotulo="Senha" name="senha" type="password" autoComplete="current-password" required />

      <Botao type="submit" largo carregando={pendente}>
        {pendente ? 'Entrando...' : 'Entrar'}
      </Botao>
    </form>
  )
}
