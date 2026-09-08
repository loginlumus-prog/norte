'use client'

// A carteira de crédito de IA.
//
// ── por que é carteira, e não uma linha da mensalidade ───────
// O custo de IA é o único que varia com o uso de CADA cliente: uma loja que
// conversa o dia inteiro no WhatsApp gasta dez vezes o de outra do mesmo
// tamanho. Embutido na mensalidade, o cliente pequeno pagaria o risco do
// grande — e a gente teria que precificar pelo pior caso, o que encarece o
// plano para todo mundo.
//
// Separado, cada um paga o que usa, e o teto é do cliente.
//
// ── por que mostrar quanto DURA, e não só o saldo ────────────
// "R$ 12,40" não diz nada para quem nunca comprou token na vida. "Cerca de 9
// dias no seu ritmo" diz — e é a diferença entre recarregar antes e descobrir
// que o assistente parou porque um cliente reclamou.

import { useActionState } from 'react'
import { Botao, Aviso, Campo } from '@/ui/base'
import { recarregar, type EstadoAssinatura } from './acoes'

const brl = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const ATALHOS = [20, 50, 100, 200]

export function Credito({
  slug,
  saldoCent,
  gasto30Cent,
  diasQueDura,
  inclusoMensal,
  podeMexer,
}: {
  slug: string
  saldoCent: number
  gasto30Cent: number
  diasQueDura: number | null
  inclusoMensal: number
  podeMexer: boolean
}) {
  const acao = recarregar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoAssinatura, FormData>(acao, {})

  const acabou = saldoCent <= 0
  const tom = acabou ? 'text-critico' : saldoCent <= 1000 ? 'text-atencao' : 'text-tinta'

  return (
    <div className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-tinta-3">Saldo agora</span>
          <span className={`numero text-3xl font-bold tracking-tight ${tom}`}>
            {brl(saldoCent)}
          </span>
          <span className="text-xs text-tinta-2">
            {acabou
              ? 'o assistente está parado'
              : diasQueDura !== null
                ? `cerca de ${diasQueDura} dia(s) no seu ritmo`
                : 'ainda sem consumo para estimar'}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-tinta-3">Gasto em 30 dias</span>
          <span className="numero text-2xl font-bold text-tinta">{brl(gasto30Cent)}</span>
          <span className="text-xs text-tinta-2">
            {brl(Math.round(gasto30Cent / 30))} por dia, na média
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-tinta-3">O plano já inclui</span>
          <span className="numero text-2xl font-bold text-tinta">
            {inclusoMensal > 0
              ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                  inclusoMensal,
                )
              : '—'}
          </span>
          <span className="text-xs text-tinta-2">
            {inclusoMensal > 0 ? 'por mês, renovado no ciclo' : 'seu plano não tem assistente'}
          </span>
        </div>
      </div>

      {podeMexer && inclusoMensal > 0 && (
        <form action={agir} className="flex flex-col gap-2 border-t border-borda-suave pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Campo
                rotulo="Colocar crédito"
                name="valor"
                inputMode="decimal"
                placeholder="50,00"
                dica="Em reais."
              />
            </div>
            <Botao type="submit" carregando={pendente}>
              {pendente ? 'Adicionando...' : 'Adicionar'}
            </Botao>
          </div>
          {/* Atalhos porque quase ninguém digita valor quebrado aqui. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-tinta-3">valores comuns:</span>
            {ATALHOS.map((v) => (
              <button
                key={v}
                type="submit"
                name="valor"
                value={String(v)}
                className="rounded-norte border border-borda bg-superficie px-2.5 py-1 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
              >
                R$ {v}
              </button>
            ))}
          </div>
          <p className="text-xs text-tinta-3">
            Enquanto o pagamento automático não entra, a recarga é lançada aqui e fica
            registrada com o seu nome.
          </p>
        </form>
      )}
    </div>
  )
}
