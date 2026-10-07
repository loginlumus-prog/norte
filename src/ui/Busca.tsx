// A busca e os filtros de lista, do jeito que toda tela de lista usa.
//
// ── por que vive no ENDEREÇO, e não em estado escondido ──────
// Uma busca em estado de componente some no F5, não dá para mandar o link para
// alguém, e o botão "voltar" não sabe dela. No endereço, "os produtos que
// acabaram na loja 2" é um link — e link é a única forma de a pessoa pedir
// ajuda ("olha isso aqui") sem ter que explicar o que clicou.
//
// Por isso é <form method="get"> de verdade, sem JavaScript: o navegador monta
// o endereço sozinho. Os parâmetros que a tela já tinha (unidade, período) vão
// escondidos no formulário, senão buscar apagaria a loja que a pessoa escolheu
// dois cliques atrás.

import Link from 'next/link'

export function Busca({
  valor,
  placeholder,
  rotulo,
  manter = {},
  limparEm,
}: {
  valor?: string | null
  placeholder: string
  /** O que o leitor de tela anuncia. "Buscar produto", "Buscar venda". */
  rotulo: string
  /** Parâmetros do endereço que precisam sobreviver à busca. */
  manter?: Record<string, string | null | undefined>
  /** Para onde "limpar" leva — o mesmo endereço, sem o `q`. */
  limparEm: string
}) {
  return (
    <form className="flex flex-wrap gap-2">
      {Object.entries(manter)
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v!} />
        ))}
      {/* A lupa dentro do campo, e o campo grande: é a primeira coisa que a
          pessoa procura numa lista. O anel da marca acende no foco. */}
      <label className="group flex h-11 min-w-[14rem] flex-1 items-center gap-2.5 rounded-2xl border border-borda bg-superficie px-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-[border-color,box-shadow] focus-within:border-marca focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--marca)_16%,transparent)]">
        <svg aria-hidden viewBox="0 0 20 20" className="size-[18px] shrink-0 text-tinta-3 transition-colors group-focus-within:text-marca" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.2 13.2 3.6 3.6" />
        </svg>
        <input
          name="q"
          defaultValue={valor ?? ''}
          placeholder={placeholder}
          aria-label={rotulo}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-tinta outline-none placeholder:text-tinta-3"
        />
      </label>
      <button
        type="submit"
        className="botao-vivo botao-marca h-11 rounded-2xl px-5 text-sm font-semibold text-marca-tinta"
      >
        Buscar
      </button>
      {valor && (
        <Link href={limparEm} className="flex items-center px-2 text-sm text-tinta-3 hover:text-tinta">
          limpar
        </Link>
      )}
    </form>
  )
}

/**
 * Uma fileira de opções excludentes: "todas · acabaram · no mínimo".
 *
 * São links, não botões: cada um é um endereço. A escolhida muda texto, fundo
 * E contorno — não só cor — para quem não distingue cor ver igual.
 *
 * Já foi pílula PRETA (o ponto mais escuro da tela, brigando com o botão
 * principal) e depois pílula azul cheia. Agora é um trilho só, com as opções
 * dentro: a escolhida sobe em papel, com sombra e a letra na cor da área —
 * escolher vira "deslizar" num controle, e não acender um botão a mais.
 */
export function Fichas<T extends string>({
  opcoes,
  atual,
  linkDe,
  rotulo,
}: {
  opcoes: { valor: T | null; rotulo: string; quantos?: number }[]
  atual: T | null
  linkDe: (valor: T | null) => string
  /**
   * O nome do filtro ("Ordenar por", "Marca"). No celular ele fica EM CIMA
   * das fichas; ao lado, quando as fichas quebravam linha, o rótulo boiava
   * no meio da altura e parecia pertencer à linha de baixo.
   */
  rotulo?: string
}) {
  const fileira = (
    <span className="fichas inline-flex max-w-full flex-wrap gap-0.5 rounded-xl p-1 text-xs">
      {opcoes.map((o) => (
        <Link
          key={o.rotulo}
          href={linkDe(o.valor)}
          aria-current={atual === o.valor ? 'true' : undefined}
          className="ficha inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold whitespace-nowrap"
        >
          {o.rotulo}
          {o.quantos !== undefined && (
            <span className="ficha-conta numero rounded-full px-1.5 py-px text-[12px] leading-none">
              {o.quantos.toLocaleString('pt-BR')}
            </span>
          )}
        </Link>
      ))}
    </span>
  )
  if (!rotulo) return fileira
  return (
    <span className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
      <span className="shrink-0 text-xs font-medium text-tinta-3">{rotulo}</span>
      {fileira}
    </span>
  )
}

/** Monta o endereço da tela com os parâmetros atuais, trocando alguns. */
export function enderecoCom(
  base: string,
  atuais: Record<string, string | null | undefined>,
  mudanca: Record<string, string | null> = {},
): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(atuais)) if (v) p.set(k, v)
  for (const [k, v] of Object.entries(mudanca)) v === null ? p.delete(k) : p.set(k, v)
  const s = p.toString()
  return s ? `${base}?${s}` : base
}
