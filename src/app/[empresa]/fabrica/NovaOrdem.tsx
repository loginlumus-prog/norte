'use client'

// Abrir uma ordem de produção: em que fábrica, o quê, quantas bateladas.
//
// Os produtos COM ficha técnica vêm primeiro: com ela a ordem já nasce com o
// previsto e com os insumos de cada batelada, e o encerramento só confere.
// Sem ficha também abre — aí "bateladas" é a quantidade pronta, e o lote e a
// entrada no estoque ficam registrados mesmo assim.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Selecao, cx } from '@/ui/base'
import { quantidade } from '@/ui/texto'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import type { ItemDoCatalogo } from '@/servidor/fabrica'
import { abrirOrdemAcao, type Recado } from './acoes'
import { LEGIVEL, ler } from './formato'

export function NovaOrdem({
  slug,
  fabricas,
  produtos,
  rendimentos,
}: {
  slug: string
  /** As fábricas em que a pessoa pode produzir. */
  fabricas: { id: string; nome: string }[]
  /** Os prontos (não material de uso); os com ficha primeiro. */
  produtos: ItemDoCatalogo[]
  /** Rendimento de uma batelada, por produto com ficha. */
  rendimentos: Record<string, number>
}) {
  const comFicha = produtos.filter((p) => p.temReceita)
  const semFicha = produtos.filter((p) => !p.temReceita)
  const [aberto, setAberto] = useState(false)
  const [fabrica, setFabrica] = useState(fabricas[0]?.id ?? '')
  const [produto, setProduto] = useState(comFicha[0]?.variacaoId ?? semFicha[0]?.variacaoId ?? '')
  const [bateladas, setBateladas] = useState('1')
  const [observacao, setObservacao] = useState('')
  const [recado, setRecado] = useState<Recado | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const escolhido = produtos.find((p) => p.variacaoId === produto)
  const rende = escolhido ? rendimentos[escolhido.variacaoId] : undefined
  const n = ler(bateladas)

  if (!aberto) {
    return (
      <div className="flex flex-col gap-2">
        <Botao className="w-fit" onClick={() => { setRecado(null); setAberto(true) }} disabled={fabricas.length === 0 || produtos.length === 0}>
          Nova ordem de produção
        </Botao>
        {recado?.ok && <Aviso nivel="bom">{recado.ok}</Aviso>}
      </div>
    )
  }

  function abrir() {
    if (n === null || Number.isNaN(n) || n <= 0) {
      setRecado({ erro: n !== null && Number.isNaN(n) ? LEGIVEL : 'Quantas bateladas? Precisa ser maior que zero.' })
      return
    }
    setRecado(null)
    comecar(async () => {
      const r = await abrirOrdemAcao(slug, { unidadeId: fabrica, variacaoId: produto, bateladas: n, observacao })
      setRecado(r)
      if (r.ok) {
        setAberto(false)
        setBateladas('1')
        setObservacao('')
        router.refresh()
      }
    })
  }

  return (
    <Cartao
      caixa
      titulo="Nova ordem de produção"
      acao={
        <button type="button" onClick={() => setAberto(false)} className={classeDaAcao()} aria-label="Fechar a ordem nova">
          <IconeDaAcao icone="fechar" />
          <DicaDaAcao>Fechar</DicaDaAcao>
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          {fabricas.length > 1 && (
            <Selecao
              rotulo="Fábrica"
              name="fabrica"
              value={fabrica}
              onChange={(ev) => setFabrica(ev.currentTarget.value)}
              opcoes={fabricas.map((f) => ({ valor: f.id, titulo: f.nome }))}
            />
          )}
          {/* <select> à mão, e não a Selecao: ela não tem grupo, e aqui o
              grupo é a informação — com ficha técnica ou sem. */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="ordem-produto" className="text-sm font-medium text-tinta">
              O que vai produzir
            </label>
            <select
              id="ordem-produto"
              value={produto}
              onChange={(ev) => setProduto(ev.currentTarget.value)}
              className="w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
            >
              {comFicha.length > 0 && (
                <optgroup label="Com ficha técnica">
                  {comFicha.map((p) => (
                    <option key={p.variacaoId} value={p.variacaoId}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              {semFicha.length > 0 && (
                <optgroup label="Sem ficha técnica">
                  {semFicha.map((p) => (
                    <option key={p.variacaoId} value={p.variacaoId}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Campo
            rotulo={rende !== undefined ? 'Bateladas' : 'Quantidade pronta'}
            name="bateladas"
            inputMode="decimal"
            value={bateladas}
            onChange={(ev) => setBateladas(ev.currentTarget.value)}
          />
          <Campo
            rotulo="Observação (opcional)"
            name="observacao"
            value={observacao}
            onChange={(ev) => setObservacao(ev.currentTarget.value)}
            placeholder="Sabor do dia, quem está na produção…"
          />
        </div>
        <p className={cx('text-sm', rende !== undefined ? 'text-tinta-2' : 'text-tinta-3')}>
          {escolhido && rende !== undefined ? (
            <>
              Uma batelada rende {quantidade(rende, escolhido.medida)}.{' '}
              {n !== null && !Number.isNaN(n) && n > 0 && (
                <b className="text-tinta">Previsto: {quantidade(Math.round(rende * n * 1000) / 1000, escolhido.medida)}.</b>
              )}
            </>
          ) : (
            'Este produto ainda não tem ficha técnica: diga quanto vai ficar pronto. O lote e a entrada no estoque ficam registrados; o custo só é apurado com a ficha.'
          )}
        </p>
        <div className="flex justify-end">
          <Botao carregando={indo} onClick={abrir} disabled={!fabrica || !produto}>
            Abrir a ordem
          </Botao>
        </div>
      </div>
    </Cartao>
  )
}
