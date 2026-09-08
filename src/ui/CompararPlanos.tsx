// A tabela item por item da página de venda.
//
// ── por que ela existe, se os cartões já resumem ─────────────
// Cartão vende, tabela decide. Quem está com o cartão do meio quase escolhido
// tem UMA pergunta específica — "o crediário está no Rede ou não?" — e
// procurar isso em quatro listas de bala é onde a pessoa desiste e vai
// perguntar no WhatsApp. A tabela responde sem ninguém do outro lado.
//
// ── e por que o dado vem do mesmo lugar do sistema ───────────
// `RECURSOS` em `servidor/planos.ts` é a MESMA lista que a tela de assinatura
// usa por dentro. Duas listas separadas divergem — e divergir aqui é prometer
// na venda o que o sistema não entrega, que é o pior lugar possível para uma
// inconsistência.
//
// ── `<table>` de verdade ─────────────────────────────────────
// Leitor de tela anuncia "Crediário próprio, Rede: tem", que é exatamente a
// informação. Num grid de divs ele lê "tem" solto, dezoito vezes.

import { PLANOS, RECURSOS, GRUPOS, RECOMENDADO, temRecurso, ORDEM } from '@/servidor/planos'

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function CompararPlanos() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-collapse text-sm">
        <caption className="sr-only">O que cada plano do Norte inclui, item por item.</caption>

        <thead>
          <tr>
            <th
              scope="col"
              className="w-[38%] px-3 pb-3 text-left text-xs font-medium text-tinta-3"
            >
              O que está incluído
            </th>
            {ORDEM.map((p) => (
              <th
                key={p}
                scope="col"
                className={
                  'px-3 pb-3 text-center align-bottom ' +
                  (p === RECOMENDADO ? 'rounded-t-norte bg-superficie-2' : '')
                }
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold tracking-tight text-tinta">
                    {PLANOS[p].titulo}
                  </span>
                  <span className="numero text-xs text-tinta-3">
                    {PLANOS[p].mensal !== null ? `${brl(PLANOS[p].mensal!)}/mês` : 'sob consulta'}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>

        {GRUPOS.map((grupo) => (
          <tbody key={grupo}>
            <tr>
              <th
                scope="colgroup"
                colSpan={1 + ORDEM.length}
                className="px-3 pt-7 pb-1.5 text-left text-[10px] font-bold tracking-[0.16em] text-tinta-3 uppercase"
              >
                {grupo}
              </th>
            </tr>
            {RECURSOS.filter((r) => r.grupo === grupo).map((r) => (
              <tr key={r.titulo} className="border-t border-borda-suave">
                <th scope="row" className="px-3 py-2.5 text-left font-normal text-tinta-2">
                  {r.titulo}
                </th>
                {ORDEM.map((p) => {
                  const tem = temRecurso(r, p)
                  const detalhe = r.detalhe?.[p]
                  return (
                    <td
                      key={p}
                      className={
                        'px-3 py-2.5 text-center ' +
                        (p === RECOMENDADO ? 'bg-superficie-2' : '')
                      }
                    >
                      {/* Número quando é quantitativo; símbolo quando é sim ou
                          não. E o texto invisível vai junto: quem não distingue
                          cor e o leitor de tela leem a mesma coisa. */}
                      {detalhe && tem ? (
                        <span className="numero text-xs font-semibold text-tinta">{detalhe}</span>
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
        ))}
      </table>
    </div>
  )
}
