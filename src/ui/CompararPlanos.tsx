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
//
// ── e por que existe uma SEGUNDA forma, para tela estreita ───
// Cinco planos não cabem em 375px. Não é questão de apertar: a tabela rolava
// de lado dentro da própria caixa (o que estava certo, a página nunca vazou),
// e mesmo assim a pessoa via a coluna de nomes e um pedaço de uma coluna de
// "✓ — ✓" sem saber de que plano era. Grudar a primeira coluna melhora e não
// resolve — continua faltando espaço para cinco colunas.
//
// Então no celular a pergunta muda de forma. Em vez de "onde este item cruza
// com este plano", que precisa de duas dimensões, ela vira "a partir de qual
// plano este item existe" — que é uma linha de texto e é a MESMA pergunta que
// a pessoa tem na cabeça: "o crediário está no Rede ou não?".
//
// ── e onde a forma troca ──────────────────────────────────────
// Trocava em 768px, e a tabela de verdade tinha `min-w-[60rem]` dentro de uma
// caixa que rolava de lado. Entre 768 e ~960px ela não cabia, a caixa rolava
// — e os textos `sr-only` ("tem", "não tem"), que são `position: absolute`,
// escapavam da caixa (ela não era posicionada) e esticavam a PÁGINA inteira
// de lado. Dois consertos juntos:
//   • a tabela só aparece de 1024px para cima, onde as seis colunas cabem
//     sem largura mínima nenhuma (`table-fixed`, e o detalhe quebra linha em
//     vez de empurrar a coluna); abaixo disso vale a lista, em duas colunas
//     a partir de 768px;
//   • a caixa da tabela é `relative`, então nenhum `sr-only` lá dentro
//     alcança a página, e não rola de lado — não tem o que rolar.
//
// Sem caixa que rola, o cabeçalho com o nome dos planos pode GRUDAR no topo
// enquanto a pessoa desce as 30 linhas: é a coluna que ela esquece primeiro.
//
// Isso só funciona porque a tabela é uma ESCADA: todo recurso, quando existe,
// existe do plano X para cima. `aPartirDe` confere isso em vez de supor — e se
// um dia alguém montar um recurso fora da escada, ele cai no caminho de baixo
// e lista os planos um a um, em vez de mentir.

import { PLANOS, RECURSOS, GRUPOS, RECOMENDADO, temRecurso, ORDEM } from '@/servidor/planos'
import type { Plano } from '@prisma/client'

// Sem centavos: preço de plano é número redondo, e "R$ 1.500,00/mês" numa
// coluna estreita de cabeçalho quebra linha à toa.
const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

/**
 * O primeiro plano da escada que tem este recurso — ou `null` quando os planos
 * que o têm não formam um trecho contínuo do fim da escada.
 */
function aPartirDe(em: readonly Plano[]): Plano | null {
  const indices = ORDEM.map((p, i) => (em.includes(p) ? i : -1)).filter((i) => i >= 0)
  if (indices.length === 0) return null

  const primeiro = indices[0]!
  const contínuo = indices.every((v, k) => v === primeiro + k)
  const vaiAteOFim = indices[indices.length - 1] === ORDEM.length - 1
  return contínuo && vaiAteOFim ? ORDEM[primeiro]! : null
}

export function CompararPlanos() {
  return (
    <>
      {/* ── celular e tablet: uma linha por item ── */}
      <dl className="flex flex-col md:grid md:grid-cols-2 md:gap-x-10 lg:hidden">
        {GRUPOS.map((grupo) => (
          <div key={grupo} className="flex flex-col">
            <p className="pt-7 pb-1 text-[10px] font-bold tracking-[0.16em] text-tinta-3 uppercase">
              {grupo}
            </p>
            {RECURSOS.filter((r) => r.grupo === grupo).map((r) => {
              const desde = aPartirDe(r.em)
              const temDetalhe = r.detalhe && Object.keys(r.detalhe).length > 0
              return (
                <div key={r.titulo} className="flex flex-col gap-1 border-t border-borda-suave py-2.5">
                  <dt className="text-sm text-tinta">
                    {r.titulo}
                    {r.quando === 'breve' && (
                      <span className="ml-2 inline-block rounded-full bg-superficie-2 px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide whitespace-nowrap text-tinta-3 uppercase">
                        em breve
                      </span>
                    )}
                  </dt>
                  <dd className="text-[13px] leading-snug text-tinta-2">
                    {temDetalhe ? (
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {ORDEM.filter((p) => r.detalhe?.[p]).map((p) => (
                          <span key={p} className="whitespace-nowrap">
                            <span className="text-tinta-3">{PLANOS[p].titulo}:</span>{' '}
                            <span className="font-semibold text-tinta">{r.detalhe![p]}</span>
                          </span>
                        ))}
                      </span>
                    ) : r.em.length === ORDEM.length ? (
                      <span className="font-semibold text-bom">Em todos os planos</span>
                    ) : desde ? (
                      <span className="font-semibold text-tinta">
                        {PLANOS[desde].artigo === 'a' ? 'Da' : 'Do'} {PLANOS[desde].titulo} para
                        cima
                      </span>
                    ) : (
                      <span className="font-semibold text-tinta">
                        {r.em.map((p) => PLANOS[p].titulo).join(' · ')}
                      </span>
                    )}
                  </dd>
                </div>
              )
            })}
          </div>
        ))}
      </dl>

      {/* ── de 1024px para cima, a tabela de verdade ── */}
      <div className="relative hidden lg:block">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">O que cada plano do Norte inclui, item por item.</caption>

        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-16 z-10 w-[28%] bg-fundo px-3 pt-3 pb-3 text-left align-bottom text-xs font-medium text-tinta-3"
            >
              O que está incluído
            </th>
            {ORDEM.map((p) => (
              <th
                key={p}
                scope="col"
                className={
                  'sticky top-16 z-10 border-b border-borda px-3 pt-3 pb-3 text-center align-bottom ' +
                  (p === RECOMENDADO ? 'rounded-t-norte bg-marca-suave' : 'bg-fundo')
                }
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold tracking-tight text-tinta">
                    {PLANOS[p].titulo}
                  </span>
                  {p === RECOMENDADO && (
                    <span className="text-[10px] font-bold tracking-[0.1em] text-marca uppercase">
                      recomendado
                    </span>
                  )}
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
                  {/* Marcar o que ainda nao existe nao e fraqueza da pagina, e
                      o que separa expectativa de mentira. Quem assina por uma
                      linha que nao encontra depois cancela — e esse
                      cancelamento vem com reclamacao publica junto. */}
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
                        'px-3 py-2.5 text-center ' +
                        (p === RECOMENDADO ? 'bg-marca-suave/50' : '')
                      }
                    >
                      {/* Número quando é quantitativo; símbolo quando é sim ou
                          não. E o texto invisível vai junto: quem não distingue
                          cor e o leitor de tela leem a mesma coisa. */}
                      {detalhe && tem ? (
                        // Sem `numero`: ele trava a quebra de linha, e "3 (+R$ 40
                        // cada)" numa coluna estreita precisa poder quebrar em
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
        ))}
      </table>
      </div>
    </>
  )
}
