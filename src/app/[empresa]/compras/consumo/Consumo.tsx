'use client'

// Anotar o material usado: acha o item, diz quanto, e (se quiser) para quê.
// Sai do estoque como CONSUMO — sem saldo em um item, nada sai, e a frase
// diz qual.

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/ui/base'
import { CampoDoPin } from '@/ui/Assinar'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import type { ItemParaComprar } from '@/servidor/compras'
import { buscarConsumoAcao, registrarConsumoAcao } from '../acoes'
import { BuscaItem } from '../BuscaItem'

type Linha = { variacaoId: string; descricao: string; medida: string; saldo: number; quantidade: string }

const paraNumero = (t: string) => {
  const s = t.trim()
  if (!s) return Number.NaN
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
}

export function Consumo({ slug, lojas, lojaAtual }: { slug: string; lojas: { id: string; nome: string }[]; lojaAtual: string | null }) {
  const [loja, setLoja] = useState(lojaAtual ?? lojas[0]?.id ?? '')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [motivo, setMotivo] = useState('')
  const [recado, setRecado] = useState<{ ok?: string; erro?: string } | null>(null)
  // A baixa pede o PIN de quem anota quando a empresa assina as exceções.
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const buscar = useCallback((t: string) => buscarConsumoAcao(slug, loja, t), [slug, loja])

  const escolher = (i: ItemParaComprar) =>
    setLinhas((ls) => (ls.some((l) => l.variacaoId === i.variacaoId) ? ls : [...ls, { variacaoId: i.variacaoId, descricao: i.descricao, medida: i.medida, saldo: i.saldo, quantidade: '1' }]))

  function anotar() {
    setRecado(null)
    const itens = linhas.map((l) => ({ variacaoId: l.variacaoId, quantidade: paraNumero(l.quantidade) }))
    if (itens.some((i) => !(i.quantidade > 0))) return setRecado({ erro: 'Toda linha precisa de quantidade maior que zero.' })
    comecar(async () => {
      const r = await registrarConsumoAcao(slug, { unidadeId: loja, itens, motivo, pin: pin || null })
      setPin('')
      setRecado(r)
      if (r.precisaPin) setPedePin(true)
      if (r.ok) {
        setLinhas([])
        setMotivo('')
        setPedePin(false)
        router.refresh()
      }
    })
  }

  return (
    <Cartao caixa titulo="Anotar material usado">
      <div className="flex flex-col gap-4">
        {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
        {recado?.ok && <Aviso nivel="bom">{recado.ok}</Aviso>}
        {lojas.length > 1 && (
          <Selecao
            rotulo="Loja"
            name="unidadeId"
            value={loja}
            onChange={(ev) => {
              setLoja(ev.currentTarget.value)
              setLinhas([])
            }}
            opcoes={lojas.map((l) => ({ valor: l.id, titulo: l.nome }))}
          />
        )}
        <BuscaItem buscar={buscar} aoEscolher={escolher} mostrarCusto={false} rotulo="O que foi usado" />
        {linhas.length > 0 && (
          <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda">
            {linhas.map((l, i) => (
              <li key={l.variacaoId} className="grid grid-cols-1 items-end gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-tinta">{l.descricao}</span>
                  <span className="text-xs text-tinta-3">tem {l.saldo.toLocaleString('pt-BR')} {l.medida.toLowerCase()}</span>
                </span>
                <Campo
                  rotulo="Quanto"
                  name={`q-${i}`}
                  inputMode="decimal"
                  value={l.quantidade}
                  onChange={(ev) => {
                    const v = ev.currentTarget.value
                    setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, quantidade: v } : x)))
                  }}
                />
                <button
                  type="button"
                  onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}
                  className={classeDaAcao({ tom: 'perigo' })}
                  aria-label={`Tirar ${l.descricao}`}
                >
                  <IconeDaAcao icone="excluir" />
                  <DicaDaAcao>Tirar</DicaDaAcao>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Campo rotulo="Para quê" name="motivo" value={motivo} onChange={(ev) => setMotivo(ev.currentTarget.value)} placeholder="Uso do dia" dica="Opcional. Aparece no histórico do estoque." />
        {pedePin && (
          <div className="max-w-xs">
            <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={anotar} />
          </div>
        )}
        <div className="flex justify-end">
          <Botao carregando={indo} disabled={linhas.length === 0} onClick={anotar}>
            {indo ? 'Anotando...' : 'Anotar consumo'}
          </Botao>
        </div>
      </div>
    </Cartao>
  )
}
