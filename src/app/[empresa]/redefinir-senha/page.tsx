import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { emailConfigurado } from '@/servidor/email'
import { enderecoPublico } from '@/servidor/requisicao'
import { Aviso } from '@/ui/base'
import { CartaoDeConta } from '@/ui/CartaoDeConta'
import { NovaSenha, PedirLink } from './Formularios'

// "Esqueci a senha" e "escolha a senha nova" — a mesma tela.
//
//   sem ?t=   pede o e-mail e manda o link (se o servidor manda e-mail)
//   com ?t=   o link chegou: escolhe a senha nova
//
// Como na tela do convite, o link NÃO é conferido só de abrir: responder
// "link inválido" no carregamento faria desta página um jeito de testar
// tokens em massa. A conferência acontece no envio, junto com tudo o mais.
//
// E sem e-mail configurado a tela não finge: diz que o caminho é pedir o
// link a quem administra a empresa, na tela Equipe.

export const metadata: Metadata = {
  title: 'Redefinir a senha',
  // O endereço tem o link de senha na busca: não entra em índice nenhum, e
  // não vaza no Referer (o proxy já manda `strict-origin-when-cross-origin`).
  robots: { index: false, follow: false },
}

export default async function RedefinirSenha({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ t?: string | string[] }>
}) {
  const { empresa: slug } = await params
  const { t } = await searchParams
  const org = await acharOrgPorSlug(slug)
  if (!org) notFound()

  const token = typeof t === 'string' ? t.trim() : ''
  const suspensa = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'

  if (suspensa) {
    return (
      <CartaoDeConta empresa={org} titulo="Redefinir a senha">
        <Aviso nivel="critico">O acesso desta empresa está suspenso. Fale com o responsável pela conta.</Aviso>
      </CartaoDeConta>
    )
  }

  if (token) {
    return (
      <CartaoDeConta empresa={org} titulo="Escolha a senha nova" subtitulo="Depois é só entrar com ela.">
        <NovaSenha slug={slug} token={token} />
      </CartaoDeConta>
    )
  }

  const comEmail = emailConfigurado() && !!(await enderecoPublico())

  return (
    <CartaoDeConta
      empresa={org}
      titulo="Esqueci a senha"
      subtitulo={
        comEmail
          ? 'Digite o e-mail com que você entra. Mandamos um link para você escolher uma senha nova.'
          : undefined
      }
    >
      {comEmail ? (
        <PedirLink slug={slug} empresa={org.nome} />
      ) : (
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-tinta-2">
          <Aviso nivel="atencao">Este servidor ainda não manda e-mail, então o link não tem como chegar até você.</Aviso>
          <p>
            <b className="text-tinta">Peça para quem administra a empresa gerar um link na tela Equipe.</b> Na
            linha com o seu nome, em &ldquo;Gerar link de senha&rdquo;: o link aparece para essa pessoa, ela
            manda para você, e você escolhe a senha nova nele.
          </p>
          <p className="text-[13px] text-tinta-3">
            O link vale por 24 horas e serve uma vez só.
          </p>
        </div>
      )}
    </CartaoDeConta>
  )
}
