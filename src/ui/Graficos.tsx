'use client'

// Os gráficos do sistema.
//
// Cinco formas, cada uma para uma pergunta:
//
//   Rosca        "de que é feito o todo?"      — formas de pagamento, grupos do DRE
//   BarrasH      "quem é maior?"               — categorias, lojas, vendedores
//   BarrasMeses  "como foi mês a mês?"         — receita × despesa
//   Linhas       "este período contra o outro" — vendas por dia, agora e antes
//   Calor        "quando acontece?"            — hora × dia da semana
//
// ── as regras que valem em todos ─────────────────────────────
// • Cor vem das fichas do tema (var(--marca), var(--bom-vivo)...), nunca de
//   um hex solto: o gráfico tem que ler igual no claro e no escuro.
// • Cor de série segue a SÉRIE, nunca a posição: filtrar não repinta.
// • Duas séries ou mais têm legenda; uma série só não — o título já diz.
// • Texto veste texto: valor e rótulo em tinta, e a cor fica na marca ao lado.
// • Passar o mouse mostra o número exato. O alvo é a coluna inteira, não a
//   barra fina: é o dia fraco que a pessoa quer investigar.
// • Um eixo só. Duas medidas de escala diferente são dois gráficos.

import { useId, useState } from 'react'
import { cx } from './base'

/** A ordem fixa das cores de série. A nona série vira "Outros". */
// As quatro primeiras são as que quase toda rosca usa, e precisam ser
// quatro MATIZES: o âmbar de atenção vinha logo depois do laranja do sol, e
// "Crédito" e "Débito" saíam da mesma cor. O cinza entra em quarto — é o
// mais distante de todos os outros.
export const PALETA = [
  'var(--marca)',
  'var(--bom-vivo)',
  'var(--sol)',
  'var(--tinta-3)',
  'var(--marca-forte)',
  'var(--atencao-vivo)',
  'var(--critico-vivo)',
  'var(--bom)',
] as const

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace('.', ',')}%`

/**
 * Como escrever o número. É uma PALAVRA, não uma função, porque o gráfico é
 * componente de cliente e a página que o usa é de servidor — e função não
 * atravessa essa fronteira. Cada palavra vira a função aqui dentro.
 */
export type Formato = 'brl' | 'un' | 'inteiro' | 'kg' | 'pct'
const formatar = (f: Formato) => (v: number) =>
  f === 'un' ? `${v.toLocaleString('pt-BR')} un`
  : f === 'kg' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`
  : f === 'inteiro' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  : f === 'pct' ? `${v.toFixed(1).replace('.', ',')}%`
  : brl(v)

/* ── Rosca ────────────────────────────────────────────────── */

export type Fatia = { rotulo: string; valor: number; cor?: string; detalhe?: string }

export function Rosca({
  fatias,
  formato = 'brl',
  centro,
  vazio = 'Nada no período.',
}: {
  fatias: Fatia[]
  formato?: Formato
  /** O número do meio. Sem ele, mostra o total. */
  centro?: { valor: string; rotulo: string }
  vazio?: string
}) {
  const [aceso, setAceso] = useState<number | null>(null)
  const vivas = fatias.filter((f) => f.valor > 0)
  const total = vivas.reduce((s, f) => s + f.valor, 0)
  if (total <= 0) return <p className="py-6 text-center text-sm text-tinta-3">{vazio}</p>

  // Mais de oito fatias: as menores viram "Outros". Cor de mais não é cor.
  const ordenadas = [...vivas].sort((a, b) => b.valor - a.valor)
  const mostradas =
    ordenadas.length > 8
      ? [
          ...ordenadas.slice(0, 7),
          { rotulo: 'Outros', valor: ordenadas.slice(7).reduce((s, f) => s + f.valor, 0) },
        ]
      : ordenadas

  const R = 42
  const C = 2 * Math.PI * R
  const FOLGA = 2 // px de respiro entre fatias
  let acumulado = 0
  const arcos = mostradas.map((f, i) => {
    const fracao = f.valor / total
    const comprimento = Math.max(fracao * C - FOLGA, 0.5)
    const arco = { i, f, fracao, dash: `${comprimento} ${C - comprimento}`, offset: -acumulado * C + C / 4, cor: f.cor ?? PALETA[i % PALETA.length]! }
    acumulado += fracao
    return arco
  })
  const emCima = aceso !== null ? mostradas[aceso] : null

  return (
    // A legenda precisa de uns 13rem para nome E valor caberem na linha; com
    // menos que isso (o celular), ela desce para baixo da rosca, que fica no
    // meio. Espremida ao lado, o nome sumia inteiro no `truncate` e sobrava
    // uma coluna de valores sem dono.
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg viewBox="0 0 100 100" className="size-36 shrink-0" role="img" aria-label={`Total ${formatar(formato)(total)}`}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--superficie-2)" strokeWidth="12" />
        {arcos.map((a) => (
          <circle
            key={a.i}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={a.cor}
            strokeWidth={aceso === a.i ? 14 : 12}
            strokeDasharray={a.dash}
            strokeDashoffset={a.offset}
            style={{ transition: 'stroke-width .15s, opacity .15s', opacity: aceso === null || aceso === a.i ? 1 : 0.35 }}
            onMouseEnter={() => setAceso(a.i)}
            onMouseLeave={() => setAceso(null)}
          />
        ))}
        <text x="50" y="47" textAnchor="middle" className="numero" style={{ fontSize: 11, fontWeight: 700, fill: 'var(--tinta)' }}>
          {emCima ? formatar(formato)(emCima.valor) : centro?.valor ?? formatar(formato)(total)}
        </text>
        <text x="50" y="58" textAnchor="middle" style={{ fontSize: 6.5, fill: 'var(--tinta-3)' }}>
          {emCima ? `${emCima.rotulo} · ${pct(emCima.valor / total)}` : centro?.rotulo ?? 'total'}
        </text>
      </svg>

      {/* A legenda é a tabela do gráfico: nome, valor exato e a fatia. Quem
          não distingue as cores lê a mesma coisa. */}
      <ul className="flex min-w-[13rem] flex-1 flex-col gap-1 text-sm">
        {arcos.map((a) => (
          <li
            key={a.i}
            onMouseEnter={() => setAceso(a.i)}
            onMouseLeave={() => setAceso(null)}
            className={cx('flex items-center justify-between gap-3 rounded px-1 py-0.5', aceso === a.i && 'bg-superficie-2')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: a.cor }} />
              <span className="truncate text-tinta">{a.f.rotulo}</span>
              {a.f.detalhe && <span className="shrink-0 text-xs text-tinta-3">{a.f.detalhe}</span>}
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="numero font-semibold text-tinta">{formatar(formato)(a.f.valor)}</span>
              <span className="numero w-10 text-right text-xs text-tinta-3">{pct(a.fracao)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── BarrasH ──────────────────────────────────────────────── */

export function BarrasH({
  itens,
  formato = 'brl',
  cor = 'var(--marca)',
  vazio = 'Nada no período.',
}: {
  itens: { rotulo: string; valor: number; detalhe?: string; cor?: string }[]
  formato?: Formato
  cor?: string
  vazio?: string
}) {
  if (itens.length === 0) return <p className="py-6 text-center text-sm text-tinta-3">{vazio}</p>
  const maior = Math.max(...itens.map((i) => i.valor), 1)
  return (
    <ol className="flex flex-col gap-2">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-tinta">{i.rotulo}</span>
            <span className="numero shrink-0 text-sm font-semibold text-tinta">{formatar(formato)(i.valor)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-superficie-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max((i.valor / maior) * 100, 2)}%`, background: i.cor ?? cor }}
              />
            </div>
            {i.detalhe && <span className="shrink-0 text-xs text-tinta-3">{i.detalhe}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ── BarrasMeses ──────────────────────────────────────────── */

export type Serie = { nome: string; cor: string; valores: number[] }

export function BarrasMeses({
  rotulos,
  series,
  formato = 'brl',
  altura = 140,
}: {
  /** Um rótulo por grupo: "abr", "mai"... */
  rotulos: string[]
  series: Serie[]
  formato?: Formato
  altura?: number
}) {
  const [aceso, setAceso] = useState<number | null>(null)
  const { topo, linhas } = eixo(Math.max(...series.flatMap((s) => s.valores), 1))
  const g = aceso !== null ? aceso : null
  // Rótulo em todo grupo só enquanto cabe. Com as 13 horas de uma loja no
  // celular, "10h11h12h" encosta um no outro e nenhum se lê — um sim, um não
  // continua dizendo onde se está, e a hora exata aparece no balão.
  const salto = rotulos.length > 14 ? 2 : 1

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-9 flex-wrap items-start gap-x-4 gap-y-1">
        {g !== null ? (
          <div className="flex flex-wrap items-baseline gap-x-3 rounded-norte border border-borda bg-superficie-2 px-2.5 py-1.5 text-xs">
            <span className="font-semibold text-tinta">{rotulos[g]}</span>
            {series.map((s) => (
              <span key={s.nome} className="flex items-center gap-1.5 text-tinta-2">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: s.cor }} />
                {s.nome} <b className="numero text-tinta">{formatar(formato)(s.valores[g] ?? 0)}</b>
              </span>
            ))}
          </div>
        ) : series.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tinta-2">
            {series.map((s) => (
              <li key={s.nome} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: s.cor }} />
                {s.nome}
              </li>
            ))}
          </ul>
        ) : (
          // Uma série só não tem legenda — o título já diz o que é.
          <span className="text-xs text-tinta-3">Passe o mouse numa barra para ver o valor.</span>
        )}
      </div>

      <div className="flex gap-2">
        <Eixo linhas={linhas} altura={altura} />
        <div className="relative flex flex-1 items-end gap-2" style={{ height: altura }} onMouseLeave={() => setAceso(null)}>
          <Grade linhas={linhas} topo={topo} />
          {rotulos.map((r, gi) => (
            <button
              type="button"
              key={r}
              onMouseEnter={() => setAceso(gi)}
              onFocus={() => setAceso(gi)}
              onBlur={() => setAceso(null)}
              aria-label={`${r}: ${series.map((s) => `${s.nome} ${formatar(formato)(s.valores[gi] ?? 0)}`).join(', ')}`}
              className={cx('relative flex h-full flex-1 cursor-default items-end justify-center gap-0.5 rounded-sm', aceso === gi && 'bg-superficie-2')}
            >
              {series.map((s) => {
                const v = s.valores[gi] ?? 0
                return (
                  <span
                    key={s.nome}
                    aria-hidden
                    className="w-full max-w-4 rounded-t-sm"
                    style={{
                      height: `${v > 0 ? Math.max((v / topo) * 100, 2) : 0}%`,
                      background: s.cor,
                      opacity: aceso === null || aceso === gi ? 1 : 0.55,
                    }}
                  />
                )
              })}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 pl-10">
        {rotulos.map((r, i) => (
          // Sem `overflow-hidden`: com rótulo um sim, um não, o "10h" pode
          // transbordar a coluna estreita para os lados — o vizinho está vazio.
          <span key={r} className="numero flex min-w-0 flex-1 justify-center text-[10px] text-tinta-3">
            {i % salto === 0 ? r : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Linhas ───────────────────────────────────────────────── */

export function Linhas({
  rotulos,
  series,
  formato = 'brl',
  altura = 120,
}: {
  rotulos: string[]
  /** A primeira série é a principal e ganha área; as outras são linha fina. */
  series: Serie[]
  formato?: Formato
  altura?: number
}) {
  const [aceso, setAceso] = useState<number | null>(null)
  const id = useId()
  const n = rotulos.length
  // O mesmo eixo redondo das barras. Antes as três linhas de grade ficavam
  // em 25/50/75% da altura, sem número nenhum — grade que não diz quanto
  // vale é só listra.
  const { topo, linhas } = eixo(Math.max(...series.flatMap((s) => s.valores), 1))
  const W = 100
  const H = 40
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2)
  const y = (v: number) => H - (v / topo) * H
  const caminho = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')

  if (n === 0) return <p className="py-6 text-center text-sm text-tinta-3">Sem dado no período.</p>

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-9 flex-wrap items-start gap-x-4 gap-y-1">
        {aceso !== null ? (
          <div className="flex flex-wrap items-baseline gap-x-3 rounded-norte border border-borda bg-superficie-2 px-2.5 py-1.5 text-xs">
            <span className="font-semibold text-tinta">{rotulos[aceso]}</span>
            {series.map((s) => (
              <span key={s.nome} className="flex items-center gap-1.5 text-tinta-2">
                <span aria-hidden className="size-2 rounded-full" style={{ background: s.cor }} />
                {s.nome} <b className="numero text-tinta">{formatar(formato)(s.valores[aceso] ?? 0)}</b>
              </span>
            ))}
          </div>
        ) : (
          series.length > 1 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tinta-2">
              {series.map((s) => (
                <li key={s.nome} className="flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: s.cor }} />
                  {s.nome}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
      <div className="flex gap-2">
      <Eixo linhas={linhas} altura={altura} />
      <div className="relative min-w-0 flex-1" style={{ height: altura }} onMouseLeave={() => setAceso(null)}>
        <Grade linhas={linhas} topo={topo} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={series[0]?.cor} stopOpacity="0.22" />
              <stop offset="1" stopColor={series[0]?.cor} stopOpacity="0" />
            </linearGradient>
          </defs>
          {series[0] && n > 1 && (
            <path d={`${caminho(series[0].valores)} L${W},${H} L0,${H} Z`} fill={`url(#${id}-area)`} />
          )}
          {[...series].reverse().map((s, k) => (
            <path
              key={s.nome}
              d={caminho(s.valores)}
              fill="none"
              stroke={s.cor}
              strokeWidth={k === series.length - 1 ? 0.9 : 0.6}
              strokeDasharray={k === series.length - 1 ? undefined : '1.2 1'}
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: k === series.length - 1 ? 2 : 1.5 }}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {aceso !== null && (
            <line x1={x(aceso)} x2={x(aceso)} y1="0" y2={H} stroke="var(--tinta-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {/* Marcadores em HTML para não esticarem com o SVG. */}
        {aceso !== null &&
          series.map((s) => (
            <span
              key={s.nome}
              aria-hidden
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-superficie"
              style={{ left: `${x(aceso)}%`, top: `${(y(s.valores[aceso] ?? 0) / H) * 100}%`, background: s.cor }}
            />
          ))}
        {/* As colunas de alvo: a largura inteira de cada dia. */}
        <div className="absolute inset-0 flex">
          {rotulos.map((r, i) => (
            <button
              type="button"
              key={r}
              onMouseEnter={() => setAceso(i)}
              onFocus={() => setAceso(i)}
              onBlur={() => setAceso(null)}
              aria-label={`${r}: ${series.map((s) => `${s.nome} ${formatar(formato)(s.valores[i] ?? 0)}`).join(', ')}`}
              className="h-full flex-1 cursor-default"
            />
          ))}
        </div>
      </div>
      </div>
      <div className="numero flex justify-between pl-10 text-[10px] text-tinta-3">
        <span>{rotulos[0]}</span>
        {n > 2 && <span>{rotulos[Math.floor((n - 1) / 2)]}</span>}
        <span>{rotulos[n - 1]}</span>
      </div>
    </div>
  )
}

/* ── Calor ────────────────────────────────────────────────── */

export function Calor({
  linhas,
  colunas,
  valores,
  formato = 'brl',
  cor = 'var(--marca)',
}: {
  /** Ex.: dias da semana. */
  linhas: string[]
  /** Ex.: horas. */
  colunas: string[]
  /** valores[linha][coluna] */
  valores: number[][]
  formato?: Formato
  cor?: string
}) {
  const [aceso, setAceso] = useState<{ l: number; c: number } | null>(null)
  const maior = Math.max(...valores.flat(), 1)
  const v = aceso ? (valores[aceso.l]?.[aceso.c] ?? 0) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-7 items-start text-xs">
        {aceso && v !== null ? (
          <span className="rounded-norte border border-borda bg-superficie-2 px-2.5 py-1">
            <b className="text-tinta">{linhas[aceso.l]}, {colunas[aceso.c]}h</b>
            <span className="text-tinta-2"> · </span>
            <b className="numero text-tinta">{formatar(formato)(v)}</b>
          </span>
        ) : (
          <span className="text-tinta-3">Passe o mouse numa casa para ver o valor.</span>
        )}
        {/* A escala, que antes era uma frase ("mais escuro, mais
            movimento") — e no tema escuro a casa cheia é a mais CLARA. */}
        <span aria-hidden className="ml-auto flex shrink-0 items-center gap-1 pl-3 text-[10px] text-tinta-3">
          menos
          {[0, 0.33, 0.66, 1].map((f) => (
            <span
              key={f}
              className="size-2.5 rounded-[2px]"
              style={{
                background: f === 0 ? 'var(--superficie-2)' : `color-mix(in srgb, ${cor} ${Math.round(14 + 86 * f)}%, var(--superficie))`,
              }}
            />
          ))}
          mais
        </span>
      </div>
      {/* `relative` na caixa que rola: sem ele, qualquer filho posicionado
          (um `sr-only`, um balão) se ancora fora dela e estica a PÁGINA de
          lado no celular, em vez de rolar aqui dentro. */}
      <div className="relative overflow-x-auto">
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `2.2rem repeat(${colunas.length}, minmax(1.1rem, 1fr))` }} onMouseLeave={() => setAceso(null)}>
          <span />
          {colunas.map((c) => (
            <span key={c} className="numero text-center text-[9px] text-tinta-3">
              {c}
            </span>
          ))}
          {linhas.map((l, li) => (
            <div key={l} className="contents">
              <span className="pr-1 text-right text-[10px] text-tinta-3">{l}</span>
              {colunas.map((c, ci) => {
                const val = valores[li]?.[ci] ?? 0
                return (
                  <button
                    type="button"
                    key={c}
                    onMouseEnter={() => setAceso({ l: li, c: ci })}
                    onFocus={() => setAceso({ l: li, c: ci })}
                    onBlur={() => setAceso(null)}
                    aria-label={`${l} ${c}h: ${formatar(formato)(val)}`}
                    className={cx('h-5 rounded-[3px] border', aceso?.l === li && aceso?.c === ci ? 'border-tinta' : 'border-transparent')}
                    // A cor é MISTURADA com a superfície, e não apagada com
                    // opacidade: opacidade deixa o fundo da página vazar, e
                    // no tema branco a casa vazia sumia no papel. Casa sem
                    // venda é cinza de superfície — "zero" tem de se ver.
                    style={{
                      background:
                        val > 0
                          ? `color-mix(in srgb, ${cor} ${Math.round(14 + 86 * (val / maior))}%, var(--superficie))`
                          : 'var(--superficie-2)',
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── ajudantes ────────────────────────────────────────────── */

/**
 * Três ou quatro linhas de grade em números redondos: o eixo serve para ler
 * ordem de grandeza, não para medir com régua.
 */
function eixo(maior: number): { topo: number; linhas: number[] } {
  const passo = passoRedondo(maior / 3)
  const topo = Math.ceil(maior / passo) * passo
  return { topo, linhas: Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo) }
}

/** Os números do eixo, à esquerda. Largura fixa, para o rótulo de baixo alinhar. */
function Eixo({ linhas, altura }: { linhas: number[]; altura: number }) {
  return (
    <div
      aria-hidden
      className="numero flex w-8 shrink-0 flex-col-reverse justify-between text-right text-[10px] leading-none text-tinta-3"
      style={{ height: altura }}
    >
      {linhas.map((l) => (
        <span key={l} className="-my-[3px]">{curto(l)}</span>
      ))}
    </div>
  )
}

/**
 * A grade atrás do desenho. Fio CHEIO e suave, não tracejado: no papel
 * branco, o tracejado cintila e disputa com a série; a linha de base (o
 * zero) é a única mais firme, porque é o chão de onde as barras nascem.
 */
function Grade({ linhas, topo }: { linhas: number[]; topo: number }) {
  return (
    <>
      {linhas.map((l) => (
        <div
          key={l}
          aria-hidden
          className={cx('pointer-events-none absolute inset-x-0 border-t', l === 0 ? 'border-borda' : 'border-borda-suave')}
          style={{ bottom: `${(l / topo) * 100}%` }}
        />
      ))}
    </>
  )
}

/** "R$ 12,3k" para eixo; inteiro pequeno fica inteiro. */
function curto(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',')}k`
  return String(Math.round(v))
}

/** Um passo redondo (1, 2, 5 × 10^n) perto do pedido. */
function passoRedondo(bruto: number): number {
  if (bruto <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)))
  const r = bruto / mag
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag
}
