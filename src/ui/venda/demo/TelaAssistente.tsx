'use client'

// O Assistente: as propostas esperando o sim, e é AQUI que se confirma —
// na tela, nunca por mensagem (`servidor/assistente/regras.ts`). Os textos
// são os da tela de verdade (`app/[empresa]/agente/Propostas.tsx`): "Esperando
// você", a chave do poder crua na ficha, "expira em Nh", "Não" e
// "Confirmar". Só aparecem os três poderes de agir que já existem.
//
// Confirmar mexe no resto do exemplo: a compra e o frete entram em contas a
// pagar no Financeiro; o ajuste soma as peças no Estoque.

import { Pilula, Rotulo, reais } from '../Pecas'
import { Cartao, Topo, botaoMarca, botaoLinha } from './pecas'
import { PROPOSTAS } from './dados'
import type { Acao, Estado, TelaId } from './estado'

export type PoderResumo = { titulo: string; disponivel: boolean }

export function TelaAssistente({
  estado,
  fazer,
  consulta,
}: {
  estado: Estado
  fazer: (a: Acao) => void
  /** O que ele consulta sozinho, lido de `servidor/poderes.ts` pela página. */
  consulta: PoderResumo[]
}) {
  const esperando = PROPOSTAS.filter((p) => estado.propostas[p.id] === 'espera').length
  const avancado = estado.modo === 'avancado'

  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Assistente" sub="Aurora · o nome é você quem dá">
        <Pilula tom="bom">funcionando</Pilula>
      </Topo>

      {esperando > 0 && (
        <p className="pulsa pulsa-atencao rounded-lg border border-atencao-borda bg-atencao-fundo px-3 py-2 text-[12px] leading-snug text-atencao">
          <b>
            {esperando} {esperando === 1 ? 'proposta parada' : 'propostas paradas'}.
          </b>{' '}
          Elas valem por 24 horas — depois disso o estoque e o preço já são outros, e ele precisa propor de novo.
        </p>
      )}

      <div className={'grid grid-cols-1 gap-3 ' + (avancado ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : '')}>
        <Cartao>
          <Rotulo>Esperando você</Rotulo>
          <ul className="mt-2 flex flex-col gap-2">
            {PROPOSTAS.map((p) => {
              const s = estado.propostas[p.id]
              const leva: { tela: TelaId; texto: string } =
                p.efeito.tipo === 'conta'
                  ? { tela: 'financeiro', texto: 'Ver no Financeiro' }
                  : { tela: 'estoque', texto: 'Ver no Estoque' }
              return (
                <li key={p.id} className="rounded-lg border border-borda p-3">
                  <p className="text-[12.5px] leading-snug text-tinta">{p.resumo}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-tinta-3">
                    <span className="rounded bg-superficie-2 px-1.5 py-0.5 font-mono">{p.poder}</span>
                    {s === 'espera' && <span>expira em {p.expira}h</span>}
                    {p.valor !== null && (
                      <b className="numero ml-auto text-[13px] text-tinta">{reais(p.valor)}</b>
                    )}
                  </div>
                  <div key={s} className={'mt-2.5 ' + (s === 'espera' ? '' : 'pousa')}>
                    {s === 'espera' ? (
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fazer({ tipo: 'proposta', id: p.id, sim: false })}
                          className={botaoLinha}
                        >
                          Não<span className="sr-only">: {p.resumo}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => fazer({ tipo: 'proposta', id: p.id, sim: true })}
                          className={botaoMarca}
                        >
                          Confirmar<span className="sr-only">: {p.resumo}</span>
                        </button>
                      </span>
                    ) : s === 'confirmada' ? (
                      <span className="flex flex-wrap items-center gap-2 text-[11.5px]">
                        <span className="grid size-4 place-items-center rounded-full bg-bom-vivo text-[9px] font-bold text-white">✓</span>
                        <span className="font-semibold text-bom">Confirmada por você · no livro de auditoria</span>
                        <button
                          type="button"
                          onClick={() => fazer({ tipo: 'tela', tela: leva.tela })}
                          className="ml-auto rounded-md px-1.5 py-0.5 font-semibold text-marca hover:bg-marca-suave"
                        >
                          {leva.texto} →
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-tinta-3">Recusada. Nada mudou.</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-2.5 text-[11px] text-tinta-3">
            A confirmação é aqui, na tela — nunca por mensagem.
          </p>
        </Cartao>

        {avancado && (
          <div className="tela-entra flex flex-col gap-3">
            <Cartao>
              <Rotulo>Até onde ele vai</Rotulo>
              <dl className="mt-1.5 flex flex-col text-[12px]">
                {[
                  ['Valor máximo de uma proposta', reais(1000, 0)],
                  ['Gasto de IA por dia', reais(5)],
                  ['Mensagens por dia', '300'],
                ].map(([t, v]) => (
                  <div key={t} className="flex items-baseline justify-between gap-2 border-t border-borda-suave py-1.5 first:border-t-0">
                    <dt className="text-tinta-2">{t}</dt>
                    <dd className="numero font-semibold text-tinta">{v}</dd>
                  </div>
                ))}
              </dl>
            </Cartao>
            <Cartao>
              <Rotulo>O que faz sozinho</Rotulo>
              <ul className="mt-1.5 flex flex-col gap-1 text-[12px]">
                {consulta.map((c) => (
                  <li key={c.titulo} className={'flex items-center gap-2 ' + (c.disponivel ? 'text-tinta' : 'text-tinta-3')}>
                    <span aria-hidden className={c.disponivel ? 'text-bom' : 'text-tinta-3'}>✓</span>
                    {c.titulo}
                    {!c.disponivel && (
                      <span className="rounded-full bg-superficie-2 px-1.5 text-[9px] font-bold text-tinta-3 uppercase">
                        em breve
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Cartao>
          </div>
        )}
      </div>
    </div>
  )
}
