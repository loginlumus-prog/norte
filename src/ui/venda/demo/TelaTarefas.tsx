'use client'

// Tarefas: o quadro em grupos, como na tela de verdade
// (`app/[empresa]/tarefas/Quadro.tsx`) — não é quadro de colunas: é a tabela
// agrupada, com a situação colorida. Trocar a situação é o mesmo gesto de
// lá: tocar na ficha e escolher. Tarefa com prazo vencido e não feita fica
// marcada como atrasada, e sai do "Precisa de você" do painel quando alguém
// dá baixa.

import { useRef, useState } from 'react'
import { Avatar, Pilula, type Tom } from '../Pecas'
import { Estrelas } from '../../Estrelas'
import { Cartao, Fichas, Topo } from './pecas'
import { GRUPOS_TAREFA, SITUACOES, TAREFAS, dataCurta, type SituacaoTarefa } from './dados'
import { PESSOAS, type Acao, type Estado } from './estado'

const TOM: Record<SituacaoTarefa, Tom> = {
  'A fazer': 'neutro',
  'Em andamento': 'atencao',
  Parado: 'critico',
  Feito: 'bom',
}

const COR_GRUPO = ['var(--marca)', 'var(--bom-vivo)', 'var(--atencao-vivo)']

export function TelaTarefas({ estado, fazer }: { estado: Estado; fazer: (a: Acao) => void }) {
  const [aberta, setAberta] = useState<string | null>(null)
  const [quadro, setQuadro] = useState<'loja' | 'minhas'>('loja')
  const gatilhos = useRef(new Map<string, HTMLButtonElement>())
  const avancado = estado.modo === 'avancado'

  function escolher(id: string, s: SituacaoTarefa) {
    fazer({ tipo: 'tarefa', id, situacao: s })
    setAberta(null)
    requestAnimationFrame(() => gatilhos.current.get(id)?.focus())
  }

  const visiveis = TAREFAS.filter((t) => quadro === 'loja' || t.quem === 'MC')
  const feitas = visiveis.filter((t) => estado.tarefas[t.id] === 'Feito').length

  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Tarefas" sub={`${feitas} de ${visiveis.length} feitas`}>
        <Fichas
          rotulo="Quadro"
          valor={quadro}
          onEscolher={(v) => {
            setQuadro(v)
            setAberta(null)
          }}
          opcoes={[
            { valor: 'loja', texto: 'Loja Centro' },
            { valor: 'minhas', texto: 'Minhas tarefas' },
          ]}
        />
      </Topo>

      {GRUPOS_TAREFA.map((g, gi) => {
        const linhas = visiveis.filter((t) => t.grupo === g)
        if (!linhas.length) return null
        return (
          <Cartao key={g} className="!p-0">
            <p
              className="px-3.5 pt-3 pb-1.5 text-[13px] font-bold"
              style={{ color: COR_GRUPO[gi % COR_GRUPO.length] }}
            >
              {g}
            </p>
            <div
              className={
                'hidden grid-cols-[minmax(0,1fr)_7.5rem_2.5rem_4.5rem] gap-2 border-t border-borda-suave px-3.5 py-1.5 text-[9.5px] font-bold tracking-[0.08em] text-tinta-3 uppercase sm:grid ' +
                (avancado ? 'lg:grid-cols-[minmax(0,1fr)_7.5rem_2.5rem_6rem_4.5rem_5rem]' : '')
              }
            >
              <span>Tarefa</span>
              <span>Situação</span>
              <span>Resp.</span>
              {avancado && <span className="hidden lg:block">Linha do tempo</span>}
              <span>Prazo</span>
              {avancado && <span className="hidden lg:block">Prioridade</span>}
            </div>
            <ul>
              {linhas.map((t) => {
                const s = estado.tarefas[t.id]!
                const atrasada = t.prazo < 0 && s !== 'Feito'
                const aberto = aberta === t.id
                return (
                  <li
                    key={t.id}
                    className="border-t border-borda-suave px-3.5 py-2"
                    style={{ boxShadow: `inset 3px 0 0 ${COR_GRUPO[gi % COR_GRUPO.length]}` }}
                  >
                    <div
                      className={
                        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[minmax(0,1fr)_7.5rem_2.5rem_4.5rem] ' +
                        (avancado ? 'lg:grid-cols-[minmax(0,1fr)_7.5rem_2.5rem_6rem_4.5rem_5rem]' : '')
                      }
                    >
                      <span
                        className={
                          'min-w-0 truncate text-[12.5px] font-medium ' +
                          (s === 'Feito' ? 'text-tinta-3 line-through decoration-tinta-3/40' : 'text-tinta')
                        }
                      >
                        {t.nome}
                      </span>
                      <span>
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) gatilhos.current.set(t.id, el)
                          }}
                          aria-expanded={aberto}
                          aria-controls={`situacoes-${t.id}`}
                          onClick={() => setAberta(aberto ? null : t.id)}
                          className="rounded-full focus-visible:outline-offset-1"
                        >
                          <Pilula tom={TOM[s]} className="cursor-pointer gap-1 hover:brightness-95">
                            <span key={s} className="pousa">{s}</span>
                            <span aria-hidden className="text-[8px] opacity-70">▾</span>
                          </Pilula>
                          <span className="sr-only">, mudar a situação de {t.nome}</span>
                        </button>
                      </span>
                      <span className="hidden sm:block">
                        <Avatar iniciais={t.quem} />
                      </span>
                      {avancado && (
                        <span aria-hidden className="relative hidden h-1.5 rounded-full bg-superficie-2 lg:block">
                          <span
                            className="absolute inset-y-0 rounded-full bg-marca"
                            style={{ left: `${t.tempo[0]}%`, width: `${t.tempo[1] - t.tempo[0]}%` }}
                          />
                        </span>
                      )}
                      <span
                        className={
                          'numero col-span-2 text-[11px] sm:col-span-1 ' +
                          (atrasada ? 'font-semibold text-critico' : 'text-tinta-3')
                        }
                      >
                        <span className="sm:hidden">{PESSOAS[t.quem]} · </span>
                        {t.prazo === 0 ? 'hoje' : dataCurta(t.prazo)}
                        {atrasada && <span className="ml-1 text-[10px] sm:ml-0 sm:block">atrasada</span>}
                      </span>
                      {avancado && (
                        <span className="hidden lg:block">
                          <Estrelas valor={t.prioridade} tamanho="sm" />
                        </span>
                      )}
                    </div>
                    {aberto && (
                      <div
                        id={`situacoes-${t.id}`}
                        role="group"
                        aria-label={`Situação de ${t.nome}`}
                        className="pousa mt-2 flex flex-wrap gap-1.5"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setAberta(null)
                            gatilhos.current.get(t.id)?.focus()
                          }
                        }}
                      >
                        {SITUACOES.map((o, i) => (
                          <button
                            key={o}
                            type="button"
                            autoFocus={i === 0}
                            aria-pressed={s === o}
                            onClick={() => escolher(t.id, o)}
                            className="rounded-full focus-visible:outline-offset-1"
                          >
                            <Pilula
                              tom={TOM[o]}
                              className={'cursor-pointer px-2.5 py-1 ' + (s === o ? 'ring-2 ring-current/40' : 'opacity-80 hover:opacity-100')}
                            >
                              {o}
                            </Pilula>
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </Cartao>
        )
      })}
    </div>
  )
}
