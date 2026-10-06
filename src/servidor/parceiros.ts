// O programa de parceiros: quem indica o Norte e recebe por isso.
//
// ── as regras, numa frase cada ───────────────────────────────
// • O parceiro tem um link (gestornorte.com/?ref=CODIGO) e um código. A
//   empresa que se cadastra por ele fica sendo indicação dele para sempre.
// • A empresa indicada tem os 30 dias de teste como todo mundo e, quando
//   assina, paga METADE da primeira mensalidade.
// • O parceiro ganha uma porcentagem de cada mensalidade PAGA pela empresa,
//   nos primeiros 12 meses pagos. A porcentagem sobe com o número de
//   clientes dele que estão pagando: começa em 10% e chega a 30%.
// • Segundo nível: quem trouxe o parceiro para o programa ganha 5% das
//   mensalidades dos clientes dele — desde que tenha pelo menos um cliente
//   próprio pagando. Para no segundo nível: não existe terceiro.
// • Ninguém ganha por cadastrar parceiro. Só mensalidade paga gera dinheiro
//   — é o que separa programa de indicação de pirâmide.
// • A comissão fica 30 dias em carência (pagamento devolvido não vira
//   comissão paga) e é paga por Pix no dia 10, a partir de R$ 50.
//
// ── onde mora cada coisa ─────────────────────────────────────
// As contas puras (faixa, comissão, código) ficam no começo deste arquivo,
// testadas sem banco. O banco: prisma/sql/rls.sql (o isolamento e as funções
// de cadastro e login) e as tabelas parceiros, indicacoes, pagamentos_norte,
// comissoes e repasses (schema.prisma).

import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { carimbarParceiro, clientePortaria, comoOrg, comoParceiro, type BancoDaOrg } from './banco'
import { centavos, mostrar } from './dinheiro'
import { guardarSenha, conferirSenha, HASH_ISCA } from './senha'
import { diaEmSP } from './dia'

// ─────────────────────────────────────────────────────────────
// AS REGRAS
// ─────────────────────────────────────────────────────────────

export const VERSAO_TERMOS_PARCEIRO = '6 de outubro de 2026'

/** A comissão de quem indicou, pelo número de clientes dele que estão pagando. */
export const FAIXAS: readonly { de: number; pct: number }[] = [
  { de: 0, pct: 10 },
  { de: 5, pct: 15 },
  { de: 10, pct: 20 },
  { de: 20, pct: 25 },
  { de: 30, pct: 30 },
]
/** O segundo nível: sobre os clientes de quem você trouxe. */
export const NIVEL2_PCT = 5
/** Quantos clientes pagando o patrocinador precisa ter para o segundo nível valer. */
export const NIVEL2_MINIMO_CLIENTES = 1
/** Quantas mensalidades de cada cliente geram comissão. */
export const MESES_DE_COMISSAO = 12
export const CARENCIA_DIAS = 30
export const MINIMO_REPASSE = 50
export const DIA_DO_REPASSE = 10
/** O desconto da empresa indicada, na primeira mensalidade paga. */
export const DESCONTO_PRIMEIRA_PCT = 50
/** Quanto tempo o link fica guardado no navegador de quem clicou. */
export const DIAS_DO_LINK = 90
/** "Pagando" = pagou uma mensalidade nos últimos tantos dias. */
export const ATIVO_DIAS = 45

export const COOKIE_REF = 'norte_ref'

export type Faixa = { pct: number; de: number; ate: number | null; proxima: { pct: number; faltam: number } | null }

/** A faixa de quem tem `ativos` clientes pagando. */
export function faixaDe(ativos: number): Faixa {
  const n = Math.max(0, Math.floor(ativos))
  let i = 0
  for (let k = 0; k < FAIXAS.length; k++) if (n >= FAIXAS[k]!.de) i = k
  const atual = FAIXAS[i]!
  const prox = FAIXAS[i + 1]
  return {
    pct: atual.pct,
    de: atual.de,
    ate: prox ? prox.de - 1 : null,
    proxima: prox ? { pct: prox.pct, faltam: prox.de - n } : null,
  }
}

/** Meses de "AAAA-MM" até "AAAA-MM" (0 = o mesmo mês). */
export function mesesEntre(de: string, ate: string): number {
  const [a1 = 0, m1 = 0] = de.split('-').map(Number)
  const [a2 = 0, m2 = 0] = ate.split('-').map(Number)
  return (a2 - a1) * 12 + (m2 - m1)
}

/** Porcentagem de um valor em centavos, arredondada ao centavo. */
export const parte = (baseCent: number, pct: number) => Math.round((baseCent * pct) / 100)

export type ComissaoCalculada = { parceiroId: string; nivel: 1 | 2; pct: number; valorCent: number }

/**
 * As comissões de UM pagamento. Puro: quem chama diz quantos clientes cada
 * um tem pagando (já contando este) e qual foi o primeiro mês pago.
 */
export function calcularComissoes(p: {
  baseCent: number
  referencia: string
  primeiroMes: string
  parceiro: { id: string; ativo: boolean; clientes: number }
  patrocinador: { id: string; ativo: boolean; clientes: number } | null
}): ComissaoCalculada[] {
  if (p.baseCent <= 0) return []
  const n = mesesEntre(p.primeiroMes, p.referencia)
  if (n < 0 || n >= MESES_DE_COMISSAO) return []
  const saida: ComissaoCalculada[] = []
  if (p.parceiro.ativo) {
    const pct = faixaDe(p.parceiro.clientes).pct
    saida.push({ parceiroId: p.parceiro.id, nivel: 1, pct, valorCent: parte(p.baseCent, pct) })
  }
  const pt = p.patrocinador
  if (pt && pt.ativo && pt.id !== p.parceiro.id && pt.clientes >= NIVEL2_MINIMO_CLIENTES) {
    saida.push({ parceiroId: pt.id, nivel: 2, pct: NIVEL2_PCT, valorCent: parte(p.baseCent, NIVEL2_PCT) })
  }
  return saida.filter((c) => c.valorCent > 0)
}

/** O código como o banco guarda: maiúsculas e números, de 3 a 20. Ou null. */
export function normalizarCodigo(bruto: string | null | undefined): string | null {
  const c = String(bruto ?? '').trim().toUpperCase()
  return /^[A-Z0-9]{3,20}$/.test(c) ? c : null
}

/** A sugestão de código a partir do nome: "Maria José" → "MARIAJOSE". */
export function codigoDoNome(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
  const base = (limpo[0] ?? '').replace(/[^A-Z0-9]/g, '')
  const segundo = (limpo[1] ?? '').replace(/[^A-Z0-9]/g, '')
  const junto = base.length < 6 && segundo ? base + segundo : base
  return junto.slice(0, 14) || 'NORTE'
}

export const PIX_TIPOS = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'] as const
export type PixTipo = (typeof PIX_TIPOS)[number]
export const NOME_DO_PIX: Record<PixTipo, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Telefone',
  aleatoria: 'Chave aleatória',
}

const so = (t: string) => t.replace(/\D/g, '')

function cpfValido(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false
  const dv = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10])
}

function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = pesos.reduce((t, p, i) => t + p * Number(c[i]), 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13])
}

/** O documento (CPF ou CNPJ) só com números, ou o recado do erro. */
export function lerDocumento(bruto: string): { ok: string } | { erro: string } {
  const d = so(bruto)
  if (d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false) return { ok: d }
  return { erro: 'Esse CPF ou CNPJ não confere. Digite só os números.' }
}

/** A chave Pix conferida pelo tipo, ou o recado do erro. */
export function lerPix(tipo: string, bruto: string): { ok: { tipo: PixTipo; chave: string } } | { erro: string } {
  const t = tipo as PixTipo
  const v = bruto.trim()
  if (!PIX_TIPOS.includes(t)) return { erro: 'Escolha o tipo da chave Pix.' }
  if (t === 'cpf') return cpfValido(so(v)) ? { ok: { tipo: t, chave: so(v) } } : { erro: 'Esse CPF não confere.' }
  if (t === 'cnpj') return cnpjValido(so(v)) ? { ok: { tipo: t, chave: so(v) } } : { erro: 'Esse CNPJ não confere.' }
  if (t === 'email') {
    const e = v.toLowerCase()
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 77 ? { ok: { tipo: t, chave: e } } : { erro: 'Esse e-mail não parece certo.' }
  }
  if (t === 'telefone') {
    const n = so(v).replace(/^55(?=\d{10,11}$)/, '')
    return /^\d{10,11}$/.test(n) ? { ok: { tipo: t, chave: `+55${n}` } } : { erro: 'Digite o telefone com DDD.' }
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? { ok: { tipo: t, chave: v.toLowerCase() } }
    : { erro: 'A chave aleatória tem 32 letras e números, com hífens.' }
}

/** "123.456.789-09" ou "12.345.678/0001-90" — para mostrar. */
export function mostrarDocumento(d: string | null): string {
  if (!d) return ''
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return d
}

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type DadosParceiro = {
  nome: string
  email: string
  telefone: string
  senha: string
  aceitou: boolean
}

/** A frase para a tela, ou null quando está tudo certo. */
export function conferirDadosParceiro(d: DadosParceiro): string | null {
  const nome = d.nome.trim()
  if (nome.length < 2 || nome.length > 80 || CONTROLE.test(nome)) return 'Diga o seu nome (de 2 a 80 letras).'
  const email = normalizar(d.email)
  if (email.length > 254 || !EMAIL.test(email)) return 'Esse e-mail não parece certo. Confira.'
  const tel = so(d.telefone)
  if (tel && (tel.length < 10 || tel.length > 13)) return 'Digite o WhatsApp com DDD.'
  if (d.senha.length < 8) return 'A senha precisa de pelo menos 8 caracteres.'
  if (!d.aceitou) return 'Para entrar no programa, é preciso aceitar os termos do programa de parceiros.'
  return null
}

/** O mês de um instante, em São Paulo: "2026-10". */
export const mesDe = (d: Date) => diaEmSP(d).slice(0, 7)

/** O e-mail como o banco guarda (o mesmo de autenticacao.ts). */
export const normalizar = (email: string) => email.trim().toLowerCase()

const resumo = (t: string) => createHash('sha256').update(t).digest('hex')
const n = (v: Prisma.Decimal | number | string) => centavos(v)

// ─────────────────────────────────────────────────────────────
// CADASTRO E LOGIN (pela portaria: as funções do banco)
// ─────────────────────────────────────────────────────────────

export type CadastroParceiro =
  | { ok: true; parceiroId: string; codigo: string }
  | { ok: false; recado: string }

export async function cadastrarParceiro(
  d: DadosParceiro,
  ip: string | null,
  patrocinador: string | null,
): Promise<CadastroParceiro> {
  const recado = conferirDadosParceiro(d)
  if (recado) return { ok: false, recado }
  let hash: string
  try {
    hash = await guardarSenha(d.senha)
  } catch (e) {
    return { ok: false, recado: e instanceof Error ? e.message : 'Senha inválida.' }
  }
  const linhas = await clientePortaria().$queryRaw<{ r_parceiro: string | null; r_codigo: string | null; r_recusa: string | null }[]>`
    select r_parceiro, r_codigo, r_recusa from public.criar_parceiro_cadastro(
      ${d.nome.trim()}::text, ${normalizar(d.email)}::text, ${hash}::text, ${so(d.telefone) || null}::text,
      ${codigoDoNome(d.nome)}::text, ${normalizarCodigo(patrocinador)}::text, ${ip}::text, ${VERSAO_TERMOS_PARCEIRO}::text
    )
  `
  const l = linhas[0]
  if (l?.r_recusa === 'email_em_uso') {
    return { ok: false, recado: 'Este e-mail já tem conta de parceiro. Entre com ele, ou use “Esqueci a senha”.' }
  }
  if (l?.r_recusa === 'muitas_tentativas') return { ok: false, recado: 'Muitas contas criadas desta conexão. Tente de novo mais tarde.' }
  if (l?.r_recusa) return { ok: false, recado: 'Muita gente se cadastrando agora. Tente de novo em alguns minutos.' }
  if (!l?.r_parceiro || !l.r_codigo) throw new Error('O banco não devolveu o parceiro criado.')
  return { ok: true, parceiroId: l.r_parceiro, codigo: l.r_codigo }
}

export type EntradaParceiro =
  | { ok: true; parceiroId: string }
  | { ok: false; recado: string }

export async function entrarParceiro(email: string, senha: string, ip: string | null): Promise<EntradaParceiro> {
  const linhas = await clientePortaria().$queryRaw<
    { r_tentativa: string | null; r_parceiro: string | null; r_hash: string | null; r_situacao: string | null; r_recusa: string | null }[]
  >`select * from public.parceiro_para_entrar(${normalizar(email)}::text, ${ip}::text)`
  const l = linhas[0]
  if (l?.r_recusa === 'muitas_tentativas') {
    return { ok: false, recado: 'Muitas tentativas seguidas. Espere 15 minutos e tente de novo.' }
  }
  // Confere a senha mesmo sem conta: gasta o mesmo tempo dos dois jeitos.
  const bate = await conferirSenha(senha, l?.r_hash ?? HASH_ISCA)
  if (!l?.r_parceiro || !bate) return { ok: false, recado: 'E-mail ou senha não conferem.' }
  if (l.r_situacao !== 'ATIVO') return { ok: false, recado: 'Esta conta de parceiro está bloqueada. Fale com a equipe do Norte.' }
  await clientePortaria().$executeRaw`select public.parceiro_tentativa_ok(${l.r_tentativa}::text)`
  return { ok: true, parceiroId: l.r_parceiro }
}

/** O primeiro nome de quem é dono do código, ou null. Para a tela de cadastro. */
export async function nomePeloCodigo(codigo: string | null | undefined): Promise<string | null> {
  const c = normalizarCodigo(codigo)
  if (!c) return null
  try {
    const l = await clientePortaria().$queryRaw<{ r_nome: string }[]>`select r_nome from public.parceiro_pelo_codigo(${c}::text)`
    return l[0]?.r_nome ?? null
  } catch {
    return null
  }
}

/** "Esqueci a senha": devolve o código para o e-mail (null quando não há conta ou freou). */
export async function pedirTrocaDeSenha(email: string, ip: string | null): Promise<{ nome: string; codigo: string } | null> {
  const codigo = randomBytes(24).toString('base64url')
  const l = await clientePortaria().$queryRaw<{ r_nome: string | null; r_recusa: string | null }[]>`
    select r_nome, r_recusa from public.parceiro_pedir_troca(${normalizar(email)}::text, ${resumo(codigo)}::text, ${ip}::text)
  `
  return l[0]?.r_nome ? { nome: l[0].r_nome, codigo } : null
}

export async function trocarSenhaPeloCodigo(
  codigo: string,
  senha: string,
): Promise<{ ok: true; parceiroId: string } | { ok: false; recado: string }> {
  let hash: string
  try {
    hash = await guardarSenha(senha)
  } catch (e) {
    return { ok: false, recado: e instanceof Error ? e.message : 'Senha inválida.' }
  }
  const l = await clientePortaria().$queryRaw<{ r_parceiro: string }[]>`
    select r_parceiro from public.parceiro_trocar_senha(${resumo(codigo)}::text, ${hash}::text)
  `
  if (!l[0]?.r_parceiro) return { ok: false, recado: 'Este link já foi usado ou venceu. Peça outro em “Esqueci a senha”.' }
  return { ok: true, parceiroId: l[0].r_parceiro }
}

// ─────────────────────────────────────────────────────────────
// O PAINEL DO PARCEIRO
// ─────────────────────────────────────────────────────────────

export type SituacaoDaIndicacao = 'teste' | 'pagando' | 'parou'

export type Painel = {
  parceiro: {
    id: string
    nome: string
    email: string
    telefone: string | null
    codigo: string
    pixTipo: PixTipo | null
    pixChave: string | null
    documento: string | null
    desde: Date
  }
  ativos: number
  faixa: Faixa
  /** Os clientes que vieram pelo seu link. */
  indicacoes: { id: string; empresa: string; desde: Date; situacao: SituacaoDaIndicacao; ganhoCent: number }[]
  /** Quem você trouxe para o programa (o segundo nível). */
  rede: { id: string; nome: string; desde: Date; indicadas: number; ativas: number }[]
  comissoes: {
    id: string
    referencia: string
    empresa: string
    nivel: number
    pct: number
    baseCent: number
    valorCent: number
    liberaEm: Date
    situacao: 'carencia' | 'liberada' | 'paga' | 'estornada'
  }[]
  repasses: { id: string; valorCent: number; pagoEm: Date; pixChave: string; comprovante: string | null }[]
  totais: {
    /** Liberado e ainda não pago. */
    liberadoCent: number
    /** Ainda nos 30 dias. */
    carenciaCent: number
    pagoCent: number
    /** Ganho das comissões com referência no mês corrente. */
    doMesCent: number
    nivel1Cent: number
    nivel2Cent: number
  }
  /** Quando cai o próximo Pix, se houver o mínimo liberado até lá. */
  proximoRepasse: { dia: string; valorCent: number; faltaPix: boolean } | null
}

/** O próximo dia 10 (hoje conta, se for dia 10). */
export function proximoDiaDeRepasse(agora = new Date()): string {
  const hoje = diaEmSP(agora)
  const [a = 0, m = 0, d = 0] = hoje.split('-').map(Number)
  if (d <= DIA_DO_REPASSE) return `${a}-${String(m).padStart(2, '0')}-${String(DIA_DO_REPASSE).padStart(2, '0')}`
  const am = m === 12 ? a + 1 : a
  const mm = m === 12 ? 1 : m + 1
  return `${am}-${String(mm).padStart(2, '0')}-${String(DIA_DO_REPASSE).padStart(2, '0')}`
}

const ativoDesde = (agora: Date) => new Date(agora.getTime() - ATIVO_DIAS * 864e5)

export async function painelDoParceiro(parceiroId: string, agora = new Date()): Promise<Painel | null> {
  return comoParceiro(parceiroId, async (db) => {
    const p = await db.parceiro.findUnique({
      where: { id: parceiroId },
      select: {
        id: true, nome: true, email: true, telefone: true, codigo: true, pixTipo: true,
        pixChave: true, documento: true, criadoEm: true, situacao: true,
      },
    })
    if (!p || p.situacao !== 'ATIVO') return null

    const indicacoes = await db.indicacao.findMany({
      where: { parceiroId },
      orderBy: { criadaEm: 'desc' },
      select: { id: true, orgId: true, empresaNome: true, criadaEm: true, primeiroPagamentoEm: true, ultimoPagamentoEm: true },
    })
    const comissoes = await db.comissao.findMany({
      where: { parceiroId },
      orderBy: [{ criadaEm: 'desc' }],
      take: 500,
      select: {
        id: true, orgId: true, referencia: true, empresaNome: true, nivel: true, percentual: true, base: true,
        valor: true, liberaEm: true, estornadaEm: true, repasseId: true,
      },
    })
    const repasses = await db.repasse.findMany({
      where: { parceiroId },
      orderBy: { pagoEm: 'desc' },
      select: { id: true, valor: true, pagoEm: true, pixChave: true, comprovante: true },
    })
    const rede = await db.$queryRaw<{ r_id: string; r_nome: string; r_desde: Date; r_indicadas: number; r_ativas: number }[]>`
      select * from public.rede_do_parceiro()
    `

    const corte = ativoDesde(agora)
    const situacaoDe = (i: (typeof indicacoes)[number]): SituacaoDaIndicacao =>
      !i.primeiroPagamentoEm ? 'teste' : i.ultimoPagamentoEm && i.ultimoPagamentoEm > corte ? 'pagando' : 'parou'
    const ativos = indicacoes.filter((i) => situacaoDe(i) === 'pagando').length

    const ganhoPorOrg = new Map<string, number>()
    const lista = comissoes.map((c) => {
      const situacao: Painel['comissoes'][number]['situacao'] = c.estornadaEm
        ? 'estornada'
        : c.repasseId
          ? 'paga'
          : c.liberaEm <= agora
            ? 'liberada'
            : 'carencia'
      if (c.nivel === 1 && situacao !== 'estornada') ganhoPorOrg.set(c.orgId, (ganhoPorOrg.get(c.orgId) ?? 0) + n(c.valor))
      return {
        id: c.id,
        referencia: c.referencia,
        // No segundo nível o parceiro não precisa saber o nome da empresa de
        // outra pessoa: basta saber que é da rede.
        empresa: c.nivel === 1 ? c.empresaNome : 'Cliente da sua rede',
        nivel: c.nivel,
        pct: Number(c.percentual),
        baseCent: n(c.base),
        valorCent: n(c.valor),
        liberaEm: c.liberaEm,
        situacao,
      }
    })

    const soma = (f: (c: (typeof lista)[number]) => boolean) => lista.filter(f).reduce((t, c) => t + c.valorCent, 0)
    const mes = mesDe(agora)
    const totais = {
      liberadoCent: soma((c) => c.situacao === 'liberada'),
      carenciaCent: soma((c) => c.situacao === 'carencia'),
      pagoCent: soma((c) => c.situacao === 'paga'),
      doMesCent: soma((c) => c.referencia === mes && c.situacao !== 'estornada'),
      nivel1Cent: soma((c) => c.nivel === 1 && c.situacao !== 'estornada'),
      nivel2Cent: soma((c) => c.nivel === 2 && c.situacao !== 'estornada'),
    }

    // O que estará liberado até o próximo dia 10.
    const dia = proximoDiaDeRepasse(agora)
    const ateODia = new Date(`${dia}T23:59:59-03:00`)
    const ateLa = lista
      .filter((c) => (c.situacao === 'liberada' || c.situacao === 'carencia') && c.liberaEm <= ateODia)
      .reduce((t, c) => t + c.valorCent, 0)

    return {
      parceiro: {
        id: p.id,
        nome: p.nome,
        email: p.email,
        telefone: p.telefone,
        codigo: p.codigo,
        pixTipo: (p.pixTipo as PixTipo | null) ?? null,
        pixChave: p.pixChave,
        documento: p.documento,
        desde: p.criadoEm,
      },
      ativos,
      faixa: faixaDe(ativos),
      indicacoes: indicacoes.map((i) => ({
        id: i.id,
        empresa: i.empresaNome,
        desde: i.criadaEm,
        situacao: situacaoDe(i),
        ganhoCent: ganhoPorOrg.get(i.orgId) ?? 0,
      })),
      rede: rede.map((r) => ({ id: r.r_id, nome: r.r_nome, desde: r.r_desde, indicadas: Number(r.r_indicadas), ativas: Number(r.r_ativas) })),
      comissoes: lista,
      repasses: repasses.map((r) => ({ id: r.id, valorCent: n(r.valor), pagoEm: r.pagoEm, pixChave: r.pixChave, comprovante: r.comprovante })),
      totais,
      proximoRepasse: ateLa >= MINIMO_REPASSE * 100 ? { dia, valorCent: ateLa, faltaPix: !p.pixChave } : null,
    }
  })
}

/** A sessão do parceiro ainda vale? (conta ativa e sem troca de senha depois dela) */
export async function sessaoDoParceiroVale(parceiroId: string, nasceu: Date): Promise<{ nome: string } | null> {
  const p = await comoParceiro(parceiroId, (db) =>
    db.parceiro.findUnique({ where: { id: parceiroId }, select: { nome: true, situacao: true, sessoesDesde: true } }),
  )
  if (!p || p.situacao !== 'ATIVO') return null
  // Um segundo de folga: a sessão nasce no mesmo instante do corte.
  if (p.sessoesDesde.getTime() > nasceu.getTime() + 1000) return null
  return { nome: p.nome }
}

export type DadosDePagamento = { pixTipo: string; pixChave: string; documento: string; telefone: string }

export async function salvarDadosDoParceiro(parceiroId: string, d: DadosDePagamento): Promise<{ ok: true } | { ok: false; recado: string }> {
  const pix = lerPix(d.pixTipo, d.pixChave)
  if ('erro' in pix) return { ok: false, recado: pix.erro }
  const doc = lerDocumento(d.documento)
  if ('erro' in doc) return { ok: false, recado: doc.erro }
  const tel = so(d.telefone)
  if (tel && (tel.length < 10 || tel.length > 13)) return { ok: false, recado: 'Digite o WhatsApp com DDD.' }
  await comoParceiro(parceiroId, (db) =>
    db.parceiro.update({
      where: { id: parceiroId },
      data: { pixTipo: pix.ok.tipo, pixChave: pix.ok.chave, documento: doc.ok, telefone: tel || null },
    }),
  )
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────
// A EMPRESA (quem foi indicada, e quem indica)
// ─────────────────────────────────────────────────────────────

/** A indicação da empresa e se o desconto da primeira mensalidade ainda vale. */
export async function indicacaoDaEmpresa(orgId: string): Promise<{ descontoDisponivel: boolean } | null> {
  return comoOrg(orgId, async (db) => {
    const i = await db.indicacao.findUnique({ where: { orgId }, select: { descontoUsadoEm: true } })
    if (!i) return null
    const pagos = await db.pagamentoNorte.count()
    return { descontoDisponivel: !i.descontoUsadoEm && pagos === 0 }
  })
}

/** A conta de parceiro da própria empresa (Indique e ganhe), ou null. */
export async function parceiroDaEmpresa(orgId: string): Promise<string | null> {
  const o = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { parceiroId: true } }))
  return o?.parceiroId ?? null
}

/**
 * Liga a empresa a uma conta de parceiro: cria a conta (com o nome e o e-mail
 * de quem está pedindo) ou, se o e-mail já é de um parceiro, confere a senha
 * dela e vincula.
 */
export async function ativarParceiroDaEmpresa(
  orgId: string,
  quem: { nome: string; email: string },
  senha: string,
  ip: string | null,
): Promise<{ ok: true } | { ok: false; recado: string }> {
  let parceiroId: string
  const r = await cadastrarParceiro({ nome: quem.nome, email: quem.email, telefone: '', senha, aceitou: true }, ip, null)
  if (r.ok) {
    parceiroId = r.parceiroId
  } else if (r.recado.startsWith('Este e-mail já tem conta')) {
    const e = await entrarParceiro(quem.email, senha, ip)
    if (!e.ok) return { ok: false, recado: 'Este e-mail já tem conta de parceiro. Digite a senha DELA para vincular.' }
    parceiroId = e.parceiroId
  } else {
    return r
  }
  await comoOrg(orgId, async (db) => {
    await db.org.update({ where: { id: orgId }, data: { parceiroId } })
    await db.auditoria.create({
      data: { orgId, quem: quem.nome, autor: 'PESSOA', acao: 'parceiro.ativou', alvoTipo: 'empresa', alvoId: orgId, alvoNome: 'Indique e ganhe' },
    })
  })
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────
// A EQUIPE: pagamento da mensalidade, repasse, bloqueio
// ─────────────────────────────────────────────────────────────

export const FORMAS_DE_PAGAMENTO = ['pix', 'boleto', 'cartao', 'transferencia', 'dinheiro'] as const
export type FormaDePagamento = (typeof FORMAS_DE_PAGAMENTO)[number]

export type PagamentoRegistrado = {
  pagamentoId: string
  valorPagoCent: number
  descontoCent: number
  comissoes: { parceiroId: string; nivel: number; pct: number; valorCent: number }[]
}

export class PagamentoRepetido extends Error {}

/**
 * Registra uma mensalidade do Norte paga pela empresa e gera as comissões
 * de quem a indicou — numa transação só (a da empresa, que passa a
 * enxergar também o parceiro: ver `carimbarParceiro`).
 */
export async function registrarPagamento(
  orgId: string,
  d: {
    referencia: string
    valorCheioCent: number
    valorPagoCent: number
    forma: FormaDePagamento
    pagoEm: Date
    quem: string
    observacao?: string | null
  },
): Promise<PagamentoRegistrado> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.referencia)) throw new Error('O mês pago vem como AAAA-MM.')
  if (!FORMAS_DE_PAGAMENTO.includes(d.forma)) throw new Error('Forma de pagamento desconhecida.')
  if (!Number.isInteger(d.valorPagoCent) || d.valorPagoCent <= 0) throw new Error('O valor pago precisa ser maior que zero.')
  if (!Number.isInteger(d.valorCheioCent) || d.valorCheioCent < d.valorPagoCent) {
    throw new Error('O valor cheio não pode ser menor que o pago.')
  }
  const descontoCent = d.valorCheioCent - d.valorPagoCent
  const liberaEm = new Date(d.pagoEm.getTime() + CARENCIA_DIAS * 864e5)

  return comoOrg(orgId, async (db) => {
    const ja = await db.pagamentoNorte.findUnique({ where: { orgId_referencia: { orgId, referencia: d.referencia } }, select: { id: true } })
    if (ja) throw new PagamentoRepetido(`O mês ${d.referencia} já está registrado como pago para esta empresa.`)

    const pagamento = await db.pagamentoNorte.create({
      data: {
        orgId,
        referencia: d.referencia,
        valorCheio: new Prisma.Decimal(d.valorCheioCent).div(100),
        desconto: new Prisma.Decimal(descontoCent).div(100),
        valorPago: new Prisma.Decimal(d.valorPagoCent).div(100),
        forma: d.forma,
        pagoEm: d.pagoEm,
        quem: d.quem,
        observacao: d.observacao?.trim().slice(0, 300) || null,
      },
      select: { id: true },
    })

    const ind = await db.indicacao.findUnique({
      where: { orgId },
      select: { id: true, parceiroId: true, empresaNome: true, primeiroPagamentoEm: true, descontoUsadoEm: true },
    })
    const geradas: PagamentoRegistrado['comissoes'] = []
    if (ind) {
      await db.indicacao.update({
        where: { id: ind.id },
        data: {
          ultimoPagamentoEm: d.pagoEm,
          primeiroPagamentoEm: ind.primeiroPagamentoEm ?? d.pagoEm,
          descontoUsadoEm: ind.descontoUsadoEm ?? (descontoCent > 0 ? d.pagoEm : null),
        },
      })
      const primeiro = await db.pagamentoNorte.findFirst({ orderBy: { referencia: 'asc' }, select: { referencia: true } })

      const contar = async (id: string) =>
        Number((await db.$queryRaw<{ n: number }[]>`select public.clientes_ativos_do_parceiro(${id}::text) as n`)[0]?.n ?? 0)
      const ler = async (id: string) => {
        await carimbarParceiro(db, id)
        return db.parceiro.findUnique({ where: { id }, select: { id: true, situacao: true, patrocinadorId: true } })
      }

      const parceiro = await ler(ind.parceiroId)
      const patro = parceiro?.patrocinadorId ? await ler(parceiro.patrocinadorId) : null
      await carimbarParceiro(db, null)

      if (parceiro) {
        const calc = calcularComissoes({
          baseCent: d.valorPagoCent,
          referencia: d.referencia,
          primeiroMes: primeiro?.referencia ?? d.referencia,
          parceiro: { id: parceiro.id, ativo: parceiro.situacao === 'ATIVO', clientes: await contar(parceiro.id) },
          patrocinador: patro ? { id: patro.id, ativo: patro.situacao === 'ATIVO', clientes: await contar(patro.id) } : null,
        })
        for (const c of calc) {
          await db.comissao.create({
            data: {
              orgId,
              pagamentoId: pagamento.id,
              parceiroId: c.parceiroId,
              nivel: c.nivel,
              percentual: new Prisma.Decimal(c.pct),
              base: new Prisma.Decimal(d.valorPagoCent).div(100),
              valor: new Prisma.Decimal(c.valorCent).div(100),
              referencia: d.referencia,
              empresaNome: ind.empresaNome,
              liberaEm,
            },
          })
          geradas.push({ parceiroId: c.parceiroId, nivel: c.nivel, pct: c.pct, valorCent: c.valorCent })
        }
      }
    }

    await db.auditoria.create({
      data: {
        orgId,
        quem: d.quem,
        autor: 'SISTEMA',
        acao: 'mensalidade.pagou',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: `mensalidade ${d.referencia}`,
        valor: new Prisma.Decimal(d.valorPagoCent).div(100),
        depois: {
          referencia: d.referencia,
          forma: d.forma,
          desconto: descontoCent / 100,
          comissoes: geradas.map((g) => ({ nivel: g.nivel, pct: g.pct, valor: g.valorCent / 100 })),
        },
      },
    })

    return { pagamentoId: pagamento.id, valorPagoCent: d.valorPagoCent, descontoCent, comissoes: geradas }
  })
}

/**
 * O que a empresa deve pagar no mês: a mensalidade da tabela e, se veio por
 * indicação e ainda não pagou nada, o desconto da primeira.
 */
export function valorDaMensalidade(totalCent: number, descontoDisponivel: boolean): { cheioCent: number; pagarCent: number; descontoCent: number } {
  const descontoCent = descontoDisponivel ? parte(totalCent, DESCONTO_PRIMEIRA_PCT) : 0
  return { cheioCent: totalCent, pagarCent: totalCent - descontoCent, descontoCent }
}

export class RepasseRecusado extends Error {}

/** A equipe pagou o Pix: marca as comissões liberadas como pagas. */
export async function registrarRepasse(
  parceiroId: string,
  d: { quem: string; comprovante?: string | null; agora?: Date; ignorarMinimo?: boolean },
): Promise<{ repasseId: string; valorCent: number; comissoes: number }> {
  const agora = d.agora ?? new Date()
  return comoParceiro(parceiroId, async (db: BancoDaOrg) => {
    const p = await db.parceiro.findUnique({ where: { id: parceiroId }, select: { pixChave: true, pixTipo: true } })
    if (!p?.pixChave) throw new RepasseRecusado('O parceiro ainda não cadastrou a chave Pix.')
    const liberadas = await db.comissao.findMany({
      where: { parceiroId, repasseId: null, estornadaEm: null, liberaEm: { lte: agora } },
      select: { id: true, valor: true },
    })
    const total = liberadas.reduce((t, c) => t + n(c.valor), 0)
    if (total <= 0) throw new RepasseRecusado('Não há comissão liberada para pagar.')
    if (total < MINIMO_REPASSE * 100 && !d.ignorarMinimo) {
      throw new RepasseRecusado(`O liberado (${mostrar(total)}) não chega ao mínimo de ${mostrar(MINIMO_REPASSE * 100)}.`)
    }
    const r = await db.repasse.create({
      data: {
        parceiroId,
        valor: new Prisma.Decimal(total).div(100),
        pixChave: `${p.pixTipo ?? 'pix'}: ${p.pixChave}`,
        comprovante: d.comprovante?.trim().slice(0, 120) || null,
        quem: d.quem,
        pagoEm: agora,
      },
      select: { id: true },
    })
    await db.comissao.updateMany({ where: { id: { in: liberadas.map((c) => c.id) } }, data: { repasseId: r.id } })
    return { repasseId: r.id, valorCent: total, comissoes: liberadas.length }
  })
}

export async function mudarSituacaoDoParceiro(parceiroId: string, situacao: 'ATIVO' | 'BLOQUEADO'): Promise<void> {
  await comoParceiro(parceiroId, (db) =>
    db.parceiro.update({
      where: { id: parceiroId },
      // Bloquear derruba as sessões abertas.
      data: situacao === 'BLOQUEADO' ? { situacao, sessoesDesde: new Date() } : { situacao },
    }),
  )
}
