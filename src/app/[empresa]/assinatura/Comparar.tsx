import type { Plano } from '@prisma/client'
import { PLANOS, RECURSOS, GRUPOS, RECOMENDADO, temRecurso, ORDEM } from '@/servidor/planos'

// A tabela de comparação, linha por linha.
//
// ── por que ela existe, se os cartões já resumem ─────────────
// Cartão vende, tabela decide. Quem está quase trocando de plano quer a
// pergunta específica respondida — "o crediário vem no Norte ou só com o
// assistente?" — e procurar isso nos cartões é onde a pessoa desiste e vai
// perguntar no WhatsApp. A tabela responde sem ninguém do outro lado.
//
// ── quais colunas ────────────────────────────────────────────
// As que se vendem (o Essencial e o Profissional) e o plano de hoje, quando
// ele não está à venda: quem caiu no Grátis depois do teste, ou o cliente de
// contrato, precisa ver o próprio plano ao lado do que pode escolher. Os
// outros que não se vendem ficam fora — coluna de plano que não se pode
// escolher é ruído.
//
// ── por que a coluna do recomendado é pintada ────────────────
// Ela é a coluna que a pessoa vai comparar contra as outras. Sem marca
// nenhuma, o olho perde a linha ao atravessar trinta itens — e a tabela vira
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
  const colunas = ORDEM.filter((p) => PLANOS[p].aVenda || p === atual)
  // Linha que não existe em coluna nenhuma (a implantação do Corporativo, para
  // quem não é Corporativo) não diz nada a esta empresa.
  const linhas = RECURSOS.filter((r) => colunas.some((p) => temRecurso(r, p)))
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">
          O que cada plano do Norte inclui, item por item.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-2/5 px-3 py-2 text-left text-xs font-medium text-tinta-3">
              O que está incluído
            </th>
            {colunas.map((p) => (
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
                  <span className="text-[11.5px] font-medium tracking-wide text-tinta-3 uppercase">
                    {p === atual ? 'seu plano' : p === RECOMENDADO ? 'recomendado' : ' '}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>

        {GRUPOS.filter((g) => linhas.some((r) => r.grupo === g)).map((grupo) => (
          <tbody key={grupo}>
            <tr>
              <th
                scope="colgroup"
                colSpan={1 + colunas.length}
                className="px-3 pt-5 pb-1 text-left text-[11.5px] font-bold tracking-[0.14em] text-tinta-3 uppercase"
              >
                {grupo}
              </th>
            </tr>
            {linhas.filter((r) => r.grupo === grupo).map((r) => (
              <tr key={r.titulo} className="border-t border-borda-suave">
                <th scope="row" className="px-3 py-2 text-left font-normal text-tinta-2">
                  {r.titulo}
                  {r.quando === 'breve' && (
                    <span className="ml-2 inline-block rounded-full bg-superficie-2 px-1.5 py-0.5 align-middle text-[11.5px] font-bold tracking-wide whitespace-nowrap text-tinta-3 uppercase">
                      em breve
                    </span>
                  )}
                </th>
                {colunas.map((p) => {
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
