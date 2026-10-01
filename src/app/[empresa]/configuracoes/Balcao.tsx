'use client'

// As regras do balcão, do lado de quem decide.
//
// ── vender o que o sistema diz que acabou ────────────────────
// Desligado, o balcão trava a venda da peça sem saldo: é o certo para quem
// começou o estoque aqui, onde a conta é confiável. Ligado, avisa e deixa —
// é o certo para quem trouxe o estoque de outro sistema e ainda não fez
// balanço: a peça achada no provador está na mão da cliente, e travar o
// balcão por um número errado é perder a venda. Cada uma dessas vendas vai
// para "Vendido sem estoque — conferir", em Estoque.
//
// ── vale por loja ────────────────────────────────────────────
// Lojas com CNPJ próprio: o vale emitido numa não paga a venda da outra.

import { useActionState } from 'react'
import { Aviso, Botao, Campo, Marcar } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { salvarBalcaoAcao, type EstadoBalcao } from './acoesBalcao'

export function RegrasDoBalcao({
  empresa,
  inicial,
  variasLojas,
}: {
  empresa: string
  inicial: { vendeSemEstoque: boolean; valePorLoja: boolean; creditoMaxParcelas: number; creditoJurosPct: number }
  /** Com uma loja só, "vale por loja" não muda nada e não aparece. */
  variasLojas: boolean
}) {
  const [estado, agir, pendente] = useActionState<EstadoBalcao, FormData>(salvarBalcaoAcao, {})

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <Marcar
        name="vendeSemEstoque"
        defaultChecked={inicial.vendeSemEstoque}
        titulo="Vender o que o sistema diz que acabou"
        resumo="O balcão avisa e deixa vender; o estoque fica negativo e a peça vai para “Vendido sem estoque — conferir”, em Estoque. Ligue se o estoque veio de outro sistema e ainda não teve balanço."
      />
      {variasLojas && (
        <Marcar
          name="valePorLoja"
          defaultChecked={inicial.valePorLoja}
          titulo="Vale-troca só vale na loja que emitiu"
          resumo="Para lojas com CNPJ próprio. Vale emitido antes desta regra, sem loja, continua valendo em qualquer uma."
        />
      )}
      {!variasLojas && inicial.valePorLoja && <input type="hidden" name="valePorLoja" value="on" />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Crédito em até quantas vezes"
          name="creditoMaxParcelas"
          type="number"
          inputMode="numeric"
          min={1}
          max={24}
          defaultValue={String(inicial.creditoMaxParcelas)}
          dica="O balcão pergunta de 1× até isto quando a forma é crédito."
        />
        <Campo
          rotulo="Juro do parcelamento no crédito, %"
          name="creditoJurosPct"
          inputMode="decimal"
          defaultValue={String(inicial.creditoJurosPct).replace('.', ',')}
          dica="Zero = parcela sem juro (o comum). Vale de 2× para cima e soma no valor da maquininha."
        />
      </div>

      <div className="flex justify-end">
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
