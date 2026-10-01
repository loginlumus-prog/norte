'use client'

// As regras do crediário, do lado de quem decide: o parcelamento (em quantas
// vezes, de quanto em quanto) e o atraso (multa, juro, carência, arredondar).
// O atraso também se muda na tela do Crediário (RegraDoAtraso), onde a dona
// olha o vencido — as duas gravam a mesma regra.
//
// Juro é de ATRASO, não de parcelamento — o preço "no crediário" do produto
// já cobra o prazo. A tela diz isso em voz alta porque é o erro mais comum:
// a loja põe 3% aqui achando que é juro por vender parcelado, e o cliente que
// paga em dia nunca vê juro nenhum.

import { useActionState } from 'react'
import { Botao, Campo, Aviso, Marcar } from '@/ui/base'
import { salvarCrediario, type EstadoCrediario } from './acoes'
import { semApagar } from '@/ui/formulario'

export function Crediario({
  empresa,
  inicial,
}: {
  empresa: string
  inicial: { jurosMes: number; maxParcelas: number; diasEntre: number; multaPct: number; carenciaDias: number; arredondar: boolean }
}) {
  const [estado, agir, pendente] = useActionState<EstadoCrediario, FormData>(salvarCrediario, {})

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          rotulo="Juro de atraso, % ao mês"
          name="jurosMes"
          inputMode="decimal"
          defaultValue={String(inicial.jurosMes).replace('.', ',')}
          dica="Só sobre parcela vencida, proporcional aos dias. Quem paga em dia não vê juro."
        />
        <Campo
          rotulo="Parcela em até quantas vezes"
          name="maxParcelas"
          inputMode="numeric"
          type="number"
          min={1}
          max={24}
          defaultValue={String(inicial.maxParcelas)}
          dica="O balcão oferece de 1× até isto."
        />
        <Campo
          rotulo="Dias entre as parcelas"
          name="diasEntre"
          inputMode="numeric"
          type="number"
          min={7}
          max={90}
          defaultValue={String(inicial.diasEntre)}
          dica="E até a primeira. 30 é o comum."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          rotulo="Multa de atraso, %"
          name="multaPct"
          inputMode="decimal"
          defaultValue={String(inicial.multaPct).replace('.', ',')}
          dica="Uma vez por parcela. Teto de 2% (Código de Defesa do Consumidor)."
        />
        <Campo
          rotulo="Carência, em dias"
          name="carenciaDias"
          inputMode="numeric"
          defaultValue={String(inicial.carenciaDias)}
          dica="Atraso até aqui não cobra nada. Zero = conta do dia seguinte ao vencimento."
        />
        <div className="flex items-end">
          <Marcar
            name="arredondar"
            titulo="Arredondar o atraso"
            resumo="Para os 10 centavos de cima: R$ 3,47 vira R$ 3,50."
            defaultChecked={inicial.arredondar}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-tinta-3">
          Parcelar não custa nada ao cliente: o preço &ldquo;no crediário&rdquo; de cada produto é
          quem cobra o prazo. Mudar aqui vale para as vendas daqui para frente.
        </p>
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
