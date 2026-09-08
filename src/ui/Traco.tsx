// O traço de fundo: desenho vetorial que dá acabamento sem virar enfeite.
//
// ── de onde vem o desenho ────────────────────────────────────
// Do próprio símbolo. A marca é uma agulha apontando para o norte, então o
// fundo é o resto do instrumento: a rosa dos ventos e a curva de nível do
// mapa. Nada aqui foi escolhido por ser bonito — foi escolhido por ser a
// continuação da mesma ideia, que é o que separa identidade de papel de parede.
//
// ── as três regras ───────────────────────────────────────────
// 1. NUNCA atrás de número ou de texto que se lê. Fundo desenhado embaixo de
//    tabela é a diferença entre uma tela cara e uma tela cansativa; ele mora
//    só onde não há dado — entrada, vazio, rodapé da barra.
// 2. Traço, não mancha. Linha fina em opacidade baixa continua nítida em
//    qualquer tela; mancha degradê vira faixa suja em monitor ruim, que é o
//    monitor que a loja tem.
// 3. Herda a cor de quem o contém (`currentColor`). Assim o mesmo desenho
//    serve no azul da barra e no papel do claro sem uma segunda versão para
//    manter sincronizada.

/**
 * A rosa dos ventos. Grande, cortada pela borda, opacidade de marca d'água.
 *
 * É o desenho de "onde eu estou" — que é literalmente o que o sistema
 * responde. Fica atrás da tela de entrada e dos estados vazios.
 */
export function Bussola({
  tamanho = 520,
  className,
}: {
  tamanho?: number
  className?: string
}) {
  const C = 100
  // ── as medidas ──
  // Não são chutadas: é a proporção de rosa dos ventos de carta náutica, onde
  // a ponta menor tem ~62% da maior (o mesmo 0,618 que rege o resto). Foi o
  // que faltava na primeira versão — pontas iguais viram estrela de adesivo.
  const R_MAIOR = 74
  const R_MENOR = 46
  const R_MIOLO = 9
  const ANEL_FORA = 92
  const ANEL_DENTRO = 84

  const ponto = (grau: number, raio: number) => {
    const r = ((grau - 90) * Math.PI) / 180
    return [C + raio * Math.cos(r), C + raio * Math.sin(r)] as const
  }
  const fmt = ([x, y]: readonly [number, number]) => `${x.toFixed(2)} ${y.toFixed(2)}`

  // Uma ponta da rosa: contorno em losango mais a espinha que vai do centro à
  // ponta. A espinha é o que dá a dobra de luz da rosa gravada — sem ela o
  // desenho é um triângulo, com ela é um instrumento.
  const pontas = Array.from({ length: 8 }, (_, i) => {
    const grau = i * 45
    const cardeal = i % 2 === 0
    const raio = cardeal ? R_MAIOR : R_MENOR
    const bico = ponto(grau, raio)
    const esq = ponto(grau - 45, R_MIOLO)
    const dir = ponto(grau + 45, R_MIOLO)
    return {
      contorno: `M ${fmt(esq)} L ${fmt(bico)} L ${fmt(dir)}`,
      espinha: `M ${C} ${C} L ${fmt(bico)}`,
      cardeal,
    }
  })

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 200 200"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {/* O anel graduado: risco de 5 em 5 graus, mais longo de 30 em 30. É a
          graduação que faz o desenho ler como instrumento e não como enfeite. */}
      <circle cx={C} cy={C} r={ANEL_FORA} strokeWidth="0.6" opacity="0.45" />
      <circle cx={C} cy={C} r={ANEL_DENTRO} strokeWidth="0.6" opacity="0.45" />
      {Array.from({ length: 72 }, (_, i) => {
        const grau = i * 5
        const cheio = grau % 30 === 0
        const de = ponto(grau, cheio ? ANEL_DENTRO : ANEL_FORA - 3.5)
        const ate = ponto(grau, ANEL_FORA)
        return (
          <line
            key={i}
            x1={de[0]}
            y1={de[1]}
            x2={ate[0]}
            y2={ate[1]}
            strokeWidth={cheio ? 0.9 : 0.5}
            opacity={cheio ? 0.5 : 0.28}
          />
        )
      })}

      {/* Os anéis internos, que dão a caixa do instrumento. */}
      <circle cx={C} cy={C} r={R_MAIOR} strokeWidth="0.5" opacity="0.22" />
      <circle cx={C} cy={C} r={R_MENOR} strokeWidth="0.5" opacity="0.22" />
      <circle cx={C} cy={C} r={R_MIOLO} strokeWidth="0.7" opacity="0.5" />

      {pontas.map((p, i) => (
        <g key={i}>
          <path d={p.contorno} strokeWidth={p.cardeal ? 0.9 : 0.7} opacity={p.cardeal ? 0.62 : 0.4} />
          <path d={p.espinha} strokeWidth={p.cardeal ? 0.7 : 0.5} opacity={p.cardeal ? 0.42 : 0.26} />
        </g>
      ))}

      {/* A ponta do norte, sozinha, um pouco mais viva: é o nome da empresa. */}
      <path d={pontas[0]!.contorno} strokeWidth="1.1" opacity="0.85" />
    </svg>
  )
}

/**
 * Curva de nível. Linguagem de mapa, e é a que dá a textura "cara" sem cor.
 *
 * Não é aleatória: são arcos concêntricos deslocados, como terreno subindo
 * para um ponto fora da tela — o norte de novo, só que como relevo.
 */
export function Curvas({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 220"
      fill="none"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden
      focusable="false"
    >
      {Array.from({ length: 9 }, (_, i) => {
        // Cada curva sobe e afina: as de cima são o cume, mais claras.
        const y = 210 - i * 22
        const curva = 44 + i * 10
        return (
          <path
            key={i}
            d={`M-20 ${y} Q 120 ${y - curva} 210 ${y - curva / 3} T 420 ${y - curva / 2}`}
            stroke="currentColor"
            strokeWidth={0.8}
            opacity={0.42 - i * 0.035}
          />
        )
      })}
    </svg>
  )
}

/**
 * O sol nascendo em raios. Para a beira de cima de blocos escuros.
 *
 * É a metade "norte" do símbolo aberta em leque. Fica muito discreto de
 * propósito: aqui ele é luz, não é figura.
 */
export function Raios({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 150"
      fill="none"
      preserveAspectRatio="xMidYMin slice"
      className={className}
      aria-hidden
      focusable="false"
    >
      {Array.from({ length: 13 }, (_, i) => {
        const ang = -80 + i * 13.3
        const rad = (ang * Math.PI) / 180
        return (
          <line
            key={i}
            x1={150}
            y1={150}
            x2={150 + 260 * Math.sin(rad)}
            y2={150 - 260 * Math.cos(rad)}
            stroke="currentColor"
            strokeWidth="0.7"
            opacity={0.3 - Math.abs(i - 6) * 0.02}
          />
        )
      })}
      <circle cx="150" cy="150" r="46" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
      <circle cx="150" cy="150" r="72" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
    </svg>
  )
}
