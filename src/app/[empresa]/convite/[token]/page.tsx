import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { conviteParaTela } from '@/servidor/convite'
import { Marca } from '@/ui/Marca'
import { Formulario } from './Formulario'

export const metadata: Metadata = { title: 'Convite' }

// Aceitar o convite.
//
// ── o link é conferido ANTES do formulário ───────────────────
// Antes a tela abria o formulário para qualquer token e só dizia "não vale"
// depois de a pessoa escolher nome e senha. A razão era não virar teste de
// token em massa — mas o token tem 256 bits aleatórios (servidor/convite.ts):
// não há o que adivinhar. Já o formulário aberto para link morto fazia a
// pessoa criar senha para nada. Agora o link vencido, usado ou trocado cai
// numa tela que diz o que fazer.
//
// O que a tela NÃO diz: qual dos três foi, nem o e-mail convidado, nem se ele
// já tem conta. "Não serve mais" basta para a pessoa agir.
//
// ── o mesmo desenho do entrar ────────────────────────────────
// Cartão no meio, a inicial da empresa na cor dela e o botão da marca — é a
// mesma porta da empresa, e precisa parecer a mesma.
export default async function AceitarConvite({
  params,
}: {
  params: Promise<{ empresa: string; token: string }>
}) {
  const { empresa: slug, token } = await params
  const org = await acharOrgPorSlug(slug)
  if (!org) notFound()

  const tela = await conviteParaTela(slug, token)
  const serve = tela.serve

  // A cor gravada antes da conferência (comecar/acoes.ts) pode ser texto
  // qualquer: no `style`, só "#rrggbb".
  const cor = org.corMarca && /^#[0-9a-f]{6}$/i.test(org.corMarca) ? org.corMarca : 'var(--marca)'
  const inicial = org.nome.trim().charAt(0).toUpperCase() || 'N'
  const luz = {
    background: `radial-gradient(60rem 32rem at 50% -12%, color-mix(in srgb, var(--marca) 11%, transparent) 0%, transparent 65%), radial-gradient(36rem 24rem at 100% 100%, color-mix(in srgb, ${cor} 8%, transparent) 0%, transparent 70%), var(--fundo)`,
  }

  const entrar = (
    <Link href={`/${slug}/entrar`} className="font-medium text-marca underline-offset-2 hover:underline">
      Entrar
    </Link>
  )

  return (
    <main className="flex min-h-dvh flex-col bg-fundo" style={luz}>
      <div className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Marca tamanho={28} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 pb-16">
        <div className="entra flex w-full max-w-[420px] flex-col gap-7 rounded-3xl border border-borda bg-superficie p-7 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_24px_48px_-12px_rgb(16_24_40/0.14)] sm:p-9">
          <header className="flex items-center gap-3.5">
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-2xl text-xl font-extrabold text-white shadow-norte"
              style={{ background: cor }}
            >
              {inicial}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-lg leading-tight font-bold tracking-tight text-titulo">
                {org.nome}
              </span>
              <span className="text-sm text-tinta-2">
                {serve
                  ? tela.serve && tela.pedePin
                    ? 'Você foi convidado. Crie a sua senha e o seu PIN.'
                    : 'Você foi convidado. Crie a sua conta.'
                  : 'Este convite não serve mais.'}
              </span>
            </span>
          </header>

          {serve ? (
            <>
              <Formulario slug={slug} token={token} pedeEmail={tela.serve && tela.pedeEmail} pedePin={tela.serve && tela.pedePin} />
              {/* Quem já tem conta (aceitou antes, ou abriu o link de novo)
                  não precisa de outra: a porta de entrar é esta. */}
              <p className="text-center text-sm text-tinta-3">Já tem acesso? {entrar}</p>
            </>
          ) : (
            <div className="flex flex-col gap-4 text-sm leading-relaxed text-tinta-2">
              <p>
                O convite expirou ou já foi usado. Cada link vale por 7 dias e serve uma vez só — e
                um convite novo apaga o anterior.
              </p>
              <ul className="flex flex-col gap-2">
                <li>
                  <b className="text-tinta">Ainda não tem conta?</b> Peça um link novo para quem
                  convidou você.
                </li>
                <li>
                  <b className="text-tinta">Já criou a sua conta por este link?</b> É só {entrar}{' '}
                  com o seu e-mail e a senha que você escolheu.
                </li>
              </ul>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-tinta-3">
          {serve ? 'O link vale por 7 dias e serve uma vez só.' : 'Cada empresa entra pelo próprio endereço'}
        </p>
      </div>
    </main>
  )
}
