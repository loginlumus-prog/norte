'use client'

import { useActionState } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { aceitar, type EstadoAceite } from './acoes'

/**
 * Criar a conta pelo convite: nome, senha e — para quem opera — o PIN, no
 * mesmo passo. Sai daqui pronta para vender: o PIN é o que confirma cada
 * venda no balcão (ver servidor/autorizacao.ts), e mandar a pessoa a Minha
 * conta depois é o jeito de ela descobrir que falta só no meio da fila.
 */
export function Formulario({
  slug,
  token,
  pedeEmail,
  pedePin,
}: {
  slug: string
  token: string
  /** O convite veio só pelo WhatsApp: a pessoa digita o e-mail com que vai entrar. */
  pedeEmail: boolean
  pedePin: boolean
}) {
  const acao = aceitar.bind(null, slug, token)
  const [estado, agir, pendente] = useActionState<EstadoAceite, FormData>(acao, {})

  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <Campo rotulo="Seu nome" name="nome" required autoFocus placeholder="Como a equipe te chama" defaultValue={estado.nome} />
      {pedeEmail && (
        <Campo
          rotulo="Seu e-mail"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="voce@email.com"
          defaultValue={estado.email}
          dica="É com ele e a senha que você entra no sistema."
        />
      )}
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
      {pedePin && (
        <Campo
          rotulo="Seu PIN"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4,6}"
          minLength={4}
          maxLength={6}
          required
          dica="4 números (pode ser até 6). É com ele que você confirma cada venda no balcão. Nada de 1234 nem 0000."
        />
      )}

      <Botao type="submit" largo carregando={pendente} className="mt-1 h-12 rounded-xl text-[15px]">
        {pendente ? 'Criando...' : 'Criar minha conta'}
      </Botao>
    </form>
  )
}
