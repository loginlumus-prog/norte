// A sessão vive num cookie assinado, com escopo POR EMPRESA.
//
// ── por que não NextAuth, como estava decidido ───────────────
// O modelo do Norte é "uma pessoa, uma empresa, um endereço": /empresa/...
// NextAuth guarda uma sessão por site. Com ele, abrir a empresa A numa aba e a
// B na outra derrubaria uma das duas — e quem administra mais de uma empresa
// (contador, e nós no suporte) faz isso o tempo todo.
//
// Aqui o cookie leva o caminho da empresa (`path=/exemplo`), então o navegador
// só o manda para aquela empresa e as sessões convivem sem se atropelar. São
// ~80 linhas e nenhuma dependência nova. NextAuth volta à mesa no dia em que
// precisarmos de login pelo Google ou SSO — aí ele resolve algo que isto não
// resolve.
//
// ── o que o cookie carrega ───────────────────────────────────
// Assinado (HMAC-SHA256), não criptografado: dá para ler, não dá para forjar.
// Por isso não vai nada sensível — só id, nome e os papéis, que a própria
// pessoa já enxerga na tela.

import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Sessao } from './permissao'

const DURACAO_HORAS = 12
const PREFIXO = 'norte_sessao_'

function segredo(): string {
  const s = process.env.SEGREDO_SESSAO
  if (!s || s.length < 32) {
    throw new Error(
      'Falta SEGREDO_SESSAO no .env (mínimo 32 caracteres). ' +
        'Gere um: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    )
  }
  return s
}

// `nasceu` é o instante em que a sessão foi emitida. É o que permite matar
// sessão antiga sem trocar o segredo do sistema inteiro: basta o usuário ter
// um corte (`sessoes_desde`) mais recente que isto — ver `pagina.ts`.
type Conteudo = Sessao & { exp: number; nasceu: number }

// A assinatura inclui o slug da empresa. Sem isso, alguém poderia pegar o
// cookie válido da empresa A, renomear para o da empresa B e a assinatura
// continuaria conferindo — a sessão passaria a dizer uma coisa e o endereço
// outra. Amarrando as duas na assinatura, cookie fora do lugar simplesmente
// não vale.
const assinar = (slug: string, corpo: string) =>
  createHmac('sha256', segredo()).update(`${slug}.${corpo}`).digest('base64url')

function empacotar(slug: string, sessao: Sessao): string {
  const agora = Date.now()
  const conteudo: Conteudo = { ...sessao, nasceu: agora, exp: agora + DURACAO_HORAS * 36e5 }
  const corpo = Buffer.from(JSON.stringify(conteudo)).toString('base64url')
  return `${corpo}.${assinar(slug, corpo)}`
}

/** O que o cookie devolve: a sessão mais o instante em que ela foi emitida. */
export type SessaoNoCookie = Sessao & { nasceu: Date }

function desempacotar(slug: string, valor: string): SessaoNoCookie | null {
  const [corpo, assinatura] = valor.split('.')
  if (!corpo || !assinatura) return null

  // Comparação de tempo constante: não entrega, pelo tempo de resposta,
  // quanto da assinatura forjada estava certo.
  const esperada = Buffer.from(assinar(slug, corpo))
  const recebida = Buffer.from(assinatura)
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null

  try {
    const c = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Conteudo
    if (!c.exp || c.exp < Date.now()) return null
    if (!c.orgId || !c.usuarioId || !Array.isArray(c.acessos)) return null

    // Datas viram texto no JSON; devolver Date é o que `pode()` espera.
    return {
      orgId: c.orgId,
      usuarioId: c.usuarioId,
      nome: c.nome,
      // Cookie antigo, de antes deste campo existir, vale como "nasceu no
      // começo dos tempos" — ou seja, o primeiro corte o derruba. É o que a
      // gente quer: na dúvida, manda entrar de novo.
      nasceu: new Date(c.nasceu ?? 0),
      acessos: c.acessos.map((a) => ({
        papel: a.papel,
        unidadeId: a.unidadeId,
        expiraEm: a.expiraEm ? new Date(a.expiraEm) : null,
      })),
    }
  } catch {
    return null
  }
}

export async function abrirSessao(slugEmpresa: string, sessao: Sessao) {
  const cookieStore = await cookies()
  cookieStore.set(PREFIXO + slugEmpresa, empacotar(slugEmpresa, sessao), {
    httpOnly: true, // JavaScript da página não alcança
    sameSite: 'lax', // não viaja em requisição de outro site
    secure: process.env.NODE_ENV === 'production',
    path: `/${slugEmpresa}`, // é isto que separa as sessões por empresa
    maxAge: DURACAO_HORAS * 3600,
  })
}

export async function lerSessao(slugEmpresa: string): Promise<SessaoNoCookie | null> {
  const cookieStore = await cookies()
  const bruto = cookieStore.get(PREFIXO + slugEmpresa)?.value
  if (!bruto) return null

  // Cookie de uma empresa não vale para outra: a assinatura está presa ao slug.
  return desempacotar(slugEmpresa, bruto)
}

export async function fecharSessao(slugEmpresa: string) {
  const cookieStore = await cookies()
  // NÃO usar delete(nome): ele apaga no caminho '/', e o nosso cookie mora em
  // '/empresa'. Caminho diferente = outro cookie para o navegador, e a sessão
  // sobreviveria ao "Sair" — que foi exatamente o que aconteceu aqui.
  cookieStore.set(PREFIXO + slugEmpresa, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/${slugEmpresa}`,
    maxAge: 0,
  })
}
