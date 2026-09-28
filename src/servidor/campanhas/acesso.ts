// Quem pode ter campanhas: a mesma régua do assistente, porque a campanha
// sai pelo número do assistente.
//
// Quatro chaves, todas conferidas no servidor a cada ação e a cada mensagem:
// o plano vende o assistente, o plano abre 'campanhas', a empresa ligou o
// módulo, e ela não está suspensa. A tela mostra trancado; a ação recusa.

import type { Plano, Situacao } from '@prisma/client'
import { comoOrg } from '../banco'
import { planoLibera, liberado, doPlano, planoQueAbre } from '../planos'
import { moduloLigado } from '../modulos'

export type OrgParaCampanha = { plano: Plano; situacao: Situacao; modulos: string[] }

export function campanhasAptas(org: OrgParaCampanha): boolean {
  if (org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') return false
  return planoLibera(org.plano, 'agente') && liberado(org.plano, 'campanhas') && moduloLigado(org, 'agente')
}

/** Por que não — a frase que a ação devolve para a tela. Nulo = pode. */
export function porQueNao(org: OrgParaCampanha): string | null {
  if (org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') return 'A empresa está suspensa.'
  if (!planoLibera(org.plano, 'agente') || !liberado(org.plano, 'campanhas')) {
    return `Campanhas são ${doPlano(planoQueAbre('campanhas').codigo)} para cima.`
  }
  if (!moduloLigado(org, 'agente')) return 'Ligue o módulo "Agente no WhatsApp" em Configurações.'
  return null
}

export async function lerOrgParaCampanha(orgId: string): Promise<OrgParaCampanha & { slug: string; nome: string }> {
  return comoOrg(orgId, (db) =>
    db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { plano: true, situacao: true, modulos: true, slug: true, nome: true },
    }),
  )
}

// ── o assistente ligado e o WhatsApp conectado ───────────────
// A campanha sai pelo número do assistente — e as respostas (inclusive o
// PARAR) voltam por ele. Assistente desligado ou WhatsApp desconectado é
// porta de entrada fechada: se a campanha continuasse mandando, a pessoa
// responderia "parar" para uma porta que ninguém abre. Então o relógio não
// acorda ninguém, e o teste do dono não começa.

export type AgenteParaCampanha = { ativo: boolean; canal: string } | null

/** O assistente está ligado e com o WhatsApp conectado? PURO. */
export const assistenteFala = (a: AgenteParaCampanha): boolean => !!a && a.ativo && a.canal !== 'NENHUM'

/** Por que não fala — a frase da tela. Nulo = fala. */
export function porQueCalado(a: AgenteParaCampanha): string | null {
  if (!a) return 'Crie o assistente na tela Agente antes de testar.'
  if (a.canal === 'NENHUM') return 'O WhatsApp da loja está desconectado. Conecte na tela Agente e teste de novo.'
  if (!a.ativo) return 'O assistente está desligado. Ligue na tela Agente: sem ele, a resposta ao teste não chega à campanha.'
  return null
}

export async function lerAgenteParaCampanha(orgId: string): Promise<AgenteParaCampanha> {
  return comoOrg(orgId, (db) => db.agente.findUnique({ where: { orgId }, select: { ativo: true, canal: true } }))
}

/** Levanta com a frase certa quando a empresa não pode ter campanha agora. */
export async function exigirCampanhasLiberadas(orgId: string) {
  const org = await lerOrgParaCampanha(orgId)
  const motivo = porQueNao(org)
  if (motivo) throw new Error(motivo)
  return org
}
