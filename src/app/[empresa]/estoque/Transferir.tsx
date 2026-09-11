'use client'

// Mandar peça de uma loja para a outra.
//
// Sai daqui como TRANSFERENCIA e entra lá como ENTRADA, na mesma transação,
// com o motivo apontando de onde veio. Antes disto o caminho era corrigir o
// saldo nas duas lojas à mão — e o histórico dizia "ajuste" onde a verdade
// era "foi para o shopping".

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao } from '@/ui/base'
import { transferirAcao } from './acoes'

export function Transferir({
  slug,
  variacaoId,
  deUnidadeId,
  destinos,
  saldo,
}: {
  slug: string
  variacaoId: string
  deUnidadeId: string
  /** As outras lojas que a pessoa alcança. */
  destinos: { id: string; nome: string }[]
  saldo: number
}) {
  const [aberto, setAberto] = useState(false)
  const [para, setPara] = useState(destinos[0]?.id ?? '')
  const [qtd, setQtd] = useState('1')
  const [motivo, setMotivo] = useState('')
  const [recado, setRecado] = useState<{ erro?: string; ok?: string } | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (destinos.length === 0 || saldo <= 0) return null

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-xs font-medium text-marca underline-offset-2 hover:underline"
      >
        transferir
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="number"
          min={0.001}
          max={saldo}
          step="any"
          value={qtd}
          onChange={(e) => setQtd(e.target.value)}
          aria-label="Quantidade a transferir"
          className="numero w-16 rounded border border-borda bg-superficie px-1.5 py-1 text-tinta"
        />
        <span className="text-tinta-3">para</span>
        <select
          value={para}
          onChange={(e) => setPara(e.target.value)}
          aria-label="Loja de destino"
          className="rounded border border-borda bg-superficie px-1.5 py-1 text-tinta"
        >
          {destinos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nome}
            </option>
          ))}
        </select>
      </div>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo (opcional)"
        aria-label="Motivo da transferência"
        className="rounded border border-borda bg-superficie px-1.5 py-1 text-tinta placeholder:text-tinta-3"
      />
      {recado?.erro && <span className="font-medium text-critico">{recado.erro}</span>}
      {recado?.ok && <span className="font-medium text-bom">{recado.ok}</span>}
      <div className="flex gap-1.5">
        <Botao
          tom="secundario"
          carregando={indo}
          disabled={!para || !(Number(qtd) > 0)}
          onClick={() =>
            comecar(async () => {
              const r = await transferirAcao(slug, {
                variacaoId,
                deUnidadeId,
                paraUnidadeId: para,
                quantidade: Number(qtd),
                motivo,
              })
              setRecado(r)
              if (r.ok) {
                router.refresh()
                setTimeout(() => setAberto(false), 1500)
              }
            })
          }
          className="py-1 text-xs"
        >
          Transferir
        </Botao>
        <button type="button" onClick={() => setAberto(false)} className="px-1 text-tinta-3 hover:text-tinta">
          cancelar
        </button>
      </div>
    </div>
  )
}
