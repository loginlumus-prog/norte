'use client'

// A vitrine do topo: o painel do Norte, vivo.
//
// ── o que mudou em 25/09 ─────────────────────────────────────
// O dono pediu o topo "vivo": que a pessoa chegue e veja o sistema
// TRABALHANDO, não uma foto dele. A vitrine deixou de ser um quadro que anima
// uma vez e passou a ser uma tarde de loja acontecendo em laço curto:
//
//   uma venda fecha no balcão → o "Vendido hoje" corre até o novo total →
//   a coluna da hora de agora cresce → a camiseta chega no mínimo → o
//   "Precisa de você" ganha a linha → o assistente propõe a compra → alguém
//   confirma → a linha sai. E o dia segue, com mais vendas.
//
// Cada passo é uma coisa que o sistema FAZ, com os rótulos da tela de verdade
// (o painel no modo simples: "Vendido hoje", "Hora a hora", "Precisa de
// você", URGENTE e ATENÇÃO). Nenhum número é inventado na hora: sai de
// `demo/dados.ts`, a mesma loja fictícia do sistema por dentro — e a tarde
// termina exatamente no total que o painel de baixo mostra.
//
// ── a regra de sempre ────────────────────────────────────────
// O servidor desenha um quadro COMPLETO e parado: a proposta esperando o
// sim, que é o momento que melhor diz o que o produto é. É isso que fica sem
// JavaScript, e é isso que fica para quem pediu menos movimento. O laço só
// anda com a vitrine na tela, a aba na frente e ninguém tendo apertado
// "Pausar" — o botão existe porque movimento em laço precisa de freio
// (WCAG 2.2.2), e ele também serve para quem pediu menos movimento querer
// ver a tarde andar mesmo assim.
//
// ── acessibilidade ───────────────────────────────────────────
// O quadro é UMA imagem para o leitor de tela, com a descrição do que
// acontece nele. Anunciar cada venda seria ruído — e o que ela mostra está
// escrito nas seções de baixo, e dá para explorar no sistema por dentro.

import { useEffect, useRef, useState } from 'react'
import { Simbolo } from '../Marca'
import { IconeDoItem } from '../IconesMenu'
import { Avatar, Pilula, Rotulo, reais } from './Pecas'
import { useCorrendo, useMenosMovimento, useVisivel } from './vivo'
import {
  CONTAS,
  DIAS,
  HOJE_EXTENSO,
  HORAS_HOJE,
  HORA_AGORA,
  HORA_AO_VIVO,
  PRODUTOS,
  VENDAS_ANTES,
  VENDAS_AO_VIVO,
  horaDaVenda,
  pecasDaVenda,
  produto,
  resumo,
  totalDaVenda,
  type VendaAoVivo,
} from './demo/dados'

/* ═══════════════════════════════════════════════════════════
   O roteiro da tarde
   ═══════════════════════════════════════════════════════════ */

type Passo =
  | { tipo: 'venda'; i: number }
  | { tipo: 'proposta' }
  | { tipo: 'aperta' }
  | { tipo: 'confirma' }

const ROTEIRO: Passo[] = [
  { tipo: 'venda', i: 0 },
  { tipo: 'venda', i: 1 },
  { tipo: 'venda', i: 2 },
  { tipo: 'venda', i: 3 },
  { tipo: 'proposta' },
  { tipo: 'aperta' },
  { tipo: 'confirma' },
  { tipo: 'venda', i: 4 },
  { tipo: 'venda', i: 5 },
  { tipo: 'venda', i: 6 },
]

/** Quanto cada quadro fica na tela antes do próximo, em ms. */
const TEMPO: Record<Passo['tipo'] | 'inicio', number> = {
  inicio: 2600,
  venda: 3300,
  proposta: 3600,
  aperta: 650,
  confirma: 3400,
}

/** O quadro que o servidor desenha: a proposta esperando o sim. */
const REPOUSO = 5

const CAMISETA = 'cam-pre-g'
const AO_VIVO_SOMA = VENDAS_AO_VIVO.reduce((s, v) => s + totalDaVenda(v), 0)
const HOJE = DIAS[DIAS.length - 1]!
const BASE_TOTAL = HOJE.total - AO_VIVO_SOMA
const BASE_VENDAS = HOJE.vendas - VENDAS_AO_VIVO.length
const BASE_HORA = (HORA_AO_VIVO.total ?? 0) - AO_VIVO_SOMA
const CAMISETA_INICIO =
  produto(CAMISETA).estoque +
  VENDAS_AO_VIVO.flatMap((v) => v.itens).filter((i) => i.id === CAMISETA).reduce((s, i) => s + i.q, 0)
const PASSADA_ATE_AGORA = resumo(1).anterior

type Proposta = 'nenhuma' | 'espera' | 'aperta' | 'confirmada'

function quadro(k: number) {
  const feitos = ROTEIRO.slice(0, k)
  const vendas = feitos.flatMap((p) => (p.tipo === 'venda' ? [VENDAS_AO_VIVO[p.i]!] : []))
  const somado = vendas.reduce((s, v) => s + totalDaVenda(v), 0)
  const camiseta =
    CAMISETA_INICIO -
    vendas.flatMap((v) => v.itens).filter((i) => i.id === CAMISETA).reduce((s, i) => s + i.q, 0)
  const tem = (t: Passo['tipo']) => feitos.some((p) => p.tipo === t)
  const proposta: Proposta = tem('confirma')
    ? 'confirmada'
    : tem('aperta')
      ? 'aperta'
      : tem('proposta')
        ? 'espera'
        : 'nenhuma'
  const i = vendas.length ? VENDAS_AO_VIVO.indexOf(vendas.at(-1)!) : -1
  return {
    total: BASE_TOTAL + somado,
    vendas: BASE_VENDAS + vendas.length,
    hora: BASE_HORA + somado,
    camiseta,
    proposta,
    ultima: vendas.at(-1) ?? VENDAS_ANTES[0]!,
    ultimaHora: i >= 0 ? horaDaVenda(i) : horaDaVenda(-1),
    // A confirmação fica na tela uma venda depois de acontecer, e sai.
    mostraProposta: proposta !== 'nenhuma' && vendas.length <= 5,
  }
}

// O teto do gráfico é o maior valor de TODA a tarde, para as colunas não
// mudarem de escala no meio do laço.
const TETO = Math.max(
  ...HORAS_HOJE.map((h) => Math.max(h.passada, h.total ?? 0)),
  BASE_HORA + AO_VIVO_SOMA,
)

/* ═══════════════════════════════════════════════════════════
   A vitrine
   ═══════════════════════════════════════════════════════════ */

const MENU: { grupo?: string; itens: [string, string][] }[] = [
  { itens: [['Painel', '/x']] },
  { grupo: 'Vender', itens: [['Balcão', '/x/balcao'], ['Vendas', '/x/vendas']] },
  { grupo: 'Catálogo', itens: [['Produtos', '/x/produtos'], ['Estoque', '/x/estoque']] },
  { grupo: 'Pessoas', itens: [['Clientes', '/x/clientes'], ['Tarefas', '/x/tarefas']] },
  { grupo: 'Dinheiro', itens: [['Financeiro', '/x/financeiro']] },
  { grupo: 'Empresa', itens: [['Assistente', '/x/agente']] },
]

export function Vitrine() {
  const raiz = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(REPOUSO)
  const [virada, setVirada] = useState(0)
  const [mexeu, setMexeu] = useState(false)
  const [escolha, setEscolha] = useState<'auto' | 'pausa' | 'toca'>('auto')

  const menos = useMenosMovimento()
  const visivel = useVisivel(raiz, 0.2)
  const querMexer = escolha === 'toca' || (escolha === 'auto' && menos !== true)
  const rodando = querMexer && visivel && menos !== null

  useEffect(() => {
    if (!rodando) return
    const anterior = k === 0 ? 'inicio' : ROTEIRO[k - 1]!.tipo
    const t = setTimeout(() => {
      setMexeu(true)
      if (k >= ROTEIRO.length) {
        setK(0)
        setVirada((v) => v + 1)
      } else setK(k + 1)
    }, TEMPO[anterior])
    return () => clearTimeout(t)
  }, [rodando, k])

  const q = quadro(k)
  // Na virada do dia o número volta; voltar correndo pareceria estorno.
  const anima = menos === false && k !== 0
  const total = useCorrendo(q.total, anima, 800)
  const hora = useCorrendo(q.hora, anima, 800)
  const pct = Math.round((q.total / PASSADA_ATE_AGORA - 1) * 100)

  return (
    <div ref={raiz} className="relative mx-auto w-full max-w-6xl">
      {/* A legenda de cima: diz que é exemplo, e dá o freio. */}
      <div className="chega mb-3 flex items-center justify-between gap-3 px-1" style={{ '--d': '.5s' } as React.CSSProperties}>
        <span className="flex items-center gap-2 text-[12.5px] text-tinta-3">
          <span
            aria-hidden
            className={'size-2 rounded-full bg-bom-vivo ' + (rodando ? 'pulsa pulsa-bom' : '')}
          />
          Uma tarde de exemplo, numa loja que não existe
        </span>
        <button
          type="button"
          onClick={() => setEscolha(querMexer ? 'pausa' : 'toca')}
          aria-pressed={!querMexer}
          className="flex items-center gap-1.5 rounded-full border border-borda bg-superficie px-3 py-1 text-[12px] font-semibold text-tinta-2 hover:border-tinta-3 hover:text-tinta"
        >
          <svg aria-hidden viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            {querMexer ? (
              <path d="M4 3h3v10H4zM9 3h3v10H9z" />
            ) : (
              <path d="M4.5 2.8v10.4L13 8z" />
            )}
          </svg>
          {querMexer ? 'Pausar' : 'Ver acontecer'}
          <span className="sr-only"> a demonstração do topo</span>
        </button>
      </div>

      <div className="janela-sobe relative">
        <div aria-hidden className="halo-vitrine" />
        <div
          role="img"
          aria-label="O painel do Norte numa tarde de exemplo: vendas fechando no balcão, o total do dia subindo, a coluna da hora crescendo, uma camiseta chegando no estoque mínimo e o assistente propondo a compra de reposição, que alguém confirma na tela."
          className="relative"
        >
          <div className="overflow-hidden rounded-2xl border border-borda bg-superficie shadow-[var(--sombra-vitrine)]">
            {/* A barra fina de cima, como no sistema: a loja e a chave do modo. */}
            <div className="flex items-center gap-3 border-b border-borda-suave px-4 py-2.5">
              <Simbolo tamanho={20} id="vitrine-sol" />
              <span className="flex h-7 items-center gap-1.5 rounded-md border border-borda px-2 text-[11.5px] font-semibold text-tinta">
                Loja Centro
                <span className="text-tinta-3">▾</span>
              </span>
              <span className="flex-1" />
              <span className="hidden gap-0.5 rounded-lg bg-superficie-2 p-0.5 text-[11px] font-semibold sm:flex">
                <span className="rounded-md bg-superficie px-2 py-0.5 text-tinta shadow-norte">Simples</span>
                <span className="px-2 py-0.5 text-tinta-3">Avançado</span>
              </span>
              <Avatar iniciais="MC" className="size-7" />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[11.5rem_minmax(0,1fr)]">
              <aside className="hidden flex-col gap-2.5 border-r border-borda-suave px-3 py-4 md:flex">
                {MENU.map((b, n) => (
                  <div key={n} className="flex flex-col gap-0.5">
                    {b.grupo && (
                      <span className="px-2 pb-0.5 text-[9.5px] font-bold tracking-[0.14em] text-tinta-3 uppercase">
                        {b.grupo}
                      </span>
                    )}
                    {b.itens.map(([nome, href]) => (
                      <span
                        key={nome}
                        className={
                          'flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] ' +
                          (nome === 'Painel' ? 'bg-marca-suave font-semibold text-marca' : 'text-tinta-2')
                        }
                      >
                        <IconeDoItem href={href} tamanho={14} />
                        {nome}
                      </span>
                    ))}
                  </div>
                ))}
              </aside>

              <div
                key={virada}
                className={'flex min-w-0 flex-col gap-3.5 bg-fundo p-4 sm:p-5 ' + (virada ? 'vira-dia' : '')}
              >
                <div>
                  <p className="text-[11px] text-tinta-3">{HOJE_EXTENSO}</p>
                  <p className="font-display text-lg font-bold tracking-tight text-titulo">Boa tarde, Marina</p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                  <Numero rotulo="Vendido hoje" destaque>
                    <span className="numero">{reais(total)}</span>
                    <span className={'mt-1 block text-[10.5px] font-semibold ' + (pct >= 0 ? 'text-bom' : 'text-critico')}>
                      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%{' '}
                      <span className="font-normal text-tinta-3">vs quinta passada</span>
                    </span>
                  </Numero>
                  <Numero rotulo="Vendas">
                    <span key={mexeu ? q.vendas : 'x'} className={'numero px-0.5 ' + (mexeu ? 'tique' : '')}>
                      {q.vendas}
                    </span>
                    <span className="mt-1 block text-[10.5px] text-tinta-3">a última às {q.ultimaHora}</span>
                  </Numero>
                  <Numero rotulo="Ticket médio">
                    <span className="numero">{reais(q.total / q.vendas)}</span>
                    <span className="mt-1 block text-[10.5px] text-tinta-3">por venda</span>
                  </Numero>
                  <Numero rotulo="Quinta passada">
                    <span className="numero">{reais(PASSADA_ATE_AGORA)}</span>
                    <span className="mt-1 block text-[10.5px] text-tinta-3">até esta hora</span>
                  </Numero>
                </div>

                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                  <HoraAHora hora={hora} />
                  <PrecisaDeVoce camiseta={q.camiseta} proposta={q.proposta} mexeu={mexeu} />
                </div>
              </div>
            </div>
          </div>

          {/* ── os cartões por cima: o que acontece fora do painel ── */}
          <VendaConcluida venda={q.ultima} hora={q.ultimaHora} />
          {q.mostraProposta && <PropostaCartao estado={q.proposta} />}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   As peças
   ═══════════════════════════════════════════════════════════ */

function Numero({
  rotulo,
  destaque,
  children,
}: {
  rotulo: string
  destaque?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={'rounded-xl bg-superficie p-3 shadow-norte ' + (destaque ? 'ring-1 ring-marca/15' : '')}>
      <Rotulo>{rotulo}</Rotulo>
      <p
        className={
          'mt-1.5 font-display leading-none font-bold tracking-tight text-titulo ' +
          (destaque ? 'text-[1.3rem] sm:text-2xl' : 'text-lg sm:text-xl')
        }
      >
        {children}
      </p>
    </div>
  )
}

/** "Hora a hora": hoje em azul, a quinta passada em cinza atrás. */
function HoraAHora({ hora }: { hora: number }) {
  return (
    <div className="rounded-xl bg-superficie p-3.5 shadow-norte">
      <div className="flex items-baseline justify-between">
        <Rotulo>Hora a hora</Rotulo>
        <span className="flex items-center gap-3 text-[10px] text-tinta-3">
          <span className="flex items-center gap-1">
            <i className="size-2 rounded-sm bg-marca" /> hoje
          </span>
          <span className="flex items-center gap-1">
            <i className="size-2 rounded-sm bg-superficie-3" /> quinta passada
          </span>
        </span>
      </div>
      <div className="mt-3 flex h-28 items-end gap-[3.5%] sm:h-32">
        {HORAS_HOJE.map((h) => {
          const agora = h.hora === HORA_AGORA
          const v = agora ? hora : h.total
          return (
            <span key={h.hora} className="relative h-full flex-1">
              <span
                className="absolute inset-x-0 bottom-0 h-full origin-bottom rounded-t-[4px] bg-superficie-3"
                style={{ transform: `scaleY(${h.passada / TETO})` }}
              />
              {v !== null && (
                <span
                  className={
                    'coluna-viva absolute inset-x-[18%] bottom-0 h-full rounded-t-[3px] ' +
                    (agora ? 'bg-marca' : 'bg-marca/80')
                  }
                  style={{ transform: `scaleY(${v / TETO})` }}
                />
              )}
            </span>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9.5px] text-tinta-3">
        <span>8h</span>
        <span>11h</span>
        <span>14h</span>
        <span className="font-semibold text-marca">agora</span>
        <span>19h</span>
      </div>
    </div>
  )
}

type Linha = { chave: string; nivel: 'URGENTE' | 'ATENÇÃO'; frase: string; detalhe: string; conta?: number }

const ACABARAM = PRODUTOS.filter((p) => p.estoque <= 0)
const VENCIDAS = CONTAS.filter((c) => c.vence < 0)
const HOJE_VENCE = CONTAS.filter((c) => c.vence === 0)
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

function PrecisaDeVoce({
  camiseta,
  proposta,
  mexeu,
}: {
  camiseta: number
  proposta: Proposta
  mexeu: boolean
}) {
  const noMinimo = PRODUTOS.filter((p) => {
    const e = p.id === CAMISETA ? camiseta : p.estoque
    return e > 0 && e <= p.minimo
  })
  const linhas: Linha[] = [
    {
      chave: 'acabaram',
      nivel: 'URGENTE',
      frase: plural(ACABARAM.length, 'produto acabou', 'produtos acabaram'),
      detalhe: `${ACABARAM[0]!.nome} · ${ACABARAM[0]!.grade}${ACABARAM.length > 1 ? ` e mais ${ACABARAM.length - 1}` : ''}`,
    },
    {
      chave: 'vencidas',
      nivel: 'URGENTE',
      frase: plural(VENCIDAS.length, 'conta vencida', 'contas vencidas'),
      detalhe: `${VENCIDAS[0]!.descricao} · ${reais(VENCIDAS[0]!.valor)}`,
    },
    {
      chave: 'hoje',
      nivel: 'ATENÇÃO',
      frase: plural(HOJE_VENCE.length, 'conta vence hoje', 'contas vencem hoje'),
      detalhe: `${HOJE_VENCE[0]!.descricao} · ${reais(HOJE_VENCE[0]!.valor)}`,
    },
    {
      chave: 'minimo',
      nivel: 'ATENÇÃO',
      frase: plural(noMinimo.length, 'produto no mínimo', 'produtos no mínimo'),
      detalhe: noMinimo.map((p) => `${p.nome} ${p.grade.split(' · ')[1]}`).join(', '),
      conta: noMinimo.length,
    },
  ]
  if (proposta === 'espera' || proposta === 'aperta') {
    linhas.push({
      chave: 'proposta',
      nivel: 'ATENÇÃO',
      frase: '1 proposta do assistente esperando você',
      detalhe: 'Valem por 24 horas',
    })
  }

  return (
    <div className="rounded-xl bg-superficie p-3.5 shadow-norte">
      <div className="flex items-center gap-2">
        <Rotulo>Precisa de você</Rotulo>
        <span
          key={mexeu ? linhas.length : 'x'}
          className={
            'numero grid h-4 min-w-4 place-items-center rounded-full bg-critico-fundo px-1 text-[9.5px] font-bold text-critico ' +
            (mexeu ? 'pousa' : '')
          }
        >
          {linhas.length}
        </span>
      </div>
      {/* Altura de cinco linhas sempre: a quinta entra e sai sem empurrar nada. */}
      <ul className="mt-2 flex min-h-[12.75rem] flex-col">
        {linhas.map((l) => (
          <li
            key={l.chave}
            className={
              'flex items-center gap-2 border-t border-borda-suave py-1.5 first:border-t-0 ' +
              (mexeu && l.chave === 'proposta' ? 'pousa' : '')
            }
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span
                  className={
                    'shrink-0 text-[8.5px] font-bold tracking-[0.1em] ' +
                    (l.nivel === 'URGENTE' ? 'text-critico' : 'text-atencao')
                  }
                >
                  {l.nivel}
                </span>
                <span
                  key={mexeu && l.conta !== undefined ? l.conta : 'x'}
                  className={
                    'truncate px-0.5 text-[11.5px] font-semibold text-tinta ' +
                    (mexeu && l.conta !== undefined ? 'tique' : '')
                  }
                >
                  {l.frase}
                </span>
              </span>
              <span className="truncate text-[10.5px] text-tinta-3">{l.detalhe}</span>
            </span>
            <span className="shrink-0 text-[10.5px] font-semibold text-marca">Ver →</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function VendaConcluida({ venda, hora }: { venda: VendaAoVivo; hora: string }) {
  const primeiro = produto(venda.itens[0]!.id)
  const outros = pecasDaVenda(venda) - venda.itens[0]!.q
  return (
    <div
      key={venda.numero}
      className="pousa absolute top-[46%] -left-4 hidden xl:-left-12 w-64 rounded-xl border border-borda bg-superficie p-3.5 shadow-norte-alta lg:block"
    >
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-bom-fundo text-bom">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 L10 17.5 L19 7.5" />
          </svg>
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[12px] font-bold text-tinta">Venda concluída</span>
          <span className="numero text-[10.5px] text-tinta-3">
            Nº {venda.numero.toLocaleString('pt-BR')} · Balcão · {hora}
          </span>
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-borda-suave pt-2.5">
        <span className="flex min-w-0 flex-col text-[10.5px] text-tinta-3">
          <span className="truncate text-tinta-2">
            {primeiro.nome} {primeiro.grade.split(' · ')[1]}
            {outros > 0 ? ` + ${outros}` : ''}
          </span>
          {venda.pagamento}
        </span>
        <span className="numero font-display text-xl font-bold text-titulo">{reais(totalDaVenda(venda))}</span>
      </div>
    </div>
  )
}

function PropostaCartao({ estado }: { estado: Proposta }) {
  const confirmada = estado === 'confirmada'
  return (
    <div className="pousa absolute top-[9%] -right-4 hidden xl:-right-12 w-80 rounded-xl border border-borda bg-superficie p-3.5 shadow-norte-alta lg:block">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-bom-vivo text-[11px] font-bold text-white">
          A
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[12px] font-bold text-tinta">Aurora · assistente</span>
          <span className="text-[10.5px] text-tinta-3">
            {confirmada ? 'proposta confirmada na tela' : 'proposta · espera o seu sim'}
          </span>
        </span>
      </div>
      <div key={confirmada ? 'sim' : 'espera'} className={confirmada ? 'pousa' : ''}>
        {confirmada ? (
          <div className="mt-2.5 flex flex-col gap-2">
            <p className="flex items-start gap-2 text-[12.5px] leading-snug text-tinta">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-bom-vivo text-[9px] font-bold text-white">
                ✓
              </span>
              <span>
                Compra de 20 un. registrada em contas a pagar · <b className="numero">{reais(448)}</b>
              </span>
            </p>
            <p className="flex items-center gap-2 text-[10.5px] text-tinta-3">
              <Avatar iniciais="MC" className="size-5 text-[8px]" />
              Confirmada por Marina · no livro de auditoria
            </p>
          </div>
        ) : (
          <>
            <p className="mt-2.5 text-[12.5px] leading-snug text-tinta">
              A Camiseta canelada Preto · G chegou no mínimo: 2 peças, acaba amanhã. Registro a compra
              de <b>20 un.</b> (<b className="numero">{reais(448)}</b>) em contas a pagar?
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-md border border-borda px-3 py-1 text-[11.5px] font-semibold text-tinta-2">
                Não
              </span>
              <span
                className={
                  'rounded-md bg-marca px-3 py-1 text-[11.5px] font-semibold text-marca-tinta ' +
                  (estado === 'aperta' ? 'aperta' : '')
                }
              >
                Confirmar
              </span>
              <Pilula tom="neutro" className="ml-auto !text-[10px]">
                vale 24 horas
              </Pilula>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
