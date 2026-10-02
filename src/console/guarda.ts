// A porta do console do Norte.
//
// O console é uma página servida pelo LAPTOP de quem opera (scripts/console.ts),
// e o processo dele segura a credencial que atravessa empresas. Então a
// pergunta "quem está pedindo?" precisa de resposta antes de qualquer outra
// coisa — e "está no meu computador" não basta: qualquer site aberto no
// mesmo navegador consegue mandar requisição para 127.0.0.1, e qualquer
// programa da máquina também.
//
// As travas, em camadas (todas puras e testadas em tests/console-guarda.test.ts):
//
// • HOST. Só 127.0.0.1:<porta> ou localhost:<porta>. Um site de fora que
//   aponte o domínio dele para 127.0.0.1 (DNS rebinding) chega com o Host
//   dele, e para aqui.
// • A CHAVE. Nasce aleatória a cada vez que o console sobe (32 bytes) e é
//   impressa no terminal como ?t=... A primeira visita troca a chave por um
//   cookie HttpOnly + SameSite=Strict e redireciona para a mesma página SEM
//   a chave no endereço (não fica no histórico). Toda requisição depois
//   precisa do cookie; sem ele, 401. Fechou o console, a chave morre.
// • O FORMULÁRIO. Todo POST precisa do campo `csrf` (outro segredo do
//   processo, só dentro das páginas servidas daqui) E do cabeçalho Origin
//   igual ao do console. SameSite=Strict já impede o cookie de ir num POST
//   vindo de outro site; os dois a mais são cinto e suspensório.
// • A COMPARAÇÃO é em tempo constante (resumo + timingSafeEqual).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type Guarda = {
  /** O segredo de entrada: vai no link do terminal e no cookie. */
  chave: string
  /** O segredo dos formulários. */
  csrf: string
  porta: number
  /** Um nome por porta: dois consoles abertos não pisam um no cookie do outro. */
  nomeCookie: string
}

export function criarGuarda(porta: number, gerar: (n: number) => Buffer = randomBytes): Guarda {
  return {
    chave: gerar(32).toString('base64url'),
    csrf: gerar(32).toString('base64url'),
    porta,
    nomeCookie: `norte_console_${porta}`,
  }
}

/** Compara dois segredos sem vazar, pelo tempo, quantas letras acertou. */
export function iguais(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function lerCookies(cabecalho: string | null | undefined): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const parte of (cabecalho ?? '').split(';')) {
    const i = parte.indexOf('=')
    if (i < 1) continue
    const nome = parte.slice(0, i).trim()
    const valor = parte.slice(i + 1).trim()
    if (nome && !(nome in saida)) {
      try {
        saida[nome] = decodeURIComponent(valor)
      } catch {
        saida[nome] = valor
      }
    }
  }
  return saida
}

/** Os endereços pelos quais o console responde. */
export const hostsAceitos = (porta: number) => [`127.0.0.1:${porta}`, `localhost:${porta}`]
export const origensAceitas = (porta: number) => hostsAceitos(porta).map((h) => `http://${h}`)

/** O que interessa de uma requisição, já separado (para testar sem rede). */
export type Pedido = {
  metodo: string
  /** Caminho com a consulta, como veio: "/empresa/x?t=..." */
  url: string
  host?: string | null
  origem?: string | null
  cookie?: string | null
  /** Sec-Fetch-Site, quando o navegador manda. */
  site?: string | null
}

export type Veredito =
  | { tipo: 'segue' }
  /** A primeira visita com a chave certa: grava o cookie e tira a chave do endereço. */
  | { tipo: 'entrar'; setCookie: string; destino: string }
  | { tipo: 'recusa'; status: 400 | 401 | 403 | 405; motivo: string }

export function cookieDeEntrada(g: Guarda): string {
  // Sem Max-Age: cookie de sessão, morre com o navegador — e a chave morre
  // antes, quando o console fecha. Sem Secure: é http em 127.0.0.1.
  return `${g.nomeCookie}=${encodeURIComponent(g.chave)}; HttpOnly; SameSite=Strict; Path=/`
}

/**
 * A primeira conferência, em TODA requisição: o host, e a chave (no cookie,
 * ou na consulta da primeira visita).
 */
export function conferirAcesso(g: Guarda, p: Pedido): Veredito {
  if (!p.host || !hostsAceitos(g.porta).includes(p.host.toLowerCase())) {
    return { tipo: 'recusa', status: 403, motivo: 'Endereço não reconhecido. Abra pelo link impresso no terminal.' }
  }
  if (p.metodo !== 'GET' && p.metodo !== 'POST' && p.metodo !== 'HEAD') {
    return { tipo: 'recusa', status: 405, motivo: 'Método não aceito.' }
  }
  const url = new URL(p.url, `http://${p.host}`)
  const naConsulta = url.searchParams.get('t')
  if (naConsulta !== null) {
    // A chave no endereço só vale num GET: num POST ela não deveria estar
    // ali, e aceitar daria um jeito de entrar sem passar pelo cookie.
    if (p.metodo !== 'GET' || !iguais(naConsulta, g.chave)) {
      return { tipo: 'recusa', status: 401, motivo: 'Chave errada ou vencida. O console imprime uma nova a cada vez que sobe.' }
    }
    url.searchParams.delete('t')
    const resto = url.searchParams.toString()
    return { tipo: 'entrar', setCookie: cookieDeEntrada(g), destino: url.pathname + (resto ? `?${resto}` : '') }
  }
  const cookie = lerCookies(p.cookie)[g.nomeCookie]
  if (!iguais(cookie, g.chave)) {
    return { tipo: 'recusa', status: 401, motivo: 'Sem a chave do console. Abra pelo link impresso no terminal.' }
  }
  return { tipo: 'segue' }
}

/**
 * A conferência a mais de quem MUDA dado: depois de `conferirAcesso`, todo
 * POST passa por aqui com os campos do formulário.
 */
export function conferirFormulario(g: Guarda, p: Pedido, campos: URLSearchParams): Veredito {
  const antes = conferirAcesso(g, p)
  if (antes.tipo !== 'segue') {
    return antes.tipo === 'entrar' ? { tipo: 'recusa', status: 400, motivo: 'Formulário com a chave no endereço.' } : antes
  }
  if (p.metodo !== 'POST') return { tipo: 'recusa', status: 405, motivo: 'Mudança só por formulário.' }
  // O navegador SEMPRE manda Origin num POST de formulário. Sem ele, não é
  // o navegador numa página nossa — e quem não é, não muda dado.
  if (!p.origem || !origensAceitas(g.porta).includes(p.origem.toLowerCase())) {
    return { tipo: 'recusa', status: 403, motivo: 'Origem do formulário não reconhecida.' }
  }
  if (p.site && p.site !== 'same-origin') {
    return { tipo: 'recusa', status: 403, motivo: 'Formulário vindo de outro site.' }
  }
  if (!iguais(campos.get('csrf'), g.csrf)) {
    return { tipo: 'recusa', status: 403, motivo: 'Formulário vencido. Recarregue a página e tente de novo.' }
  }
  return { tipo: 'segue' }
}

/**
 * Os cabeçalhos de toda resposta. Nada de fora carrega (fonte, imagem,
 * script), ninguém emoldura a página, o endereço não vai em Referer, e nada
 * fica em cache — a página tem dado de conta de cliente.
 */
export function cabecalhosDeSeguranca(): Record<string, string> {
  return {
    'Content-Security-Policy':
      "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}
