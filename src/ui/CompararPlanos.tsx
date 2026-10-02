// A tabela item por item da página de venda.
//
// ── por que ela existe, se os cartões já resumem ─────────────
// Cartão vende, tabela decide. Quem está com um cartão quase escolhido tem UMA
// pergunta específica — "o crediário vem no Norte ou só com o assistente?" — e
// procurar isso em duas listas de bala é onde a pessoa desiste e vai perguntar
// no WhatsApp. A tabela responde sem ninguém do outro lado.
//
// ── e por que o dado vem do mesmo lugar do sistema ───────────
// `RECURSOS` em `servidor/planos.ts` é a MESMA lista que a tela de assinatura
// usa por dentro. Duas listas separadas divergem — e divergir aqui é prometer
// na venda o que o sistema não entrega, que é o pior lugar possível para uma
// inconsistência.
//
// ── só as colunas que se vendem ──────────────────────────────
// Desde a tabela de 02/10/2026 são duas: o Norte e o Norte + Assistente. O
// Grátis não se vende (é onde a empresa fica quando o teste acaba), o plano de
// contrato é dos primeiros clientes e o Corporativo é conversa — os três
// ficam fora da tabela, e linha que só existe neles (a implantação do
// Corporativo) some junto. Coluna de plano que não se pode comprar é ruído.
//
// ── `<table>` de verdade ─────────────────────────────────────
// Leitor de tela anuncia "Crediário próprio, Norte: tem", que é exatamente a
// informação. Num grid de divs ele lê "tem" solto, trinta vezes.
//
// ── e por que existe uma SEGUNDA forma, para tela estreita ───
// No celular a pergunta muda de forma. Em vez de "onde este item cruza com
// este plano", que precisa de duas dimensões, ela vira "isto vem no Norte ou
// só com o assistente?" — que é uma linha de texto e é a MESMA pergunta que a
// pessoa tem na cabeça. A tabela de verdade só aparece de 1024px para cima;
// abaixo disso vale a lista, em duas colunas a partir de 768px.
//
// A caixa da tabela é `relative`: os textos `sr-only` ("tem", "não tem") são
// `position: absolute`, e numa caixa sem posição eles escapavam e esticavam
// a PÁGINA de lado (aconteceu, entre 768 e ~960px). E sem caixa que rola, o
// cabeçalho com o nome dos planos pode GRUDAR no topo enquanto a pessoa desce
// as linhas: é a coluna que ela esquece primeiro.

import {
  PLANOS,
  PLANOS_COM_PRECO,
  RECURSOS,
  GRUPOS,
  RECOMENDADO,
  temRecurso,
  type Recurso,
} from '@/servidor/planos'
import type { Plano } from '@prisma/client'

// Sem centavos: preço de plano é número redondo, e "R$ 368,00/mês" numa
// coluna estreita de cabeçalho quebra linha à toa.
const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

const COLUNAS: readonly Plano[] = PLANOS_COM_PRECO

/** Só as linhas que existem em alguma coluna. */
const LINHAS = RECURSOS.filter((r) => COLUNAS.some((p) => temRecurso(r, p)))

/**
 * A resposta curta do celular: "Incluso no Norte" ou "Com o assistente".
 *
 * Lê da tabela em vez de supor: o recurso que existe no primeiro plano à venda
 * vem em todos (a escada sobe, não desce); o que só existe nos de cima é do
 * assistente, que é a única coisa que separa os dois.
 */
function ondeVem(r: Recurso): string {
  const [base] = COLUNAS
  if (base && temRecurso(r, base)) return `Incluso no ${PLANOS[base].titulo}`
  return 'Com o assistente'
}

function EmBreve() {
  return (
    <span className="ml-2 inline-block rounded-full bg-superficie-2 px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide whitespace-nowrap text-tinta-3 uppercase">
      em breve
    </span>
  )
}

export function CompararPlanos() {
  return (
    <>
      {/* ── celular e tablet: uma linha por item ── */}
      <dl className="flex flex-col md:grid md:grid-cols-2 md:gap-x-10 lg:hidden">
        {GRUPOS.map((grupo) => {
          const doGrupo = LINHAS.filter((r) => r.grupo === grupo)
          if (doGrupo.length === 0) return null
          return (
            <div key={grupo} className="flex flex-col">
              <p className="pt-7 pb-1 text-[10px] font-bold tracking-[0.16em] text-tinta-3 uppercase">
                {grupo}
              </p>
              {doGrupo.map((r) => {
                const comItem = COLUNAS.filter((p) => temRecurso(r, p))
                const detalhes = comItem.filter((p) => r.detalhe?.[p])
                // Detalhe igual em toda coluna que tem o item ("à vontade",
                // "completo") não compara nada: vira a frase curta, com o
                // detalhe junto. Só quando ele MUDA de um plano para o outro
                // vale a lista plano a plano.
                const variaPorPlano =
                  detalhes.length > 0 &&
                  (detalhes.length < comItem.length || new Set(detalhes.map((p) => r.detalhe![p])).size > 1)
                return (
                  <div key={r.titulo} className="flex flex-col gap-1 border-t border-borda-suave py-2.5">
                    <dt className="text-sm text-tinta">
                      {r.titulo}
                      {r.quando === 'breve' && <EmBreve />}
                    </dt>
                    <dd className="text-[13px] leading-snug text-tinta-2">
                      {variaPorPlano ? (
                        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {detalhes.map((p) => (
                            <span key={p} className="whitespace-nowrap">
                              <span className="text-tinta-3">{PLANOS[p].titulo}:</span>{' '}
                              <span className="font-semibold text-tinta">{r.detalhe![p]}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="font-semibold text-tinta">
                          {ondeVem(r)}
                          {detalhes.length > 0 && (
                            <span className="font-normal text-tinta-2"> · {r.detalhe![detalhes[0]!]}</span>
                          )}
                        </span>
                      )}
                    </dd>
                  </div>
                )
              })}
            </div>
          )
        })}
      </dl>

      {/* ── de 1024px para cima, a tabela de verdade ── */}
      <div className="relative hidden lg:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">O que vem no Norte e o que vem com o assistente, item por item.</caption>

          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-16 z-10 w-[52%] bg-fundo px-3 pt-3 pb-3 text-left align-bottom text-xs font-medium text-tinta-3"
              >
                O que está incluído
              </th>
              {COLUNAS.map((p) => (
                <th
                  key={p}
                  scope="col"
                  className={
                    'sticky top-16 z-10 border-b border-borda px-3 pt-3 pb-3 text-center align-bottom ' +
                    (p === RECOMENDADO ? 'rounded-t-norte bg-marca-suave' : 'bg-fundo')
                  }
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-bold tracking-tight text-tinta">{PLANOS[p].titulo}</span>
                    {p === RECOMENDADO && (
                      <span className="text-[10px] font-bold tracking-[0.1em] text-marca uppercase">
                        recomendado
                      </span>
                    )}
                    <span className="numero text-xs text-tinta-3">
                      {PLANOS[p].mensal !== null ? `${brl(PLANOS[p].mensal!)}/mês a 1ª loja` : 'sob consulta'}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          {GRUPOS.map((grupo) => {
            const doGrupo = LINHAS.filter((r) => r.grupo === grupo)
            if (doGrupo.length === 0) return null
            return (
              <tbody key={grupo}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={1 + COLUNAS.length}
                    className="px-3 pt-7 pb-1.5 text-left text-[10px] font-bold tracking-[0.16em] text-tinta-3 uppercase"
                  >
                    {grupo}
                  </th>
                </tr>
                {doGrupo.map((r) => (
                  <tr key={r.titulo} className="border-t border-borda-suave">
                    <th scope="row" className="px-3 py-2.5 text-left font-normal text-tinta-2">
                      {r.titulo}
                      {/* Marcar o que ainda não existe não é fraqueza da página,
                          é o que separa expectativa de mentira. Quem assina por
                          uma linha que não encontra depois cancela — e esse
                          cancelamento vem com reclamação pública junto. */}
                      {r.quando === 'breve' && <EmBreve />}
                    </th>
                    {COLUNAS.map((p) => {
                      const tem = temRecurso(r, p)
                      const detalhe = r.detalhe?.[p]
                      return (
                        <td
                          key={p}
                          className={'px-3 py-2.5 text-center ' + (p === RECOMENDADO ? 'bg-marca-suave/50' : '')}
                        >
                          {/* Número quando é quantitativo; símbolo quando é sim ou
                              não. E o texto invisível vai junto: quem não distingue
                              cor e o leitor de tela leem a mesma coisa. */}
                          {detalhe && tem ? (
                            // Sem `numero`: ele trava a quebra de linha, e "1
                            // incluída, +R$ 139 cada" precisa poder quebrar em
                            // vez de alargar a tabela.
                            <span className="text-xs font-semibold text-tinta tabular-nums">{detalhe}</span>
                          ) : tem ? (
                            <>
                              <span aria-hidden className="text-bom">
                                ✓
                              </span>
                              <span className="sr-only">tem</span>
                            </>
                          ) : (
                            <>
                              <span aria-hidden className="text-tinta-3 opacity-40">
                                —
                              </span>
                              <span className="sr-only">não tem</span>
                            </>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>
    </>
  )
}
