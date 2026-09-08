import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Newsreader, Manrope } from 'next/font/google'
import './globals.css'

// ── as duas fontes, e por que estas ──────────────────────────
// O par vem do BC Hub, e é o mais bonito dos três que testamos aqui.
//
// DISPLAY (Newsreader) — uma serifada de texto, usada LEVE e GRANDE. É a
// escolha que mais diferencia: todo sistema de gestão do mercado usa a mesma
// geométrica sem graça, e uma serifada editorial num painel de loja é
// inesperada do jeito certo — lê como publicação, não como formulário.
//
// Os pesos importam mais que a fonte: 200 só no título gigante da capa, 300 a
// 400 nos títulos de seção. Serifada leve em tamanho pequeno vira borrão, e é
// por isso que ela NÃO desce para rótulo nem para tabela.
//
// TEXTO (Manrope) — geométrica com contraforma aberta, feita para tela. Ela
// segura tudo que se lê de verdade: rótulo, tabela, formulário e dinheiro. O
// contraste entre a serifada e ela é o que faz a hierarquia funcionar sem
// precisar de caixa nenhuma em volta — que é justamente o que a gente tirou.
//
// `next/font` baixa e serve as duas do nosso próprio domínio: a política de
// segurança não permite pedir arquivo a domínio de fora, e fonte externa deixa
// o texto invisível enquanto carrega.
const display = Newsreader({
  subsets: ['latin'],
  weight: ['200', '300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--fonte-display',
  display: 'swap',
})

const texto = Manrope({
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
  const tema = (await cookies()).get('tema')?.value
  const escolhido = tema === 'claro' || tema === 'escuro' ? tema : undefined

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
