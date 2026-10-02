// As duas chaves da empresa sobre assinatura e o balcão, em Configurações.
//
// ── "Pedir o PIN nas exceções" (Org.pinNasExcecoes) ──────────
// Nasce desligada e SÓ liga quando toda a equipe que opera já criou o PIN.
// Ligada antes, quem não tem descobre no meio de uma sangria, com a cliente
// esperando — e a loja para. A tela mostra quem falta; a função recusa.
// Desligar vale sempre.
//
// ── "Vendedora conta estoque e cadastra produto" (Org.balcaoAmpliado) ──
// O que a empresa dá a mais ao papel Balcão (ver EXTRAS_DO_BALCAO em
// permissao.ts). Vale na próxima tela de cada pessoa: a sessão lê a chave do
// banco a cada requisição.

import { comoOrg } from './banco'
import { exigir, exigirQueNaoSejaSuporte, type Sessao } from './permissao'
import { quemFaltaPin } from './autorizacao'
import { plural } from './texto'

export type SituacaoDasAssinaturas = {
  pinNasExcecoes: boolean
  balcaoAmpliado: boolean
  /** Quem ainda não criou o PIN, entre quem opera. */
  faltam: { id: string; nome: string }[]
}

export async function situacaoDasAssinaturas(sessao: Sessao): Promise<SituacaoDasAssinaturas> {
  exigir(sessao, 'empresa.configurar')
  const org = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { pinNasExcecoes: true, balcaoAmpliado: true } }),
  )
  return { ...org, faltam: await quemFaltaPin(sessao.orgId) }
}

export async function mudarPinNasExcecoes(sessao: Sessao, ligar: boolean): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'empresa.configurar')
  // As regras do PIN são a trava da própria loja contra abuso: quem
  // está de fora não afrouxa.
  exigirQueNaoSejaSuporte(sessao, 'muda as regras do PIN')
  if (ligar) {
    const faltam = await quemFaltaPin(sessao.orgId)
    if (faltam.length > 0) {
      return {
        ok: false,
        erro: `${plural(faltam.length, 'pessoa da equipe ainda não criou', 'pessoas da equipe ainda não criaram')} o PIN (${faltam
          .map((f) => f.nome)
          .join(', ')}). Ligando agora, ${faltam.length === 1 ? 'ela fica' : 'elas ficam'} sem conseguir fazer sangria, cancelar venda ou corrigir estoque.`,
      }
    }
  }
  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { pinNasExcecoes: true } })
    if (antes.pinNasExcecoes === ligar) return
    await db.org.update({ where: { id: sessao.orgId }, data: { pinNasExcecoes: ligar } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.assinaturas',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        antes: { pinNasExcecoes: antes.pinNasExcecoes },
        depois: { pinNasExcecoes: ligar },
      },
    })
  })
  return { ok: true }
}

export async function mudarBalcaoAmpliado(sessao: Sessao, ligar: boolean): Promise<{ ok: true }> {
  exigir(sessao, 'empresa.configurar')
  exigirQueNaoSejaSuporte(sessao, 'muda o que a vendedora pode')
  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { balcaoAmpliado: true } })
    if (antes.balcaoAmpliado === ligar) return
    await db.org.update({ where: { id: sessao.orgId }, data: { balcaoAmpliado: ligar } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.balcao_ampliado',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        antes: { balcaoAmpliado: antes.balcaoAmpliado },
        depois: { balcaoAmpliado: ligar },
      },
    })
  })
  return { ok: true }
}
