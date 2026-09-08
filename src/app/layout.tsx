import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Bricolage_Grotesque, Inter } from 'next/font/google'
import './globals.css'

// ── as duas fontes, e por que duas ───────────────────────────
// O sistema inteiro estava na fonte do sistema operacional. Ela é ótima para
// ler e não tem nenhuma opinião — e é exatamente essa falta de opinião que faz
// uma tela parecer um formulário interno em vez de um produto.
//
// DISPLAY (Bricolage Grotesque) — títulos, números grandes e a marca. É um
// grotesco com desenho próprio: o "g", o "a" e o corte dos terminais têm
// personalidade sem virar fonte de cartaz. Usada só em tamanho grande e peso
// alto, que é onde caractere se vê.
//
// TEXTO (Inter) — tudo que se lê de verdade: rótulo, tabela, formulário, valor
// de dinheiro. Desenhada para tela pequena, com números de largura fixa, que é
// o que faz coluna de preço alinhar.
//
// `next/font` baixa e serve as duas do nosso próprio domínio. Isso importa
// aqui por dois motivos: a política de segurança do sistema não permite pedir
// arquivo a domínio de fora, e fonte que vem de fora deixa o texto invisível
// enquanto carrega.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--fonte-display',
  display: 'swap',
})

const texto = Inter({
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
