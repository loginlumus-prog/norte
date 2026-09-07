'use client'

// Corrigir o saldo de um item pelo que foi CONTADO na prateleira.
//
// A pessoa digita o que contou, não a diferença. Pedir a diferença obrigaria
// quem está com a peça na mão a fazer a subtração de cabeça — e é exatamente
// aí que o erro entra, porque quem conta está em pé, no meio da loja, com
// pressa.
//
// O MOTIVO É OBRIGATÓRIO. Sem ele, seis meses depois ninguém consegue
// responder por que o saldo mudou, e o histórico deixa de servir para o que
// ele existe: dizer se o estoque some por quebra, por roubo ou por erro de
// digitação no balcão.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, cx } from '@/ui/base'
import { contar } from './acoes'

export function Corrigir({
  slug,
  variacaoId,
  unidadeId,
  saldo,
}: {
  slug: string
  variacaoId: string
  unidadeId: string
  saldo: number
}) {
  const [aberto, setAberto] = useState(false)
  const [contado, setContado] = useState(String(saldo))
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-xs font-medium text-tinta-3 underline-offset-2 hover:text-marca hover:underline"
      >
        corrigir
      </button>
    )
  }

  const diferenca = Number(contado) - saldo

  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <input
        type="number"
        step="any"
        value={contado}
        autoFocus
        onChange={(e) => setContado(e.currentTarget.value)}
        aria-label="Quantas você contou"
        className="numero w-20 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta"
      />
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.currentTarget.value)}
        placeholder="Motivo"
        aria-label="Motivo da correção"
        className="w-32 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta placeholder:text-tinta-3"
      />
      {/* A diferença aparece calculada: a pessoa digita o que contou e vê o
          que isso significa, sem fazer conta. */}
      {diferenca !== 0 && Number.isFinite(diferenca) && (
        <span
          className={cx(
            'numero text-xs font-semibold',
            diferenca > 0 ? 'text-bom' : 'text-critico',
          )}
        >
          {diferenca > 0 ? '+' : ''}
          {diferenca}
        </span>
      )}
      <Botao
        tom="confirmar"
        className="px-2 py-1 text-xs"
        carregando={indo}
        onClick={() =>
          comecar(async () => {
            setErro(null)
            const r = await contar(slug, variacaoId, unidadeId, Number(contado), motivo)
            if (r.erro) {
              setErro(r.erro)
              return
            }
            setAberto(false)
            setMotivo('')
            router.refresh()
          })
        }
      >
        Corrigir
      </Botao>
      <button
        type="button"
        onClick={() => {
          setAberto(false)
          setErro(null)
        }}
        className="text-xs text-tinta-3 hover:text-tinta"
      >
        cancelar
      </button>
      {erro && <span className="w-full text-right text-xs font-medium text-critico">{erro}</span>}
    </span>
  )
}
