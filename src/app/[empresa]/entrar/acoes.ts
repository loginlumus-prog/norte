'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { entrar, RECADO, type MotivoRecusa } from '@/servidor/autenticacao'
import { abrirSessao } from '@/servidor/sessao'
import { pode } from '@/servidor/permissao'
import { acharOrgPorSlug } from '@/servidor/banco'
import { reenviarConfirmacao, reservarPedido } from '@/servidor/conta'
import { deOndeVeio, enderecoPublico } from '@/servidor/requisicao'

export type EstadoEntrada = {
  erro?: string
  email?: string
  /**
   * A senha estava certa e o plano encheu.
   *
   * Vai para a tela como LISTA, e não como frase. "Limite atingido" é o que
   * transforma isto numa ligação para o suporte; dizer quem está ocupando e há
   * quanto cada um parou transforma em "a Ana esqueceu aberto lá no fundo",
   * que a loja resolve sozinha em cinco segundos.
   */
  semVaga?: { nome: string; paradaMin: number }[]
  /**
   * A senha estava certa, e a conta (nascida no cadastro do site) ainda não
   * confirmou o e-mail. A tela oferece mandar o link de novo.
   */
  emailPendente?: boolean
}

export async function entrarAcao(
  _anterior: EstadoEntrada,
  form: FormData,
): Promise<EstadoEntrada> {
  const empresa = String(form.get('empresa') ?? '')
  const email = String(form.get('email') ?? '')
  const senha = String(form.get('senha') ?? '')

  if (!email || !senha) {
    return { erro: 'Preencha e-mail e senha.', email }
  }

  const r = await entrar(empresa, email, senha, await deOndeVeio())

  if (!r.ok) {
    if (r.motivo === 'sem_vaga') {
      return {
        email,
        semVaga: r.ocupantes.map((o) => ({ nome: o.nome, paradaMin: Math.round(o.paradaMin) })),
      }
    }

    if (r.motivo === 'email_pendente') return { email, emailPendente: true }

    // Devolve o e-mail para a pessoa não precisar digitar de novo — mas nunca
    // a senha, que não deve voltar do servidor por motivo nenhum.
    const recado =
      r.motivo === 'muitas_tentativas' && r.esperarMin
        ? `Muitas tentativas seguidas. Tente de novo em ${r.esperarMin} min.`
        : RECADO[r.motivo as MotivoRecusa]
    return { erro: recado, email }
  }

  await abrirSessao(empresa, r.sessao)

  // redirect() funciona lançando — precisa ficar FORA de try/catch,
  // senão o catch engole e a pessoa fica na tela de login achando que falhou.
  //
  // Quem é do caixa vai direto para o balcão: vender é a primeira coisa do dia
  // dele, e passar pelo painel (que ele nem pode ler) seria um pulo a mais.
  const soVende = !pode(r.sessao, 'relatorio.ver') && pode(r.sessao, 'venda.criar')
  redirect(soVende ? `/${empresa}/balcao` : `/${empresa}`)
}

/**
 * "Mandar o link de novo", para a conta que ainda não confirmou o e-mail.
 *
 * Mesmo freio e mesma resposta do "esqueci a senha": a frase não diz se o
 * e-mail tem conta, e o envio roda depois da resposta.
 */
export async function reenviarConfirmacaoAcao(empresa: string, email: string): Promise<{ ok?: string; erro?: string }> {
  const org = await acharOrgPorSlug(empresa)
  if (!org) return { erro: 'Não encontramos essa empresa.' }
  const alvo = String(email ?? '').trim().slice(0, 254)
  if (!alvo.includes('@')) return { erro: 'Digite o e-mail no campo de cima.' }

  const ip = await deOndeVeio()
  const freio = await reservarPedido(org.id, 'EMAIL', alvo, ip)
  if (freio.bloqueado) return { erro: `Muitos pedidos seguidos. Tente de novo em ${freio.esperarMin} min.` }

  const base = await enderecoPublico()
  if (base) {
    after(async () => {
      await reenviarConfirmacao(org.id, alvo, base, ip)
    })
  }
  return { ok: 'Se este e-mail está esperando confirmação, um link novo chega em alguns minutos. Confira também o spam.' }
}
