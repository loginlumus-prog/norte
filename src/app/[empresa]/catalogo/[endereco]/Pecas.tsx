// Peças da vitrine pública que não guardam estado: os desenhos pequenos, a
// marca da loja e a foto do produto (ou o azulejo, quando não tem foto).
// Servem ao catálogo e à página de acompanhar o pedido — sem hook aqui, para
// a página do servidor poder usar também.

import { sigla, tomDe } from './marca'

/* ── desenhos pequenos (grade 24, traço 1.8, cor de quem chama) ── */
type P = { tamanho?: number; className?: string }
const svg = (tamanho: number, className?: string) => ({
  viewBox: '0 0 24 24',
  width: tamanho,
  height: tamanho,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className,
})

export const Lupa = ({ tamanho = 18, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
)
export const Sacola = ({ tamanho = 20, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="M5 8h14l-1.2 12H6.2z" />
    <path d="M9 10V6.5a3 3 0 0 1 6 0V10" />
  </svg>
)
export const Menos = ({ tamanho = 18, className }: P) => (
  <svg {...svg(tamanho, className)} strokeWidth={2.2}>
    <path d="M6 12h12" />
  </svg>
)
export const Mais = ({ tamanho = 18, className }: P) => (
  <svg {...svg(tamanho, className)} strokeWidth={2.2}>
    <path d="M12 6v12M6 12h12" />
  </svg>
)
export const Fechar = ({ tamanho = 20, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
export const Voltar = ({ tamanho = 20, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
)
export const Adiante = ({ tamanho = 18, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
)
export const Visto = ({ tamanho = 18, className }: P) => (
  <svg {...svg(tamanho, className)} strokeWidth={2.2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
export const Lixo = ({ tamanho = 18, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="M4.5 7h15M10 7V5h4v2M6.5 7l.9 12h9.2l.9-12" />
  </svg>
)
export const Vitrine = ({ tamanho = 16, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="M4 10v9h16v-9" />
    <path d="M3 10h18l-1.6-5H4.6z" />
    <path d="M10 19v-5h4v5" />
  </svg>
)
export const Moto = ({ tamanho = 16, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <circle cx="6" cy="17" r="2.6" />
    <circle cx="18" cy="17" r="2.6" />
    <path d="M8.6 17h6.8l-2.4-6H9.5M13 11l1.5-4h3l1 4.5M5 11h4" />
  </svg>
)
export const Alvo = ({ tamanho = 16, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </svg>
)
export const Relogio = ({ tamanho = 16, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)
export const Etiqueta = ({ tamanho = 16, className }: P) => (
  <svg {...svg(tamanho, className)}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
)
export const Zap = ({ tamanho = 20, className }: P) => (
  <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill="currentColor" aria-hidden className={className}>
    <path d="M12 2.2a9.7 9.7 0 0 0-8.4 14.6L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2Zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2c0 1.2.9 2.4 1 2.5.1.2 1.7 2.7 4.2 3.8 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.3Z" />
  </svg>
)

/** O selo da loja: o logo, ou a sigla na cor da marca. */
export function MarcaDaLoja({ nome, logo, className = 'h-14 w-14 rounded-2xl text-xl' }: { nome: string; logo: string | null; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-marca font-extrabold tracking-tight text-marca-tinta shadow-[0_6px_18px_-8px_var(--marca)] ring-1 ring-black/5 ${className}`}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-full w-full object-cover" />
      ) : (
        sigla(nome)
      )}
    </span>
  )
}

/**
 * A foto do produto. Sem foto, o azulejo: a sigla do produto num fundo da cor
 * da loja (o tom muda pela categoria). Nunca um quadrado vazio.
 */
export function Foto({
  src,
  nome,
  tom,
  className = '',
  letra = 'text-2xl',
}: {
  src: string | null
  nome: string
  tom?: string | null
  className?: string
  letra?: string
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" decoding="async" className={`h-full w-full bg-superficie-2 object-cover ${className}`} />
  }
  return (
    <div aria-hidden data-tom={tomDe(tom ?? null)} className={`vt-azulejo flex h-full w-full items-center justify-center ${className}`}>
      <span className={`font-extrabold tracking-tight opacity-90 ${letra}`}>{sigla(nome)}</span>
    </div>
  )
}
