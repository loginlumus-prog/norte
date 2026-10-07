'use client'

// O mínimo de um item nesta loja, definido na própria linha.
//
// O mínimo decide o que aparece como "no mínimo" e em "Precisa comprar" — e
// não existia tela para ele: a ação estava pronta e ninguém a chamava. Então
// todo item tinha mínimo zero, e o alarme só tocava quando já tinha acabado.
//
// É por LOJA: a loja do shopping gira três vezes mais que a do centro e
// precisa de mínimo maior. Por isso só aparece com uma loja escolhida.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, cx } from '@/ui/base'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import { salvarMinimo } from './acoes'

const SIGLA: Record<string, string> = { UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx' }

/** "0,5", "2" ou "1.5" — quantidade, não dinheiro. Vazio é zero (sem mínimo). */
export function lerQuantidade(t: string): number | null {
  const s = t.trim()
  if (!s) return 0
  if (!/^\d+([.,]\d{1,3})?$/.test(s)) return null
  return Number(s.replace(',', '.'))
}

const mostrar = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export function Minimo({
  slug,
  variacaoId,
  unidadeId,
  minimo,
  medida,
}: {
  slug: string
  variacaoId: string
  unidadeId: string
  minimo: number
  medida: string
}) {
  const [aberto, setAberto] = useState(false)
  const [valor, setValor] = useState(minimo > 0 ? mostrar(minimo) : '')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Definir o mínimo deste item nesta loja"
        className={cx(classeDaAcao({ jeito: 'pilula' }), 'numero')}
      >
        {/* Pílula com nome: um lápis sozinho não diria "o mínimo". */}
        <IconeDaAcao icone={minimo > 0 ? 'editar' : 'mais'} tamanho={15} />
        {minimo > 0 ? `${mostrar(minimo)} ${SIGLA[medida] ?? ''}` : 'Definir'}
      </button>
    )
  }

  const salvar = () =>
    comecar(async () => {
      setErro(null)
      const n = lerQuantidade(valor)
      if (n === null) {
        setErro('Escreva só o número: 5, ou 0,5 para meio quilo.')
        return
      }
      const r = await salvarMinimo(slug, variacaoId, unidadeId, n)
      if (r.erro) {
        setErro(r.erro)
        return
      }
      setAberto(false)
      router.refresh()
    })

  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <input
        value={valor}
        autoFocus
        inputMode="decimal"
        placeholder="0"
        onChange={(e) => setValor(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            salvar()
          }
          if (e.key === 'Escape') setAberto(false)
        }}
        aria-label="Mínimo nesta loja"
        className="numero w-16 rounded-norte border border-borda bg-superficie px-2 py-1 text-right text-sm text-tinta"
      />
      <Botao tom="confirmar" className="px-2 py-1 text-xs" carregando={indo} onClick={salvar}>
        Salvar
      </Botao>
      <button
        type="button"
        onClick={() => {
          setAberto(false)
          setErro(null)
        }}
        className={classeDaAcao()}
        aria-label="Cancelar"
      >
        <IconeDaAcao icone="fechar" />
        <DicaDaAcao>Cancelar</DicaDaAcao>
      </button>
      {erro && <span className="w-full text-right text-xs font-medium text-critico">{erro}</span>}
    </span>
  )
}
