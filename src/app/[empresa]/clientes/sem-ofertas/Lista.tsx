'use client'

// Os dois botões da lista de quem não recebe ofertas. A permissão e a regra
// ("PARAR só sai com VOLTAR") são conferidas no servidor — ver
// src/servidor/ofertas.ts.

import { useActionState } from 'react'
import { Aviso, Botao, Campo } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { anotarNumero, tirarNumero, type EstadoSemOfertas } from '../acoes'

export function AnotarNumero({ slug }: { slug: string }) {
  const [estado, agir, pendente] = useActionState<EstadoSemOfertas, FormData>(anotarNumero.bind(null, slug), {})
  return (
    <form action={agir} className="flex flex-col gap-3">
      <p className="text-sm text-tinta-2">
        A pessoa pediu por telefone, no balcão ou com outras palavras? Pedido de saída vale por qualquer caminho — ela
        não precisa acertar a palavra.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56">
          <Campo rotulo="WhatsApp" name="telefone" inputMode="tel" placeholder="(71) 99999-0000" required />
        </div>
        <Botao type="submit" carregando={pendente}>
          Não mandar ofertas
        </Botao>
      </div>
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
    </form>
  )
}

// Tirar da lista volta a permitir oferta para esse número: é o lado da LGPD
// que não pode sair por um toque sem querer. Pergunta antes.
export function TirarNumero({ slug, id }: { slug: string; id: string }) {
  return (
    <Confirmar
      pergunta="Volta a poder receber ofertas. Tirar?"
      sim="Sim, tirar"
      title="A loja anotou por engano? Tira da lista."
      aoConfirmar={() => tirarNumero(slug, id, {}, new FormData())}
    >
      Tirar da lista
    </Confirmar>
  )
}
