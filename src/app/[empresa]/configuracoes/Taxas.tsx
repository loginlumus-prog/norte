'use client'

// As taxas da maquininha e do Pix, do lado de quem paga por elas.
//
// Quatro números, e o DRE passa a descontar sozinho, venda a venda. A tela
// diz o quanto isso deu no último mês em reais, porque "3,2%" não assusta e
// "R$ 412 no mês passado" assusta na medida certa.

import { useActionState } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { salvarTaxasAcao, type EstadoTaxas } from './acoes'

export type LinhaDeTaxa = {
  forma: string
  parcelas: number
  rotulo: string
  dica: string
  percentual: number
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function Taxas({
  empresa,
  linhas,
  taxasNoMes,
}: {
  empresa: string
  linhas: LinhaDeTaxa[]
  /** Quanto as taxas de hoje deram no mês corrente, já calculado. */
  taxasNoMes: number
}) {
  const [estado, agir, pendente] = useActionState<EstadoTaxas, FormData>(salvarTaxasAcao, {})

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid gap-4 sm:grid-cols-2">
        {linhas.map((l) => (
          <Campo
            key={`${l.forma}-${l.parcelas}`}
            rotulo={`${l.rotulo} — % por venda`}
            name={`taxa-${l.forma}-${l.parcelas}`}
            inputMode="decimal"
            defaultValue={l.percentual ? String(l.percentual).replace('.', ',') : ''}
            placeholder="0"
            dica={l.dica}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-tinta-3">
          Com as taxas de hoje, o mês corrente já custou <b className="text-tinta-2">{brl(taxasNoMes)}</b> em
          maquininha e Pix. O resultado do mês desconta isso sozinho. Se você lança a taxa à mão pelo
          extrato, deixe tudo em zero — senão conta duas vezes.
        </p>
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
