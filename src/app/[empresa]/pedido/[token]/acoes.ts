'use server'

// A avaliação do pedido, pela página de acompanhar. Sem sessão: a chave é o
// link secreto do pedido. As regras (só entregue, uma por pedido) moram em
// src/servidor/vitrine.ts.

import { revalidatePath } from 'next/cache'
import { avaliarPedido } from '@/servidor/vitrine'

export async function avaliarAcao(slug: string, token: string, nota: number, texto: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (typeof slug !== 'string' || typeof token !== 'string') return { ok: false, erro: 'Link inválido.' }
  const r = await avaliarPedido(slug, token, { nota: Number(nota), texto: typeof texto === 'string' ? texto : null })
  if (r.ok) revalidatePath(`/${slug}/pedido/${token}`)
  return r
}
