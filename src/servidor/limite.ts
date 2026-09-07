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
 * Pergunta se esta tentativa pode acontecer. Chamar ANTES de conferir a senha:
 * bloqueado é bloqueado, mesmo que a senha esteja certa — senão o atacante
 * ainda descobre a senha certa, só demora mais.
 */
export async function conferirFreio(
  orgId: string,
  email: string,
  ip: string | null,
): Promise<Freio> {
  const limite = desde()

  return comoOrg(orgId, async (db) => {
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

    return { bloqueado: false as const }
  })
}

/** Anota o que aconteceu. Acerto também: é ele que zera a contagem. */
export async function registrarTentativa(
  orgId: string,
  email: string,
  ip: string | null,
  sucesso: boolean,
) {
  await comoOrg(orgId, async (db) => {
    await db.tentativaLogin.create({ data: { orgId, email, ip, sucesso } })

    // Limpeza na carona do acerto: é raro e é o momento em que ninguém está
    // com pressa. Tentativa de ontem não interessa a ninguém, e a tabela é
    // exatamente a que um ataque faz crescer.
    if (sucesso) {
      await db.tentativaLogin.deleteMany({
        where: { criadaEm: { lt: new Date(Date.now() - 24 * 3600_000) } },
      })
    }
  })
}
