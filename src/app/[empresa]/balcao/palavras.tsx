'use client'

// As palavras do ramo, para as peças do balcão.
//
// A recepção da clínica é o MESMO balcão da loja (ver o topo de
// BalcaoSimples.tsx) — muda o que ele escreve: "Concluir atendimento" em vez
// de "Concluir venda", "Toque num serviço" em vez de "Toque num produto". As
// palavras vêm prontas do servidor (servidor/vocabulario.ts) e descem por
// contexto, e não de prop em prop: são dez componentes, e a palavra é a
// mesma em todos.

import { createContext, useContext, type ReactNode } from 'react'
import type { VocabularioDoRamo } from '@/servidor/vocabulario'

const Palavras = createContext<VocabularioDoRamo | null>(null)

export function ComPalavras({ palavras, children }: { palavras: VocabularioDoRamo; children: ReactNode }) {
  return <Palavras.Provider value={palavras}>{children}</Palavras.Provider>
}

/** As palavras do ramo desta loja. Só existe dentro da página do balcão. */
export function usePalavras(): VocabularioDoRamo {
  const p = useContext(Palavras)
  if (!p) throw new Error('usePalavras fora do balcão: a página precisa de <ComPalavras>.')
  return p
}
