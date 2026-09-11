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
import { Traco } from './Traco'
import { GraficoDias } from './Grafico'
import { cx } from './base'

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
   * faixa vem no azul-noite, com o desenho do sol atrás — os outros ficam de
   * apoio, e é o contraste entre eles que faz a tela ter cara de painel.
   *
   * Um por faixa. Dois destaques é a mesma fileira de novo, com mais tinta.
   */
  principal?: boolean
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
    return (
      <div className="nav-fundo realce-alto relative flex flex-col gap-0.5 overflow-hidden rounded-norte p-3.5">
        {/* O relevo na beira de baixo. Ele e uma linha de horizonte, e
            horizonte embaixo de um numero le como base — a bussola, que e
            redonda e centrada, competia com o valor pelo meio da ficha. */}
        <Traco
          arte="relevo"
          sobre="escuro"
          opacidade={0.22}
          className="pointer-events-none absolute inset-x-0 -bottom-2 w-full max-w-none"
        />
        <span className="relative text-xs font-medium text-nav-tinta-2">{rotulo}</span>
        <span className="numero relative text-3xl font-bold tracking-tight text-nav-tinta">
          {valor}
        </span>
        <span className="relative flex flex-wrap items-baseline gap-x-2 text-xs">
          {detalhe && <span className="text-nav-tinta-2">{detalhe}</span>}
          {c && Number.isFinite(c.pct) && (
            <span className={cx('font-semibold', subiu ? 'text-bom-vivo' : 'text-critico-vivo')}>
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

  return (
    <div className="flex flex-col gap-0.5 border-borda px-4 py-1 sm:border-l">
      <span className="flex items-center gap-1.5 text-xs font-medium text-tinta-3">
        {ponto && <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', ponto)} />}
        {rotulo}
      </span>
      {/* `self-start`: a classe `.numero` alinha à direita (é para tabela), e
          num flex-col o span estica até a borda — no celular o número ia
          parar no canto direito, longe do rótulo. Encolhido ao conteúdo, ele
          fica embaixo do rótulo em qualquer largura. */}
      <span className="numero self-start text-[26px] leading-tight font-bold tracking-tight text-tinta">
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
  itens: { rotulo: string; quantos: number; nivel: 'bom' | 'atencao' | 'critico' | 'neutro' }[]
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
          <span className="text-tinta-2">{i.rotulo}</span>
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
