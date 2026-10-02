// O cabeçalho e os itens de um pedido da loja à fábrica, só para ler — o
// mesmo desenho na tela da fábrica e na da loja, para as duas conversarem
// sobre o mesmo papel.
//
// Depois do envio, cada item mostra o que foi, o que chegou e a DIFERENÇA: é
// a linha que a dona procura quando a loja reclama que veio menos.

import type { ReactNode } from 'react'
import { Situacao, cx, type Nivel } from '@/ui/base'
import { quantidade } from '@/ui/texto'
import type { PedidoNaTela } from '@/servidor/fabrica'
import { quando } from './formato'

export const SITUACAO_PEDIDO: Record<PedidoNaTela['situacao'], { rotulo: string; nivel: Nivel }> = {
  ABERTO: { rotulo: 'esperando a fábrica', nivel: 'atencao' },
  ENVIADO: { rotulo: 'a caminho — falta conferir', nivel: 'atencao' },
  RECEBIDO: { rotulo: 'recebido', nivel: 'bom' },
  CANCELADO: { rotulo: 'cancelado', nivel: 'neutro' },
}

export function CabecalhoDoPedido({ p, acao }: { p: PedidoNaTela; acao?: ReactNode }) {
  // Aberto com parte já mandada: a remessa parcial deixa o pedido esperando o resto.
  const emParte = p.situacao === 'ABERTO' && p.itens.some((i) => (i.enviada ?? 0) > 0)
  const s = emParte ? { rotulo: 'parte já foi — esperando o resto', nivel: 'atencao' as Nivel } : SITUACAO_PEDIDO[p.situacao]
  const passos = [
    `pedido ${quando(p.criadoEm)} por ${p.pedidoPor}`,
    p.enviadoEm && `mandado ${quando(p.enviadoEm)}${p.enviadoPor ? ` por ${p.enviadoPor}` : ''}`,
    p.recebidoEm && `conferido ${quando(p.recebidoEm)}${p.recebidoPor ? ` por ${p.recebidoPor}` : ''}`,
  ].filter(Boolean)
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-tinta-3">Pedido {p.numero}</span>
          <span className="font-semibold text-tinta">
            {p.loja} <span className="font-normal text-tinta-3">←</span> {p.fabrica}
          </span>
          <Situacao nivel={s.nivel}>{s.rotulo}</Situacao>
        </span>
        <span className="text-xs text-tinta-3">{passos.join(' · ')}</span>
        {p.observacao && <span className="text-xs text-tinta-2">“{p.observacao}”</span>}
      </div>
      {acao}
    </header>
  )
}

/** Os itens de um pedido já mandado (ou recebido): pedido, foi, chegou, diferença. */
export function ItensDoPedido({ p }: { p: PedidoNaTela }) {
  const mandado = p.situacao === 'ENVIADO' || p.situacao === 'RECEBIDO' || p.itens.some((i) => (i.enviada ?? 0) > 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-tinta-3">
            <th className="py-1.5 pr-3 font-medium">Item</th>
            <th className="py-1.5 pr-3 text-right font-medium">Pedido</th>
            {mandado && <th className="py-1.5 pr-3 text-right font-medium">Foi</th>}
            {p.situacao === 'RECEBIDO' && <th className="py-1.5 pr-3 text-right font-medium">Chegou</th>}
            {p.situacao === 'RECEBIDO' && <th className="py-1.5 pr-3 text-right font-medium">Diferença</th>}
            {mandado && <th className="py-1.5 font-medium">Lote</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-borda-suave">
          {p.itens.map((i) => {
            const falta = i.enviada != null && i.recebida != null ? Math.round((i.enviada - i.recebida) * 1000) / 1000 : 0
            return (
              <tr key={i.id}>
                <td className="py-1.5 pr-3 text-tinta">{i.nome}</td>
                <td className="numero py-1.5 pr-3 text-right text-tinta-2">{quantidade(i.pedida, i.medida)}</td>
                {mandado && (
                  <td className={cx('numero py-1.5 pr-3 text-right', i.enviada != null && i.enviada < i.pedida ? 'text-atencao' : 'text-tinta')}>
                    {i.enviada == null ? '—' : quantidade(i.enviada, i.medida)}
                  </td>
                )}
                {p.situacao === 'RECEBIDO' && (
                  <td className="numero py-1.5 pr-3 text-right text-tinta">{i.recebida == null ? '—' : quantidade(i.recebida, i.medida)}</td>
                )}
                {p.situacao === 'RECEBIDO' && (
                  <td className={cx('numero py-1.5 pr-3 text-right', falta > 0 ? 'font-semibold text-critico' : falta < 0 ? 'font-semibold text-atencao' : 'text-tinta-3')}>
                    {falta > 0 ? `faltou ${quantidade(falta, i.medida)}` : falta < 0 ? `veio ${quantidade(-falta, i.medida)} a mais` : 'ok'}
                  </td>
                )}
                {mandado && <td className="py-1.5 font-mono text-xs text-tinta-3">{i.lote ?? '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
