'use client'

import { useActionState } from 'react'
import { Botao, Marcar, Aviso } from '@/ui/base'
import { MODULOS, TODOS } from '@/servidor/modulos'
import { salvarModulos, type EstadoComeco } from '../comecar/acoes'

export function Modulos({ empresa, ligados }: { empresa: string; ligados: string[] }) {
  const [estado, agir, pendente] = useActionState<EstadoComeco, FormData>(salvarModulos, {})

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <div className="grid gap-2 sm:grid-cols-2">
        {TODOS.map((m) => (
          <Marcar
            key={m}
            name={`modulo_${m}`}
            titulo={MODULOS[m].titulo}
            resumo={MODULOS[m].resumo}
            defaultChecked={ligados.includes(m)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-tinta-3">
          Desligar não apaga nada: os dados continuam guardados, só somem da tela.
        </p>
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
