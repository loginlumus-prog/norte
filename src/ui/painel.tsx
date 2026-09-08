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
        {/* Um pedaco da bussola no canto. Pequeno e cortado: aqui ela e
            textura da ficha, nao figura — o numero e que tem que ser lido. */}
        <Traco
          arte="bussola"
          sobre="escuro"
          opacidade={0.18}
          className="pointer-events-none absolute -top-14 -right-12 w-44 max-w-none"
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

  return (
    <div
      className={cx(
        'realce flex flex-col gap-0.5 rounded-norte border border-borda bg-superficie p-3.5',
        faixa,
      )}
    >
      <span className="text-xs font-medium text-tinta-3">{rotulo}</span>
      <span className="numero text-2xl font-bold tracking-tight text-tinta">{valor}</span>
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
  dados: { dia: string; total: number }[]
  titulo: string
}) {
  if (dados.length === 0) {
    return <p className="py-6 text-center text-sm text-tinta-3">Sem venda no período.</p>
  }

  const maior = Math.max(...dados.map((d) => d.total), 1)
  const L = 4 // largura da barra
  const G = 2 // respiro entre barras: sem ele viram um bloco só
  const A = 56 // altura da área de desenho
  const largura = dados.length * (L + G)

  const dia = (iso: string) => {
    const [, m, d] = iso.split('-')
    return `${d}/${m}`
  }

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${largura} ${A}`}
        preserveAspectRatio="none"
        className="h-20 w-full"
        role="img"
        aria-label={`${titulo}. Maior dia: ${brl(maior)}.`}
      >
        {dados.map((d, i) => {
          const h = Math.max((d.total / maior) * A, d.total > 0 ? 2 : 0)
          return (
            <rect
              key={d.dia}
              x={i * (L + G)}
              y={A - h}
              width={L}
              height={h}
              rx={1.5}
              fill="var(--bom-vivo)"
              opacity={d.total > 0 ? 1 : 0.2}
            >
              {/* tooltip nativo: acessível, sem uma linha de JavaScript */}
              <title>{`${dia(d.dia)} — ${brl(d.total)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="flex justify-between text-xs text-tinta-3">
        <span>{dia(dados[0]!.dia)}</span>
        <span className="text-tinta-2">maior dia {brlCurto(maior)}</span>
        <span>{dia(dados[dados.length - 1]!.dia)}</span>
      </div>
    </div>
  )
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
export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-xs font-semibold tracking-widest text-tinta-3 uppercase">
        {titulo}
      </h2>
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
