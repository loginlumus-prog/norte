'use server'

import { redirect } from 'next/navigation'
import { fecharSessao } from '@/servidor/sessao'

// Sair é Server Action, não rota POST: numa rota, o redirect() sai como 307 e
// o navegador REPETE o POST no destino, que não aceita POST. A Server Action
// já resolve o redirecionamento no protocolo dela.
export async function sairAcao(form: FormData) {
  const empresa = String(form.get('empresa') ?? '')
  await fecharSessao(empresa)
  redirect(`/${empresa}/entrar`)
}
