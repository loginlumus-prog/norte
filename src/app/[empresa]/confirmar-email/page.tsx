import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { CartaoDeConta } from '@/ui/CartaoDeConta'
import { Confirmar } from './Confirmar'

// O link do e-mail de confirmação do cadastro chega aqui. A página só mostra
// o botão; quem gasta o link é o clique (ver acoes.ts, e o porquê).

export const metadata: Metadata = {
  title: 'Confirmar o e-mail',
  robots: { index: false, follow: false },
}

export default async function ConfirmarEmail({
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

  return (
    <CartaoDeConta
      empresa={org}
      titulo="Confirmar o e-mail"
      subtitulo={
        token
          ? 'Um clique e a conta está liberada. Depois é entrar com a senha que você escolheu no cadastro.'
          : undefined
      }
    >
      {token ? (
        <Confirmar slug={slug} token={token} />
      ) : (
        <p className="text-sm leading-relaxed text-tinta-2">
          Abra esta tela pelo botão do e-mail de confirmação. Não achou o e-mail?{' '}
          <Link href={`/${slug}/entrar`} className="font-semibold text-marca underline-offset-2 hover:underline">
            Entre com e-mail e senha
          </Link>{' '}
          — a tela oferece mandar outro.
        </p>
      )}
    </CartaoDeConta>
  )
}
