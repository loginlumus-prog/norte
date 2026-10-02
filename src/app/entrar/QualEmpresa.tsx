'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FORMATO_ENDERECO } from '@/servidor/enderecos'

/** Onde o [empresa]/entrar guarda o último endereço usado neste aparelho. */
export const ULTIMA_EMPRESA = 'norte:ultima-empresa'

const CAMPO =
  'h-12 w-full min-w-0 bg-transparent px-2 text-[15px] text-tinta placeholder:text-tinta-3 focus:outline-none'

/** Aceita o endereço puro, "gestornorte.com/loja" ou o link inteiro colado. */
function limpar(texto: string): string {
  const t = texto.trim().toLowerCase()
  const semDominio = t.replace(/^https?:\/\//, '').replace(/^[^/]*\.[^/]*\//, '')
  return semDominio.split(/[/?#]/)[0] ?? ''
}

export function QualEmpresa({ dominio }: { dominio: string }) {
  const router = useRouter()
  const [valor, setValor] = useState('')
  const [ultima, setUltima] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    try {
      const u = localStorage.getItem(ULTIMA_EMPRESA)
      if (u && FORMATO_ENDERECO.test(u)) setUltima(u)
    } catch {
      // Navegador sem armazenamento: só não mostra o atalho.
    }
  }, [])

  function ir(endereco: string) {
    const e = limpar(endereco)
    if (e.length < 3 || !FORMATO_ENDERECO.test(e)) {
      setErro('Confira o endereço: só letras minúsculas, números e hífen — por exemplo, loja-da-praca.')
      return
    }
    router.push(`/${e}/entrar`)
  }

  return (
    <div className="flex flex-col gap-4">
      {ultima ? (
        <button
          type="button"
          onClick={() => ir(ultima)}
          className="botao-marca flex h-12 items-center justify-center rounded-xl px-5 text-[15px] font-semibold text-marca-tinta"
        >
          Continuar em {ultima}
        </button>
      ) : null}
      <form
        onSubmit={(ev) => {
          ev.preventDefault()
          ir(valor)
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        <label htmlFor="endereco-empresa" className="text-sm font-semibold text-tinta">
          {ultima ? 'Ou outra empresa' : 'Endereço da empresa'}
        </label>
        <div className="flex items-center rounded-xl border border-borda bg-superficie pl-4 transition-shadow focus-within:border-marca focus-within:ring-4 focus-within:ring-marca/15">
          <span className="shrink-0 text-[15px] text-tinta-3">{dominio}/</span>
          <input
            id="endereco-empresa"
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              setErro('')
            }}
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="sua-empresa"
            className={CAMPO}
            aria-invalid={!!erro}
            aria-describedby={erro ? 'endereco-erro' : undefined}
          />
        </div>
        {erro ? (
          <p id="endereco-erro" className="text-sm text-critico">
            {erro}
          </p>
        ) : null}
        <button
          type="submit"
          className={`${ultima ? 'border border-borda text-tinta hover:bg-fundo' : 'botao-marca text-marca-tinta'} h-12 rounded-xl px-5 text-[15px] font-semibold`}
        >
          Ir para o login
        </button>
      </form>
    </div>
  )
}
