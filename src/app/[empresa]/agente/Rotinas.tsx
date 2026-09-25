'use client'

// O que ele faz sozinho, e a chave de cada coisa.
//
// Ligado por padrão, porque é o que o plano vende. A chave existe porque
// relatório que a pessoa não quer vira mensagem que ela silencia — e aí ela
// silencia também o aviso de ruptura, que é o que dá dinheiro.

import { useActionState } from 'react'
import { Aviso, Botao, Campo, Cartao, Marcar } from '@/ui/base'
import type { GatilhoNaTela } from '@/servidor/assistente/conexao'
import { salvarRotinas, type EstadoAgente } from './acoes'

export function Rotinas({
  slug,
  rotinas,
  itens,
}: {
  slug: string
  rotinas: { tipo: string; titulo: string; resumo: string }[]
  itens: GatilhoNaTela[]
}) {
  const [estado, agir, pendente] = useActionState<EstadoAgente, FormData>(salvarRotinas.bind(null, slug), {})
  const sumido = itens.find((i) => i.tipo === 'CLIENTE_SUMIDO')

  return (
    <Cartao titulo="O que faz sozinho">
      <form action={agir} className="flex max-w-3xl flex-col gap-3">
        {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
        {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
        {rotinas.map((r) => {
          const g = itens.find((i) => i.tipo === r.tipo)
          const ultima = g?.ultimoDisparo ? new Date(g.ultimoDisparo).toLocaleString('pt-BR') : null
          return (
            <Marcar
              key={r.tipo}
              name={`rotina_${r.tipo}`}
              defaultChecked={g?.ativo ?? true}
              titulo={r.titulo}
              resumo={ultima ? `${r.resumo} Última vez: ${ultima}.` : r.resumo}
            />
          )
        })}
        <div className="max-w-56">
          <Campo
            rotulo="Sumido depois de quantos dias sem comprar"
            name="dias_CLIENTE_SUMIDO"
            type="number"
            min={7}
            max={365}
            defaultValue={sumido?.dias ?? 45}
          />
        </div>
        <div>
          <Botao type="submit" carregando={pendente}>
            Salvar rotinas
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}
