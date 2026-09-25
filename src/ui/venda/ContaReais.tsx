'use client'

// O `Contando` com a formatação em reais já dentro.
//
// Existe porque `Contando` recebe a formatação como FUNÇÃO, e função não
// atravessa a fronteira servidor → cliente. A vitrine do topo é desenhada no
// servidor; ela passa só o número, e a formatação nasce aqui do lado do
// navegador.

import { Contando } from '../AoEntrar'
import { reais } from './Pecas'

export function ContaReais({
  ate,
  duracao,
  className,
}: {
  ate: number
  duracao?: number
  className?: string
}) {
  return <Contando ate={ate} duracao={duracao} formatar={(v) => reais(v)} className={className} />
}
