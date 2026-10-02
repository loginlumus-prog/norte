// O que a EQUIPE DO NORTE faz nas empresas: atender pedido de plano e de
// crédito, recusar, dar e tirar acesso de suporte, suspender e reativar.
//
// Quem chama é scripts/operacao.ts e o console do Norte (scripts/console.ts,
// src/console/**) — os dois do laptop de quem opera. Nenhuma tela do sistema
// hospedado chama isto, e é de propósito: um console de administração no
// servidor precisaria da credencial que atravessa empresas LÁ, e aí um furo
// numa tela qualquer vira acesso a todas as lojas. O console é uma página,
// mas servida pelo próprio laptop, só em 127.0.0.1 e com chave de uso único
// (ver src/console/guarda.ts). No laptop, o estrago máximo de um descuido é o
// de quem já tem a chave.
//
// ── por que pelo comoOrg, e não pela credencial de admin ─────
// Toda ESCRITA daqui passa pelo mesmo caminho da aplicação (papel sem
// privilégio + a empresa carimbada): o RLS garante que a operação só toca a
// empresa do endereço, os gatilhos de "referência de outra empresa" valem, e
// o livro de auditoria recebe a linha na MESMA transação do que foi feito. A
// credencial de admin fica só para as LISTAS que atravessam empresas (quais
// empresas existem, que pedidos estão abertos), no próprio script.
//
// ── como a equipe assina ─────────────────────────────────────
// "Equipe Norte (<nome de quem rodou>)", autor SISTEMA, no livro DA LOJA —
// que ela lê na tela Auditoria. Ver `quemDaEquipe` em assinatura.ts.

import { randomBytes } from 'node:crypto'
import type { Plano } from '@prisma/client'
import { comoOrg } from './banco'
import { normalizar } from './autenticacao'
import { adicionarPacoteDeRespostas, creditarNaTransacao, quemDaEquipe, trocarPlanoComoEquipe, type Respostas } from './assinatura'
import { PLANOS, PRECOS, milhar, planoLibera } from './planos'
import { MODULOS } from './modulos'
import { eventosDePedido, pedidoAberto, type Pedido, type TipoPedido } from './pedidos'
import { lerDinheiro, centavos as paraCentavos, mostrar } from './dinheiro'

// ─────────────────────────────────────────────────────────────
// AS REGRAS PURAS (testadas em tests/operacao.test.ts)
// ─────────────────────────────────────────────────────────────

/** As situações que a equipe põe na mão. TESTE e INADIMPLENTE são do sistema/gateway. */
export const SITUACOES_DA_EQUIPE = ['ATIVA', 'SUSPENSA', 'CANCELADA'] as const
export type SituacaoDaEquipe = (typeof SITUACOES_DA_EQUIPE)[number]

/** Suporte é acesso de horas, não de semanas: mais que três dias é outro assunto. */
export const SUPORTE_MAX_HORAS = 72

/** Teto de uma recarga feita pela equipe — o mesmo da tela. Um zero a mais é dinheiro que ninguém explica. */
export const TETO_RECARGA_CENT = 500_000

export function validarMotivo(v: unknown): string {
  const m = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  if (m.length < 5 || m.length > 300) {
    throw new Error('Falta --motivo "..." (de 5 a 300 letras). Ele vai para o livro da empresa.')
  }
  return m
}

export function validarHoras(v: unknown): number {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  if (!Number.isInteger(n) || n < 1 || n > SUPORTE_MAX_HORAS) {
    throw new Error(`--horas precisa ser um número inteiro de 1 a ${SUPORTE_MAX_HORAS}.`)
  }
  return n
}

export function validarEmail(v: unknown): string {
  const e = typeof v === 'string' ? normalizar(v) : ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Falta --email de quem vai entrar (um e-mail válido).')
  return e
}

/**
 * Reais digitados na linha de comando → centavos. `null` = não dá para saber.
 *
 * Aceita "150", "150,50", "150.50", "1.234,56", "R$ 200" e o sinal de menos
 * (só o AJUSTE aceita negativo — quem decide é quem chama). Recusa "1.234"
 * pelo mesmo motivo da tela (`lerDinheiro`): mil ou um real e pouco?
 */
export function lerValorEmReais(bruto: string): number | null {
  const t = bruto.trim()
  const negativo = t.startsWith('-')
  const reais = lerDinheiro(negativo ? t.slice(1) : t)
  if (reais === null) return null
  const c = paraCentavos(reais.toFixed(2))
  return negativo ? -c : c
}

/** O canal do WhatsApp da empresa, como a equipe fala dele. */
export function nomeDoCanal(canal: string | null | undefined): string {
  switch (canal) {
    case 'PROPRIO': return 'QR'
    case 'META': return 'Meta'
    case 'ZAPI': return 'Z-API'
    default: return 'nenhum'
  }
}

/**
 * A linha de comando em posicionais e opções.
 *
 *   plano exemplo REDE --quem "Ana" --confirmar
 *   → { posicionais: ['plano', 'exemplo', 'REDE'], opcoes: { quem: 'Ana', confirmar: true } }
 *
 * As opções que NÃO levam valor precisam ser declaradas: sem isso,
 * "--confirmar exemplo" comeria o endereço da empresa como valor. "-50" é
 * posicional (um só hífen): é assim que o ajuste negativo passa.
 */
export function lerArgumentos(
  argv: readonly string[],
  semValor: readonly string[],
): { posicionais: string[]; opcoes: Record<string, string | true> } {
  const posicionais: string[] = []
  const opcoes: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) {
      posicionais.push(a)
      continue
    }
    const [nome, valorJunto] = a.slice(2).split(/=(.*)/s) as [string, string | undefined]
    if (valorJunto !== undefined) opcoes[nome] = valorJunto
    else if (semValor.includes(nome)) opcoes[nome] = true
    else {
      const prox = argv[i + 1]
      if (prox === undefined || prox.startsWith('--')) opcoes[nome] = true
      else {
        opcoes[nome] = prox
        i++
      }
    }
  }
  return { posicionais, opcoes }
}

/**
 * Tira credencial de qualquer texto antes de ele ir para a tela.
 *
 * O erro do driver do Postgres pode trazer a URL de conexão inteira — com a
 * senha do DONO das tabelas de produção. Terminal tem histórico, rolagem,
 * print de tela e gravação de reunião. Então TODA saída da ferramenta passa
 * por aqui: a senha de qualquer URL postgres vira ***, e o valor de qualquer
 * variável de ambiente com cara de segredo, onde aparecer, também.
 */
export function limparSegredos(texto: string, ambiente: Record<string, string | undefined> = {}): string {
  // A senha vai até o ÚLTIMO @ antes do host: senha com @ dentro existe
  // (ver `ehLocal` em scripts/ambiente.ts), e cortar no primeiro deixaria
  // metade dela na tela.
  let saida = texto.replace(
    /\b(postgres(?:ql)?:\/\/)([^:@/\s]+):(\S+)@([^@\s/]+)/gi,
    (_t, esquema: string, usuario: string, _senha: string, host: string) => `${esquema}${usuario}:***@${host}`,
  )
  const segredos = Object.entries(ambiente)
    .filter(([nome, v]) => /SENHA|SEGREDO|TOKEN|CIFRA|SECRET|PASSWORD|CHAVE|KEY|DATABASE_URL/i.test(nome) && v && v.length >= 6)
    .map(([, v]) => v!)
    // O mais comprido primeiro: um segredo que contém outro sai inteiro.
    .sort((a, b) => b.length - a.length)
  for (const s of segredos) saida = saida.split(s).join('***')
  return saida
}

// ─────────────────────────────────────────────────────────────
// CRÉDITO
// ─────────────────────────────────────────────────────────────

export type TipoRecargaDaEquipe = 'COMPRA' | 'AJUSTE'

/** O saldo de crédito de IA, só lendo. */
export async function saldoDeCredito(orgId: string): Promise<number> {
  return comoOrg(orgId, async (db) =>
    (await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { creditoIaCent: true } })).creditoIaCent,
  )
}

/**
 * Crédito de IA posto pela equipe — o pedido pago, ou um ajuste.
 *
 * A recarga e a linha do livro saem na mesma transação. O `motivo` aparece
 * para a LOJA, no extrato do crédito e na Auditoria: escreva para ela ler.
 * Quando há pedido aberto que esta recarga atende, ele vai em `pedidoId` e
 * sai da lista.
 */
export async function recarregarComoEquipe(
  orgId: string,
  centavos: number,
  dados: { tipo: TipoRecargaDaEquipe; motivo: string; quem: string; pedidoId?: string | null },
): Promise<{ saldoAntes: number; saldoDepois: number }> {
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)
  if (!Number.isInteger(centavos) || centavos === 0) throw new Error('O valor precisa ser diferente de zero.')
  if (dados.tipo === 'COMPRA' && centavos < 0) throw new Error('Compra é valor positivo. Para tirar crédito, use --tipo AJUSTE.')
  if (Math.abs(centavos) > TETO_RECARGA_CENT) {
    throw new Error(`Acima de ${mostrar(TETO_RECARGA_CENT)} numa recarga só, não. Divida em duas, conferindo cada uma.`)
  }

  // Ler antes, fora da transação de escrita: estourar DENTRO dela aborta a
  // transação, e no banco local a conexão fica inutilizável (ver convite.ts).
  const saldoAntes = await saldoDeCredito(orgId)
  if (saldoAntes + centavos < 0) {
    throw new Error(`O saldo é ${mostrar(saldoAntes)}; tirar ${mostrar(-centavos)} deixaria negativo.`)
  }

  const saldoDepois = await comoOrg(orgId, async (db) => {
    const saldo = await creditarNaTransacao(db, orgId, centavos, { tipo: dados.tipo, quem, origem: 'equipe', motivo })
    await db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'credito.recarregou',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: mostrar(centavos),
        valor: centavos / 100,
        motivo,
        depois: {
          centavos,
          tipo: dados.tipo,
          saldoDepois: saldo,
          ...(dados.pedidoId ? { pedidoId: dados.pedidoId } : {}),
        },
      },
    })
    return saldo
  })

  return { saldoAntes, saldoDepois }
}

// ─────────────────────────────────────────────────────────────
// RECUSAR PEDIDO
// ─────────────────────────────────────────────────────────────

/** Como a equipe chama cada tipo de pedido, nas frases e nas pílulas. */
export const NOME_DO_TIPO: Record<TipoPedido, string> = {
  plano: 'plano',
  respostas: 'pacote de respostas',
  credito: 'crédito',
}

/** O tipo de pedido que veio de formulário ou linha de comando, conferido. */
export function lerTipoPedido(v: unknown): TipoPedido | null {
  return v === 'plano' || v === 'respostas' || v === 'credito' ? v : null
}

// ─────────────────────────────────────────────────────────────
// PACOTE DE RESPOSTAS
// ─────────────────────────────────────────────────────────────

/**
 * Atende o pedido de "+500 respostas" (ou dá o pacote por decisão da equipe):
 * o pacote entra pelo mesmo caminho do gateway (`adicionarPacoteDeRespostas`,
 * que grava `respostas.adicionou` e fecha o pedido), e o porquê de quem
 * decidiu vai numa segunda linha, `equipe.anotou` — como na troca de plano.
 * O motivo é conferido ANTES: pacote sem motivo não entra por erro de digitação.
 */
export async function atenderPacoteDeRespostas(
  orgId: string,
  dados: { motivo: string; quem: string; pedidoId?: string | null },
  agora = new Date(),
): Promise<Respostas> {
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)
  const r = await adicionarPacoteDeRespostas(orgId, { quem, autor: 'SISTEMA', pedidoId: dados.pedidoId ?? null }, agora)
  await comoOrg(orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'equipe.anotou',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: `+${milhar(PRECOS.pacoteRespostas)} respostas`,
        motivo,
        depois: { sobre: 'respostas.adicionou', ...(dados.pedidoId ? { pedidoId: dados.pedidoId } : {}) },
      },
    }),
  )
  return r
}

/**
 * "Não deu" — com o motivo, que a loja lê na tela da Assinatura. Sem isto, o
 * pedido fica aberto para sempre e a loja fica esperando uma resposta que
 * nunca vem.
 */
export async function recusarPedido(
  orgId: string,
  tipo: TipoPedido,
  dados: { motivo: string; quem: string },
): Promise<Pedido> {
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)
  const pedido = pedidoAberto(await eventosDePedido(orgId), tipo)
  if (!pedido) throw new Error(`Não há pedido de ${NOME_DO_TIPO[tipo]} aberto nesta empresa.`)

  await comoOrg(orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'pedido.recusou',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: pedido.oQue,
        motivo,
        depois: { tipo, pedidoId: pedido.id },
      },
    }),
  )
  return pedido
}

// ─────────────────────────────────────────────────────────────
// SITUAÇÃO DA EMPRESA
// ─────────────────────────────────────────────────────────────

/**
 * ATIVA, SUSPENSA ou CANCELADA.
 *
 * O sistema já reage à suspensão em três lugares: o login recusa
 * (autenticacao.ts), toda tela devolve para a entrada (`exigirEntrada`), e o
 * assistente e as campanhas param de mandar mensagem. Faltava um: a Server
 * Action de quem JÁ estava com a tela aberta — ela confere a sessão, não a
 * empresa. Por isso suspender aqui também CORTA as sessões de todo mundo da
 * empresa: a próxima ação de qualquer tela aberta cai na entrada.
 */
export async function mudarSituacao(
  orgId: string,
  para: SituacaoDaEquipe,
  dados: { motivo: string; quem: string },
  agora = new Date(),
): Promise<{ de: string; para: SituacaoDaEquipe; mudou: boolean; sessoesCortadas: number }> {
  if (!SITUACOES_DA_EQUIPE.includes(para)) throw new Error(`Situação "${para}" não existe aqui. Use ${SITUACOES_DA_EQUIPE.join(', ')}.`)
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)

  const antes = await comoOrg(orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: orgId }, select: { situacao: true, suspensaEm: true } }),
  )
  if (antes.situacao === para) return { de: antes.situacao, para, mudou: false, sessoesCortadas: 0 }

  const trava = para === 'SUSPENSA' || para === 'CANCELADA'
  const cortadas = await comoOrg(orgId, async (db) => {
    await db.org.update({
      where: { id: orgId },
      data: { situacao: para, suspensaEm: trava ? (antes.suspensaEm ?? agora) : null },
    })
    let n = 0
    if (trava) {
      n = (await db.usuario.updateMany({ where: { orgId }, data: { sessoesDesde: agora } })).count
      await db.presenca.deleteMany({ where: { orgId } })
    }
    await db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'empresa.situacao',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: para,
        motivo,
        antes: { situacao: antes.situacao },
        depois: { situacao: para, sessoesCortadas: n },
      },
    })
    return n
  })

  return { de: antes.situacao, para, mudou: true, sessoesCortadas: cortadas }
}

// ─────────────────────────────────────────────────────────────
// AS MARCAS DO FAROL CONTRATADAS
// ─────────────────────────────────────────────────────────────

/** Teto contra o dedo errado: ninguém contrata cem marcas sem conversa. */
export const FAROL_MARCAS_MAX = 50

/** O contratado hoje e quantas marcas estão ativas no Farol — para o resumo antes de mudar. */
export async function marcasDoFarol(orgId: string): Promise<{ contratadas: number; ativas: number }> {
  return comoOrg(orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { farolMarcas: true } })
    const ativas = await db.marcaFarol.count({ where: { ativa: true } })
    return { contratadas: org.farolMarcas, ativas }
  })
}

/**
 * Quantas marcas do Farol a empresa CONTRATOU (`Org.farolMarcas`). É o que
 * a conta do mês cobra (`mensalidade`) e o teto de marcas ativas no Farol.
 * Muda só pela equipe, pelo contrato — a loja não se dá marca a mais.
 */
export async function definirMarcasDoFarol(
  orgId: string,
  marcas: number,
  dados: { motivo: string; quem: string },
): Promise<{ de: number; para: number; mudou: boolean }> {
  if (!Number.isInteger(marcas) || marcas < 1 || marcas > FAROL_MARCAS_MAX) {
    throw new Error(`Marcas do Farol: um número inteiro de 1 a ${FAROL_MARCAS_MAX}.`)
  }
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)
  return comoOrg(orgId, async (db) => {
    const antes = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { farolMarcas: true } })
    if (antes.farolMarcas === marcas) return { de: marcas, para: marcas, mudou: false }
    await db.org.update({ where: { id: orgId }, data: { farolMarcas: marcas } })
    await db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'empresa.farol_marcas',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: 'marcas do Farol',
        motivo,
        antes: { farolMarcas: antes.farolMarcas },
        depois: { farolMarcas: marcas },
      },
    })
    return { de: antes.farolMarcas, para: marcas, mudou: true }
  })
}

// ─────────────────────────────────────────────────────────────
// ACESSO DE SUPORTE
// ─────────────────────────────────────────────────────────────
//
// Como o acesso de SUPORTE funciona (e por que ele é assim):
//
// • É um USUÁRIO DA EMPRESA, como qualquer outro — usuário é sempre de uma
//   empresa só (schema.prisma, `Usuario`), e é isso que faz o livro dizer
//   quem olhou. Quem do Norte atende três lojas tem três contas, cada uma com
//   a sua senha.
// • O poder vem de um `Acesso` com papel SUPORTE, com `expiraEm` e `motivo`,
//   em um de dois modos escolhidos ao conceder: só leitura (o padrão) ou
//   edição (`suporteEdita`; ver SUPORTE_EDICAO em permissao.ts) — arruma a
//   operação, nunca vende, nunca mexe em dinheiro nem na Assinatura. No livro
//   da loja, o suporte assina "Equipe Norte (nome)" (ver `conferirSessao`).
//   Passou do prazo, o login responde "sem acesso" (autenticacao.ts filtra
//   acesso vencido) — a conta continua lá, sem poder nenhum, até o próximo
//   pedido.
// • Toda tela que ele abre vira linha no livro da loja (`suporte.acessou`,
//   pagina.ts), com o motivo escrito aqui. O motivo, então, a LOJA lê.
// • A conta nasce SEM senha: ninguém daqui escolhe nem vê a senha de
//   ninguém. A pessoa define a dela pelo caminho normal da entrada.
// • Se a LOJA desativou a conta de suporte (tela Equipe), a decisão é dela:
//   daqui não se reativa.

export type EstadoDoSuporte = {
  usuario: { id: string; nome: string; ativo: boolean; temSenha: boolean } | null
  /** O e-mail é de alguém da empresa cliente (tem acesso que não é SUPORTE). */
  ehDaLoja: boolean
  /** O acesso de suporte mais recente, vencido ou não. `edicao` = o modo edição. */
  suporte: { expiraEm: Date | null; motivo: string | null; edicao: boolean } | null
}

/** Só lê. É o que o script mostra antes do `--confirmar`. */
export async function estadoDoSuporte(orgId: string, emailBruto: string): Promise<EstadoDoSuporte> {
  const email = validarEmail(emailBruto)
  return comoOrg(orgId, async (db) => {
    const u = await db.usuario.findUnique({
      where: { orgId_email: { orgId, email } },
      select: { id: true, nome: true, ativo: true, senhaHash: true },
    })
    if (!u) return { usuario: null, ehDaLoja: false, suporte: null }
    const acessos = await db.acesso.findMany({
      where: { usuarioId: u.id },
      select: { papel: true, expiraEm: true, motivo: true, suporteEdita: true, criadoEm: true },
      orderBy: { criadoEm: 'desc' },
    })
    const sup = acessos.find((a) => a.papel === 'SUPORTE') ?? null
    return {
      usuario: { id: u.id, nome: u.nome, ativo: u.ativo, temSenha: !!u.senhaHash },
      ehDaLoja: acessos.some((a) => a.papel !== 'SUPORTE'),
      suporte: sup ? { expiraEm: sup.expiraEm, motivo: sup.motivo, edicao: sup.suporteEdita } : null,
    }
  })
}

/** Por que este e-mail não pode receber acesso de suporte (ou null, se pode). */
export function impedimentoDoSuporte(e: EstadoDoSuporte, dominioDaEquipe?: string | null, email?: string): string | null {
  if (dominioDaEquipe && email && !email.endsWith(`@${dominioDaEquipe.toLowerCase()}`)) {
    return `Suporte só para e-mail da equipe (@${dominioDaEquipe}).`
  }
  // Dar SUPORTE a quem é da loja seria mexer no acesso de um cliente por fora
  // da tela de Equipe — e juntar numa conta dois papéis com regras opostas.
  if (e.ehDaLoja) return 'Este e-mail é de uma pessoa da empresa cliente. Suporte é conta da equipe do Norte, separada.'
  if (e.usuario && !e.usuario.ativo) {
    return 'A empresa desativou esta conta de suporte na tela Equipe. A decisão é dela: peça ao dono para reativar.'
  }
  return null
}

export type SuporteConcedido = {
  usuarioId: string
  criouConta: boolean
  temSenha: boolean
  expiraEm: Date
  /** O prazo anterior, quando já havia acesso de suporte (vencido ou não). */
  expiravaEm: Date | null
  /** O modo dado agora: edição (true) ou só leitura. */
  edicao: boolean
  sessoesCortadas: boolean
}

/**
 * Dá (ou estende) o acesso de SUPORTE: `horas` a partir de agora, com motivo
 * e o MODO — só leitura (o padrão) ou edição (`edicao: true`; o que ele
 * deixa e o que não deixa está em SUPORTE_EDICAO, permissao.ts). Conceder de
 * novo troca o modo; a sessão aberta lê o modo do banco na próxima tela.
 *
 * Encurtar um prazo que ainda vale CORTA as sessões da conta: o cookie de
 * sessão carrega a fotografia dos acessos com o prazo antigo, e sem o corte o
 * prazo menor só valeria no próximo login.
 */
export async function concederSuporte(
  orgId: string,
  dados: { email: string; nome?: string | null; horas: number; motivo: string; quem: string; edicao?: boolean },
  opcoes: { dominioDaEquipe?: string | null } = {},
  agora = new Date(),
): Promise<SuporteConcedido> {
  const email = validarEmail(dados.email)
  const horas = validarHoras(String(dados.horas))
  const motivo = validarMotivo(dados.motivo)
  const quem = quemDaEquipe(dados.quem)
  const edicao = dados.edicao === true

  const e = await estadoDoSuporte(orgId, email)
  const impede = impedimentoDoSuporte(e, opcoes.dominioDaEquipe, email)
  if (impede) throw new Error(impede)

  const expiraEm = new Date(agora.getTime() + horas * 3_600_000)
  const expiravaEm = e.suporte?.expiraEm ?? null
  const encurta = !!e.suporte && (expiravaEm === null || expiravaEm > expiraEm) && (expiravaEm === null || expiravaEm > agora)
  const nome = (dados.nome?.trim() || `Suporte do Norte (${quem.slice('Equipe Norte ('.length, -1)})`).slice(0, 80)

  return comoOrg(orgId, async (db) => {
    let usuarioId = e.usuario?.id
    const criouConta = !usuarioId
    if (!usuarioId) {
      usuarioId = (
        await db.usuario.create({
          data: { orgId, nome, email, senhaHash: null },
          select: { id: true },
        })
      ).id
    }

    // `unique (usuario, unidade, papel)` não segura unidade nula no Postgres
    // (nulo não é igual a nulo), então a regra "um acesso de suporte por
    // conta" é daqui: atualiza o que existe, cria só se não houver.
    const mexidos = await db.acesso.updateMany({
      where: { usuarioId, papel: 'SUPORTE' },
      data: { expiraEm, motivo, unidadeId: null, suporteEdita: edicao },
    })
    if (mexidos.count === 0) {
      await db.acesso.create({
        data: { orgId, usuarioId, unidadeId: null, papel: 'SUPORTE', expiraEm, motivo, suporteEdita: edicao },
      })
    }
    if (encurta) {
      await db.usuario.update({ where: { id: usuarioId }, data: { sessoesDesde: agora } })
    }

    await db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'suporte.concedeu',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: e.usuario?.nome ?? nome,
        motivo,
        antes: e.suporte ? { expiraEm: expiravaEm?.toISOString() ?? null, modo: e.suporte.edicao ? 'edicao' : 'leitura' } : undefined,
        depois: { expiraEm: expiraEm.toISOString(), horas, criouConta, modo: edicao ? 'edicao' : 'leitura' },
      },
    })

    return {
      usuarioId,
      criouConta,
      temSenha: e.usuario?.temSenha ?? false,
      expiraEm,
      expiravaEm,
      edicao,
      sessoesCortadas: encurta,
    }
  })
}

/**
 * Tira o acesso de suporte AGORA: o prazo vira este instante, as sessões
 * abertas morrem e a vaga fica livre. O acesso não é apagado — ele é a
 * história de quem entrou, com que motivo, até quando.
 */
export async function revogarSuporte(
  orgId: string,
  dados: { email: string; quem: string; motivo?: string | null },
  agora = new Date(),
): Promise<{ revogou: boolean }> {
  const email = validarEmail(dados.email)
  const quem = quemDaEquipe(dados.quem)
  const motivo = dados.motivo ? validarMotivo(dados.motivo) : 'Acesso de suporte encerrado.'

  const e = await estadoDoSuporte(orgId, email)
  const vale = e.suporte && (e.suporte.expiraEm === null || e.suporte.expiraEm > agora)
  if (!e.usuario || !vale) return { revogou: false }
  const usuarioId = e.usuario.id

  await comoOrg(orgId, async (db) => {
    await db.acesso.updateMany({
      where: { usuarioId, papel: 'SUPORTE', OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
      data: { expiraEm: agora },
    })
    await db.usuario.update({ where: { id: usuarioId }, data: { sessoesDesde: agora } })
    await db.presenca.deleteMany({ where: { orgId, usuarioId } })
    await db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'suporte.revogou',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: e.usuario!.nome,
        motivo,
        antes: { expiraEm: e.suporte!.expiraEm?.toISOString() ?? null },
        depois: { expiraEm: agora.toISOString() },
      },
    })
  })
  return { revogou: true }
}

// ─────────────────────────────────────────────────────────────
// TROCA DE PLANO COM MOTIVO (o console do Norte)
// ─────────────────────────────────────────────────────────────

/**
 * A troca da equipe, com o motivo escrito por quem fez.
 *
 * `trocarPlanoComoEquipe` grava a linha `plano.trocou` com o motivo automático
 * ("Norte → Norte + Assistente") — é ela que fecha o pedido, e a tela da loja
 * lê dela. O motivo de quem decidiu ("Pix de março confirmado") vai numa
 * segunda linha, `equipe.anotou`, logo depois: a primeira é o fato, a
 * segunda é o porquê. O motivo é conferido ANTES de trocar, então troca sem
 * motivo não acontece por erro de digitação.
 */
export async function trocarPlanoPelaEquipe(
  orgId: string,
  para: Plano,
  dados: { motivo: string; quem: string; pedidoId?: string | null },
) {
  if (!(para in PLANOS)) throw new Error(`Plano "${para}" não existe.`)
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)
  const m = await trocarPlanoComoEquipe(orgId, para, quem, { pedidoId: dados.pedidoId ?? null })
  await comoOrg(orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'equipe.anotou',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: `plano ${PLANOS[para].titulo}`,
        motivo,
        depois: { sobre: 'plano.trocou', de: m.de, para, ...(dados.pedidoId ? { pedidoId: dados.pedidoId } : {}) },
      },
    }),
  )
  return m
}

// ─────────────────────────────────────────────────────────────
// MÓDULOS CONTRATADOS À PARTE
// ─────────────────────────────────────────────────────────────

/** Os módulos que a equipe liga e desliga por contrato. */
export const MODULOS_DA_EQUIPE = ['agente', 'fabrica', 'farol'] as const
export type ModuloDaEquipe = (typeof MODULOS_DA_EQUIPE)[number]

/**
 * Liga ou desliga um módulo vendido à parte (a Fábrica, o Farol).
 *
 * O Farol a empresa não liga sozinha (`ehContratado`); a Fábrica ela até
 * liga em Configurações, mas a venda dela é nossa — com implantação — e
 * quem fecha o contrato precisa conseguir ligar sem pedir ao dono. Ligar só
 * onde o plano deixa: módulo fora do plano seria tela que a assinatura não
 * cobre (a mesma regra da troca de plano, `aplicarTroca`).
 */
export async function definirModuloDaEquipe(
  orgId: string,
  modulo: ModuloDaEquipe,
  ligar: boolean,
  dados: { motivo: string; quem: string },
): Promise<{ mudou: boolean; modulos: string[] }> {
  if (!MODULOS_DA_EQUIPE.includes(modulo)) throw new Error(`Módulo "${modulo}" não é contratado à parte.`)
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)

  // Ler e decidir FORA da transação de escrita (ver `recarregarComoEquipe`).
  const antes = await comoOrg(orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true, modulos: true } }),
  )
  const ligado = antes.modulos.includes(modulo)
  if (ligado === ligar) return { mudou: false, modulos: antes.modulos }
  if (ligar && !planoLibera(antes.plano, modulo)) {
    throw new Error(`O plano ${PLANOS[antes.plano].titulo} não tem ${MODULOS[modulo].titulo}. Troque o plano antes.`)
  }
  const modulos = ligar ? [...antes.modulos, modulo] : antes.modulos.filter((m) => m !== modulo)

  await comoOrg(orgId, async (db) => {
    await db.org.update({ where: { id: orgId }, data: { modulos } })
    await db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'empresa.modulo',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: `${MODULOS[modulo].titulo} ${ligar ? 'ligado' : 'desligado'}`,
        motivo,
        antes: { modulos: antes.modulos },
        depois: { modulos, modulo, ligado: ligar },
      },
    })
  })
  return { mudou: true, modulos }
}

// ─────────────────────────────────────────────────────────────
// CONVITE DO DONO, DE NOVO
// ─────────────────────────────────────────────────────────────

export type ConviteDoDono = {
  email: string
  expiraEm: Date
  /** Só existe neste retorno: o banco guarda o resumo (`resumirToken`). */
  link: string
}

/**
 * Refaz o convite do DONO — o link venceu, o dono perdeu o e-mail.
 *
 * O mesmo que `npm run empresa -- --reconvidar` (scripts/criar-empresa.ts),
 * pelo caminho da aplicação: comoOrg, RLS, linha no livro assinada pela
 * equipe, com motivo. E a mesma trava: só enquanto NINGUÉM da loja entrou.
 * Depois disso convite se manda pela tela de Equipe, por quem tem papel — e
 * não por fora, passando por cima de toda permissão. A conta do nosso
 * suporte não conta como gente da loja.
 *
 * `email` troca o e-mail do dono (digitado errado na venda); vazio = o de antes.
 */
export async function reconvidarDono(
  orgId: string,
  dados: { motivo: string; quem: string; email?: string | null },
  base: string,
  agora = new Date(),
): Promise<ConviteDoDono> {
  const quem = quemDaEquipe(dados.quem)
  const motivo = validarMotivo(dados.motivo)
  const baseLimpa = base.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/\S+$/.test(baseLimpa)) {
    throw new Error('Não sei o endereço público do sistema (NORTE_URL), então não sei montar o link.')
  }

  const antes = await comoOrg(orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true, email: true } })
    const daLoja = await db.usuario.count({ where: { acessos: { some: { papel: { not: 'SUPORTE' } } } } })
    return { ...org, daLoja }
  })
  if (antes.daLoja > 0) {
    throw new Error(
      `A empresa já tem ${antes.daLoja} pessoa(s) dentro. Convite novo se manda pela tela de Equipe, por quem tem papel para isso.`,
    )
  }
  const email = dados.email?.trim() ? validarEmail(dados.email) : antes.email ? validarEmail(antes.email) : null
  if (!email) throw new Error('A empresa não tem e-mail do dono. Informe o e-mail.')

  // Import na hora: convite.ts puxa a tela de Equipe inteira, e as regras
  // puras deste arquivo são importadas por testes que não precisam dela.
  const { resumirToken, VALE_DIAS } = await import('./convite')
  const token = randomBytes(32).toString('base64url')
  const expiraEm = new Date(agora.getTime() + VALE_DIAS * 864e5)

  await comoOrg(orgId, async (db) => {
    // Um convite de dono vivo por vez: o link velho para de abrir agora.
    await db.convite.deleteMany({ where: { papel: 'DONO', aceitoEm: null } })
    await db.convite.create({
      data: { orgId, email, papel: 'DONO', token: resumirToken(token), expiraEm },
    })
    if (email !== antes.email) await db.org.update({ where: { id: orgId }, data: { email } })
    await db.auditoria.create({
      data: {
        orgId,
        quem,
        autor: 'SISTEMA',
        acao: 'empresa.reconvidou',
        alvoTipo: 'org',
        alvoId: orgId,
        alvoNome: 'convite do dono',
        motivo,
        antes: email !== antes.email ? { email: antes.email } : undefined,
        depois: { email, expiraEm: expiraEm.toISOString() },
      },
    })
  })

  return { email, expiraEm, link: `${baseLimpa}/${antes.slug}/convite/${token}` }
}
