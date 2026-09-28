'use client'

// Montar um pedido ao fornecedor: a loja onde a mercadoria entra, de quem se
// compra, e os itens com quantidade e custo combinado. Nasce RASCUNHO; a tela
// do pedido tem o "Mandei o pedido" e o "Chegou".

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/ui/base'
import { brl } from '@/ui/painel'
import type { ItemParaComprar } from '@/servidor/compras'
import { buscarItensAcao, criarPedidoAcao } from './acoes'
import { BuscaItem } from './BuscaItem'

type Linha = { variacaoId: string; descricao: string; medida: string; quantidade: string; custo: string }

const paraNumero = (t: string) => {
  const s = t.trim()
  if (!s) return Number.NaN
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
}
const doNumero = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ','))

export function NovoPedido({
  slug,
  lojas,
  lojaAtual,
  fornecedores,
  hoje,
}: {
  slug: string
  lojas: { id: string; nome: string }[]
  lojaAtual: string | null
  fornecedores: { id: string; nome: string }[]
  hoje: string
}) {
  const [aberto, setAberto] = useState(false)
  const [loja, setLoja] = useState(lojaAtual ?? lojas[0]?.id ?? '')
  const [fornecedor, setFornecedor] = useState('')
  const [previsto, setPrevisto] = useState('')
  const [observacao, setObservacao] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const buscar = useCallback((t: string) => buscarItensAcao(slug, loja, t), [slug, loja])

  if (!aberto) {
    return (
      <Botao onClick={() => setAberto(true)} disabled={lojas.length === 0}>
        + Novo pedido de compra
      </Botao>
    )
  }

  const total = linhas.reduce((s, l) => {
    const q = paraNumero(l.quantidade)
    const c = paraNumero(l.custo)
    return Number.isFinite(q) && Number.isFinite(c) ? s + q * c : s
  }, 0)

  const escolher = (i: ItemParaComprar) =>
    setLinhas((ls) =>
      ls.some((l) => l.variacaoId === i.variacaoId)
        ? ls
        : [...ls, { variacaoId: i.variacaoId, descricao: i.descricao, medida: i.medida, quantidade: '1', custo: doNumero(i.custo) }],
    )

  function salvar() {
    setErro(null)
    const itens = linhas.map((l) => ({
      variacaoId: l.variacaoId,
      quantidade: paraNumero(l.quantidade),
      custoUnit: l.custo.trim() ? paraNumero(l.custo) : null,
    }))
    if (itens.some((i) => !(i.quantidade > 0))) return setErro('Toda linha precisa de quantidade maior que zero.')
    if (itens.some((i) => i.custoUnit !== null && !(i.custoUnit >= 0))) return setErro('O custo é em reais: 12,50.')
    comecar(async () => {
      const r = await criarPedidoAcao(slug, { unidadeId: loja, fornecedorId: fornecedor || null, previsto: previsto || null, observacao, itens })
      if (!r.ok) setErro(r.erro)
      else router.push(`/${slug}/compras/${r.id}`)
    })
  }

  return (
    <Cartao
      caixa
      titulo="Novo pedido de compra"
      acao={
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-tinta-3 hover:text-tinta">
          fechar
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && <Aviso nivel="critico">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-3">
          {lojas.length > 1 ? (
            <Selecao
              rotulo="Entra na loja"
              name="unidadeId"
              value={loja}
              onChange={(ev) => {
                setLoja(ev.currentTarget.value)
                setLinhas([])
              }}
              opcoes={lojas.map((l) => ({ valor: l.id, titulo: l.nome }))}
            />
          ) : (
            <span className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-tinta">Entra na loja</span>
              <span className="rounded-norte bg-superficie-2 px-3 py-2 text-tinta-2">{lojas[0]?.nome}</span>
            </span>
          )}
          <Selecao
            rotulo="Fornecedor"
            name="fornecedorId"
            value={fornecedor}
            onChange={(ev) => setFornecedor(ev.currentTarget.value)}
            opcoes={[{ valor: '', titulo: 'Sem fornecedor cadastrado' }, ...fornecedores.map((f) => ({ valor: f.id, titulo: f.nome }))]}
          />
          <Campo rotulo="Previsto para" name="previsto" type="date" min={hoje} value={previsto} onChange={(ev) => setPrevisto(ev.currentTarget.value)} />
        </div>

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
                  onChange={(ev) => {
                    const v = ev.currentTarget.value
                    setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, quantidade: v } : x)))
                  }}
                />
                <Campo
                  rotulo="Custo unit."
                  name={`c-${i}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={l.custo}
                  onChange={(ev) => {
                    const v = ev.currentTarget.value
                    setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, custo: v } : x)))
                  }}
                />
                <Botao tom="discreto" className="px-2 py-2 text-xs" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}>
                  tirar
                </Botao>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tinta-3">Procure os itens acima. Serviço não entra: só o que tem estoque.</p>
        )}

        <Campo rotulo="Observação" name="observacao" value={observacao} onChange={(ev) => setObservacao(ev.currentTarget.value)} placeholder="Entrega pela manhã" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-tinta-2">
            Total combinado: <b className="numero text-tinta">{brl(total)}</b>
          </span>
          <Botao carregando={indo} disabled={linhas.length === 0} onClick={salvar}>
            {indo ? 'Salvando...' : 'Salvar pedido'}
          </Botao>
        </div>
      </div>
    </Cartao>
  )
}
