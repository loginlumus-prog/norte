'use client'

// O gráfico de dias, com resposta ao passar o mouse.
//
// ── por que saiu do SVG esticado ─────────────────────────────
// A versão anterior era um `<svg preserveAspectRatio="none">`: uma caixa de
// 56 unidades esticada até a largura da tela. Isso funciona para a altura das
// barras e estraga todo o resto — o canto arredondado vira oval, a linha de
// 1px vira 3px numa tela larga e 0,5px numa estreita. Aqui as barras são
// caixas de verdade, com altura em porcento, então nada distorce.
//
// ── o alvo é a COLUNA, não a barra ───────────────────────────
// A barra de um dia fraco tem três pixels de altura. Exigir que a pessoa
// acerte três pixels com o mouse é o mesmo que não ter interação — e é
// justamente o dia fraco que ela quer investigar. Então quem recebe o mouse é
// a coluna inteira, de cima a baixo.
//
// ── o que o balão mostra ─────────────────────────────────────
// Valor, quantidade de vendas e ticket. Total sozinho não decide nada: R$ 900
// em uma venda e R$ 900 em vinte são dias completamente diferentes, e é a
// diferença entre "achar um cliente igual" e "repetir o movimento".

import { useState } from 'react'
import { plural } from '@/ui/texto'

export type DiaDoGrafico = { dia: string; total: number; vendas: number }

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "2026-09-07" → { curto: "07/09", longo: "seg, 07/09" } */
function nomes(iso: string) {
  const [a, m, d] = iso.split('-').map(Number)
  const data = new Date(a!, m! - 1, d!)
  return {
    curto: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`,
    longo: `${SEMANA[data.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`,
    fimDeSemana: data.getDay() === 0 || data.getDay() === 6,
  }
}

export function GraficoDias({ dados }: { dados: DiaDoGrafico[] }) {
  const [emCima, setEmCima] = useState<number | null>(null)

  if (dados.length === 0) {
    return <p className="py-6 text-center text-sm text-tinta-3">Sem venda no período.</p>
  }

  const maior = Math.max(...dados.map((d) => d.total), 1)
  const totalPeriodo = dados.reduce((s, d) => s + d.total, 0)
  const media = totalPeriodo / dados.length
  const iMaior = dados.reduce((m, d, i) => (d.total > dados[m]!.total ? i : m), 0)
  const alvo = emCima ?? null
  const d = alvo !== null ? dados[alvo] : null

  return (
    <div className="flex flex-col gap-2">
      {/* A faixa do balão tem altura fixa mesmo vazia: sem isso o gráfico
          inteiro pula para baixo no primeiro movimento do mouse. */}
      <div className="flex h-9 items-start">
        {d ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-norte border border-borda bg-superficie-2 px-2.5 py-1.5">
            <span className="text-xs font-semibold text-tinta">{nomes(d.dia).longo}</span>
            <span className="numero text-sm font-bold text-tinta">{brl(d.total)}</span>
            <span className="text-xs text-tinta-2">
              {d.vendas} venda{d.vendas === 1 ? '' : 's'}
            </span>
            {d.vendas > 0 && (
              <span className="text-xs text-tinta-3">ticket {brl(d.total / d.vendas)}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-tinta-3">
            Toque ou passe o mouse num dia para ver o movimento dele.
          </span>
        )}
      </div>

      <div
        className="relative flex h-24 items-end gap-px border-b border-borda"
        onMouseLeave={() => setEmCima(null)}
        role="img"
        aria-label={`Venda por dia. Maior dia ${brl(maior)}, média ${brl(media)}.`}
      >
        {/* A média, atrás das barras: é ela que transforma "barra alta" em
            "acima do normal". Sem linha de referência, todo gráfico só diz
            qual dia foi o maior. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-borda"
          style={{ bottom: `${(media / maior) * 100}%` }}
        />

        {dados.map((dia, i) => {
          const alt = dia.total > 0 ? Math.max((dia.total / maior) * 100, 3) : 0
          const aceso = alvo === i
          const { fimDeSemana } = nomes(dia.dia)
          return (
            <button
              type="button"
              key={dia.dia}
              onMouseEnter={() => setEmCima(i)}
              onFocus={() => setEmCima(i)}
              // O toque também acende: no iPhone o botão tocado não ganha
              // foco, e o celular não tem mouse para passar por cima.
              onClick={() => setEmCima(i)}
              onBlur={() => setEmCima(null)}
              aria-label={`${nomes(dia.dia).longo}: ${brl(dia.total)}, ${plural(dia.vendas, 'venda', 'vendas')}`}
              // A coluna inteira é o alvo, e ela é transparente: o que se vê
              // continua sendo só a barra.
              className="group relative flex h-full flex-1 cursor-default items-end"
            >
              <span
                aria-hidden
                className={
                  'absolute inset-0 rounded-sm transition-colors ' +
                  (aceso ? 'bg-superficie-2' : 'bg-transparent')
                }
              />
              <span
                aria-hidden
                className={
                  'relative w-full rounded-t-sm transition-[filter,opacity] ' +
                  (dia.total === 0
                    ? 'bg-borda'
                    : i === iMaior
                      ? 'bg-bom'
                      : 'bg-bom-vivo') +
                  (aceso ? ' brightness-110' : '') +
                  (fimDeSemana && dia.total > 0 ? ' opacity-80' : '')
                }
                style={{ height: `${alt}%`, minHeight: dia.total > 0 ? 3 : 1 }}
              />
            </button>
          )
        })}
      </div>

      <div className="flex items-baseline justify-between text-xs text-tinta-3">
        <span>{nomes(dados[0]!.dia).curto}</span>
        <span className="text-tinta-2">
          média {brl(media)} · maior {brl(maior)}
        </span>
        <span>{nomes(dados[dados.length - 1]!.dia).curto}</span>
      </div>
    </div>
  )
}
