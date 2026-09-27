'use server'

import { redirect } from 'next/navigation'
import { confirmarEmail } from '@/servidor/conta'

export type EstadoConfirmacao = { erro?: string }

const RECADO: Record<string, string> = {
  invalido: 'Este link não vale. Na tela de entrar, digite o e-mail e a senha: ela oferece mandar um link novo.',
  vencido: 'Este link venceu. Na tela de entrar, digite o e-mail e a senha: ela oferece mandar um link novo.',
  ja_usado: 'Este e-mail já foi confirmado. É só entrar.',
}

/**
 * Confirmar é um POST, não abrir o link: antivírus de e-mail e prévias de
 * link ABREM os endereços que chegam, e um link que se gastasse no GET
 * chegaria "já usado" para a pessoa.
 */
export async function confirmarAcao(slug: string, token: string, _anterior: EstadoConfirmacao): Promise<EstadoConfirmacao> {
  const r = await confirmarEmail(slug, token)
  if (!r.ok) return { erro: RECADO[r.motivo] ?? 'Não deu para confirmar agora.' }
  // A conta não entra sozinha: quem tem o link prova o e-mail, não a senha.
  // Na tela de entrar, a senha que a pessoa escolheu no cadastro — e daí o
  // primeiro acesso leva direto ao cadastro inicial (/comecar).
  redirect(`/${slug}/entrar?confirmado=1`)
}
