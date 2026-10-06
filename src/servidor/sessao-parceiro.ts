// A sessão do PARCEIRO (o programa de indicação), separada da sessão das
// empresas: outro cookie, outro caminho (/parceiros) e outra marca na
// assinatura — um cookie de empresa renomeado não abre o painel do parceiro,
// e vice-versa. O mesmo molde de sessao.ts: assinado (HMAC), não cifrado,
// sem nada sensível dentro (só o id e o instante em que nasceu).

import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'node:crypto'

const NOME = 'norte_parceiro'
const CAMINHO = '/parceiros'
const DURACAO_DIAS = 14

function segredo(): string {
  const s = process.env.SEGREDO_SESSAO
  if (!s || s.length < 32) throw new Error('Falta SEGREDO_SESSAO no .env (mínimo 32 caracteres).')
  return s
}

const assinar = (corpo: string) => createHmac('sha256', segredo()).update(`parceiro.${corpo}`).digest('base64url')

type Conteudo = { id: string; nasceu: number; exp: number }

export function empacotarParceiro(id: string, agora = Date.now()): string {
  const c: Conteudo = { id, nasceu: agora, exp: agora + DURACAO_DIAS * 864e5 }
  const corpo = Buffer.from(JSON.stringify(c)).toString('base64url')
  return `${corpo}.${assinar(corpo)}`
}

export function desempacotarParceiro(valor: string | undefined, agora = Date.now()): { id: string; nasceu: Date } | null {
  if (!valor) return null
  const [corpo, assinatura] = valor.split('.')
  if (!corpo || !assinatura) return null
  const esperada = Buffer.from(assinar(corpo))
  const recebida = Buffer.from(assinatura)
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null
  try {
    const c = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Conteudo
    if (typeof c.id !== 'string' || !c.id || !c.exp || c.exp < agora) return null
    return { id: c.id, nasceu: new Date(c.nasceu ?? 0) }
  } catch {
    return null
  }
}

/** Só em Server Action ou rota. */
export async function abrirSessaoParceiro(id: string) {
  ;(await cookies()).set(NOME, empacotarParceiro(id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: CAMINHO,
    maxAge: DURACAO_DIAS * 86400,
  })
}

export async function fecharSessaoParceiro() {
  ;(await cookies()).set(NOME, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: CAMINHO, maxAge: 0 })
}

export async function lerSessaoParceiro(): Promise<{ id: string; nasceu: Date } | null> {
  return desempacotarParceiro((await cookies()).get(NOME)?.value)
}
