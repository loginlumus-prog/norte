// A marca do Norte.
//
// ── o que o símbolo é ────────────────────────────────────────
// Uma agulha de bússola apontando para o norte, dentro de um azulejo
// azul-noite. A metade de cima é o SOL nascendo — do âmbar fundo na base ao
// dourado claro na ponta; a de baixo é branca, que é o contrapeso da agulha.
//
// ── por que assim, e não mais bonito ─────────────────────────
// O teste que reprovou os outros desenhos foi o de 16 pixels. Ícone de aba do
// navegador, favorito, atalho na tela do celular: é lá que a marca é vista
// mais vezes, e é lá que anel fino, raio de sol e degradê viram borrão. O que
// sobrou tem DUAS formas e DUAS cores, e continua legível como unha.
//
// O azulejo não é enfeite: sem ele, a agulha some em qualquer fundo claro e
// perde presença. Por isso existem duas versões — com azulejo (padrão) e
// sem (`nu`), para quando o fundo JÁ é o azul-noite, como a barra lateral.

const IDS = { claro: '#FFC04D', fundo: '#F2760C' }

/** Só o símbolo. `nu` tira o azulejo, para fundo que já é azul-noite. */
export function Simbolo({
  tamanho = 28,
  nu = false,
  id = 'sol',
  className,
}: {
  tamanho?: number
  nu?: boolean
  /** Precisa ser único na página: dois degradês com o mesmo id se atropelam. */
  id?: string
  className?: string
}) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0.25" y2="0">
          <stop offset="0" stopColor={IDS.fundo} />
          <stop offset="1" stopColor={IDS.claro} />
        </linearGradient>
      </defs>
      {!nu && <rect width="32" height="32" rx="8" fill="var(--nav)" />}
      {/* norte: o sol */}
      <path d="M16 4 L22.5 20.5 L16 17.4 L9.5 20.5 Z" fill={`url(#${id})`} />
      {/* sul: o contrapeso */}
      <path d="M16 17.4 L22.5 20.5 L16 28 L9.5 20.5 Z" fill={nu ? '#ffffff' : '#ffffff'} />
    </svg>
  )
}

/**
 * Símbolo + nome, travados juntos.
 *
 * O nome nasce como texto, não como desenho: assim ele é lido por buscador e
 * por leitor de tela, e acompanha o tamanho de fonte de quem enxerga pouco.
 */
export function Marca({
  tamanho = 28,
  nu = false,
  id = 'sol',
  claro = false,
  className = '',
}: {
  tamanho?: number
  nu?: boolean
  id?: string
  /** Nome em branco, para fundo escuro. */
  claro?: boolean
  className?: string
}) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Simbolo tamanho={tamanho} nu={nu} id={id} />
      <span
        className={`font-extrabold tracking-[-0.035em] ${claro ? 'text-white' : 'text-tinta'}`}
        style={{ fontSize: Math.round(tamanho * 0.82) }}
      >
        Norte
      </span>
    </span>
  )
}
