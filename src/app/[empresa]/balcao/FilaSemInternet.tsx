'use client'

// A faixa do balcão sem internet: diz que caiu, quantas vendas estão
// guardadas no aparelho esperando subir, e as que o servidor recusou — com o
// motivo e o que fazer. Sem queda e sem fila, não aparece.

import { useState } from 'react'
import { Botao } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { IconeDaAcao, classeDaAcao } from '@/ui/premium'
import type { VendaNaFila } from './semInternet'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms)

export function FilaSemInternet({
  online,
  fila,
  subir,
  descartar,
}: {
  online: boolean
  fila: VendaNaFila[]
  subir: (tambemRecusadas?: boolean) => Promise<void>
  descartar: (chave: string) => void
}) {
  const [aberta, setAberta] = useState(false)
  const [indo, setIndo] = useState(false)
  if (online && fila.length === 0) return null
  const recusadas = fila.filter((v) => v.erro)
  const esperando = fila.length - recusadas.length

  return (
    <div className={`rounded-norte border px-3 py-2 text-sm ${recusadas.length ? 'border-critico/40 bg-critico-fundo' : 'border-atencao/40 bg-atencao-fundo'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-tinta">
          {!online && 'Sem internet — vendendo pelo que está guardado no aparelho (dinheiro, Pix e cartão). '}
          {esperando > 0 && `${esperando} ${esperando === 1 ? 'venda esperando' : 'vendas esperando'} para subir. `}
          {recusadas.length > 0 && `${recusadas.length} ${recusadas.length === 1 ? 'venda recusada' : 'vendas recusadas'} pelo servidor.`}
        </span>
        {fila.length > 0 && (
          <span className="flex gap-2">
            <Botao
              tom="discreto"
              className="px-2 py-1 text-xs"
              carregando={indo}
              onClick={async () => {
                setIndo(true)
                await subir(true)
                setIndo(false)
              }}
            >
              Tentar agora
            </Botao>
            <button type="button" className={classeDaAcao({ jeito: 'pilula' })} aria-expanded={aberta} onClick={() => setAberta(!aberta)}>
              <IconeDaAcao icone="ver" tamanho={15} />
              {aberta ? 'Esconder' : 'Ver'}
            </button>
          </span>
        )}
      </div>
      {aberta && fila.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {fila.map((v) => (
            <li key={v.chave} className="flex flex-wrap items-center justify-between gap-2 border-t border-borda-suave pt-1.5">
              <span className="flex flex-col">
                <span className="text-tinta">
                  {hora(v.quando)} · {brl(v.total)} · {v.resumo}
                </span>
                {v.erro && <span className="text-xs font-medium text-critico">{v.erro}</span>}
              </span>
              {v.erro && (
                <Confirmar
                  tom="secundario"
                  className="px-2 py-1 text-xs"
                  pergunta="Descartar esta venda da fila? Ela NÃO entra no sistema — lance de novo no balcão, se precisar."
                  sim="Sim, descartar"
                  aoConfirmar={async () => descartar(v.chave)}
                >
                  Descartar
                </Confirmar>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
