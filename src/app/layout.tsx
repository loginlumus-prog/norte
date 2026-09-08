import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Plus_Jakarta_Sans, Geist } from 'next/font/google'
import './globals.css'

// ── as duas fontes, e por que estas ──────────────────────────
// O sistema inteiro estava na fonte do sistema operacional. Ela é ótima para
// ler e não tem opinião nenhuma — e é a falta de opinião que faz uma tela
// parecer formulário interno em vez de produto.
//
// A referência de "bonito" veio da Gilroy, que é a fonte do outro projeto:
// geométrica, bojos redondos, moderna sem ser divertida. Ela é PAGA, e a
// licença de um site não cobre um sistema vendido para vários clientes — então
// aqui entra a parente livre mais próxima.
//
// DISPLAY (Plus Jakarta Sans) — títulos, preços e a marca. Mesma família de
// desenho da Gilroy: geométrica com bojo redondo, terminais retos, sem os
// maneirismos que fazem fonte de cartaz. Usada só grande e pesada, que é onde
// caractere se vê.
//
// TEXTO (Geist) — tudo que se lê de verdade: rótulo, tabela, formulário, valor
// de dinheiro. É a mais atual das fontes de interface, desenhada para tela
// pequena, com números de largura fixa — que é o que faz coluna de preço
// alinhar. Geométrica não serve aqui: a 13px ela fecha as contraformas e
// cansa quem passa o dia na tela.
//
// `next/font` baixa e serve as duas do nosso próprio domínio. Isso importa por
// dois motivos: a política de segurança do sistema não permite pedir arquivo a
// domínio de fora, e fonte que vem de fora deixa o texto invisível enquanto
// carrega.
//
// TROCAR PELA GILROY é trivial se a licença cobrir: `localFont` apontando para
// os cinco .woff2, e nada mais no sistema muda — o resto todo lê `--fonte-*`.
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--fonte-display',
  display: 'swap',
})

const texto = Geist({
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
