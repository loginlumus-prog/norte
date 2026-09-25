'use client'

// Análise: as leituras que o painel não dá (`app/[empresa]/analise/page.tsx`)
// — as lojas lado a lado, a curva ABC com a classe de cada produto, e o
// dinheiro parado a preço de custo. Só aparece no menu do modo avançado,
// como lá.

import { useState } from 'react'
import { Barra, Pilula, Rotulo, reais } from '../Pecas'
import { Cartao, Fichas, Topo } from './pecas'
import { LOJAS, PRODUTOS } from './dados'
import type { Estado } from './estado'

type Classe = 'A' | 'B' | 'C'

// A curva: o que cada produto vendeu em 30 dias, do maior para o menor, e a
// fatia acumulada decide a classe — até 80% é A, até 95% é B, o resto é C.
const CURVA = (() => {
  const linhas = PRODUTOS.map((p) => ({ p, vendido: Math.round(p.preco * p.ritmo * 30) }))
    .filter((l) => l.vendido > 0)
    .sort((a, b) => b.vendido - a.vendido)
  const soma = linhas.reduce((s, l) => s + l.vendido, 0)
  let acc = 0
  return linhas.map((l) => {
    acc += l.vendido
    const pct = acc / soma
    const classe: Classe = pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C'
    return { ...l, acumulado: Math.round(pct * 100), classe }
  })
})()

const TOM: Record<Classe, 'bom' | 'atencao' | 'neutro'> = { A: 'bom', B: 'atencao', C: 'neutro' }

export function TelaAnalise({ estado }: { estado: Estado }) {
  const [classe, setClasse] = useState<Classe | 'todas'>('todas')
  const maior = Math.max(...LOJAS.map((l) => l.vendas))
  const conta = (c: Classe) => CURVA.filter((l) => l.classe === c).length
  const parado = PRODUTOS.filter((p) => p.ritmo < 0.15 && (estado.estoque[p.id] ?? 0) > 0)
  const valorParado = parado.reduce((s, p) => s + (estado.estoque[p.id] ?? 0) * p.custo, 0)
  const lista = CURVA.filter((l) => classe === 'todas' || l.classe === classe)

  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Análise" sub="Últimos 30 dias" />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Cartao>
          <Rotulo>As lojas lado a lado</Rotulo>
          <div className="relative mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[9.5px] tracking-[0.08em] text-tinta-3 uppercase">
                  <th className="pb-1.5 font-bold">Loja</th>
                  <th className="pb-1.5 text-right font-bold">Vendas</th>
                  <th className="pb-1.5 text-right font-bold">Margem</th>
                  <th className="hidden pb-1.5 text-right font-bold sm:table-cell">Ticket</th>
                  <th className="pb-1.5 text-right font-bold">Parado</th>
                </tr>
              </thead>
              <tbody>
                {LOJAS.map((l) => (
                  <tr key={l.nome} className="border-t border-borda-suave">
                    <td className="py-2 pr-2">
                      <span className="font-semibold text-tinta">{l.nome}</span>
                      <Barra valor={(l.vendas / maior) * 100} className="mt-1 w-full max-w-24" />
                    </td>
                    <td className="numero py-2 text-right text-tinta">{reais(l.vendas, 0)}</td>
                    <td className="numero py-2 text-right text-tinta-2">
                      {l.margem.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}%
                    </td>
                    <td className="numero hidden py-2 text-right text-tinta-2 sm:table-cell">{reais(l.ticket, 0)}</td>
                    <td className="numero py-2 text-right text-atencao">{reais(l.parado, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-lg bg-superficie-2 p-3">
            <Rotulo>Dinheiro parado na Loja Centro</Rotulo>
            <p className="numero mt-1 font-display text-xl font-bold text-atencao">{reais(valorParado, 0)}</p>
            <p className="text-[11px] text-tinta-3">
              a preço de custo · {parado.map((p) => p.nome).join(', ')}
            </p>
          </div>
        </Cartao>

        <Cartao>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Rotulo>Curva ABC</Rotulo>
            <Fichas
              rotulo="Classe"
              valor={classe}
              onEscolher={setClasse}
              opcoes={[
                { valor: 'todas', texto: 'todas' },
                { valor: 'A', texto: `A · ${conta('A')}` },
                { valor: 'B', texto: `B · ${conta('B')}` },
                { valor: 'C', texto: `C · ${conta('C')}` },
              ]}
            />
          </div>
          <div aria-hidden className="mt-2.5 flex h-2 overflow-hidden rounded-full">
            <span className="bg-bom-vivo" style={{ width: '80%' }} />
            <span className="bg-atencao-vivo" style={{ width: '15%' }} />
            <span className="bg-superficie-3" style={{ width: '5%' }} />
          </div>
          <p className="mt-1.5 text-[11px] text-tinta-3">
            <b className="text-tinta-2">{conta('A')} produtos</b> fazem 80% do que entra.
          </p>
          <div className="relative mt-2 max-h-60 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-superficie">
                <tr className="text-left text-[9.5px] tracking-[0.08em] text-tinta-3 uppercase">
                  <th className="py-1.5 font-bold">Produto</th>
                  <th className="py-1.5 text-right font-bold">Vendeu</th>
                  <th className="hidden py-1.5 text-right font-bold sm:table-cell">Acum.</th>
                  <th className="py-1.5 pl-2 font-bold">Classe</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.p.id} className="border-t border-borda-suave">
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold text-tinta">{l.p.nome}</span>{' '}
                      <span className="text-[10.5px] text-tinta-3">{l.p.grade.split(' · ')[1]}</span>
                    </td>
                    <td className="numero py-1.5 text-right text-tinta">{reais(l.vendido, 0)}</td>
                    <td className="numero hidden py-1.5 text-right text-tinta-3 sm:table-cell">{l.acumulado}%</td>
                    <td className="py-1.5 pl-2">
                      <Pilula tom={TOM[l.classe]}>{l.classe}</Pilula>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      </div>
    </div>
  )
}
