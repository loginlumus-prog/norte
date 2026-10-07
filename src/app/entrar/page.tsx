import type { Metadata } from 'next'
import { enderecoPublico } from '@/servidor/requisicao'
import { Marca } from '@/ui/Marca'
import { Preferencias } from '@/ui/Preferencias'
import { QualEmpresa } from './QualEmpresa'

// "Entrar" da página de venda.
//
// Cada empresa entra pelo próprio endereço (gestornorte.com/<empresa>/entrar),
// porque a sessão mora no caminho da empresa. Até 02/10/2026 o botão "Entrar"
// do site levava para o login da empresa de EXEMPLO — o dono de verdade caía
// numa tela que nunca ia aceitar a senha dele. Esta página pergunta o endereço
// e leva para o lugar certo; quem já entrou neste aparelho vê o atalho.
//
// Não confere se o endereço existe: endereço errado cai na página de "não
// encontrada" do próprio [empresa], e não abrimos aqui uma porta para listar
// quais empresas existem.

export const metadata: Metadata = {
  title: 'Entrar · Norte',
  description: 'Entre na conta da sua empresa no Norte.',
}

export default async function Entrar() {
  const publico = await enderecoPublico()
  const dominio = (publico ?? 'https://gestornorte.com').replace(/^https?:\/\//, '')

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="border-b border-borda bg-superficie/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-5">
          <a href="/" className="rounded-norte">
            <Marca tamanho={28} id="topo" />
          </a>
          <div className="flex items-center gap-3 sm:gap-4">
            <Preferencias />
            <a href="/" className="text-sm font-medium text-tinta-2 hover:text-tinta">
              Voltar ao site
            </a>
          </div>
        </div>
      </header>

      <main
        className="flex flex-1 items-start justify-center px-4 py-12 sm:px-5 lg:py-20"
        style={{
          background:
            'radial-gradient(60rem 32rem at 50% -12%, color-mix(in srgb, var(--marca) 10%, transparent) 0%, transparent 65%), var(--fundo)',
        }}
      >
        <div className="entra flex w-full max-w-md flex-col gap-6 rounded-3xl border border-borda bg-superficie p-6 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_24px_48px_-12px_rgb(16_24_40/0.14)] sm:p-8">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-titulo">Entrar na sua empresa</h1>
            <p className="text-sm leading-relaxed text-tinta-2">
              Cada empresa tem o seu endereço — o mesmo do link do convite e do e-mail de boas-vindas.
            </p>
          </header>
          <QualEmpresa dominio={dominio} />
          <p className="border-t border-borda pt-5 text-sm text-tinta-2">
            Ainda não tem conta?{' '}
            <a href="/cadastro" className="font-semibold text-marca hover:underline">
              Teste grátis
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
