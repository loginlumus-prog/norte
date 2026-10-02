'use client'

// A fábrica separa o pedido da loja e manda.
//
// Cada item já vem com o que FALTA mandar e com o saldo na fábrica ao lado:
// quem separa vê na hora o que não vai dar ("pediu 60, tem 48") e troca o
// número. O lote é opcional — em branco, vai o mais antigo que ainda tem
// (o que vence primeiro sai primeiro).
//
// Mandar menos que o pedido deixa o pedido ABERTO esperando o resto — a não
// ser que quem separa marque que o resto não vai.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Marcar, cx } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { CampoDoPin } from '@/ui/Assinar'
import { quantidade } from '@/ui/texto'
import type { PedidoNaTela } from '@/servidor/fabrica'
import { cancelarPedidoAcao, enviarPedidoAcao } from './acoes'
import { LEGIVEL, ler, paraCampo } from './formato'

export function MandarPedido({ slug, pedido: p }: { slug: string; pedido: PedidoNaTela }) {
  // O que ainda falta de cada item (o pedido menos o que já foi).
  const resta = (i: PedidoNaTela['itens'][number]) => Math.max(0, Math.round((i.pedida - (i.enviada ?? 0)) * 1000) / 1000)
  const jaFoiAlgo = p.itens.some((i) => (i.enviada ?? 0) > 0)
  const [mandar, setMandar] = useState<Record<string, string>>(() => Object.fromEntries(p.itens.map((i) => [i.id, paraCampo(resta(i))])))
  const [lote, setLote] = useState<Record<string, string>>({})
  const [encerrar, setEncerrar] = useState(false)
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const vaiFaltar = p.itens.some((i) => {
    const v = ler(mandar[i.id] ?? '') ?? 0
    return !Number.isNaN(v) && v < resta(i)
  })

  function enviar() {
    const itens = p.itens.map((i) => ({ itemId: i.id, enviada: ler(mandar[i.id] ?? '') ?? 0, lote: (lote[i.id] ?? '').trim() || null }))
    if (itens.some((i) => Number.isNaN(i.enviada))) return setErro(LEGIVEL)
    setErro(null)
    comecar(async () => {
      const r = await enviarPedidoAcao(slug, p.id, { itens, encerrar: vaiFaltar && encerrar, pin: pin || null })
      setPin('')
      if (r.precisaPin) setPedePin(true)
      if (r.erro) setErro(r.erro)
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda">
        {p.itens.map((i) => {
          // Vermelho quando o que VAI sair passa do que a fábrica tem — é o
          // número digitado que conta, não o pedido.
          const vai = ler(mandar[i.id] ?? '') ?? 0
          const falta = !Number.isNaN(vai) && vai > i.saldoNaFabrica
          return (
            <li key={i.id} className="grid grid-cols-2 items-end gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_9rem]">
              <span className="col-span-2 flex min-w-0 flex-col sm:col-span-1">
                <span className="truncate text-sm font-medium text-tinta">{i.nome}</span>
                <span className="text-xs text-tinta-3">
                  pediu <b className="text-tinta">{quantidade(i.pedida, i.medida)}</b>
                  {(i.enviada ?? 0) > 0 && <> · já foram {quantidade(i.enviada ?? 0, i.medida)}</>} ·{' '}
                  <span className={cx(falta && 'font-semibold text-critico')}>a fábrica tem {quantidade(i.saldoNaFabrica, i.medida)}</span>
                </span>
              </span>
              <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-tinta">
                Mandar
                <input
                  inputMode="decimal"
                  value={mandar[i.id] ?? ''}
                  onChange={(ev) => {
                    const v = ev.currentTarget.value
                    setMandar((m) => ({ ...m, [i.id]: v }))
                  }}
                  aria-label={`Quanto mandar de ${i.nome}`}
                  className="numero w-full min-w-0 rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-tinta sm:col-span-2">
                Lote (opcional)
                <input
                  value={lote[i.id] ?? ''}
                  maxLength={40}
                  placeholder="o da última produção"
                  onChange={(ev) => {
                    const v = ev.currentTarget.value
                    setLote((m) => ({ ...m, [i.id]: v }))
                  }}
                  aria-label={`Lote de ${i.nome}`}
                  className="w-full min-w-0 rounded-norte border border-borda bg-superficie px-2 py-1.5 font-mono text-sm text-tinta placeholder:font-sans placeholder:text-tinta-3"
                />
              </label>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-tinta-3">
        Zero num item = não vai agora. Ao mandar, sai do estoque da fábrica e entra no da loja. Mandou menos que o pedido? O pedido
        continua aberto esperando o resto; a loja confere quando tudo tiver ido.
      </p>
      {vaiFaltar && (
        <Marcar
          name="encerrar"
          checked={encerrar}
          onChange={(ev) => setEncerrar(ev.currentTarget.checked)}
          titulo="O resto não vai"
          resumo="Fecha o pedido com o que foi agora: a loja já pode conferir. Sem marcar, ele continua aberto para a próxima remessa."
        />
      )}
      {pedePin && (
        <div className="max-w-xs">
          <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={enviar} />
        </div>
      )}
      {erro && <Aviso nivel="critico">{erro}</Aviso>}
      <div className="flex flex-wrap justify-end gap-2">
        {/* Parte já foi: não se cancela — fecha-se o envio ("o resto não vai"). */}
        {!jaFoiAlgo && (
          <Confirmar pergunta="Cancelar o pedido da loja?" sim="Sim, cancelar" aoConfirmar={async () => {
            const r = await cancelarPedidoAcao(slug, p.id)
            if (r.ok) router.refresh()
            return r
          }}>
            Cancelar pedido
          </Confirmar>
        )}
        <Botao tom="confirmar" carregando={indo} onClick={enviar}>
          {indo ? 'Mandando…' : 'Mandar para a loja'}
        </Botao>
      </div>
    </div>
  )
}
