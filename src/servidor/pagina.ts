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
import { headers } from 'next/headers'
import { acharOrgPorSlug, comoOrg } from './banco'
import { lerSessao, type SessaoComVaga } from './sessao'
import { sinal, vagaConfere } from './presenca'
import { sessaoAindaVale, pode, type Capacidade, type Sessao } from './permissao'
import { registrarErro } from './registro'
import { conferirSenha } from './senha'
import { reservarTentativa, concluirTentativa } from './limite'
import { CABECALHO_CAMINHO, CABECALHO_SELO, caminhoCarimbado } from './carimbo'

export { CABECALHO_CAMINHO } from './carimbo'

export type Empresa = NonNullable<Awaited<ReturnType<typeof acharOrgPorSlug>>>

/** A frase de quem perdeu a vaga para outra pessoa. */
export const RECADO_VAGA = 'Sua vaga foi usada por outra pessoa. Entre de novo para continuar.'

/** Erro de sessão morta. As Server Actions transformam isto em recado na tela. */
export class SessaoExpirada extends Error {
  constructor(recado = 'Sua sessão expirou. Entre de novo.') {
    super(recado)
    this.name = 'SessaoExpirada'
  }
}

/** Por que a sessão não vale — é o que decide a frase da tela de entrar. */
export type MotivoDaQueda = 'sem_cookie' | 'corte' | 'vaga' | 'saiu' | 'suporte'

/** A sessão viva: a do cookie, com a marca da vaga que ela ocupa. */
export type SessaoViva = SessaoComVaga

/** Só SUPORTE (nós): entra sem vaga (ver `entrar` em autenticacao.ts). */
const soSuporte = (s: Sessao) => s.acessos.length > 0 && s.acessos.every((a) => a.papel === 'SUPORTE')

/** Não grava sinal mais de uma vez por minuto (a mesma régua de `sinal`). */
const SINAL_MS = 60_000

/**
 * A sessão do cookie, já confrontada com o banco — e, quando não vale, o
 * motivo. `sessaoViva` é esta sem o motivo.
 */
export async function conferirSessao(
  slugEmpresa: string,
): Promise<{ sessao: SessaoViva; motivo?: undefined } | { sessao: null; motivo: MotivoDaQueda }> {
  const doCookie = await lerSessao(slugEmpresa)
  if (!doCookie) return { sessao: null, motivo: 'sem_cookie' }

  const semVaga = soSuporte(doCookie)
  const achado = await comoOrg(doCookie.orgId, async (db) => {
    const usuario = await db.usuario.findUnique({
      where: { id: doCookie.usuarioId },
      select: { ativo: true, sessoesDesde: true },
    })
    const presenca = semVaga
      ? null
      : await db.presenca.findUnique({
          where: { orgId_usuarioId: { orgId: doCookie.orgId, usuarioId: doCookie.usuarioId } },
          select: { desde: true, ultimoSinal: true },
        })
    // O que a empresa deu a mais ao Balcão (ver EXTRAS_DO_BALCAO). Daqui, e
    // não do cookie: desligar a chave vale na próxima tela.
    const org = await db.org.findUnique({ where: { id: doCookie.orgId }, select: { balcaoAmpliado: true } })
    return { usuario, presenca, balcaoAmpliado: org?.balcaoAmpliado ?? false }
  })

  // Usuário apagado, desativado, ou sessão emitida antes do corte.
  if (!sessaoAindaVale(achado.usuario, doCookie.nasceu)) return { sessao: null, motivo: 'corte' }

  // ── a vaga ───────────────────────────────────────────────
  // O teto de pessoas dentro ao mesmo tempo só valia no login: quem perdia a
  // vaga para outra pessoa (ver `ocuparVaga`) continuava trabalhando com o
  // cookie de antes, e o plano de uma vaga tinha duas pessoas dentro. Agora a
  // sessão precisa segurar a MESMA vaga com que entrou. A vaga some quando é
  // tomada (parada há mais de dez minutos) ou quando a pessoa clica em Sair.
  if (!semVaga && !vagaConfere(achado.presenca, doCookie.vaga)) {
    return { sessao: null, motivo: await motivoDaVagaPerdida(doCookie) }
  }

  const { nasceu: _nasceu, ...doCookieSemData } = doCookie
  const sessao: SessaoViva = { ...doCookieSemData, balcaoAmpliado: achado.balcaoAmpliado }

  // ── "ainda estou aqui" ───────────────────────────────────
  // É este toque que segura a vaga. Ele mora aqui porque aqui é o único lugar
  // por onde TODA tela passa — pendurar num componente qualquer deixaria de
  // fora justamente as telas que a pessoa fica olhando por mais tempo. Só
  // quando o último sinal já passou de um minuto: a presença acabou de ser
  // lida, não precisa de outra transação para descobrir isso.
  //
  // A falha é engolida de propósito. Perder um sinal custa, no pior caso, a
  // vaga ser tomada alguns minutos antes da hora; deixar o erro subir custaria
  // a tela inteira. Nenhuma tela deve morrer por causa da contabilidade de
  // vaga.
  if (achado.presenca && Date.now() - achado.presenca.ultimoSinal.getTime() >= SINAL_MS) {
    void sinal(sessao.orgId, sessao.usuarioId).catch(() => {})
  }

  // ── o nosso suporte deixa rastro ─────────────────────────
  // Toda tela, ação e planilha aberta com acesso de SUPORTE vira linha no
  // livro de auditoria DA LOJA, que ela lê na tela Auditoria. Aqui, e não em
  // cada tela, porque este é o único lugar por onde tudo passa — tela nova
  // entra sozinha. E falha FECHADA: se a linha não pôde ser gravada, o
  // suporte não entra. Acesso nosso sem registro é justamente o que o
  // contrato com a loja diz que não existe.
  if (ehAcessoDeSuporte(sessao)) {
    try {
      const h = await headers()
      // O proxy (src/proxy.ts) carimba o caminho da requisição e SELA o
      // carimbo (ver carimbo.ts). Caminho sem selo que confira veio do
      // navegador — a pré-carga de link não passa pelo proxy, e era por ela
      // que dava para mandar um caminho inventado — e não entra no livro como
      // se fosse verdade.
      const caminho =
        caminhoCarimbado(h.get(CABECALHO_CAMINHO), h.get(CABECALHO_SELO)) ??
        `/${slugEmpresa} (pré-carregamento; tela não confirmada)`
      await registrarAcessoDeSuporte(sessao, {
        caminho,
        tipo: h.has('next-action') ? 'acao' : 'tela',
        sessaoNasceu: doCookie.nasceu,
      })
    } catch (e) {
      console.error('[suporte] o acesso não pôde ser registrado; entrada recusada:', e instanceof Error ? e.message : e)
      return { sessao: null, motivo: 'suporte' }
    }
  }

  return { sessao }
}

/**
 * A sessão do cookie, já confrontada com o banco.
 * Devolve null quando não há cookie, quando a conta foi desativada, quando
 * a sessão é anterior ao último corte ou quando a vaga dela não existe mais.
 */
export async function sessaoViva(slugEmpresa: string): Promise<SessaoViva | null> {
  return (await conferirSessao(slugEmpresa)).sessao
}

/**
 * A vaga do cookie sumiu: foi TOMADA por outra pessoa, ou a própria pessoa
 * saiu (em outro aparelho, ou redefiniu a senha)? Só a primeira merece a
 * frase "sua vaga foi usada" — a outra é um "entre de novo" comum. Quem
 * responde é o livro: tomar vaga deixa a linha `vaga.assumiu`. A consulta só
 * roda no caminho da queda, que é raro.
 */
async function motivoDaVagaPerdida(doCookie: { orgId: string; usuarioId: string; vaga: string | null }): Promise<MotivoDaQueda> {
  // Cookie de antes da vaga ir no cookie: não foi ninguém, foi a troca do sistema.
  if (!doCookie.vaga) return 'saiu'
  const desde = new Date(doCookie.vaga)
  if (Number.isNaN(desde.getTime())) return 'saiu'
  try {
    const tomada = await comoOrg(doCookie.orgId, (db) =>
      db.auditoria.findFirst({
        where: { acao: 'vaga.assumiu', alvoId: doCookie.usuarioId, criadoEm: { gte: desde } },
        select: { id: true },
      }),
    )
    return tomada ? 'vaga' : 'saiu'
  } catch {
    return 'saiu'
  }
}

/** O endereço da tela de entrar, com a frase certa para quem caiu. */
export function enderecoDeEntrar(slugEmpresa: string, motivo?: MotivoDaQueda): string {
  return motivo === 'vaga' ? `/${slugEmpresa}/entrar?saiu=vaga` : `/${slugEmpresa}/entrar`
}

// ─────────────────────────────────────────────────────────────
// O REGISTRO DO SUPORTE
// ─────────────────────────────────────────────────────────────

/** Uma linha por tela (ou ação) a cada tanto, por sessão — senão cada clique vira linha. */
export const INTERVALO_REGISTRO_SUPORTE_MS = 10 * 60_000

/** A sessão está usando um acesso de SUPORTE (nosso) que ainda vale? */
export function ehAcessoDeSuporte(sessao: Sessao, agora = new Date()): boolean {
  return sessao.acessos.some((a) => a.papel === 'SUPORTE' && (!a.expiraEm || a.expiraEm > agora))
}

/**
 * O caminho, pronto para o livro: sem `?` nem `#` (a busca da tela pode ter
 * o nome de um cliente dentro, e o livro não se apaga) e com teto.
 */
export function caminhoParaLivro(bruto: string): string {
  const semBusca = bruto.split(/[?#]/)[0] ?? ''
  return (semBusca || '/').slice(0, 200)
}

// Quem já foi registrado, e quando. Economiza a consulta ao livro na tela
// seguinte; a verdade continua sendo o livro (vale entre servidores).
const vistos = (globalThis as unknown as { __suporteVisto?: Map<string, number> }).__suporteVisto ??= new Map()

/**
 * Grava "o suporte do Norte abriu /exemplo/clientes" no livro da loja — no
 * máximo uma linha por tela (e por tipo: abrir × agir) a cada
 * INTERVALO_REGISTRO_SUPORTE_MS, por sessão. Leva o MOTIVO do acesso (o que
 * foi escrito ao conceder o SUPORTE) e o prazo. Nunca leva dado pessoal: só
 * o caminho, sem a busca.
 *
 * Devolve se gravou. Exportada para o teste (tests/lgpd-banco.test.ts).
 */
export async function registrarAcessoDeSuporte(
  sessao: Sessao,
  p: { caminho: string; tipo: 'tela' | 'acao'; sessaoNasceu: Date },
  agora = new Date(),
): Promise<boolean> {
  const caminho = caminhoParaLivro(p.caminho)
  const marca = p.sessaoNasceu.toISOString()
  const chave = `${sessao.orgId}|${sessao.usuarioId}|${marca}|${p.tipo}|${caminho}`
  const ultimo = vistos.get(chave)
  if (ultimo !== undefined && agora.getTime() - ultimo < INTERVALO_REGISTRO_SUPORTE_MS) return false
  // Marca ANTES de gravar: a tela e o layout dela chegam aqui no mesmo
  // instante, e sem isto os dois gravariam.
  vistos.set(chave, agora.getTime())
  if (vistos.size > 5000) vistos.clear()

  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const desde = new Date(agora.getTime() - INTERVALO_REGISTRO_SUPORTE_MS)
      const ja = await db.auditoria.findFirst({
        where: {
          acao: 'suporte.acessou',
          usuarioId: sessao.usuarioId,
          alvoTipo: p.tipo,
          alvoNome: caminho,
          criadoEm: { gt: desde },
          depois: { path: ['sessao'], equals: marca },
        },
        select: { criadoEm: true },
      })
      if (ja) {
        // Outro servidor (ou uma reinicialização) já registrou: a memória
        // passa a contar a partir da linha que existe.
        vistos.set(chave, ja.criadoEm.getTime())
        return false
      }
      const acesso = await db.acesso.findFirst({
        where: { usuarioId: sessao.usuarioId, papel: 'SUPORTE' },
        orderBy: { criadoEm: 'desc' },
        select: { motivo: true, expiraEm: true },
      })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          autor: 'PESSOA',
          acao: 'suporte.acessou',
          alvoTipo: p.tipo,
          alvoNome: caminho,
          motivo: acesso?.motivo?.slice(0, 300) ?? 'sem motivo registrado',
          depois: { sessao: marca, tipo: p.tipo, expiraEm: acesso?.expiraEm?.toISOString() ?? null },
          criadoEm: agora,
        },
      })
      return true
    })
  } catch (e) {
    // Não gravou: esquece a marca, para a próxima tentar de novo.
    vistos.delete(chave)
    throw e
  }
}

/**
 * Destrancar a tela: a senha de quem já está dentro, de novo.
 *
 * Não é login — a sessão continua a mesma. Só confere que quem está na
 * frente da tela é quem entrou.
 *
 * ── o mesmo freio do login ───────────────────────────────────
 * A tela trancada é uma porta de senha como a de entrar, e com a vantagem,
 * para quem ataca, de já estar do lado de dentro: o computador do balcão
 * destrancado era um lugar para testar a senha da dona sem limite — a tela
 * saía na quinta errada, mas bastava recarregar. Agora cada tentativa passa
 * por `reservarTentativa`, contada no MESMO e-mail do login: cinco erros aqui
 * seguram também o login daquela conta pelos mesmos quinze minutos.
 */
export async function destrancar(
  slugEmpresa: string,
  senha: string,
  ip: string | null,
): Promise<{ ok: boolean; erro?: string; sair?: boolean }> {
  const conferida = await conferirSessao(slugEmpresa)
  const sessao = conferida.sessao
  if (!sessao) {
    return { ok: false, sair: true, erro: conferida.motivo === 'vaga' ? RECADO_VAGA : 'Sua sessão terminou. Entre de novo.' }
  }
  if (!senha) return { ok: false, erro: 'Digite a sua senha.' }

  const u = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { senhaHash: true, email: true } }),
  )
  if (!u) return { ok: false, sair: true, erro: 'Sua sessão terminou. Entre de novo.' }

  const freio = await reservarTentativa(sessao.orgId, u.email, ip)
  if (freio.bloqueado) {
    return { ok: false, sair: true, erro: `Muitas tentativas seguidas. Entre de novo daqui a ${freio.esperarMin} min.` }
  }
  if (!u.senhaHash || !(await conferirSenha(senha, u.senhaHash))) {
    // A tentativa já nasceu contada como erro (ver limite.ts).
    await new Promise((r) => setTimeout(r, 600))
    return { ok: false, erro: 'Senha errada.' }
  }
  await concluirTentativa(sessao.orgId, freio.tentativaId, true)
  void sinal(sessao.orgId, sessao.usuarioId).catch(() => {})
  return { ok: true }
}

/** Para Server Action: ou tem sessão viva, ou levanta. */
export async function exigirSessao(slugEmpresa: string): Promise<SessaoViva> {
  const r = await conferirSessao(slugEmpresa)
  if (!r.sessao) throw new SessaoExpirada(r.motivo === 'vaga' ? RECADO_VAGA : undefined)
  return r.sessao
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
): Promise<{ empresa: Empresa; sessao: SessaoViva }> {
  // A própria tela de cadastro passa `false`, senão entraria em laço.
  const exigirConfigurada = typeof opcoes === 'boolean' ? opcoes : (opcoes.configurada ?? true)
  const capacidade = typeof opcoes === 'boolean' ? undefined : opcoes.capacidade

  const empresa = await acharOrgPorSlug(slugEmpresa)
  if (!empresa) notFound()

  const conferida = await conferirSessao(slugEmpresa)
  const sessao = conferida.sessao
  if (!sessao) redirect(enderecoDeEntrar(slugEmpresa, conferida.motivo))

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

/**
 * A frase que a tela pode mostrar quando uma ação deu errado.
 *
 * As ações devolviam `e.message` de qualquer erro — e o erro do Prisma traz
 * nome de tabela, de coluna e a consulta inteira ("Invalid `prisma.lancamento
 * .create()` invocation..."). Isso não ajuda quem está no balcão e ensina a
 * quem não devia como o banco é por dentro. O erro escrito por nós (um
 * `Error` com frase de gente) passa; o erro de máquina vira `padrao`, e o
 * detalhe vai para o log do servidor.
 */
export function recadoDoErro(e: unknown, padrao: string): string {
  if (!(e instanceof Error)) return padrao
  const deMaquina =
    e.name.startsWith('Prisma') ||
    ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DatabaseError'].includes(e.name) ||
    'code' in e
  if (deMaquina) {
    // O resumo, não o objeto: o erro de validação do Prisma traz os
    // argumentos com os valores (nome, telefone). E o código volta na frase,
    // para a pessoa ditar ao suporte e o suporte achar a linha no log.
    const codigo = registrarErro('acao', e)
    return `${padrao} (código ${codigo})`
  }
  return e.message
}
