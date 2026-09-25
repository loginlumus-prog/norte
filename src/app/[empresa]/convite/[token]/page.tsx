import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { Marca } from '@/ui/Marca'
import { Formulario } from './Formulario'

// Aceitar o convite.
//
// A tela NÃO diz se o token é válido antes de a pessoa preencher. Não é
// desleixo: responder "convite inválido" só de abrir o endereço transformaria
// esta página num jeito de testar tokens em massa. A conferência acontece no
// envio, junto com tudo o mais.
export default async function AceitarConvite({
  params,
}: {
  params: Promise<{ empresa: string; token: string }>
}) {
  const { empresa: slug, token } = await params
  const org = await acharOrgPorSlug(slug)
  if (!org) notFound()

  return (
    <main className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex flex-col justify-between gap-8 border-b border-borda bg-marca-suave p-6 md:w-[42%] md:max-w-md md:border-r md:border-b-0 md:p-10">
        <Marca tamanho={30} />
        <div className="hidden flex-col gap-3 md:flex">
          <h2 className="text-[26px] leading-tight font-extrabold tracking-tight">
            Você foi convidado
            <br />
            para {org.nome}.
          </h2>
          <p className="text-sm leading-relaxed text-tinta-2">
            Escolha uma senha e a sua conta nasce aqui. O que você vai ver depende do papel
            que te deram — e quem te convidou já escolheu.
          </p>
        </div>
        <p className="hidden text-xs text-tinta-3 md:block">
          O link vale por 7 dias e serve uma vez só.
        </p>
      </aside>

      <div className="flex flex-1 items-center justify-center bg-superficie p-6">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <header className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-5 w-1.5 shrink-0 rounded-full"
                style={{ background: org.corMarca || 'var(--marca)' }}
              />
              <span className="text-lg font-bold tracking-tight text-tinta">{org.nome}</span>
            </div>
            <p className="text-sm text-tinta-2">Crie a sua conta para começar.</p>
          </header>

          <Formulario slug={slug} token={token} />
        </div>
      </div>
    </main>
  )
}
