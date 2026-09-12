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
  // A arte de fundo pesa, e sem isto ela volta pelo fio a cada navegação.
  //
  // O relevo e a carta celeste têm 230 e 250 KB cada um: são vetores traçados,
  // com centenas de formas, e é daí que vem o acabamento de gravura. O Next
  // serve o que está em `public/` com `max-age=0`, então o navegador pergunta
  // de novo por cada um a cada tela — numa loja no 4G isso é a diferença entre
  // o painel abrir e o painel demorar.
  //
  // Trinta dias, sem `immutable`: são arquivos de marca, mudam quase nunca,
  // mas quando mudarem a gente quer que o navegador perceba sem precisar
  // renomear tudo.
  async headers() {
    return [
      {
        source: '/:arte(norte-[a-z-]+\\.svg)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }],
      },
    ]
  },
  images: {
    // O padrão do Next 16 é permitir SÓ qualidade 75, e 75 aparece nas fotos
    // da faixa de ramos: prateleira de caixa e freezer de sorvete são detalhe
    // fino repetido, que é o pior caso para JPEG. 90 nessas, 75 no resto.
    qualities: [75, 90],
  },
}

export default config
