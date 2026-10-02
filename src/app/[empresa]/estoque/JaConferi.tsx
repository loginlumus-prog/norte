'use client'

// "Já conferi": tira o item da lista "Vendido sem estoque — conferir". Pede
// confirmação no mesmo lugar do botão (Confirmar): no tablet, rolando a lista
// com o dedo, um toque sem querer sumia com a pendência.
//
// Quem confere porque a empresa deixou (a vendedora) assina com o PIN dela:
// o campo aparece quando o servidor pede, e o "sim" de novo manda junto.

import { useState } from 'react'
import { Confirmar } from '@/ui/Confirmar'
import { CampoDoPin } from '@/ui/Assinar'
import { jaConferiAcao } from './acoes'

export function JaConferi({ slug, vendaItemId }: { slug: string; vendaItemId: string }) {
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  return (
    <span className="inline-flex flex-col items-end gap-1.5">
      <Confirmar
        pergunta="Contou a prateleira?"
        sim="Sim, conferi"
        tom="secundario"
        tomSim="confirmar"
        aoConfirmar={async () => {
          const r = await jaConferiAcao(slug, vendaItemId, pin || null)
          setPin('')
          if (r.precisaPin) setPedePin(true)
          return r
        }}
      >
        Já conferi
      </Confirmar>
      {pedePin && (
        <span className="w-40">
          <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} />
        </span>
      )}
    </span>
  )
}
