'use server'

import { redirect } from 'next/navigation'
import { aceitarConvite } from '@/servidor/convite'
import { entrar } from '@/servidor/autenticacao'
import { abrirSessao } from '@/servidor/sessao'

export type EstadoAceite = { erro?: string }

const RECADO: Record<string, string> = {
  invalido: 'Este convite não vale. Peça um link novo para quem convidou você.',
  vencido: 'Este convite venceu. Peça um link novo para quem convidou você.',
  ja_usado: 'Este convite já foi usado. Se a conta é sua, entre normalmente.',
  empresa_nao_existe: 'Não encontramos essa empresa.',
}

export async function aceitar(
  slug: string,
  token: string,
  _anterior: EstadoAceite,
  form: FormData,
): Promise<EstadoAceite> {
  const nome = String(form.get('nome') ?? '').trim()
  const senha = String(form.get('senha') ?? '')
  const repetida = String(form.get('repetida') ?? '')

  if (!nome) return { erro: 'Diga o seu nome.' }
  // A conferência de força fica no servidor, não só na tela: quem monta a
  // requisição na mão passa por cima de qualquer regra do navegador.
  if (senha.length < 8) return { erro: 'A senha precisa de pelo menos 8 letras.' }
  if (senha !== repetida) return { erro: 'As duas senhas não são iguais.' }

  const r = await aceitarConvite(slug, token, { nome, senha })
  if (!r.ok) return { erro: RECADO[r.motivo] ?? 'Não deu para aceitar o convite.' }

  // Entra já: pedir para a pessoa digitar de novo o que ela acabou de
  // escolher é o jeito mais rápido de perder alguém na porta.
  const entrada = await entrar(slug, r.email, senha)
  if (entrada.ok) await abrirSessao(slug, entrada.sessao)

  redirect(`/${slug}`)
}
