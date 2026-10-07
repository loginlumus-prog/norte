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
// o que importa: o TOTAL da venda, o preço, o botão "Pagar". No telefone a
// pessoa via o número da venda e a loja, e nunca o valor. Por isso, no quadro
// estreito, cada linha vira um CARTÃO (`empilhar`, ligado por padrão): a
// primeira coluna (ou a `tituloDoCartao`) é o título, as de `destaque` sobem para o lado dele em letra
// maior, e as outras viram "rótulo … valor". É o QUADRO que decide, e não a
// tela: o mesmo notebook tem 800px de conteúdo com o menu aberto e 1000px com
// ele recolhido. As regras moram em globals.css (`.empilha`), para servir
// também às tabelas escritas à mão.

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
  /**
   * O valor que a linha existe para mostrar (o total, o preço, o botão de
   * pagar). No cartão do celular ele sobe para o lado do título, maior.
   * Se nenhuma coluna diz nada, vale a ÚLTIMA coluna de número — quase
   * sempre o total; `destaque: false` em qualquer coluna desliga o palpite.
   */
  destaque?: boolean
  /**
   * A coluna que dá nome ao cartão do celular. Sem nenhuma marcada, é a
   * primeira — mas na lista de contas a primeira é a data, e o cartão tem de
   * se chamar pelo lançamento.
   */
  tituloDoCartao?: boolean
  celula: (linha: L) => ReactNode
}

/**
 * Quando a linha vira cartão:
 * - `'celular'` (padrão): quadro com menos de 32rem — o telefone, e o meio
 *   quadro de um tablet;
 * - `true`: quadro com menos de 42rem — para a tabela larga cuja última
 *   coluna é um botão (as mensalidades);
 * - `false`: nunca. Para a tabela que se lê comparando colunas, onde rolar de
 *   lado é melhor que perder o alinhamento.
 */
export type Empilhar = boolean | 'celular'

/** A classe do quadro: `empilha`/`empilha-largo` (globals.css) ou nada. */
export const classeEmpilhar = (e: Empilhar) =>
  e === 'celular' ? 'empilha' : e ? 'empilha-largo' : undefined

export function Tabela<L>({
  colunas,
  linhas,
  chave,
  vazio = 'Nada por aqui ainda.',
  aoClicar,
  empilhar = 'celular',
}: {
  colunas: Coluna<L>[]
  linhas: L[]
  chave: (linha: L) => string
  vazio?: ReactNode
  aoClicar?: (linha: L) => void
  empilhar?: Empilhar
}) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-norte border border-borda bg-superficie px-4 py-10 text-center text-sm text-tinta-2">
        {vazio}
      </div>
    )
  }

  const titulo = Math.max(0, colunas.findIndex((c) => c.tituloDoCartao))
  const palpite = colunas.some((c) => c.destaque !== undefined) ? -1 : colunas.findLastIndex((c, i) => c.numero && i !== titulo)
  const destaque = (c: Coluna<L>, i: number) => c.destaque === true || i === palpite

  return (
    <div className={cx('tabela-viva relative overflow-x-auto rounded-2xl border border-borda bg-superficie', classeEmpilhar(empilhar))}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                scope="col"
                style={c.largura ? { width: c.largura } : undefined}
                className={cx(
                  'sticky top-0 z-10 border-b border-borda bg-superficie-2 px-2.5 py-2.5 sm:px-3.5',
                  'text-[12.5px] font-bold tracking-[0.06em] text-tinta-3 uppercase',
                  c.numero ? 'text-right' : 'text-left',
                  c.escondeNoCelular && 'hidden sm:table-cell',
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
                'linha-viva border-b border-borda-suave last:border-0',
                aoClicar && 'cursor-pointer',
              )}
            >
              {colunas.map((c, i) => (
                <td
                  key={c.chave}
                  // O cartão do celular lê o nome da coluna daqui.
                  data-rotulo={c.titulo || undefined}
                  data-titulo={i === titulo || undefined}
                  data-destaque={destaque(c, i) || undefined}
                  // 10px de lado no celular, e não 12: quatro colunas
                  // ganham 16px, que é o que separava a lista de Vendas de
                  // caber inteira num telefone sem rolar de lado.
                  className={cx(
                    'px-2.5 py-3 align-middle text-tinta sm:px-3.5',
                    c.numero && 'numero',
                    c.escondeNoCelular && 'hidden sm:table-cell',
                  )}
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
