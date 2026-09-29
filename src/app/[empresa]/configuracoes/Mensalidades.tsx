'use client'

// A regra das mensalidades, do lado de quem decide.
//
// Multa e juro são de ATRASO, com teto (2% de multa, uma vez só; 1% de juro
// ao mês, por dia): é o que a lei deixa cobrar de escola, e o sistema não
// deixa passar disso. O desconto de pontualidade é opcional. E o aviso ao
// responsável no WhatsApp nasce desligado — texto fixo, só para quem aceitou.

import { useActionState } from 'react'
import { Aviso, Botao, Campo, Marcar } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { salvarMensalidadesAcao, type EstadoMensalidades } from './acoesMensalidades'

const virgula = (n: number) => String(n).replace('.', ',')

export function Mensalidades({
  empresa,
  inicial,
  temAssistente,
  exemplo,
}: {
  empresa: string
  inicial: { multaPct: number; jurosMes: number; pontualidadePct: number; avisoAtivo: boolean; avisoDias: number; atrasoDias: number }
  temAssistente: boolean
  exemplo: string
}) {
  const [estado, agir, pendente] = useActionState<EstadoMensalidades, FormData>(salvarMensalidadesAcao, {})

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Multa de atraso, %" name="multaPct" inputMode="decimal" defaultValue={virgula(inicial.multaPct)} dica="Uma vez só por mensalidade. Até 2%." />
        <Campo rotulo="Juro de atraso, % ao mês" name="jurosMes" inputMode="decimal" defaultValue={virgula(inicial.jurosMes)} dica="Por dia de atraso. Até 1% ao mês." />
        <Campo
          rotulo="Desconto de pontualidade, %"
          name="pontualidadePct"
          inputMode="decimal"
          defaultValue={virgula(inicial.pontualidadePct)}
          dica="Para quem paga tudo até o vencimento. Zero = não dá."
        />
      </div>

      <Marcar
        name="avisoAtivo"
        defaultChecked={inicial.avisoAtivo}
        titulo="Avisar o responsável no WhatsApp"
        resumo={
          temAssistente
            ? 'Texto fixo, sem IA, só para o responsável que aceitou (anotado na ficha do aluno). Nunca para o aluno. Responder PARAR tira o número.'
            : 'Sai pelo WhatsApp do assistente: ligue o assistente (plano Assistente para cima) para o aviso sair.'
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Quantos dias antes do vencimento" name="avisoDias" inputMode="numeric" type="number" min={1} max={10} defaultValue={String(inicial.avisoDias)} />
        <Campo
          rotulo="Aviso de atraso: quantos dias depois"
          name="atrasoDias"
          inputMode="numeric"
          type="number"
          min={0}
          max={30}
          defaultValue={String(inicial.atrasoDias)}
          dica="Zero = sem aviso de atraso. Sai uma vez só."
        />
      </div>
      <p className="rounded-norte bg-superficie-2 p-3 text-xs whitespace-pre-line text-tinta-2">{exemplo}</p>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-tinta-3">Vale para os próximos recebimentos. O que já foi recebido não muda.</p>
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
