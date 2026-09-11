'use client'

// Devolver ou trocar parte da venda.
//
// A ordem do formulário é a ordem da conversa no balcão: O QUE está voltando
// (quanto de cada item), PARA ONDE vai o valor (vale, dinheiro, estorno), e
// POR QUÊ. O vale é o destino padrão porque é o que a loja prefere — o
// dinheiro fica na loja — e porque é o único que qualquer pessoa do balcão
// pode fazer sozinha.
//
// O resultado fica na tela, grande, com o código do vale: é o que a pessoa
// vai copiar no papel para o cliente levar.

import { useActionState, useState } from 'react'
import { Botao, Campo, Aviso, Marcar, cx } from '@/ui/base'
import { brl } from '@/ui/painel'
import { devolverAcao, type EstadoDevolucao } from './acoes'

export type ItemDevolvivel = {
  id: string
  descricao: string
  medida: string
  /** Quanto ainda pode voltar. */
  restante: number
  precoUnit: number
}

export function Devolver({
  slug,
  vendaId,
  numero,
  itens,
  podeDinheiro,
}: {
  slug: string
  vendaId: string
  numero: number
  itens: ItemDevolvivel[]
  /** Dinheiro e estorno são para quem pode cancelar venda. */
  podeDinheiro: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [qtds, setQtds] = useState<Record<string, number>>({})
  const [estado, agir, pendente] = useActionState<EstadoDevolucao, FormData>(devolverAcao, {})

  if (estado.ok) {
    return (
      <div className="flex flex-col gap-2 rounded-norte border border-bom-borda bg-bom-fundo px-4 py-3">
        <p className="text-sm font-bold text-bom">
          Devolução registrada: {brl(estado.ok.valor)}. O estoque voltou.
        </p>
        {estado.ok.vale && (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] text-tinta-2">
              Anote o código do vale para a pessoa. Ele paga qualquer venda no balcão até{' '}
              {estado.ok.vale.validade}.
            </p>
            <p className="numero self-start rounded-norte border border-borda bg-superficie px-4 py-2 font-mono text-2xl font-bold tracking-[0.15em] text-tinta">
              {estado.ok.vale.codigo}
            </p>
          </div>
        )}
      </div>
    )
  }

  const total = itens.reduce((s, i) => s + (qtds[i.id] ?? 0) * i.precoUnit, 0)

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-sm font-medium text-marca underline-offset-2 hover:underline"
      >
        Devolver ou trocar itens desta venda
      </button>
    )
  }

  return (
    <form action={agir} className="flex flex-col gap-4 rounded-norte border border-borda bg-superficie p-4">
      <input type="hidden" name="empresa" value={slug} />
      <input type="hidden" name="venda" value={vendaId} />

      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-tinta">O que está voltando da venda {numero}?</p>
        <p className="text-[13px] text-tinta-2">
          O valor devolvido é o que a pessoa pagou pela peça — com o desconto da venda, se houve.
        </p>
      </div>

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <ul className="flex flex-col divide-y divide-borda-suave">
        {itens.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-tinta">{i.descricao}</span>
              <span className="text-xs text-tinta-3">
                {brl(i.precoUnit)} · pode voltar até {i.restante}
              </span>
            </span>
            <label className="flex shrink-0 items-center gap-2 text-xs text-tinta-2">
              voltando
              <input
                type="number"
                name={`qtd-${i.id}`}
                min={0}
                max={i.restante}
                step={i.medida === 'UN' ? 1 : 0.001}
                defaultValue={0}
                onChange={(e) => setQtds((q) => ({ ...q, [i.id]: Math.min(Number(e.target.value) || 0, i.restante) }))}
                className="numero w-20 rounded border border-borda bg-superficie px-2 py-1 text-sm text-tinta"
              />
            </label>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-borda pt-2 text-sm">
        <span className="text-tinta-2">Volta para a pessoa, no máximo</span>
        <span className="numero font-bold text-tinta">{brl(total)}</span>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-tinta">Para onde vai o valor</legend>
        <div className={cx('grid gap-2', podeDinheiro ? 'sm:grid-cols-3' : '')}>
          <Marcar
            type="radio"
            name="destino"
            value="VALE"
            defaultChecked
            titulo="Vale de troca"
            resumo="A pessoa leva um código e gasta em outra compra. O dinheiro fica na loja."
          />
          {podeDinheiro && (
            <>
              <Marcar
                type="radio"
                name="destino"
                value="DINHEIRO"
                titulo="Dinheiro da gaveta"
                resumo="Sai do caixa aberto agora, como sangria, para o fechamento bater."
              />
              <Marcar
                type="radio"
                name="destino"
                value="ESTORNO"
                titulo="Estorno por fora"
                resumo="Cartão ou Pix devolvido pela maquininha ou pelo banco. Aqui só fica anotado."
              />
            </>
          )}
        </div>
      </fieldset>

      <Campo
        rotulo="Motivo"
        name="motivo"
        required
        minLength={3}
        placeholder="Não serviu, defeito, trocou pela cor azul"
      />

      <div className="flex gap-2">
        <Botao type="submit" tom="confirmar" carregando={pendente} disabled={total <= 0}>
          {pendente ? 'Registrando...' : 'Registrar devolução'}
        </Botao>
        <Botao type="button" tom="secundario" onClick={() => setAberto(false)}>
          Deixar como está
        </Botao>
      </div>
    </form>
  )
}
