// Cola entre a página e o servidor.
//
// Toda página de dentro do sistema começa por `exigirEntrada`, e toda Server
// Action começa por `exigirSessao`. Assim não existe tela nem ação que "quase"
// confere sessão: ou passou por aqui, ou não roda.
//
// ── por que a sessão é conferida no banco toda vez ───────────
// O cookie é assinado, então não dá para forjar. Mas ele é uma FOTOGRAFIA:
// carrega os papéis que a pessoa tinha na hora em que entrou. Sozinho, ele
// significa que desativar um funcionário só faz efeito quando o cookie dele
// expira — até 12 horas depois. Demitiu de manhã, continua vendendo à tarde.
//
// Por isso cada requisição pergunta ao banco duas coisas baratas (uma busca
// por chave primária): a conta ainda está ativa? E a sessão nasceu depois do
// último corte? Trocar senha, desativar conta ou mexer no papel empurram o
// corte para agora, e o cookie antigo morre na próxima tela que abrir.

import { redirect, notFound } from 'next/navigation'
import { acharOrgPorSlug, comoOrg } from './banco'
import { lerSessao } from './sessao'
import { sinal } from './presenca'
import { sessaoAindaVale, pode, type Capacidade, type Sessao } from './permissao'

export type Empresa = NonNullable<Awaited<ReturnType<typeof acharOrgPorSlug>>>

/** Erro de sessão morta. As Server Actions transformam isto em recado na tela. */
export class SessaoExpirada extends Error {
  constructor() {
    super('Sua sessão expirou. Entre de novo.')
    this.name = 'SessaoExpirada'
  }
}

/**
 * A sessão do cookie, já confrontada com o banco.
 * Devolve null quando não há cookie, quando a conta foi desativada ou quando
 * a sessão é anterior ao último corte.
 */
export async function sessaoViva(slugEmpresa: string): Promise<Sessao | null> {
  const doCookie = await lerSessao(slugEmpresa)
  if (!doCookie) return null

  const usuario = await comoOrg(doCookie.orgId, (db) =>
    db.usuario.findUnique({
      where: { id: doCookie.usuarioId },
      select: { ativo: true, sessoesDesde: true },
    }),
  )

  // Usuário apagado, desativado, ou sessão emitida antes do corte.
  if (!sessaoAindaVale(usuario, doCookie.nasceu)) return null

  const { nasceu: _nasceu, ...sessao } = doCookie

  // ── "ainda estou aqui" ───────────────────────────────────
  // É este toque que segura a vaga. Ele mora aqui porque aqui é o único lugar
  // por onde TODA tela passa — pendurar num componente qualquer deixaria de
  // fora justamente as telas que a pessoa fica olhando por mais tempo.
  //
  // A falha é engolida de propósito. Perder um sinal custa, no pior caso, a
  // vaga ser tomada alguns minutos antes da hora; deixar o erro subir custaria
  // a tela inteira. Nenhuma tela deve morrer por causa da contabilidade de
  // vaga.
  void sinal(sessao.orgId, sessao.usuarioId).catch(() => {})

  return sessao
}

/** Para Server Action: ou tem sessão viva, ou levanta. */
export async function exigirSessao(slugEmpresa: string): Promise<Sessao> {
  const s = await sessaoViva(slugEmpresa)
  if (!s) throw new SessaoExpirada()
  return s
}

/**
 * Toda tela de dentro começa aqui.
 *
 * `capacidade` é a que a tela exige. Sem ela, a tela abre para quem colou o
 * endereço e só estoura lá embaixo, quando a primeira consulta chama
 * `exigir` — e estouro é a tela de "deu problema", que parece defeito. Com
 * ela, quem não pode cai no "este endereço não abre", que é a verdade.
 */
export async function exigirEntrada(
  slugEmpresa: string,
  opcoes: boolean | { configurada?: boolean; capacidade?: Capacidade } = true,
): Promise<{ empresa: Empresa; sessao: Sessao }> {
  // A própria tela de cadastro passa `false`, senão entraria em laço.
  const exigirConfigurada = typeof opcoes === 'boolean' ? opcoes : (opcoes.configurada ?? true)
  const capacidade = typeof opcoes === 'boolean' ? undefined : opcoes.capacidade

  const empresa = await acharOrgPorSlug(slugEmpresa)
  if (!empresa) notFound()

  const sessao = await sessaoViva(slugEmpresa)
  if (!sessao) redirect(`/${slugEmpresa}/entrar`)

  if (capacidade && !pode(sessao, capacidade)) notFound()

  // O cookie diz de quem é a sessão; o endereço diz qual empresa foi aberta.
  // Se divergirem, a sessão não vale — vale a empresa do endereço, sempre.
  if (sessao.orgId !== empresa.id) redirect(`/${slugEmpresa}/entrar`)

  // Empresa suspensa depois que a pessoa já estava dentro: a sessão morre aqui,
  // não na próxima vez que ela tentar entrar.
  if (empresa.situacao === 'SUSPENSA' || empresa.situacao === 'CANCELADA') {
    redirect(`/${slugEmpresa}/entrar`)
  }

  // Sistema meio configurado confunde mais que sistema vazio: enquanto o
  // cadastro inicial não terminou, toda tela leva de volta para ele.
  if (exigirConfigurada && !empresa.configuradaEm) {
    redirect(`/${slugEmpresa}/comecar`)
  }

  return { empresa, sessao }
}

/**
 * Corta todas as sessões abertas de uma pessoa, agora.
 *
 * Chamar sempre que o acesso dela mudar: desativou, trocou papel, trocou
 * senha, tirou de uma unidade. O custo é a pessoa entrar de novo; o custo de
 * NÃO chamar é ela continuar dentro com o poder que acabou de perder.
 */
export async function cortarSessoes(orgId: string, usuarioId: string) {
  await comoOrg(orgId, (db) =>
    db.usuario.update({ where: { id: usuarioId }, data: { sessoesDesde: new Date() } }),
  )
}
