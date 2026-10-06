import type { MetadataRoute } from 'next'

// O que buscador e robô de cópia podem ler. Só a página de venda e os textos
// legais são públicos; telas de empresa, API e painel de parceiro não são — e
// raspadores conhecidos de IA e de cópia de site ficam de fora de tudo.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: ['/', '/termos', '/privacidade', '/parceiros', '/parceiros/termos'], disallow: ['/api/', '/parceiros/painel', '/parceiros/entrar', '/*/'] },
      {
        userAgent: ['GPTBot', 'CCBot', 'anthropic-ai', 'ClaudeBot', 'Google-Extended', 'Bytespider', 'PerplexityBot', 'HTTrack', 'WebCopier', 'SiteSucker'],
        disallow: '/',
      },
    ],
  }
}
