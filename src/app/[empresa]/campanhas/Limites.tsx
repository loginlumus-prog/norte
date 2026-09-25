'use client'

// Os freios da empresa: quantas mensagens de campanha por número por dia,
// quantas no total, e o intervalo mínimo entre duas para a mesma pessoa.
// Os limites de cada campo são os mesmos do servidor (freios.ts).

import { useActionState } from 'react'
import { Aviso, Botao, Campo } from '@/ui/base'
import { ajustesAcao, type Resposta } from './acoes'

export function Limites({
  slug,
  porContatoDia,
  porEmpresaDia,
  intervaloSeg,
  hoje,
}: {
  slug: string
  porContatoDia: number
  porEmpresaDia: number
  intervaloSeg: number
  hoje: number
}) {
  const [estado, agir, pendente] = useActionState<Resposta, FormData>(ajustesAcao.bind(null, slug), {})
  return (
    <form action={agir} className="flex flex-col gap-3">
      <p className="text-sm text-tinta-2">
        Número que manda demais é denunciado, e o WhatsApp bloqueia o número da loja. Chegou no limite, a campanha
        daquela pessoa para. Hoje já saíram <b className="text-tinta">{hoje}</b> mensagens de campanha.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo
          rotulo="Por pessoa, por dia"
          name="porContatoDia"
          type="number"
          min={1}
          max={50}
          defaultValue={porContatoDia}
          dica="De 1 a 50."
        />
        <Campo
          rotulo="Da empresa, por dia"
          name="porEmpresaDia"
          type="number"
          min={10}
          max={20000}
          defaultValue={porEmpresaDia}
          dica="Somando todo mundo."
        />
        <Campo
          rotulo="Segundos entre duas mensagens"
          name="intervaloSeg"
          type="number"
          min={1}
          max={10}
          defaultValue={intervaloSeg}
          dica="Para a mesma pessoa."
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Botao type="submit" tom="secundario" carregando={pendente}>
          Salvar limites
        </Botao>
        {estado.ok && <span className="text-sm text-bom">{estado.ok}</span>}
      </div>
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
    </form>
  )
}
