'use client'

// A regra do atraso, na tela do Crediário: multa, juro, carência e
// arredondar. Fica aqui (e não só em Configurações) porque é onde a dona olha
// o vencido e decide "vou dar três dias de carência".

import { useActionState } from 'react'
import { Aviso, Botao, Campo, Marcar } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { salvarRegraAcao, type EstadoRegra } from './acoes'
import type { ConfigCrediario } from '@/servidor/crediario'

const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export function RegraDoAtraso({ slug, inicial }: { slug: string; inicial: ConfigCrediario }) {
  const [estado, agir, indo] = useActionState<EstadoRegra, FormData>(salvarRegraAcao.bind(null, slug), {})
  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex max-w-2xl flex-col gap-4 rounded-norte border border-borda bg-superficie p-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          rotulo="Multa (%)"
          name="multaPct"
          inputMode="decimal"
          defaultValue={numero(inicial.multaPct)}
          dica="Uma vez por parcela. Teto de 2% (CDC)."
        />
        <Campo
          rotulo="Juro ao mês (%)"
          name="jurosMes"
          inputMode="decimal"
          defaultValue={numero(inicial.jurosMes)}
          dica="Proporcional aos dias de atraso."
        />
        <Campo
          rotulo="Carência (dias)"
          name="carenciaDias"
          inputMode="numeric"
          defaultValue={String(inicial.carenciaDias)}
          dica="Atraso até aqui não cobra nada."
        />
      </div>
      <Marcar
        name="arredondar"
        titulo="Arredondar o atraso para os 10 centavos de cima"
        resumo="R$ 3,47 de juro vira R$ 3,50 — facilita o troco."
        defaultChecked={inicial.arredondar}
      />
      <p className="text-xs text-tinta-2">
        Quem recebe no balcão cobra a conta da regra. Cobrar menos (perdoar o atraso, dar desconto) é com quem negocia o
        crediário — a gerente ou a dona, direto ou com o PIN dela.
      </p>
      <div>
        <Botao type="submit" carregando={indo}>
          Salvar a regra
        </Botao>
      </div>
    </form>
  )
}
