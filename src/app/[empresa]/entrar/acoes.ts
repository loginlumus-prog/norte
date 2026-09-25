'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { entrar, RECADO, type MotivoRecusa } from '@/servidor/autenticacao'
import { abrirSessao } from '@/servidor/sessao'
import { pode } from '@/servidor/permissao'

/**
 * De onde veio a requisição.
 *
 * Atrás da Vercel, `x-forwarded-for` é escrito pela borda e o primeiro
 * endereço da lista é o do visitante. Fora dela, esse cabeçalho é do cliente
 * e portanto mentira — por isso o freio por IP é a SEGUNDA trava, nunca a
 * única: o freio por e-mail continua valendo mesmo com IP forjado.
 */
async function deOndeVeio(): Promise<string | null> {
  const h = await headers()
  const encadeado = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return encadeado || h.get('x-real-ip') || null
}

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
