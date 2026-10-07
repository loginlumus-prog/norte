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
import { CampoDoPin } from '@/ui/Assinar'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
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
  // Quem transfere porque a empresa deixou assina com o PIN (o servidor pede).
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (destinos.length === 0 || saldo <= 0) return null

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Mandar peças desta loja para outra"
        className={classeDaAcao({ jeito: 'pilula' })}
      >
        <IconeDaAcao icone="trocar" tamanho={15} />
        Transferir
      </button>
    )
  }

  return (
    <div className="flex w-full flex-col gap-1.5 text-xs">
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
      {pedePin && <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} />}
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
                pin: pin || null,
              })
              setPin('')
              setRecado(r)
              if (r.precisaPin) setPedePin(true)
              if (r.ok) {
                setPedePin(false)
                router.refresh()
                setTimeout(() => setAberto(false), 1500)
              }
            })
          }
          className="py-1 text-xs"
        >
          Transferir
        </Botao>
        <button type="button" onClick={() => setAberto(false)} className={classeDaAcao()} aria-label="Cancelar">
          <IconeDaAcao icone="fechar" />
          <DicaDaAcao>Cancelar</DicaDaAcao>
        </button>
      </div>
    </div>
  )
}
