import type { NextConfig } from 'next'

const origens = (process.env.NORTE_ORIGENS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const config: NextConfig = {
  reactStrictMode: true,
  // Não anunciar a versão do framework. Não é defesa de verdade, mas é uma
  // linha a menos na lista de "o que roda aqui" de quem varre a internet
  // procurando versão com falha conhecida.
  poweredByHeader: false,
  // O Prisma e o pg nao devem ser empacotados pelo bundler do servidor.
  serverExternalPackages: ['@prisma/client', 'pg'],
  // Quem mais pode disparar um Server Action, além do próprio endereço.
  //
  // O Next compara o Origin do pedido com o Host (ou X-Forwarded-Host) e recusa
  // quando diferem — é a proteção contra CSRF de server-actions.md. Hospedado
  // de verdade os dois batem, e isto fica vazio, que é o certo.
  //
  // Só faz falta quando o Norte é servido por um endereço que o servidor não
  // conhece: um túnel de demonstração, um proxy na frente. Aí entra pelo
  // ambiente, um por vírgula, em vez de ficar escrito no código — endereço
  // temporário escrito no código é endereço que ninguém lembra de tirar:
  //
  //   NORTE_ORIGENS="*.trycloudflare.com"
  ...(origens.length > 0 ? { experimental: { serverActions: { allowedOrigins: origens } } } : {}),
  images: {
    // O padrão do Next 16 é permitir SÓ qualidade 75, e 75 aparece nas fotos
    // da faixa de ramos: prateleira de caixa e freezer de sorvete são detalhe
    // fino repetido, que é o pior caso para JPEG. 90 nessas, 75 no resto.
    qualities: [75, 90],
  },
}

export default config
