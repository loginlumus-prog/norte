// Peças da vitrine pública que não guardam estado: os desenhos pequenos, a
// marca da loja e a foto do produto (ou o azulejo com o desenho do produto,
// quando não há foto).
// Servem ao catálogo e à página de acompanhar o pedido — sem hook aqui, para
// a página do servidor poder usar também.

import type { ReactNode } from 'react'
import type { IconeDoProduto } from './icone'
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

/** Os desenhos do produto sem foto (ver icone.ts): traço fino, na cor de quem chama. */
const DESENHOS: Record<IconeDoProduto, ReactNode> = {
  roupa: (
    <>
      <path d="M10 5.6a2 2 0 1 1 2 2V9" />
      <path d="M12 9 3.6 15.4a1 1 0 0 0 .6 1.8h15.6a1 1 0 0 0 .6-1.8z" />
    </>
  ),
  calcado: (
    <>
      <path d="M3 7.5v9h18v-1.2a3 3 0 0 0-2.4-2.9l-5-1-3.4-3.6-3 1.4z" />
      <path d="M3 19.5h18" />
      <path d="m10.4 10.6-1.6 1.2M12.2 12.3l-1.6 1.2" />
    </>
  ),
  acessorio: (
    <>
      <circle cx="12" cy="14.5" r="5.5" />
      <path d="m10 7 2-2.6L14 7l-2 1.6z" />
    </>
  ),
  bebida: (
    <>
      <path d="M10 3h4v3l1.6 2.6V20a1 1 0 0 1-1 1H9.4a1 1 0 0 1-1-1V8.6L10 6z" />
      <path d="M8.4 12.5h7.2" />
    </>
  ),
  sorvete: (
    <>
      <path d="m8 11.5 4 9.5 4-9.5" />
      <path d="M7 11.5a5 5 0 1 1 10 0z" />
    </>
  ),
  doce: (
    <>
      <path d="M4 20.5h16v-7H4z" />
      <path d="M4 16c2 1.2 4 1.2 6 0s4-1.2 6 0 3 1 4 0" />
      <path d="M12 13.5v-3" />
      <path d="M12 8c.9-.7.9-1.8 0-2.8-.9 1-.9 2.1 0 2.8z" />
    </>
  ),
  mercearia: (
    <>
      <path d="M3.5 10h17l-1.8 9.2a1 1 0 0 1-1 .8H6.3a1 1 0 0 1-1-.8z" />
      <path d="m8 10 3-6M16 10l-3-6M9 13.5v3.5M12 13.5v3.5M15 13.5v3.5" />
    </>
  ),
  beleza: (
    <>
      <path d="M8 11h8v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" />
      <path d="M10 11V3.5h4V11" />
    </>
  ),
  pet: (
    <>
      <path d="M12 12.5c-3 0-5 2.7-5 4.7S8.6 20.5 12 20.5s5-1.3 5-3.3-2-4.7-5-4.7z" />
      <circle cx="5.8" cy="10" r="1.7" />
      <circle cx="9.4" cy="6" r="1.7" />
      <circle cx="14.6" cy="6" r="1.7" />
      <circle cx="18.2" cy="10" r="1.7" />
    </>
  ),
  papelaria: (
    <>
      <path d="m4 20 1-4L16 5l3 3L8 19z" />
      <path d="m14 7 3 3" />
    </>
  ),
  brinquedo: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.5 2.2 2.5 13.8 0 16" />
    </>
  ),
  flor: (
    <>
      <circle cx="12" cy="8.5" r="1.8" />
      <path d="M12 6.7a2.4 2.4 0 1 1 0-4.6 2.4 2.4 0 1 1 0 4.6zM13.8 8.5a2.4 2.4 0 1 1 4.6 0 2.4 2.4 0 1 1-4.6 0zM12 10.3a2.4 2.4 0 1 1 0 4.6 2.4 2.4 0 1 1 0-4.6zM10.2 8.5a2.4 2.4 0 1 1-4.6 0 2.4 2.4 0 1 1 4.6 0z" />
      <path d="M12 15v6.5M12 18.5c-1.6-2-3.6-2.4-5-1.8 1 2 3 2.6 5 1.8z" />
    </>
  ),
  etiqueta: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
}

export function DesenhoDoProduto({ icone, tamanho = 40, className }: { icone: IconeDoProduto; tamanho?: number; className?: string }) {
  return (
    <svg {...svg(tamanho, className)} strokeWidth={1.5}>
      {DESENHOS[icone] ?? DESENHOS.etiqueta}
    </svg>
  )
}

/**
 * A foto do produto. Sem foto — ou quando a foto não carrega (internet fraca,
 * foto trocada depois que a página abriu) —, o azulejo: o desenho do que o
 * produto é (cabide, sapato, picolé…) na cor da loja, num fundo tingido dela
 * (o tom muda pela categoria). Nunca um quadrado vazio nem a imagem quebrada.
 *
 * O `onError` faz desta a única peça daqui que só serve a componente de
 * cliente (a Loja); a página do servidor não a usa.
 */
export function Foto({
  src,
  icone,
  tom,
  className = '',
  desenho = 40,
}: {
  src: string | null
  icone: IconeDoProduto
  tom?: string | null
  className?: string
  /** Tamanho do desenho, em px, quando não há foto. */
  desenho?: number
}) {
  const azulejo = (
    <div aria-hidden data-tom={tomDe(tom ?? null)} className="vt-azulejo flex h-full w-full items-center justify-center">
      <DesenhoDoProduto icone={icone} tamanho={desenho} className="opacity-90" />
    </div>
  )
  if (!src) return azulejo
  return (
    <div className="relative h-full w-full">
      {azulejo}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
        className={`absolute inset-0 h-full w-full bg-superficie-2 object-cover ${className}`}
      />
    </div>
  )
}
