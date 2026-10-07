import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { DESCONTO_PRIMEIRA_PCT, nomePeloCodigo } from '@/servidor/parceiros'
import { cadastroAberto, carimbar } from '@/servidor/autocadastro'
import { emailConfigurado } from '@/servidor/email'
import { enderecoPublico } from '@/servidor/requisicao'
import { EMPRESA } from '@/servidor/legal'
import { PLANOS, PRECOS, milhar } from '@/servidor/planos'
import { RAMOS } from '@/servidor/modulos'
import { Marca } from '@/ui/Marca'
import { Preferencias } from '@/ui/Preferencias'
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
//
// ── o que a página promete ───────────────────────────────────
// Desde a tabela de 02/10/2026 a empresa nasce em TESTE, com tudo, por
// `PRECOS.diasDeTeste` dias (autocadastro.ts) — e não mais no plano Grátis,
// que deixou de ser vendido. A página diz o prazo e o que acontece depois,
// porque "grátis" sem prazo escrito é a promessa que vira reclamação no dia
// em que o teste acaba.

export const metadata: Metadata = {
  title: 'Testar grátis · Norte',
  description: `Crie a conta da sua loja no Norte e use tudo por ${PRECOS.diasDeTeste} dias, sem cartão: balcão, estoque, crediário, financeiro e o assistente no WhatsApp.`,
}

const INCLUI = [
  'Balcão e caixa, produto com grade, estoque e clientes',
  'Crediário com carnê, financeiro com DRE e fechamento do mês',
  `O assistente no WhatsApp, com ${milhar(PRECOS.respostasDoTeste)} respostas para conhecer`,
  'Sem cartão de crédito. Não vira cobrança sozinho',
]

export default async function Cadastro() {
  const aberto = cadastroAberto()
  const publico = await enderecoPublico()
  const dominio = (publico ?? 'https://gestornorte.com').replace(/^https?:\/\//, '')
  const comEmail = emailConfigurado() && !!publico
  const ramos = Object.entries(RAMOS).map(([valor, r]) => ({ valor, titulo: r.titulo }))
  // Veio pelo link de um parceiro? O código fica no cookie (proxy.ts) por 90 dias.
  const ref = (await cookies()).get('norte_ref')?.value ?? ''
  const indicou = ref ? await nomePeloCodigo(ref) : null

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
        className="flex flex-1 justify-center px-4 py-10 sm:px-5 lg:py-16"
        style={{
          background:
            'radial-gradient(60rem 32rem at 50% -12%, color-mix(in srgb, var(--marca) 10%, transparent) 0%, transparent 65%), var(--fundo)',
        }}
      >
        <div className="grid w-full max-w-5xl items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
          <section className="flex flex-col gap-6 lg:pt-6">
            <span className="text-xs font-bold tracking-[0.14em] text-tinta-3 uppercase">
              {PRECOS.diasDeTeste} dias grátis com tudo
            </span>
            <h1 className="text-[clamp(1.9rem,3.4vw,2.8rem)] leading-[1.08] font-extrabold tracking-[-0.03em] text-balance text-titulo">
              A sua loja no Norte em dois minutos.
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-tinta-2">
              Crie a conta, escolha o ramo e comece a vender no balcão hoje. São {PRECOS.diasDeTeste} dias com
              tudo ligado, sem cartão. Quando acabar, você assina em Assinatura — ou a conta segue no plano{' '}
              {PLANOS.GRATIS.titulo}, de uma loja e até {PLANOS.GRATIS.tetoVendasMes} vendas no mês, com os dados
              todos guardados.
            </p>
            {indicou && (
              <div className="max-w-md rounded-2xl border border-bom-borda bg-bom-fundo px-4 py-3 text-[14px] leading-relaxed text-tinta">
                <b>Indicação de {indicou}.</b> Você testa {PRECOS.diasDeTeste} dias grátis como todo mundo e, quando
                assinar, a primeira mensalidade sai com <b>{DESCONTO_PRIMEIRA_PCT}% de desconto</b>.
              </div>
            )}
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
                <Formulario carimbo={carimbar()} ramos={ramos} dominio={dominio} comEmail={comEmail} codigo={indicou ? ref : ''} />
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
