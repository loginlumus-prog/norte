'use client'

// "Ela já deve": o aviso do balcão quando a cliente escolhida tem crediário
// VENCIDO nesta loja.
//
// A etiqueta "deve · atrasado" ao lado do nome passava despercebida com fila
// no balcão — e a cliente que veio comprar saía sem ninguém lembrar da
// parcela de dois meses atrás. Aqui é um cartão vermelho com o valor, o
// atraso e a pergunta em voz alta: "vai pagar alguma parcela agora?". O "sim"
// abre o receber por cima, sem perder a venda; o "não" some com o aviso
// desta cliente até o balcão recarregar.
//
// Em dia, só um atalho discreto para quem veio adiantar parcela.

import { useEffect, useState } from 'react'
import { Botao } from '@/ui/base'
import type { SituacaoDeCredito } from '@/servidor/crediario'
import { situacaoDeCreditoAcao } from './acoes'
import { ReceberParcelas } from './ReceberParcelas'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** As clientes dispensadas ("só a compra de hoje") nesta aba do navegador. */
const DISPENSADAS = 'norte:divida-dispensada'
function dispensada(id: string): boolean {
  try {
    return (sessionStorage.getItem(DISPENSADAS) ?? '').split(',').includes(id)
  } catch {
    return false
  }
}
function dispensar(id: string) {
  try {
    const atuais = (sessionStorage.getItem(DISPENSADAS) ?? '').split(',').filter(Boolean)
    sessionStorage.setItem(DISPENSADAS, [...atuais.filter((x) => x !== id), id].slice(-50).join(','))
  } catch {
    // Sem armazenamento (aba anônima): o aviso só volta ao trocar de cliente.
  }
}

export function AlertaDeDivida({
  slug,
  unidadeId,
  clienteId,
  podeReceber = true,
}: {
  slug: string
  unidadeId: string
  clienteId: string
  /** Quem não recebe crediário vê o aviso, sem o botão. */
  podeReceber?: boolean
}) {
  const [sit, setSit] = useState<SituacaoDeCredito | null>(null)
  const [oculto, setOculto] = useState(false)
  const [recebendo, setRecebendo] = useState(false)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    setOculto(dispensada(clienteId))
    situacaoDeCreditoAcao(slug, clienteId, unidadeId).then((s) => {
      if (vivo) setSit(s)
    })
    return () => {
      vivo = false
    }
  }, [slug, clienteId, unidadeId, versao])

  if (!sit || sit.clienteId !== clienteId) return null

  const receber = recebendo && (
    <ReceberParcelas
      slug={slug}
      unidadeId={unidadeId}
      clienteId={clienteId}
      aoFechar={() => {
        setRecebendo(false)
        setVersao((v) => v + 1)
      }}
    />
  )

  const outras = sit.outrasLojas.filter((o) => o.devendo > 0)
  const primeiro = sit.nome.split(' ')[0]

  if (sit.vencido > 0 && !oculto) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-norte border border-critico-borda bg-critico-fundo p-3 text-sm text-critico">
        <p>
          <b>
            {primeiro} já deve {brl(sit.devendo)} aqui
          </b>{' '}
          — {brl(sit.vencido)} vencido{sit.parcelasVencidas > 1 ? ` em ${sit.parcelasVencidas} parcelas` : ''}
          {sit.diasMaisAntiga > 0 && `, a mais antiga com ${sit.diasMaisAntiga} dia${sit.diasMaisAntiga === 1 ? '' : 's'} de atraso`}
          {sit.atrasoHoje > 0 && ` (+ ${brl(sit.atrasoHoje)} de multa e juros hoje)`}.
        </p>
        {outras.length > 0 && (
          <p className="text-xs">
            Também deve em {outras.map((o) => `${o.nome} (${brl(o.devendo)})`).join(', ')}.
          </p>
        )}
        {/* Cobrança pausada pela gerência (acordo, advogado): o balcão sabe, e
            não puxa o assunto de cobrar — só recebe se ela quiser pagar. */}
        {sit.cobrancaPausada && (
          <p className="text-xs font-semibold">A cobrança dela está pausada pela gerência: não cobre — só receba se ela quiser pagar.</p>
        )}
        <p className="font-semibold">Vai pagar alguma parcela agora?</p>
        <div className="flex flex-wrap gap-2">
          {podeReceber && (
            <Botao tom="perigo" onClick={() => setRecebendo(true)} className="py-1.5 text-xs">
              Sim, receber
            </Botao>
          )}
          <Botao
            tom="secundario"
            onClick={() => {
              dispensar(clienteId)
              setOculto(true)
            }}
            className="py-1.5 text-xs"
          >
            Não, só a compra de hoje
          </Botao>
        </div>
        {receber}
      </div>
    )
  }

  if (!podeReceber || sit.devendo <= 0) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setRecebendo(true)}
        className="self-start text-xs font-semibold text-marca underline-offset-2 hover:underline"
      >
        receber parcela
      </button>
      {receber}
    </>
  )
}
