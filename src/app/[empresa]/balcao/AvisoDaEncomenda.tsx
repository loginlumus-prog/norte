'use client'

// "Essa encomenda já foi entregue", quando o balcão abre por um link de
// encomenda que não dá mais para receber.
//
// O aviso vale para a encomenda como ela estava ao ABRIR a tela. Fechada a
// venda que a entregou, a tela é redesenhada com o mesmo endereço
// (`?encomenda=`), e a encomenda agora entregue fazia o aviso aparecer logo
// embaixo do "Venda fechada" — como se a venda tivesse dado errado. Por isso
// o texto é lido uma vez só, na montagem.

import { useState } from 'react'
import { Aviso } from '@/ui/base'

export function AvisoDaEncomenda({ texto }: { texto: string | null }) {
  const [daAbertura] = useState(texto)
  return daAbertura ? <Aviso nivel="atencao">{daAbertura}</Aviso> : null
}
