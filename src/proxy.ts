// Os cabeçalhos de segurança, aplicados a toda página.
//
// Não existe um botão "ligar segurança". O que existe é uma lista de coisas
// que o navegador só deixa de fazer se a gente pedir — e o padrão do navegador
// é permissivo, porque a web antiga dependia disso. Cada cabeçalho aqui fecha
// uma porta específica, e cada um está comentado com a porta que fecha.
//
// ── por que nonce, e o que ele custa ─────────────────────────
// A defesa central é a CSP: o navegador só executa script que veio com o
// bilhete (`nonce`) sorteado nesta requisição. Se um dia alguma entrada do
// sistema deixar passar `<script>` — nome de produto, observação da venda,
// mensagem que chegou do WhatsApp — o navegador simplesmente não roda, porque
// aquele script não tem bilhete e o bilhete muda a cada carregamento.
//
// O custo é que toda página passa a ser renderizada por requisição (o bilhete
// é diferente a cada vez, então nada pode ficar em cache estático). Para este
// sistema isso não muda nada: toda tela já lê cookie de sessão, e página que
// lê cookie já era dinâmica.

import { NextResponse, type NextRequest } from 'next/server'

const DEV = process.env.NODE_ENV === 'development'

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const politica = [
    // Nada carrega de fora, a não ser o que estiver listado abaixo.
    `default-src 'self'`,

    // Script: só o que tem o bilhete desta requisição.
    // 'strict-dynamic' deixa um script com bilhete carregar os pedaços dele
    // (é assim que o Next carrega os bundles) sem abrir a mão para o resto.
    // 'unsafe-eval' é só no desenvolvimento: o React usa eval para remontar a
    // pilha de erro do servidor no navegador. Em produção ele não usa.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ''}`,

    // Folha de estilo: mesma regra. No desenvolvimento o Next injeta o CSS
    // como <style> sem bilhete, então lá vale 'unsafe-inline'.
    `style-src 'self' ${DEV ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,

    // ATRIBUTO style="" é outra diretiva, e esta a gente precisa liberar: a
    // cor da marca de cada empresa é aplicada assim (`style={{ background }}`),
    // e ela vem do banco, por empresa. Liberar atributo é bem menos perigoso
    // que liberar <style>: atributo não executa código, no máximo pinta.
    `style-src-attr 'unsafe-inline'`,

    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    // Requisição de dados só para a própria origem. No desenvolvimento, o
    // recarregamento automático fala por websocket.
    `connect-src 'self'${DEV ? ' ws: wss:' : ''}`,

    // Fecha o que não usamos. Plugin, applet, Flash: nada disso existe aqui.
    `object-src 'none'`,
    // Impede que um <base> injetado reescreva o destino de todo link relativo.
    `base-uri 'self'`,
    // Formulário desta página só posta para esta origem — trava o phishing que
    // injeta um form apontando para fora.
    `form-action 'self'`,
    // Ninguém coloca o sistema dentro de um iframe. É o que impede
    // clickjacking: uma página falsa por cima, e o clique da pessoa cai aqui.
    `frame-ancestors 'none'`,
    ...(DEV ? [] : ['upgrade-insecure-requests']),
  ].join('; ')

  const cabecalhos = new Headers(request.headers)
  cabecalhos.set('x-nonce', nonce)
  cabecalhos.set('Content-Security-Policy', politica)

  const resposta = NextResponse.next({ request: { headers: cabecalhos } })

  resposta.headers.set('Content-Security-Policy', politica)

  // O navegador respeita o Content-Type que a gente mandou em vez de adivinhar
  // pelo conteúdo. Sem isto, um arquivo enviado pelo cliente pode ser servido
  // como imagem e executado como script.
  resposta.headers.set('X-Content-Type-Options', 'nosniff')

  // O mesmo que frame-ancestors, para navegador que não entende CSP.
  resposta.headers.set('X-Frame-Options', 'DENY')

  // O endereço da tela do cliente não vaza para site de terceiro. Nossas URLs
  // têm o nome da empresa dentro (`/padaria-do-ze/financeiro`).
  resposta.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Câmera, microfone, localização e pagamento: ninguém pede, então ninguém
  // pode. Fechar antes de precisar é mais barato que descobrir depois.
  resposta.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  )

  // Isola a janela: página aberta por nós não mantém referência para mexer
  // aqui, e vice-versa.
  resposta.headers.set('Cross-Origin-Opener-Policy', 'same-origin')

  // Só HTTPS, por dois anos, incluindo subdomínio. Em desenvolvimento não —
  // travaria o http://localhost do navegador por dois anos.
  if (!DEV) {
    resposta.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    )
  }

  return resposta
}

export const config = {
  matcher: [
    // Tudo, menos arquivo estático e prefetch — que não carregam script novo
    // e não precisam de bilhete.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\.svg$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
