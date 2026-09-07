import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { Aviso } from '@/ui/base'
import { Marca } from '@/ui/Marca'
import { Formulario } from './Formulario'

// A tela de entrar é a primeira coisa que o cliente vê todo dia de manhã, e
// era a mais sem graça do sistema: um quadrado colorido, um nome e dois
// campos soltos no branco.
//
// Ela é dividida ao meio de propósito. À esquerda o azul-noite com a marca —
// é o que diz "isto é um produto, tem gente por trás". À direita o branco com
// o formulário. No celular a metade azul vira uma faixa fina em cima: a
// mesma ideia, sem roubar a tela de quem só quer digitar a senha.
export default async function Entrar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params
  const org = await acharOrgPorSlug(empresa)
  if (!org) notFound()

  const suspensa = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'

  return (
    <main className="flex min-h-dvh flex-col md:flex-row">
      {/* ── lado da marca ── */}
      <aside className="flex flex-col justify-between gap-8 bg-nav p-6 md:w-[42%] md:max-w-md md:p-10">
        <Marca tamanho={30} nu claro />

        <div className="hidden flex-col gap-3 md:flex">
          <h2 className="text-[26px] leading-tight font-extrabold tracking-tight text-nav-tinta">
            A empresa inteira
            <br />
            numa tela só.
          </h2>
          <p className="text-sm leading-relaxed text-nav-tinta-2">
            Produto, estoque, balcão, caixa e o resultado do mês. E um assistente
            no WhatsApp que sabe de tudo isso.
          </p>
        </div>

        <p className="hidden text-xs text-nav-tinta-2 md:block">
          Cada empresa entra pelo próprio endereço.
        </p>
      </aside>

      {/* ── lado do trabalho ── */}
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
            <p className="text-sm text-tinta-2">Entre para continuar.</p>
          </header>

          {suspensa ? (
            <Aviso nivel="critico">
              O acesso desta empresa está suspenso. Fale com o responsável pela conta.
            </Aviso>
          ) : (
            <Formulario empresa={empresa} />
          )}
        </div>
      </div>
    </main>
  )
}
