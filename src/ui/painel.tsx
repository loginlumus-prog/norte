// Peças do painel.
//
// Três formas, e cada uma existe por um motivo:
//
// • Numero  — um valor que é a manchete. Não vira gráfico: gráfico de um dado
//             só é enfeite.
// • Barras  — trinta dias de venda. Série única, então sem legenda: o título
//             já diz o que é, e caixinha de legenda para uma coisa só é ruído.
// • Ranque  — "o que mais vende", "quem mais vendeu". Com 5 a 8 itens, lista
//             com barra lê melhor que gráfico: dá o valor exato E a proporção
//             na mesma linha, sem o olho ter que ir até um eixo.
//
// Sobre a cor: o gráfico de vendas é VERDE porque dinheiro entrando é bom, e
// isso é significado, não decoração — não é "a série 1". Continua valendo que
// nenhuma cor separa itens de uma lista: quem separa é o texto. E toda cor vem
// acompanhada de sinal ou palavra, para quem não distingue verde de vermelho
// ler exatamente a mesma coisa.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { GraficoDias } from './Grafico'
import { cx } from './base'
import type { Pendencia } from '@/servidor/pendencias'

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const brlCurto = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toFixed(1).replace('.', ',')}k` : brl(v)

/* ── Número ───────────────────────────────────────────────── */

export function Numero({
  rotulo,
  valor,
  detalhe,
  comparacao,
  nivel,
  principal = false,
  celula = false,
}: {
  rotulo: string
  valor: string
  detalhe?: string
  /** Diferença em relação ao período anterior, já calculada. */
  comparacao?: { pct: number; contra: string }
  /** Pinta a faixa da esquerda. Sem isto, o tile é neutro. */
  nivel?: 'bom' | 'atencao' | 'critico'
  /**
   * O número que a pessoa veio ver.
   *
   * Quatro fichas com o mesmo peso não são hierarquia, são uma fileira: o
   * olho não sabe onde pousar e a tela inteira lê como formulário. UM por
   * faixa vem maior, em azul-marinho, com a régua da marca no topo — os
   * outros ficam de apoio, e é o contraste entre eles que faz a tela ter
   * cara de painel.
   *
   * Um por faixa. Dois destaques é a mesma fileira de novo, com mais tinta.
   */
  principal?: boolean
  /**
   * Uma célula da `Faixa`: fundo de superfície e sem o fio da esquerda,
   * porque quem separa as células é a própria faixa.
   */
  celula?: boolean
}) {
  const c = comparacao
  const subiu = c ? c.pct >= 0 : false
  const tom = nivel ?? (c && Number.isFinite(c.pct) ? (subiu ? 'bom' : 'critico') : undefined)
  const faixa =
    tom === 'bom' ? 'border-l-[3px] border-l-bom-vivo'
    : tom === 'atencao' ? 'border-l-[3px] border-l-atencao-vivo'
    : tom === 'critico' ? 'border-l-[3px] border-l-critico-vivo'
    : ''

  if (principal) {
    // ── por que saiu do azul-noite ─────────────────────────────
    // Com a barra lateral branca, o bloco escuro virou a única mancha
    // pesada da tela: um buraco no papel, e o olho caía nele antes de ler o
    // número. E com o relevo desenhado atrás, o número dividia o bloco com
    // uma ilustração. No painel simples ainda disputava com o botão azul de
    // Vender — dois blocos fortes são dois "principais".
    //
    // Agora o destaque vem do que é do NÚMERO: o tamanho, o azul-marinho do
    // título e uma régua da marca no topo, sobre o mesmo papel das outras
    // fichas, só que tingido de marca bem de leve. Tudo ficha — a mesma
    // conta vale no escuro, onde o tingido vira um azul fundo e o número, o
    // azul-claro do título.
    return (
      <div className="realce relative flex min-w-0 flex-col justify-center gap-1 overflow-hidden rounded-norte border border-marca/30 bg-superficie bg-linear-to-b from-marca/8 to-transparent px-4 pt-4 pb-3.5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-marca" />
        <span className="text-xs font-semibold text-marca">{rotulo}</span>
        <span className="numero text-[32px] leading-none font-bold tracking-[-0.03em] text-titulo">
          {valor}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {detalhe && <span className="text-tinta-2">{detalhe}</span>}
          {c && Number.isFinite(c.pct) && (
            // Etiqueta com fundo, e não só texto colorido: é a única cor
            // forte do bloco, e tem de se ver de longe. Seta E sinal junto.
            <span
              className={cx(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold',
                subiu ? 'bg-bom-fundo text-bom' : 'bg-critico-fundo text-critico',
              )}
            >
              {subiu ? '▲' : '▼'} {Math.abs(c.pct).toFixed(0)}% {c.contra}
            </span>
          )}
        </span>
      </div>
    )
  }

  // As fichas de apoio saíram da caixa. Antes eram quatro retângulos com
  // borda, fundo e sombra, um do lado do outro — e quatro caixas iguais na
  // horizontal é o desenho mais comum de painel e o mais sem graça: o olho lê
  // "formulário".
  //
  // Aqui elas são NÚMEROS SOLTOS separados por um fio. O que dá estrutura é o
  // espaço e o alinhamento, não a moldura. E o único bloco fechado da faixa
  // passa a ser o principal, que é justamente o que a gente quer que se veja.
  //
  // A cor de situação, que era uma faixa na borda esquerda da caixa, virou um
  // ponto ao lado do rótulo: sem caixa não há borda onde pintar, e o ponto lê
  // melhor de longe do que um fio de 3px.
  const ponto =
    tom === 'bom' ? 'bg-bom-vivo'
    : tom === 'atencao' ? 'bg-atencao-vivo'
    : tom === 'critico' ? 'bg-critico-vivo'
    : ''
  void faixa

  // Na célula, o celular lê em LINHA: rótulo e detalhe à esquerda, o valor
  // à direita. Empilhadas, três fichas de 90px de altura empurravam o "Precisa
  // de você" para a segunda tela; em linha, cabem numa mão. Do `sm` para cima
  // volta a ser coluna, que é como o número lê bem lado a lado.
  //
  // A ficha SOLTA (fora da `Faixa`) segue a mesma regra no celular. Antes ela
  // ficava empilhada e sem fio nenhum: em Vendas, Caixa, Preços, Equipe... três
  // números de 26px boiando no fundo, cada um com 90px de altura, e a lista
  // que a pessoa veio ver começava na segunda tela. Agora é uma linha com um
  // fio em cima, como a lista do painel — e do `sm` para cima volta a ser o
  // número solto separado pelo fio da esquerda.
  return (
    <div
      className={cx(
        'min-w-0',
        celula
          ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 bg-superficie px-4 py-3 sm:flex sm:flex-col sm:items-stretch sm:justify-center sm:py-3.5'
          : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-borda px-1 pt-2.5 sm:flex sm:flex-col sm:items-stretch sm:gap-0.5 sm:border-t-0 sm:border-l sm:px-4 sm:py-1',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-tinta-3">
        {ponto && <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', ponto)} />}
        {rotulo}
      </span>
      <span
        className={cx(
          'numero leading-tight font-bold tracking-tight text-tinta',
          'row-span-2 text-right text-[22px] sm:text-left sm:text-[26px]',
        )}
      >
        {valor}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
        {detalhe && <span className="text-tinta-2">{detalhe}</span>}
        {c && Number.isFinite(c.pct) && (
          <span className={cx('font-semibold', subiu ? 'text-bom' : 'text-critico')}>
            {/* seta E sinal: quem não distingue as cores lê a mesma coisa */}
            {subiu ? '▲' : '▼'} {Math.abs(c.pct).toFixed(0)}% {c.contra}
          </span>
        )}
      </span>
    </div>
  )
}

/* ── Barras (30 dias) ─────────────────────────────────────── */

export function Barras({
  dados,
  titulo,
}: {
  dados: { dia: string; total: number; vendas: number }[]
  titulo: string
}) {
  // O desenho e a interacao moram no cliente (`GraficoDias`); esta funcao so
  // guarda o lugar dele no painel, que continua sendo servidor.
  void titulo
  return <GraficoDias dados={dados} />
}

/* ── Ranque ───────────────────────────────────────────────── */

export function Ranque({
  itens,
  vazio = 'Nada no período.',
}: {
  itens: { rotulo: string; valor: number; detalhe?: string }[]
  vazio?: string
}) {
  if (itens.length === 0) {
    return <p className="py-6 text-center text-sm text-tinta-3">{vazio}</p>
  }
  const maior = Math.max(...itens.map((i) => i.valor), 1)

  return (
    <ol className="flex flex-col gap-2">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-tinta">{i.rotulo}</span>
            <span className="numero shrink-0 text-sm font-semibold text-tinta">
              {brl(i.valor)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-superficie-2">
              <div
                className="h-full rounded-full bg-bom-vivo"
                style={{ width: `${Math.max((i.valor / maior) * 100, 2)}%` }}
              />
            </div>
            {i.detalhe && (
              <span className="shrink-0 text-xs text-tinta-3">{i.detalhe}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ── Seção ────────────────────────────────────────────────── */

/** Agrupa o painel por assunto, que é como o dono pensa. */
export function Secao({
  titulo,
  resumo,
  acao,
  children,
}: {
  titulo: string
  /** Uma linha explicando a seção. Só onde ela não é óbvia pelo título. */
  resumo?: string
  acao?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      {/* O título da seção era uma etiquetinha em versalete de 12px, cinza.
          Isso funcionava porque cada bloco vinha dentro de uma caixa, e a
          caixa fazia a separação. Tirando as caixas, quem tem que segurar a
          página é a TIPOGRAFIA — então ele cresce e ganha peso.

          É a diferença entre uma tela que parece um formulário e uma que
          parece uma publicação. */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-balance">
            {titulo}
          </h2>
          {resumo && <p className="text-sm text-tinta-2">{resumo}</p>}
        </div>
        {acao}
      </header>
      {children}
    </section>
  )
}

/* ── Faixa de números ─────────────────────────────────────── */

// As classes vão inteiras aqui, e não montadas com `${n}`: o Tailwind lê o
// arquivo como texto, e classe montada em tempo de execução não existe no CSS.
const COLUNAS_FAIXA = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
} as const
const AO_LADO_DO_PRINCIPAL = {
  2: 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
  3: 'lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]',
  4: 'lg:grid-cols-[minmax(0,1fr)_minmax(0,4fr)]',
} as const

/**
 * A fileira de números de uma seção: o principal (se houver) e, ao lado, uma
 * régua branca com os de apoio.
 *
 * No tema branco, número solto direto no cinza do fundo parecia rascunho —
 * sem papel embaixo, o olho não sabe onde a seção começa. A régua é UM papel
 * só para todos os apoios, dividido por fios de 1px (é o `gap-px` sobre o
 * fundo de borda que desenha os fios), então continua lendo como uma fileira
 * de números, e não como quatro caixinhas.
 *
 * Cada principal ocupa a mesma largura de uma célula, para a linha de base
 * dos números cair na mesma altura de ponta a ponta.
 */
export function Faixa({
  principal,
  colunas,
  children,
}: {
  principal?: ReactNode
  /** Quantas células de apoio vão dentro. */
  colunas: 2 | 3 | 4
  children: ReactNode
}) {
  const regua = (
    <div
      className={cx(
        'realce grid min-w-0 gap-px overflow-hidden rounded-norte border border-borda bg-borda',
        'grid-cols-1 sm:grid-cols-2',
        // Número ímpar de células em duas colunas deixaria um buraco cinza
        // no fim: a última se estica para fechar a linha.
        'sm:[&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1',
        COLUNAS_FAIXA[colunas],
      )}
    >
      {children}
    </div>
  )
  if (!principal) return regua
  return (
    <div className={cx('grid gap-3', AO_LADO_DO_PRINCIPAL[colunas])}>
      {principal}
      {regua}
    </div>
  )
}

/* ── Bloco ────────────────────────────────────────────────── */

/**
 * O papel de um gráfico ou de uma lista no painel.
 *
 * O `Cartao` sem caixa funciona nas telas de trabalho, onde a página é o
 * papel. O painel é diferente: é uma mesa com várias peças, cada uma
 * respondendo UMA pergunta — e no tema branco, com o fundo cinza-claro, peça
 * sem papel embaixo se mistura com a vizinha. Aqui toda peça é um objeto, e
 * por isso ganha a caixa que o `Cartao` guarda para objetos.
 *
 * O título fica DENTRO do papel, em cima, e o detalhe (o recorte: "hoje
 * contra quarta passada") logo embaixo, miúdo. O cabeçalho cinza do
 * `Cartao caixa` saiu: em papel branco, uma faixa cinza no topo é um segundo
 * papel, e dois papéis empilhados é ruído.
 */
export function Bloco({
  titulo,
  detalhe,
  acao,
  className,
  children,
}: {
  titulo?: string
  detalhe?: string
  acao?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cx(
        'realce flex min-w-0 flex-col gap-4 rounded-norte border border-borda bg-superficie p-4 sm:p-5',
        className,
      )}
    >
      {(titulo || acao) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {titulo && <h3 className="text-[15px] leading-snug font-bold tracking-tight">{titulo}</h3>}
            {detalhe && <p className="text-xs text-tinta-3">{detalhe}</p>}
          </div>
          {acao}
        </header>
      )}
      {children}
    </section>
  )
}

/* ── Precisa de você ──────────────────────────────────────── */

/**
 * A lista do "Precisa de você". A linha INTEIRA é o link — no celular o dedo
 * erra o botãozinho, e a pessoa quer resolver, não mirar. O "Ver" continua
 * desenhado porque é ele que diz que a linha é clicável.
 *
 * Sem ícone: o nível é uma PALAVRA na cor dele ("Urgente", "Atenção") em
 * cima da frase, e um fio da mesma cor na beira. A palavra é o que garante
 * que quem não distingue vermelho de âmbar — e o leitor de tela — leia o
 * mesmo que os outros veem; o fio é o que se vê de longe.
 */
export function Pendencias({ itens }: { itens: Pendencia[] }) {
  if (itens.length === 0) {
    return (
      <div className="flex flex-col gap-0.5 rounded-norte border border-bom-borda bg-bom-fundo px-4 py-4">
        <span className="text-sm font-bold text-bom">✓ Tudo em dia</span>
        <span className="text-xs text-tinta-2">Nada acabou, nada venceu, ninguém está esperando você.</span>
      </div>
    )
  }
  return (
    <ul className="-mx-2 flex flex-col">
      {itens.map((p) => (
        <li key={p.chave} className="border-b border-borda-suave last:border-b-0">
          <Link
            href={p.href}
            className="group flex items-center gap-3 rounded-norte px-2 py-2.5 transition-colors hover:bg-superficie-2"
          >
            <span
              aria-hidden
              className={cx('w-[3px] shrink-0 self-stretch rounded-full', p.nivel === 'critico' ? 'bg-critico-vivo' : 'bg-atencao-vivo')}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cx(
                  'text-[10px] leading-none font-bold tracking-[0.06em] uppercase',
                  p.nivel === 'critico' ? 'text-critico' : 'text-atencao',
                )}
              >
                {p.nivel === 'critico' ? 'Urgente' : 'Atenção'}
              </span>
              <span className="text-sm leading-snug font-semibold text-tinta">{p.frase}</span>
              <span className="text-xs leading-snug text-tinta-2">{p.detalhe}</span>
            </span>
            <span
              aria-hidden
              className="shrink-0 rounded-norte border border-borda bg-superficie px-2.5 py-1 text-xs font-semibold text-marca transition-colors group-hover:border-marca/40 group-hover:bg-marca-suave"
            >
              Ver →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * A mesma lista, em uma linha de etiquetas — para o avançado, que já tem
 * muito o que mostrar e só precisa AVISAR. Quando não há nada, não ocupa
 * lugar: o "tudo em dia" é do simples, que tem espaço para comemorar.
 */
export function PendenciasCurtas({ itens }: { itens: Pendencia[] }) {
  if (itens.length === 0) return null
  return (
    <nav aria-label="Precisa de você" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-tinta-2">Precisa de você:</span>
      {itens.map((p) => (
        <Link
          key={p.chave}
          href={p.href}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
            p.nivel === 'critico'
              ? 'border-critico-borda bg-critico-fundo text-critico hover:border-critico-vivo'
              : 'border-atencao-borda bg-atencao-fundo text-atencao hover:border-atencao-vivo',
          )}
        >
          <span aria-hidden className={cx('size-1.5 rounded-full', p.nivel === 'critico' ? 'bg-critico-vivo' : 'bg-atencao-vivo')} />
          {p.frase}
        </Link>
      ))}
    </nav>
  )
}

export { brl, brlCurto }

/* ── Tira de resumo ───────────────────────────────────────── */

/**
 * A linha de contagens coloridas que abre uma tela: "12 no estoque · 3 no
 * mínimo · 1 acabou".
 *
 * Serve para a pessoa saber o tamanho do problema antes de ler a lista. Item
 * com zero some — mostrar "0 acabou" em vermelho apagado é ruído, e ruído
 * ensina a ignorar a cor.
 */
export function Tira({
  itens,
}: {
  /**
   * `um` é o rótulo no singular, para quando o número é 1: "1 vencida", e não
   * "1 vencidas". Sem ele, vale o `rotulo` para qualquer número.
   */
  itens: { rotulo: string; um?: string; quantos: number; nivel: 'bom' | 'atencao' | 'critico' | 'neutro' }[]
}) {
  const visiveis = itens.filter((i) => i.quantos > 0)
  if (visiveis.length === 0) return null

  const cor = {
    bom: { ponto: 'bg-bom-vivo', texto: 'text-bom' },
    atencao: { ponto: 'bg-atencao-vivo', texto: 'text-atencao' },
    critico: { ponto: 'bg-critico-vivo', texto: 'text-critico' },
    neutro: { ponto: 'bg-tinta-3', texto: 'text-tinta-2' },
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {visiveis.map((i) => (
        <span key={i.rotulo} className="flex items-center gap-1.5 text-sm">
          <span aria-hidden className={cx('size-2 rounded-full', cor[i.nivel].ponto)} />
          <span className={cx('numero font-bold', cor[i.nivel].texto)}>{i.quantos}</span>
          <span className="text-tinta-2">{i.quantos === 1 && i.um ? i.um : i.rotulo}</span>
        </span>
      ))}
    </div>
  )
}

/* ── Falta preencher ──────────────────────────────────────── */

/** Marca um dado que ainda não foi informado, sem parecer defeito. */
export function Falta({ children = 'falta preencher' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-atencao-fundo px-2 py-0.5 text-xs font-semibold text-atencao">
      <span aria-hidden className="size-1.5 rounded-full bg-atencao-vivo" />
      {children}
    </span>
  )
}
