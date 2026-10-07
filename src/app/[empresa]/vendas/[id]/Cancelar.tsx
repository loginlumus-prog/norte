'use client'

import { useActionState, useState } from 'react'
import { Botao, Campo, Aviso, cx } from '@/ui/base'
import { IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { CampoDoPin, MotivosProntos } from '@/ui/Assinar'
import { cancelarAcao, type EstadoCancelamento } from './acoes'
import { semApagar } from '@/ui/formulario'

// Cancelar é a única ação destrutiva desta tela, e por isso ela é a única
// coisa aqui que pede DUAS decisões: abrir, e depois confirmar com motivo.
// Um botão vermelho solto ao lado de "imprimir" é como se cancela venda sem
// querer — e venda cancelada sem querer é estoque errado e cliente confuso.

export function Cancelar({
  slug,
  vendaId,
  numero,
  palavras,
}: {
  slug: string
  vendaId: string
  numero: number
  /** As palavras do ramo — "este atendimento", "o paciente" (servidor/vocabulario.ts). */
  palavras: { estaVenda: string; aVenda: string; pessoa: string }
}) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [estado, agir, pendente] = useActionState<EstadoCancelamento, FormData>(cancelarAcao, {})

  if (estado.ok) return <Aviso nivel="bom">{estado.ok}</Aviso>

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={cx(classeDaAcao({ jeito: 'pilula', tom: 'perigo' }), 'self-start')}>
        <IconeDaAcao icone="cancelar" tamanho={15} />
        Cancelar {palavras.estaVenda}
      </button>
    )
  }

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-3 rounded-norte border border-critico-borda bg-critico-fundo p-4">
      <input type="hidden" name="empresa" value={slug} />
      <input type="hidden" name="venda" value={vendaId} />

      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-tinta">
          Cancelar {palavras.aVenda} {numero}?
        </p>
        <p className="text-[13px] leading-relaxed text-tinta-2">
          O estoque volta e os pontos do {palavras.pessoa} voltam. <b>O dinheiro não volta sozinho</b> — se foi
          Pix ou cartão, devolver é com você, e o motivo aqui é o que vai explicar isso no livro.
        </p>
      </div>

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <MotivosProntos excecao="venda.cancelar" atual={motivo} aoEscolher={setMotivo} />
      <Campo
        rotulo="Motivo"
        name="motivo"
        required
        minLength={3}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Cliente desistiu, devolvido em dinheiro"
        autoFocus
      />
      {/* A empresa pede a assinatura de quem cancela (Configurações): o
          campo só aparece quando o servidor diz que precisa. */}
      {estado.precisaPin && <CampoDoPin slug={slug} name="pin" />}

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
