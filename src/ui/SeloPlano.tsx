// Um selo para cada plano.
//
// ── por que desenhado à mão, e não gerado ────────────────────
// Estes são diagramas, não ilustrações: pontos e linhas em posições exatas,
// vistos a 40 pixels. Modelo generativo entrega aproximação — e aproximação
// num diagrama de quatro pontos aparece. Além disso, cada um sai com 1 KB e
// herda a cor do tema; o traçado gerado sai com 150 KB e cor fixa.
//
// ── o que os quatro contam ───────────────────────────────────
// Não são ícones de produto ("uma casinha para loja"). São o MESMO mapa em
// quatro escalas, que é como o cliente sobe de plano na vida real:
//
//   Balcão      um ponto. Uma loja, e o sistema em volta dela.
//   + Assistente o mesmo ponto, com um satélite orbitando: alguém junto.
//   Rede        vários pontos ligados. É a palavra do plano, desenhada.
//   Corporativo o mapa inteiro, com a rosa dos ventos por trás.
//
// A progressão se lê de relance, sem legenda — e é ela que faz "subir de
// plano" parecer avançar em vez de gastar mais.

type Props = { tamanho?: number; className?: string }

const base = (tamanho: number, className?: string) => ({
  width: tamanho,
  height: tamanho,
  viewBox: '0 0 48 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
  focusable: 'false' as const,
})

export function SeloBalcao({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <circle cx="24" cy="22" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="24" cy="22" r="10" strokeWidth="1.2" opacity="0.45" />
      {/* O arco de baixo é o chão: dá lugar ao ponto em vez de deixá-lo solto. */}
      <path d="M8 36 Q 24 42 40 36" strokeWidth="1.2" opacity="0.35" />
    </svg>
  )
}

export function SeloAgente({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <circle cx="21" cy="24" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="21" cy="24" r="10" strokeWidth="1.2" opacity="0.45" />
      {/* O satélite: menor, fora do anel, e ligado por uma linha. É "alguém
          junto", não "mais uma loja". */}
      <circle cx="38" cy="14" r="3" fill="currentColor" stroke="none" opacity="0.8" />
      <path d="M28.5 19.5 L 35 15.5" strokeWidth="1.2" opacity="0.6" />
      <path d="M33 8 Q 42 12 41 22" strokeWidth="1" opacity="0.3" />
    </svg>
  )
}

export function SeloRede({ tamanho = 40, className }: Props) {
  // Cinco pontos ligados — o mesmo número de unidades que o plano atende.
  const pts: [number, number, number][] = [
    [24, 10, 3.6],
    [10, 20, 3],
    [38, 20, 3],
    [15, 37, 3],
    [33, 37, 3],
  ]
  return (
    <svg {...base(tamanho, className)}>
      <g strokeWidth="1.2" opacity="0.5">
        <path d="M24 10 L10 20 L15 37 L33 37 L38 20 Z" />
        <path d="M24 10 L15 37" opacity="0.5" />
        <path d="M24 10 L33 37" opacity="0.5" />
      </g>
      {pts.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="currentColor" stroke="none" />
      ))}
    </svg>
  )
}

export function SeloCorporativo({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      {/* A rosa por trás: a mesma do fundo do sistema, em miniatura. */}
      <circle cx="24" cy="24" r="20" strokeWidth="1" opacity="0.3" />
      <circle cx="24" cy="24" r="15" strokeWidth="0.8" opacity="0.2" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((g) => {
        const r = ((g - 90) * Math.PI) / 180
        const dentro = g % 90 === 0 ? 0 : 11
        return (
          <line
            key={g}
            x1={24 + dentro * Math.cos(r)}
            y1={24 + dentro * Math.sin(r)}
            x2={24 + 20 * Math.cos(r)}
            y2={24 + 20 * Math.sin(r)}
            strokeWidth={g % 90 === 0 ? 1.2 : 0.8}
            opacity={g % 90 === 0 ? 0.55 : 0.28}
          />
        )
      })}
      <circle cx="24" cy="24" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="24" cy="8" r="2.4" fill="currentColor" stroke="none" opacity="0.75" />
      <circle cx="40" cy="24" r="2.4" fill="currentColor" stroke="none" opacity="0.75" />
      <circle cx="24" cy="40" r="2.4" fill="currentColor" stroke="none" opacity="0.75" />
      <circle cx="8" cy="24" r="2.4" fill="currentColor" stroke="none" opacity="0.75" />
    </svg>
  )
}

export const SELO = {
  BALCAO: SeloBalcao,
  BALCAO_AGENTE: SeloAgente,
  REDE: SeloRede,
  CORPORATIVO: SeloCorporativo,
} as const
