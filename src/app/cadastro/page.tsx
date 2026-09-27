import type { Metadata } from 'next'
import { cadastroAberto, carimbar } from '@/servidor/autocadastro'
import { emailConfigurado } from '@/servidor/email'
import { enderecoPublico } from '@/servidor/requisicao'
import { EMPRESA } from '@/servidor/legal'
import { PLANOS } from '@/servidor/planos'
import { RAMOS } from '@/servidor/modulos'
import { Marca } from '@/ui/Marca'
import { TrocaTema } from '@/ui/TrocaTema'
import { Formulario } from './Formulario'

// Criar a conta: a porta do "Começar grátis" da página de venda.
//
// Cinco campos e um aceite. O resto (CNPJ, endereço, módulos, o nome do
// assistente) é o cadastro inicial de dentro do sistema (/<empresa>/comecar),
// que já existia e continua sendo o lugar disso: pedir tudo aqui seria
// perder gente na porta por causa de um CNPJ que ela não tem à mão.
//
// Com CADASTRO_ABERTO=0 a página não some — ela diz a verdade: o cadastro
// está fechado, e o caminho é o e-mail.

export const metadata: Metadata = {
  title: 'Criar conta grátis · Norte',
  description: 'Crie a conta da sua loja no Norte, no plano Grátis: balcão, caixa, produtos, estoque e clientes.',
}

const INCLUI = [
  'Balcão e caixa, produtos, estoque e clientes',
  'Uma loja, uma pessoa por vez',
  `Até ${PLANOS.GRATIS.tetoVendasMes} vendas no mês`,
  'Sem cartão de crédito, sem prazo para acabar',
]

export default async function Cadastro() {
  const aberto = cadastroAberto()
  const publico = await enderecoPublico()
  const dominio = (publico ?? 'https://usenorte.com.br').replace(/^https?:\/\//, '')
  const comEmail = emailConfigurado() && !!publico
  const ramos = Object.entries(RAMOS).map(([valor, r]) => ({ valor, titulo: r.titulo }))

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="border-b border-borda bg-superficie/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-5">
          <a href="/" className="rounded-norte">
            <Marca tamanho={28} id="topo" />
          </a>
          <div className="flex items-center gap-3 sm:gap-4">
            <TrocaTema tom="papel" />
            <a href="/" className="text-sm font-medium text-tinta-2 hover:text-tinta">
              Voltar ao site
            </a>
          </div>
        </div>
      </header>

      <main
        className="flex flex-1 justify-center px-4 py-10 sm:px-5 lg:py-16"
        style={{
          background:
            'radial-gradient(60rem 32rem at 50% -12%, color-mix(in srgb, var(--marca) 10%, transparent) 0%, transparent 65%), var(--fundo)',
        }}
      >
        <div className="grid w-full max-w-5xl items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
          <section className="flex flex-col gap-6 lg:pt-6">
            <span className="text-xs font-bold tracking-[0.14em] text-tinta-3 uppercase">Plano Grátis</span>
            <h1 className="text-[clamp(1.9rem,3.4vw,2.8rem)] leading-[1.08] font-extrabold tracking-[-0.03em] text-balance text-titulo">
              A sua loja no Norte em dois minutos.
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-tinta-2">
              Crie a conta, escolha o ramo e comece a vender no balcão hoje. Quando a loja crescer, o plano
              acompanha — é só subir em Assinatura.
            </p>
            <ul className="flex flex-col gap-2.5">
              {INCLUI.map((i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-tinta">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-bom-vivo" />
                  {i}
                </li>
              ))}
            </ul>
          </section>

          <div className="entra flex w-full flex-col gap-6 rounded-3xl border border-borda bg-superficie p-6 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_24px_48px_-12px_rgb(16_24_40/0.14)] sm:p-8">
            {aberto ? (
              <>
                <header className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold tracking-tight text-titulo">Criar a conta da loja</h2>
                  <p className="text-sm text-tinta-2">Você entra como dono. A equipe você convida depois.</p>
                </header>
                <Formulario carimbo={carimbar()} ramos={ramos} dominio={dominio} comEmail={comEmail} />
              </>
            ) : (
              <div className="flex flex-col gap-4">
                <h2 className="text-xl font-bold tracking-tight text-titulo">Fale com a gente</h2>
                <p className="text-[15px] leading-relaxed text-tinta-2">
                  O cadastro pelo site está fechado neste momento. Escreva para a gente e montamos a conta da sua
                  loja junto com você.
                </p>
                <a
                  href={`mailto:${EMPRESA.email}?subject=${encodeURIComponent('Quero começar no Norte')}`}
                  className="botao-marca rounded-xl px-5 py-3 text-center text-[15px] font-semibold text-marca-tinta"
                >
                  {EMPRESA.email}
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
