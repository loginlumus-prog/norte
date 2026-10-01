'use client'

// O botão que abre o "Receber crediário" — na linha do Crediário, na ficha
// da cliente e no balcão. Recebeu, a tela de trás se atualiza ao fechar
// (o saldo mudou, a parcela quitou).

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Botao } from '@/ui/base'
import { ReceberParcelas } from './ReceberParcelas'

export function BotaoReceber({
  slug,
  unidadeId,
  clienteId,
  marcar,
  children = 'Receber',
  tom = 'confirmar',
  className,
}: {
  slug: string
  unidadeId: string
  clienteId?: string | null
  marcar?: string[]
  children?: ReactNode
  tom?: 'confirmar' | 'secundario' | 'principal' | 'discreto'
  className?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [recebeu, setRecebeu] = useState(false)
  const router = useRouter()
  return (
    <>
      <Botao tom={tom} onClick={() => setAberto(true)} className={className}>
        {children}
      </Botao>
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
