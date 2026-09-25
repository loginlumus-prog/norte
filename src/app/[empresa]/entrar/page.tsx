import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { lerModo } from '@/servidor/modo'
import { Aviso } from '@/ui/base'
import { Marca } from '@/ui/Marca'
import { IconeDoItem } from '@/ui/IconesMenu'
import { Formulario } from './Formulario'

// A tela de entrar é a primeira coisa que o cliente vê todo dia de manhã.
//
// ── dois jeitos, e quem escolhe é o aparelho ─────────────────
// Ela segue o modo do aparelho (`servidor/modo.ts`), mas NÃO troca o modo:
// a chave mora lá dentro, no cabeçalho de toda tela. Aqui a pessoa só entra.
//
//   SIMPLES   o cartão no meio, grande e calmo: a empresa, o bom-dia e os
//             dois campos. É o computador do balcão — a pessoa chega, digita
//             e vai vender.
//   AVANÇADO  a tela dividida: à esquerda a empresa e o que o Norte cuida
//             para ela, com os mesmos ícones do menu; à direita o cartão. É o
//             notebook do dono, que gosta de ver onde está entrando.
//
// ── sem desenho ──────────────────────────────────────────────
// Desde 25/09 não há ilustração em lugar nenhum do site, por decisão do dono.
// O que dá presença à tela é a tipografia, a luz suave do fundo e a própria
// marca da empresa — a inicial dela na cor dela, que é o que a pessoa
// reconhece como "a minha loja".

const CUIDA: { href: string; titulo: string; linha: string }[] = [
  { href: '/x/balcao', titulo: 'Balcão', linha: 'Venda em poucos toques, caixa conferido.' },
  { href: '/x/estoque', titulo: 'Estoque', linha: 'O que acabou e o que vai faltar.' },
  { href: '/x/financeiro', titulo: 'Financeiro', linha: 'Contas, recebimentos e o resultado.' },
  { href: '/x/clientes', titulo: 'Clientes', linha: 'Histórico, fiado e quem sumiu.' },
  { href: '/x/tarefas', titulo: 'Tarefas', linha: 'A equipe no mesmo quadro.' },
  { href: '/x/agente', titulo: 'Assistente', linha: 'Responde no WhatsApp pela loja.' },
]

const GARANTIAS = [
  'Os dados de cada empresa ficam separados',
  'A tela tranca sozinha quando fica parada',
  'Cada pessoa entra com o próprio acesso',
]

function saudacao(): string {
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date()),
  )
  return hora < 5 ? 'Boa noite' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
}

export default async function Entrar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params
  const org = await acharOrgPorSlug(empresa)
  if (!org) notFound()

  const modo = await lerModo()
  const suspensa = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'
  const cor = org.corMarca || 'var(--marca)'
  const inicial = org.nome.trim().charAt(0).toUpperCase() || 'N'
  const ola = saudacao()

  const cartao = (
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
          <span className="text-sm text-tinta-2">{ola}! Entre para continuar.</span>
        </span>
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

  const rodape = (
    <p className="text-center text-xs text-tinta-3">
      Cada empresa entra pelo próprio endereço · conexão protegida
    </p>
  )

  // Luz, não desenho: dois halos da cor da marca, um em cima e um no canto.
  const luz = {
    background: `radial-gradient(60rem 32rem at 50% -12%, color-mix(in srgb, var(--marca) 11%, transparent) 0%, transparent 65%), radial-gradient(36rem 24rem at 100% 100%, color-mix(in srgb, ${cor} 8%, transparent) 0%, transparent 70%), var(--fundo)`,
  }

  if (modo === 'simples') {
    return (
      <main className="flex min-h-dvh flex-col bg-fundo" style={luz}>
        <div className="flex items-center justify-between px-6 py-5 sm:px-10">
          <Marca tamanho={28} />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 pb-16">
          {cartao}
          {rodape}
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh bg-fundo lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* ── a empresa e o que o Norte cuida para ela ── */}
      <aside
        className="relative hidden flex-col justify-between gap-12 overflow-hidden border-r border-borda p-12 lg:flex xl:p-16"
        style={{
          background: `radial-gradient(48rem 36rem at 0% 0%, color-mix(in srgb, ${cor} 14%, transparent) 0%, transparent 60%), radial-gradient(40rem 30rem at 100% 100%, color-mix(in srgb, var(--marca) 10%, transparent) 0%, transparent 65%), var(--superficie)`,
        }}
      >
        <Marca tamanho={30} />

        <div className="entra flex max-w-xl flex-col gap-10">
          <div className="flex flex-col gap-4">
            <span className="text-xs font-bold tracking-[0.14em] text-tinta-3 uppercase">
              {ola}
            </span>
            <h1 className="text-[clamp(2rem,3.2vw,2.9rem)] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-titulo">
              {org.nome}, a empresa inteira numa tela só.
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-tinta-2">
              Do balcão ao financeiro, com o que precisa de você hoje logo na primeira tela.
            </p>
          </div>

          <ul className="grid grid-cols-2 gap-3">
            {CUIDA.map((c) => (
              <li
                key={c.titulo}
                className="flex items-start gap-3 rounded-2xl border border-borda-suave bg-superficie/80 p-3.5 backdrop-blur-sm"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-marca-suave text-marca">
                  <IconeDoItem href={c.href} tamanho={18} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-tinta">{c.titulo}</span>
                  <span className="text-xs leading-snug text-tinta-2">{c.linha}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {GARANTIAS.map((g) => (
            <li key={g} className="flex items-center gap-2 text-xs font-medium text-tinta-2">
              <span aria-hidden className="size-1.5 rounded-full bg-bom-vivo" />
              {g}
            </li>
          ))}
        </ul>
      </aside>

      {/* ── o cartão ── */}
      <div className="flex min-h-dvh flex-col" style={luz}>
        <div className="flex items-center px-6 py-5 sm:px-10 lg:hidden">
          <Marca tamanho={28} />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 pb-16 lg:pb-0">
          {cartao}
          {rodape}
        </div>
      </div>
    </main>
  )
}
