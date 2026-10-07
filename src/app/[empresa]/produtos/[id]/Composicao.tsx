'use client'

// "O que cada item gasta do estoque": a Casquinha + Água leva 1 Casquinha e
// 1 Água. Com isso, o item não precisa de estoque próprio — vender baixa o
// que ele leva, e o saldo que importa é o do freezer.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, cx } from '@/ui/base'
import { classeDaAcao, IconeDaAcao } from '@/ui/premium'
import { composicaoAcao, procurarComponentesAcao } from './acoes'
import type { ComponenteNaTela } from '@/servidor/composicao'

const UN: Record<string, string> = { UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'mL', M: 'm', PAR: 'par', CX: 'cx' }
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

function DoItem({
  slug,
  item,
  inicial,
  podeEditar,
}: {
  slug: string
  item: { id: string; rotulo: string; saldo: number | null }
  inicial: ComponenteNaTela[]
  podeEditar: boolean
}) {
  const [lista, setLista] = useState(inicial)
  const [mexendo, setMexendo] = useState(false)
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<{ id: string; descricao: string; medida: string }[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const mudou = JSON.stringify(lista) !== JSON.stringify(inicial)

  const buscar = (t: string) => {
    setTermo(t)
    if (t.trim().length < 2) return setAchados([])
    comecar(async () => setAchados(await procurarComponentesAcao(slug, t).catch(() => [])))
  }
  const salvar = () =>
    comecar(async () => {
      setErro(null)
      const r = await composicaoAcao(slug, item.id, lista.map((c) => ({ componenteId: c.componenteId, quantidade: c.quantidade })))
      if (r.erro) return setErro(r.erro)
      setMexendo(false)
      router.refresh()
    })

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-tinta">{item.rotulo}</span>
        {podeEditar && !mexendo && (
          <button type="button" onClick={() => setMexendo(true)} className={classeDaAcao({ jeito: 'pilula' })}>
            <IconeDaAcao icone={lista.length ? 'editar' : 'mais'} tamanho={15} />
            {lista.length ? 'Mudar' : 'Dizer o que ele leva'}
          </button>
        )}
      </div>
      {lista.length === 0 && !mexendo ? (
        <p className="text-sm text-tinta-3">
          Tem estoque próprio{item.saldo != null ? ` (${qtd(item.saldo)} nas lojas)` : ''}.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {lista.map((c) => (
            <li key={c.componenteId} className="flex items-center gap-1.5 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm">
              {mexendo ? (
                <input
                  value={String(c.quantidade).replace('.', ',')}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(',', '.'))
                    setLista((l) => l.map((x) => (x.componenteId === c.componenteId ? { ...x, quantidade: Number.isFinite(n) ? n : 0 } : x)))
                  }}
                  inputMode="decimal"
                  aria-label={`Quanto de ${c.descricao}`}
                  className="h-7 w-14 rounded border border-borda bg-superficie px-1 text-right text-sm"
                />
              ) : (
                <b className="numero">{qtd(c.quantidade)}</b>
              )}
              <span className="text-tinta-3">{UN[c.medida] ?? ''}</span>
              <span className="text-tinta">{c.descricao}</span>
              {mexendo && (
                <button
                  type="button"
                  aria-label={`Tirar ${c.descricao}`}
                  onClick={() => setLista((l) => l.filter((x) => x.componenteId !== c.componenteId))}
                  className="ml-1 text-tinta-3 hover:text-critico"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {mexendo && (
        <div className="flex flex-col gap-2 rounded-norte bg-superficie-2 p-3">
          <input
            value={termo}
            onChange={(e) => buscar(e.target.value)}
            placeholder="Procurar o que ele leva: casquinha, água, copo…"
            aria-label="Procurar componente"
            className="h-9 w-full max-w-sm rounded-norte border border-borda bg-superficie px-2.5 text-sm text-tinta placeholder:text-tinta-3"
          />
          {achados.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {achados
                .filter((a) => a.id !== item.id && !lista.some((c) => c.componenteId === a.id))
                .map((a) => (
                  <li key={a.id}>
                    <Botao
                      type="button"
                      tom="secundario"
                      className="h-8 py-0 text-xs"
                      onClick={() => {
                        setLista((l) => [...l, { componenteId: a.id, descricao: a.descricao, medida: a.medida, quantidade: 1 }])
                        setTermo('')
                        setAchados([])
                      }}
                    >
                      + {a.descricao}
                    </Botao>
                  </li>
                ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Botao type="button" tom="principal" carregando={indo} disabled={!mudou} onClick={salvar} className="h-9 py-0">
              Salvar
            </Botao>
            <Botao
              type="button"
              tom="discreto"
              onClick={() => {
                setLista(inicial)
                setMexendo(false)
                setErro(null)
              }}
              className="h-9 py-0"
            >
              Cancelar
            </Botao>
            <span className="text-xs text-tinta-3">
              {lista.length ? 'Vender este item baixa o que ele leva. Ele deixa de ter estoque próprio.' : 'Sem nada, ele volta a ter estoque próprio.'}
            </span>
          </div>
          {erro && <p className="text-xs text-critico">{erro}</p>}
        </div>
      )}
    </li>
  )
}

export function Composicao({
  slug,
  itens,
  composicao,
  podeEditar,
}: {
  slug: string
  itens: { id: string; rotulo: string; saldo: number | null }[]
  composicao: Record<string, ComponenteNaTela[]>
  podeEditar: boolean
}) {
  return (
    <ul className={cx('flex flex-col divide-y divide-borda-suave')}>
      {itens.map((i) => (
        <DoItem key={i.id} slug={slug} item={i} inicial={composicao[i.id] ?? []} podeEditar={podeEditar} />
      ))}
    </ul>
  )
}
