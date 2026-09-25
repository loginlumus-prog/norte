// Freio de tentativa de entrada.
//
// O login é a única porta do sistema que aceita chute. Todo o resto exige
// sessão; aqui, qualquer pessoa na internet pode tentar quantas vezes quiser.
// Sem freio, uma lista das mil senhas mais usadas rodando a noite inteira
// contra `/empresa/entrar` encontra alguma conta — não porque o sistema é
// fraco, mas porque alguém da equipe usou "loja2024".
//
// ── duas contagens, não uma ──────────────────────────────────
// Por E-MAIL pega quem martela uma conta específica.
// Por IP pega o contrário: uma senha só, testada contra a lista inteira de
// e-mails da empresa (é assim que vazamento de senha vira invasão, e o freio
// por e-mail sozinho não vê isso acontecer).
//
// ── o que o freio NÃO pode fazer ─────────────────────────────
// Não pode revelar quem tem conta. Por isso conta o e-mail DIGITADO, exista
// ele ou não, e a recusa é a mesma nos dois casos. Um atacante que descobre
// "este e-mail foi bloqueado, aquele não" ganhou a lista de funcionários.
//
// ── e por que o bloqueio é temporário ────────────────────────
// Travar a conta até alguém destravar transforma o ataque em outra coisa:
// dá para trancar a dona do lado de fora da própria loja só errando a senha
// dela cinco vezes. A janela expira sozinha.

import { comoOrg } from './banco'

/** Quanto tempo a contagem enxerga para trás. */
export const JANELA_MIN = 15
/** Erros seguidos no mesmo e-mail antes de segurar. */
export const MAX_POR_EMAIL = 5
/** Erros vindos do mesmo endereço, somando todos os e-mails. */
export const MAX_POR_IP = 20

export type Freio =
  | { bloqueado: false }
  | { bloqueado: true; esperarMin: number; motivo: 'email' | 'ip' }

const desde = () => new Date(Date.now() - JANELA_MIN * 60_000)

/** Minutos que faltam para a tentativa mais antiga sair da janela. */
const faltam = (maisAntiga: Date) =>
  Math.max(1, Math.ceil((maisAntiga.getTime() + JANELA_MIN * 60_000 - Date.now()) / 60_000))

/**
 * A tentativa, já contada: ou bloqueada, ou com o id da linha que a reservou.
 *
 * ── a corrida que isto fecha ─────────────────────────────────
 * Antes eram dois passos: conferir o freio numa transação, conferir a senha
 * (que demora de propósito), e só no fim anotar o erro em outra. Vinte
 * tentativas disparadas AO MESMO TEMPO passavam as vinte pela conferência —
 * nenhuma ainda tinha sido anotada — e o freio de cinco virava freio de
 * quantas o atacante mandasse de uma vez.
 *
 * Agora contar e anotar são UM passo: dentro da mesma transação, com a trava
 * do Postgres (advisory lock) por e-mail e por endereço, a tentativa é
 * gravada como ERRO antes de a senha ser conferida. A sexta tentativa
 * simultânea espera a trava, conta cinco erros e para. Quem acertar a senha
 * vira a própria linha para acerto depois (`concluirTentativa`).
 */
export type Reserva = Extract<Freio, { bloqueado: true }> | { bloqueado: false; tentativaId: string }

/**
 * Pergunta se esta tentativa pode acontecer — e, se pode, já a conta.
 *
 * Chamar ANTES de conferir a senha: bloqueado é bloqueado, mesmo que a senha
 * esteja certa — senão o atacante ainda descobre a senha certa, só demora
 * mais.
 */
export async function reservarTentativa(
  orgId: string,
  email: string,
  ip: string | null,
): Promise<Reserva> {
  const limite = desde()

  return comoOrg(orgId, async (db) => {
    // As travas, sempre na mesma ordem (e-mail, depois endereço): duas
    // transações que pedem as duas nunca ficam esperando uma pela outra.
    // `xact`: soltam sozinhas no fim da transação, inclusive se ela falhar.
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`login:email:${orgId}:${email}`}))`
    if (ip) await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`login:ip:${orgId}:${ip}`}))`

    // Só contam as falhas DEPOIS do último acerto: quem entrou certo hoje de
    // manhã não carrega para sempre os erros de ontem.
    const ultimoAcerto = await db.tentativaLogin.findFirst({
      where: { email, sucesso: true },
      orderBy: { criadaEm: 'desc' },
      select: { criadaEm: true },
    })
    const corte =
      ultimoAcerto && ultimoAcerto.criadaEm > limite ? ultimoAcerto.criadaEm : limite

    const doEmail = await db.tentativaLogin.findMany({
      where: { email, sucesso: false, criadaEm: { gt: corte } },
      orderBy: { criadaEm: 'asc' },
      select: { criadaEm: true },
    })
    if (doEmail.length >= MAX_POR_EMAIL) {
      return { bloqueado: true as const, esperarMin: faltam(doEmail[0]!.criadaEm), motivo: 'email' as const }
    }

    if (ip) {
      const doIp = await db.tentativaLogin.findMany({
        where: { ip, sucesso: false, criadaEm: { gt: limite } },
        orderBy: { criadaEm: 'asc' },
        select: { criadaEm: true },
      })
      if (doIp.length >= MAX_POR_IP) {
        return { bloqueado: true as const, esperarMin: faltam(doIp[0]!.criadaEm), motivo: 'ip' as const }
      }
    }

    // Conta como erro até provar o contrário. Ainda dentro da trava: é isto
    // que a próxima tentativa simultânea vai enxergar quando a trava soltar.
    const t = await db.tentativaLogin.create({ data: { orgId, email, ip, sucesso: false }, select: { id: true } })
    return { bloqueado: false as const, tentativaId: t.id }
  })
}

/**
 * Fecha a tentativa reservada. Erro não precisa de nada — ela já nasceu erro.
 * Acerto vira a linha para acerto: é ele que zera a contagem.
 */
export async function concluirTentativa(orgId: string, tentativaId: string, sucesso: boolean) {
  if (!sucesso) return
  await comoOrg(orgId, async (db) => {
    await db.tentativaLogin.update({ where: { id: tentativaId }, data: { sucesso: true } })

    // Limpeza na carona do acerto: é raro e é o momento em que ninguém está
    // com pressa. Tentativa de ontem não interessa a ninguém, e a tabela é
    // exatamente a que um ataque faz crescer.
    await db.tentativaLogin.deleteMany({
      where: { criadaEm: { lt: new Date(Date.now() - 24 * 3600_000) } },
    })
  })
}
