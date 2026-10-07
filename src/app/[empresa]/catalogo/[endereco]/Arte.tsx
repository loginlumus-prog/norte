// A arte da capa da vitrine: o desenho de fundo de cada data (a neve do Natal,
// as bandeirinhas do São João, os morcegos do Halloween) e, sem data, uma
// trama discreta na cor da loja. Sem hook: serve à página do servidor também.
//
// É desenho de fundo — `aria-hidden`, sem clique — e fica atrás do conteúdo
// com transparência: a capa continua legível em qualquer cor de tema.

import type { Arte } from '@/servidor/vitrine-tema'

const BRANCO = 'rgb(255 255 255 / 0.55)'
const BRANCO_FORTE = 'rgb(255 255 255 / 0.8)'

function Motivo({ arte }: { arte: Arte | null }) {
  switch (arte) {
    case 'neve':
      return (
        <g stroke={BRANCO} strokeWidth="1.6" strokeLinecap="round" fill="none">
          {[
            [18, 22, 7],
            [78, 14, 5],
            [52, 64, 8],
            [104, 70, 5],
            [24, 96, 5],
            [92, 108, 7],
          ].map(([x, y, r], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              <path d={`M0 -${r}V${r}M-${r} 0H${r}M-${r! * 0.7} -${r! * 0.7}L${r! * 0.7} ${r! * 0.7}M${r! * 0.7} -${r! * 0.7}L-${r! * 0.7} ${r! * 0.7}`} />
            </g>
          ))}
        </g>
      )
    case 'confete':
      return (
        <g>
          {[
            [14, 18, 20, '#ffd43b'],
            [60, 10, -30, '#ffffff'],
            [96, 34, 45, '#63e6be'],
            [30, 62, 70, '#ffffff'],
            [76, 76, -15, '#ffd43b'],
            [110, 96, 30, '#ff8787'],
            [44, 104, -50, '#74c0fc'],
          ].map(([x, y, rot, cor], i) => (
            <rect key={i} x={-5} y={-2} width="10" height="4" rx="1" fill={String(cor)} opacity="0.75" transform={`translate(${x} ${y}) rotate(${rot})`} />
          ))}
          <circle cx="86" cy="58" r="2.5" fill="#fff" opacity="0.7" />
          <circle cx="12" cy="84" r="2" fill="#ffd43b" opacity="0.7" />
        </g>
      )
    case 'coracoes':
      return (
        <g fill={BRANCO}>
          {[
            [22, 26, 1],
            [86, 20, 0.7],
            [58, 70, 1.2],
            [16, 100, 0.8],
            [104, 92, 1],
          ].map(([x, y, s], i) => (
            <path key={i} transform={`translate(${x} ${y}) scale(${s})`} d="M0 6C-7 0-9-4-6-7c2-2 5-1 6 1 1-2 4-3 6-1 3 3 1 7-6 13z" />
          ))}
        </g>
      )
    case 'ovos':
      return (
        <g>
          {[
            [24, 30, -15, '#ffe066'],
            [84, 24, 12, '#ffffff'],
            [54, 78, 8, '#b2f2bb'],
            [108, 92, -10, '#ffc9de'],
            [16, 100, 14, '#ffffff'],
          ].map(([x, y, rot, cor], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`} opacity="0.7">
              <ellipse rx="8" ry="10.5" fill={String(cor)} />
              <path d="M-7.5 -1 L-3 -4 L1 -1 L5 -4 L7.6 -1.6" stroke="rgb(0 0 0 / 0.18)" strokeWidth="1.3" fill="none" />
            </g>
          ))}
        </g>
      )
    case 'baloes':
      return (
        <g>
          {[
            [24, 34, '#ffd43b'],
            [80, 22, '#ffffff'],
            [56, 80, '#63e6be'],
            [108, 86, '#ff8787'],
          ].map(([x, y, cor], i) => (
            <g key={i} transform={`translate(${x} ${y})`} opacity="0.75">
              <ellipse rx="8" ry="10" fill={String(cor)} />
              <path d="M0 10 q3 6 -1 12 q-3 5 1 9" stroke={BRANCO} strokeWidth="1" fill="none" />
            </g>
          ))}
        </g>
      )
    case 'morcegos':
      return (
        <g fill="rgb(0 0 0 / 0.35)">
          {[
            [26, 24, 1],
            [88, 40, 0.75],
            [50, 86, 0.9],
            [108, 104, 0.6],
          ].map(([x, y, s], i) => (
            <path
              key={i}
              transform={`translate(${x} ${y}) scale(${s})`}
              d="M0 0c-2-3-5-4-8-3 1 2 0 4-2 5-2-2-5-2-7 0 4 0 6 3 7 6 2-2 5-2 7 0 1-2 2-3 3-3s2 1 3 3c2-2 5-2 7 0 1-3 3-6 7-6-2-2-5-2-7 0-2-1-3-3-2-5-3-1-6 0-8 3z"
            />
          ))}
          <g transform="translate(16 74)" opacity="0.9">
            <ellipse rx="9" ry="7.5" fill="#ffa94d" />
            <path d="M0 -7 v-4" stroke="#2b8a3e" strokeWidth="2" />
          </g>
        </g>
      )
    case 'etiquetas':
      return (
        <g stroke={BRANCO} strokeWidth="1.6" fill="none" strokeLinejoin="round">
          {[
            [22, 26, -20],
            [88, 30, 15],
            [54, 82, 10],
            [108, 100, -12],
          ].map(([x, y, rot], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`}>
              <path d="M-10 -6h14l6 6-6 6h-14z" />
              <circle cx="5" cy="0" r="1.5" />
            </g>
          ))}
          <text x="30" y="60" fontSize="14" fontWeight="800" fill={BRANCO} stroke="none">%</text>
        </g>
      )
    case 'estrelas':
      return (
        <g fill={BRANCO_FORTE}>
          {[
            [20, 24, 1],
            [86, 18, 0.7],
            [56, 66, 1.2],
            [14, 100, 0.7],
            [104, 88, 0.9],
          ].map(([x, y, s], i) => (
            <path key={i} transform={`translate(${x} ${y}) scale(${s})`} d="M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2z" />
          ))}
        </g>
      )
    case 'bandeirinhas':
      // A guirlanda vai inteira no topo (ver `Bandeirinhas`); aqui só os pontinhos.
      return (
        <g fill={BRANCO}>
          <circle cx="20" cy="70" r="1.6" />
          <circle cx="80" cy="100" r="1.6" />
          <circle cx="104" cy="52" r="1.6" />
        </g>
      )
    default:
      // Sem data: pontinhos finos, a trama de sempre da vitrine.
      return (
        <g fill="rgb(255 255 255 / 0.22)">
          {Array.from({ length: 36 }, (_, i) => (
            <circle key={i} cx={(i % 6) * 22 + 6} cy={Math.floor(i / 6) * 22 + 6} r="1.3" />
          ))}
        </g>
      )
  }
}

const CORES_BANDEIRA = ['#ffd43b', '#ff6b6b', '#4dabf7', '#69db7c', '#ffffff', '#f783ac']

function Bandeirinhas() {
  const n = 26
  return (
    <svg aria-hidden viewBox={`0 0 ${n * 30} 44`} preserveAspectRatio="xMidYMin slice" className="absolute inset-x-0 top-0 h-11 w-full">
      <path d={`M0 6 Q${(n * 30) / 2} 22 ${n * 30} 6`} stroke="rgb(255 255 255 / 0.7)" strokeWidth="1.5" fill="none" />
      {Array.from({ length: n }, (_, i) => {
        const x = i * 30 + 4
        // A linha faz uma curva: a bandeirinha desce junto com ela.
        const t = (x + 11) / (n * 30)
        const y = 6 + 16 * 4 * t * (1 - t) * 0.5 + 2
        return <path key={i} d={`M${x} ${y} h22 l-11 16z`} fill={CORES_BANDEIRA[i % CORES_BANDEIRA.length]} opacity="0.9" />
      })}
    </svg>
  )
}

/** O fundo da capa: a cor do tema em degradê e a arte da data por cima. */
export function ArteDaCapa({ arte, foto = null, className = '' }: { arte: Arte | null; foto?: string | null; className?: string }) {
  // Com a foto da loja, ela é o fundo; a arte da data (se houver) vem por
  // cima, e a trama de sempre não entra (a foto já é a cara da loja).
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={foto} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--marca)_0%,var(--marca-forte,var(--marca))_100%)]" />
      )}
      {foto && !arte ? null : (
        <svg className={`absolute inset-0 h-full w-full ${arte === 'neve' || arte === 'confete' ? 'vt-cair' : ''}`}>
          <defs>
            <pattern id={`vt-arte-${arte ?? 'base'}`} width="150" height="150" patternUnits="userSpaceOnUse">
              <Motivo arte={arte} />
            </pattern>
          </defs>
          <rect width="100%" height="200%" y="-100%" fill={`url(#vt-arte-${arte ?? 'base'})`} />
        </svg>
      )}
      {arte === 'bandeirinhas' ? <Bandeirinhas /> : null}
      {/* A base escurece um pouco: o nome e a logo ficam sempre legíveis. */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/20 to-transparent" />
    </div>
  )
}
