'use client'

// "Lembrete do horário": a chave, as horas de antecedência e o texto que sai
// — mostrado INTEIRO, porque é mensagem em nome da loja no celular do cliente,
// e quem liga precisa ler o que vai sair.

import { useActionState } from 'react'
import { Aviso, Botao, Marcar, Selecao } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { salvarLembreteAcao, type EstadoLembrete } from './acoes'

export function Lembrete({
  empresa,
  ativo,
  horas,
  opcoes,
  exemplo,
  temAssistente,
}: {
  empresa: string
  ativo: boolean
  horas: number
  opcoes: readonly number[]
  exemplo: string
  /** O módulo do assistente (a linha do WhatsApp) está ligado e no plano. */
  temAssistente: boolean
}) {
  const [estado, agir, pendente] = useActionState<EstadoLembrete, FormData>(salvarLembreteAcao, {})
  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
      {!temAssistente && (
        <Aviso nivel="neutro">
          O lembrete sai pelo WhatsApp do assistente. Enquanto o módulo “Agente no WhatsApp” não estiver ligado (planos com o
          assistente), ele não sai — a chave fica guardada.
        </Aviso>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Marcar
          name="ativo"
          defaultChecked={ativo}
          titulo="Mandar lembrete do horário"
          resumo="Só para quem aceitou receber mensagens da loja no WhatsApp e não pediu para parar. Texto fixo, sem IA."
        />
        <Selecao
          rotulo="Quanto tempo antes"
          name="horas"
          defaultValue={String(horas)}
          opcoes={opcoes.map((h) => ({ valor: String(h), titulo: h === 24 ? '1 dia antes' : h === 48 ? '2 dias antes' : `${h} horas antes` }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-tinta-3">O que sai (com o nome, o dia e a hora de cada um):</span>
        <p className="rounded-norte bg-superficie-2 px-3 py-2 text-sm whitespace-pre-line text-tinta-2">{exemplo}</p>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-tinta-3">
        <li>Sai entre 8h e 20h, uma vez por horário, e não sai na última hora nem para horário marcado com menos de 3 horas.</li>
        <li>A resposta do cliente chega no WhatsApp da loja e quem responde é a equipe — o assistente não conversa com cliente. “PARAR” tira o número da lista na hora.</li>
        <li>O texto não diz o serviço: na clínica, isso seria informação de saúde na tela do celular.</li>
        <li>
          No WhatsApp oficial (Meta), fora da janela de 24 horas só sai modelo aprovado. O lembrete usa o modelo
          “norte_lembrete_horario”, criado quando a conta é conectada; se ele ainda não estiver aprovado na sua conta, o lembrete
          não sai e a Agenda mostra “lembrete não saiu”.
        </li>
      </ul>
      <div className="flex justify-end">
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
