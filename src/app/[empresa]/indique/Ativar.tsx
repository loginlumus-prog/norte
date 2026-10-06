'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Botao, Aviso } from '@/ui/base'
import { ativarAcao, type EstadoIndique } from './acoes'

export function Ativar({ slug, email }: { slug: string; email: string }) {
  const [estado, agir, pendente] = useActionState<EstadoIndique, FormData>(ativarAcao.bind(null, slug), {})
  const [ver, setVer] = useState(false)
  return (
    <form action={agir} className="flex max-w-md flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      <p className="text-sm text-tinta-2">
        A conta de parceiro usa o seu e-mail (<b className="text-tinta">{email}</b>) e uma senha só dela — é com ela que você
        entra no painel de parceiro por fora do sistema. Se você já é parceiro com este e-mail, digite a senha de lá.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ind-senha" className="text-sm font-medium text-tinta">
          Senha da conta de parceiro
        </label>
        <div className="relative">
          <input
            id="ind-senha"
            name="senha"
            type={ver ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-norte border border-borda bg-superficie px-3 py-2 pr-20 text-sm text-tinta"
          />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            className="absolute inset-y-0 right-1 my-1 rounded px-2 text-xs font-semibold text-tinta-2 hover:bg-superficie-2"
          >
            {ver ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <p className="text-xs text-tinta-3">Pelo menos 8 caracteres.</p>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-tinta-2">
        <input type="checkbox" name="aceite" required className="mt-0.5 size-4 shrink-0 accent-[var(--marca)]" />
        <span>
          Li e aceito os{' '}
          <Link href="/parceiros/termos" target="_blank" className="font-semibold text-marca hover:underline">
            termos do programa de parceiros
          </Link>
          .
        </span>
      </label>
      <Botao type="submit" carregando={pendente} className="self-start">
        Ativar o Indique e ganhe
      </Botao>
    </form>
  )
}
