import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import localFont from 'next/font/local'
import { Figtree } from 'next/font/google'
import './globals.css'

// ── as duas fontes, e por que estas ──────────────────────────
// A referência é a Klarheit Grotesk, do site que a gente estudou: grotesca com
// desenho próprio, que aguenta peso alto sem virar bloco. Ela é PAGA.
//
// DISPLAY (Cabinet Grotesk) — a parente livre mais próxima, do Fontshare.
// Mesma família de desenho: grotesca geométrica com terminais retos, 'a' de
// dois andares e 'g' de uma perna. É desenhada para o peso pesado — é lá que
// ela tem caractere, e é exatamente onde a gente usa.
//
// Vem como fonte VARIÁVEL num arquivo só de 41 KB, cobrindo do 100 ao 900. Uma
// fonte estática por peso custaria cinco arquivos e cinco downloads; a
// variável interpola, então dá para usar 780 se 700 for leve e 800 for pesado.
//
// TEXTO (Figtree) — geométrica de contraforma aberta, feita para tela. Segura
// tudo que se lê de verdade: rótulo, tabela, formulário, dinheiro. Grotesca de
// display não desce para 13px sem fechar as contraformas.
//
// Já foi a Manrope. Ela é fina e estreita: o texto corrido em 14px parecia
// apagado, e o negrito dela (800 é o teto) não destacava do semibold. A
// Figtree vai até 900, tem o "a" e o "g" mais redondos — lê mais viva — e
// aguenta o peso do texto um degrau acima (ver os pesos no globals.css).
//
// A licença (Fontshare Free License) está em `src/app/fontes/License/`, e ela
// cobre uso comercial — o que importa aqui, porque isto é um produto vendido a
// terceiros e não um site só.
const display = localFont({
  src: './fontes/CabinetGrotesk-Variable.woff2',
  variable: '--fonte-display',
  display: 'swap',
  weight: '100 900',
})

const texto = Figtree({
  subsets: ['latin'],
  variable: '--fonte-texto',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Norte',
  description: 'Gestão da empresa, do balcão ao WhatsApp.',
}

export default async function LayoutRaiz({ children }: { children: React.ReactNode }) {
  // O tema vem do cookie já na primeira renderização. Se fosse decidido no
  // navegador, a tela piscaria clara antes de escurecer — feio, e cansa a
  // vista de quem trabalha no escuro.
  // Sempre carimbado: o claro é o padrão, e o escuro só com escolha. Sem o
  // carimbo, o computador com o sistema no escuro abria o Norte preto.
  const escolhido = (await cookies()).get('tema')?.value === 'escuro' ? 'escuro' : 'claro'

  return (
    <html
      lang="pt-BR"
      data-tema={escolhido}
      className={`${display.variable} ${texto.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  )
}
