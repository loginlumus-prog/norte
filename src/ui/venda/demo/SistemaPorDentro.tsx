'use client'

// "O sistema por dentro": um Norte pequeno, de verdade, para clicar.
//
// ── o que mudou em 25/09 ─────────────────────────────────────
// Eram seis abas com uma tela parada em cada. O dono pediu que a pessoa
// pudesse MEXER: clicar, ver a informação, ter mais dado. Virou um sistema
// de amostra, com o menu da lateral de verdade (os grupos e a ordem de
// `ui/menu.ts`) e oito telas que respondem — vender no balcão tira do
// estoque e soma no painel, pagar uma conta tira do "Precisa de você",
// confirmar uma proposta lança a conta no financeiro.
//
// E a chave Simples | Avançado fica onde fica no sistema: no cabeçalho de
// toda tela. No simples somem do menu as telas de análise, como lá; o que
// muda dentro de cada tela é o que muda lá — colunas, gráficos, filtros.
//
// ── honestidade ──────────────────────────────────────────────
// Toda tela, rótulo, ficha e botão daqui existe no sistema, com o mesmo
// nome. O que não existe não entra — nem como enfeite. Os dados são de uma
// loja que não existe (`dados.ts`), e a faixa de cima diz isso antes do
// primeiro clique.
//
// ── servidor primeiro ────────────────────────────────────────
// O primeiro quadro é desenhado no servidor (o Painel no simples, que é
// onde o sistema abre), com o mesmo dado determinístico que o navegador vai
// calcular — sem sorteio na hora, sem data do relógio. Sem JavaScript a
// pessoa vê o painel inteiro; com ele, o resto acorda.
//
// ── teclado ──────────────────────────────────────────────────
// O menu é uma lista de abas: as setas andam e trocam, Home e End vão às
// pontas, só a tela ativa entra no Tab. Cada item tem `id="tela-…"`, e o
// endereço com esse id (o painel "Produto" da barra e o rodapé apontam para
// eles) abre a tela certa.

import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { Simbolo } from '../../Marca'
import { IconeDoItem } from '../../IconesMenu'
import { IconeVisto } from '../../Icones'
import { Avatar } from '../Pecas'
import { useVisivel } from '../vivo'
import { INICIAL, reduzir, type Modo, type TelaId } from './estado'
import { TelaPainel } from './TelaPainel'
import { TelaBalcao } from './TelaBalcao'
import { TelaEstoque } from './TelaEstoque'
import { TelaFinanceiro } from './TelaFinanceiro'
import { TelaClientes } from './TelaClientes'
import { TelaTarefas } from './TelaTarefas'
import { TelaAnalise } from './TelaAnalise'
import { TelaAssistente, type PoderResumo } from './TelaAssistente'

export type TextoTela = {
  chamada: string
  frases: [string, string, string]
  /** Em que plano isto existe — lido da tabela pela página, nunca à mão. */
  plano: string
}

type ItemMenu = { id: TelaId; nome: string; href: string; grupo?: string; avancado?: boolean }

const MENU: ItemMenu[] = [
  { id: 'painel', nome: 'Painel', href: '/x' },
  { id: 'balcao', nome: 'Balcão', href: '/x/balcao', grupo: 'Vender' },
  { id: 'estoque', nome: 'Estoque', href: '/x/estoque', grupo: 'Catálogo' },
  { id: 'clientes', nome: 'Clientes', href: '/x/clientes', grupo: 'Pessoas' },
  { id: 'tarefas', nome: 'Tarefas', href: '/x/tarefas' },
  { id: 'financeiro', nome: 'Financeiro', href: '/x/financeiro', grupo: 'Dinheiro' },
  { id: 'analise', nome: 'Análise', href: '/x/analise', avancado: true },
  { id: 'assistente', nome: 'Assistente', href: '/x/agente', grupo: 'Empresa' },
]

/** Endereços antigos que ainda circulam (a aba "Equipe e tarefas"). */
const APELIDOS: Record<string, TelaId> = { equipe: 'tarefas' }

const MODOS: { valor: Modo; titulo: string; dica: string }[] = [
  { valor: 'simples', titulo: 'Simples', dica: 'O essencial, com botões grandes. Ideal para o balcão.' },
  { valor: 'avancado', titulo: 'Avançado', dica: 'Todas as telas, gráficos e colunas.' },
]

export function SistemaPorDentro({
  textos,
  consulta,
}: {
  textos: Record<TelaId, TextoTela>
  consulta: PoderResumo[]
}) {
  const [estado, fazer] = useReducer(reduzir, INICIAL)
  const [mexeu, setMexeu] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const botoes = useRef(new Map<TelaId, HTMLButtonElement>())
  const visivel = useVisivel(raiz, 0)

  // No simples, a Análise sai do menu — menos quando é a tela aberta: quem
  // está nela precisa ver onde está (a mesma regra de `noModo`).
  const menu = MENU.filter((i) => !i.avancado || estado.modo === 'avancado' || i.id === estado.tela)

  useEffect(() => {
    const ler = () => {
      const h = window.location.hash.replace('#tela-', '')
      const id = (APELIDOS[h] ?? h) as TelaId
      if (MENU.some((i) => i.id === id)) {
        fazer({ tipo: 'tela', tela: id })
        setMexeu(true)
      }
    }
    ler()
    window.addEventListener('hashchange', ler)
    return () => window.removeEventListener('hashchange', ler)
  }, [])

  function abrir(tela: TelaId, focar = false) {
    fazer({ tipo: 'tela', tela })
    setMexeu(true)
    const b = botoes.current.get(tela)
    if (focar) b?.focus()
    b?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function teclas(e: React.KeyboardEvent, id: TelaId) {
    const i = menu.findIndex((m) => m.id === id)
    const n = menu.length
    const alvo =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? menu[(i + 1) % n]
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? menu[(i - 1 + n) % n]
          : e.key === 'Home'
            ? menu[0]
            : e.key === 'End'
              ? menu[n - 1]
              : undefined
    if (!alvo) return
    e.preventDefault()
    abrir(alvo.id, true)
  }

  // Um "Ver →" do painel ou um "Ver no Financeiro" do assistente troca de
  // tela por dentro; o menu acompanha, e a troca ganha a mesma entrada.
  const fazerComTela: typeof fazer = (a) => {
    if (a.tipo === 'tela') setMexeu(true)
    fazer(a)
  }

  const atual = MENU.find((m) => m.id === estado.tela)!
  const texto = textos[estado.tela]

  let tela: ReactNode
  switch (estado.tela) {
    case 'painel':
      tela = <TelaPainel estado={estado} fazer={fazerComTela} />
      break
    case 'balcao':
      tela = <TelaBalcao estado={estado} fazer={fazerComTela} />
      break
    case 'estoque':
      tela = <TelaEstoque estado={estado} fazer={fazerComTela} />
      break
    case 'financeiro':
      tela = <TelaFinanceiro estado={estado} fazer={fazerComTela} />
      break
    case 'clientes':
      tela = <TelaClientes estado={estado} />
      break
    case 'tarefas':
      tela = <TelaTarefas estado={estado} fazer={fazerComTela} />
      break
    case 'analise':
      tela = <TelaAnalise estado={estado} />
      break
    case 'assistente':
      tela = <TelaAssistente estado={estado} fazer={fazerComTela} consulta={consulta} />
      break
  }

  return (
    <div ref={raiz} data-parado={visivel ? undefined : ''} className="flex flex-col gap-4">
      {/* A faixa de cima: é exemplo, e é para clicar. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-tinta-2">
          <span className="rounded-full bg-marca-suave px-2 py-0.5 text-[11px] font-bold tracking-wide text-marca uppercase">
            Exemplo
          </span>
          Clique para explorar — os dados são de uma loja que não existe
        </span>
        <button
          type="button"
          onClick={() => fazer({ tipo: 'recomecar' })}
          className="rounded-full border border-borda bg-superficie px-3 py-1 text-[12px] font-semibold text-tinta-2 hover:border-tinta-3 hover:text-tinta"
        >
          ↺ Recomeçar o exemplo
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-borda bg-superficie shadow-[var(--sombra-vitrine)]">
        {/* O cabeçalho, como no sistema: a loja, onde se está, e a chave. */}
        <div className="flex items-center gap-2.5 border-b border-borda-suave px-3 py-2.5 sm:px-4">
          <Simbolo tamanho={20} id="por-dentro-sol" />
          <span className="hidden h-7 items-center gap-1.5 rounded-md border border-borda px-2 text-[11.5px] font-semibold text-tinta sm:flex">
            Loja Centro <span className="text-tinta-3">▾</span>
          </span>
          <span className="min-w-0 truncate text-[12px] text-tinta-3">
            <span className="sm:hidden">Loja Centro · </span>
            {atual.nome}
          </span>
          <span className="flex-1" />
          <div role="group" aria-label="Modo da tela" className="flex gap-0.5 rounded-lg bg-superficie-2 p-0.5">
            {MODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                title={m.dica}
                aria-pressed={estado.modo === m.valor}
                onClick={() => {
                  fazer({ tipo: 'modo', modo: m.valor })
                  setMexeu(true)
                }}
                className={
                  'rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ' +
                  (estado.modo === m.valor ? 'bg-superficie text-tinta shadow-norte' : 'text-tinta-3 hover:text-tinta')
                }
              >
                {m.titulo}
              </button>
            ))}
          </div>
          <Avatar iniciais="MC" className="hidden size-7 sm:grid" />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[12rem_minmax(0,1fr)]">
          {/* O menu. No celular vira a fileira de cima, que rola de lado
              DENTRO dela — `relative` porque é caixa que rola. */}
          <div className="relative border-b border-borda-suave md:border-r md:border-b-0">
            <div
              role="tablist"
              aria-label="Telas do Norte"
              aria-orientation="vertical"
              className="sem-barra flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:gap-0.5 md:overflow-visible md:px-3 md:py-4"
            >
              {menu.map((m) => {
                const sim = m.id === estado.tela
                return (
                  <div key={m.id} className="contents md:block">
                    {m.grupo && (
                      <span
                        aria-hidden
                        className="hidden px-2 pt-3 pb-1 text-[9.5px] font-bold tracking-[0.14em] text-tinta-3 uppercase md:block"
                      >
                        {m.grupo}
                      </span>
                    )}
                    <button
                      id={`tela-${m.id}`}
                      ref={(el) => {
                        if (el) botoes.current.set(m.id, el)
                      }}
                      type="button"
                      role="tab"
                      aria-selected={sim}
                      aria-controls="tela-do-exemplo"
                      tabIndex={sim ? 0 : -1}
                      onClick={() => abrir(m.id)}
                      onKeyDown={(e) => teclas(e, m.id)}
                      className={
                        'flex shrink-0 scroll-mt-28 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] whitespace-nowrap transition-colors md:w-full ' +
                        (sim
                          ? 'bg-marca-suave font-semibold text-marca'
                          : 'text-tinta-2 hover:bg-superficie-2 hover:text-tinta')
                      }
                    >
                      <IconeDoItem href={m.href} tamanho={16} />
                      {m.nome}
                      {m.avancado && (
                        <span className="rounded bg-superficie-2 px-1 text-[8.5px] font-bold text-tinta-3 uppercase">av</span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div
            id="tela-do-exemplo"
            role="tabpanel"
            aria-labelledby={`tela-${estado.tela}`}
            tabIndex={-1}
            className="relative min-w-0 bg-fundo p-3 sm:p-5 md:min-h-[38rem]"
          >
            <div key={estado.tela} className={mexeu ? 'tela-entra' : ''}>
              {tela}
            </div>
          </div>
        </div>
      </div>

      {/* O que a tela faz, com o plano em que ela existe. */}
      <div
        key={estado.tela}
        className={
          'grid grid-cols-1 gap-6 rounded-2xl border border-borda-suave bg-fundo p-5 sm:p-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] lg:gap-10 ' +
          (mexeu ? 'tela-entra' : '')
        }
      >
        <div className="flex flex-col gap-3">
          <h3 className="text-[1.5rem] leading-[1.15] text-balance sm:text-[1.75rem]">{texto.chamada}</h3>
          <p className="text-[13px] text-tinta-3">{texto.plano}</p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {texto.frases.map((f) => (
            <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed text-tinta-2">
              <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-marca-suave text-marca">
                <IconeVisto tamanho={12} />
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
