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
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 200 200"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      {/* Os dois anéis. O de fora fecha o instrumento; o de dentro dá a
          espessura do aro sem precisar de sombra. */}
      <circle cx="100" cy="100" r="88" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
      <circle cx="100" cy="100" r="72" stroke="currentColor" strokeWidth="0.5" opacity="0.32" />
      <circle cx="100" cy="100" r="34" stroke="currentColor" strokeWidth="0.5" opacity="0.32" />

      {/* Os 32 riscos do aro. Os das quatro direções principais são maiores —
          é assim que uma bússola de verdade se lê de relance. */}
      {Array.from({ length: 32 }, (_, i) => {
        const ang = (i * 360) / 32
        const principal = i % 8 === 0
        const r1 = principal ? 72 : 80
        const rad = ((ang - 90) * Math.PI) / 180
        return (
          <line
            key={i}
            x1={100 + r1 * Math.cos(rad)}
            y1={100 + r1 * Math.sin(rad)}
            x2={100 + 88 * Math.cos(rad)}
            y2={100 + 88 * Math.sin(rad)}
            stroke="currentColor"
            strokeWidth={principal ? 1 : 0.5}
            opacity={principal ? 0.55 : 0.25}
          />
        )
      })}

      {/* A agulha — a mesma forma do símbolo, em escala de instrumento. */}
      <path d="M100 22 L124 96 L100 82 L76 96 Z" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
      <path d="M100 82 L124 96 L100 170 L76 96 Z" stroke="currentColor" strokeWidth="0.6" opacity="0.35" />
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
