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
// • O gráfico CHEGA: a barra cresce do chão, a linha se desenha da esquerda,
//   a rosca gira até o lugar (classes graf-* no globals.css; quem pediu menos
//   movimento no aparelho vê o gráfico parado). E o número exato aparece num
//   balão que segue o mouse, em cima do ponto — não numa faixa lá em cima.

import { useEffect, useId, useRef, useState } from 'react'
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
  const id = useId().replace(/:/g, '')
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

  const R = 40
  const C = 2 * Math.PI * R
  const FOLGA = 1.6 // de respiro entre fatias
  let acumulado = 0
  const arcos = mostradas.map((f, i) => {
    const fracao = f.valor / total
    const comprimento = Math.max(fracao * C - FOLGA, 0.5)
    // O meio da fatia, para ela "saltar" para fora na direção certa.
    const meio = -Math.PI / 2 + (acumulado + fracao / 2) * 2 * Math.PI
    const arco = { i, f, fracao, dash: `${comprimento} ${C - comprimento}`, offset: -acumulado * C + C / 4, cor: f.cor ?? PALETA[i % PALETA.length]!, dx: Math.cos(meio) * 3, dy: Math.sin(meio) * 3 }
    acumulado += fracao
    return arco
  })
  const emCima = aceso !== null ? mostradas[aceso] : null

  return (
    // A legenda precisa de uns 13rem para nome E valor caberem na linha; com
    // menos que isso (o celular), ela desce para baixo da rosca, que fica no
    // meio. Espremida ao lado, o nome sumia inteiro no `truncate` e sobrava
    // uma coluna de valores sem dono.
    <div className="flex flex-wrap items-center justify-center gap-5">
      <svg viewBox="0 0 100 100" className="graf-rosca size-40 shrink-0 overflow-visible" role="img" aria-label={`Total ${formatar(formato)(total)}`}>
        <defs>
          {/* O brilho de cima: dá ao anel o volume de uma peça, e não de um traço. */}
          <linearGradient id={`${id}-brilho`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--superficie-2)" strokeWidth="15" />
        <g className="graf-rosca-anel">
          {arcos.map((a) => (
            <circle
              key={a.i}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={a.cor}
              strokeWidth={aceso === a.i ? 17 : 15}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              className="graf-fatia"
              style={{
                animationDelay: `${a.i * 90}ms`,
                transform: aceso === a.i ? `translate(${a.dx}px, ${a.dy}px)` : undefined,
                opacity: aceso === null || aceso === a.i ? 1 : 0.4,
              }}
              onMouseEnter={() => setAceso(a.i)}
              onMouseLeave={() => setAceso(null)}
            />
          ))}
        </g>
        <circle cx="50" cy="50" r={R} fill="none" stroke={`url(#${id}-brilho)`} strokeWidth="15" pointerEvents="none" />
        <circle cx="50" cy="50" r={R - 9} fill="var(--superficie)" pointerEvents="none" />
        <text x="50" y="49" textAnchor="middle" className="numero" style={{ fontSize: emCima || (centro?.valor ?? formatar(formato)(total)).length > 10 ? 9.5 : 11, fontWeight: 800, fill: 'var(--tinta)' }}>
          {emCima ? formatar(formato)(emCima.valor) : centro?.valor ?? formatar(formato)(total)}
        </text>
        <text x="50" y="59" textAnchor="middle" style={{ fontSize: 6, fontWeight: 600, fill: 'var(--tinta-3)' }}>
          {emCima ? `${emCima.rotulo.length > 16 ? emCima.rotulo.slice(0, 15) + '…' : emCima.rotulo} · ${pct(emCima.valor / total)}` : centro?.rotulo ?? 'total'}
        </text>
      </svg>

      {/* A legenda é a tabela do gráfico: nome, valor exato e a fatia. Quem
          não distingue as cores lê a mesma coisa. */}
      <ul className="flex min-w-[13rem] flex-1 flex-col gap-0.5 text-sm">
        {arcos.map((a) => (
          <li
            key={a.i}
            onMouseEnter={() => setAceso(a.i)}
            onMouseLeave={() => setAceso(null)}
            className={cx('flex items-center justify-between gap-3 rounded-lg px-2 py-1 transition-colors', aceso === a.i && 'bg-superficie-2')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-3 shrink-0 rounded-[4px] shadow-sm" style={{ background: `linear-gradient(140deg, color-mix(in oklab, ${a.cor} 70%, white), ${a.cor})` }} />
              <span className="truncate text-tinta" title={a.f.rotulo}>{a.f.rotulo}</span>
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
  /** `texto` troca o número mostrado (a barra continua medindo `valor`). */
  itens: { rotulo: string; valor: number; texto?: string; detalhe?: string; cor?: string }[]
  formato?: Formato
  cor?: string
  vazio?: string
}) {
  if (itens.length === 0) return <p className="py-6 text-center text-sm text-tinta-3">{vazio}</p>
  const maior = Math.max(...itens.map((i) => i.valor), 1)
  return (
    <ol className="flex flex-col gap-2.5">
      {itens.map((i, n) => (
        <li key={i.rotulo} className="graf-linha-h group flex flex-col gap-1 rounded-lg px-1.5 py-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              {/* A posição no ranque: o olho lê "3º" antes de comparar barras. */}
              <span className="numero w-5 shrink-0 text-xs font-bold text-tinta-3">{n + 1}º</span>
              <span className="truncate text-sm font-semibold text-tinta" title={i.rotulo}>{i.rotulo}</span>
            </span>
            <span className="numero shrink-0 text-sm font-bold text-tinta">{i.texto ?? formatar(formato)(i.valor)}</span>
          </div>
          <div className="flex items-center gap-2 pl-7">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-superficie-2">
              <div
                className="graf-barra-h h-full rounded-full"
                style={{
                  width: `${Math.max((i.valor / maior) * 100, 2)}%`,
                  background: `linear-gradient(90deg, color-mix(in oklab, ${i.cor ?? cor} 65%, white), ${i.cor ?? cor})`,
                  boxShadow: `0 2px 8px -3px ${i.cor ?? cor}`,
                  animationDelay: `${Math.min(n, 12) * 55}ms`,
                }}
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
  // (ou um a cada três) continua dizendo onde se está, e a hora exata aparece
  // no balão. Quem decide é a LARGURA medida, não a contagem: as mesmas 13
  // horas cabem inteiras no computador e não cabem em 320px.
  const fila = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  useEffect(() => {
    const el = fila.current
    if (!el) return
    // Sem o recuo do eixo (`pl-10`): só a faixa onde os rótulos moram.
    const medir = () => setLargura(el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft))
    medir()
    const olho = new ResizeObserver(medir)
    olho.observe(el)
    return () => olho.disconnect()
  }, [])
  const maior = Math.max(...rotulos.map((r) => r.length), 1)
  // ~6px por caractere a 10px, mais 6px de folga entre um rótulo e outro.
  const precisa = maior * 6 + 6
  const coluna = largura > 0 ? (largura - 8 * (rotulos.length - 1)) / rotulos.length + 8 : Infinity
  const salto = largura > 0 ? Math.max(1, Math.ceil(precisa / coluna)) : rotulos.length > 14 ? 2 : 1

  return (
    <div className="flex flex-col gap-2">
      {/* Legenda só com duas séries ou mais — uma série só, o título diz. */}
      {series.length > 1 && <Legenda series={series} />}

      <div className="flex gap-2">
        <Eixo linhas={linhas} altura={altura} />
        <div className="relative flex flex-1 items-end gap-2" style={{ height: altura }} onMouseLeave={() => setAceso(null)}>
          <Grade linhas={linhas} topo={topo} />
          {g !== null && (
            <Balao
              x={((g + 0.5) / rotulos.length) * 100}
              y={100 - (Math.max(...series.map((s) => s.valores[g] ?? 0)) / topo) * 100}
              titulo={rotulos[g]!}
              linhas={series.map((s) => ({ nome: s.nome, cor: s.cor, valor: formatar(formato)(s.valores[g] ?? 0) }))}
            />
          )}
          {rotulos.map((r, gi) => (
            <button
              type="button"
              key={r}
              onMouseEnter={() => setAceso(gi)}
              onFocus={() => setAceso(gi)}
              onClick={() => setAceso(gi)}
              onBlur={() => setAceso(null)}
              aria-label={`${r}: ${series.map((s) => `${s.nome} ${formatar(formato)(s.valores[gi] ?? 0)}`).join(', ')}`}
              className={cx('relative flex h-full flex-1 cursor-default items-end justify-center gap-1 rounded-lg transition-colors', aceso === gi && 'bg-superficie-2/80')}
            >
              {series.map((s) => {
                const v = s.valores[gi] ?? 0
                return (
                  <span
                    key={s.nome}
                    aria-hidden
                    className="graf-barra w-full max-w-6 rounded-t-[6px]"
                    style={{
                      height: `${v > 0 ? Math.max((v / topo) * 100, 2) : 0}%`,
                      // O volume: mais clara em cima, a cor cheia embaixo, e a
                      // sombra da própria cor no chão.
                      background: `linear-gradient(180deg, color-mix(in oklab, ${s.cor} 62%, white), ${s.cor} 70%)`,
                      boxShadow: aceso === gi ? `0 6px 16px -6px ${s.cor}` : undefined,
                      opacity: aceso === null || aceso === gi ? 1 : 0.5,
                      animationDelay: `${Math.min(gi, 30) * 22}ms`,
                    }}
                  />
                )
              })}
            </button>
          ))}
        </div>
      </div>
      <div ref={fila} className="flex gap-2 pl-10">
        {rotulos.map((r, i) => (
          // Sem `overflow-hidden`: com rótulo um sim, um não, o "10h" pode
          // transbordar a coluna estreita para os lados — o vizinho está vazio.
          <span key={r} className="numero flex min-w-0 flex-1 justify-center text-[11.5px] text-tinta-3">
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
  const id = useId().replace(/:/g, '')
  const n = rotulos.length
  // O mesmo eixo redondo das barras. Antes as três linhas de grade ficavam
  // em 25/50/75% da altura, sem número nenhum — grade que não diz quanto
  // vale é só listra.
  const { topo, linhas } = eixo(Math.max(...series.flatMap((s) => s.valores), 1))
  const W = 100
  const H = 40
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2)
  const y = (v: number) => H - (v / topo) * H
  // Curva suave que não inventa: passa por todo ponto e não afunda abaixo
  // do zero entre dois dias parados (curva monotônica).
  const caminho = (vals: number[]) => curva(vals.map((v, i) => [x(i), y(v)] as const))

  if (n === 0) return <p className="py-6 text-center text-sm text-tinta-3">Sem dado no período.</p>
  const principal = series[0]
  const ultimo = principal ? principal.valores[n - 1] ?? 0 : 0

  return (
    <div className="flex flex-col gap-2">
      {series.length > 1 && <Legenda series={series} linha />}
      <div className="flex gap-2">
      <Eixo linhas={linhas} altura={altura} />
      <div className="relative min-w-0 flex-1" style={{ height: altura }} onMouseLeave={() => setAceso(null)}>
        <Grade linhas={linhas} topo={topo} />
        <div className="graf-revela absolute inset-0">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={principal?.cor} stopOpacity="0.38" />
                <stop offset="0.7" stopColor={principal?.cor} stopOpacity="0.06" />
                <stop offset="1" stopColor={principal?.cor} stopOpacity="0" />
              </linearGradient>
            </defs>
            {principal && n > 1 && (
              <path d={`${caminho(principal.valores)} L${W},${H} L0,${H} Z`} fill={`url(#${id}-area)`} />
            )}
            {[...series].reverse().map((s, k) => {
              const ehPrincipal = k === series.length - 1
              return (
                <path
                  key={s.nome}
                  d={caminho(s.valores)}
                  fill="none"
                  stroke={s.cor}
                  strokeDasharray={ehPrincipal ? undefined : '1.2 1'}
                  vectorEffect="non-scaling-stroke"
                  // A sombra da própria cor embaixo da linha principal: o volume.
                  style={{ strokeWidth: ehPrincipal ? 2.75 : 1.5, filter: ehPrincipal ? `drop-shadow(0 3px 4px color-mix(in oklab, ${s.cor} 45%, transparent))` : undefined }}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )
            })}
            {aceso !== null && (
              <line x1={x(aceso)} x2={x(aceso)} y1="0" y2={H} stroke="var(--tinta-3)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        </div>
        {/* O ponto de hoje, pulsando: onde a linha está AGORA. */}
        {principal && n > 1 && aceso === null && ultimo > 0 && (
          <span aria-hidden className="graf-agora absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-superficie" style={{ left: '100%', top: `${(y(ultimo) / H) * 100}%`, background: principal.cor, ['--c' as string]: principal.cor }} />
        )}
        {/* Marcadores em HTML para não esticarem com o SVG. */}
        {aceso !== null &&
          series.map((s) => (
            <span
              key={s.nome}
              aria-hidden
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-superficie shadow-md"
              style={{ left: `${x(aceso)}%`, top: `${(y(s.valores[aceso] ?? 0) / H) * 100}%`, background: s.cor }}
            />
          ))}
        {aceso !== null && (
          <Balao
            x={x(aceso)}
            y={(y(Math.max(...series.map((s) => s.valores[aceso] ?? 0))) / H) * 100}
            titulo={rotulos[aceso]!}
            linhas={series.map((s) => ({ nome: s.nome, cor: s.cor, valor: formatar(formato)(s.valores[aceso] ?? 0) }))}
          />
        )}
        {/* As colunas de alvo: a largura inteira de cada dia. */}
        <div className="absolute inset-0 flex">
          {rotulos.map((r, i) => (
            <button
              type="button"
              key={r}
              onMouseEnter={() => setAceso(i)}
              onFocus={() => setAceso(i)}
              onClick={() => setAceso(i)}
              onBlur={() => setAceso(null)}
              aria-label={`${r}: ${series.map((s) => `${s.nome} ${formatar(formato)(s.valores[i] ?? 0)}`).join(', ')}`}
              className="h-full flex-1 cursor-default"
            />
          ))}
        </div>
      </div>
      </div>
      <div className="numero flex justify-between pl-10 text-xs text-tinta-3">
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
          <span className="text-tinta-3">Toque numa casa para ver o valor.</span>
        )}
        {/* A escala, que antes era uma frase ("mais escuro, mais
            movimento") — e no tema escuro a casa cheia é a mais CLARA. */}
        <span aria-hidden className="ml-auto flex shrink-0 items-center gap-1 pl-3 text-[11.5px] text-tinta-3">
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
            <span key={c} className="numero text-center text-[10.5px] text-tinta-3">
              {c}
            </span>
          ))}
          {linhas.map((l, li) => (
            <div key={l} className="contents">
              <span className="pr-1 text-right text-[11.5px] text-tinta-3">{l}</span>
              {colunas.map((c, ci) => {
                const val = valores[li]?.[ci] ?? 0
                return (
                  <button
                    type="button"
                    key={c}
                    onMouseEnter={() => setAceso({ l: li, c: ci })}
                    onFocus={() => setAceso({ l: li, c: ci })}
                    onClick={() => setAceso({ l: li, c: ci })}
                    onBlur={() => setAceso(null)}
                    aria-label={`${l} ${c}h: ${formatar(formato)(val)}`}
                    className={cx('graf-casa h-6 rounded-[5px] border', aceso?.l === li && aceso?.c === ci ? 'border-tinta' : 'border-transparent')}
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
 * O balão do número exato, em cima do ponto que o mouse aponta. `x` e `y` em
 * porcento da área do gráfico. Nas pontas ele não sai da caixa (`clamp`).
 */
export function Balao({ x, y, titulo, linhas }: { x: number; y: number; titulo: string; linhas: { nome: string; cor: string; valor: string }[] }) {
  return (
    <div
      aria-hidden
      // Ponto alto no gráfico: o balão desce para baixo dele, em vez de
      // subir por cima da legenda e sair da caixa.
      className={cx('graf-balao pointer-events-none absolute z-10 flex min-w-[8.5rem] flex-col gap-1 rounded-xl px-3 py-2 text-xs', y < 40 && 'graf-balao-baixo')}
      style={{ left: `clamp(4.5rem, ${x}%, calc(100% - 4.5rem))`, top: `${y}%` }}
    >
      <span className="font-bold text-tinta">{titulo}</span>
      {linhas.map((l) => (
        <span key={l.nome} className="flex items-center justify-between gap-3 text-tinta-2">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: l.cor }} />
            {l.nome}
          </span>
          <b className="numero text-[13px] text-tinta">{l.valor}</b>
        </span>
      ))}
    </div>
  )
}

function Legenda({ series, linha = false }: { series: Serie[]; linha?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-tinta-2">
      {series.map((s) => (
        <li key={s.nome} className="flex items-center gap-1.5">
          <span aria-hidden className={linha ? 'h-1 w-4 rounded-full' : 'size-2.5 rounded-[3px]'} style={{ background: s.cor }} />
          {s.nome}
        </li>
      ))}
    </ul>
  )
}

/**
 * Um caminho suave por todos os pontos (cúbica monotônica, Fritsch–Carlson):
 * arredonda os cantos sem passar por cima do maior valor nem por baixo do
 * zero — curva que inventa pico é gráfico mentindo.
 */
function curva(p: readonly (readonly [number, number])[]): string {
  const n = p.length
  if (n === 0) return ''
  if (n < 3) return p.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`).join(' ')
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1]![0] - p[i]![0])
    m.push((p[i + 1]![1] - p[i]![1]) / (dx[i] || 1))
  }
  const t: number[] = [m[0]!]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2)
  t.push(m[n - 2]!)
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i]! / m[i]!
    const b = t[i + 1]! / m[i]!
    const h = a * a + b * b
    if (h > 9) {
      const k = 3 / Math.sqrt(h)
      t[i] = k * a * m[i]!
      t[i + 1] = k * b * m[i]!
    }
  }
  let d = `M${p[0]![0].toFixed(2)},${p[0]![1].toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3
    d += ` C${(p[i]![0] + h).toFixed(2)},${(p[i]![1] + t[i]! * h).toFixed(2)} ${(p[i + 1]![0] - h).toFixed(2)},${(p[i + 1]![1] - t[i + 1]! * h).toFixed(2)} ${p[i + 1]![0].toFixed(2)},${p[i + 1]![1].toFixed(2)}`
  }
  return d
}

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
      className="numero flex w-8 shrink-0 flex-col-reverse justify-between text-right text-[11.5px] leading-none text-tinta-3"
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
  // Passo fracionário (maior valor 1 → linhas 0; 0,5; 1): arredondado, o
  // eixo dizia "0, 1, 1" e parecia defeito.
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

/** Um passo redondo (1, 2, 5 × 10^n) perto do pedido. */
function passoRedondo(bruto: number): number {
  if (bruto <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)))
  const r = bruto / mag
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag
}
