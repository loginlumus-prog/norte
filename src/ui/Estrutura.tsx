// A moldura do sistema: barra lateral fixa e cabeçalho.
//
// Quatro coisas que valem reparar:
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
// 4. O MESMO MENU VAI PARA O CELULAR. Abaixo de `md` a barra some e entra uma
//    gaveta com a mesma lista, já filtrada. Antes disso o telefone não tinha
//    menu NENHUM: quem entrava pelo celular caía no painel e não saía dele.

import Link from 'next/link'
import { resumoDaBarra } from '@/servidor/assinatura'
import type { ReactNode } from 'react'
import { pode, type Capacidade, type Sessao } from '@/servidor/permissao'
import { moduloLigado, type Modulo } from '@/servidor/modulos'
import { sairAcao } from '@/app/[empresa]/acoes'
import { TRANCA_MIN, AVISO_SEG } from '@/servidor/presenca'
import { TrocaTema, type Tema } from './TrocaTema'
import { Simbolo } from './Marca'
import { Gaveta } from './Gaveta'
import { Tranca } from './Tranca'
import { Guia } from './Guia'
import { cx, Ponto } from './base'

export type ItemMenu = {
  href: string
  titulo: string
  exige: Capacidade
  /** Em que grupo o item aparece. Sem grupo, fica no topo, sozinho. */
  grupo?: string
  /// Só aparece se a empresa usa este módulo. Sem isto, quem não vende fiado
  /// veria Crediário parado no menu para sempre.
  modulo?: Modulo
  contagem?: number
  /** Bolinha de aviso: quantos precisam de olhada, e com que urgência. */
  aviso?: { quantos: number; nivel: 'critico' | 'atencao' | 'bom'; titulo: string }
  /** Está no plano, ainda não foi construído. Aparece, mas não é clicável. */
  emBreve?: boolean
}

export async function Estrutura({
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
  // A moldura busca o proprio resumo do plano: assim as doze telas nao
  // precisam passar isso adiante uma por uma, e nenhuma esquece.
  const assinatura = pode(sessao, 'empresa.configurar')
    ? await resumoDaBarra(sessao.orgId)
    : null

  // Duas perguntas, não uma: "esta pessoa pode?" E "esta empresa usa?".
  const visiveis = itens.filter(
    (i) => pode(sessao, i.exige) && (!i.modulo || moduloLigado(empresa, i.modulo)),
  )

  // Os grupos na ordem em que aparecem pela primeira vez. Grupo que ficou sem
  // item (o balconista não vê nada de "Empresa") some junto com o título —
  // título sem nada embaixo é a única coisa pior que item sem acesso.
  const soltos = visiveis.filter((i) => !i.grupo)
  const grupos: { nome: string; itens: ItemMenu[] }[] = []
  for (const i of visiveis) {
    if (!i.grupo) continue
    const g = grupos.find((x) => x.nome === i.grupo)
    if (g) g.itens.push(i)
    else grupos.push({ nome: i.grupo, itens: [i] })
  }

  const item = (i: ItemMenu) => {
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
  }

  // A lista inteira, uma vez: vai para a barra e vai para a gaveta.
  const navegacao = (
    <nav className="flex flex-col gap-0.5">
      {soltos.map(item)}
      {grupos.map((g) => (
        <div key={g.nome} className="mt-2.5 flex flex-col gap-0.5">
          {/* O título do grupo é miúdo e apagado de propósito: ele organiza,
              não compete. Se tivesse o peso de um item, a pessoa clicaria. */}
          <span className="px-2.5 pb-1 text-[10px] font-bold tracking-[0.12em] text-nav-tinta-2/60 uppercase">
            {g.nome}
          </span>
          {g.itens.map(item)}
        </div>
      ))}
    </nav>
  )

  const rodape = (
    <div className="mt-auto flex flex-col gap-2 border-t border-nav-borda px-1.5 pt-3">
      {/* O plano fica a vista, no rodape da barra, em toda tela.
          Escondido dentro de Configuracoes, ninguem lembra do que
          contratou — e quando o limite bate, a mensagem chega como
          surpresa. Aqui ele e informacao de fundo, e vira alerta sozinho
          quando ha algo a resolver. */}
      {assinatura && (
        <Link
          href={`/${empresa.slug}/assinatura`}
          className={cx(
            'flex items-center justify-between gap-2 rounded-norte border px-2 py-1.5',
            assinatura.alerta
              ? 'border-atencao-vivo/50 bg-atencao-vivo/10'
              : 'border-nav-borda hover:bg-nav-2',
          )}
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-[10px] font-medium tracking-wide text-nav-tinta-2 uppercase">
              plano
            </span>
            <span className="truncate text-xs font-bold text-nav-tinta">
              {assinatura.titulo}
            </span>
          </span>
          {assinatura.alerta ? (
            <span
              aria-label="há algo para resolver na assinatura"
              className="respira size-2 shrink-0 rounded-full bg-atencao-vivo"
            />
          ) : (
            <span aria-hidden className="shrink-0 text-xs text-nav-tinta-2">
              ›
            </span>
          )}
        </Link>
      )}

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
  )

  const marca = (
    <>
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
    </>
  )

  return (
    <div className="flex min-h-dvh">
      {/* `sticky` + `h-dvh`: sem isso a barra tem a altura da PÁGINA, não a da
          tela — e numa tela longa ela acaba no meio, deixando um pedaço branco
          embaixo do azul. Grudada, ela também continua à mão depois de rolar,
          que é o que se espera de navegação de sistema. */}
      <aside className="nav-fundo sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-0.5 overflow-y-auto p-2.5 md:flex">
        {marca}
        {navegacao}
        {rodape}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* A barra de cima do celular: azul-noite como a lateral, para a
            pessoa reconhecer que é o mesmo sistema. Some de `md` para cima. */}
        <div className="nav-fundo flex items-center gap-2 px-2 py-1.5 md:hidden">
          <Gaveta rotulo={empresa.nome}>
            <div className="flex min-h-full flex-col gap-0.5">
              {marca}
              {navegacao}
              {rodape}
            </div>
          </Gaveta>
          <Simbolo tamanho={22} nu id="marca-topo" />
          <span className="truncate text-sm font-bold text-nav-tinta">{empresa.nome}</span>
        </div>

        {/* No celular o título fica em cima e os seletores embaixo: lado a
            lado, o seletor de período engolia o título ("C..."). */}
        <header className="flex flex-col gap-2 border-b border-borda bg-superficie px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h1 className="truncate text-base font-bold tracking-tight">{titulo}</h1>
          {acao}
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </div>

      {/* Trinta minutos parada, a tela tranca e pede a senha. Mora aqui
          porque aqui é por onde toda tela passa — ver Tranca.tsx. */}
      <Tranca slug={empresa.slug} nome={sessao.nome} trancaMin={TRANCA_MIN} avisoSeg={AVISO_SEG} />
      <Guia slug={empresa.slug} empresa={empresa.nome} nome={sessao.nome} />
    </div>
  )
}
