import { vocabularioDaEmpresa } from '@/servidor/vocabulario'
import type { PalavrasDaFicha } from './Editor'

/** As palavras do ramo para a ficha de cliente (ver `Editor`). */
export async function palavrasDaFicha(orgId: string): Promise<PalavrasDaFicha> {
  const v = await vocabularioDaEmpresa(orgId)
  return { Pessoa: v.Pessoa, avisoObservacao: v.avisoObservacao }
}
