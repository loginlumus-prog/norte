// Cinco estrelas, de 0 a 5 em meios.
//
// Serve para a nota de desempenho da equipe e para o que mais precisar de
// "quantas de cinco". Sem estado e sem efeito: desenha no servidor.
//
// ── a cor nunca fala sozinha ─────────────────────────────────
// A estrela cheia é âmbar e a vazia é cinza, mas o que separa as duas é a
// FORMA (preenchida contra só contorno), e o número vem escrito ao lado. Quem
// não distingue as cores conta as estrelas ou lê o "3,5" — e o leitor de tela
// recebe "3,5 de 5" de uma vez, sem cinco ícones anunciados um a um.

import { cx } from './base'

/** Um pentagrama desenhado à mão, na caixa 24×24. */
const CAMINHO = 'M12 2.6l2.85 6.05 6.55.8-4.85 4.55 1.3 6.5L12 17.25l-5.85 3.25 1.3-6.5L2.6 9.45l6.55-.8z'

const TAMANHO = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' } as const
const TEXTO = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' } as const

/** "3,5", "4" — sem o ",0" quando é inteira. */
export const formatarEstrelas = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

function Estrela({ como, tamanho }: { como: 'cheia' | 'meia' | 'vazia'; tamanho: keyof typeof TAMANHO }) {
  const caixa = TAMANHO[tamanho]
  return (
    <span className={cx('relative inline-block shrink-0', caixa)}>
      {/* O contorno vazio fica sempre por baixo: é a forma de referência. */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="absolute inset-0 size-full text-tinta-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      >
        <path d={CAMINHO} />
      </svg>
      {como !== 'vazia' && (
        // A meia é a cheia cortada ao meio por uma caixa com overflow
        // escondido. Cortar assim, em vez de clipPath, dispensa um id único
        // por estrela — e id repetido em SVG inline é defeito silencioso.
        <span aria-hidden className={cx('absolute inset-y-0 left-0 overflow-hidden', como === 'meia' ? 'w-1/2' : 'w-full')}>
          <svg
            viewBox="0 0 24 24"
            className={cx('text-atencao-vivo', caixa)}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          >
            <path d={CAMINHO} />
          </svg>
        </span>
      )}
    </span>
  )
}

export function Estrelas({
  valor,
  tamanho = 'md',
}: {
  /** 0 a 5. Arredonda para o meio mais próximo e não passa dos limites. */
  valor: number
  tamanho?: keyof typeof TAMANHO
}) {
  const v = Math.round(Math.min(Math.max(valor, 0), 5) * 2) / 2
  const texto = formatarEstrelas(v)

  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`${texto} de 5`}>
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Estrela key={i} tamanho={tamanho} como={v >= i ? 'cheia' : v >= i - 0.5 ? 'meia' : 'vazia'} />
        ))}
      </span>
      <span className={cx('numero font-semibold text-tinta', TEXTO[tamanho])}>{texto}</span>
    </span>
  )
}
