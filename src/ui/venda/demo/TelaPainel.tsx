'use client'

// O Painel, nos dois modos.
//
// Simples: o dia de hoje e o que precisa de você — cada linha leva à tela que
// resolve, e some quando a pessoa resolve lá. Avançado: o período escolhido
// contra o anterior, com o gráfico que responde ao mouse. Os rótulos são os
// da tela de verdade (`app/[empresa]/page.tsx`).

import { useState } from 'react'
import { Avatar, Barra, Rotulo, reais } from '../Pecas'
import { Cartao, Fichas, Grafico, Topo } from './pecas'
import {
  DIAS,
  HOJE_EXTENSO,
  HORAS_HOJE,
  HORA_AGORA,
  PRODUTOS,
  TAREFAS,
  VENDEDORES,
  dataComSemana,
  noMinimo,
  resumo,
} from './dados'
import { contasEmAberto, type Acao, type Estado, type TelaId } from './estado'

type Periodo = 'hoje' | '7' | '30'
const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: 'hoje', texto: 'Hoje' },
  { valor: '7', texto: '7 dias' },
  { valor: '30', texto: '30 dias' },
]

const pct = (a: number, b: number) => (b ? Math.round((a / b - 1) * 100) : 0)

function Variacao({ agora, antes, contra }: { agora: number; antes: number; contra: string }) {
  const v = pct(agora, antes)
  return (
    <span className={'mt-1 block text-[10.5px] font-semibold ' + (v >= 0 ? 'text-bom' : 'text-critico')}>
      {v >= 0 ? '▲' : '▼'} {Math.abs(v)}% <span className="font-normal text-tinta-3">{contra}</span>
    </span>
  )
}

export function TelaPainel({ estado, fazer }: { estado: Estado; fazer: (a: Acao) => void }) {
  return estado.modo === 'simples' ? (
    <PainelSimples estado={estado} fazer={fazer} />
  ) : (
    <PainelAvancado estado={estado} />
  )
}

/* ═══════════════════════════════════════════════════════════
   Simples
   ═══════════════════════════════════════════════════════════ */

type Pendencia = {
  chave: string
  nivel: 'URGENTE' | 'ATENÇÃO'
  frase: string
  detalhe: string
  vai: TelaId
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

function pendencias(e: Estado): Pendencia[] {
  const saldo = (id: string) => e.estoque[id] ?? 0
  const acabaram = PRODUTOS.filter((p) => saldo(p.id) <= 0)
  const minimo = PRODUTOS.filter((p) => noMinimo(p, saldo(p.id)))
  const contas = contasEmAberto(e)
  const vencidas = contas.filter((c) => c.vence < 0)
  const hoje = contas.filter((c) => c.vence === 0)
  const propostas = Object.values(e.propostas).filter((s) => s === 'espera').length
  const atrasadas = TAREFAS.filter((t) => t.prazo < 0 && e.tarefas[t.id] !== 'Feito')
  const soma = (xs: { valor: number }[]) => reais(xs.reduce((s, c) => s + c.valor, 0))

  const l: Pendencia[] = []
  if (acabaram.length)
    l.push({
      chave: 'acabaram',
      nivel: 'URGENTE',
      frase: plural(acabaram.length, 'produto acabou', 'produtos acabaram'),
      detalhe: acabaram.map((p) => `${p.nome} ${p.grade.split(' · ')[1]}`).join(', '),
      vai: 'estoque',
    })
  if (vencidas.length)
    l.push({
      chave: 'vencidas',
      nivel: 'URGENTE',
      frase: plural(vencidas.length, 'conta vencida', 'contas vencidas'),
      detalhe: `${vencidas.map((c) => c.descricao).join(', ')} · ${soma(vencidas)}`,
      vai: 'financeiro',
    })
  if (hoje.length)
    l.push({
      chave: 'hoje',
      nivel: 'ATENÇÃO',
      frase: plural(hoje.length, 'conta vence hoje', 'contas vencem hoje'),
      detalhe: `${hoje.map((c) => c.descricao).join(', ')} · ${soma(hoje)}`,
      vai: 'financeiro',
    })
  if (minimo.length)
    l.push({
      chave: 'minimo',
      nivel: 'ATENÇÃO',
      frase: plural(minimo.length, 'produto no mínimo', 'produtos no mínimo'),
      detalhe: minimo.map((p) => `${p.nome} ${p.grade.split(' · ')[1]}`).join(', '),
      vai: 'estoque',
    })
  if (propostas)
    l.push({
      chave: 'propostas',
      nivel: 'ATENÇÃO',
      frase: plural(propostas, 'proposta do assistente esperando você', 'propostas do assistente esperando você'),
      detalhe: 'Valem por 24 horas — depois ele propõe de novo',
      vai: 'assistente',
    })
  if (atrasadas.length)
    l.push({
      chave: 'tarefas',
      nivel: 'ATENÇÃO',
      frase: plural(atrasadas.length, 'tarefa da equipe atrasada', 'tarefas da equipe atrasadas'),
      detalhe: atrasadas.map((t) => t.nome).join(', '),
      vai: 'tarefas',
    })
  return l
}

function hoje(e: Estado) {
  const r = resumo(1)
  return { total: r.total + e.extra.total, vendas: r.vendas + e.extra.vendas, anterior: r.anterior }
}

function PainelSimples({ estado, fazer }: { estado: Estado; fazer: (a: Acao) => void }) {
  const h = hoje(estado)
  const lista = pendencias(estado)
  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Boa tarde, Marina" sub={HOJE_EXTENSO} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col gap-3">
          <Cartao className="flex flex-col gap-3">
            <div>
              <Rotulo>Vendido hoje</Rotulo>
              <p className="numero mt-1 font-display text-[1.75rem] leading-none font-bold tracking-tight text-titulo">
                {reais(h.total)}
              </p>
              <p className="mt-1 text-[11px] text-tinta-3">{h.vendas} vendas</p>
              <Variacao agora={h.total} antes={h.anterior} contra="vs quinta passada, até esta hora" />
            </div>
            <button
              type="button"
              onClick={() => fazer({ tipo: 'tela', tela: 'balcao' })}
              className="botao-marca rounded-xl py-3 text-center text-base font-bold text-marca-tinta"
            >
              Vender
            </button>
          </Cartao>
          <Cartao>
            <Rotulo>Hora a hora</Rotulo>
            <div className="mt-8">
              <Grafico
                pontos={HORAS_HOJE.map((x) => ({
                  rotulo: `${x.hora}h`,
                  valor: x.hora === HORA_AGORA && x.total !== null ? x.total + estado.extra.total : x.total,
                  anterior: x.passada,
                  detalhe: x.vendas !== null ? plural(x.vendas + (x.hora === HORA_AGORA ? estado.extra.vendas : 0), 'venda', 'vendas') : undefined,
                }))}
                formatar={(v) => reais(v)}
                descricao="Vendas de hoje, hora a hora, contra a quinta passada"
                eixo={(i) => (i % 3 === 0 ? `${8 + i}h` : null)}
                altura="h-24"
                nomeAnterior="quinta passada"
              />
            </div>
          </Cartao>
        </div>

        <Cartao>
          <div className="flex items-center gap-2">
            <Rotulo>Precisa de você</Rotulo>
            {lista.length > 0 && (
              <span key={lista.length} className="pousa numero grid h-4 min-w-4 place-items-center rounded-full bg-critico-fundo px-1 text-[9.5px] font-bold text-critico">
                {lista.length}
              </span>
            )}
          </div>
          {lista.length === 0 ? (
            <div className="pousa mt-6 flex flex-col items-center gap-2 py-6 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-bom-fundo text-lg font-bold text-bom">✓</span>
              <p className="font-display text-base font-bold text-titulo">Tudo em dia</p>
              <p className="max-w-[16rem] text-[12px] text-tinta-2">
                Nada acabou, nada venceu, ninguém está esperando você.
              </p>
            </div>
          ) : (
            <ul className="mt-2 flex flex-col">
              {lista.map((l) => (
                <li key={l.chave} className="flex items-center gap-2 border-t border-borda-suave py-2 first:border-t-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={
                          'shrink-0 text-[9px] font-bold tracking-[0.1em] ' +
                          (l.nivel === 'URGENTE' ? 'text-critico' : 'text-atencao')
                        }
                      >
                        {l.nivel}
                      </span>
                      <span className="truncate text-[12.5px] font-semibold text-tinta">{l.frase}</span>
                    </span>
                    <span className="truncate text-[11px] text-tinta-3">{l.detalhe}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => fazer({ tipo: 'tela', tela: l.vai })}
                    className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-marca hover:bg-marca-suave"
                  >
                    Ver →<span className="sr-only"> {l.frase}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Avançado
   ═══════════════════════════════════════════════════════════ */

function PainelAvancado({ estado }: { estado: Estado }) {
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const dias = periodo === 'hoje' ? 1 : Number(periodo)
  const r = resumo(dias)
  const total = r.total + estado.extra.total
  const vendas = r.vendas + estado.extra.vendas
  const custo = r.total * (1 - r.margem / 100) + estado.extra.custo
  const margem = total ? Math.round(((total - custo) / total) * 1000) / 10 : 0
  const contra = periodo === 'hoje' ? 'vs quinta passada' : `vs ${dias} dias antes`

  const pontos =
    periodo === 'hoje'
      ? HORAS_HOJE.map((x) => ({
          rotulo: `${x.hora}h`,
          valor: x.hora === HORA_AGORA && x.total !== null ? x.total + estado.extra.total : x.total,
          anterior: x.passada,
          detalhe: x.vendas !== null ? `${x.vendas + (x.hora === HORA_AGORA ? estado.extra.vendas : 0)} vendas` : undefined,
        }))
      : DIAS.slice(-dias).map((d, i) => ({
          rotulo: dataComSemana(d.n),
          valor: d.n === 0 ? d.total + estado.extra.total : d.total,
          anterior: DIAS[DIAS.length - dias * 2 + i]!.total,
          detalhe: `${d.n === 0 ? d.vendas + estado.extra.vendas : d.vendas} vendas`,
        }))

  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Painel" sub={HOJE_EXTENSO}>
        <Fichas rotulo="Período" opcoes={PERIODOS} valor={periodo} onEscolher={setPeriodo} />
      </Topo>

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Cartao>
          <Rotulo>{periodo === 'hoje' ? 'Vendido hoje' : `Vendido em ${dias} dias`}</Rotulo>
          <p className="numero mt-1 font-display text-lg font-bold text-titulo sm:text-xl">{reais(total)}</p>
          <Variacao agora={total} antes={r.anterior} contra={contra} />
        </Cartao>
        <Cartao>
          <Rotulo>Média por dia</Rotulo>
          <p className="numero mt-1 font-display text-lg font-bold text-titulo sm:text-xl">
            {reais(periodo === 'hoje' ? total : total / dias)}
          </p>
          <span className="mt-1 block text-[10.5px] text-tinta-3">{vendas} vendas no período</span>
        </Cartao>
        <Cartao>
          <Rotulo>Ticket médio</Rotulo>
          <p className="numero mt-1 font-display text-lg font-bold text-titulo sm:text-xl">{reais(total / vendas)}</p>
          <span className="mt-1 block text-[10.5px] text-tinta-3">por venda</span>
        </Cartao>
        <Cartao>
          <Rotulo>Margem</Rotulo>
          <p className="numero mt-1 font-display text-lg font-bold text-titulo sm:text-xl">
            {margem.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
          </p>
          <span className="mt-1 block text-[10.5px] text-tinta-3">sobre o custo das peças</span>
        </Cartao>
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Cartao>
          <div className="flex items-baseline justify-between gap-2">
            <Rotulo>{periodo === 'hoje' ? 'Por hora do dia' : 'Movimento'}</Rotulo>
            <span className="flex items-center gap-3 text-[10px] text-tinta-3">
              <span className="flex items-center gap-1">
                <i className="h-0.5 w-3 rounded bg-marca" /> {periodo === 'hoje' ? 'hoje' : 'este período'}
              </span>
              <span className="flex items-center gap-1">
                <i className="h-0.5 w-3 rounded bg-tinta-3/60" /> {periodo === 'hoje' ? 'quinta passada' : 'anterior'}
              </span>
            </span>
          </div>
          <div className="mt-10">
            <Grafico
              key={periodo}
              pontos={pontos}
              tipo={periodo === 'hoje' ? 'barras' : 'linha'}
              formatar={(v) => reais(v)}
              descricao={
                periodo === 'hoje'
                  ? 'Vendas de hoje por hora, contra a quinta passada'
                  : `Vendas por dia nos últimos ${dias} dias, contra os ${dias} dias antes`
              }
              eixo={(i) =>
                periodo === 'hoje'
                  ? i % 3 === 0
                    ? `${8 + i}h`
                    : null
                  : i === 0 || i === pontos.length - 1 || (dias === 30 && i % 7 === 0 && i < pontos.length - 4)
                    ? pontos[i]!.rotulo.split(', ')[1]!
                    : null
              }
              nomeAnterior={periodo === 'hoje' ? 'quinta passada' : 'período anterior'}
            />
          </div>
        </Cartao>

        <Cartao>
          <Rotulo>Quem mais vendeu</Rotulo>
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {VENDEDORES.map((v, i) => (
              <li key={v.nome} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[12px]">
                  <Avatar iniciais={v.iniciais} className="size-5 text-[8px]" />
                  <span className="flex-1 text-tinta">{v.nome}</span>
                  <span className="numero font-semibold text-tinta-2">{reais(total * v.parte, 0)}</span>
                </span>
                <Barra key={periodo} valor={(v.parte / VENDEDORES[0]!.parte) * 100} tom={i === 0 ? 'bom' : 'marca'} />
              </li>
            ))}
          </ul>
        </Cartao>
      </div>
    </div>
  )
}
