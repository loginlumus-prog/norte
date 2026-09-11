'use server'

import { redirect } from 'next/navigation'
import { fecharSessao } from '@/servidor/sessao'
import { sessaoViva } from '@/servidor/pagina'
import { liberarVaga, sinal } from '@/servidor/presenca'
import { comoOrg } from '@/servidor/banco'
import { conferirSenha } from '@/servidor/senha'

/**
 * Destrancar a tela: a senha de quem já está dentro, de novo.
 *
 * Não é login — a sessão continua a mesma. Só confere que quem está na
 * frente da tela é quem entrou. Erro espera meio segundo, para não dar
 * para testar senhas em série; e a tela sai sozinha na quinta errada.
 */
export async function destrancarAcao(slug: string, senha: string): Promise<{ ok: boolean }> {
  const sessao = await sessaoViva(slug)
  if (!sessao || !senha) return { ok: false }

  const u = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { senhaHash: true } }),
  )
  if (!u?.senhaHash || !(await conferirSenha(senha, u.senhaHash))) {
    await new Promise((r) => setTimeout(r, 600))
    return { ok: false }
  }
  void sinal(sessao.orgId, sessao.usuarioId).catch(() => {})
  return { ok: true }
}

// Sair é Server Action, não rota POST: numa rota, o redirect() sai como 307 e
// o navegador REPETE o POST no destino, que não aceita POST. A Server Action
// já resolve o redirecionamento no protocolo dela.
export async function sairAcao(form: FormData) {
  const empresa = String(form.get('empresa') ?? '')

  // A vaga é liberada ANTES do cookie morrer, porque depois disso não dá mais
  // para saber quem estava saindo. Sair é o caminho limpo: quem clica aqui
  // devolve a vaga na hora, sem esperar os dez minutos de inatividade.
  const sessao = await sessaoViva(empresa)
  if (sessao) await liberarVaga(sessao.orgId, sessao.usuarioId)

  await fecharSessao(empresa)
  redirect(`/${empresa}/entrar`)
}
