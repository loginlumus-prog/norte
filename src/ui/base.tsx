// Peças básicas da interface.
//
// A regra que mantém 30 telas parecidas em vez de "quase parecidas": nenhuma
// tela escreve cor, borda ou espaçamento na mão. Se falta um jeito de um
// componente, ele ganha uma variante aqui — não uma classe solta lá.

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

export const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(' ')

/* ── Botão ────────────────────────────────────────────────── */

type Tom = 'principal' | 'secundario' | 'discreto' | 'perigo'

const TOM: Record<Tom, string> = {
  principal: 'bg-marca text-marca-tinta hover:bg-marca-forte border-transparent',
  secundario: 'bg-superficie text-tinta hover:bg-superficie-2 border-borda',
  discreto: 'bg-transparent text-tinta-2 hover:bg-superficie-2 hover:text-tinta border-transparent',
  perigo: 'bg-critico-fundo text-critico hover:brightness-95 border-transparent',
}

export function Botao({
  tom = 'principal',
  largo,
  carregando,
  children,
  className,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tom?: Tom
  largo?: boolean
  carregando?: boolean
}) {
  return (
    <button
      {...resto}
      disabled={resto.disabled || carregando}
      aria-busy={carregando || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-norte border px-3 py-2',
        'text-sm font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-55',
        TOM[tom],
        largo && 'w-full',
        className,
      )}
    >
      {carregando && <Girando />}
      {children}
    </button>
  )
}

function Girando() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

/* ── Campo ────────────────────────────────────────────────── */

export function Campo({
  rotulo,
  erro,
  dica,
  id,
  className,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string
  erro?: string
  dica?: string
}) {
  const meuId = id ?? `campo-${resto.name ?? rotulo.toLowerCase().replace(/\W+/g, '-')}`
  const idDica = dica ? `${meuId}-dica` : undefined
  const idErro = erro ? `${meuId}-erro` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={meuId} className="text-sm font-medium text-tinta">
        {rotulo}
      </label>
      <input
        {...resto}
        id={meuId}
        aria-invalid={erro ? true : undefined}
        aria-describedby={cx(idDica, idErro) || undefined}
        className={cx(
          'rounded-norte border bg-superficie px-3 py-2 text-sm text-tinta',
          'placeholder:text-tinta-3',
          erro ? 'border-critico' : 'border-borda',
          className,
        )}
      />
      {dica && !erro && (
        <p id={idDica} className="text-xs text-tinta-3">
          {dica}
        </p>
      )}
      {erro && (
        <p id={idErro} className="text-xs font-medium text-critico">
          {erro}
        </p>
      )}
    </div>
  )
}

/* ── Aviso ────────────────────────────────────────────────── */

type Nivel = 'bom' | 'atencao' | 'critico' | 'neutro'

const AVISO: Record<Nivel, string> = {
  bom: 'bg-bom-fundo text-bom',
  atencao: 'bg-atencao-fundo text-atencao',
  critico: 'bg-critico-fundo text-critico',
  neutro: 'bg-superficie-2 text-tinta-2',
}

export function Aviso({
  nivel = 'neutro',
  children,
}: {
  nivel?: Nivel
  children: ReactNode
}) {
  return (
    <div
      // 'alert' faz o leitor de tela anunciar sem a pessoa precisar procurar
      role={nivel === 'critico' ? 'alert' : 'status'}
      className={cx('rounded-norte px-3 py-2 text-sm font-medium', AVISO[nivel])}
    >
      {children}
    </div>
  )
}

/* ── Situação ─────────────────────────────────────────────── */

/**
 * Etiqueta de situação. Cor E texto — nunca só cor: quem não distingue verde
 * de vermelho (8% dos homens) precisa ler o mesmo que os outros enxergam.
 */
export function Situacao({ nivel = 'neutro', children }: { nivel?: Nivel; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold',
        AVISO[nivel],
      )}
    >
      {children}
    </span>
  )
}

/* ── Cartão ───────────────────────────────────────────────── */

export function Cartao({
  titulo,
  acao,
  children,
}: {
  titulo?: string
  acao?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-norte border border-borda bg-superficie">
      {titulo && (
        <header className="flex items-center justify-between gap-3 border-b border-borda bg-superficie-2 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-tinta">{titulo}</h2>
          {acao}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

/* ── Vazio ────────────────────────────────────────────────── */

/** Lista sem nada dentro. Diz o que fazer, não só que está vazio. */
export function Vazio({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="max-w-sm text-sm text-tinta-2">{children}</p>
      {acao}
    </div>
  )
}

/* ── Seleção ──────────────────────────────────────────────── */

export function Selecao({
  rotulo,
  dica,
  opcoes,
  id,
  className,
  ...resto
}: SelectHTMLAttributes<HTMLSelectElement> & {
  rotulo: string
  dica?: string
  opcoes: { valor: string; titulo: string }[]
}) {
  const meuId = id ?? `sel-${resto.name ?? rotulo.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={meuId} className="text-sm font-medium text-tinta">
        {rotulo}
      </label>
      <select
        {...resto}
        id={meuId}
        className={cx(
          'rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta',
          className,
        )}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.titulo}
          </option>
        ))}
      </select>
      {dica && <p className="text-xs text-tinta-3">{dica}</p>}
    </div>
  )
}

/* ── Caixa de marcar ──────────────────────────────────────── */

/**
 * Rótulo grande e clicável inteiro. No balcão se usa com o dedo, e alvo
 * pequeno de 16px erra mais do que acerta.
 */
export function Marcar({
  titulo,
  resumo,
  id,
  className,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & {
  titulo: string
  resumo?: string
}) {
  const meuId = id ?? `mar-${resto.name}`
  return (
    <label
      htmlFor={meuId}
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-norte border border-borda',
        'bg-superficie p-3 transition-colors hover:bg-superficie-2',
        'has-checked:border-marca has-checked:bg-marca-suave',
        className,
      )}
    >
      <input
        {...resto}
        id={meuId}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-[var(--marca)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-tinta">{titulo}</span>
        {resumo && <span className="text-xs text-tinta-2">{resumo}</span>}
      </span>
    </label>
  )
}
