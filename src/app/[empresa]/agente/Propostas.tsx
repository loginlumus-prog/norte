'use client'

// As propostas paradas, esperando um sim ou um não.
//
// Duas coisas que decidem se isto funciona na vida real:
//
// 1. O RESUMO É A PROPOSTA. A pessoa lê uma frase em português com o número
//    dentro e decide. Se ela precisar abrir outra tela para entender, ela não
//    responde, e o agente vira uma fila de coisas paradas.
//
// 2. RECUSAR É TÃO FÁCIL QUANTO CONFIRMAR. Quando "não" dá trabalho, a pessoa
//    ou confirma sem ler, ou deixa tudo apodrecer. Os dois botões têm o mesmo
//    peso; só a cor diferencia.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, Cartao, Situacao } from '@/ui/base'
import { brl } from '@/ui/painel'
import { responder } from './acoes'

export type PropostaNaTela = {
  id: string
  poder: string
  resumo: string
  valor: number | null
  expiraEm: string
}

export function Propostas({ slug, itens }: { slug: string; itens: PropostaNaTela[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [respondendo, setRespondendo] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const responderA = (id: string, aceita: boolean) => {
    setErro(null)
    setRespondendo(id)
    comecar(async () => {
      const r = await responder(slug, id, aceita)
      if (!r.ok) setErro(RECADO[r.motivo] ?? 'Não deu para responder.')
      setRespondendo(null)
      // `revalidatePath` no servidor limpa o cache, mas quem chama a ação
      // fora de um <form> não redesenha sozinho: a proposta continuava na
      // tela depois de confirmada, e a pessoa clicava de novo achando que
      // não pegou. O refresh do roteador é o que fecha o ciclo.
      router.refresh()
    })
  }

  return (
    <Cartao titulo="Propostas">
      {erro && <p className="mb-3 text-sm font-medium text-critico">{erro}</p>}
      <ul className="flex flex-col">
        {itens.map((p) => (
          <li
            key={p.id}
            className="flex flex-col gap-2.5 border-b border-borda-suave py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-sm text-tinta">{p.resumo}</span>
              <span className="flex items-center gap-2">
                <Situacao nivel="neutro">{p.poder}</Situacao>
                <span className="text-xs text-tinta-3">expira {daqui(p.expiraEm)}</span>
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-2">
              {p.valor != null && (
                <span className="numero w-24 text-sm font-semibold text-tinta">
                  {brl(p.valor)}
                </span>
              )}
              <Botao
                tom="secundario"
                className="px-3 py-1 text-xs"
                carregando={indo && respondendo === p.id}
                onClick={() => responderA(p.id, false)}
              >
                Não
              </Botao>
              <Botao
                tom="confirmar"
                className="px-3 py-1 text-xs"
                carregando={indo && respondendo === p.id}
                onClick={() => responderA(p.id, true)}
              >
                Confirmar
              </Botao>
            </span>
          </li>
        ))}
      </ul>
    </Cartao>
  )
}

const RECADO: Record<string, string> = {
  nao_existe: 'Essa proposta não existe mais.',
  ja_respondida: 'Alguém já respondeu essa.',
  expirada: 'Essa proposta venceu. Peça para ele propor de novo.',
  sem_permissao: 'Você não tem permissão para confirmar esta ação.',
  falhou: 'A ação não foi concluída. Nada foi gravado.',
}

/** "em 6h", "em 2 dias". Prazo em relógio, não em data — é o que importa aqui. */
function daqui(iso: string): string {
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3600_000)
  if (h <= 0) return 'agora'
  if (h < 24) return `em ${h}h`
  return `em ${Math.round(h / 24)} dia(s)`
}
