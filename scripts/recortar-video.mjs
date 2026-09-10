// Transforma o MP4 que veio do gerador em vídeo com FUNDO TRANSPARENTE, do
// jeito que a página precisa.
//
//   npm run video                    → converte tudo que está em .video/bruto
//   npm run video -- cena-sistema    → converte só um
//
// ── por que existe este passo ────────────────────────────────
// As artes do site são recortes: 40% de cada PNG é transparente, e é a aurora
// da página que aparece por baixo. MP4 não tem canal alfa — então um vídeo
// gerado a partir dessas artes chegaria como um RETÂNGULO opaco, com uma
// borda visível em cima do fundo da seção.
//
// A saída é WebM/VP9 com alfa, que o navegador compõe igual ao PNG.
//
// ── o caminho, em quatro passos ──────────────────────────────
// 1. RECORTE. A arte foi enviada ao gerador sobre um campo de MAGENTA puro,
//    uma cor que não existe em lugar nenhum da paleta (laranja, creme, verde,
//    azul, preto). Aqui ela vira transparência.
//
// 2. EROSÃO. O recorte sozinho deixa um halo magenta de 1px em cada borda —
//    a franja do serrilhado, onde o pixel é meio arte, meio fundo. Comer 1px
//    da alfa resolve, e é invisível: o traço desta arte tem contorno preto
//    grosso, então 1px a menos não muda desenho nenhum.
//
//    Os números não foram chutados. Com similaridade 0.30 o vazado bate
//    exatamente os 41,3% de transparência do PNG de origem; abaixo disso
//    sobra franja, acima começa a comer arte.
//
// 3. AZUL POR BAIXO. Nos canais de cor, o que virou transparente recebe o
//    azul da seção. Isso não aparece em navegador nenhum que entenda alfa —
//    é rede de segurança: se um dia algum navegador ignorar o canal alfa, ele
//    mostra a cena sobre azul, e não sobre um bloco magenta.
//
// 4. TAMANHO. O gerador devolve ~1776px de largura; a cena do topo é
//    desenhada com ~650px e a dos ramos com ~235px. Ficam 1280 e 640, que
//    cobrem tela retina sem carregar megabyte à toa.

import { execFileSync } from 'node:child_process'
import { readdirSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(import.meta.dirname, '..')
const entrada = join(raiz, '.video', 'bruto')
const saida = join(raiz, 'public', 'video')

// A cor do recorte, como ela chega DEPOIS da compressão do gerador: o magenta
// puro (255,0,255) volta como (254,0,250). Medido, não suposto.
const CHAVE = '0xFE00FA'
const SIMILARIDADE = '0.30'
const AZUL = '0x101F4A' // --nav do tema claro; ver src/app/globals.css

// A cena do topo é grande na tela; as dos ramos são caixinhas de ~235px.
const LARGURA = (nome) => (nome === 'cena-sistema' ? 1280 : 640)

if (!existsSync(entrada)) {
  console.error(`\n  Não achei ${entrada}.\n  Ponha os MP4 do gerador lá e rode de novo.\n`)
  process.exit(1)
}

mkdirSync(saida, { recursive: true })

const pedido = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const arquivos = readdirSync(entrada)
  .filter((f) => f.endsWith('.mp4'))
  .filter((f) => pedido.length === 0 || pedido.includes(f.replace('.mp4', '')))

if (arquivos.length === 0) {
  console.error(`\n  Nenhum .mp4 em ${entrada}${pedido.length ? ` com o nome ${pedido.join(', ')}` : ''}.\n`)
  process.exit(1)
}

console.log(`\n  Recortando ${arquivos.length} vídeo(s)\n`)

for (const arquivo of arquivos) {
  const nome = arquivo.replace('.mp4', '')
  const de = join(entrada, arquivo)
  const para = join(saida, `${nome}.webm`)

  // O tamanho do quadro precisa ser lido: o gerador não devolve exatamente a
  // proporção que entrou, e o `color=` do filtro exige medida exata.
  const medida = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    de,
  ]).toString().trim()

  const filtro = [
    `color=c=${AZUL}:s=${medida.replace(',', 'x')}:r=24[bg]`,
    `[0:v]colorkey=${CHAVE}:${SIMILARIDADE}:0.0,format=rgba,split[c][m]`,
    `[m]alphaextract,erosion[a]`,
    `[bg][c]overlay=shortest=1,format=rgba[rgb]`,
    `[rgb][a]alphamerge,scale=${LARGURA(nome)}:-2,format=yuva420p[out]`,
  ].join(';')

  execFileSync('ffmpeg', [
    '-v', 'error',
    '-i', de,
    '-filter_complex', filtro,
    '-map', '[out]',
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-b:v', '0',
    '-crf', '34',
    '-row-mt', '1',
    '-an',
    '-y', para,
  ])

  // O PÔSTER. É ele que a pessoa vê no primeiro instante — e é ele que fica
  // para sempre em quem pediu menos movimento no sistema. Sai do PRIMEIRO
  // quadro do próprio WebM, então já vem recortado e já bate exatamente com
  // o quadro em que o vídeo começa: não existe piscada na hora que um vira o
  // outro. WebP porque precisa de alfa e precisa ser leve.
  const poster = join(saida, `${nome}-poster.webp`)
  execFileSync('ffmpeg', [
    '-v', 'error',
    '-c:v', 'libvpx-vp9',
    '-i', para,
    '-frames:v', '1',
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-q:v', '82',
    '-y', poster,
  ])

  const kb = (statSync(para).size / 1024).toFixed(0)
  const kbP = (statSync(poster).size / 1024).toFixed(0)
  console.log(
    `  ${nome.padEnd(18)} ${medida.replace(',', 'x')} → ${LARGURA(nome)}px   ${kb} kB   pôster ${kbP} kB`,
  )
}

console.log(`\n  Pronto. Em public/video/.\n`)
