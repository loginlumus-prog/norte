// O traço de fundo: o desenho que dá acabamento sem virar enfeite.
//
// ── de onde vem a arte ───────────────────────────────────────
// A rosa dos ventos e o relevo em curva de nível foram gerados no Magnific
// (vetor, Recraft) e ficam em `public/`. Eles continuam a mesma ideia do
// símbolo — a marca é uma agulha apontando para o norte, e o fundo é o resto
// do instrumento: a bússola e o mapa.
//
// ── por que MISTURA, e não recolorir o desenho ───────────────
// A tentativa óbvia é trocar a cor de todo traço por `currentColor`. Ela
// destrói o desenho, e vale entender por quê: o vetor traçado tem 63 formas,
// e 35 delas são BRANCAS — são elas que furam o desenho, como o vazado de um
// carimbo. Pintando todas da mesma cor, os furos somem e a bússola vira um
// disco com quatro espinhos. Foi exatamente o que aconteceu aqui.
//
// A saída é não mexer no arquivo e deixar o navegador misturar:
//
//   • sobre ESCURO — a NEGATIVA (traço claro sobre preto) com
//     `screen`. Preto em screen não muda nada, então o fundo some sozinho e
//     só o traço aparece, clareando o que está embaixo. Funciona por cima do
//     degradê da barra, coisa que cor chapada não faria.
//   • sobre CLARO — a POSITIVA (traço escuro sobre branco) com
//     `multiply`. Branco em multiply não muda nada, e o traço escurece.
//
// Nos dois casos o fundo do arquivo desaparece de graça, sem recorte, sem
// máscara e sem perder os tons de cinza do traço — que são o que faz o
// desenho parecer gravura em vez de contorno.
//
// ── as duas regras que sobraram ──────────────────────────────
// 1. NUNCA atrás de número ou de texto que se lê. Fundo desenhado embaixo de
//    tabela é a diferença entre tela cara e tela cansativa: ele mora só onde
//    não há dado — entrada, erro, vazio.
// 2. Opacidade baixa e SEMPRE `pointer-events-none`: é papel de parede, não
//    pode roubar clique de nada.

type Arte = 'bussola' | 'relevo'

// Duas versões de cada arte, como a marca tem: POSITIVA (traço escuro sobre
// branco) e NEGATIVA (traço claro sobre preto). A negativa não foi gerada de
// novo — ela é a positiva com as cores invertidas exatamente, canal por canal.
// Pedir ao modelo um segundo desenho "igual, só que claro" traria OUTRO
// desenho: bastam três riscos fora do lugar para as duas versões deixarem de
// ser a mesma marca, e aí o material impresso e a tela discordam.
const ARQUIVO: Record<Arte, string> = {
  bussola: '/norte-bussola',
  relevo: '/norte-relevo',
}

export function Traco({
  arte,
  sobre,
  className,
  opacidade,
}: {
  arte: Arte
  /** A cor da superfície onde ele vai pousar — não o tema da pessoa. */
  sobre: 'escuro' | 'claro'
  className?: string
  opacidade?: number
}) {
  const escuro = sobre === 'escuro'
  return (
    <img
      src={`${ARQUIVO[arte]}${escuro ? '-negativo' : ''}.svg`}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
      style={{
        mixBlendMode: escuro ? 'screen' : 'multiply',
        opacity: opacidade ?? (escuro ? 0.16 : 0.07),
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />
  )
}
