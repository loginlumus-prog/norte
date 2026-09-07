import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Não anunciar a versão do framework. Não é defesa de verdade, mas é uma
  // linha a menos na lista de "o que roda aqui" de quem varre a internet
  // procurando versão com falha conhecida.
  poweredByHeader: false,
  // O Prisma e o pg nao devem ser empacotados pelo bundler do servidor.
  serverExternalPackages: ['@prisma/client', 'pg'],
}

export default config
