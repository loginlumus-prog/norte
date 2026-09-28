'use client'

import { useActionState } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { trocarNomeAcao, type EstadoNome } from './acoes'

export function TrocarNome({ slug, nome }: { slug: string; nome: string }) {
  const [estado, agir, pendente] = useActionState<EstadoNome, FormData>(trocarNomeAcao.bind(null, slug), {})

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex max-w-md flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
      <Campo
        rotulo="Nome"
        name="nome"
        autoComplete="name"
        defaultValue={estado.nome ?? nome}
        key={estado.nome ?? nome}
        maxLength={80}
        required
      />
      <div>
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando…' : 'Salvar o nome'}
        </Botao>
      </div>
    </form>
  )
}
