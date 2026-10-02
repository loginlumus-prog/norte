// O cadastro pelo site: a empresa nasce sem ninguém do Norte no meio.
//
// ── quem cria, de verdade ────────────────────────────────────
// Não é a aplicação. Criar empresa é escrever numa empresa que ainda não
// existe, e isso não cabe no `comoOrg`; a credencial de admin, que caberia,
// é justamente a que a aplicação nunca pode ter. Quem cria é a função
// `criar_empresa_cadastro` do banco (prisma/sql/rls.sql), que só a portaria
// pode chamar e que faz UMA coisa: empresa + primeira loja + dono + livro,
// tudo ou nada, conferindo a entrada de novo e com o próprio freio por IP.
// Daqui só sai o pedido, já validado e com a senha em hash.
//
// ── o que nasce ──────────────────────────────────────────────
// Desde a tabela de 02/10/2026: o Norte + Assistente em TESTE, por 30 dias
// (PRECOS.diasDeTeste). Não há mais plano grátis à venda. Quando o prazo
// vence, `vencerTesteSeAcabou` (assinatura.ts) desce a empresa para o Grátis
// na primeira tela que alguém abrir — os dados ficam, o básico continua, e o
// resto volta ao assinar. No teste as respostas do assistente são as de
// conhecer (PRECOS.respostasDoTeste, para o teste inteiro), não as do mês: o
// cadastro é aberto.
//
// ── as três travas contra robô ───────────────────────────────
//   1. O freio do banco: 3 empresas por hora por endereço de rede, 60 no
//      total. Fica na função, e não aqui, porque só ela enxerga todas.
//   2. Um campo que ninguém vê (`site`): gente não preenche, robô preenche.
//   3. O carimbo de tempo assinado: o formulário leva a hora em que foi
//      aberto, assinada com o segredo da sessão. Enviado em menos de 3
//      segundos é robô; aberto há mais de 6 horas, a página é velha.
// Nenhuma das três é perfeita sozinha. Juntas, tiram o grosso — e o que
// passar ainda precisa confirmar um e-mail de verdade para entrar.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { clientePortaria } from './banco'
import { guardarSenha } from './senha'
import { normalizar } from './autenticacao'
import { enderecoDoNome } from './enderecos'
import { RAMOS } from './modulos'
import { REVISADO_EM } from './legal'

/** Desligado só com CADASTRO_ABERTO=0 — aí a página manda falar com a gente. */
export function cadastroAberto(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CADASTRO_ABERTO ?? '').trim() !== '0'
}

/** A versão dos Termos e da Política que a pessoa aceitou — vai para o livro. */
export const VERSAO_TERMOS = REVISADO_EM

export const MIN_SEGUNDOS_NO_FORMULARIO = 3
export const MAX_HORAS_NO_FORMULARIO = 6

// ─────────────────────────────────────────────────────────────
// O CARIMBO DO FORMULÁRIO
// ─────────────────────────────────────────────────────────────

function segredo(): string {
  const s = process.env.SEGREDO_SESSAO
  if (!s || s.length < 32) throw new Error('Falta SEGREDO_SESSAO no .env (mínimo 32 caracteres).')
  return s
}

const assinar = (instante: string) =>
  createHmac('sha256', segredo()).update(`cadastro.${instante}`).digest('base64url')

/** A hora em que o formulário foi aberto, assinada. Vai num campo escondido. */
export function carimbar(agora = Date.now()): string {
  const instante = String(agora)
  return `${instante}.${assinar(instante)}`
}

export type Carimbo = 'ok' | 'rapido' | 'velho' | 'invalido'

export function conferirCarimbo(valor: string, agora = Date.now()): Carimbo {
  const [instante, assinatura] = valor.split('.')
  if (!instante || !assinatura || !/^\d{10,16}$/.test(instante)) return 'invalido'
  const esperada = Buffer.from(assinar(instante))
  const recebida = Buffer.from(assinatura)
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return 'invalido'
  const passou = agora - Number(instante)
  if (passou < MIN_SEGUNDOS_NO_FORMULARIO * 1000) return 'rapido'
  if (passou > MAX_HORAS_NO_FORMULARIO * 3600_000) return 'velho'
  return 'ok'
}

// ─────────────────────────────────────────────────────────────
// OS DADOS
// ─────────────────────────────────────────────────────────────

export type DadosCadastro = {
  empresa: string
  dono: string
  email: string
  senha: string
  ramo: string
  aceitou: boolean
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// Caractere de controle em nome é colagem estragada ou tentativa de
// bagunçar e-mail e log. Não tem nome de loja que precise dele.
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/

/** A frase para a tela, ou null quando está tudo certo. Puro, para o teste. */
export function conferirDados(d: DadosCadastro): string | null {
  const empresa = d.empresa.trim()
  const dono = d.dono.trim()
  if (empresa.length < 2 || empresa.length > 80 || CONTROLE.test(empresa)) {
    return 'Diga o nome da empresa (de 2 a 80 letras).'
  }
  if (dono.length < 2 || dono.length > 80 || CONTROLE.test(dono)) return 'Diga o seu nome (de 2 a 80 letras).'
  const email = normalizar(d.email)
  if (email.length > 254 || !EMAIL.test(email)) return 'Esse e-mail não parece certo. Confira.'
  if (!(d.ramo in RAMOS)) return 'Escolha o ramo da loja.'
  if (d.senha.length < 8) return 'A senha precisa de pelo menos 8 caracteres.'
  if (!d.aceitou) return 'Para criar a conta, é preciso aceitar os Termos de Uso e a Política de Privacidade.'
  return null
}

export type Criacao =
  | { ok: true; orgId: string; usuarioId: string; endereco: string }
  | { ok: false; motivo: 'dados'; recado: string }
  | { ok: false; motivo: 'muitas_tentativas' | 'muitas_no_geral' }

/**
 * Cria a empresa. `emailPendente` = a conta só entra depois de confirmar o
 * e-mail (quem decide é a ação: só faz sentido com e-mail configurado).
 */
export async function criarEmpresaPeloCadastro(
  d: DadosCadastro,
  ip: string | null,
  opcoes: { emailPendente: boolean },
): Promise<Criacao> {
  const recado = conferirDados(d)
  if (recado) return { ok: false, motivo: 'dados', recado }

  let senhaHash: string
  try {
    senhaHash = await guardarSenha(d.senha)
  } catch (e) {
    return { ok: false, motivo: 'dados', recado: e instanceof Error ? e.message : 'Senha inválida.' }
  }

  const linhas = await clientePortaria().$queryRaw<
    { r_org: string | null; r_usuario: string | null; r_endereco: string | null; r_recusa: string | null }[]
  >`
    select r_org, r_usuario, r_endereco, r_recusa
      from public.criar_empresa_cadastro(
        ${d.empresa.trim()}::text, ${enderecoDoNome(d.empresa)}::text, ${d.dono.trim()}::text,
        ${normalizar(d.email)}::text, ${senhaHash}::text, ${d.ramo}::text, ${ip}::text,
        ${opcoes.emailPendente}::boolean, ${VERSAO_TERMOS}::text
      )
  `
  const l = linhas[0]
  if (l?.r_recusa === 'muitas_tentativas' || l?.r_recusa === 'muitas_no_geral') return { ok: false, motivo: l.r_recusa }
  if (!l?.r_org || !l.r_usuario || !l.r_endereco) throw new Error('O banco não devolveu a empresa criada.')
  return { ok: true, orgId: l.r_org, usuarioId: l.r_usuario, endereco: l.r_endereco }
}
