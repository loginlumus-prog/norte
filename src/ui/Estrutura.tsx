// A moldura do sistema: barra lateral fixa e cabeçalho.
//
// Duas coisas que valem reparar:
//
// 1. O MENU NASCE DA PERMISSÃO. Cada item declara a capacidade que exige, e
//    quem não pode simplesmente não vê. Não existe item cinza "sem acesso" —
//    isso só ensina o que a pessoa está perdendo.
// 2. A CONTAGEM AO LADO DO ITEM É INFORMAÇÃO. O dono vê que tem 12 peças sem
//    foto sem clicar em nada. É o que faz a barra lateral valer o espaço.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { pode, type Capacidade, type Sessao } from '@/servidor/permissao'
import { moduloLigado, type Modulo } from '@/servidor/modulos'
import { sairAcao } from '@/app/[empresa]/acoes'
import { TrocaTema, type Tema } from './TrocaTema'
import { cx } from './base'

export type ItemMenu = {
  href: string
  titulo: string
  exige: Capacidade
  /// Só aparece se a empresa usa este módulo. Sem isto, quem não vende fiado
  /// veria Crediário parado no menu para sempre.
  modulo?: Modulo
  contagem?: number
  /** true quando algo ali precisa de atenção — pinta a contagem */
  alerta?: boolean
}

export function Estrutura({
  empresa,
  sessao,
  itens,
  ativo,
  tema,
  titulo,
  acao,
  children,
}: {
  empresa: { nome: string; slug: string; corMarca?: string | null; modulos: string[] }
  sessao: Sessao
  itens: ItemMenu[]
  ativo: string
  tema: Tema
  titulo: string
  acao?: ReactNode
  children: ReactNode
}) {
  // Duas perguntas, não uma: "esta pessoa pode?" E "esta empresa usa?".
  const visiveis = itens.filter(
    (i) => pode(sessao, i.exige) && (!i.modulo || moduloLigado(empresa, i.modulo)),
  )

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-56 shrink-0 flex-col gap-0.5 border-r border-borda bg-superficie-2 p-2 md:flex">
        <div className="flex items-center gap-2 px-2 pt-1 pb-3">
          <span
            aria-hidden
            className="size-5 shrink-0 rounded"
            style={{ background: empresa.corMarca || 'var(--marca)' }}
          />
          <span className="truncate text-sm font-bold text-tinta">{empresa.nome}</span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {visiveis.map((i) => {
            const aqui = i.href === ativo
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={aqui ? 'page' : undefined}
                className={cx(
                  'flex items-center justify-between gap-2 rounded-norte px-2 py-1.5 text-sm',
                  aqui
                    ? 'bg-superficie font-semibold text-tinta shadow-[inset_0_0_0_1px_var(--borda)]'
                    : 'font-medium text-tinta-2 hover:bg-superficie hover:text-tinta',
                )}
              >
                <span className="truncate">{i.titulo}</span>
                {i.contagem !== undefined && (
                  <span
                    className={cx(
                      'numero shrink-0 rounded px-1 text-xs font-semibold',
                      i.alerta ? 'bg-atencao-fundo text-atencao' : 'text-tinta-3',
                    )}
                  >
                    {i.contagem}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 px-2 pt-3">
          <Link
            href={`/${empresa.slug}/configuracoes`}
            className="text-xs font-medium text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
          >
            Configurações
          </Link>
          <TrocaTema inicial={tema} />
          <p className="truncate text-xs text-tinta-3" title={sessao.nome}>
            {sessao.nome}
          </p>
          <form action={sairAcao}>
            <input type="hidden" name="empresa" value={empresa.slug} />
            <button
              type="submit"
              className="text-xs font-medium text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-borda bg-superficie px-4 py-2.5">
          <h1 className="truncate text-base font-bold tracking-tight text-tinta">{titulo}</h1>
          {acao}
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </div>
    </div>
  )
}
