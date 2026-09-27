'use client'

import { useActionState, useRef, useEffect } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { trocarSenhaAcao, type EstadoTroca } from './acoes'

export function TrocarSenha({ slug, email }: { slug: string; email: string }) {
  const [estado, agir, pendente] = useActionState<EstadoTroca, FormData>(trocarSenhaAcao.bind(null, slug), {})
  const form = useRef<HTMLFormElement>(null)

  // Deu certo: os campos esvaziam. Senha não fica parada na tela.
  useEffect(() => {
    if (estado.ok) form.current?.reset()
  }, [estado])

  return (
    <form ref={form} action={agir} className="flex max-w-md flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      {/* O gerenciador de senhas precisa do usuário para saber de qual conta é. */}
      <input type="email" name="usuario" autoComplete="username" value={email} readOnly hidden />

      <Campo rotulo="Senha atual" name="atual" type="password" autoComplete="current-password" required />
      <Campo
        rotulo="Senha nova"
        name="nova"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        dica="Pelo menos 8 caracteres. Não use a mesma de outro lugar."
      />
      <Campo rotulo="Repita a senha nova" name="repetida" type="password" autoComplete="new-password" minLength={8} required />

      <div className="flex flex-wrap items-center gap-3">
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Trocando…' : 'Trocar a senha'}
        </Botao>
        <span className="text-xs text-tinta-3">Os outros aparelhos com a sua conta aberta saem.</span>
      </div>
    </form>
  )
}
