import type { Plano } from '@prisma/client'
import { PLANOS, RECURSOS, GRUPOS, RECOMENDADO, temRecurso, ORDEM } from '@/servidor/planos'

// A tabela de comparação, linha por linha.
//
// ── por que ela existe, se os cartões já resumem ─────────────
// Cartão vende, tabela decide. Quem está quase trocando de plano quer a
// pergunta específica respondida — "o crediário está no Rede ou não?" — e
// procurar isso em quatro cartões de bala é onde a pessoa desiste e vai
// perguntar no WhatsApp. A tabela responde sem ninguém do outro lado.
//
// ── por que a coluna do recomendado é pintada ────────────────
// Ela é a coluna que a pessoa vai comparar contra as outras três. Sem marca
// nenhuma, o olho perde a linha ao atravessar catorze itens — e a tabela vira
// aquele quadro que todo mundo pula.
//
// ── e por que não é `<div>` com grid ─────────────────────────
// É `<table>` de verdade: leitor de tela anuncia "Crediário, Rede: sim", que é
// exatamente a informação. Num grid de divs ele lê "sim" solto, catorze vezes.

const SIM = (
  <span aria-hidden className="text-bom">
    ●
  </span>
)
const NAO = (
  <span aria-hidden className="text-tinta-3 opacity-40">
    —
  </span>
)

export function Comparar({ atual }: { atual: Plano }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <caption className="sr-only">
          O que cada plano do Norte inclui, item por item.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-2/5 px-3 py-2 text-left text-xs font-medium text-tinta-3">
              O que está incluído
            </th>
            {ORDEM.map((p) => (
              <th
                key={p}
                scope="col"
                className={
                  'px-3 py-2 text-center align-bottom ' +
                  (p === RECOMENDADO ? 'rounded-t-norte bg-marca-suave' : '')
                }
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-tinta">{PLANOS[p].titulo}</span>
                  <span className="text-[10px] font-medium tracking-wide text-tinta-3 uppercase">
                    {p === atual ? 'seu plano' : p === RECOMENDADO ? 'recomendado' : ' '}
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
                className="px-3 pt-5 pb-1 text-left text-[10px] font-bold tracking-[0.14em] text-tinta-3 uppercase"
              >
                {grupo}
              </th>
            </tr>
            {RECURSOS.filter((r) => r.grupo === grupo).map((r) => (
              <tr key={r.titulo} className="border-t border-borda-suave">
                <th scope="row" className="px-3 py-2 text-left font-normal text-tinta-2">
                  {r.titulo}
                  {r.quando === 'breve' && (
                    <span className="ml-2 inline-block rounded-full bg-superficie-2 px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide whitespace-nowrap text-tinta-3 uppercase">
                      em breve
                    </span>
                  )}
                </th>
                {ORDEM.map((p) => {
                  const tem = temRecurso(r, p)
                  const detalhe = r.detalhe?.[p]
                  return (
                    <td
                      key={p}
                      className={
                        'px-3 py-2 text-center ' +
                        (p === RECOMENDADO ? 'bg-marca-suave' : '')
                      }
                    >
                      {/* O texto vem junto com o símbolo: quem não distingue
                          cor, e o leitor de tela, leem a mesma coisa. */}
                      {detalhe && tem ? (
                        <span className="numero text-xs font-semibold text-tinta">{detalhe}</span>
                      ) : tem ? (
                        <>
                          {SIM}
                          <span className="sr-only">tem</span>
                        </>
                      ) : (
                        <>
                          {NAO}
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
