import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { lerModo } from '@/servidor/modo'
import { Aviso } from '@/ui/base'
import { Marca } from '@/ui/Marca'
import { TrocaModo } from '@/ui/TrocaModo'
import { Formulario } from './Formulario'

// A tela de entrar é a primeira coisa que o cliente vê todo dia de manhã.
//
// ── dois jeitos, e quem escolhe é o aparelho ─────────────────
// Ela segue o mesmo modo do resto do sistema (`servidor/modo.ts`), porque é o
// mesmo aparelho:
//
//   SIMPLES   só o formulário, no meio da tela. É o computador do balcão: a
//             pessoa chega, digita a senha e vai vender. Qualquer coisa a mais
//             na frente dela é atraso.
//   AVANÇADO  a tela dividida — à esquerda a marca e o que existe lá dentro,
//             à direita o formulário. É o notebook do dono, que entra com
//             calma e gosta de ver onde está.
//
// ── o que saiu em 25/09 ──────────────────────────────────────
// A bússola e a montanha desenhadas atrás do texto — e com elas todo desenho
// decorativo do site, por decisão do dono. A diferença entre os dois modos é
// de INFORMAÇÃO, nunca de enfeite: o avançado diz o que existe lá dentro; o
// simples não diz nada além do necessário para entrar.

const DENTRO: [string, string][] = [
  ['Vender em três toques', 'Balcão com botões grandes, caixa conferido e comprovante.'],
  ['Saber o que fazer hoje', 'O painel abre pelo que precisa de você: o que acabou, o que venceu.'],
  ['A equipe no mesmo quadro', 'Tarefas, metas e o desempenho de cada um.'],
]

export default async function Entrar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params
  const org = await acharOrgPorSlug(empresa)
  if (!org) notFound()

  const modo = await lerModo()
  const suspensa = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'

  const cartao = (
    <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-borda bg-superficie p-7 shadow-norte-alta">
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
  )

  // A chave do modo fica no pé da página, miúda: quem entra todo dia não
  // precisa dela, e quem precisa acha onde espera achar.
  const pe = (
    <div className="flex flex-col items-center gap-2">
      <div className="w-44">
        <TrocaModo atual={modo} />
      </div>
      <p className="text-center text-xs text-tinta-3">Cada empresa entra pelo próprio endereço.</p>
    </div>
  )

  if (modo === 'simples') {
    return (
      <main
        className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-fundo p-6"
        style={{
          background:
            'radial-gradient(48rem 28rem at 50% -10%, color-mix(in srgb, var(--marca) 10%, transparent) 0%, transparent 70%), var(--fundo)',
        }}
      >
        <Marca tamanho={32} />
        {cartao}
        {pe}
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col bg-superficie md:flex-row">
      {/* ── lado da marca ── */}
      <aside
        className="flex flex-col justify-between gap-10 border-b border-borda p-6 md:w-[44%] md:max-w-lg md:border-r md:border-b-0 md:p-10"
        style={{
          background:
            'radial-gradient(40rem 30rem at 0% 0%, color-mix(in srgb, var(--marca) 12%, transparent) 0%, transparent 70%), var(--marca-suave)',
        }}
      >
        <Marca tamanho={30} />

        <div className="hidden flex-col gap-8 md:flex">
          <div className="flex flex-col gap-5">
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
        </div>

        <span aria-hidden className="hidden md:block" />
      </aside>

      {/* ── lado do trabalho ── */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-fundo p-6">
        {cartao}
        {pe}
      </div>
    </main>
  )
}
