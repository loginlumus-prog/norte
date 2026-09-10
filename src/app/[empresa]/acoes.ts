'use server'

import { redirect } from 'next/navigation'
import { fecharSessao } from '@/servidor/sessao'
import { sessaoViva } from '@/servidor/pagina'
import { liberarVaga } from '@/servidor/presenca'

// Sair é Server Action, não rota POST: numa rota, o redirect() sai como 307 e
// o navegador REPETE o POST no destino, que não aceita POST. A Server Action
// já resolve o redirecionamento no protocolo dela.
export async function sairAcao(form: FormData) {
  const empresa = String(form.get('empresa') ?? '')

  // A vaga é liberada ANTES do cookie morrer, porque depois disso não dá mais
  // para saber quem estava saindo. Sair é o caminho limpo: quem clica aqui
  // devolve a vaga na hora, sem esperar os dez minutos de inatividade.
  const sessao = await sessaoViva(empresa)
  if (sessao) await liberarVaga(sessao.orgId, sessao.usuarioId)

  await fecharSessao(empresa)
  redirect(`/${empresa}/entrar`)
}
