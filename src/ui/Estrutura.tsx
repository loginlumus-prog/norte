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
//    No CELULAR eles vão para a gaveta: no cabeçalho estreito a chave do tema
//    sobrava sozinha numa linha, e a tela começava na terceira.
// 4. O MESMO MENU VAI PARA O CELULAR. Abaixo de `md` a barra some e entra uma
//    gaveta com a mesma lista, já filtrada. Antes disso o telefone não tinha
//    menu NENHUM: quem entrava pelo celular caía no painel e não saía dele.

import Link from 'next/link'
import { cookies } from 'next/headers'
import type { CSSProperties } from 'react'
import { resumoDaBarra } from '@/servidor/assinatura'
import type { ReactNode } from 'react'
import { CAPACIDADES, pode, type Capacidade, type Sessao } from '@/servidor/permissao'
import { moduloLigado, type Modulo } from '@/servidor/modulos'
import { vocabularioDaEmpresa, nomesNoGuia, nomeDoGrupo, type PalavraDoMenu } from '@/servidor/vocabulario'
import { sairAcao } from '@/app/[empresa]/acoes'
import { TRANCA_MIN, AVISO_SEG, trancadaAoAbrir } from '@/servidor/presenca'
import { lerSessao, ultimoToque } from '@/servidor/sessao'
import type { Tema } from './TrocaTema'
import { lerModo } from '@/servidor/modo'
import { menuRecolhido } from '@/servidor/menu-lateral'
import { BarraLateral } from './BarraLateral'
import { AvisoVersao } from '@/app/[empresa]/balcao/AvisoVersao'
import { versaoDoBuild } from '@/app/[empresa]/balcao/versaoDoBuild'
import { GRUPOS_FORA_DA_FABRICA, MENU_DA_FABRICA, itemNaEmpresa, noModo, podeVerItem } from './menu'
import { Simbolo } from './Marca'
import { Gaveta } from './Gaveta'
import { IconeDoItem } from './IconesMenu'
import { Tranca } from './Tranca'
import { Guia } from './Guia'
import { AcoesDoTopo } from './AcoesDoTopo'
import { cx, Ponto } from './base'
import { cookieDasCores, corDoGrupo, lerCores } from './cores-menu'
import { CoresDoMenu } from './CoresDoMenu'
import { Preferencias } from './Preferencias'
import { TrocaDeLoja } from './TrocaDeLoja'
import { escolherUnidade } from '@/servidor/unidade'

export type ItemMenu = {
  href: string
  titulo: string
  exige: Capacidade
  /**
   * Outras capacidades que TAMBÉM abrem o item (basta uma). Para a tela que
   * serve a papéis diferentes: Funcionários abre para quem bate o próprio
   * ponto e para o contador, que só lê as horas.
   */
  ouExige?: Capacidade[]
  /** Em que grupo o item aparece. Sem grupo, fica no topo, sozinho. */
  grupo?: string
  /// Só aparece se a empresa usa este módulo. Sem isto, quem não vende fiado
  /// veria Crediário parado no menu para sempre.
  modulo?: Modulo
  /// Aparece se a empresa usa QUALQUER um destes. É o caso de Funcionários:
  /// a lista de quem trabalha serve ao Ponto e à Agenda.
  modulos?: Modulo[]
  /// O título é a palavra do ramo: quem a empresa atende ("Pacientes",
  /// "Alunos"), o balcão ("Recepção", "Secretaria") ou o catálogo ("Serviços
  /// e materiais") — ver servidor/vocabulario.ts.
  vocabulario?: PalavraDoMenu
  contagem?: number
  /** Bolinha de aviso: quantos precisam de olhada, e com que urgência. */
  aviso?: { quantos: number; nivel: 'critico' | 'atencao' | 'bom'; titulo: string }
  /** Está no plano, ainda não foi construído. Aparece, mas não é clicável. */
  emBreve?: boolean
  /** Tela de análise: some do menu no modo simples. Ver `servidor/modo.ts`. */
  avancado?: boolean
  /** O grupo antes do vocabulário do ramo ("Vender", e não "Recepção"): é a chave da cor. */
  chaveGrupo?: string
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
  // A loja em que a pessoa está (a lembrada neste aparelho), para o cartão
  // de trocar de loja no alto da barra. Só aparece para quem tem mais de uma.
  const lojas = await escolherUnidade(sessao, empresa, undefined, 'venda.ver')
  // Dentro da fábrica (a unidade escolhida é uma fábrica, e a fábrica está
  // contratada), o menu é o dela: produção, fichas, pedidos das lojas,
  // estoque e compras — mais Pessoas, Dinheiro e Empresa, que valem em
  // qualquer lugar. A loja não vê a produção, e a fábrica não vê o balcão.
  const naFabrica =
    moduloLigado(empresa, 'fabrica') && !!lojas.opcoes.find((u) => u.id === lojas.unidadeId)?.ehFabrica
  const itensDaTela = naFabrica
    ? [...MENU_DA_FABRICA(empresa.slug), ...itens.filter((i) => GRUPOS_FORA_DA_FABRICA.includes(i.grupo ?? ''))]
    : itens
  // A lateral: a escolha da pessoa neste aparelho; sem escolha, o padrão da
  // tela (o balcão abre recolhido). `recolhida` continua mandando no resto
  // da moldura (altura da janela, sem rolar a página); a lateral é só dela.
  const barraRecolhida = await menuRecolhido(recolhida)
  // A tela já nasce trancada quando ninguém mexe neste aparelho há
  // TRANCA_MIN — senão o F5 (ou uma aba nova) destrancava. Ver `marcarToque`.
  const trancada = trancadaAoAbrir(
    new Date(),
    await ultimoToque(empresa.slug),
    (await lerSessao(empresa.slug))?.nasceu ?? null,
  )
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
  // O nome do cadastro de pessoas, do balcão, da lista de vendas e do
  // catálogo é a palavra do ramo ("Pacientes", "Recepção", "Recebimentos",
  // "Serviços e materiais") — e o do grupo "Vender" também.
  const vocab = await vocabularioDaEmpresa(sessao.orgId)
  const visiveis = noModo(
    itensDaTela
      .filter((i) => podeVerItem(sessao, i) && itemNaEmpresa(i, empresa))
      .map((i) => ({
        ...i,
        titulo: i.vocabulario ? vocab[i.vocabulario] : i.titulo,
        grupo: i.grupo && nomeDoGrupo(i.grupo, vocab),
        chaveGrupo: i.grupo ?? 'Painel',
      })),
    modo,
    ativo,
  )

  // Os grupos na ordem em que aparecem pela primeira vez. Grupo que ficou sem
  // item (o balconista não vê nada de "Empresa") some junto com o título —
  // título sem nada embaixo é a única coisa pior que item sem acesso.
  // A cor de cada área (cores-menu.ts): a escolhida neste aparelho, ou a padrão.
  const coresEscolhidas = lerCores((await cookies()).get(cookieDasCores(empresa.slug))?.value)
  const corDe = (i: ItemMenu) => ({ '--cor-item': corDoGrupo(i.chaveGrupo, coresEscolhidas) }) as CSSProperties

  // A tela aberta: o cabeçalho mostra o ícone e a área dela, na cor da área.
  const itemAtivo = visiveis.find((i) => i.href === ativo)

  const soltos = visiveis.filter((i) => !i.grupo)
  const grupos: { nome: string; chave: string; itens: ItemMenu[] }[] = []
  for (const i of visiveis) {
    if (!i.grupo) continue
    const g = grupos.find((x) => x.nome === i.grupo)
    if (g) g.itens.push(i)
    else grupos.push({ nome: i.grupo, chave: i.chaveGrupo ?? i.grupo, itens: [i] })
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
          style={corDe(i)}
          className="menu-trilho relative mx-auto grid size-10 shrink-0 place-items-center rounded-xl"
        >
          <IconeDoItem href={i.href} tamanho={19} />
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
          <span className="shrink-0 rounded border border-lado-borda px-1 py-px text-[10.5px] font-bold tracking-wide text-lado-tinta-2/70 uppercase">
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
        style={corDe(i)}
        className={cx(
          'menu-item flex items-center justify-between gap-2 rounded-xl py-1 pr-2 pl-1 text-sm',
          aqui ? 'font-semibold text-lado-tinta' : 'font-medium text-lado-tinta-2 hover:text-lado-tinta',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="menu-icone shrink-0">
            <IconeDoItem href={i.href} tamanho={16} />
          </span>
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
          <span className="flex items-center gap-2 px-2 pb-1 text-[11.5px] font-bold tracking-[0.12em] text-lado-tinta-2/80 uppercase">
            <span aria-hidden className="h-2.5 w-1 rounded-full" style={{ background: corDoGrupo(g.chave, coresEscolhidas) }} />
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
        <div key={g.nome} className="mt-0.5 flex flex-col gap-1 border-t pt-1.5" style={{ borderColor: `color-mix(in oklab, ${corDoGrupo(g.chave, coresEscolhidas)} 40%, transparent)` }}>
          {g.itens.map((i) => item(i, true))}
        </div>
      ))}
    </nav>
  )

  const rodape = (
    <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-lado-borda px-1.5 pt-3">
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
            <span className="text-[11.5px] font-medium tracking-wide text-lado-tinta-2 uppercase">
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

      <CoresDoMenu slug={empresa.slug} grupos={grupos.map((g) => ({ chave: g.chave, nome: g.nome }))} escolhidas={coresEscolhidas} />

      <div className="flex items-center gap-2 px-1">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--marca),#8b5cf6)] text-[12.5px] font-bold text-white shadow-sm"
        >
          {iniciais}
        </span>
        {/* O nome leva à conta da própria pessoa (trocar a senha). */}
        <Link
          href={`/${empresa.slug}/conta`}
          className="min-w-0 flex-1 truncate rounded text-xs font-semibold text-lado-tinta hover:underline"
          title={`${sessao.nome} · minha conta`}
        >
          {sessao.nome}
        </Link>
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
      <CoresDoMenu slug={empresa.slug} grupos={grupos.map((g) => ({ chave: g.chave, nome: g.nome }))} escolhidas={coresEscolhidas} compacto />
      <Link
        href={`/${empresa.slug}/conta`}
        title={`${sessao.nome} · minha conta`}
        aria-label={`${sessao.nome} · minha conta`}
        className="grid size-8 place-items-center rounded-full bg-lado-3 text-[12.5px] font-bold text-lado-ativo hover:ring-2 hover:ring-lado-borda"
      >
        {iniciais}
      </Link>
      <form action={sairAcao}>
        <input type="hidden" name="empresa" value={empresa.slug} />
        <button
          type="submit"
          className="rounded px-1.5 py-0.5 text-[12.5px] font-medium text-lado-tinta-2 hover:bg-lado-2 hover:text-lado-tinta"
        >
          Sair
        </button>
      </form>
    </div>
  )

  // Uma função, e não um pedaço pronto: a marca aparece na barra E na gaveta
  // do celular, e o degradê da chama tem `id` — repetido, o navegador pinta
  // a segunda pelo primeiro, que está escondido (`hidden md:flex`), e a chama
  // da gaveta sumia. Cada lugar leva o seu.
  const marca = (id: string) => (
    <>
      {/* A marca do produto em cima, o nome da empresa embaixo. Nessa ordem:
          quem paga a mensalidade é a empresa, mas quem responde pelo sistema
          somos nós — e no dia do suporte a pessoa precisa saber o nome do
          que ela está usando. A cor da empresa vira o traço ao lado. */}
      <div className="flex items-center gap-2 px-1.5 pt-1 pb-1">
        {/* Com o azulejo, e não nu: no claro a barra é branca e o losango
            branco sumiria nela. O azulejo azul-noite serve aos dois temas. */}
        <Simbolo tamanho={26} id={id} />
        <span className="text-[15px] font-extrabold tracking-[-0.035em] text-lado-tinta">
          Norte
        </span>
      </div>
      <div className="mb-3 flex items-center gap-2 px-1.5">
        <span
          aria-hidden
          className="h-3.5 w-1 shrink-0 rounded-full"
          style={{ background: empresa.corMarca && /^#[0-9a-f]{6}$/i.test(empresa.corMarca) ? empresa.corMarca : 'var(--sol-claro)' }}
        />
        <span className="truncate text-xs font-semibold text-lado-tinta-2">{empresa.nome}</span>
      </div>
      {/* Em que loja estou — e o caminho para outra. No alto, antes do menu:
          tudo o que vem abaixo dele é DESTA loja. */}
      {lojas.mostrarSeletor && (
        <div className="mb-3">
          <TrocaDeLoja slug={empresa.slug} opcoes={lojas.opcoes} atual={lojas.unidadeId} jeito="lado" />
        </div>
      )}
    </>
  )

  return (
    <div className={cx('flex', recolhida ? 'h-dvh overflow-hidden' : 'min-h-dvh')}>
      {/* `sticky` + `h-dvh`: sem isso a barra tem a altura da PÁGINA, não a da
          tela — e numa tela longa ela acaba no meio, deixando um pedaço branco
          embaixo do azul. Grudada, ela também continua à mão depois de rolar,
          que é o que se espera de navegação de sistema. */}
      {/* A lateral tem um botão que a recolhe num trilho de ícones e a abre de
          novo, em toda tela. Quem escolheu, escolheu para todas (cookie do
          aparelho); sem escolha, o balcão abre recolhido e o resto aberto. */}
      <BarraLateral
        inicial={barraRecolhida}
        marcaCompleta={marca('marca-barra')}
        navegacao={navegacao}
        rodape={rodape}
        marcaTrilho={
          <>
            <Link href={`/${empresa.slug}`} aria-label={`Norte · ${empresa.nome}`} title={empresa.nome} className="mx-auto mb-1">
              <Simbolo tamanho={30} id="marca-trilho" />
            </Link>
            {lojas.mostrarSeletor && <TrocaDeLoja slug={empresa.slug} opcoes={lojas.opcoes} atual={lojas.unidadeId} jeito="trilho" />}
          </>
        }
        trilho={trilho}
        rodapeTrilho={rodapeTrilho}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* A barra de cima do celular: azul-noite como a lateral, para a
            pessoa reconhecer que é o mesmo sistema. Some de `md` para cima. */}
        <div className="flex items-center gap-2 border-b border-lado-borda bg-lado px-2 py-1.5 md:hidden">
          <Gaveta rotulo={empresa.nome}>
            <div className="flex min-h-full flex-col gap-0.5">
              {marca('marca-gaveta')}
              {navegacao}
              {rodape}
            </div>
          </Gaveta>
          <Simbolo tamanho={22} id="marca-topo" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-lado-tinta">{empresa.nome}</span>
          {/* A aparência (tema, modo e sons) também no celular, num botão. */}
          <Preferencias tema={tema} modo={modo} tom="lado" />
        </div>

        {/* No celular o título fica em cima e os seletores embaixo: lado a
            lado, o seletor de período engolia o título ("C..."). */}
        {/* O título nunca é cortado. Antes ele era `truncate` ao lado dos
            seletores, e numa tela de 1.000px o seletor de período comia o
            nome da tela até sobrar "Pai...". Agora os dois dividem a linha
            enquanto cabem, e os seletores descem para baixo quando não cabem. */}
        {/* Uma altura só (`min-h-13`, 52px) em toda tela: com a altura vinda
            do conteúdo, o cabeçalho tinha 50px numa tela e 54 na outra, e o
            título pulava ao trocar de menu. No telefone, título e UMA ação —
            o resto vai para o "Mais" (AcoesDoTopo). */}
        {/* Preso no topo, com o vidro fosco: rolando a lista, o título e as
            ações continuam à mão, e o conteúdo passa por baixo, desfocado. */}
        <header
          style={itemAtivo ? corDe(itemAtivo) : undefined}
          className={cx(
            'z-30 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-borda/80 bg-superficie/85 px-4 py-2.5 backdrop-blur-xl backdrop-saturate-150 md:px-6',
            !recolhida && 'sticky top-0',
          )}
        >
          <div className="mr-auto flex min-w-0 shrink-0 items-center gap-3">
            {itemAtivo ? (
              <span className="topo-icone hidden sm:grid">
                <IconeDoItem href={itemAtivo.href} tamanho={18} />
              </span>
            ) : null}
            <div className="flex min-w-0 flex-col">
              {itemAtivo?.grupo ? (
                <span className="topo-area text-[11.5px] leading-tight font-bold tracking-[0.12em] uppercase">{itemAtivo.grupo}</span>
              ) : null}
              <h1 className="text-lg leading-tight font-extrabold tracking-[-0.02em] text-tinta">{titulo}</h1>
            </div>
          </div>
          {acao && <AcoesDoTopo>{acao}</AcoesDoTopo>}
          {/* O som, o modo e o tema numa cápsula só: são preferências da
              tela, e juntas não competem com as ações da página. No celular,
              na gaveta. */}
          <div className="hidden md:block">
            <Preferencias tema={tema} modo={modo} />
          </div>
        </header>
        <main
          style={itemAtivo ? corDe(itemAtivo) : undefined}
          className={cx(
            'flex flex-1 flex-col',
            // `pb-20`: o vão do botão de Ajuda, que fica fixo no canto de
            // baixo e cobria o último valor e o último botão da página.
            recolhida ? 'min-h-0 overflow-hidden' : 'tela-entra gap-5 p-4 pb-20 md:p-6 md:pb-20',
          )}
        >
          {children}
        </main>
      </div>

      {/* A página aberta antes de uma atualização chama o servidor pelo endereço
          antigo e quebra no primeiro Salvar. O aviso de versão nova antes
          disso mora aqui, em toda tela (nasceu só no balcão). */}
      <AvisoVersao slug={empresa.slug} versao={versaoDoBuild()} />
      {/* Trinta minutos parada, a tela tranca e pede a senha. Mora aqui
          porque aqui é por onde toda tela passa — ver Tranca.tsx. */}
      <Tranca
        slug={empresa.slug}
        nome={sessao.nome}
        trancaMin={TRANCA_MIN}
        avisoSeg={AVISO_SEG}
        trancadaAoAbrir={trancada}
      />
      {/* O Guia recebe o que esta pessoa abre: a busca não lista tela que
          daria "este endereço não abre" para ela. */}
      <Guia
        slug={empresa.slug}
        empresa={empresa.nome}
        nome={sessao.nome}
        quem={{ capacidades: CAPACIDADES.filter((c) => pode(sessao, c)), modulos: empresa.modulos, nomes: nomesNoGuia(vocab) }}
      />
    </div>
  )
}
