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

import { cookies, headers } from 'next/headers'
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
//
// `vaga` é a marca da vaga que esta sessão ocupa (ver `marcaDaVaga` em
// presenca.ts). É ela que faz o teto de pessoas dentro valer DEPOIS do login:
// a vaga tomada por outra pessoa, ou devolvida no "Sair", derruba o cookie na
// próxima tela. `null` só para quem entra só com SUPORTE, que não ocupa vaga.
type Conteudo = Sessao & { exp: number; nasceu: number; vaga?: string | null }

/** A sessão com a marca da vaga que ela ocupa — é o que vai no cookie. */
export type SessaoComVaga = Sessao & { vaga?: string | null }

// A assinatura inclui o slug da empresa. Sem isso, alguém poderia pegar o
// cookie válido da empresa A, renomear para o da empresa B e a assinatura
// continuaria conferindo — a sessão passaria a dizer uma coisa e o endereço
// outra. Amarrando as duas na assinatura, cookie fora do lugar simplesmente
// não vale.
const assinar = (slug: string, corpo: string) =>
  createHmac('sha256', segredo()).update(`${slug}.${corpo}`).digest('base64url')

function empacotar(slug: string, sessao: SessaoComVaga): string {
  const agora = Date.now()
  const conteudo: Conteudo = {
    orgId: sessao.orgId,
    usuarioId: sessao.usuarioId,
    nome: sessao.nome,
    acessos: sessao.acessos,
    vaga: sessao.vaga ?? null,
    nasceu: agora,
    exp: agora + DURACAO_HORAS * 36e5,
  }
  const corpo = Buffer.from(JSON.stringify(conteudo)).toString('base64url')
  return `${corpo}.${assinar(slug, corpo)}`
}

/** O que o cookie devolve: a sessão, o instante em que foi emitida e a vaga. */
export type SessaoNoCookie = Sessao & { nasceu: Date; vaga: string | null }

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
      // Cookie de antes da vaga ir no cookie: sem marca. Para quem ocupa vaga,
      // isso não confere com presença nenhuma e ele cai — é a mesma regra do
      // `nasceu`: na dúvida, entra de novo.
      vaga: typeof c.vaga === 'string' ? c.vaga : null,
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

export async function abrirSessao(slugEmpresa: string, sessao: SessaoComVaga) {
  const cookieStore = await cookies()
  cookieStore.set(PREFIXO + slugEmpresa, empacotar(slugEmpresa, sessao), {
    httpOnly: true, // JavaScript da página não alcança
    sameSite: 'lax', // não viaja em requisição de outro site
    secure: process.env.NODE_ENV === 'production',
    path: `/${slugEmpresa}`, // é isto que separa as sessões por empresa
    maxAge: DURACAO_HORAS * 3600,
  })
  // Entrar é mexer: a tranca conta a partir daqui.
  await marcarToque(slugEmpresa)
}

// ── o último toque, para a tranca sobreviver ao F5 ───────────
// A tela tranca no navegador (ui/Tranca.tsx), pelo relógio dela. Só que o
// relógio nascia de novo a cada carregamento: trancada, bastava apertar F5 —
// ou abrir outra aba — e a tela voltava aberta, sem senha.
//
// Este cookie guarda o instante do último toque DE VERDADE (tecla, clique,
// rolagem), mandado pela própria tela enquanto alguém mexe (`/<empresa>/sinal`,
// no máximo uma vez por minuto). Abrir tela NÃO conta como toque — é
// justamente o F5 que não pode destrancar. Ao abrir, a moldura compara o
// cookie com TRANCA_MIN e a tela já nasce trancada.
//
// Por que cookie, e não o `ultimoSinal` da presença: o sinal da presença é
// gravado a cada tela aberta (pagina.ts), inclusive pelo próprio F5 — no
// instante em que a moldura fosse ler, o F5 já teria contado como "mexeu". E
// a presença é da PESSOA: o celular da dona em uso não pode manter aberto o
// computador esquecido no balcão. A tranca é do aparelho, como o cookie.
//
// httpOnly: o JavaScript da página não consegue fingir que mexeu.
const TOQUE = 'norte_toque_'

/** Grava "mexeram agora" no aparelho. Só em Server Action ou rota (ver cookies.md). */
export async function marcarToque(slugEmpresa: string, agora = Date.now()) {
  const cookieStore = await cookies()
  cookieStore.set(TOQUE + slugEmpresa, String(agora), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/${slugEmpresa}`,
    // O mesmo prazo da sessão: parado mais que isso, a sessão já acabou.
    maxAge: DURACAO_HORAS * 3600,
  })
}

/** O último toque registrado neste aparelho, ou null (cookie de antes da tranca ler o cookie). */
export async function ultimoToque(slugEmpresa: string): Promise<Date | null> {
  return lerToque((await cookies()).get(TOQUE + slugEmpresa)?.value)
}

/** O valor do cookie, conferido. Exportada para o teste. */
export function lerToque(bruto: string | undefined): Date | null {
  if (!bruto || !/^\d{1,15}$/.test(bruto)) return null
  const n = Number(bruto)
  return n > 0 ? new Date(n) : null
}

/**
 * Todos os valores que o navegador mandou com este nome, na ordem em que vieram.
 *
 * O navegador pode mandar DOIS cookies com o mesmo nome: o de agora e um
 * antigo que ficou preso com outros atributos (um `Secure` de quando o site
 * rodou em modo de produção nesta mesma máquina, por exemplo) e que o login
 * novo não conseguiu sobrescrever. O `cookies().get()` do Next fica só com o
 * primeiro, e o primeiro era o velho, vencido: a pessoa entrava, o painel
 * abria (ele vem na própria resposta do login) e o clique seguinte a
 * mandava de volta para a tela de entrar. Por isso lemos o cabeçalho cru.
 */
export function valoresDoCookie(cabecalho: string | null, nome: string): string[] {
  if (!cabecalho) return []
  const valores: string[] = []
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=')
    if (i < 0 || parte.slice(0, i).trim() !== nome) continue
    const bruto = parte.slice(i + 1).trim()
    try {
      valores.push(decodeURIComponent(bruto))
    } catch {
      valores.push(bruto)
    }
  }
  return valores
}

export async function lerSessao(slugEmpresa: string): Promise<SessaoNoCookie | null> {
  const nome = PREFIXO + slugEmpresa
  const cabecalhos = await headers()
  const candidatos = valoresDoCookie(cabecalhos.get('cookie'), nome)
  if (candidatos.length === 0) {
    const doNext = (await cookies()).get(nome)?.value
    if (doNext) candidatos.push(doNext)
  }

  // Cada candidato passa pela assinatura sozinho — ter mais de um não abre
  // nada que um só não abriria. Cookie de uma empresa não vale para outra: a
  // assinatura está presa ao slug. Entre os que valem, fica o mais novo.
  let melhor: SessaoNoCookie | null = null
  for (const valor of candidatos) {
    const s = desempacotar(slugEmpresa, valor)
    if (s && (!melhor || s.nasceu > melhor.nasceu)) melhor = s
  }
  return melhor
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
  cookieStore.set(TOQUE + slugEmpresa, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/${slugEmpresa}`,
    maxAge: 0,
  })
}
