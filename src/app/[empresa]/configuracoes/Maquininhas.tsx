'use client'

// As maquininhas de cada loja (ver servidor/maquininhas.ts).
//
// Uma linha por maquininha (ou conta do Pix): o nome que a vendedora vai ver
// no balcão e em que formas ela entra. O balcão pergunta em qual caiu cada
// Pix, débito e crédito — e lembra a última escolha no aparelho, para não
// virar um toque a mais por venda. Loja sem maquininha cadastrada: o balcão
// não pergunta nada, como sempre foi.

import { useState, useTransition } from 'react'
import type { FormaPagamento } from '@prisma/client'
import { Aviso, Botao, cx } from '@/ui/base'
import { DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { salvarMaquininhasAcao } from './acoesBalcao'
import type { Maquininha } from '@/servidor/maquininhas'

const FORMAS: { forma: FormaPagamento; rotulo: string }[] = [
  { forma: 'PIX', rotulo: 'Pix' },
  { forma: 'DEBITO', rotulo: 'Débito' },
  { forma: 'CREDITO', rotulo: 'Crédito' },
]

export function Maquininhas({
  empresa,
  lojas,
}: {
  empresa: string
  lojas: { id: string; nome: string; maquininhas: Maquininha[] }[]
}) {
  return (
    <div className="flex flex-col gap-5">
      {lojas.map((l) => (
        <DaLoja key={l.id} empresa={empresa} loja={l} sozinha={lojas.length === 1} />
      ))}
    </div>
  )
}

function DaLoja({
  empresa,
  loja,
  sozinha,
}: {
  empresa: string
  loja: { id: string; nome: string; maquininhas: Maquininha[] }
  sozinha: boolean
}) {
  const [lista, setLista] = useState<Maquininha[]>(loja.maquininhas)
  const [recado, setRecado] = useState<{ nivel: 'bom' | 'critico'; texto: string } | null>(null)
  const [indo, comecar] = useTransition()

  const mudar = (i: number, m: Partial<Maquininha>) => {
    setRecado(null)
    setLista((x) => x.map((y, j) => (j === i ? { ...y, ...m } : y)))
  }

  function salvar() {
    comecar(async () => {
      const r = await salvarMaquininhasAcao(empresa, loja.id, lista)
      if (r.erro) setRecado({ nivel: 'critico', texto: r.erro })
      else {
        if (r.lista) setLista(r.lista)
        setRecado({ nivel: 'bom', texto: r.ok ?? 'Salvo.' })
      }
    })
  }

  return (
    <section className="flex flex-col gap-2">
      {!sozinha && <h3 className="text-sm font-semibold text-tinta">{loja.nome}</h3>}
      {recado && <Aviso nivel={recado.nivel}>{recado.texto}</Aviso>}
      {lista.length === 0 && <p className="text-sm text-tinta-3">Nenhuma maquininha: o balcão não pergunta em qual caiu.</p>}
      <ul className="flex flex-col gap-2">
        {lista.map((m, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-norte border border-borda-suave p-2">
            <input
              value={m.nome}
              onChange={(e) => mudar(i, { nome: e.target.value })}
              maxLength={40}
              placeholder="Nome (ex.: o banco da maquininha)"
              aria-label="Nome da maquininha"
              className="min-w-0 flex-1 rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta placeholder:text-tinta-3"
            />
            <span className="flex gap-1" role="group" aria-label="Em que formas entra">
              {FORMAS.map((f) => {
                const marcada = m.formas.includes(f.forma)
                return (
                  <button
                    key={f.forma}
                    type="button"
                    aria-pressed={marcada}
                    onClick={() =>
                      mudar(i, { formas: marcada ? m.formas.filter((x) => x !== f.forma) : [...m.formas, f.forma] })
                    }
                    className={cx(
                      'rounded-full border px-2.5 py-1 text-xs font-semibold',
                      marcada ? 'border-marca bg-marca-suave text-tinta' : 'border-borda bg-superficie text-tinta-3',
                    )}
                  >
                    {f.rotulo}
                  </button>
                )
              })}
            </span>
            <button
              type="button"
              onClick={() => {
                setRecado(null)
                setLista((x) => x.filter((_, j) => j !== i))
              }}
              aria-label={`Tirar ${m.nome || 'esta maquininha'}`}
              className={classeDaAcao({ tom: 'perigo' })}
            >
              <IconeDaAcao icone="excluir" />
              <DicaDaAcao>Tirar</DicaDaAcao>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setLista((x) => [...x, { nome: '', formas: ['PIX', 'DEBITO', 'CREDITO'] }])}
          disabled={lista.length >= 8}
          className={classeDaAcao({ jeito: 'pilula' })}
        >
          <IconeDaAcao icone="mais" tamanho={15} />
          Maquininha
        </button>
        <Botao onClick={salvar} carregando={indo}>
          {indo ? 'Salvando...' : sozinha ? 'Salvar' : `Salvar ${loja.nome}`}
        </Botao>
      </div>
    </section>
  )
}
