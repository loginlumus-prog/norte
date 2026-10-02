'use client'

import { useEffect } from 'react'

/**
 * O título da aba na tela de endereço que não existe.
 *
 * Quando a página chama `notFound()` depois de o título dela já ter saído
 * (`generateMetadata` roda antes), a aba ficava "Painel · Norte" em cima de
 * "Este endereço não abre". O `not-found` comum não exporta `metadata` no
 * Next — então o título é acertado aqui, no navegador.
 */
export function TituloNaoAchei() {
  useEffect(() => {
    document.title = 'Endereço não encontrado · Norte'
  }, [])
  return null
}
