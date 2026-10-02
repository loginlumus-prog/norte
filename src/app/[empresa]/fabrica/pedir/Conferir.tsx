'use client'

// A loja confere o que chegou da fábrica.
//
// O enviado já entrou no estoque da loja no momento do envio — conferir é
// dizer o que veio DIFERENTE. Cada item vem preenchido com o enviado; quem
// confere troca o que chegou a menos (a diferença sai como perda) ou a mais
// (a diferença entra na loja e sai da fábrica), com o número do pedido.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { CampoDoPin } from '@/ui/Assinar'
import { quantidade } from '@/ui/texto'
import type { PedidoNaTela } from '@/servidor/fabrica'
import { cancelarPedidoAcao, receberPedidoAcao, type Recado } from '../acoes'
import { LEGIVEL, ler, paraCampo } from '../formato'

export function Conferir({ slug, pedido: p }: { slug: string; pedido: PedidoNaTela }) {
  const mandados = p.itens.filter((i) => (i.enviada ?? 0) > 0)
  const [aberto, setAberto] = useState(false)
  const [chegou, setChegou] = useState<Record<string, string>>(() => Object.fromEntries(mandados.map((i) => [i.id, paraCampo(i.enviada)])))
  const [recado, setRecado] = useState<Recado | null>(null)
  // Diferença na conferência é baixa: pede o PIN quando a empresa assina as
  // exceções (ou de quem confere porque a empresa deixou).
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!aberto) {
    return (
      <Botao tom="confirmar" className="w-fit" onClick={() => setAberto(true)}>
        Conferir o que chegou
      </Botao>
    )
  }

  function conferir() {
    const itens = mandados.map((i) => ({ itemId: i.id, recebida: ler(chegou[i.id] ?? '') ?? 0 }))
    if (itens.some((i) => Number.isNaN(i.recebida))) return setRecado({ erro: LEGIVEL })
    setRecado(null)
    comecar(async () => {
      const r = await receberPedidoAcao(slug, p.id, { itens, pin: pin || null })
      setPin('')
      if (r.precisaPin) setPedePin(true)
      setRecado(r)
      if (r.ok) router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda">
        {mandados.map((i) => (
          <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3 p-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-tinta">{i.nome}</span>
              <span className="text-xs text-tinta-3">
                a fábrica mandou {quantidade(i.enviada ?? 0, i.medida)}
                {i.lote && <> · lote <span className="font-mono">{i.lote}</span></>}
              </span>
            </span>
            <label className="flex flex-col gap-1 text-xs font-medium text-tinta">
              Chegou
              <input
                inputMode="decimal"
                value={chegou[i.id] ?? ''}
                onChange={(ev) => {
                  const v = ev.currentTarget.value
                  setChegou((m) => ({ ...m, [i.id]: v }))
                }}
                aria-label={`Quanto chegou de ${i.nome}`}
                className="numero w-full rounded-norte border border-borda bg-superficie px-2 py-1.5 text-right text-sm text-tinta"
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-tinta-3">
        Veio diferente? Ponha o que chegou. A menos: a diferença sai do estoque da loja como perda. A mais: a diferença entra
        na loja e sai da fábrica. As duas com o número do pedido.
      </p>
      {pedePin && (
        <div className="max-w-xs">
          <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={conferir} />
        </div>
      )}
      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
      <div className="flex justify-end gap-2">
        <Botao tom="discreto" onClick={() => setAberto(false)}>
          Voltar
        </Botao>
        <Botao tom="confirmar" carregando={indo} onClick={conferir}>
          Está conferido
        </Botao>
      </div>
    </div>
  )
}

export function CancelarPedido({ slug, pedidoId }: { slug: string; pedidoId: string }) {
  const router = useRouter()
  return (
    <Confirmar
      pergunta="Cancelar o pedido?"
      sim="Sim, cancelar"
      aoConfirmar={async () => {
        const r = await cancelarPedidoAcao(slug, pedidoId)
        if (r.ok) router.refresh()
        return r
      }}
    >
      Cancelar pedido
    </Confirmar>
  )
}
