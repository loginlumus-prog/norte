import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { Aviso } from '@/ui/base'
import { Marca } from '@/ui/Marca'
import { Traco } from '@/ui/Traco'
import { Formulario } from './Formulario'

// A tela de entrar é a primeira coisa que o cliente vê todo dia de manhã.
//
// Ela é dividida ao meio. À esquerda a marca e o que a pessoa vai encontrar
// lá dentro; à direita o formulário. Até 24/09 o lado da marca era um bloco
// azul-noite — com o sistema inteiro passando a branco, ele virou o único
// retângulo escuro da jornada e lia como outro produto. Agora é um azul muito
// claro, o mesmo tom do item aceso no menu: a pessoa entra e já está na casa.
//
// No celular o lado da marca vira uma faixa fina em cima: a mesma ideia, sem
// roubar a tela de quem só quer digitar a senha.
const DENTRO: [string, string][] = [
  ['Vender em três toques', 'Balcão com botões grandes, caixa conferido e comprovante.'],
  ['Saber o que fazer hoje', 'O painel abre pelo que precisa de você: o que acabou, o que venceu.'],
  ['A equipe no mesmo quadro', 'Tarefas, metas e o desempenho de cada um.'],
]

export default async function Entrar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params
  const org = await acharOrgPorSlug(empresa)
  if (!org) notFound()

  const suspensa = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'

  return (
    <main className="flex min-h-dvh flex-col bg-superficie md:flex-row">
      {/* ── lado da marca ── */}
      <aside
        className="relative flex flex-col justify-between gap-8 overflow-hidden border-b border-borda p-6 md:w-[42%] md:max-w-md md:border-r md:border-b-0 md:p-10"
        style={{
          background:
            'radial-gradient(40rem 30rem at 0% 0%, color-mix(in srgb, var(--marca) 14%, transparent) 0%, transparent 70%), var(--marca-suave)',
        }}
      >
        {/* A bússola, meia, cortada no eixo da costura — agora na tinta do
            tema, bem apagada, porque o fundo é claro. */}
        <Traco
          arte="bussola"
          sobre="tema"
          opacidade={0.08}
          className="pointer-events-none absolute top-1/2 right-0 w-[43rem] max-w-none -translate-y-1/2 translate-x-1/2"
        />

        {/* `relative` em cada bloco: o desenho é absoluto, e sem isto ele
            passaria POR CIMA do texto — irmão posicionado pinta depois. */}
        <div className="relative">
          <Marca tamanho={30} />
        </div>

        <div className="relative hidden flex-col gap-6 md:flex">
          <h2 className="text-[28px] leading-[1.1] font-extrabold tracking-tight text-balance">
            A empresa inteira numa tela só.
          </h2>
          <ul className="flex flex-col gap-4">
            {DENTRO.map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-marca" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-tinta">{t}</span>
                  <span className="text-sm leading-relaxed text-tinta-2">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative hidden text-xs text-tinta-3 md:block">
          Cada empresa entra pelo próprio endereço.
        </p>
      </aside>

      {/* ── lado do trabalho ── */}
      {/* O formulario num cartao sobre o papel, e nao chapado no branco: sem
          a diferenca entre os dois, este lado da tela e uma folha em branco
          com campos soltos, que e exatamente a cara de formulario. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-superficie p-6">
        {/* A montanha. Uma arte de cada lado da costura: a bussola diz onde
            voce esta, o relevo diz para onde sobe.

            `sobre="tema"` porque ESTE lado troca de cor junto com a pessoa —
            e branco no claro e quase preto no escuro. Com a positiva fixa, ela
            multiplicava escuro sobre escuro e sumia no tema escuro. */}
        <Traco
          arte="relevo"
          sobre="tema"
          opacidade={0.09}
          className="pointer-events-none absolute inset-x-0 -bottom-10 w-full max-w-none"
        />
        <div className="relative flex w-full max-w-sm flex-col gap-6 rounded-xl border border-borda bg-superficie p-7 shadow-norte-alta">
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
