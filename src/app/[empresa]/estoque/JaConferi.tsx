'use client'

// "Já conferi": tira o item da lista "Vendido sem estoque — conferir". Pede
// confirmação no mesmo lugar do botão (Confirmar): no tablet, rolando a lista
// com o dedo, um toque sem querer sumia com a pendência.

import { Confirmar } from '@/ui/Confirmar'
import { jaConferiAcao } from './acoes'

export function JaConferi({ slug, vendaItemId }: { slug: string; vendaItemId: string }) {
  return (
    <Confirmar
      pergunta="Contou a prateleira?"
      sim="Sim, conferi"
      tom="secundario"
      tomSim="confirmar"
      aoConfirmar={() => jaConferiAcao(slug, vendaItemId)}
    >
      Já conferi
    </Confirmar>
  )
}
