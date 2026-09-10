'use client'

import { useActionState, useState } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { cancelarAcao, type EstadoCancelamento } from './acoes'

// Cancelar é a única ação destrutiva desta tela, e por isso ela é a única
// coisa aqui que pede DUAS decisões: abrir, e depois confirmar com motivo.
// Um botão vermelho solto ao lado de "imprimir" é como se cancela venda sem
// querer — e venda cancelada sem querer é estoque errado e cliente confuso.

export function Cancelar({ slug, vendaId, numero }: { slug: string; vendaId: string; numero: number }) {
  const [aberto, setAberto] = useState(false)
  const [estado, agir, pendente] = useActionState<EstadoCancelamento, FormData>(cancelarAcao, {})

  if (estado.ok) return <Aviso nivel="bom">{estado.ok}</Aviso>

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-sm font-medium text-critico underline-offset-2 hover:underline"
      >
        Cancelar esta venda
      </button>
    )
  }

  return (
    <form action={agir} className="flex flex-col gap-3 rounded-norte border border-critico-borda bg-critico-fundo p-4">
      <input type="hidden" name="empresa" value={slug} />
      <input type="hidden" name="venda" value={vendaId} />

      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-tinta">Cancelar a venda {numero}?</p>
        <p className="text-[13px] leading-relaxed text-tinta-2">
          O estoque volta e os pontos do cliente voltam. <b>O dinheiro não volta sozinho</b> — se foi
          Pix ou cartão, devolver é com você, e o motivo aqui é o que vai explicar isso no livro.
        </p>
      </div>

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <Campo
        rotulo="Motivo"
        name="motivo"
        required
        minLength={3}
        placeholder="Cliente desistiu, devolvido em dinheiro"
        autoFocus
      />

      <div className="flex gap-2">
        <Botao type="submit" tom="perigo" carregando={pendente}>
          {pendente ? 'Cancelando...' : 'Confirmar cancelamento'}
        </Botao>
        <Botao type="button" tom="secundario" onClick={() => setAberto(false)}>
          Deixar como está
        </Botao>
      </div>
    </form>
  )
}
