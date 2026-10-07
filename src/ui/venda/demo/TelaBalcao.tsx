'use client'

// O Balcão: tocar no cartão põe no pedido, escolher como paga, ver o troco,
// concluir. Os rótulos são os da tela de verdade (`app/[empresa]/balcao/`):
// "Buscar ou bipar o código", "Como vai pagar?", "Recebido", "Troco",
// "Concluir venda", "Venda concluída", "Troco para devolver", "Nova venda".
//
// O cartão não tem foto — na tela de verdade também não: é o bloco de cor da
// categoria com as duas letras grandes. A venda concluída aqui tira do
// estoque e soma no painel deste mesmo exemplo.

import { useMemo, useState } from 'react'
import { Rotulo, reais } from '../Pecas'
import { botaoMarca, Fichas } from './pecas'
import { PRODUTOS, produto, type Produto } from './dados'
import type { Acao, Estado } from './estado'

type Forma = 'Dinheiro' | 'Pix' | 'Débito' | 'Crédito'
const FORMAS: Forma[] = ['Dinheiro', 'Pix', 'Débito', 'Crédito']

type Categoria = 'Todos' | Produto['categoria']
const CATEGORIAS: { valor: Categoria; texto: string }[] = [
  { valor: 'Todos', texto: 'Todos' },
  { valor: 'Roupas', texto: 'Roupas' },
  { valor: 'Calçados', texto: 'Calçados' },
  { valor: 'Acessórios', texto: 'Acessórios' },
]

const COR: Record<Produto['categoria'], string> = {
  Roupas: 'bg-marca-suave text-marca',
  Calçados: 'bg-atencao-fundo text-atencao',
  Acessórios: 'bg-bom-fundo text-bom',
}

/** As notas que provavelmente vêm na mão, acima do total. */
function notas(total: number): number[] {
  const r: number[] = []
  for (const n of [10, 20, 50, 100, 200]) {
    const v = Math.ceil(total / n) * n
    if (v > total && !r.includes(v)) r.push(v)
    if (r.length === 3) break
  }
  return r
}

/** "Preto · G" → cor e tamanho. Sem o separador, o texto inteiro vira a "cor". */
const partes = (grade: string) => {
  const [a = grade, b = ''] = grade.split(' · ')
  return { cor: a, tam: b }
}

function eixos(g: Produto[]) {
  const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))]
  return {
    cores: unicos(g.map((p) => partes(p.grade).cor)),
    tamanhos: unicos(g.map((p) => partes(p.grade).tam)),
  }
}

/** A escolha de cor e tamanho de um produto, no lugar da grade de cartões. */
function Escolha({
  g,
  estoque,
  pedido,
  cor,
  tam,
  setCor,
  setTam,
  bloqueado,
  aoVoltar,
  aoAdicionar,
}: {
  g: Produto[]
  estoque: Record<string, number>
  pedido: Record<string, number>
  cor: string | null
  tam: string | null
  setCor: (v: string | null) => void
  setTam: (v: string | null) => void
  bloqueado: boolean
  aoVoltar: () => void
  aoAdicionar: (p: Produto) => void
}) {
  const topo = g[0]!
  const { cores, tamanhos } = eixos(g)
  const saldoDe = (p: Produto) => (estoque[p.id] ?? 0) - (pedido[p.id] ?? 0)
  const casa = (p: Produto, c: string | null, t: string | null) =>
    (!c || partes(p.grade).cor === c) && (!t || partes(p.grade).tam === t)
  const achada = cor && tam ? (g.find((p) => casa(p, cor, tam)) ?? null) : null
  const faltam = [!cor && cores.length > 1 ? 'a cor' : '', !tam && tamanhos.length > 1 ? 'o tamanho' : ''].filter(Boolean)

  const grupos = [
    { nome: 'Cor', opcoes: cores, valor: cor, marcar: setCor, par: (o: string) => [o, tam] as const },
    { nome: 'Tamanho', opcoes: tamanhos, valor: tam, marcar: setTam, par: (o: string) => [cor, o] as const },
  ].filter((e) => e.opcoes.length > 0)

  return (
    <div className="pousa flex flex-col gap-3 rounded-xl border border-borda bg-superficie p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={'grid size-10 shrink-0 place-items-center rounded-lg font-display text-base font-bold ' + COR[topo.categoria]}>
            {topo.sigla}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-tinta">{topo.nome}</span>
            <span className="block text-[12.5px] text-tinta-3">Escolha cor e tamanho</span>
          </span>
        </div>
        <button
          type="button"
          onClick={aoVoltar}
          className="shrink-0 rounded-md border border-borda px-2 py-1 text-[13px] font-semibold text-tinta-2 hover:text-tinta"
        >
          Voltar
        </button>
      </div>

      {grupos.map((e) => (
        <div key={e.nome} role="group" aria-label={e.nome} className="flex flex-col gap-1.5">
          <p className="text-[12px] font-bold tracking-[0.1em] text-tinta-3 uppercase">{e.nome}</p>
          <div className="flex flex-wrap gap-1.5">
            {e.opcoes.map((o) => {
              const [c, t] = e.par(o)
              const existe = g.some((p) => casa(p, c, t))
              const acabou = existe && !g.some((p) => casa(p, c, t) && saldoDe(p) > 0)
              const marcada = e.valor === o
              return (
                <button
                  key={o}
                  type="button"
                  disabled={!existe || acabou}
                  aria-pressed={marcada}
                  onClick={() => e.marcar(marcada ? null : o)}
                  className={
                    'numero min-h-9 min-w-11 rounded-lg border-2 px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-45 ' +
                    (marcada
                      ? 'border-marca bg-marca-suave text-marca'
                      : 'border-borda bg-superficie text-tinta hover:border-tinta-3')
                  }
                >
                  {o}
                  {acabou && <span className="ml-1 text-[11px] font-bold text-critico">acabou</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        disabled={!achada || saldoDe(achada) <= 0 || bloqueado}
        onClick={() => achada && aoAdicionar(achada)}
        className={botaoMarca + ' w-full py-2.5 text-[13px]'}
      >
        {achada ? `Adicionar ${achada.grade} · ${reais(achada.preco)}` : `Escolha ${faltam.join(' e ')}`}
      </button>
    </div>
  )
}

export function TelaBalcao({ estado, fazer }: { estado: Estado; fazer: (a: Acao) => void }) {
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<Categoria>('Todos')
  const [pedido, setPedido] = useState<Record<string, number>>({})
  const [forma, setForma] = useState<Forma | null>(null)
  const [recebido, setRecebido] = useState<number | null>(null)
  const [feita, setFeita] = useState<null | { numero: number; total: number; forma: Forma; troco: number }>(null)
  const simples = estado.modo === 'simples'

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase()
    return PRODUTOS.filter(
      (p) =>
        (categoria === 'Todos' || p.categoria === categoria) &&
        (!b || `${p.nome} ${p.grade} ${p.sigla}`.toLowerCase().includes(b)),
    )
  }, [busca, categoria])

  // Um cartão por PRODUTO: as peças do mesmo nome (cor e tamanho) se escolhem
  // dentro dele, como na tela de verdade — nunca uma peça por cartão.
  const grupos = useMemo(() => {
    const m = new Map<string, Produto[]>()
    for (const p of lista) m.set(p.nome, [...(m.get(p.nome) ?? []), p])
    return [...m.values()]
  }, [lista])
  const [aberto, setAberto] = useState<string | null>(null)
  const [cor, setCor] = useState<string | null>(null)
  const [tam, setTam] = useState<string | null>(null)

  function abrir(g: Produto[]) {
    const { cores, tamanhos } = eixos(g)
    setAberto(g[0]!.nome)
    setCor(cores.length === 1 ? cores[0]! : null)
    setTam(tamanhos.length === 1 ? tamanhos[0]! : null)
  }

  const itens = Object.entries(pedido).filter(([, q]) => q > 0)
  const total = Math.round(itens.reduce((s, [id, q]) => s + produto(id).preco * q, 0) * 100) / 100
  const pecas = itens.reduce((s, [, q]) => s + q, 0)
  const troco = forma === 'Dinheiro' && recebido !== null ? Math.max(0, recebido - total) : 0

  const motivo = !itens.length
    ? 'Toque num produto ou bipe a etiqueta.'
    : !forma
      ? 'Escolha como o cliente vai pagar.'
      : forma === 'Dinheiro' && (recebido === null || recebido < total)
        ? 'Diga quanto o cliente entregou.'
        : null

  function por(p: Produto, d: number) {
    const saldo = estado.estoque[p.id] ?? 0
    setPedido((x) => {
      const q = Math.min(saldo, Math.max(0, (x[p.id] ?? 0) + d))
      return { ...x, [p.id]: q }
    })
    setRecebido(null)
  }

  function concluir() {
    if (motivo || !forma) return
    fazer({ tipo: 'vender', itens: itens.map(([id, q]) => ({ id, q })) })
    setFeita({ numero: estado.proximaVenda, total, forma, troco })
  }

  function nova() {
    setPedido({})
    setForma(null)
    setRecebido(null)
    setFeita(null)
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      {/* ── os produtos ── */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <label className="relative block">
          <span className="sr-only">Buscar produto</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar ou bipar o código"
            className="h-10 w-full rounded-lg border-2 border-marca bg-superficie px-3 text-[13px] text-tinta placeholder:text-tinta-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-marca/30"
          />
        </label>
        <div className="sem-barra relative -mx-1 overflow-x-auto px-1">
          <Fichas rotulo="Categoria" opcoes={CATEGORIAS} valor={categoria} onEscolher={setCategoria} className="flex-nowrap" />
        </div>
        <div className="relative max-h-[25rem] overflow-y-auto pr-1">
          {lista.length === 0 ? (
            <p className="py-10 text-center text-[12.5px] text-tinta-3">Nenhum produto com “{busca}”.</p>
          ) : aberto && grupos.some((g) => g[0]!.nome === aberto) ? (
            <Escolha
              g={grupos.find((x) => x[0]!.nome === aberto)!}
              estoque={estado.estoque}
              pedido={pedido}
              cor={cor}
              tam={tam}
              setCor={setCor}
              setTam={setTam}
              bloqueado={!!feita}
              aoVoltar={() => setAberto(null)}
              aoAdicionar={(p) => {
                por(p, 1)
                setAberto(null)
              }}
            />
          ) : (
            <ul
              className={
                'grid gap-2 ' +
                (simples ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4')
              }
            >
              {grupos.map((g) => {
                const p = g[0]!
                const varias = g.length > 1
                const saldo = g.reduce((s, x) => s + (estado.estoque[x.id] ?? 0), 0)
                const no = g.reduce((s, x) => s + (pedido[x.id] ?? 0), 0)
                const acabou = saldo <= 0
                const esgotou = !varias && no >= saldo
                const menor = Math.min(...g.map((x) => x.preco))
                const aPartirDe = g.some((x) => x.preco !== menor)
                const pouco = !varias && saldo <= p.minimo
                return (
                  <li key={p.nome}>
                    <button
                      type="button"
                      disabled={acabou || esgotou || !!feita}
                      onClick={() => (varias ? abrir(g) : por(p, 1))}
                      aria-label={`${p.nome}${varias ? `, ${g.length} opções` : ` ${p.grade}`}, ${aPartirDe ? 'a partir de ' : ''}${reais(menor)}${acabou ? ', acabou' : pouco ? `, só ${saldo}` : ''}${no ? `, ${no} no pedido` : ''}`}
                      className={
                        'relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-superficie text-left transition-[transform,box-shadow,border-color] ' +
                        (acabou
                          ? 'cursor-not-allowed border-borda opacity-50 grayscale'
                          : no
                            ? 'border-marca shadow-norte'
                            : 'border-borda hover:-translate-y-0.5 hover:border-tinta-3 hover:shadow-norte active:translate-y-0')
                      }
                    >
                      <span
                        className={
                          'grid place-items-center font-display font-bold ' +
                          COR[p.categoria] +
                          (simples ? ' h-14 text-xl' : ' h-10 text-base')
                        }
                      >
                        {p.sigla}
                      </span>
                      <span className="flex flex-1 flex-col gap-0.5 p-2">
                        <span className="text-[12px] leading-tight font-semibold text-tinta">{p.nome}</span>
                        <span className="text-[12px] text-tinta-3">{varias ? `${g.length} opções` : p.grade}</span>
                        <span className="mt-auto flex items-baseline justify-between gap-1 pt-1">
                          <span className="numero text-[12.5px] font-bold text-titulo">
                            {aPartirDe && <span className="mr-1 text-[11.5px] font-medium text-tinta-3">a partir de</span>}
                            {reais(menor)}
                          </span>
                          {acabou ? (
                            <span className="rounded-full bg-critico-fundo px-1.5 text-[11px] font-bold text-critico">acabou</span>
                          ) : pouco ? (
                            <span className="text-[11.5px] font-semibold text-atencao">só {saldo}</span>
                          ) : !simples && !varias ? (
                            <span className="numero text-[11.5px] text-tinta-3">tem {saldo}</span>
                          ) : null}
                        </span>
                      </span>
                      {no > 0 && (
                        <span key={no} className="pousa numero absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-marca text-[12px] font-bold text-marca-tinta shadow-norte">
                          {no}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── o pedido e o pagamento ── */}
      <div className="relative flex flex-col gap-3 rounded-xl bg-superficie p-3.5 shadow-norte">
        <p className="sr-only" aria-live="polite">
          {feita
            ? `Venda concluída, ${reais(feita.total)}${feita.forma === 'Dinheiro' ? `, troco ${reais(feita.troco)}` : ''}.`
            : itens.length
              ? `${pecas} ${pecas === 1 ? 'peça' : 'peças'} no pedido, total ${reais(total)}.`
              : ''}
        </p>
        {feita ? (
          <div className="pousa flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-bom-vivo text-xl font-bold text-white">✓</span>
            <p className="font-display text-lg font-bold text-titulo">Venda concluída</p>
            <p className="numero text-[12px] text-tinta-3">
              Nº {feita.numero.toLocaleString('pt-BR')} · {feita.forma}
            </p>
            <p className="numero font-display text-3xl font-bold text-titulo">{reais(feita.total)}</p>
            {feita.forma === 'Dinheiro' && (
              <div className="mt-1 w-full rounded-lg bg-bom-fundo px-3 py-2.5">
                <p className="text-[11.5px] font-bold tracking-[0.12em] text-bom uppercase">Troco para devolver</p>
                <p className="numero font-display text-2xl font-bold text-bom">{reais(feita.troco)}</p>
              </div>
            )}
            <p className="text-[12.5px] text-tinta-3">Saiu do estoque e já está no painel deste exemplo.</p>
            <button type="button" onClick={nova} className={botaoMarca + ' mt-1 w-full py-2.5'}>
              Nova venda
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <Rotulo>Pedido</Rotulo>
              {pecas > 0 && <span className="text-[12.5px] text-tinta-3">{pecas} {pecas === 1 ? 'peça' : 'peças'}</span>}
            </div>
            {itens.length === 0 ? (
              <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-borda px-3 py-5 text-center">
                <p className="text-[12.5px] font-semibold text-tinta-2">Pedido vazio</p>
                <p className="text-[13px] text-tinta-3">Toque num produto ou bipe a etiqueta.</p>
              </div>
            ) : (
              <ul className="flex max-h-40 flex-col overflow-y-auto">
                {itens.map(([id, q]) => {
                  const p = produto(id)
                  return (
                    <li key={id} className="pousa flex items-center gap-2 border-t border-borda-suave py-1.5 first:border-t-0">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[12px] font-semibold text-tinta">{p.nome}</span>
                        <span className="numero text-[12px] text-tinta-3">
                          {p.grade} · {q} × {reais(p.preco)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => por(p, -1)}
                          aria-label={`Tirar um ${p.nome} ${p.grade}`}
                          className="grid size-6 place-items-center rounded-md border border-borda text-tinta-2 hover:text-tinta"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          onClick={() => por(p, 1)}
                          disabled={q >= (estado.estoque[id] ?? 0)}
                          aria-label={`Mais um ${p.nome} ${p.grade}`}
                          className="grid size-6 place-items-center rounded-md border border-borda text-tinta-2 hover:text-tinta disabled:opacity-40"
                        >
                          +
                        </button>
                      </span>
                      <span className="numero w-[4.5rem] text-right text-[12px] font-semibold text-tinta">{reais(p.preco * q)}</span>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex items-baseline justify-between border-t border-borda-suave pt-2">
              <span className="text-[12px] font-semibold text-tinta-2">Total</span>
              <span className="numero font-display text-2xl font-bold text-titulo">{reais(total)}</span>
            </div>

            <div role="group" aria-label="Como vai pagar?">
              <p className="mb-1.5 text-[13px] font-semibold text-tinta-2">Como vai pagar?</p>
              <div className="grid grid-cols-2 gap-1.5">
                {FORMAS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={forma === f}
                    disabled={!itens.length}
                    onClick={() => {
                      setForma(f)
                      setRecebido(null)
                    }}
                    className={
                      'rounded-lg border px-2 text-[12.5px] font-semibold transition-colors disabled:opacity-45 ' +
                      (simples ? 'py-2.5' : 'py-1.5') +
                      (forma === f
                        ? ' border-marca bg-marca-suave text-marca'
                        : ' border-borda bg-superficie text-tinta-2 hover:border-tinta-3')
                    }
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {forma === 'Dinheiro' && (
              <div className="pousa flex flex-col gap-2">
                <div role="group" aria-label="Recebido" className="flex flex-wrap gap-1.5">
                  {[total, ...notas(total)].map((v, i) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={recebido === v}
                      onClick={() => setRecebido(v)}
                      className={
                        'numero rounded-md border px-2 py-1 text-[13px] font-semibold ' +
                        (recebido === v
                          ? 'border-marca bg-marca-suave text-marca'
                          : 'border-borda text-tinta-2 hover:border-tinta-3')
                      }
                    >
                      {i === 0 ? 'Exato' : reais(v, 0)}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-superficie-2 px-3 py-2">
                    <p className="text-[12px] text-tinta-3">Recebido</p>
                    <p className="numero font-display text-lg font-bold text-tinta">
                      {recebido === null ? '—' : reais(recebido)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-bom-fundo px-3 py-2">
                    <p className="text-[12px] font-semibold text-bom">Troco</p>
                    <p className="numero font-display text-lg font-bold text-bom">{reais(troco)}</p>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={concluir}
              disabled={!!motivo}
              className={botaoMarca + ' mt-auto w-full py-2.5 text-[13.5px]'}
            >
              Concluir venda
            </button>
            {motivo && <p className="-mt-1.5 text-center text-[12.5px] text-tinta-3">{motivo}</p>}
          </>
        )}
      </div>
    </div>
  )
}
