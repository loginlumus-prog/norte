// O manifesto do "instalar como app" — um por empresa.
//
// O tablet do balcão instala o Norte na tela inicial e abre em tela cheia,
// sem barra de endereço. O convencional do Next (`app/manifest.ts`) é um só
// para o site inteiro, e aí o app instalado abriria na página de venda do
// Norte, não na loja. Aqui o endereço de partida e o escopo são os da
// empresa, e o nome embaixo do ícone é o dela.
//
// Sem service worker, de propósito: guardar tela em cache num sistema de
// caixa é mostrar saldo de ontem como se fosse de agora. Sem rede, o tablet
// mostra que está sem rede — que é a verdade.

import { acharOrgPorSlug } from '@/servidor/banco'

export async function GET(_: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const empresa = await acharOrgPorSlug(slug)
  if (!empresa) return new Response('não encontrado', { status: 404 })

  const inicio = `/${empresa.slug}`
  const manifesto = {
    id: inicio,
    name: `${empresa.nome} · Norte`,
    short_name: empresa.nome.length <= 12 ? empresa.nome : 'Norte',
    description: 'Gestão da empresa, do balcão ao WhatsApp.',
    lang: 'pt-BR',
    start_url: inicio,
    // Sem barra no fim: o endereço de partida (`/exemplo`) precisa estar
    // DENTRO do escopo, e `/exemplo` não está dentro de `/exemplo/`.
    scope: inicio,
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f7f9',
    theme_color: '#f6f7f9',
    icons: [
      { src: '/marca/norte-app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/marca/norte-app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/marca/norte-app-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/marca/norte-app-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
    ],
  }
  return new Response(JSON.stringify(manifesto), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      // Nome e endereço da empresa mudam quase nunca; uma hora poupa a
      // pergunta a cada tela sem prender um nome trocado por dias.
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
