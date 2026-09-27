// Duas perguntas sobre a requisição que as telas públicas de conta fazem:
// de onde ela veio (para o freio) e em que endereço o Norte está (para o
// link que vai por e-mail).
//
// Só para Server Action e página — lê `headers()` do Next.

import { headers } from 'next/headers'

/**
 * O IP de quem pediu.
 *
 * `x-forwarded-for` é uma LISTA: cada proxy do caminho acrescenta, no fim, o
 * endereço de quem falou com ele. O começo da lista é o que o próprio cliente
 * mandou — e portanto pode ser inventado. Pegar o primeiro deixava qualquer um
 * trocar de "IP" a cada tentativa e passar pelo freio. Vale o ÚLTIMO: é o que o
 * nosso proxy mais próximo escreveu (Caddy na Oracle, o túnel na demonstração,
 * a borda da hospedagem), sobre quem de fato abriu a conexão com ele.
 *
 * Mesmo assim o freio por IP é a SEGUNDA trava, nunca a única: o por e-mail
 * vale com qualquer IP.
 */
export async function deOndeVeio(): Promise<string | null> {
  const h = await headers()
  return ipDoCabecalho(h.get('x-forwarded-for'), h.get('x-real-ip'))
}

/** O último endereço da lista, ou o `x-real-ip`. Pura, para o teste. */
export function ipDoCabecalho(encaminhado: string | null, real: string | null): string | null {
  const ultimo = encaminhado
    ?.split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .at(-1)
  return (ultimo || real?.trim() || null)?.slice(0, 100) ?? null
}

/**
 * O endereço público do Norte, sem barra no fim — a base de TODO link que
 * sai por e-mail.
 *
 * ── por que não o cabeçalho Host ─────────────────────────────
 * O convite na tela monta o link pelo Host, e ali tudo bem: quem vê o link é
 * a própria pessoa que fez a requisição. No "esqueci a senha" é diferente:
 * quem pede é qualquer um, e o e-mail vai para OUTRA pessoa. Se o link
 * seguisse o Host, bastaria pedir a redefinição da senha da dona com
 * `Host: site-do-golpista.com` — o e-mail sairia do Norte, legítimo, com o
 * token verdadeiro apontando para o golpista. Por isso: NORTE_URL.
 *
 * No laptop (fora de produção) cai no Host, para o link funcionar em
 * localhost sem configurar nada. Em produção sem NORTE_URL devolve null, e
 * as telas tratam como "e-mail não configurado".
 */
export async function enderecoPublico(): Promise<string | null> {
  const fixo = (process.env.NORTE_URL ?? process.env.URL_BASE ?? '').trim().replace(/\/+$/, '')
  if (fixo) return fixo
  if (process.env.NODE_ENV === 'production') return null
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  return `${host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'}://${host}`
}
