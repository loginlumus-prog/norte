// Cola entre a página e o servidor.
//
// Toda página de dentro do sistema começa por `exigirEntrada`. Assim não existe
// tela que "quase" checa sessão: ou a página chamou isto, ou ela não renderiza.

import { redirect, notFound } from 'next/navigation'
import { acharOrgPorSlug } from './banco'
import { lerSessao } from './sessao'
import type { Sessao } from './permissao'

export type Empresa = NonNullable<Awaited<ReturnType<typeof acharOrgPorSlug>>>

export async function exigirEntrada(
  slugEmpresa: string,
  /** A própria tela de cadastro passa `false`, senão entraria em laço. */
  exigirConfigurada = true,
): Promise<{ empresa: Empresa; sessao: Sessao }> {
  const empresa = await acharOrgPorSlug(slugEmpresa)
  if (!empresa) notFound()

  const sessao = await lerSessao(slugEmpresa)
  if (!sessao) redirect(`/${slugEmpresa}/entrar`)

  // O cookie diz de quem é a sessão; o endereço diz qual empresa foi aberta.
  // Se divergirem, a sessão não vale — vale a empresa do endereço, sempre.
  if (sessao.orgId !== empresa.id) redirect(`/${slugEmpresa}/entrar`)

  // Empresa suspensa depois que a pessoa já estava dentro: a sessão morre aqui,
  // não na próxima vez que ela tentar entrar.
  if (empresa.situacao === 'SUSPENSA' || empresa.situacao === 'CANCELADA') {
    redirect(`/${slugEmpresa}/entrar`)
  }

  // Sistema meio configurado confunde mais que sistema vazio: enquanto o
  // cadastro inicial não terminou, toda tela leva de volta para ele.
  if (exigirConfigurada && !empresa.configuradaEm) {
    redirect(`/${slugEmpresa}/comecar`)
  }

  return { empresa, sessao }
}
