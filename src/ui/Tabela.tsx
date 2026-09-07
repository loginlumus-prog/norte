// Tabela densa — a peça central de um sistema de gestão.
//
// Duas decisões que vêm do balcão, não do gosto:
//
// 1. Linha fina e fonte pequena. Quem confere estoque quer ver 30 itens de uma
//    vez, não 8. Densidade aqui é função, não estética.
// 2. O cabeçalho gruda no topo ao rolar. Sem isso, na linha 40 ninguém lembra
//    qual coluna é qual e a conferência vira adivinhação.
//
// A tabela SEMPRE rola dentro do próprio quadro. A página nunca rola de lado —
// barra horizontal na página inteira é o jeito mais rápido de perder o menu.

import type { ReactNode } from 'react'
import { cx } from './base'

export type Coluna<L> = {
  chave: string
  titulo: string
  /** Alinha à direita e alinha os dígitos. Para dinheiro e quantidade. */
  numero?: boolean
  largura?: string
  celula: (linha: L) => ReactNode
}

export function Tabela<L>({
  colunas,
  linhas,
  chave,
  vazio = 'Nada por aqui ainda.',
  aoClicar,
}: {
  colunas: Coluna<L>[]
  linhas: L[]
  chave: (linha: L) => string
  vazio?: ReactNode
  aoClicar?: (linha: L) => void
}) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-norte border border-borda bg-superficie px-4 py-10 text-center text-sm text-tinta-2">
        {vazio}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-norte border border-borda bg-superficie">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                scope="col"
                style={c.largura ? { width: c.largura } : undefined}
                className={cx(
                  'sticky top-0 z-10 border-b border-borda bg-superficie-2 px-3 py-2',
                  'text-xs font-semibold tracking-wide text-tinta-3 uppercase',
                  c.numero ? 'text-right' : 'text-left',
                )}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr
              key={chave(l)}
              onClick={aoClicar ? () => aoClicar(l) : undefined}
              className={cx(
                'border-b border-borda-suave last:border-0',
                aoClicar && 'cursor-pointer hover:bg-superficie-2',
              )}
            >
              {colunas.map((c) => (
                <td
                  key={c.chave}
                  className={cx('px-3 py-2 align-top text-tinta', c.numero && 'numero')}
                >
                  {c.celula(l)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
