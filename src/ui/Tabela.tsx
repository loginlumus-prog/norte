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
//
// Rolar de lado, porém, esconde a ÚLTIMA coluna — e é nela que costuma morar
// o botão. Nas mensalidades era o "Receber": com o menu aberto num notebook,
// a coluna ficava atrás da rolagem e a secretaria nem sabia que ela existia.
// Por isso `empilhar`: quando o QUADRO (não a janela) fica estreito, cada
// linha vira um cartão, com o nome da coluna ao lado de cada valor. É o
// quadro que decide, e não a tela: o mesmo notebook tem 800px de conteúdo com
// o menu aberto e 1000px com ele recolhido.

import type { ReactNode } from 'react'
import { cx } from './base'

export type Coluna<L> = {
  chave: string
  titulo: string
  /** Alinha à direita e alinha os dígitos. Para dinheiro e quantidade. */
  numero?: boolean
  largura?: string
  /**
   * Coluna de apoio, que some abaixo de `sm`. Serve para a tabela caber no
   * telefone sem esconder o que importa atrás da rolagem lateral — quem usa
   * isto precisa levar o recado da coluna para outra célula no celular.
   */
  escondeNoCelular?: boolean
  celula: (linha: L) => ReactNode
}

export function Tabela<L>({
  colunas,
  linhas,
  chave,
  vazio = 'Nada por aqui ainda.',
  aoClicar,
  empilhar = false,
}: {
  colunas: Coluna<L>[]
  linhas: L[]
  chave: (linha: L) => string
  vazio?: ReactNode
  aoClicar?: (linha: L) => void
  /** Quadro estreito (menos de 42rem): cada linha vira um cartão, sem rolar de lado. */
  empilhar?: boolean
}) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-norte border border-borda bg-superficie px-4 py-10 text-center text-sm text-tinta-2">
        {vazio}
      </div>
    )
  }

  return (
    <div className={cx('relative overflow-x-auto rounded-norte border border-borda bg-superficie', empilhar && '@container')}>
      <table className={cx('w-full border-collapse text-sm', empilhar && '@max-2xl:block')}>
        <thead className={cx(empilhar && '@max-2xl:hidden')}>
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                scope="col"
                style={c.largura ? { width: c.largura } : undefined}
                className={cx(
                  'sticky top-0 z-10 border-b border-borda bg-superficie-2 px-2.5 py-2 sm:px-3',
                  'text-xs font-semibold tracking-wide text-tinta-3 uppercase',
                  c.numero ? 'text-right' : 'text-left',
                  c.escondeNoCelular && 'hidden sm:table-cell',
                )}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={cx(empilhar && '@max-2xl:block')}>
          {linhas.map((l) => (
            <tr
              key={chave(l)}
              onClick={aoClicar ? () => aoClicar(l) : undefined}
              className={cx(
                'border-b border-borda-suave last:border-0',
                aoClicar && 'cursor-pointer hover:bg-superficie-2',
                empilhar && '@max-2xl:block @max-2xl:py-2',
              )}
            >
              {colunas.map((c, i) => (
                <td
                  key={c.chave}
                  // 10px de lado no celular, e não 12: quatro colunas
                  // ganham 16px, que é o que separava a lista de Vendas de
                  // caber inteira num telefone sem rolar de lado.
                  className={cx(
                    'px-2.5 py-2 align-top text-tinta sm:px-3',
                    c.numero && 'numero',
                    c.escondeNoCelular && 'hidden sm:table-cell',
                    // Empilhada: a primeira coluna é o título do cartão; as
                    // outras, "rótulo … valor" numa linha, com o valor à
                    // direita — onde o botão fica ao alcance do polegar.
                    empilhar &&
                      (i === 0
                        ? '@max-2xl:block @max-2xl:pb-1'
                        : '@max-2xl:flex @max-2xl:items-start @max-2xl:justify-between @max-2xl:gap-3 @max-2xl:py-1'),
                  )}
                >
                  {empilhar && i > 0 && c.titulo && (
                    <span className="hidden shrink-0 pt-0.5 text-left font-sans text-xs font-semibold tracking-wide text-tinta-3 uppercase @max-2xl:block">
                      {c.titulo}
                    </span>
                  )}
                  {empilhar && i > 0 ? <div className="@max-2xl:ml-auto @max-2xl:text-right">{c.celula(l)}</div> : c.celula(l)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
