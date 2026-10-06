'use client'

// "Preço em cada loja": a loja que fica numa praça mais cara (ou mais barata)
// tem o preço dela. Sem preço próprio, a loja cobra o geral — e a linha diz
// isso, com o valor, para ninguém achar que está sem preço.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, cx } from '@/ui/base'
import { precoNaLojaAcao } from './acoes'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const noCampo = (v: number | null) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export type LojaComPreco = {
  id: string
  nome: string
  proprio: { vista: number; cartao: number | null; crediario: number | null } | null
  podeMudar: boolean
}

const CAMPO =
  'h-9 w-24 rounded-norte border border-borda bg-superficie px-2 text-right text-sm text-tinta placeholder:text-tinta-3 focus:border-marca focus:outline-none'

function Linha({ slug, produtoId, loja, geral, porKg }: { slug: string; produtoId: string; loja: LojaComPreco; geral: number; porKg: boolean }) {
  const [editando, setEditando] = useState(false)
  const [vista, setVista] = useState(noCampo(loja.proprio?.vista ?? null))
  const [cartao, setCartao] = useState(noCampo(loja.proprio?.cartao ?? null))
  const [crediario, setCrediario] = useState(noCampo(loja.proprio?.crediario ?? null))
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const sufixo = porKg ? ' /kg' : ''

  const salvar = (tirar = false) =>
    comecar(async () => {
      setErro(null)
      const r = await precoNaLojaAcao(slug, produtoId, loja.id, tirar ? null : { vista, cartao, crediario })
      if (r.erro) return setErro(r.erro)
      setEditando(false)
      if (tirar) {
        setVista('')
        setCartao('')
        setCrediario('')
      }
      router.refresh()
    })

  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-tinta">{loja.nome}</span>
        <span className="flex items-center gap-3 text-sm">
          {loja.proprio ? (
            <span className="numero font-semibold text-tinta">
              {brl(loja.proprio.vista)}
              {sufixo} <span className="text-xs font-normal text-marca">preço desta loja</span>
            </span>
          ) : (
            <span className="numero text-tinta-2">
              {brl(geral)}
              {sufixo} <span className="text-xs text-tinta-3">o geral</span>
            </span>
          )}
          {loja.podeMudar && !editando && (
            <button type="button" onClick={() => setEditando(true)} className="text-xs font-semibold text-marca underline-offset-2 hover:underline">
              {loja.proprio ? 'mudar' : 'pôr preço próprio'}
            </button>
          )}
        </span>
      </div>
      {editando && (
        <div className="flex flex-col gap-2 rounded-norte bg-superficie-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            {(
              [
                ['À vista', vista, setVista, 'obrigatório'],
                ['Cartão', cartao, setCartao, 'igual'],
                ['Crediário', crediario, setCrediario, 'igual'],
              ] as const
            ).map(([rotulo, valor, mudar, dica]) => (
              <label key={rotulo} className="flex flex-col gap-1 text-xs font-semibold text-tinta-2">
                {rotulo}
                <input
                  value={valor}
                  onChange={(e) => mudar(e.target.value)}
                  inputMode="decimal"
                  placeholder={dica === 'igual' ? 'igual à vista' : '0,00'}
                  aria-label={`Preço ${rotulo.toLowerCase()} em ${loja.nome}`}
                  className={cx(CAMPO, dica === 'igual' && 'w-28')}
                />
              </label>
            ))}
            <Botao type="button" tom="principal" carregando={indo} disabled={!vista.trim()} onClick={() => salvar()} className="h-9 py-0">
              Salvar
            </Botao>
            <Botao type="button" tom="discreto" onClick={() => setEditando(false)} className="h-9 py-0">
              Cancelar
            </Botao>
          </div>
          {loja.proprio && (
            <button type="button" disabled={indo} onClick={() => salvar(true)} className="self-start text-xs font-semibold text-tinta-2 underline-offset-2 hover:text-critico hover:underline">
              Voltar a usar o preço geral ({brl(geral)})
            </button>
          )}
          <p className="text-xs text-tinta-3">
            A diferença de cada item da grade (o copo maior, a casquinha recheada) soma por cima, igual em toda loja.
          </p>
          {erro && <p className="text-xs text-critico">{erro}</p>}
        </div>
      )}
    </li>
  )
}

export function PrecoPorLoja({
  slug,
  produtoId,
  geral,
  porKg,
  lojas,
}: {
  slug: string
  produtoId: string
  geral: number
  porKg: boolean
  lojas: LojaComPreco[]
}) {
  return (
    <ul className="flex flex-col divide-y divide-borda-suave">
      {lojas.map((l) => (
        <Linha key={l.id} slug={slug} produtoId={produtoId} loja={l} geral={geral} porKg={porKg} />
      ))}
    </ul>
  )
}
