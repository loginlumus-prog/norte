// Quem está dentro do sistema agora, e quem cabe.
//
// ── o que a assinatura cobra, e por que ──────────────────────
// Não é conta cadastrada: é gente DENTRO ao mesmo tempo. Cadastrar a equipe
// inteira é de graça em qualquer plano.
//
// A razão não é comercial, é de segurança. Cobrar por conta cadastrada empurra
// a loja a compartilhar login — duas pessoas, uma senha — e aí o livro de
// auditoria passa a mentir, porque toda ação aparece no nome de uma pessoa só.
// O livro é uma das coisas que este sistema vende. Cobrando por simultaneidade,
// não sobra motivo nenhum para emprestar senha.
//
// ── e por que PESSOA, não aparelho ───────────────────────────
// O dono que olha o celular com o computador aberto no balcão gastaria duas
// vagas — e não estaria errado em achar que é roubo. Contando pessoa, a frase
// que se vende é a mesma que se cobra: "quantas pessoas podem estar dentro ao
// mesmo tempo".

import { comoOrg } from './banco'
import { PLANOS } from './planos'
import type { Plano } from '@prisma/client'

/**
 * Parada há mais que isto, a vaga pode ser TOMADA por quem precisar.
 *
 * Este é o número que decide se o modelo sobrevive numa loja de verdade. O
 * cenário é sempre o mesmo: a caixa quer entrar e tem cliente esperando no
 * balcão. Se ela tiver que ligar para alguém, o produto vira problema no pior
 * momento possível.
 *
 * Então tomar vaga parada não pede permissão a ninguém. Só sessão que está DE
 * FATO em uso exige ir falar com a pessoa.
 */
export const VAGA_LIVRE_MIN = 10

/**
 * Parada há mais que isto, a tela TRANCA e pede a senha de novo.
 *
 * Trancar, e não deslogar. A diferença é a venda em andamento: o carrinho do
 * balcão vive na tela, e derrubar a sessão de quem parou 30 minutos jogaria
 * fora uma venda pela metade numa tarde parada. Trancado, o trabalho fica onde
 * estava — e a segurança é a mesma, porque ninguém passa atrás do balcão e
 * mexe.
 */
export const TRANCA_MIN = 30

/** Antes de trancar, a tela avisa por este tanto de segundos. */
export const AVISO_SEG = 60

/** Não grava sinal mais de uma vez por este tanto de minutos. */
const SINAL_MIN = 1

const minutosDesde = (agora: Date, quando: Date) => (agora.getTime() - quando.getTime()) / 60000

export type Presente = {
  usuarioId: string
  nome: string
  desde: Date
  ultimoSinal: Date
}

/** O que a tela mostra quando barra alguém. */
export type Ocupante = Presente & {
  /** Quanto tempo faz que essa pessoa mexeu em alguma coisa. */
  paradaMin: number
  /** A vaga dela pode ser tomada sem pedir nada a ninguém? */
  tomavel: boolean
}

export type Veredito =
  | { pode: true; derrubar?: null }
  /** Cabe, mas alguém sai — e a tela precisa dizer QUEM antes de confirmar. */
  | { pode: true; derrubar: Ocupante }
  | { pode: false; ocupantes: Ocupante[] }

const enfeitar = (agora: Date, p: Presente): Ocupante => {
  const paradaMin = minutosDesde(agora, p.ultimoSinal)
  return { ...p, paradaMin, tomavel: paradaMin >= VAGA_LIVRE_MIN }
}

/**
 * Cabe mais esta pessoa?
 *
 * Função PURA: recebe o retrato e devolve a decisão. É assim porque esta é a
 * regra que decide se alguém consegue trabalhar, e regra assim precisa de teste
 * — e teste que precisa de banco não é escrito com a frequência necessária.
 *
 * ── as três regras, na ordem ─────────────────────────────────
 * 1. Quem já está dentro entra de novo sem gastar nada. Abrir o sistema no
 *    celular tendo o computador aberto é a mesma pessoa, e cobrar por isso
 *    seria cobrar por aparelho — que é justamente o que a gente não faz.
 *
 * 2. Vaga parada há mais de VAGA_LIVRE_MIN é tomada, e pronto. Sem permissão,
 *    sem telefonema.
 *
 * 3. O DONO SEMPRE ENTRA. Se ele não conseguir entrar para resolver o
 *    problema, o produto está quebrado — e é ele quem paga. Sem vaga parada,
 *    ele derruba a mais antiga, e a tela diz quem caiu.
 */
export function decidirEntrada(
  agora: Date,
  presentes: Presente[],
  quem: { usuarioId: string; ehDono: boolean },
  vagas: number | null,
): Veredito {
  // 1. já está dentro
  if (presentes.some((p) => p.usuarioId === quem.usuarioId)) return { pode: true }

  // sem teto no plano
  if (vagas === null) return { pode: true }

  if (presentes.length < vagas) return { pode: true }

  const ocupantes = presentes
    .map((p) => enfeitar(agora, p))
    // A mais parada primeiro: é dela que a vaga sai, e é ela que a tela deve
    // sugerir. Derrubar a mais recente seria derrubar quem está trabalhando.
    .sort((a, b) => b.paradaMin - a.paradaMin)

  // 2. tem vaga parada
  const parada = ocupantes.find((o) => o.tomavel)
  if (parada) return { pode: true, derrubar: parada }

  // 3. o dono entra de qualquer jeito
  if (quem.ehDono && ocupantes.length > 0) return { pode: true, derrubar: ocupantes[0]! }

  return { pode: false, ocupantes }
}

// ─────────────────────────────────────────────────────────────
// O LADO DO BANCO
// ─────────────────────────────────────────────────────────────

/** Quem está dentro, para a tela de "quem está usando agora". */
export async function quemEstaDentro(orgId: string, agora = new Date()): Promise<Ocupante[]> {
  const linhas = await comoOrg(orgId, (db) =>
    db.presenca.findMany({
      select: { usuarioId: true, desde: true, ultimoSinal: true, usuario: { select: { nome: true } } },
      orderBy: { ultimoSinal: 'desc' },
    }),
  )
  return linhas.map((l) =>
    enfeitar(agora, {
      usuarioId: l.usuarioId,
      nome: l.usuario.nome,
      desde: l.desde,
      ultimoSinal: l.ultimoSinal,
    }),
  )
}

/**
 * Tenta ocupar uma vaga. Chamado no login, DEPOIS de a senha conferir.
 *
 * Depois, e não antes, de propósito: quem errou a senha não pode descobrir
 * quem está dentro da empresa. A lista de ocupantes só sai para quem já provou
 * que tem conta ali.
 */
export async function ocuparVaga(
  orgId: string,
  plano: Plano,
  quem: { usuarioId: string; ehDono: boolean },
  agora = new Date(),
): Promise<Veredito> {
  const presentes = await quemEstaDentro(orgId, agora)
  const v = decidirEntrada(agora, presentes, quem, PLANOS[plano].vagas)
  if (!v.pode) return v

  await comoOrg(orgId, async (db) => {
    if (v.derrubar) {
      await db.presenca.delete({
        where: { orgId_usuarioId: { orgId, usuarioId: v.derrubar.usuarioId } },
      })
      await db.auditoria.create({
        data: {
          orgId,
          usuarioId: quem.usuarioId,
          quem: 'sistema',
          acao: 'vaga.assumiu',
          alvoTipo: 'usuario',
          alvoId: v.derrubar.usuarioId,
          alvoNome: v.derrubar.nome,
          depois: { paradaMin: Math.round(v.derrubar.paradaMin) },
        },
      })
    }
    await db.presenca.upsert({
      where: { orgId_usuarioId: { orgId, usuarioId: quem.usuarioId } },
      create: { orgId, usuarioId: quem.usuarioId, desde: agora, ultimoSinal: agora },
      update: { ultimoSinal: agora },
    })
  })

  return v
}

/**
 * "Ainda estou aqui." Chamado a cada tela que a pessoa abre.
 *
 * Só escreve quando o último sinal já passou de SINAL_MIN. Sem isso seria uma
 * escrita no banco por requisição, o dia inteiro, por pessoa — e o que se ganha
 * com precisão de segundo aqui é zero: a régua que importa é de dez minutos.
 */
export async function sinal(orgId: string, usuarioId: string, agora = new Date()): Promise<void> {
  const corte = new Date(agora.getTime() - SINAL_MIN * 60000)
  await comoOrg(orgId, (db) =>
    db.presenca.updateMany({
      where: { orgId, usuarioId, ultimoSinal: { lt: corte } },
      data: { ultimoSinal: agora },
    }),
  )
}

/** A pessoa saiu. A vaga fica livre na hora. */
export async function liberarVaga(orgId: string, usuarioId: string): Promise<void> {
  await comoOrg(orgId, (db) =>
    db.presenca.deleteMany({ where: { orgId, usuarioId } }),
  )
}

/** Está trancada? A tela pede a senha de novo sem perder o que está aberto. */
export function precisaTrancar(agora: Date, ultimoSinal: Date): boolean {
  return minutosDesde(agora, ultimoSinal) >= TRANCA_MIN
}
