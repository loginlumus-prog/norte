'use client'

// Clientes: a busca, as fichas prontas e a ordem — com as palavras da tela de
// verdade (`app/[empresa]/clientes/page.tsx`): "Nome, telefone ou CPF",
// "sumidos há 60+ dias", "aniversário em …", "Ordenar por". No avançado
// aparecem as colunas de número e a ficha "com pontos".

import { useState } from 'react'
import { Avatar, Pilula, reais } from '../Pecas'
import { Cartao, Fichas, Topo } from './pecas'
import { CLIENTES, MES_ATUAL, HOJE } from './dados'
import type { Estado } from './estado'

type Filtro = 'todos' | 'sumidos' | 'aniversario' | 'pontos'
type Ordem = 'nome' | 'gasto' | 'recente'

const ultima = (d: number): { tom: 'bom' | 'neutro' | 'atencao'; texto: string } =>
  d === 0
    ? { tom: 'bom', texto: 'hoje' }
    : d >= 60
      ? { tom: 'atencao', texto: `há ${d} dias` }
      : { tom: 'neutro', texto: d === 1 ? 'ontem' : `há ${d} dias` }

export function TelaClientes({ estado }: { estado: Estado }) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [ordem, setOrdem] = useState<Ordem>('nome')
  const avancado = estado.modo === 'avancado'

  const b = busca.trim().toLowerCase()
  const digitos = b.replace(/\D/g, '')
  const lista = CLIENTES.filter((c) => {
    if (filtro === 'sumidos' && c.ultima < 60) return false
    if (filtro === 'aniversario' && c.aniversario !== HOJE.mes) return false
    if (filtro === 'pontos' && c.pontos === 0) return false
    if (!b) return true
    return c.nome.toLowerCase().includes(b) || (digitos.length > 0 && c.telefone.replace(/\D/g, '').includes(digitos))
  }).sort((x, y) =>
    ordem === 'gasto' ? y.gasto - x.gasto : ordem === 'recente' ? x.ultima - y.ultima : x.nome.localeCompare(y.nome, 'pt-BR'),
  )

  const opcoes: { valor: Filtro; texto: string }[] = [
    { valor: 'todos', texto: 'todos' },
    { valor: 'sumidos', texto: 'sumidos há 60+ dias' },
    { valor: 'aniversario', texto: `aniversário em ${MES_ATUAL}` },
  ]
  if (avancado) opcoes.push({ valor: 'pontos', texto: 'com pontos' })

  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Clientes" sub={`${CLIENTES.length} cadastrados na Loja Centro`} />

      <Cartao className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="block flex-1">
            <span className="sr-only">Buscar cliente</span>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome, telefone ou CPF"
              className="h-9 w-full rounded-lg border border-borda bg-superficie px-3 text-[12.5px] text-tinta placeholder:text-tinta-3"
            />
          </label>
          <label className="flex items-center gap-2 text-[11.5px] text-tinta-2">
            Ordenar por
            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as Ordem)}
              className="h-9 rounded-lg border border-borda bg-superficie px-2 text-[12px] font-semibold text-tinta"
            >
              <option value="nome">nome</option>
              <option value="gasto">quem mais gasta</option>
              <option value="recente">compra mais recente</option>
            </select>
          </label>
        </div>
        <div className="sem-barra relative -mx-1 overflow-x-auto px-1">
          <Fichas
            rotulo="Filtro"
            valor={filtro === 'pontos' && !avancado ? 'todos' : filtro}
            onEscolher={setFiltro}
            opcoes={opcoes}
            className="flex-nowrap"
          />
        </div>

        <div className="relative max-h-80 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-[1] bg-superficie">
              <tr className="text-left text-[9.5px] font-bold tracking-[0.08em] text-tinta-3 uppercase">
                <th className="py-1.5 font-bold">Cliente</th>
                {avancado && <th className="hidden py-1.5 text-right font-bold sm:table-cell">Compras</th>}
                {avancado && <th className="hidden py-1.5 text-right font-bold sm:table-cell">Gastou</th>}
                <th className="py-1.5 pl-2 font-bold">Última compra</th>
                {avancado && <th className="hidden py-1.5 text-right font-bold md:table-cell">Pontos</th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const u = ultima(c.ultima)
                return (
                  <tr key={c.nome} className="border-t border-borda-suave">
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-2">
                        <Avatar iniciais={c.iniciais} tom={c.ultima >= 60 ? 'atencao' : 'marca'} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold text-tinta">
                            {c.nome}
                            {c.aniversario === HOJE.mes && (
                              <span className="ml-1.5 rounded-full bg-marca-suave px-1.5 text-[9.5px] font-bold text-marca">
                                aniversário
                              </span>
                            )}
                          </span>
                          <span className="numero text-[10.5px] text-tinta-3">{c.telefone}</span>
                        </span>
                      </span>
                    </td>
                    {avancado && <td className="numero hidden py-1.5 text-right text-tinta-2 sm:table-cell">{c.compras}</td>}
                    {avancado && <td className="numero hidden py-1.5 text-right text-tinta sm:table-cell">{reais(c.gasto, 0)}</td>}
                    <td className="py-1.5 pl-2">
                      <Pilula tom={u.tom}>{u.texto}</Pilula>
                    </td>
                    {avancado && (
                      <td className="numero hidden py-1.5 text-right text-tinta-2 md:table-cell">{c.pontos} pontos</td>
                    )}
                  </tr>
                )
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-tinta-3">
                    Ninguém com essa busca.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-tinta-3" aria-live="polite">
          {lista.length} de {CLIENTES.length} clientes
        </p>
      </Cartao>
    </div>
  )
}
