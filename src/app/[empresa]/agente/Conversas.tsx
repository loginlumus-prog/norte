// As últimas conversas: o que ele disse, para quem, e quando.
//
// É a tela de conferência. O dono não lê isto todo dia — lê no dia em que um
// cliente reclama "o robô me disse tal coisa", e aí precisa achar em dez
// segundos. Por isso a conversa aparece inteira (as últimas mensagens), e não
// só a última frase.

import { Cartao, Situacao, Vazio } from '@/ui/base'
import type { ConversaNaTela } from '@/servidor/assistente/conexao'

const hora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function Conversas({ itens, nome }: { itens: ConversaNaTela[]; nome: string }) {
  return (
    <Cartao titulo="Últimas conversas">
      {itens.length === 0 ? (
        <Vazio>Nenhuma conversa ainda. Quando alguém mandar mensagem para a loja, aparece aqui.</Vazio>
      ) : (
        <ul className="flex flex-col">
          {itens.map((c) => (
            <li key={c.id} className="border-b border-borda-suave py-3 last:border-0">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <b className="text-tinta">{c.quem}</b>
                  <span className="text-xs text-tinta-3">{c.telefone}</span>
                  <Situacao nivel={c.daEquipe ? 'bom' : 'neutro'}>{c.daEquipe ? 'equipe' : 'cliente'}</Situacao>
                  <span className="ml-auto text-xs text-tinta-3">{hora(c.ultimaEm)}</span>
                </summary>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {c.mensagens.map((m, i) => (
                    <li key={i} className={m.de === 'PESSOA' ? 'text-sm text-tinta' : 'text-sm text-tinta-2'}>
                      <span className="mr-2 text-xs font-semibold text-tinta-3">
                        {m.de === 'PESSOA' ? c.quem.split(' ')[0] : nome} · {hora(m.em)}
                      </span>
                      <span className="whitespace-pre-line">{m.texto}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  )
}
