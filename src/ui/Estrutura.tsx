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
// 5. RECOLHIDA, ELA VIRA TRILHO. O balcão abre em tela cheia: a barra encolhe
//    para uma coluna de ícones e o trabalho ganha a largura toda. O ícone de
//    cada item (`IconesMenu.tsx`) existe para isso — no trilho ele é o item.
// 6. O MODO E O TEMA MORAM NO CABEÇALHO, à vista em toda tela. No rodapé da
//    barra eles ficavam embaixo da rolagem, e quem queria trocar não achava.
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
import { TrocaModo } from './TrocaModo'
import { lerModo } from '@/servidor/modo'
import { noModo } from './menu'
import { Simbolo } from './Marca'
import { Gaveta } from './Gaveta'
import { IconeDoItem } from './IconesMenu'
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
  /** Tela de análise: some do menu no modo simples. Ver `servidor/modo.ts`. */
  avancado?: boolean
}

export async function Estrutura({
  empresa,
  sessao,
  itens,
  ativo,
  tema,
  titulo,
  acao,
  recolhida = false,
  children,
}: {
  empresa: { nome: string; slug: string; corMarca?: string | null; modulos: string[] }
  sessao: Sessao
  itens: ItemMenu[]
  ativo: string
  tema: Tema
  titulo: string
  acao?: ReactNode
  /**
   * Tela de trabalho em tela cheia (o balcão): a barra vira trilho de ícones,
   * o cabeçalho encolhe e o conteúdo ocupa a altura da janela sem rolar a
   * página — quem rola são as colunas dele.
   */
  recolhida?: boolean
  children: ReactNode
}) {
  // A moldura busca o proprio resumo do plano: assim as doze telas nao
  // precisam passar isso adiante uma por uma, e nenhuma esquece.
  const assinatura = pode(sessao, 'empresa.configurar')
    ? await resumoDaBarra(sessao.orgId)
    : null

  const modo = await lerModo()
  const iniciais =
    sessao.nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '·'

  // Três perguntas: "esta pessoa pode?", "esta empresa usa?" e "este
  // aparelho está no modo que mostra isto?". A terceira nunca esconde a tela
  // aberta agora — ver `noModo`.
  const visiveis = noModo(
    itens.filter((i) => pode(sessao, i.exige) && (!i.modulo || moduloLigado(empresa, i.modulo))),
    modo,
    ativo,
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

  const item = (i: ItemMenu, trilho = false) => {
    const aqui = i.href === ativo

    // No trilho, só o ícone — o nome vai no `title` e no `aria-label`, e o
    // aviso vira um ponto no canto, para o que pede ação não sumir.
    if (trilho) {
      if (i.emBreve) return null
      return (
        <Link
          key={i.href}
          href={i.href}
          aria-current={aqui ? 'page' : undefined}
          aria-label={i.titulo}
          title={i.titulo}
          className={cx(
            'relative mx-auto grid size-10 shrink-0 place-items-center rounded-xl transition-colors',
            aqui
              ? 'bg-lado-3 text-lado-ativo'
              : 'text-lado-tinta-2 hover:bg-lado-2 hover:text-lado-tinta',
          )}
        >
          <IconeDoItem href={i.href} tamanho={20} />
          {i.aviso && (
            <span
              aria-hidden
              className={cx(
                'absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-lado',
                i.aviso.nivel === 'critico'
                  ? 'bg-critico-vivo'
                  : i.aviso.nivel === 'atencao'
                    ? 'bg-atencao-vivo'
                    : 'bg-bom-vivo',
              )}
            />
          )}
        </Link>
      )
    }

    // Ainda não construído: entra como texto, não como link. Item que
    // leva a 404 faz o sistema parecer quebrado, e quem clicou não tem
    // como saber que o problema não é ele.
    if (i.emBreve) {
      return (
        <span
          key={i.href}
          className="flex cursor-default items-center justify-between gap-2 rounded-norte px-2.5 py-2 text-sm font-medium text-lado-tinta-2/55"
          title="Está no plano, ainda não foi construída"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <IconeDoItem href={i.href} className="shrink-0" />
            <span className="truncate">{i.titulo}</span>
          </span>
          <span className="shrink-0 rounded border border-lado-borda px-1 py-px text-[9px] font-bold tracking-wide text-lado-tinta-2/70 uppercase">
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
          'flex items-center justify-between gap-2 rounded-norte px-2.5 py-[7px] text-sm transition-colors',
          aqui
            ? 'bg-lado-3 font-semibold text-lado-ativo'
            : 'font-medium text-lado-tinta-2 hover:bg-lado-2 hover:text-lado-tinta',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <IconeDoItem
            href={i.href}
            className={cx('shrink-0', aqui ? 'text-lado-ativo' : 'text-lado-tinta-2')}
          />
          <span className="truncate">{i.titulo}</span>
        </span>
        {/* O aviso ganha da contagem: o que pede ação vem primeiro. */}
        {i.aviso ? (
          <Ponto nivel={i.aviso.nivel} quantos={i.aviso.quantos} titulo={i.aviso.titulo} />
        ) : i.contagem !== undefined ? (
          <span className="numero shrink-0 text-xs font-semibold text-lado-tinta-2">
            {i.contagem}
          </span>
        ) : null}
      </Link>
    )
  }

  // A lista inteira, uma vez: vai para a barra e vai para a gaveta.
  const navegacao = (
    <nav className="flex flex-col gap-0.5">
      {soltos.map((i) => item(i))}
      {grupos.map((g) => (
        <div key={g.nome} className="mt-2.5 flex flex-col gap-0.5">
          {/* O título do grupo é miúdo e apagado de propósito: ele organiza,
              não compete. Se tivesse o peso de um item, a pessoa clicaria. */}
          <span className="px-2.5 pb-1 text-[10px] font-bold tracking-[0.12em] text-lado-tinta-2/75 uppercase">
            {g.nome}
          </span>
          {g.itens.map((i) => item(i))}
        </div>
      ))}
    </nav>
  )

  // O mesmo menu, só de ícones. Os grupos viram um fio entre eles: o título
  // não cabe, e a separação ainda ajuda o olho a achar o pedaço certo.
  const trilho = (
    <nav aria-label="Menu" className="flex flex-col gap-1">
      {soltos.map((i) => item(i, true))}
      {grupos.map((g) => (
        <div key={g.nome} className="mt-0.5 flex flex-col gap-1 border-t border-lado-borda pt-1.5">
          {g.itens.map((i) => item(i, true))}
        </div>
      ))}
    </nav>
  )

  const rodape = (
    <div className="mt-auto flex flex-col gap-2 border-t border-lado-borda px-1.5 pt-3">
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
              : 'border-lado-borda hover:bg-lado-2',
          )}
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-[10px] font-medium tracking-wide text-lado-tinta-2 uppercase">
              plano
            </span>
            <span className="truncate text-xs font-bold text-lado-tinta">
              {assinatura.titulo}
            </span>
          </span>
          {assinatura.alerta ? (
            <span
              aria-label="há algo para resolver na assinatura"
              className="respira size-2 shrink-0 rounded-full bg-atencao-vivo"
            />
          ) : (
            <span aria-hidden className="shrink-0 text-xs text-lado-tinta-2">
              ›
            </span>
          )}
        </Link>
      )}

      <div className="flex items-center gap-2 px-1">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-lado-3 text-[11px] font-bold text-lado-ativo"
        >
          {iniciais}
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-lado-tinta" title={sessao.nome}>
          {sessao.nome}
        </p>
        <form action={sairAcao}>
          <input type="hidden" name="empresa" value={empresa.slug} />
          <button
            type="submit"
            className="rounded px-1.5 py-1 text-xs font-medium text-lado-tinta-2 hover:bg-lado-2 hover:text-lado-tinta"
          >
            Sair
          </button>
        </form>
      </div>
    </div>
  )

  // No trilho, o rodapé é a pessoa: as iniciais, e o sair logo abaixo.
  const rodapeTrilho = (
    <div className="mt-auto flex flex-col items-center gap-1.5 border-t border-lado-borda pt-2">
      <span
        title={sessao.nome}
        className="grid size-8 place-items-center rounded-full bg-lado-3 text-[11px] font-bold text-lado-ativo"
      >
        {iniciais}
      </span>
      <form action={sairAcao}>
        <input type="hidden" name="empresa" value={empresa.slug} />
        <button
          type="submit"
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-lado-tinta-2 hover:bg-lado-2 hover:text-lado-tinta"
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
        {/* Com o azulejo, e não nu: no claro a barra é branca e o losango
            branco sumiria nela. O azulejo azul-noite serve aos dois temas. */}
        <Simbolo tamanho={26} id="marca-barra" />
        <span className="text-[15px] font-extrabold tracking-[-0.035em] text-lado-tinta">
          Norte
        </span>
      </div>
      <div className="mb-3 flex items-center gap-2 px-1.5">
        <span
          aria-hidden
          className="h-3.5 w-1 shrink-0 rounded-full"
          style={{ background: empresa.corMarca || 'var(--sol-claro)' }}
        />
        <span className="truncate text-xs font-semibold text-lado-tinta-2">{empresa.nome}</span>
      </div>
    </>
  )

  return (
    <div className={cx('flex', recolhida ? 'h-dvh overflow-hidden' : 'min-h-dvh')}>
      {/* `sticky` + `h-dvh`: sem isso a barra tem a altura da PÁGINA, não a da
          tela — e numa tela longa ela acaba no meio, deixando um pedaço branco
          embaixo do azul. Grudada, ela também continua à mão depois de rolar,
          que é o que se espera de navegação de sistema. */}
      {recolhida ? (
        <aside className="sticky top-0 hidden h-dvh w-[68px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-lado-borda bg-lado px-2 py-3 md:flex">
          <Link
            href={`/${empresa.slug}`}
            aria-label={`Norte · ${empresa.nome}`}
            title={empresa.nome}
            className="mx-auto mb-1"
          >
            <Simbolo tamanho={30} id="marca-trilho" />
          </Link>
          {trilho}
          {rodapeTrilho}
        </aside>
      ) : (
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-lado-borda bg-lado p-2.5 md:flex">
          {marca}
          {navegacao}
          {rodape}
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* A barra de cima do celular: azul-noite como a lateral, para a
            pessoa reconhecer que é o mesmo sistema. Some de `md` para cima. */}
        <div className="flex items-center gap-2 border-b border-lado-borda bg-lado px-2 py-1.5 md:hidden">
          <Gaveta rotulo={empresa.nome}>
            <div className="flex min-h-full flex-col gap-0.5">
              {marca}
              {navegacao}
              {rodape}
            </div>
          </Gaveta>
          <Simbolo tamanho={22} id="marca-topo" />
          <span className="truncate text-sm font-bold text-lado-tinta">{empresa.nome}</span>
        </div>

        {/* No celular o título fica em cima e os seletores embaixo: lado a
            lado, o seletor de período engolia o título ("C..."). */}
        {/* O título nunca é cortado. Antes ele era `truncate` ao lado dos
            seletores, e numa tela de 1.000px o seletor de período comia o
            nome da tela até sobrar "Pai...". Agora os dois dividem a linha
            enquanto cabem, e os seletores descem para baixo quando não cabem. */}
        <header
          className={cx(
            'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-borda bg-superficie px-4 md:px-6',
            recolhida ? 'py-2' : 'py-2.5',
          )}
        >
          <h1 className="shrink-0 text-base font-bold tracking-tight">{titulo}</h1>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {acao}
            {/* O modo muda o que a pessoa vê; o tema, só a cor. Os dois à
                vista em toda tela, e não perdidos no pé da barra. */}
            <TrocaModo atual={modo} tom="topo" />
            <TrocaTema inicial={tema} tom="papel" />
          </div>
        </header>
        <main
          className={cx(
            'flex flex-1 flex-col',
            recolhida ? 'min-h-0 overflow-hidden' : 'gap-5 p-4 md:p-6',
          )}
        >
          {children}
        </main>
      </div>

      {/* Trinta minutos parada, a tela tranca e pede a senha. Mora aqui
          porque aqui é por onde toda tela passa — ver Tranca.tsx. */}
      <Tranca slug={empresa.slug} nome={sessao.nome} trancaMin={TRANCA_MIN} avisoSeg={AVISO_SEG} />
      <Guia slug={empresa.slug} empresa={empresa.nome} nome={sessao.nome} />
    </div>
  )
}
