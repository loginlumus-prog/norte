'use client'

// "Quanto fica para a MINHA empresa?" — a pergunta que decide a assinatura,
// respondida na hora. A conta é a mesma da tabela (`PRECOS` em
// servidor/planos.ts): o plano (Essencial ou Profissional, com o assistente
// dentro), cada loja a mais, a fábrica (uma vez) e as marcas do Farol. Nenhum
// número digitado aqui. O anual não é chave daqui: é conversa (a página diz
// "fale com a gente"), porque sem gateway ele é cobrança feita à mão.

import { useState } from 'react'
import { PRECOS, milhar, precoDoFarol, somar } from '@/servidor/planos'

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function Contador({ rotulo, dica, valor, min, max, mudar }: { rotulo: string; dica: string; valor: number; min: number; max: number; mudar: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[15px] font-bold">{rotulo}</p>
        <p className="text-[13px] text-[var(--s-tinta-2)]">{dica}</p>
      </div>
      <div className="flex shrink-0 items-center rounded-[var(--s-raio)] border border-[var(--s-borda)] bg-[var(--s-fundo)]">
        <button
          type="button"
          aria-label={`Menos ${rotulo.toLowerCase()}`}
          disabled={valor <= min}
          onClick={() => mudar(Math.max(min, valor - 1))}
          className="flex h-10 w-10 items-center justify-center rounded-[var(--s-raio)] text-lg font-bold disabled:opacity-30"
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
          className="flex h-10 w-10 items-center justify-center rounded-[var(--s-raio)] text-lg font-bold disabled:opacity-30"
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
  const [plano, setPlano] = useState<'essencial' | 'profissional'>('profissional')
  const [lojas, setLojas] = useState(2)
  const [fabrica, setFabrica] = useState(false)
  const [marcas, setMarcas] = useState(0)

  const pro = plano === 'profissional'
  const base = pro ? PRECOS.profissional : PRECOS.essencial
  const extra = pro ? PRECOS.profissionalLojaExtra : PRECOS.essencialLojaExtra
  const respostas = (pro ? PRECOS.respostasProfissional : PRECOS.respostasEssencial) + (lojas - 1) * PRECOS.respostasPorLojaExtra
  // A fábrica e o Farol são do Profissional (ver `planoLibera`).
  const linhas: [string, number][] = [
    [`${pro ? 'Profissional' : 'Essencial'} · primeira loja`, base],
    ...(lojas > 1 ? ([[`${lojas - 1} loja${lojas > 2 ? 's' : ''} a mais`, somar((lojas - 1) * extra)]] as [string, number][]) : []),
    ...(pro && fabrica ? ([['Fábrica', PRECOS.fabrica]] as [string, number][]) : []),
    ...(pro && marcas > 0 ? ([[`Farol · ${marcas} marca${marcas > 1 ? 's' : ''}`, precoDoFarol(marcas)]] as [string, number][]) : []),
  ]
  const mes = somar(...linhas.map(([, v]) => v))

  return (
    <div className="grid overflow-hidden rounded-[var(--s-raio)] border border-[var(--s-borda)] bg-[var(--s-cartao)] shadow-[var(--s-sombra-alta)] lg:grid-cols-[1.15fr_1fr]">
      <div className="divide-y divide-[var(--s-borda)] p-6 sm:p-8">
        <div className="flex flex-col gap-2 py-3">
          <p className="text-[15px] font-bold">Plano</p>
          <div role="radiogroup" aria-label="Plano" className="grid grid-cols-2 gap-2">
            {(
              [
                ['essencial', 'Essencial', `assistente básico · ${reais(PRECOS.essencial)}`],
                ['profissional', 'Profissional', `assistente completo · ${reais(PRECOS.profissional)}`],
              ] as const
            ).map(([valor, nome, dica]) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={plano === valor}
                onClick={() => setPlano(valor)}
                className={
                  'flex flex-col items-start rounded-[var(--s-raio)] border px-3 py-2.5 text-left transition-colors ' +
                  (plano === valor
                    ? 'border-[var(--s-azul)] bg-[var(--s-fundo)] ring-2 ring-[var(--s-azul)]/30'
                    : 'border-[var(--s-borda)] hover:bg-[var(--s-fundo)]')
                }
              >
                <span className="text-[15px] font-bold">{nome}</span>
                <span className="text-[12px] text-[var(--s-tinta-2)]">{dica}</span>
              </button>
            ))}
          </div>
          <p className="text-[13px] text-[var(--s-tinta-2)]">
            {pro
              ? 'Tudo do Norte. O assistente lança estoque por áudio, cadastra produto e propõe reposição.'
              : 'Balcão, estoque, catálogo e financeiro. O assistente manda o relatório, avisa e responde perguntas.'}
          </p>
        </div>
        <Contador
          rotulo="Lojas"
          dica={`${reais(base)} a primeira, ${reais(extra)} cada uma a mais. Depósito não conta.`}
          valor={lojas}
          min={1}
          max={30}
          mudar={setLojas}
        />
        {pro ? (
          <>
            <Chave
              rotulo="Fábrica"
              dica={`Produz o que vende? ${reais(PRECOS.fabrica)}/mês, com quantas cozinhas tiver.`}
              ligado={fabrica}
              mudar={setFabrica}
            />
            <Contador
              rotulo="Farol (marcas)"
              dica={`Marketing com IA: ${reais(PRECOS.farolMarca)} a primeira marca, ${reais(PRECOS.farolMarcaExtra)} cada uma a mais.`}
              valor={marcas}
              min={0}
              max={10}
              mudar={setMarcas}
            />
          </>
        ) : (
          <p className="py-3 text-[13px] text-[var(--s-tinta-2)]">
            Crediário, agenda, compras, fábrica e Farol vêm no Profissional.
          </p>
        )}
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
            <li className="flex justify-between gap-3 pb-2 text-white/80">
              <span>Assistente no WhatsApp</span>
              <span className="tabular-nums">{milhar(respostas)} respostas/mês</span>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-[13px] text-white/80">Por mês</p>
          <p className="font-[family-name:var(--font-display)] text-6xl font-extrabold tracking-tight tabular-nums">{reais(mes)}</p>
          <p className="mt-1 text-[13px] text-white/80">Equipe sem limite · {reais(somar(mes / lojas))} por loja</p>
          <a href={comecar} className="site-botao mt-6 w-full bg-white px-6 py-3.5 text-[15px] text-[#0d1b45] hover:-translate-y-0.5">
            Testar {PRECOS.diasDeTeste} dias grátis
          </a>
          <p className="mt-2 text-center text-[12px] text-white/75">Sem cartão. Tudo liberado no teste, assistente incluso.</p>
        </div>
      </div>
    </div>
  )
}
