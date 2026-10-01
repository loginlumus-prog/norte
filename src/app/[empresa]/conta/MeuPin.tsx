'use client'

// O PIN pessoal, para autorizar no balcão de outra pessoa (ver
// servidor/autorizacao.ts). Pede a senha de entrar: a conta aberta e
// esquecida no balcão não pode virar "criei um PIN na conta da gerente".

import { useActionState, useEffect, useRef } from 'react'
import { Aviso, Botao, Campo } from '@/ui/base'
import { definirPinAcao, type EstadoPin } from './acoes'

export function MeuPin({ slug, tem, desde }: { slug: string; tem: boolean; desde: string | null }) {
  const [estado, agir, pendente] = useActionState<EstadoPin, FormData>(definirPinAcao.bind(null, slug), {})
  const form = useRef<HTMLFormElement>(null)

  // Deu certo: os campos esvaziam. PIN e senha não ficam parados na tela.
  useEffect(() => {
    if (estado.ok) form.current?.reset()
  }, [estado])

  return (
    <form ref={form} action={agir} className="flex max-w-md flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
      {tem && !estado.ok && (
        <p className="text-sm text-tinta-2">
          Você tem um PIN{desde ? ` desde ${desde}` : ''}. Para trocar, digite o novo abaixo.
        </p>
      )}

      <Campo
        rotulo={tem ? 'PIN novo' : 'PIN'}
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{4,6}"
        minLength={4}
        maxLength={6}
        required
        dica="De 4 a 6 números. Nada de 1234 nem 0000 — é o primeiro que alguém chuta."
      />
      <Campo rotulo="Repita o PIN" name="repetido" type="password" inputMode="numeric" autoComplete="off" maxLength={6} required />
      <Campo
        rotulo="Sua senha de entrar"
        name="senha"
        type="password"
        autoComplete="current-password"
        required
        dica="Para ninguém criar um PIN na sua conta aberta."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando…' : tem ? 'Trocar o PIN' : 'Criar o PIN'}
        </Botao>
        {tem && (
          <Botao type="submit" name="tirar" value="1" tom="discreto" formNoValidate>
            Apagar meu PIN
          </Botao>
        )}
      </div>
    </form>
  )
}
