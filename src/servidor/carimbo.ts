// O carimbo do caminho, que o proxy põe e a página confere.
//
// O livro do suporte (ver `sessaoViva` em pagina.ts) registra QUAL tela o
// nosso suporte abriu. A tela do servidor não sabe o próprio endereço, então
// o proxy (src/proxy.ts) carimba o caminho num cabeçalho. Só que nem toda
// requisição passa pelo proxy — a pré-carga de link fica de fora, por
// exemplo —, e aí o cabeçalho que chega é o que o NAVEGADOR mandou. Quem tem
// acesso de suporte podia mandar `x-norte-caminho: /exemplo/inicio` com
// `purpose: prefetch` e abrir /exemplo/clientes com o livro dizendo outra
// coisa.
//
// Por isso o proxy manda, junto do caminho, um selo (HMAC com o segredo do
// servidor). Caminho sem selo que confira não é confiável e não vai para o
// livro como verdade. Arquivo à parte, sem banco e sem Next: o proxy importa
// isto e não pode puxar o Prisma junto.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** O cabeçalho em que o proxy carimba o caminho da requisição. */
export const CABECALHO_CAMINHO = 'x-norte-caminho'
/** O selo do caminho: prova que foi o proxy, e não o navegador, que escreveu. */
export const CABECALHO_SELO = 'x-norte-caminho-selo'

function segredo(): string | null {
  const s = process.env.SEGREDO_SESSAO
  return s && s.length >= 32 ? s : null
}

/** O selo deste caminho. `null` sem segredo configurado (aí nada confere). */
export function selarCaminho(caminho: string): string | null {
  const s = segredo()
  if (!s) return null
  return createHmac('sha256', s).update(`caminho:${caminho}`).digest('base64url')
}

/** O caminho, se o selo confere; senão `null`. */
export function caminhoCarimbado(caminho: string | null, selo: string | null): string | null {
  if (!caminho || !selo) return null
  const esperado = selarCaminho(caminho)
  if (!esperado) return null
  const a = Buffer.from(esperado)
  const b = Buffer.from(selo)
  return a.length === b.length && timingSafeEqual(a, b) ? caminho : null
}
