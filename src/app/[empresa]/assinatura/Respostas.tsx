'use client'

// As respostas do assistente no mês.
//
// ── por que respostas, e não reais ───────────────────────────
// "R$ 12,40 de crédito de IA" não dizia nada a quem nunca comprou token na
// vida: durava um dia ou um mês? "Faltam 640 de 1.000 respostas" diz. O
// dinheiro continua por baixo, como trava nossa de custo (planos.ts) — o que a
// loja lê, decide e compra é resposta.
//
// O número grande diz quanto FALTA (é a pergunta de quem abre); a barra diz
// quanto já foi, contra o total do mês — a franquia mais os pacotes.

import { useActionState } from 'react'
import { Botao, Aviso } from '@/ui/base'
import { comprarPacote, type EstadoAssinatura } from './acoes'
import { Pagamento, CampoDocumento } from './Pagamento'

const n = (v: number) => v.toLocaleString('pt-BR')
const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const dia = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date(iso))

export function Respostas({
  slug,
  total,
  usadas,
  restam,
  pacotes,
  periodo,
  renovaEm,
  opcoes,
  podeComprar,
  pedidoAberto,
}: {
  slug: string
  /** Franquia + pacotes. `null` = combinado em contrato. */
  total: number | null
  usadas: number
  restam: number | null
  pacotes: number
  periodo: 'mes' | 'teste'
  /** ISO do dia em que a franquia volta. `null` no teste. */
  renovaEm: string | null
  /** Os pacotes à venda: o pequeno e o grande (mais barato por resposta). */
  opcoes: { chave: string; respostas: number; preco: number }[]
  podeComprar: boolean
  /** Já há um pedido de pacote esperando a equipe: o botão não pede de novo. */
  pedidoAberto: boolean
}) {
  const acao = comprarPacote.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoAssinatura, FormData>(acao, {})

  if (total === null) {
    return (
      <div className="flex flex-col gap-1">
        <p className="numero text-2xl font-bold text-tinta">{n(usadas)}</p>
        <p className="text-xs text-tinta-3">respostas este mês · o volume é o combinado no contrato</p>
      </div>
    )
  }

  const acabou = restam === 0
  const pct = total > 0 ? Math.min(100, (usadas / total) * 100) : 0
  const baixo = !acabou && restam !== null && restam <= Math.ceil(total / 10)
  const tom = acabou ? 'text-critico' : baixo ? 'text-atencao' : 'text-tinta'

  return (
    <div className="flex flex-col gap-3">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
      <Pagamento estado={estado} />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <p className="flex items-baseline gap-2">
          <span className={`numero text-3xl font-bold tracking-tight ${tom}`}>{n(restam ?? 0)}</span>
          <span className="text-sm text-tinta-2">
            de <span className="numero">{n(total)}</span> respostas {periodo === 'teste' ? 'no teste' : 'este mês'}
          </span>
        </p>
        <p className="numero text-xs text-tinta-3">
          {n(usadas)} usadas
          {renovaEm ? ` · voltam em ${dia(renovaEm)}` : ''}
        </p>
      </div>

      <div
        className="h-2.5 overflow-hidden rounded-full bg-superficie-3"
        role="img"
        aria-label={`${n(usadas)} de ${n(total)} respostas usadas.`}
      >
        <div
          className={
            'h-full rounded-full transition-[width] ' +
            (acabou ? 'bg-critico-vivo' : baixo ? 'bg-atencao-vivo' : 'bg-bom-vivo')
          }
          style={{ width: `${Math.max(pct, usadas > 0 ? 2 : 0)}%` }}
        />
      </div>

      {pacotes > 0 && (
        <p className="text-xs text-tinta-3">
          Inclui {pacotes === 1 ? '1 pacote' : `${pacotes} pacotes`} de respostas comprado
          {pacotes === 1 ? '' : 's'} este mês.
        </p>
      )}

      {periodo === 'mes' && podeComprar && (
        <form action={agir} className="flex flex-wrap items-center gap-3 border-t border-borda-suave pt-3">
          {estado.pedirDocumento && <CampoDocumento />}
          {opcoes.map((o, i) => (
            <Botao
              key={o.chave}
              type="submit"
              name="pacote"
              value={o.chave}
              tom={i === 0 && (acabou || baixo) ? 'principal' : 'secundario'}
              carregando={pendente}
              disabled={pedidoAberto}
            >
              +{n(o.respostas)} respostas · {brl(o.preco)}
            </Botao>
          ))}
          <span className="text-xs text-tinta-3">
            {pedidoAberto ? 'pedido enviado, aguardando a equipe' : 'valem só para este mês'}
          </span>
        </form>
      )}

      <p className="text-xs leading-relaxed text-tinta-3">
        Conta cada mensagem que o assistente escreve com IA. Relatório, aviso e campanha não contam.
      </p>
    </div>
  )
}
