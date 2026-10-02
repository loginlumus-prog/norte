'use client'

// "Quanto fica para a MINHA empresa?" — a pergunta que decide a assinatura,
// respondida na hora. A conta é a mesma da tabela (`PRECOS` em
// servidor/planos.ts): a primeira loja, cada loja a mais, o assistente, cada
// fábrica e cada marca do Farol. Nenhum número digitado aqui.

import { useState } from 'react'
import { PRECOS } from '@/servidor/planos'

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function Contador({ rotulo, dica, valor, min, max, mudar }: { rotulo: string; dica: string; valor: number; min: number; max: number; mudar: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[15px] font-bold">{rotulo}</p>
        <p className="text-[13px] text-[var(--s-tinta-2)]">{dica}</p>
      </div>
      <div className="flex shrink-0 items-center rounded-full border border-[var(--s-borda)] bg-[var(--s-fundo)]">
        <button
          type="button"
          aria-label={`Menos ${rotulo.toLowerCase()}`}
          disabled={valor <= min}
          onClick={() => mudar(Math.max(min, valor - 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center text-base font-extrabold tabular-nums" aria-live="polite">
          {valor}
        </span>
        <button
          type="button"
          aria-label={`Mais ${rotulo.toLowerCase()}`}
          disabled={valor >= max}
          onClick={() => mudar(Math.min(max, valor + 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  )
}

function Chave({ rotulo, dica, ligado, mudar }: { rotulo: string; dica: string; ligado: boolean; mudar: (b: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-[15px] font-bold">{rotulo}</span>
        <span className="block text-[13px] text-[var(--s-tinta-2)]">{dica}</span>
      </span>
      <span className="relative inline-flex h-7 w-12 shrink-0">
        <input type="checkbox" checked={ligado} onChange={(e) => mudar(e.target.checked)} className="peer sr-only" />
        <span className="absolute inset-0 rounded-full bg-[var(--s-borda)] transition-colors peer-checked:bg-[var(--s-verde)] peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--s-azul)]" />
        <span className="absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

export function Calculadora({ comecar }: { comecar: string }) {
  const [lojas, setLojas] = useState(2)
  const [assistente, setAssistente] = useState(true)
  const [fabricas, setFabricas] = useState(0)
  const [marcas, setMarcas] = useState(0)
  const [anual, setAnual] = useState(false)

  const linhas: [string, number][] = [
    ['Primeira loja', PRECOS.primeiraLoja],
    ...(lojas > 1 ? ([[`${lojas - 1} loja${lojas > 2 ? 's' : ''} a mais`, (lojas - 1) * PRECOS.lojaExtra]] as [string, number][]) : []),
    ...(assistente ? ([['Assistente no WhatsApp', PRECOS.assistente]] as [string, number][]) : []),
    ...(fabricas > 0 ? ([[`${fabricas} fábrica${fabricas > 1 ? 's' : ''}`, fabricas * PRECOS.fabrica]] as [string, number][]) : []),
    ...(marcas > 0 ? ([[`Farol · ${marcas} marca${marcas > 1 ? 's' : ''}`, PRECOS.farolMarca + (marcas - 1) * PRECOS.farolMarcaExtra]] as [string, number][]) : []),
  ]
  const mes = linhas.reduce((s, [, v]) => s + v, 0)
  // O anual é `anualPagaMeses` mensalidades pagas de uma vez; o "por mês"
  // é só essa conta dividida por 12 (arredondar o mês e multiplicar por 12
  // inventava uns reais a mais no total).
  const ano = mes * PRECOS.anualPagaMeses
  const noAnual = Math.round(ano / 12)
  const mostrado = anual ? noAnual : mes

  return (
    <div className="grid overflow-hidden rounded-[32px] border border-[var(--s-borda)] bg-[var(--s-cartao)] shadow-[var(--s-sombra-alta)] lg:grid-cols-[1.15fr_1fr]">
      <div className="divide-y divide-[var(--s-borda)] p-6 sm:p-8">
        <Contador rotulo="Lojas" dica={`${reais(PRECOS.primeiraLoja)} a primeira, ${reais(PRECOS.lojaExtra)} cada uma a mais. Depósito não conta.`} valor={lojas} min={1} max={30} mudar={setLojas} />
        <Chave
          rotulo="Assistente no WhatsApp"
          dica={`${reais(PRECOS.assistente)}/mês para a empresa inteira, com ${reais(PRECOS.creditoDoAssistente)} de crédito de IA.`}
          ligado={assistente}
          mudar={setAssistente}
        />
        <Contador rotulo="Fábricas" dica={`Produz o que vende? ${reais(PRECOS.fabrica)} por fábrica.`} valor={fabricas} min={0} max={10} mudar={setFabricas} />
        <Contador
          rotulo="Farol (marcas)"
          dica={`Marketing com IA: ${reais(PRECOS.farolMarca)} a primeira marca, ${reais(PRECOS.farolMarcaExtra)} cada uma a mais.`}
          valor={marcas}
          min={0}
          max={10}
          mudar={setMarcas}
        />
        <Chave rotulo="Pagar no anual" dica={`12 meses pelo preço de ${PRECOS.anualPagaMeses}.`} ligado={anual} mudar={setAnual} />
      </div>
      <div className="relative flex flex-col justify-between gap-6 overflow-hidden bg-[linear-gradient(160deg,#1f4fd8,#6d4cf0)] p-6 text-white sm:p-8">
        <span aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div>
          <p className="site-olho text-white/80">Sua conta</p>
          <ul className="mt-4 flex flex-col gap-2 text-[14px]">
            {linhas.map(([n, v]) => (
              <li key={n} className="flex justify-between gap-3 border-b border-white/15 pb-2">
                <span>{n}</span>
                <span className="font-semibold tabular-nums">{reais(v)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[13px] text-white/80">{anual ? 'Por mês, no anual' : 'Por mês'}</p>
          <p className="font-[family-name:var(--font-display)] text-6xl font-extrabold tracking-tight tabular-nums">{reais(mostrado)}</p>
          <p className="mt-1 text-[13px] text-white/80">
            {anual ? `${reais(ano)} por ano, pago de uma vez · economia de ${reais(mes * 12 - ano)}` : `Equipe sem limite · ${reais(Math.round(mostrado / lojas))} por loja`}
          </p>
          <a href={comecar} className="site-botao mt-6 w-full bg-white px-6 py-3.5 text-[15px] text-[#0d1b45] hover:-translate-y-0.5">
            Testar {PRECOS.diasDeTeste} dias grátis
          </a>
          <p className="mt-2 text-center text-[12px] text-white/75">Sem cartão. Tudo liberado no teste, assistente incluso.</p>
        </div>
      </div>
    </div>
  )
}
