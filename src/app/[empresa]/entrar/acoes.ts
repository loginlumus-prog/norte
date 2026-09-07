'use server'

import { redirect } from 'next/navigation'
import { entrar, RECADO, type MotivoRecusa } from '@/servidor/autenticacao'
import { abrirSessao } from '@/servidor/sessao'

export type EstadoEntrada = { erro?: string; email?: string }

export async function entrarAcao(
  _anterior: EstadoEntrada,
  form: FormData,
): Promise<EstadoEntrada> {
  const empresa = String(form.get('empresa') ?? '')
  const email = String(form.get('email') ?? '')
  const senha = String(form.get('senha') ?? '')

  if (!email || !senha) {
    return { erro: 'Preencha e-mail e senha.', email }
  }

  const r = await entrar(empresa, email, senha)

  if (!r.ok) {
    // Devolve o e-mail para a pessoa não precisar digitar de novo — mas nunca
    // a senha, que não deve voltar do servidor por motivo nenhum.
    return { erro: RECADO[r.motivo as MotivoRecusa], email }
  }

  await abrirSessao(empresa, r.sessao)

  // redirect() funciona lançando — precisa ficar FORA de try/catch,
  // senão o catch engole e a pessoa fica na tela de login achando que falhou.
  redirect(`/${empresa}`)
}
