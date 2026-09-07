import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'

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
    <html lang="pt-BR" data-tema={escolhido} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
