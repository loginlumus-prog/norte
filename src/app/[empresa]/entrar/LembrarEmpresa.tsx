'use client'

// Guarda neste aparelho o endereço da empresa cuja tela de entrar abriu. A
// página pública /entrar lê e oferece "Continuar em <endereço>" — quem
// digitou só o domínio não precisa lembrar o endereço da loja.

import { useEffect } from 'react'
import { ULTIMA_EMPRESA } from '@/app/entrar/QualEmpresa'

export function LembrarEmpresa({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(ULTIMA_EMPRESA, slug)
    } catch {
      // Navegador sem armazenamento (aba privada, bloqueio): só não lembra.
    }
  }, [slug])
  return null
}
