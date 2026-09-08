import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Não anunciar a versão do framework. Não é defesa de verdade, mas é uma
  // linha a menos na lista de "o que roda aqui" de quem varre a internet
  // procurando versão com falha conhecida.
  poweredByHeader: false,
  // O Prisma e o pg nao devem ser empacotados pelo bundler do servidor.
  serverExternalPackages: ['@prisma/client', 'pg'],
  images: {
    // O padrão do Next 16 é permitir SÓ qualidade 75, e 75 aparece nas fotos
    // da faixa de ramos: prateleira de caixa e freezer de sorvete são detalhe
    // fino repetido, que é o pior caso para JPEG. 90 nessas, 75 no resto.
    qualities: [75, 90],
  },
}

export default config
