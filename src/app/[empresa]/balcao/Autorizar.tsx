'use client'

// As duas perguntas que a venda faz antes de fechar, nas duas caras do
// balcão: "quem autoriza?" (o PIN da gerente) e "vende assim mesmo?" (a peça
// que o sistema diz que acabou).
//
// ── o PIN ────────────────────────────────────────────────────
// Abre quando o SERVIDOR diz que a venda passou da regra (desconto acima do
// teto, item avulso) — nunca adivinhado pela tela. A gerente digita o dela
// ali mesmo, a venda segue no nome de quem vendeu e o livro guarda quem
// autorizou. O número fica só neste campo, vai numa chamada e some: não entra
// no que o balcão guarda no aparelho (guardar.ts), nem volta preenchido.

import { useEffect, useRef, useState } from 'react'
import { Aviso, Botao } from '@/ui/base'
import { palavra } from '@/ui/texto'
import type { Venda } from './useVenda'

export function PedirPin({ v }: { v: Venda }) {
  const pedido = v.pedidoDePin
  const [pin, setPin] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!pedido) return
    setPin('')
    // Depois de pintar: o foco num campo que ainda não existe se perde.
    const t = setTimeout(() => campo.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [pedido])

  if (!pedido) return null

  function autorizar() {
    const p = pin.replace(/\D/g, '')
    if (p.length < 4) return
    setPin('')
    v.autorizar(p)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-titulo"
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-borda bg-superficie p-5 shadow-norte-alta"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            v.setPedidoDePin(null)
          }
        }}
      >
        <div className="flex flex-col gap-1">
          <h2 id="pin-titulo" className="text-lg font-bold text-tinta">
            Precisa de autorização
          </h2>
          <p className="text-sm text-tinta-2">{pedido.motivo}</p>
          <p className="text-sm text-tinta-2">
            Quem pode autorizar digita o PIN pessoal aqui. A venda continua no nome de quem vendeu, e fica
            registrado quem autorizou.
          </p>
        </div>

        {pedido.erro && <Aviso nivel="critico">{pedido.erro}</Aviso>}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-tinta">PIN de quem autoriza</span>
          <input
            ref={campo}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                autorizar()
              }
            }}
            aria-describedby="pin-dica"
            className="numero h-14 rounded-xl border-2 border-borda bg-superficie px-4 text-center text-2xl font-bold tracking-[0.5em] text-tinta focus:border-marca focus:outline-none"
          />
          <span id="pin-dica" className="text-xs text-tinta-3">
            De 4 a 6 números. Quem não tem PIN cria o seu em Minha conta.
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Botao tom="secundario" onClick={() => v.setPedidoDePin(null)} className="min-h-12 rounded-xl">
            Voltar
          </Botao>
          <Botao
            tom="confirmar"
            onClick={autorizar}
            carregando={v.indo}
            disabled={pin.length < 4}
            className="min-h-12 rounded-xl"
          >
            Autorizar e concluir
          </Botao>
        </div>
      </div>
    </div>
  )
}

/**
 * "O sistema diz que acabou — vende assim mesmo?" Só na loja que vende sem
 * estoque (Configurações): a peça está na mão da cliente, e o sistema é que
 * está errado. Uma pergunta, com os nomes, logo acima do concluir.
 */
export function PerguntaSemEstoque({ v }: { v: Venda }) {
  const itens = v.perguntaSemEstoque
  if (!itens) return null
  return (
    <Aviso nivel="atencao">
      <span className="flex flex-col gap-2">
        <span>
          O sistema diz que acabou: <b className="font-semibold">{itens.join(', ')}</b>. Vende assim mesmo? O
          estoque fica negativo e {palavra(itens.length, 'a peça vai', 'as peças vão')} para a lista
          “Vendido sem estoque — conferir”, em Estoque.
        </span>
        <span className="flex flex-wrap gap-2">
          <Botao tom="confirmar" onClick={v.venderSemEstoque} carregando={v.indo} className="min-h-10 rounded-lg text-sm">
            Vender assim mesmo
          </Botao>
          <Botao tom="secundario" onClick={() => v.setPerguntaSemEstoque(null)} className="min-h-10 rounded-lg text-sm">
            Voltar
          </Botao>
        </span>
      </span>
    </Aviso>
  )
}
