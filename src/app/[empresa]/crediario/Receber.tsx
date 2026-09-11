'use client'

// Receber uma parcela, na própria linha.
//
// O formulário abre com o valor certo já preenchido: o que resta mais o juro
// de atraso de hoje. Os dois campos ficam editáveis porque cobrança é
// conversa — "só tenho cinquenta", "tira o juro dessa vez" — e o sistema
// registra o que foi combinado, não o que a fórmula queria.

import { useActionState, useState } from 'react'
import { Botao, Aviso, cx } from '@/ui/base'
import { receberAcao, type EstadoRecebimento } from './acoes'

const FORMAS = [
  { chave: 'DINHEIRO', titulo: 'Dinheiro' },
  { chave: 'PIX', titulo: 'Pix' },
  { chave: 'DEBITO', titulo: 'Débito' },
  { chave: 'CREDITO', titulo: 'Crédito' },
  { chave: 'TRANSFERENCIA', titulo: 'Transferência' },
]

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function Receber({
  slug,
  parcelaId,
  resta,
  jurosHoje,
  diasAtraso,
}: {
  slug: string
  parcelaId: string
  resta: number
  jurosHoje: number
  diasAtraso: number
}) {
  const [aberto, setAberto] = useState(false)
  const [juros, setJuros] = useState(jurosHoje.toFixed(2))
  const [valor, setValor] = useState((resta + jurosHoje).toFixed(2))
  const [estado, agir, pendente] = useActionState<EstadoRecebimento, FormData>(receberAcao, {})

  if (estado.ok) return <span className="text-xs font-semibold text-bom">{estado.ok}</span>

  if (!aberto) {
    return (
      <Botao tom="confirmar" onClick={() => setAberto(true)} className="py-1 text-xs">
        Receber
      </Botao>
    )
  }

  const j = Number(juros.replace(',', '.')) || 0

  return (
    <form action={agir} className="flex min-w-[16rem] flex-col gap-2 rounded-norte border border-borda bg-superficie-2 p-2 text-xs">
      <input type="hidden" name="empresa" value={slug} />
      <input type="hidden" name="parcela" value={parcelaId} />

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-tinta-2">
          Juros de atraso
          <input
            name="juros"
            value={juros}
            onChange={(e) => {
              setJuros(e.target.value)
              const nj = Number(e.target.value.replace(',', '.')) || 0
              setValor((resta + nj).toFixed(2))
            }}
            inputMode="decimal"
            className="numero rounded border border-borda bg-superficie px-2 py-1 text-sm text-tinta"
          />
          <span className={cx('text-[11px]', diasAtraso > 0 ? 'text-critico' : 'text-tinta-3')}>
            {diasAtraso > 0 ? `${diasAtraso} dia${diasAtraso === 1 ? '' : 's'} de atraso` : 'em dia'}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-tinta-2">
          Recebendo agora
          <input
            name="valor"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            autoFocus
            onFocus={(e) => e.target.select()}
            className="numero rounded border border-borda bg-superficie px-2 py-1 text-sm font-semibold text-tinta"
          />
          <span className="text-[11px] text-tinta-3">
            resta {brl(resta)}
            {j > 0 && ` + ${brl(j)} de juros`}
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-tinta-2">
        Como recebeu
        <select name="forma" defaultValue="DINHEIRO" className="rounded border border-borda bg-superficie px-2 py-1 text-sm text-tinta">
          {FORMAS.map((f) => (
            <option key={f.chave} value={f.chave}>
              {f.titulo}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <Botao type="submit" tom="confirmar" carregando={pendente} className="py-1 text-xs">
          {pendente ? 'Registrando...' : 'Confirmar'}
        </Botao>
        <Botao type="button" tom="discreto" onClick={() => setAberto(false)} className="py-1 text-xs">
          Cancelar
        </Botao>
      </div>
    </form>
  )
}
