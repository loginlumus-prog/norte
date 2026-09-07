import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // O Prisma e o pg nao devem ser empacotados pelo bundler do servidor.
  serverExternalPackages: ['@prisma/client', 'pg'],
}

export default config
