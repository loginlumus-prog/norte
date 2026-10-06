import type { Metadata } from 'next'
import { PRECOS } from '@/servidor/planos'
import {
  ATIVO_DIAS,
  CARENCIA_DIAS,
  DESCONTO_PRIMEIRA_PCT,
  DIA_DO_REPASSE,
  FAIXAS,
  MESES_DE_COMISSAO,
  MINIMO_REPASSE,
  NIVEL2_PCT,
  parte,
} from '@/servidor/parceiros'
import { mostrar } from '@/servidor/dinheiro'
import { lerSessaoParceiro } from '@/servidor/sessao-parceiro'
import { Casca } from './Casca'

// A página do programa: o que é, quanto paga e as regras, com conta feita.
// Todo número sai das constantes de parceiros.ts e de PRECOS — mudou a
// regra lá, a página muda junto.

export const metadata: Metadata = {
  title: 'Programa de parceiros · Norte',
  description: `Indique o Norte para lojas e receba de ${FAIXAS[0]!.pct}% a ${FAIXAS[FAIXAS.length - 1]!.pct}% de cada mensalidade paga, no Pix, todo dia ${DIA_DO_REPASSE}.`,
}

const cent = (reais: number) => Math.round(reais * 100)

function faixaTexto(i: number) {
  const f = FAIXAS[i]!
  const prox = FAIXAS[i + 1]
  const de = Math.max(1, f.de)
  return prox ? `${de} a ${prox.de - 1} clientes pagando` : `${de} ou mais clientes pagando`
}

export default async function Parceiros() {
  const logado = !!(await lerSessaoParceiro())
  const essencial = cent(PRECOS.essencial)
  const profissional = cent(PRECOS.profissional)
  const minimo = FAIXAS[0]!.pct
  const maximo = FAIXAS[FAIXAS.length - 1]!.pct

  // Os exemplos: N lojas no Profissional, na faixa de N.
  const exemplos = [3, 12, 30].map((nLojas) => {
    let pct = FAIXAS[0]!.pct
    for (const f of FAIXAS) if (nLojas >= f.de) pct = f.pct
    return { nLojas, pct, mes: parte(profissional, pct) * nLojas }
  })

  const cta = logado
    ? { href: '/parceiros/painel', texto: 'Abrir meu painel' }
    : { href: '/parceiros/cadastro', texto: 'Quero ser parceiro' }

  return (
    <Casca
      largo
      direita={
        <a href={logado ? '/parceiros/painel' : '/parceiros/entrar'} className="text-sm font-semibold text-marca hover:underline">
          {logado ? 'Meu painel' : 'Entrar'}
        </a>
      }
    >
      <div className="flex flex-col gap-16">
        {/* ── a tese ── */}
        <section className="grid items-end gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <span className="text-xs font-bold tracking-[0.14em] text-tinta-3 uppercase">Programa de parceiros do Norte</span>
            <h1 className="text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.04] font-extrabold tracking-[-0.035em] text-balance text-titulo">
              Indique para uma loja. Receba enquanto ela paga.
            </h1>
            <p className="max-w-xl text-[16px] leading-relaxed text-tinta-2">
              Você manda o seu link, a loja testa o Norte {PRECOS.diasDeTeste} dias de graça e, quando assina, você passa a
              receber de <b className="text-tinta">{minimo}% a {maximo}%</b> de cada mensalidade que ela pagar, no primeiro
              ano. Quanto mais lojas pagando, maior a sua porcentagem — sobre todas elas.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={cta.href} className="botao-marca rounded-xl px-6 py-3.5 text-[15px] font-semibold text-marca-tinta">
                {cta.texto}
              </a>
              <a href="#regras" className="rounded-xl border border-borda bg-superficie px-6 py-3.5 text-[15px] font-semibold text-tinta hover:bg-superficie-2">
                Ler as regras
              </a>
            </div>
          </div>

          {/* A régua: a porcentagem que sobe. */}
          <div className="rounded-3xl border border-borda bg-superficie p-5 sm:p-6">
            <p className="text-sm font-semibold text-tinta">Sua porcentagem, pelo número de clientes pagando</p>
            <ol className="mt-4 flex flex-col gap-2">
              {FAIXAS.map((f, i) => (
                <li key={f.pct} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-right text-lg font-extrabold tabular-nums text-titulo">{f.pct}%</span>
                  <span className="relative h-7 flex-1 overflow-hidden rounded-lg bg-superficie-2">
                    <span
                      className="absolute inset-y-0 left-0 rounded-lg bg-marca"
                      style={{ width: `${(f.pct / maximo) * 100}%`, opacity: 0.35 + (0.65 * (i + 1)) / FAIXAS.length }}
                    />
                    <span className="relative flex h-full items-center px-2.5 text-xs font-semibold text-tinta">{faixaTexto(i)}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-tinta-3">
              “Pagando” = pagou a mensalidade nos últimos {ATIVO_DIAS} dias. A porcentagem de cada mês é a da sua faixa no
              dia em que o cliente paga.
            </p>
          </div>
        </section>

        {/* ── como funciona ── */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-extrabold tracking-tight text-titulo">Como funciona</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              {
                t: 'Você manda o link',
                d: 'Pelo WhatsApp, no Instagram, de boca: cada parceiro tem um link e um código. Quem clica fica marcado como seu por 90 dias.',
              },
              {
                t: `A loja testa ${PRECOS.diasDeTeste} dias grátis`,
                d: `Com tudo ligado, sem cartão. Quando assina, a primeira mensalidade sai com ${DESCONTO_PRIMEIRA_PCT}% de desconto — o presente de quem chegou por você.`,
              },
              {
                t: 'Você recebe no Pix',
                d: `A cada mensalidade paga, a sua parte entra no painel. Depois de ${CARENCIA_DIAS} dias ela é liberada e cai no seu Pix no dia ${DIA_DO_REPASSE}.`,
              },
            ].map((p, i) => (
              <li key={p.t} className="flex flex-col gap-2 rounded-2xl border border-borda bg-superficie p-5">
                <span className="text-xs font-bold text-marca">Passo {i + 1}</span>
                <h3 className="text-[17px] font-bold text-titulo">{p.t}</h3>
                <p className="text-[14px] leading-relaxed text-tinta-2">{p.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── a conta ── */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-extrabold tracking-tight text-titulo">Quanto dá, na prática</h2>
            <p className="max-w-2xl text-[15px] text-tinta-2">
              Lojas no plano Profissional ({mostrar(profissional)} por mês a primeira loja). No Essencial ({mostrar(essencial)}),
              é a mesma porcentagem sobre o valor dele.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie">
            <table className="w-full min-w-[520px] text-left text-[14px]">
              <thead className="bg-superficie-2 text-xs text-tinta-2 uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">Lojas pagando</th>
                  <th className="px-4 py-3 font-semibold">Sua faixa</th>
                  <th className="px-4 py-3 text-right font-semibold">Por loja, por mês</th>
                  <th className="px-4 py-3 text-right font-semibold">Você recebe por mês</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {exemplos.map((e) => (
                  <tr key={e.nLojas} className="border-t border-borda">
                    <td className="px-4 py-3 font-semibold">{e.nLojas}</td>
                    <td className="px-4 py-3">{e.pct}%</td>
                    <td className="px-4 py-3 text-right">{mostrar(parte(profissional, e.pct))}</td>
                    <td className="px-4 py-3 text-right text-[15px] font-bold text-titulo">{mostrar(e.mes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-tinta-3">
            Exemplo com uma loja por cliente. Cliente com mais lojas paga mais — e a sua parte cresce junto.
          </p>
        </section>

        {/* ── a rede ── */}
        <section className="grid gap-6 rounded-3xl border border-borda bg-superficie p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-bold tracking-[0.14em] text-tinta-3 uppercase">Segundo nível</span>
            <h2 className="text-2xl font-extrabold tracking-tight text-titulo">Traga outros parceiros e ganhe {NIVEL2_PCT}% do que eles venderem</h2>
            <p className="text-[15px] leading-relaxed text-tinta-2">
              No seu painel tem um segundo link, só para convidar parceiros. Cada loja que eles trouxerem paga a comissão
              deles normalmente — e você recebe mais {NIVEL2_PCT}% da mensalidade, sem tirar nada do bolso deles.
            </p>
          </div>
          <ul className="flex flex-col gap-3 text-[14px] leading-relaxed text-tinta-2">
            <li className="rounded-xl bg-superficie-2 px-4 py-3">
              <b className="text-tinta">Só existe segundo nível.</b> Ninguém ganha do parceiro do parceiro do parceiro.
            </li>
            <li className="rounded-xl bg-superficie-2 px-4 py-3">
              <b className="text-tinta">Ninguém ganha por cadastro.</b> Trazer parceiro não paga nada; só mensalidade de loja
              de verdade paga. Isso é indicação, não pirâmide.
            </li>
            <li className="rounded-xl bg-superficie-2 px-4 py-3">
              <b className="text-tinta">Vale para quem também vende.</b> Os {NIVEL2_PCT}% só entram enquanto você tiver pelo menos
              um cliente seu pagando.
            </li>
          </ul>
        </section>

        {/* ── as regras ── */}
        <section id="regras" className="flex scroll-mt-20 flex-col gap-6">
          <h2 className="text-2xl font-extrabold tracking-tight text-titulo">As regras, sem letra miúda</h2>
          <dl className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {[
              ['De quem é a indicação', 'De quem mandou o link que a loja usou para se cadastrar (ou do código que ela digitou). A primeira indicação vale para sempre; ninguém “rouba” cliente depois.'],
              ['Por quanto tempo você ganha', `Pelas primeiras ${MESES_DE_COMISSAO} mensalidades de cada cliente, contadas do primeiro mês pago.`],
              ['Sobre qual valor', 'Sobre o que a loja pagou de verdade. Na primeira mensalidade, com o desconto de indicação, a sua parte é sobre o valor com desconto.'],
              ['Quando o dinheiro libera', `${CARENCIA_DIAS} dias depois do pagamento da loja. É a garantia contra pagamento devolvido ou estornado.`],
              ['Quando cai no Pix', `Todo dia ${DIA_DO_REPASSE}, tudo o que estiver liberado, a partir de ${mostrar(MINIMO_REPASSE * 100)}. Abaixo disso, acumula para o mês seguinte.`],
              ['O que não vale', 'Indicar a própria empresa, criar conta falsa ou anunciar com o nome do Norte como se fosse o Norte. Fraude cancela as comissões e a conta.'],
            ].map(([t, d]) => (
              <div key={t} className="flex flex-col gap-1 border-t border-borda pt-4">
                <dt className="text-[15px] font-bold text-titulo">{t}</dt>
                <dd className="text-[14px] leading-relaxed text-tinta-2">{d}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-tinta-2">
            O texto completo está nos{' '}
            <a href="/parceiros/termos" className="font-semibold text-marca hover:underline">
              termos do programa
            </a>
            .
          </p>
        </section>

        {/* ── cliente também indica ── */}
        <section className="flex flex-col gap-3 rounded-3xl bg-superficie-2 p-6 sm:p-8">
          <h2 className="text-xl font-extrabold tracking-tight text-titulo">Já é cliente do Norte?</h2>
          <p className="max-w-2xl text-[15px] leading-relaxed text-tinta-2">
            O dono da loja ativa a conta de parceiro dentro do próprio sistema, em <b className="text-tinta">Indique e ganhe</b>,
            com as mesmas regras e o pagamento no mesmo Pix.
          </p>
        </section>

        <section className="flex flex-col items-center gap-4 py-4 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-balance text-titulo">O link sai na hora. A conta é grátis.</h2>
          <a href={cta.href} className="botao-marca rounded-xl px-7 py-3.5 text-[15px] font-semibold text-marca-tinta">
            {cta.texto}
          </a>
        </section>
      </div>
    </Casca>
  )
}
