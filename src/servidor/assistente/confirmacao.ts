// O telefone da equipe, CONFIRMADO.
//
// ── o buraco que isto fecha ──────────────────────────────────
// O telefone cadastrado de uma pessoa da equipe é o que faz o assistente
// tratar a mensagem como dela — com as ferramentas do papel dela — e é para
// onde vão o relatório do dia e os avisos. Até 28/09 bastava DIGITAR o número:
//
//   • um dígito errado mandava o faturamento da loja, todo dia às 8h, para um
//     desconhecido — que ainda podia responder e perguntar mais ao assistente;
//   • quem gere a equipe punha o PRÓPRIO celular na conta da dona e passava a
//     conversar com o assistente como dona;
//   • a operadora recicla número parado: o celular antigo da dona vira de
//     outra pessoa, que herda tudo isso sem ter feito nada.
//
// Agora o número só vale depois de a PRÓPRIA pessoa provar, de dentro da conta
// dela, que o celular está na mão dela. Dois caminhos (ver o modelo
// `ConfirmacaoTelefone` no schema):
//
//   1. o Norte manda um código de 6 números para o WhatsApp do número, e ela
//      digita na tela Minha conta;
//   2. a tela mostra o código, e ela manda "CONFIRMAR 123456" do celular para o
//      WhatsApp da loja (`confirmarPorMensagem`, chamado antes de tudo no laço
//      da conversa).
//
// Cada código serve a UM caminho só. O do caminho 1 não vale mandado de volta
// pelo WhatsApp: quem pôs o próprio celular na conta da dona RECEBERIA esse
// código, e confirmaria sem nunca entrar na conta dela.
//
// ── o que conta como confirmado ──────────────────────────────
// `telefoneConfirmado` guarda a CHAVE do número no dia da confirmação: trocar o
// telefone anula sozinho (a chave deixa de bater). E número que não manda
// mensagem para a loja há 180 dias volta a pedir confirmação — é o prazo em
// que as operadoras começam a reciclar linha parada.
//
// ── e quem ainda não confirmou ───────────────────────────────
// É tratado como CLIENTE: o assistente não conversa com ele (fica calado, como
// fica com todo cliente), não recebe relatório nem aviso, não recebe teste de
// campanha. Isso vale para todo telefone que já estava cadastrado antes desta
// regra — não dá para saber, olhando o banco, qual deles foi digitado pela
// própria pessoa e qual por outra. A tela do Assistente mostra à dona quem
// falta confirmar.
//
// ── o WhatsApp oficial (Meta) ────────────────────────────────
// Fora da janela de 24 horas a Meta só entrega MODELO aprovado, e código de
// confirmação pede modelo da categoria "autenticação" — que o Norte ainda não
// cria na conta da loja. Então, no oficial, o caminho 1 só funciona se a pessoa
// escreveu para a loja nas últimas 24 horas; fora disso a tela explica e
// oferece o caminho 2 (que abre a janela de quebra).

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { comoOrg, type BancoDaOrg } from '../banco'
import type { Sessao } from '../permissao'
import { chaveTelefone, mascarar, paraEnvio } from './telefone'
import { linhaDaEmpresa, SELECT_LINHA, type Canal } from './canal'

export const VALIDADE_CODIGO_MS = 10 * 60_000
export const MAXIMO_TENTATIVAS = 5
export const CODIGOS_POR_HORA = 3
/** Sem mensagem deste número há tanto tempo, a confirmação vence. */
export const DIAS_SEM_USO = 180

// ─────────────────────────────────────────────────────────────
// A REGRA (pura)
// ─────────────────────────────────────────────────────────────

/** As colunas do usuário que a regra lê. Para `select` do Prisma. */
export const SELECT_TELEFONE = {
  telefone: true,
  telefoneConfirmado: true,
  telefoneConfirmadoEm: true,
  telefoneVistoEm: true,
} as const

export type TelefoneDaPessoa = {
  telefone: string | null
  telefoneConfirmado: string | null
  telefoneConfirmadoEm: Date | null
  telefoneVistoEm: Date | null
}

export type EstadoTelefone = 'sem_telefone' | 'falta_confirmar' | 'confirmado' | 'vencido'

export const ROTULO_ESTADO_TELEFONE: Record<EstadoTelefone, string> = {
  sem_telefone: 'sem telefone',
  falta_confirmar: 'falta confirmar',
  confirmado: 'confirmado',
  vencido: 'confirmar de novo',
}

/**
 * Em que pé está o telefone da pessoa. Só 'confirmado' faz dela equipe no
 * WhatsApp; os outros três são, para o assistente, um número qualquer.
 */
export function estadoDoTelefone(u: TelefoneDaPessoa, agora: Date = new Date()): EstadoTelefone {
  const chave = chaveTelefone(u.telefone)
  if (!chave) return 'sem_telefone'
  if (!u.telefoneConfirmadoEm || u.telefoneConfirmado !== chave) return 'falta_confirmar'
  const ultimo = Math.max(u.telefoneConfirmadoEm.getTime(), u.telefoneVistoEm?.getTime() ?? 0)
  if (agora.getTime() - ultimo > DIAS_SEM_USO * 864e5) return 'vencido'
  return 'confirmado'
}

export const telefoneValido = (u: TelefoneDaPessoa, agora: Date = new Date()) =>
  estadoDoTelefone(u, agora) === 'confirmado'

/**
 * O segredo que entra no resumo do código. Com ele, o banco vazado não
 * entrega os códigos (seis números se testam todos num piscar — sem segredo,
 * o resumo não protegeria nada).
 *
 * `NORTE_CODIGO_SEGREDO` em produção. Sem ele, deriva da chave de cifra
 * (`NORTE_CIFRA`), e sem as duas — o laptop — um valor fixo: o código vive 10
 * minutos e aceita 5 tentativas, então o fixo no laptop não abre porta nenhuma.
 */
export function segredoDoCodigo(env: Record<string, string | undefined> = process.env): string {
  const proprio = (env.NORTE_CODIGO_SEGREDO ?? '').trim()
  if (proprio) return proprio
  const cifra = (env.NORTE_CIFRA ?? '').trim()
  if (cifra) return createHash('sha256').update(`codigo-telefone:${cifra}`).digest('hex')
  return 'norte-laptop-codigo-telefone'
}

/** O resumo guardado: HMAC do código, preso à pessoa (o mesmo código de outra conta dá outro resumo). */
export function resumoDoCodigo(usuarioId: string, codigo: string, segredo: string = segredoDoCodigo()): string {
  return createHmac('sha256', segredo).update(`${usuarioId}:${codigo}`).digest('hex')
}

function confere(usuarioId: string, codigo: string, resumo: string): boolean {
  const a = Buffer.from(resumoDoCodigo(usuarioId, codigo), 'hex')
  const b = Buffer.from(resumo, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Seis números, com zero à esquerda quando cai. */
export const gerarCodigo = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

/**
 * "CONFIRMAR 123456" (com ou sem dois-pontos, espaço no meio do código,
 * minúscula) → "123456". Qualquer outra coisa → null, e a mensagem segue o
 * caminho normal. Estrito de propósito: "confirmar o pedido 2" não é isto.
 */
export function lerPedidoDeConfirmacao(texto: string): string | null {
  const m = /^\s*\*?confirmar\*?\s*:?\s*(\d{3})[\s.-]?(\d{3})\s*$/i.exec(texto ?? '')
  return m ? `${m[1]}${m[2]}` : null
}

export const textoDoCodigo = (loja: string, codigo: string) =>
  `${codigo} é o seu código para confirmar este WhatsApp na ${loja}, no Norte. Digite na tela Minha conta. ` +
  `Vale por 10 minutos. Se não foi você que pediu, ignore.`

// ─────────────────────────────────────────────────────────────
// PEDIR UM CÓDIGO
// ─────────────────────────────────────────────────────────────

export type PedidoDeCodigo =
  | { ok: true; modo: 'enviado'; para: string }
  | { ok: true; modo: 'mostrar'; codigo: string; numeroDaLoja: string | null }
  | { ok: false; erro: string; oferecerMostrar?: boolean }

/**
 * Um código novo para o telefone da PRÓPRIA pessoa da sessão. Não existe
 * "pedir para outra pessoa": confirmar é provar que o celular é seu, e isso
 * ninguém faz no lugar de ninguém.
 *
 * `enviar`: manda pelo WhatsApp da loja e a pessoa digita na tela.
 * `mostrar`: devolve o código para a tela, e a pessoa manda do celular.
 */
export async function pedirCodigo(
  sessao: Sessao,
  modo: 'enviar' | 'mostrar',
  deps: { canal?: Canal; agora?: Date } = {},
): Promise<PedidoDeCodigo> {
  const agora = deps.agora ?? new Date()
  if (sessao.acessos.length > 0 && sessao.acessos.every((a) => a.papel === 'SUPORTE')) {
    return { ok: false, erro: 'O acesso de suporte não fala com o assistente pelo WhatsApp.' }
  }

  const codigo = gerarCodigo()
  const lido = await comoOrg(sessao.orgId, async (db) => {
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { ativo: true, ...SELECT_TELEFONE } })
    if (!eu?.ativo) return { erro: 'Conta não encontrada.' } as const
    const chave = chaveTelefone(eu.telefone)
    if (!chave || !eu.telefone) return { erro: 'Cadastre o seu celular com DDD antes de confirmar.' } as const
    if (estadoDoTelefone(eu, agora) === 'confirmado') return { erro: 'Este número já está confirmado.' } as const

    // Três por hora: o botão manda mensagem para um número que AINDA não se
    // provou de ninguém — sem teto, vira jeito de encher o celular alheio.
    const naHora = await db.confirmacaoTelefone.count({
      where: { usuarioId: sessao.usuarioId, criadoEm: { gte: new Date(agora.getTime() - 3_600_000) } },
    })
    if (naHora >= CODIGOS_POR_HORA) {
      return { erro: `Você já pediu ${CODIGOS_POR_HORA} códigos na última hora. Espere um pouco e peça de novo.` } as const
    }

    // Código novo aposenta os anteriores: vale sempre o último que a pessoa vê.
    await db.confirmacaoTelefone.updateMany({
      where: { usuarioId: sessao.usuarioId, usadoEm: null, expiraEm: { gt: agora } },
      data: { expiraEm: agora },
    })
    const linha = await db.confirmacaoTelefone.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        chave,
        codigoHash: resumoDoCodigo(sessao.usuarioId, codigo),
        enviado: modo === 'enviar',
        expiraEm: new Date(agora.getTime() + VALIDADE_CODIGO_MS),
        criadoEm: agora,
      },
      select: { id: true },
    })
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { nome: true, slug: true, whatsapp: true } })
    const agente = await db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { ...SELECT_LINHA, canal: true, metaNumeroExibicao: true },
    })
    return { telefone: eu.telefone, linhaId: linha.id, org, agente } as const
  })
  if ('erro' in lido) return { ok: false, erro: lido.erro! }

  const numeroDaLoja = lido.agente?.metaNumeroExibicao ?? lido.org.whatsapp ?? null
  if (modo === 'mostrar') return { ok: true, modo: 'mostrar', codigo, numeroDaLoja }

  // Pela linha que a empresa TEM (como o botão de teste): só para o número
  // de quem pediu, e o texto não vai para o histórico das conversas — código
  // não é assunto para a tela de Conversas.
  const { canal, origem } = deps.canal
    ? { canal: deps.canal, origem: null }
    : linhaDaEmpresa({ id: sessao.orgId, slug: lido.org.slug }, lido.agente)
  const numero = paraEnvio(lido.telefone)
  const falhou = async (erro: string, oferecerMostrar = true): Promise<PedidoDeCodigo> => {
    // O código que não saiu não fica valendo (nem pesa no teto de amanhã).
    await comoOrg(sessao.orgId, (db) =>
      db.confirmacaoTelefone.update({ where: { id: lido.linhaId }, data: { expiraEm: agora } }),
    )
    return { ok: false, erro, oferecerMostrar }
  }
  if (!canal.real) {
    return falhou('Esta loja ainda não tem WhatsApp conectado ao Norte: o código não tem por onde sair. Conecte na tela do Assistente.', false)
  }
  if (!numero) return falhou('O telefone cadastrado não parece um celular com DDD.', false)

  const r = await canal.enviar(numero, textoDoCodigo(lido.org.nome, codigo))
  if (!r.ok) {
    return falhou(
      r.codigo === 'janela_fechada' || origem === 'meta'
        ? 'No WhatsApp oficial, a Meta só deixa mandar código para quem escreveu para a loja nas últimas 24 horas (fora disso, só com um modelo de autenticação aprovado, que esta loja ainda não tem). Use o outro jeito: mande o código do seu celular para a loja.'
        : 'O WhatsApp da loja não conseguiu mandar o código agora. Tente de novo em instantes, ou mande o código do seu celular para a loja.',
    )
  }
  return { ok: true, modo: 'enviado', para: mascarar(lido.telefone) }
}

// ─────────────────────────────────────────────────────────────
// CONFIRMAR
// ─────────────────────────────────────────────────────────────

/** Grava a confirmação: a chave de hoje, a hora, e o livro. Dentro da transação de quem chama. */
async function gravarConfirmado(
  db: BancoDaOrg,
  orgId: string,
  linha: { id: string; usuarioId: string; chave: string },
  agora: Date,
  caminho: 'tela' | 'whatsapp',
): Promise<{ ok: true; nome: string } | { ok: false; erro: string }> {
  const u = await db.usuario.findUnique({ where: { id: linha.usuarioId }, select: { nome: true, ativo: true, telefone: true } })
  // O telefone mudou depois do código: o código era de OUTRO número.
  if (!u?.ativo || chaveTelefone(u.telefone) !== linha.chave) {
    return { ok: false, erro: 'O telefone desta conta mudou depois do código. Peça um código novo.' }
  }
  const usou = await db.confirmacaoTelefone.updateMany({
    where: { id: linha.id, usadoEm: null },
    data: { usadoEm: agora },
  })
  if (usou.count === 0) return { ok: false, erro: 'Esse código já foi usado. Peça um novo.' }
  await db.usuario.update({
    where: { id: linha.usuarioId },
    data: {
      telefoneConfirmado: linha.chave,
      telefoneConfirmadoEm: agora,
      // Pelo WhatsApp, a própria confirmação é uma mensagem que chegou dele.
      telefoneVistoEm: caminho === 'whatsapp' ? agora : null,
    },
  })
  await db.auditoria.create({
    data: {
      orgId,
      usuarioId: linha.usuarioId,
      quem: u.nome,
      acao: 'equipe.telefone.confirmou',
      alvoTipo: 'usuario',
      alvoId: linha.usuarioId,
      alvoNome: u.nome,
      // Só os quatro últimos, como na troca do telefone.
      depois: { telefone: u.telefone ? `…${u.telefone.replace(/\D/g, '').slice(-4)}` : null, caminho },
    },
  })
  return { ok: true, nome: u.nome }
}

/** O código que chegou pelo WhatsApp, digitado na tela Minha conta. */
export async function confirmarNaTela(
  sessao: Sessao,
  digitado: string,
  agora: Date = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const codigo = String(digitado ?? '').replace(/\D/g, '')
  if (codigo.length !== 6) return { ok: false, erro: 'O código tem 6 números.' }

  return comoOrg(sessao.orgId, async (db) => {
    const linha = await db.confirmacaoTelefone.findFirst({
      where: {
        usuarioId: sessao.usuarioId,
        enviado: true,
        usadoEm: null,
        expiraEm: { gt: agora },
        tentativas: { lt: MAXIMO_TENTATIVAS },
      },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, usuarioId: true, chave: true, codigoHash: true, tentativas: true },
    })
    if (!linha) return { ok: false as const, erro: 'Não há código valendo. Peça um novo (ele vale 10 minutos).' }

    if (!confere(sessao.usuarioId, codigo, linha.codigoHash)) {
      await db.confirmacaoTelefone.update({ where: { id: linha.id }, data: { tentativas: { increment: 1 } } })
      const restam = MAXIMO_TENTATIVAS - linha.tentativas - 1
      return {
        ok: false as const,
        erro: restam > 0
          ? `Código errado. ${restam === 1 ? 'Resta 1 tentativa' : `Restam ${restam} tentativas`}.`
          : 'Código errado, e as tentativas acabaram. Peça um código novo.',
      }
    }
    const r = await gravarConfirmado(db, sessao.orgId, linha, agora, 'tela')
    return r.ok ? { ok: true as const } : r
  })
}

export type ConfirmacaoPorMensagem =
  | { tratou: true; confirmou: true; nome: string; repetida?: boolean }
  | { tratou: true; confirmou: false; erro: string }

/**
 * "CONFIRMAR 123456" mandado do celular para o WhatsApp da loja. Chamado no
 * começo do laço da conversa, antes de decidir equipe × cliente — quem manda
 * isto ainda é, para o assistente, um número qualquer.
 *
 * Devolve null quando a mensagem NÃO é isto (não tem a forma, ou este número
 * não tem código mostrado esperando): aí ela segue o caminho de sempre, e um
 * cliente que escreva "confirmar 123456" por acaso não gasta tentativa de
 * ninguém.
 *
 * Só vale o código MOSTRADO na tela (`enviado = false`) e só vindo do número
 * para o qual ele foi pedido. A entrega repetida da mesma mensagem (o
 * provedor manda de novo) acha o código recém-usado e responde "tratou",
 * sem nada a fazer — senão ela cairia no assistente, já como equipe.
 */
export async function confirmarPorMensagem(
  orgId: string,
  telefone: string,
  texto: string,
  agora: Date = new Date(),
): Promise<ConfirmacaoPorMensagem | null> {
  const codigo = lerPedidoDeConfirmacao(texto)
  if (!codigo) return null
  const chave = chaveTelefone(telefone)
  if (!chave) return null

  return comoOrg(orgId, async (db) => {
    const linhas = await db.confirmacaoTelefone.findMany({
      where: {
        chave,
        enviado: false,
        OR: [
          { usadoEm: null, expiraEm: { gt: agora }, tentativas: { lt: MAXIMO_TENTATIVAS } },
          { usadoEm: { gte: new Date(agora.getTime() - VALIDADE_CODIGO_MS) } },
        ],
      },
      orderBy: { criadoEm: 'desc' },
      take: 10,
      select: { id: true, usuarioId: true, chave: true, codigoHash: true, usadoEm: true },
    })
    if (linhas.length === 0) return null

    const certa = linhas.find((l) => confere(l.usuarioId, codigo, l.codigoHash))
    if (certa?.usadoEm) {
      const u = await db.usuario.findUnique({ where: { id: certa.usuarioId }, select: { nome: true } })
      return { tratou: true as const, confirmou: true as const, nome: u?.nome ?? '', repetida: true }
    }
    if (!certa) {
      const vivas = linhas.filter((l) => !l.usadoEm)
      if (vivas.length === 0) return null
      await db.confirmacaoTelefone.updateMany({
        where: { id: { in: vivas.map((l) => l.id) } },
        data: { tentativas: { increment: 1 } },
      })
      return {
        tratou: true as const,
        confirmou: false as const,
        erro: 'Esse código não confere. Confira o código na tela Minha conta e mande de novo: CONFIRMAR e os 6 números.',
      }
    }
    const r = await gravarConfirmado(db, orgId, certa, agora, 'whatsapp')
    return r.ok
      ? { tratou: true as const, confirmou: true as const, nome: r.nome }
      : { tratou: true as const, confirmou: false as const, erro: r.erro }
  })
}

/** A resposta que volta para quem mandou o CONFIRMAR. */
export function respostaDaConfirmacao(r: ConfirmacaoPorMensagem): string | null {
  if (r.confirmou && r.repetida) return null
  if (r.confirmou) {
    return `Pronto, ${r.nome.split(' ')[0] || 'tudo certo'}: este WhatsApp está confirmado. A partir de agora o assistente da loja reconhece você por aqui.`
  }
  return r.erro
}

/**
 * Uma mensagem chegou de um número de equipe confirmado: ele continua vivo.
 * É o que empurra os 180 dias (`DIAS_SEM_USO`).
 */
export async function anotarVisto(orgId: string, usuarioId: string, agora: Date = new Date()) {
  await comoOrg(orgId, (db) =>
    db.usuario.updateMany({ where: { id: usuarioId, telefoneConfirmadoEm: { not: null } }, data: { telefoneVistoEm: agora } }),
  )
}

// ─────────────────────────────────────────────────────────────
// PARA AS TELAS
// ─────────────────────────────────────────────────────────────

export type MeuTelefone = {
  telefone: string | null
  estado: EstadoTelefone
  confirmadoEm: Date | null
  /** Há um código mandado pelo WhatsApp esperando ser digitado. */
  esperandoCodigo: boolean
}

export async function meuTelefone(sessao: Sessao, agora: Date = new Date()): Promise<MeuTelefone> {
  return comoOrg(sessao.orgId, async (db) => {
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: SELECT_TELEFONE })
    const esperando = await db.confirmacaoTelefone.count({
      where: { usuarioId: sessao.usuarioId, enviado: true, usadoEm: null, expiraEm: { gt: agora }, tentativas: { lt: MAXIMO_TENTATIVAS } },
    })
    const estado = eu ? estadoDoTelefone(eu, agora) : 'sem_telefone'
    return {
      telefone: eu?.telefone ?? null,
      estado,
      confirmadoEm: estado === 'confirmado' ? (eu?.telefoneConfirmadoEm ?? null) : null,
      esperandoCodigo: esperando > 0,
    }
  })
}

/**
 * Quem da equipe tem telefone e ainda não confirmou (ou venceu) — para a tela
 * do Assistente dizer à dona por que o assistente não responde a alguém, ou
 * por que o relatório parou de chegar.
 */
export async function equipeSemConfirmar(
  sessao: Sessao,
  agora: Date = new Date(),
): Promise<{ id: string; nome: string; estado: 'falta_confirmar' | 'vencido'; souEu: boolean }[]> {
  const pessoas = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findMany({
      where: { ativo: true, telefone: { not: null } },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, acessos: { select: { papel: true } }, ...SELECT_TELEFONE },
    }),
  )
  return pessoas
    .filter((p) => !p.acessos.every((a) => a.papel === 'SUPORTE'))
    .map((p) => ({ id: p.id, nome: p.nome, estado: estadoDoTelefone(p, agora), souEu: p.id === sessao.usuarioId }))
    .filter((p): p is typeof p & { estado: 'falta_confirmar' | 'vencido' } => p.estado === 'falta_confirmar' || p.estado === 'vencido')
}
