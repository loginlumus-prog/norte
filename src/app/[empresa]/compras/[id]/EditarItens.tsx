'use client'

// Mudar os itens de um pedido que ainda é RASCUNHO: a quantidade que estava
// errada, o custo que o fornecedor mudou no telefone, o item que faltou.
// Depois de "Mandei o pedido" os itens são o que o fornecedor recebeu, e o
// servidor recusa (`salvarItensDoPedido`).
//
// A lista inteira vai de uma vez e troca a do pedido — é o mesmo desenho do
// "Novo pedido", para a pessoa não ter duas maneiras de montar a mesma coisa.

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao } from '@/ui/base'
import { brl } from '@/ui/painel'
import { lerDinheiro, lerNumero } from '@/servidor/dinheiro'
import type { ItemParaComprar } from '@/servidor/compras'
import { buscarItensAcao, salvarItensAcao } from '../acoes'
import { BuscaItem } from '../BuscaItem'

type Linha = { variacaoId: string; descricao: string; medida: string; quantidade: string; custo: string }

const paraCampo = (n: number | null, casas: number) =>
  n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas === 2 ? 2 : 0, maximumFractionDigits: casas, useGrouping: false })

export function EditarItens({
  slug,
  pedidoId,
  unidadeId,
  itens,
}: {
  slug: string
  pedidoId: string
  unidadeId: string
  itens: { variacaoId: string; descricao: string; medida: string; quantidade: number; custoUnit: number | null }[]
}) {
  const inicial = (): Linha[] =>
    itens.map((i) => ({
      variacaoId: i.variacaoId,
      descricao: i.descricao,
      medida: i.medida,
      quantidade: paraCampo(i.quantidade, 3),
      custo: paraCampo(i.custoUnit, 2),
    }))
  const [aberto, setAberto] = useState(false)
  const [linhas, setLinhas] = useState<Linha[]>(inicial)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const buscar = useCallback((t: string) => buscarItensAcao(slug, unidadeId, t), [slug, unidadeId])

  if (!aberto) {
    return (
      <Botao
        tom="secundario"
        className="self-start"
        onClick={() => {
          setLinhas(inicial())
          setErro(null)
          setAberto(true)
        }}
      >
        Mudar os itens
      </Botao>
    )
  }

  const total = linhas.reduce((s, l) => {
    const q = lerNumero(l.quantidade, 3)
    const c = lerDinheiro(l.custo)
    return q !== null && c !== null ? s + q * c : s
  }, 0)

  const escolher = (i: ItemParaComprar) =>
    setLinhas((ls) =>
      ls.some((l) => l.variacaoId === i.variacaoId)
        ? ls
        : [...ls, { variacaoId: i.variacaoId, descricao: i.descricao, medida: i.medida, quantidade: '1', custo: paraCampo(i.custo, 2) }],
    )
  const mudar = (i: number, campo: 'quantidade' | 'custo', v: string) =>
    setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, [campo]: v } : x)))

  function salvar() {
    setErro(null)
    const lidas = linhas.map((l) => ({
      l,
      quantidade: lerNumero(l.quantidade, 3),
      custoUnit: l.custo.trim() ? lerDinheiro(l.custo) : null,
      custoIlegivel: l.custo.trim() !== '' && lerDinheiro(l.custo) === null,
    }))
    const semQtd = lidas.find((x) => x.quantidade === null || !(x.quantidade > 0))
    if (semQtd) return setErro(`${semQtd.l.descricao}: a quantidade precisa ser um número maior que zero, como 2 ou 0,5.`)
    const custoRuim = lidas.find((x) => x.custoIlegivel)
    if (custoRuim) return setErro(`${custoRuim.l.descricao}: o custo é em reais, como 12,50.`)
    comecar(async () => {
      const r = await salvarItensAcao(slug, pedidoId, {
        itens: lidas.map((x) => ({ variacaoId: x.l.variacaoId, quantidade: x.quantidade, custoUnit: x.custoUnit })),
      })
      if (r.erro) setErro(r.erro)
      else {
        setAberto(false)
        router.refresh()
      }
    })
  }

  return (
    <Cartao
      caixa
      titulo="Mudar os itens do pedido"
      acao={
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-tinta-3 hover:text-tinta">
          fechar sem salvar
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && <Aviso nivel="critico">{erro}</Aviso>}
        <BuscaItem buscar={buscar} aoEscolher={escolher} mostrarCusto />
        {linhas.length > 0 ? (
          <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda">
            {linhas.map((l, i) => (
              <li key={l.variacaoId} className="grid grid-cols-1 items-end gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto]">
                <span className="min-w-0 truncate text-sm font-medium text-tinta">{l.descricao}</span>
                <Campo
                  rotulo={`Quantidade (${l.medida.toLowerCase()})`}
                  name={`q-${i}`}
                  inputMode="decimal"
                  value={l.quantidade}
                  onChange={(ev) => mudar(i, 'quantidade', ev.currentTarget.value)}
                />
                <Campo
                  rotulo="Custo unit."
                  name={`c-${i}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={l.custo}
                  onChange={(ev) => mudar(i, 'custo', ev.currentTarget.value)}
                />
                <Botao tom="discreto" className="px-2 py-2 text-xs" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}>
                  tirar
                </Botao>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tinta-3">O pedido precisa de pelo menos um item. Procure acima.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-tinta-2">
            Total combinado: <b className="numero text-tinta">{brl(total)}</b>
          </span>
          <Botao carregando={indo} disabled={linhas.length === 0} onClick={salvar}>
            {indo ? 'Salvando...' : 'Salvar os itens'}
          </Botao>
        </div>
      </div>
    </Cartao>
  )
}
