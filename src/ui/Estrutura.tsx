// A moldura do sistema: barra lateral fixa e cabeçalho.
//
// Duas coisas que valem reparar:
//
// 1. O MENU NASCE DA PERMISSÃO. Cada item declara a capacidade que exige, e
//    quem não pode simplesmente não vê. Não existe item cinza "sem acesso" —
//    isso só ensina o que a pessoa está perdendo.
// 2. A CONTAGEM AO LADO DO ITEM É INFORMAÇÃO. O dono vê que tem 12 peças sem
//    foto sem clicar em nada. É o que faz a barra lateral valer o espaço.
// 3. A BARRA É AZUL-NOITE, e isso não é gosto. Ela é o maior bloco de cor da
//    tela: cinza claro fazia o sistema parecer formulário de banco, e cor de
//    marca fraca não segura a identidade do produto. Escura, ela separa o que
//    é o SISTEMA (navegação, sempre igual) do que é o TRABALHO (área branca,
//    muda o tempo todo) — e faz o verde e o vermelho da direita saltarem mais,
//    porque agora eles têm um lado quieto para contrastar.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { pode, type Capacidade, type Sessao } from '@/servidor/permissao'
import { moduloLigado, type Modulo } from '@/servidor/modulos'
import { sairAcao } from '@/app/[empresa]/acoes'
import { TrocaTema, type Tema } from './TrocaTema'
import { Simbolo } from './Marca'
import { cx, Ponto } from './base'

export type ItemMenu = {
  href: string
  titulo: string
  exige: Capacidade
  /// Só aparece se a empresa usa este módulo. Sem isto, quem não vende fiado
  /// veria Crediário parado no menu para sempre.
  modulo?: Modulo
  contagem?: number
  /** Bolinha de aviso: quantos precisam de olhada, e com que urgência. */
  aviso?: { quantos: number; nivel: 'critico' | 'atencao' | 'bom'; titulo: string }
  /** Está no plano, ainda não foi construído. Aparece, mas não é clicável. */
  emBreve?: boolean
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
      {/* `sticky` + `h-dvh`: sem isso a barra tem a altura da PÁGINA, não a da
          tela — e numa tela longa ela acaba no meio, deixando um pedaço branco
          embaixo do azul. Grudada, ela também continua à mão depois de rolar,
          que é o que se espera de navegação de sistema. */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-0.5 overflow-y-auto bg-nav p-2.5 md:flex">
        {/* A marca do produto em cima, o nome da empresa embaixo. Nessa ordem:
            quem paga a mensalidade é a empresa, mas quem responde pelo sistema
            somos nós — e no dia do suporte a pessoa precisa saber o nome do
            que ela está usando. A cor da empresa vira o traço ao lado. */}
        <div className="flex items-center gap-2 px-1.5 pt-1 pb-1">
          <Simbolo tamanho={26} nu id="marca-barra" />
          <span className="text-[15px] font-extrabold tracking-[-0.035em] text-nav-tinta">
            Norte
          </span>
        </div>
        <div className="mb-3 flex items-center gap-2 px-1.5">
          <span
            aria-hidden
            className="h-3.5 w-1 shrink-0 rounded-full"
            style={{ background: empresa.corMarca || 'var(--sol-claro)' }}
          />
          <span className="truncate text-xs font-semibold text-nav-tinta-2">{empresa.nome}</span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {visiveis.map((i) => {
            const aqui = i.href === ativo

            // Ainda não construído: entra como texto, não como link. Item que
            // leva a 404 faz o sistema parecer quebrado, e quem clicou não tem
            // como saber que o problema não é ele.
            if (i.emBreve) {
              return (
                <span
                  key={i.href}
                  className="flex cursor-default items-center justify-between gap-2 rounded-norte px-2.5 py-2 text-sm font-medium text-nav-tinta-2/55"
                  title="Está no plano, ainda não foi construída"
                >
                  <span className="truncate">{i.titulo}</span>
                  <span className="shrink-0 rounded border border-nav-borda px-1 py-px text-[9px] font-bold tracking-wide text-nav-tinta-2/70 uppercase">
                    em breve
                  </span>
                </span>
              )
            }

            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={aqui ? 'page' : undefined}
                className={cx(
                  'flex items-center justify-between gap-2 rounded-norte px-2.5 py-2 text-sm transition-colors',
                  aqui
                    ? 'bg-nav-3 font-semibold text-nav-tinta'
                    : 'font-medium text-nav-tinta-2 hover:bg-nav-2 hover:text-nav-tinta',
                )}
              >
                <span className="truncate">{i.titulo}</span>
                {/* O aviso ganha da contagem: o que pede ação vem primeiro. */}
                {i.aviso ? (
                  <Ponto nivel={i.aviso.nivel} quantos={i.aviso.quantos} titulo={i.aviso.titulo} />
                ) : i.contagem !== undefined ? (
                  <span className="numero shrink-0 text-xs font-semibold text-nav-tinta-2">
                    {i.contagem}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-nav-borda px-1.5 pt-3">
          <Link
            href={`/${empresa.slug}/configuracoes`}
            className="text-xs font-medium text-nav-tinta-2 underline-offset-2 hover:text-nav-tinta hover:underline"
          >
            Configurações
          </Link>
          <TrocaTema inicial={tema} />
          <p className="truncate text-xs text-nav-tinta-2" title={sessao.nome}>
            {sessao.nome}
          </p>
          <form action={sairAcao}>
            <input type="hidden" name="empresa" value={empresa.slug} />
            <button
              type="submit"
              className="text-xs font-medium text-nav-tinta-2 underline-offset-2 hover:text-nav-tinta hover:underline"
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
