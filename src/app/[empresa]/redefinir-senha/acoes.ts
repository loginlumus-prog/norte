'use server'

// Server Action é endereço público: qualquer um posta aqui, sem sessão. As
// travas moram em src/servidor/conta.ts (freio, link de uso único, resposta
// que não diz quem tem conta); aqui só se lê o formulário e se decide a frase.

import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { emailConfigurado } from '@/servidor/email'
import { avisarSenhaTrocada, enviarLinkDeSenha, redefinirSenha, reservarPedido, VALE_SENHA_MIN } from '@/servidor/conta'
import { deOndeVeio, enderecoPublico } from '@/servidor/requisicao'
import { recadoDoErro } from '@/servidor/pagina'

export type EstadoPedido = { erro?: string; enviado?: boolean; email?: string }

/**
 * "Esqueci a senha". A resposta é a MESMA exista a conta ou não, e o
 * trabalho de verdade roda depois da resposta (`after`): nem a frase nem o
 * tempo dizem se o e-mail tem cadastro aqui.
 */
export async function pedirLinkAcao(slug: string, _anterior: EstadoPedido, form: FormData): Promise<EstadoPedido> {
  const email = String(form.get('email') ?? '').trim().slice(0, 254)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erro: 'Digite o e-mail com que você entra.', email }

  const org = await acharOrgPorSlug(slug)
  if (!org) return { erro: 'Não encontramos essa empresa.' }

  const base = await enderecoPublico()
  if (!emailConfigurado() || !base) {
    return { erro: 'Este servidor ainda não manda e-mail. Peça para quem administra a empresa gerar um link na tela Equipe.' }
  }

  const ip = await deOndeVeio()
  const freio = await reservarPedido(org.id, 'SENHA', email, ip)
  if (freio.bloqueado) {
    return { erro: `Muitos pedidos seguidos para este e-mail. Tente de novo em ${freio.esperarMin} min.`, email }
  }

  after(async () => {
    await enviarLinkDeSenha(org.id, email, base, ip)
  })
  return { enviado: true, email }
}

export type EstadoNovaSenha = { erro?: string }

const RECADO: Record<string, string> = {
  invalido: 'Este link não vale. Peça outro em "Esqueci a senha".',
  vencido: `Este link venceu — ele vale ${VALE_SENHA_MIN} minutos quando chega por e-mail. Peça outro em "Esqueci a senha".`,
  ja_usado: 'Este link já foi usado. Se a senha nova é sua, é só entrar com ela.',
  empresa_suspensa: 'O acesso desta empresa está suspenso. Fale com o responsável.',
}

export async function novaSenhaAcao(
  slug: string,
  token: string,
  _anterior: EstadoNovaSenha,
  form: FormData,
): Promise<EstadoNovaSenha> {
  const senha = String(form.get('senha') ?? '')
  const repetida = String(form.get('repetida') ?? '')
  // A régua de força mora em senha.ts (guardarSenha) e vale no servidor —
  // estas duas são só para responder antes de gastar o scrypt.
  if (senha.length < 8) return { erro: 'A senha precisa de pelo menos 8 caracteres.' }
  if (senha !== repetida) return { erro: 'As duas senhas não são iguais.' }

  let r: Awaited<ReturnType<typeof redefinirSenha>>
  try {
    r = await redefinirSenha(slug, token, senha)
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para salvar a senha nova. Tente de novo.') }
  }
  if (!r.ok) return { erro: RECADO[r.motivo] ?? 'Não deu para salvar a senha nova.' }

  const base = await enderecoPublico()
  if (base) {
    const aviso = { para: r.email, nome: r.nome, empresa: r.empresa, slug, base }
    after(async () => {
      await avisarSenhaTrocada(aviso)
    })
  }

  // redirect() lança: fica fora de try/catch.
  redirect(`/${slug}/entrar?senha=nova`)
}
