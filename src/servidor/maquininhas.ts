// As maquininhas de cada loja.
//
// ── por que existe ───────────────────────────────────────────
// A loja que tem duas maquininhas (um banco e outra empresa de cartão, por
// exemplo) confere cada uma em separado: o extrato de uma não traz o que
// caiu na outra. Se o sistema só sabe "crédito R$ 1.200", a gerente passa a
// noite somando comprovante de papel para descobrir quanto foi em cada uma.
// Com a maquininha anotada em cada pagamento, o fechamento separa sozinho.
//
// O cadastro é POR LOJA (cada loja tem as suas, às vezes com CNPJ diferente)
// e diz em que formas cada uma entra: a conta do Pix pode ser de um banco, o
// cartão de outro. O pagamento guarda o NOME como estava na hora — renomear
// amanhã não reescreve o fechamento de ontem.
//
// O recebimento de parcela pode usar o mesmo cadastro (`maquininhasDaLoja`).

import type { FormaPagamento } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, type Sessao } from './permissao'

export type Maquininha = { nome: string; formas: FormaPagamento[] }

/** As formas que passam por maquininha ou conta: o resto (dinheiro, vale, crediário) não tem. */
export const FORMAS_DA_MAQUININHA = ['PIX', 'DEBITO', 'CREDITO'] as const satisfies readonly FormaPagamento[]

export const temMaquininha = (forma: string) => (FORMAS_DA_MAQUININHA as readonly string[]).includes(forma)

/** Teto de quantas uma loja cadastra: lista de escolha no balcão, não catálogo. */
export const MAX_MAQUININHAS = 8

/**
 * A lista guardada na loja, limpa. O que vem do banco é JSON — escrito por
 * esta tela, mas JSON é de quem escreveu por último. Nome vazio, forma que
 * não existe e nome repetido saem aqui, sem derrubar o balcão.
 */
export function lerMaquininhas(cru: unknown): Maquininha[] {
  if (!Array.isArray(cru)) return []
  const vistos = new Set<string>()
  const lista: Maquininha[] = []
  for (const x of cru) {
    if (!x || typeof x !== 'object') continue
    const nome = typeof (x as { nome?: unknown }).nome === 'string' ? (x as { nome: string }).nome.trim().slice(0, 40) : ''
    const formasCru = (x as { formas?: unknown }).formas
    const formas = Array.isArray(formasCru)
      ? FORMAS_DA_MAQUININHA.filter((f) => formasCru.includes(f))
      : []
    if (!nome || formas.length === 0 || vistos.has(nome.toLowerCase())) continue
    vistos.add(nome.toLowerCase())
    lista.push({ nome, formas: [...formas] })
    if (lista.length >= MAX_MAQUININHAS) break
  }
  return lista
}

/** As maquininhas desta loja em que a forma entra. */
export const daForma = (lista: Maquininha[], forma: string) => lista.filter((m) => (m.formas as string[]).includes(forma))

/**
 * O nome a gravar no pagamento, ou a recusa.
 *
 * Sem nome: nulo — a loja sem cadastro (ou a forma sem maquininha) segue
 * vendendo como sempre. Com nome: precisa ser uma maquininha DESTA loja que
 * aceita ESTA forma. O nome vem do navegador; sem esta conferência, o
 * fechamento ganharia uma "maquininha" inventada que nenhum extrato confere.
 */
export function maquininhaDoPagamento(
  lista: Maquininha[],
  forma: string,
  nome: string | null | undefined,
): { ok: true; nome: string | null } | { ok: false } {
  const n = typeof nome === 'string' ? nome.trim() : ''
  if (!n) return { ok: true, nome: null }
  if (!temMaquininha(forma)) return { ok: false }
  const achada = daForma(lista, forma).find((m) => m.nome.toLowerCase() === n.toLowerCase())
  return achada ? { ok: true, nome: achada.nome } : { ok: false }
}

/** Dentro de uma transação já aberta (a venda, o recebimento). */
export async function maquininhasNoBanco(db: BancoDaOrg, unidadeId: string): Promise<Maquininha[]> {
  const u = await db.unidade.findUnique({ where: { id: unidadeId }, select: { maquininhas: true } })
  return lerMaquininhas(u?.maquininhas)
}

/** As maquininhas de uma loja. Abre a própria transação: não chame de dentro de `comoOrg`. */
export async function maquininhasDaLoja(orgId: string, unidadeId: string): Promise<Maquininha[]> {
  return comoOrg(orgId, (db) => maquininhasNoBanco(db, unidadeId))
}

/**
 * Grava a lista da loja. Quem configura a empresa: é cadastro de onde o
 * dinheiro cai, não gesto de balcão.
 */
export async function salvarMaquininhas(sessao: Sessao, unidadeId: string, lista: Maquininha[]): Promise<Maquininha[]> {
  exigir(sessao, 'empresa.configurar')
  const limpa = lerMaquininhas(lista)
  await comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findUnique({ where: { id: unidadeId }, select: { id: true, nome: true, maquininhas: true } })
    if (!loja) throw new Error('Loja não encontrada nesta empresa.')
    await db.unidade.update({ where: { id: unidadeId }, data: { maquininhas: limpa } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.maquininhas',
        alvoTipo: 'unidade',
        alvoId: unidadeId,
        alvoNome: loja.nome,
        antes: lerMaquininhas(loja.maquininhas),
        depois: limpa,
      },
    })
  })
  return limpa
}
