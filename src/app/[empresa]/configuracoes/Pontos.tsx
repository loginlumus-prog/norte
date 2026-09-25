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

//
// ── fora do plano ────────────────────────────────────────────
// O programa é dos planos pagos, e o servidor recusa ligar no Grátis
// (`salvarPontos`). Então no Grátis a tela não oferece a caixa: mostra o
// programa trancado, com o plano que abre e o caminho para os planos. Quem
// DESCEU de plano com o programa ligado ainda vê a caixa — só para desligar,
// que o servidor aceita em qualquer plano.

import Link from 'next/link'
import { useActionState, useState } from 'react'
import type { Plano } from '@prisma/client'
import { Botao, Campo, Marcar, Aviso, Situacao } from '@/ui/base'
import { IconeCadeado } from '@/ui/Cadeado'
import { quantoCusta } from '@/servidor/pontos'
import { doPlano, liberado, planoQueAbre } from '@/servidor/planos'
import { salvarPontos, type EstadoPontos } from './acoes'

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function Pontos({
  empresa,
  inicial,
  faturamentoMes,
  plano,
}: {
  empresa: string
  inicial: { ativo: boolean; porReal: number; pontoVale: number; minimo: number }
  faturamentoMes: number
  /** O plano de agora: fora dele o programa aparece trancado. */
  plano: Plano
}) {
  const [estado, agir, pendente] = useActionState<EstadoPontos, FormData>(salvarPontos, {})
  const [ativo, setAtivo] = useState(inicial.ativo)
  // Vírgula, não ponto: "0.03" é número de programador, e a dica logo abaixo
  // fala em "0,03". A ação já aceita os dois.
  const [porReal, setPorReal] = useState(String(inicial.porReal).replace('.', ','))
  const [vale, setVale] = useState(String(inicial.pontoVale).replace('.', ','))
  const num = (v: string) => Number(v.replace(',', '.')) || 0
  const aberto = liberado(plano, 'pontos.programa')
  const quemAbre = doPlano(planoQueAbre('pontos.programa').codigo)

  // Fora do plano e desligado: nada a marcar, nada a salvar — só o convite.
  if (!aberto && !inicial.ativo) {
    return (
      <div className="flex items-start gap-3 rounded-norte border border-dashed border-borda bg-superficie-2/60 p-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-marca-suave text-marca">
          <IconeCadeado className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-semibold text-tinta">
            O programa de pontos é {quemAbre} para cima
          </span>
          <span className="text-xs leading-relaxed text-tinta-2">
            O cliente junta pontos a cada compra e troca por desconto no balcão — o motivo de
            ele voltar à sua loja e não à do lado.
          </span>
          <Link
            href={`/${empresa}/assinatura`}
            className="mt-1 w-fit text-xs font-semibold text-marca underline-offset-2 hover:underline"
          >
            Ver os planos
          </Link>
        </span>
      </div>
    )
  }

  const pct = quantoCusta({
    ativo: true,
    porReal: num(porReal),
    pontoVale: num(vale),
    minimo: 0,
  })
  const porMes = (faturamentoMes * pct) / 100

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      {!aberto && (
        <Aviso nivel="atencao">
          O programa de pontos é {quemAbre} para cima e ficou ligado de um plano anterior. Você
          pode desligar aqui; para mudar os valores, <Link href={`/${empresa}/assinatura`} className="font-semibold underline">veja os planos</Link>.
        </Aviso>
      )}

      <Marcar
        name="ativo"
        checked={ativo}
        // Fora do plano a caixa só DESLIGA: marcar de novo o servidor recusa.
        disabled={!aberto && !ativo}
        onChange={(e) => setAtivo(e.currentTarget.checked)}
        titulo="Cliente junta pontos comprando"
        resumo="Desligado, nada muda no balcão. Pontos já juntos ficam guardados."
      />

      {/* Desligado, os campos somem da tela mas os valores VÃO junto: a
          ação grava o que chega, e sem isto desligar zerava o desenho do
          programa — religar era digitar tudo de novo. */}
      {!(ativo && aberto) && (
        <>
          <input type="hidden" name="porReal" value={porReal} />
          <input type="hidden" name="pontoVale" value={vale} />
          <input type="hidden" name="minimo" value={String(inicial.minimo)} />
        </>
      )}

      {ativo && aberto && (
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
