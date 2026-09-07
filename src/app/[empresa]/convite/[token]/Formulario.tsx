'use client'

import { useActionState } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { aceitar, type EstadoAceite } from './acoes'

export function Formulario({ slug, token }: { slug: string; token: string }) {
  const acao = aceitar.bind(null, slug, token)
  const [estado, agir, pendente] = useActionState<EstadoAceite, FormData>(acao, {})

  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <Campo rotulo="Seu nome" name="nome" required autoFocus placeholder="Como a equipe te chama" />
      <Campo
        rotulo="Senha"
        name="senha"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        dica="Pelo menos 8 letras. Não use a mesma de outro lugar."
      />
      <Campo
        rotulo="Repita a senha"
        name="repetida"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
      />

      <Botao type="submit" tom="confirmar" carregando={pendente} className="w-full">
        {pendente ? 'Criando...' : 'Criar minha conta'}
      </Botao>
    </form>
  )
}
