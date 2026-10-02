'use server'

// Server Action é endereço público — ver `balcao/acoes.ts`. Aqui: a sessão, o
// MÓDULO e a forma do que veio (id com cara de id, número que é número). Quem
// pode, em que unidade, e o que o estoque faz é de `servidor/fabrica.ts`: a
// tela não decide nada sozinha.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { moduloLigado } from '@/servidor/modulos'
import { planoLibera } from '@/servidor/planos'
import {
  FabricaRecusou,
  abrirOrdem,
  apagarReceita,
  cancelarOrdem,
  cancelarPedido,
  criarPedido,
  encerrarOrdem,
  enviarPedido,
  receberPedido,
  salvarReceita,
} from '@/servidor/fabrica'

export type Recado = { ok?: string; erro?: string }

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)
/** A tela já leu "4,5" e manda número; aqui só se confere que é número mesmo. */
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const lista = (v: unknown, max = 300): Record<string, unknown>[] | null =>
  Array.isArray(v) && v.length <= max && v.every((i) => i && typeof i === 'object') ? (v as Record<string, unknown>[]) : null

async function fabricaLigada(orgId: string): Promise<boolean> {
  const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { plano: true, modulos: true } }))
  return !!org && moduloLigado(org, 'fabrica') && planoLibera(org.plano, 'fabrica')
}
const DESLIGADO = 'A Fábrica está desligada nesta empresa. Quem responde pela empresa liga em Configurações.'

/** A recusa escrita por nós passa como está; o resto vira frase de gente e vai para o log. */
function traduzir(e: unknown, padrao: string): string {
  if (e instanceof FabricaRecusou) return e.message
  if (e instanceof SemPermissao) return 'Você não pode fazer isso nesta unidade.'
  return recadoDoErro(e, padrao)
}

function revalidar(slug: string) {
  revalidatePath(`/${slug}/fabrica`)
  revalidatePath(`/${slug}/fabrica/pedir`)
  revalidatePath(`/${slug}/estoque`)
}

// ── ficha técnica ────────────────────────────────────────────

export async function salvarReceitaAcao(
  slug: string,
  d: { variacaoId: unknown; rendimento: unknown; validadeDias: unknown; observacao?: unknown; itens: unknown },
): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(d.variacaoId)) return { erro: 'Escolha o produto que a receita faz.' }
  const itens = lista(d.itens, 100)
  if (!itens) return { erro: 'Insumos inválidos.' }
  const linhas = itens.map((i) => ({ insumoId: texto(i.insumoId, 64), quantidade: numero(i.quantidade) }))
  if (linhas.some((i) => !idValido(i.insumoId) || Number.isNaN(i.quantidade))) return { erro: 'Um dos insumos está sem quantidade que dê para ler.' }
  const validade = d.validadeDias === null || d.validadeDias === '' ? null : numero(d.validadeDias)
  if (validade !== null && Number.isNaN(validade)) return { erro: 'A validade é em dias (ou em branco).' }
  try {
    await salvarReceita(sessao, {
      variacaoId: d.variacaoId,
      rendimento: numero(d.rendimento),
      validadeDias: validade,
      observacao: texto(d.observacao, 500),
      itens: linhas,
    })
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para salvar a ficha técnica.') }
  }
  revalidatePath(`/${slug}/fabrica`)
  return { ok: 'Ficha técnica salva.' }
}

export async function apagarReceitaAcao(slug: string, receitaId: string): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(receitaId)) return { erro: 'Ficha inválida.' }
  try {
    await apagarReceita(sessao, receitaId)
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para apagar a ficha técnica.') }
  }
  revalidatePath(`/${slug}/fabrica`)
  return { ok: 'Ficha técnica apagada.' }
}

// ── ordem de produção ────────────────────────────────────────

export async function abrirOrdemAcao(
  slug: string,
  d: { unidadeId: unknown; variacaoId: unknown; bateladas: unknown; observacao?: unknown },
): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(d.unidadeId)) return { erro: 'Escolha a fábrica.' }
  if (!idValido(d.variacaoId)) return { erro: 'Escolha o produto.' }
  try {
    const o = await abrirOrdem(sessao, {
      unidadeId: d.unidadeId,
      variacaoId: d.variacaoId,
      bateladas: numero(d.bateladas),
      observacao: texto(d.observacao, 500),
    })
    revalidatePath(`/${slug}/fabrica`)
    return { ok: `OP ${o.numero} aberta, lote ${o.lote}.` }
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para abrir a ordem.') }
  }
}

export type RecadoDoEncerramento = Recado & { custoUnitario?: number | null; faltouCusto?: boolean; lote?: string; validade?: string | null }

export async function encerrarOrdemAcao(
  slug: string,
  ordemId: string,
  d: { produzida: unknown; consumos: unknown; lote?: unknown; validade?: unknown },
): Promise<RecadoDoEncerramento> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(ordemId)) return { erro: 'Ordem inválida.' }
  const consumos = lista(d.consumos, 100)
  if (!consumos) return { erro: 'Insumos inválidos.' }
  const usados = consumos.map((c) => ({ insumoId: texto(c.insumoId, 64), usado: numero(c.usado) }))
  if (usados.some((c) => !idValido(c.insumoId) || Number.isNaN(c.usado))) return { erro: 'Um dos insumos está sem a quantidade usada.' }
  const validade = texto(d.validade, 10)
  if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(validade)) return { erro: 'Validade inválida.' }
  try {
    const r = await encerrarOrdem(sessao, ordemId, {
      produzida: numero(d.produzida),
      consumos: usados,
      lote: texto(d.lote, 40) || null,
      validade: validade || null,
    })
    revalidar(slug)
    return { ok: 'Produção encerrada. O que saiu já está no estoque da fábrica.', ...r }
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para encerrar a ordem.') }
  }
}

export async function cancelarOrdemAcao(slug: string, ordemId: string, motivo: unknown): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(ordemId)) return { erro: 'Ordem inválida.' }
  const m = texto(motivo, 200).trim()
  if (m.length < 3) return { erro: 'Diga por que cancelar.' }
  try {
    await cancelarOrdem(sessao, ordemId, m)
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para cancelar a ordem.') }
  }
  revalidatePath(`/${slug}/fabrica`)
  return { ok: 'Ordem cancelada. Nada saiu do estoque.' }
}

// ── o pedido da loja ─────────────────────────────────────────

export async function criarPedidoAcao(
  slug: string,
  d: { lojaId: unknown; fabricaId?: unknown; itens: unknown; observacao?: unknown },
): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(d.lojaId)) return { erro: 'Escolha a loja.' }
  const fabricaId = texto(d.fabricaId, 64)
  if (fabricaId && !idValido(fabricaId)) return { erro: 'Fábrica inválida.' }
  const itens = lista(d.itens, 300)
  if (!itens) return { erro: 'Itens inválidos.' }
  const linhas = itens.map((i) => ({ variacaoId: texto(i.variacaoId, 64), quantidade: numero(i.quantidade) }))
  if (linhas.some((i) => !idValido(i.variacaoId) || Number.isNaN(i.quantidade))) return { erro: 'Uma das quantidades não dá para ler.' }
  try {
    const p = await criarPedido(sessao, { lojaId: d.lojaId, fabricaId: fabricaId || null, itens: linhas, observacao: texto(d.observacao, 500) })
    revalidar(slug)
    return { ok: `Pedido ${p.numero} feito. A fábrica vê na hora.` }
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para fazer o pedido.') }
  }
}

export async function enviarPedidoAcao(slug: string, pedidoId: string, d: { itens: unknown }): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(pedidoId)) return { erro: 'Pedido inválido.' }
  const itens = lista(d.itens, 300)
  if (!itens) return { erro: 'Itens inválidos.' }
  const linhas = itens.map((i) => ({ itemId: texto(i.itemId, 64), enviada: numero(i.enviada), lote: texto(i.lote, 40) || null }))
  if (linhas.some((i) => !idValido(i.itemId) || Number.isNaN(i.enviada))) return { erro: 'Uma das quantidades não dá para ler.' }
  try {
    await enviarPedido(sessao, pedidoId, linhas)
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para mandar o pedido.') }
  }
  revalidar(slug)
  return { ok: 'Mandado. Saiu do estoque da fábrica e já entrou no da loja; falta a loja conferir.' }
}

export async function receberPedidoAcao(slug: string, pedidoId: string, d: { itens: unknown }): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(pedidoId)) return { erro: 'Pedido inválido.' }
  const itens = lista(d.itens, 300)
  if (!itens) return { erro: 'Itens inválidos.' }
  const linhas = itens.map((i) => ({ itemId: texto(i.itemId, 64), recebida: numero(i.recebida) }))
  if (linhas.some((i) => !idValido(i.itemId) || Number.isNaN(i.recebida))) return { erro: 'Uma das quantidades não dá para ler.' }
  try {
    const r = await receberPedido(sessao, pedidoId, linhas)
    revalidar(slug)
    return {
      ok:
        r.faltas === 0
          ? 'Conferido: chegou tudo.'
          : `Conferido. ${r.faltas === 1 ? 'Um item veio' : `${r.faltas} itens vieram`} a menos — a diferença saiu do estoque da loja como perda, com o número do pedido.`,
    }
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para conferir o pedido.') }
  }
}

export async function cancelarPedidoAcao(slug: string, pedidoId: string): Promise<Recado> {
  const sessao = await exigirSessao(slug)
  if (!(await fabricaLigada(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(pedidoId)) return { erro: 'Pedido inválido.' }
  try {
    await cancelarPedido(sessao, pedidoId)
  } catch (e) {
    return { erro: traduzir(e, 'Não deu para cancelar o pedido.') }
  }
  revalidar(slug)
  return { ok: 'Pedido cancelado.' }
}
