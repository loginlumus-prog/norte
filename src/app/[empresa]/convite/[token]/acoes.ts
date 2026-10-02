'use server'

import { redirect } from 'next/navigation'
import { aceitarConvite } from '@/servidor/convite'
import { entrar } from '@/servidor/autenticacao'
import { abrirSessao } from '@/servidor/sessao'

/**
 * `nome` e `email` voltam para o formulário quando algo é recusado: a pessoa
 * não digita tudo de novo por causa de um PIN fácil demais. Senha e PIN nunca
 * voltam.
 */
export type EstadoAceite = { erro?: string; nome?: string; email?: string }

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
  const email = form.get('email') == null ? null : String(form.get('email')).trim()
  // O campo do PIN só existe para quem opera (ver `conviteParaTela`); quem
  // monta o pedido na mão sem ele fica sem PIN e cria depois em Minha conta.
  const pin = form.get('pin') == null ? null : String(form.get('pin')).trim()
  const devolver = { nome, email: email ?? undefined }

  if (!nome) return { ...devolver, erro: 'Diga o seu nome.' }
  // A conferência de força fica no servidor, não só na tela: quem monta a
  // requisição na mão passa por cima de qualquer regra do navegador.
  if (senha.length < 8) return { ...devolver, erro: 'A senha precisa de pelo menos 8 letras.' }
  if (senha !== repetida) return { ...devolver, erro: 'As duas senhas não são iguais.' }
  if (pin !== null && !/^\d{4,6}$/.test(pin)) return { ...devolver, erro: 'O PIN tem de 4 a 6 números.' }

  const r = await aceitarConvite(slug, token, { nome, senha, pin, email })
  if (!r.ok) return { ...devolver, erro: r.motivo === 'dados' ? r.erro : (RECADO[r.motivo] ?? 'Não deu para aceitar o convite.') }

  // Entra já: pedir para a pessoa digitar de novo o que ela acabou de
  // escolher é o jeito mais rápido de perder alguém na porta.
  const entrada = await entrar(slug, r.email, senha)
  if (entrada.ok) await abrirSessao(slug, entrada.sessao)

  // A primeira tela já é a do papel: o início manda quem não lê relatório
  // (o balcão) direto para o balcão — ver [empresa]/page.tsx.
  redirect(`/${slug}`)
}
