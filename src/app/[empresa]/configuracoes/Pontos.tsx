'use client'

// O programa de pontos, do lado de quem decide o tamanho dele.
//
// ── por que a conta aparece enquanto se digita ───────────────
// Os dois números sozinhos não dizem nada: "1 ponto por real" e "R$ 0,10 por
// ponto" parecem modestos e são 10% de desconto em tudo que a loja vender —
// mais que a margem de muita peça. Ninguém assina 10% de propósito; assina
// porque os números não pareciam grandes.
//
// Então a tela responde na hora, em porcento e em reais sobre o faturamento
// que a loja já tem. É a diferença entre configurar e escolher.

import { useActionState, useState } from 'react'
import { Botao, Campo, Marcar, Aviso, Situacao } from '@/ui/base'
import { quantoCusta } from '@/servidor/pontos'
import { salvarPontos, type EstadoPontos } from './acoes'

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function Pontos({
  empresa,
  inicial,
  faturamentoMes,
}: {
  empresa: string
  inicial: { ativo: boolean; porReal: number; pontoVale: number; minimo: number }
  faturamentoMes: number
}) {
  const [estado, agir, pendente] = useActionState<EstadoPontos, FormData>(salvarPontos, {})
  const [ativo, setAtivo] = useState(inicial.ativo)
  const [porReal, setPorReal] = useState(String(inicial.porReal))
  const [vale, setVale] = useState(String(inicial.pontoVale))

  const pct = quantoCusta({
    ativo: true,
    porReal: Number(porReal) || 0,
    pontoVale: Number(vale) || 0,
    minimo: 0,
  })
  const porMes = (faturamentoMes * pct) / 100

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <Marcar
        name="ativo"
        checked={ativo}
        onChange={(e) => setAtivo(e.currentTarget.checked)}
        titulo="Cliente junta pontos comprando"
        resumo="Desligado, nada muda no balcão. Pontos já juntos ficam guardados."
      />

      {ativo && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              rotulo="Pontos por R$ 1"
              name="porReal"
              inputMode="decimal"
              value={porReal}
              onChange={(e) => setPorReal(e.currentTarget.value)}
              dica="Quem gasta R$ 100 ganha isto vezes 100."
            />
            <Campo
              rotulo="Quanto vale 1 ponto"
              name="pontoVale"
              inputMode="decimal"
              value={vale}
              onChange={(e) => setVale(e.currentTarget.value)}
              dica="Em reais. 0,03 é o mais comum (R$ 3 a cada 100 pontos)."
            />
            <Campo
              rotulo="Mínimo para usar"
              name="minimo"
              inputMode="numeric"
              defaultValue={String(inicial.minimo)}
              dica="Sem mínimo, vira desconto em toda venda."
            />
          </div>

          {/* A conta. É o campo mais importante desta tela e não é editável. */}
          <div className="flex flex-col gap-1 rounded-norte border border-borda bg-superficie-2 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-tinta-2">Isto devolve ao cliente</span>
              <span className="numero text-2xl font-bold text-tinta">
                {pct.toFixed(2).replace('.', ',')}%
              </span>
            </div>
            <span className="text-xs text-tinta-3">
              de tudo que a loja vender. No seu último mês ({brl(faturamentoMes)}), seriam{' '}
              <strong className="text-tinta-2">{brl(porMes)}</strong> em desconto.
            </span>
            {pct > 5 && (
              <div className="pt-1">
                <Situacao nivel="critico">
                  acima de 5% costuma passar da margem de roupa
                </Situacao>
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-tinta-3">
          Mudar o valor do ponto não mexe no saldo de ninguém — muda só o que ele passa a
          valer daqui para frente.
        </p>
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
