import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { carimbar } from '@/servidor/autocadastro'
import { FAIXAS, nomePeloCodigo } from '@/servidor/parceiros'
import { lerSessaoParceiro } from '@/servidor/sessao-parceiro'
import { Casca, CartaoForm } from '../Casca'
import { FormCadastro } from '../Formularios'

export const metadata: Metadata = {
  title: 'Seja parceiro · Norte',
  description: 'Indique o Norte para lojas e receba de 10% a 30% de cada mensalidade paga, no Pix.',
}

export default async function CadastroParceiro() {
  if (await lerSessaoParceiro()) redirect('/parceiros/painel')
  // Veio pelo link de outro parceiro (?ref=): entra na rede dele.
  const ref = (await cookies()).get('norte_ref_parceiro')?.value
  const quemTrouxe = ref ? await nomePeloCodigo(ref) : null
  const max = FAIXAS[FAIXAS.length - 1]!.pct
  return (
    <Casca>
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
        <section className="flex flex-col gap-5 lg:pt-6">
          <span className="text-xs font-bold tracking-[0.14em] text-tinta-3 uppercase">Programa de parceiros</span>
          <h1 className="text-[clamp(1.9rem,3.4vw,2.6rem)] leading-[1.08] font-extrabold tracking-[-0.03em] text-balance text-titulo">
            Indique o Norte e receba todo mês, no Pix.
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed text-tinta-2">
            Você ganha de {FAIXAS[0]!.pct}% a {max}% de cada mensalidade que as lojas indicadas por você pagarem, durante
            o primeiro ano de cada uma. A conta é grátis e não tem meta.
          </p>
          <a href="/parceiros" className="text-sm font-semibold text-marca hover:underline">
            Ver como funciona, com exemplos →
          </a>
        </section>
        <CartaoForm titulo="Criar conta de parceiro" sub="Leva um minuto. O link de indicação sai na hora.">
          <FormCadastro carimbo={carimbar()} quemTrouxe={quemTrouxe} />
        </CartaoForm>
      </div>
    </Casca>
  )
}
