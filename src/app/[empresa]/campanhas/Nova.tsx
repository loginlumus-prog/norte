'use client'

// Criar é dar um nome. O resto é no editor, para onde a ação leva direto.

import { useActionState } from 'react'
import { Aviso, Botao, Campo } from '@/ui/base'
import { criarAcao, type Resposta } from './acoes'

export function Nova({ slug }: { slug: string }) {
  const [estado, agir, pendente] = useActionState<Resposta, FormData>(criarAcao.bind(null, slug), {})
  return (
    <form action={agir} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Campo rotulo="Nome da campanha" name="nome" required maxLength={80} placeholder="Ex.: Catálogo de verão" />
      </div>
      <Botao type="submit" carregando={pendente}>
        Criar e desenhar
      </Botao>
      {estado.erro && (
        <div className="sm:basis-full">
          <Aviso nivel="critico">{estado.erro}</Aviso>
        </div>
      )}
    </form>
  )
}
