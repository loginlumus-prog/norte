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
      <input
        name="q"
        defaultValue={valor ?? ''}
        placeholder={placeholder}
        aria-label={rotulo}
        className="min-w-[14rem] flex-1 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
      />
      <button
        type="submit"
        className="rounded-norte border border-borda bg-superficie px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
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
 * Já foi pílula PRETA. No sistema branco ela era o ponto mais escuro da tela,
 * mais forte que o botão principal, e brigava com o período (azul) logo
 * acima: dois jeitos de dizer "escolhido". Agora é o azul da marca em fundo
 * claro — a mesma família do período, um degrau mais quieta, porque filtro é
 * apoio. E o alvo cresceu: 24px de altura não é alvo de dedo.
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
    <span className="flex flex-wrap gap-1 text-xs">
      {opcoes.map((o) => (
        <Link
          key={o.rotulo}
          href={linkDe(o.valor)}
          aria-current={atual === o.valor ? 'true' : undefined}
          className={
            'rounded-full border px-3 py-1.5 font-semibold ' +
            (atual === o.valor
              ? 'border-marca/40 bg-marca-suave text-marca'
              : 'border-transparent text-tinta-2 hover:bg-superficie-2 hover:text-tinta')
          }
        >
          {o.rotulo}
          {o.quantos !== undefined && (
            <span className={'numero ml-1 ' + (atual === o.valor ? 'opacity-70' : 'text-tinta-3')}>
              {o.quantos}
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
