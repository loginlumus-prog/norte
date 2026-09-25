'use client'

// O Estoque: as duas seções que mais se usam da tela de verdade
// (`app/[empresa]/estoque/page.tsx`) — "Vai faltar", com o ritmo contra o
// prazo de reposição, e "Tudo que tem", com as fichas de filtro e a busca. Os
// nomes das colunas, das fichas e das situações são os de lá.
//
// "Dar entrada" aqui soma um lote na hora — lá é um formulário com
// quantidade e custo. O resultado no saldo é o mesmo, e a situação da linha
// muda na frente de quem clicou.

import { useState } from 'react'
import { Pilula, Rotulo, reais } from '../Pecas'
import { botaoLinha, Cartao, Fichas, Topo } from './pecas'
import { PRODUTOS, dura, folga, noMinimo, pedirAte, situacao } from './dados'
import type { Acao, Estado } from './estado'

type Secao = 'faltar' | 'tudo'
type Filtro = 'tudo' | 'acabaram' | 'minimo' | 'com'

const ritmo = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function TelaEstoque({ estado, fazer }: { estado: Estado; fazer: (a: Acao) => void }) {
  const [secao, setSecao] = useState<Secao>('faltar')
  const [filtro, setFiltro] = useState<Filtro>('tudo')
  const [busca, setBusca] = useState('')
  const [chegou, setChegou] = useState<string | null>(null)
  const avancado = estado.modo === 'avancado'
  const saldo = (id: string) => estado.estoque[id] ?? 0

  const acabaram = PRODUTOS.filter((p) => saldo(p.id) <= 0).length
  const minimo = PRODUTOS.filter((p) => noMinimo(p, saldo(p.id))).length
  const com = PRODUTOS.filter((p) => saldo(p.id) > 0).length

  function entrada(id: string) {
    fazer({ tipo: 'entrada', id, q: 20 })
    setChegou(id)
  }

  const faltar = PRODUTOS.filter((p) => p.ritmo >= 0.1)
    .map((p) => ({ p, e: saldo(p.id) }))
    .filter(({ p, e }) => e <= 0 || folga(p, e) <= 14)
    .sort((a, b) => folga(a.p, a.e) - folga(b.p, b.e))

  const b = busca.trim().toLowerCase()
  const tudo = PRODUTOS.filter((p) => {
    const e = saldo(p.id)
    if (filtro === 'acabaram' && e > 0) return false
    if (filtro === 'minimo' && !noMinimo(p, e)) return false
    if (filtro === 'com' && e <= 0) return false
    return !b || `${p.nome} ${p.grade}`.toLowerCase().includes(b)
  })
  const parado = PRODUTOS.reduce((s, p) => s + saldo(p.id) * p.custo, 0)

  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Estoque" sub="Loja Centro">
        <Fichas
          rotulo="Seção"
          valor={secao}
          onEscolher={setSecao}
          opcoes={[
            { valor: 'faltar', texto: 'Vai faltar' },
            { valor: 'tudo', texto: 'Tudo que tem' },
          ]}
        />
      </Topo>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            [acabaram, 'acabaram', 'text-critico'],
            [minimo, 'no mínimo', 'text-atencao'],
            [com, 'com estoque', 'text-bom'],
          ] as const
        ).map(([n, t, cor]) => (
          <Cartao key={t} className="!p-2.5">
            <p key={n} className={'pousa numero font-display text-xl font-bold ' + cor}>{n}</p>
            <p className="text-[11px] text-tinta-3">{t}</p>
          </Cartao>
        ))}
      </div>

      {secao === 'faltar' ? (
        <Cartao className="tela-entra">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Rotulo>Vai faltar</Rotulo>
            <span className="text-[11px] text-tinta-3">ritmo dos últimos 30 dias contra o prazo de reposição</span>
          </div>
          <div className="relative mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[9.5px] font-bold tracking-[0.08em] text-tinta-3 uppercase">
                  <th className="pb-1.5 font-bold">Item</th>
                  <th className="pb-1.5 text-right font-bold">Saldo</th>
                  {avancado && <th className="hidden pb-1.5 text-right font-bold sm:table-cell">Ritmo/dia</th>}
                  {avancado && <th className="hidden pb-1.5 text-right font-bold md:table-cell">Dura (dias)</th>}
                  {avancado && <th className="hidden pb-1.5 text-right font-bold md:table-cell">Reposição (dias)</th>}
                  <th className="pb-1.5 text-right font-bold">Pedir até</th>
                  <th className="pb-1.5 pl-2 font-bold">Situação</th>
                  <th className="pb-1.5"><span className="sr-only">Ação</span></th>
                </tr>
              </thead>
              <tbody>
                {faltar.map(({ p, e }) => {
                  const s = situacao(p, e)
                  return (
                    <tr key={p.id} className={'border-t border-borda-suave ' + (chegou === p.id ? 'tique' : '')}>
                      <td className="py-2 pr-2">
                        <span className="block font-semibold text-tinta">{p.nome}</span>
                        <span className="text-[10.5px] text-tinta-3">{p.grade}</span>
                      </td>
                      <td className="numero py-2 text-right text-tinta">{e}</td>
                      {avancado && <td className="numero hidden py-2 text-right text-tinta-2 sm:table-cell">{ritmo(p.ritmo)}</td>}
                      {avancado && <td className="numero hidden py-2 text-right text-tinta-2 md:table-cell">{e <= 0 ? '—' : dura(p, e)}</td>}
                      {avancado && <td className="numero hidden py-2 text-right text-tinta-2 md:table-cell">{p.prazo}</td>}
                      <td className="numero py-2 text-right font-semibold text-tinta">{pedirAte(p, e)}</td>
                      <td className="py-2 pl-2">
                        <Pilula tom={s.tom}>{s.texto}</Pilula>
                      </td>
                      <td className="py-2 pl-2 text-right">
                        {s.tom === 'critico' && (
                          <button
                            type="button"
                            onClick={() => entrada(p.id)}
                            className={botaoLinha + ' !px-2 !py-1 !text-[11px] whitespace-nowrap'}
                          >
                            + Dar entrada<span className="sr-only"> de 20 em {p.nome} {p.grade}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {chegou && (
            <p className="pousa mt-2 text-[11px] text-bom">
              Entrada de 20 un. registrada — o saldo e a situação já mudaram, e o movimento foi para o histórico.
            </p>
          )}
        </Cartao>
      ) : (
        <Cartao className="tela-entra">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Fichas
              rotulo="Filtro"
              valor={filtro}
              onEscolher={setFiltro}
              opcoes={[
                { valor: 'tudo', texto: 'tudo' },
                { valor: 'acabaram', texto: 'acabaram' },
                { valor: 'minimo', texto: 'no mínimo' },
                { valor: 'com', texto: 'com estoque' },
              ]}
            />
            <label className="block w-full sm:w-44">
              <span className="sr-only">Buscar no estoque</span>
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome ou etiqueta"
                className="h-8 w-full rounded-lg border border-borda bg-superficie px-2.5 text-[12px] text-tinta placeholder:text-tinta-3"
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-tinta-3">
            <b className="numero text-tinta-2">{reais(parado, 0)}</b> parados na prateleira, a preço de custo
          </p>
          <div className="relative mt-1 max-h-72 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-superficie">
                <tr className="text-left text-[9.5px] font-bold tracking-[0.08em] text-tinta-3 uppercase">
                  <th className="py-1.5 font-bold">Item</th>
                  <th className="py-1.5 text-right font-bold">Tem</th>
                  <th className="py-1.5 text-right font-bold">Mínimo</th>
                  {avancado && <th className="hidden py-1.5 text-right font-bold sm:table-cell">Custo</th>}
                  {avancado && <th className="hidden py-1.5 text-right font-bold sm:table-cell">Preço</th>}
                </tr>
              </thead>
              <tbody>
                {tudo.map((p) => {
                  const e = saldo(p.id)
                  return (
                    <tr key={p.id} className="border-t border-borda-suave">
                      <td className="py-1.5 pr-2">
                        <span className="font-semibold text-tinta">{p.nome}</span>{' '}
                        <span className="text-[10.5px] text-tinta-3">{p.grade}</span>
                      </td>
                      <td className={'numero py-1.5 text-right font-semibold ' + (e <= 0 ? 'text-critico' : noMinimo(p, e) ? 'text-atencao' : 'text-tinta')}>
                        {e}
                      </td>
                      <td className="numero py-1.5 text-right text-tinta-3">{p.minimo}</td>
                      {avancado && <td className="numero hidden py-1.5 text-right text-tinta-2 sm:table-cell">{reais(p.custo)}</td>}
                      {avancado && <td className="numero hidden py-1.5 text-right text-tinta-2 sm:table-cell">{reais(p.preco)}</td>}
                    </tr>
                  )
                })}
                {tudo.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-tinta-3">
                      Nada com esse filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}
    </div>
  )
}
