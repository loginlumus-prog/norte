'use client'

// Simples ou avançado: o mesmo painel, nos dois modos, com a chave do lado.
//
// ── por que isto é seção, e não uma linha na lista de recursos ─
// Porque é o argumento de facilidade, e facilidade não se lê — se vê. A
// pessoa aperta a chave e o mesmo painel perde as telas de análise do menu,
// troca os gráficos por "o que precisa de você hoje" e ganha o botão grande
// de vender. É o que o sistema faz de verdade (`servidor/modo.ts`): no
// simples somem do menu Caixa, Preços, Análise e Auditoria; o painel abre
// pelo essencial; o balcão vende por botões grandes.
//
// ── começa no simples ────────────────────────────────────────
// Porque é o padrão do sistema (`MODO_PADRAO`): quem ninguém configurou vê o
// simples. A amostra começa onde a pessoa vai começar.
//
// ── o movimento ──────────────────────────────────────────────
// Os itens do menu que só existem no avançado não somem de estalo: a linha
// fecha em 300ms (grade de 0fr para 1fr, que anima a altura sem medir nada)
// — é o que mostra ao olho QUAIS saíram. O corpo do painel troca com uma
// subida curta. Quem pediu menos movimento vê a troca direta (o globals zera
// a transição).

import { useState } from 'react'
import { Avatar, Pilula, Rotulo, reais } from './Pecas'

type Modo = 'simples' | 'avancado'

const MENU: { nome: string; avancado?: boolean; grupo?: string }[] = [
  { nome: 'Painel' },
  { nome: 'Balcão', grupo: 'Vender' },
  { nome: 'Vendas' },
  { nome: 'Caixa', avancado: true },
  { nome: 'Produtos', grupo: 'Catálogo' },
  { nome: 'Estoque' },
  { nome: 'Preços', avancado: true },
  { nome: 'Clientes', grupo: 'Pessoas' },
  { nome: 'Tarefas' },
  { nome: 'Financeiro', grupo: 'Dinheiro' },
  { nome: 'Análise', avancado: true },
  { nome: 'Auditoria', grupo: 'Empresa', avancado: true },
]

const OPCOES: { valor: Modo; titulo: string; dica: string }[] = [
  { valor: 'simples', titulo: 'Simples', dica: 'O essencial, com botões grandes' },
  { valor: 'avancado', titulo: 'Avançado', dica: 'Todas as telas, gráficos e colunas' },
]

export function SimplesAvancado() {
  const [modo, setModo] = useState<Modo>('simples')
  const [mexeu, setMexeu] = useState(false)
  const avancado = modo === 'avancado'

  return (
    <div className="flex flex-col gap-5">
      <div
        role="group"
        aria-label="Modo da tela"
        className="mx-auto grid w-full max-w-sm grid-cols-2 gap-1 rounded-xl border border-borda bg-superficie-2 p-1"
      >
        {OPCOES.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={modo === o.valor}
            onClick={() => {
              setModo(o.valor)
              setMexeu(true)
            }}
            className={
              'flex flex-col items-center rounded-lg px-3 py-2 transition-colors ' +
              (modo === o.valor ? 'bg-superficie shadow-norte' : 'hover:bg-superficie/60')
            }
          >
            <span className={'text-sm font-bold ' + (modo === o.valor ? 'text-tinta' : 'text-tinta-2')}>
              {o.titulo}
            </span>
            <span className="text-[11px] text-tinta-3">{o.dica}</span>
          </button>
        ))}
      </div>

      <div
        className="overflow-hidden rounded-2xl border border-borda bg-superficie shadow-norte-alta"
        aria-live="polite"
      >
        <p className="sr-only">
          {avancado
            ? 'Modo avançado: todas as telas no menu, com os números e os gráficos do dia.'
            : 'Modo simples: o menu sem as telas de análise, o que precisa de você hoje e o botão grande de vender.'}
        </p>
        {/* Altura mínima = a do avançado, com o menu inteiro aberto. Sem
            ela, a janela encolhe ao trocar para o simples e a seção inteira
            pula debaixo de quem está lendo. */}
        <div
          aria-hidden
          className="grid min-h-[26.5rem] grid-cols-[8.5rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]"
        >
          {/* O menu. As linhas do avançado fecham e abrem no lugar. */}
          <div className="border-r border-borda-suave px-2 py-3 sm:px-3">
            {MENU.map((i) => {
              const mostra = !i.avancado || avancado
              return (
                <div
                  key={i.nome}
                  className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
                  style={{ gridTemplateRows: mostra ? '1fr' : '0fr', opacity: mostra ? 1 : 0 }}
                >
                  <div className="overflow-hidden">
                    {i.grupo && (
                      <span className="block px-2 pt-2 pb-0.5 text-[9px] font-bold tracking-[0.14em] text-tinta-3 uppercase">
                        {i.grupo}
                      </span>
                    )}
                    <span
                      className={
                        'flex items-center justify-between rounded-md px-2 py-1 text-[12px] ' +
                        (i.nome === 'Painel' ? 'bg-marca-suave font-semibold text-marca' : 'text-tinta-2')
                      }
                    >
                      {i.nome}
                      {i.avancado && (
                        <span className="rounded bg-superficie-2 px-1 text-[8.5px] font-bold text-tinta-3 uppercase">
                          av
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* O corpo: troca inteiro, com a subida curta. */}
          <div key={modo} className={'min-w-0 bg-fundo p-3 sm:p-5 ' + (mexeu ? 'aba-entra' : '')}>
            {avancado ? <CorpoAvancado /> : <CorpoSimples />}
          </div>
        </div>
      </div>
    </div>
  )
}

function CorpoSimples() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-base font-bold text-titulo sm:text-lg">Bom dia, Carlos</p>
        <span className="text-[11px] text-tinta-3">Loja Centro</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col justify-between gap-3 rounded-xl bg-superficie p-4 shadow-norte">
          <div>
            <Rotulo>Vendido hoje</Rotulo>
            <p className="numero mt-1 font-display text-2xl font-bold text-titulo sm:text-3xl">{reais(1284.6)}</p>
          </div>
          <span className="rounded-xl bg-marca py-3 text-center text-base font-bold text-marca-tinta sm:py-4 sm:text-lg">
            Vender
          </span>
        </div>

        <div className="rounded-xl bg-superficie p-4 shadow-norte">
          <Rotulo>Precisa de você hoje</Rotulo>
          <ul className="mt-2 flex flex-col gap-2">
            {[
              ['Camiseta canelada · G acabando', 'atencao', 'repor'],
              ['Conta de luz vence hoje', 'critico', 'pagar'],
              ['Etiquetar a mercadoria nova', 'neutro', 'tarefa'],
            ].map(([t, tom, p]) => (
              <li key={t} className="flex items-center justify-between gap-2 text-[12.5px] text-tinta">
                <span className="min-w-0 truncate">{t}</span>
                <Pilula tom={tom as 'atencao' | 'critico' | 'neutro'}>{p}</Pilula>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

const BARRAS = [30, 44, 38, 62, 55, 70, 48, 66, 82, 74, 90, 60]

function CorpoAvancado() {
  const maior = Math.max(...BARRAS)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ['Vendido', reais(4382.9, 0), '▲ 12%'],
          ['Ticket', reais(146.1, 0), '30 vendas'],
          ['Margem', '43,2%', 'sobre o custo'],
          ['Parado 30+ dias', reais(8940, 0), '112 peças'],
        ].map(([t, v, d]) => (
          <div key={t} className="rounded-lg bg-superficie p-2.5 shadow-norte">
            <Rotulo className="truncate">{t}</Rotulo>
            <p className="numero mt-1 font-display text-base font-bold text-titulo">{v}</p>
            <p className="text-[10px] text-tinta-3">{d}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-lg bg-superficie p-3 shadow-norte">
          <Rotulo>Por hora</Rotulo>
          <div className="mt-2 flex h-20 items-end gap-1">
            {BARRAS.map((b, i) => (
              <span key={i} className="flex-1 rounded-t-[3px] bg-marca" style={{ height: `${(b / maior) * 100}%` }} />
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-superficie p-3 shadow-norte">
          <Rotulo>Quem mais vendeu</Rotulo>
          <ul className="mt-2 flex flex-col gap-1.5 text-[11.5px]">
            {[
              ['MC', 'Marina', 1840],
              ['JP', 'João', 1310],
              ['CS', 'Carlos', 1232],
            ].map(([i, n, v]) => (
              <li key={n as string} className="flex items-center gap-2">
                <Avatar iniciais={i as string} className="size-5 text-[8px]" />
                <span className="flex-1 text-tinta">{n}</span>
                <span className="numero font-semibold text-tinta-2">{reais(v as number, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
