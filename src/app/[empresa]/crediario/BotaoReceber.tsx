'use client'

// O botão que abre o "Receber crediário" — na linha do Crediário, na ficha
// da cliente e no balcão. Recebeu, a tela de trás se atualiza ao fechar
// (o saldo mudou, a parcela quitou).

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Botao } from '@/ui/base'
import { IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { ReceberParcelas } from './ReceberParcelas'

export function BotaoReceber({
  slug,
  unidadeId,
  clienteId,
  marcar,
  children = 'Receber',
  tom = 'confirmar',
  className,
  linha = false,
  dica,
}: {
  slug: string
  unidadeId: string
  clienteId?: string | null
  marcar?: string[]
  children?: ReactNode
  tom?: 'confirmar' | 'secundario' | 'principal' | 'discreto'
  className?: string
  /** Na linha de uma lista: a pílula principal dos botões de ação (ui/premium). */
  linha?: boolean
  /** O aria-label da pílula da linha: "Receber a parcela 2/5 de Marta". */
  dica?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [recebeu, setRecebeu] = useState(false)
  const router = useRouter()
  return (
    <>
      {linha ? (
        <button type="button" onClick={() => setAberto(true)} aria-label={dica} className={classeDaAcao({ jeito: 'pilula', tom: 'principal' })}>
          {children}
          <IconeDaAcao icone="receber" tamanho={14} grosso />
        </button>
      ) : (
        <Botao tom={tom} onClick={() => setAberto(true)} className={className}>
          {children}
        </Botao>
      )}
      {aberto && (
        <ReceberParcelas
          slug={slug}
          unidadeId={unidadeId}
          clienteId={clienteId}
          marcar={marcar}
          aoReceber={() => setRecebeu(true)}
          aoFechar={() => {
            setAberto(false)
            if (recebeu) router.refresh()
            setRecebeu(false)
          }}
        />
      )}
    </>
  )
}
