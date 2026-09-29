'use server'

// Server Action é endereço público — ver `balcao/acoes.ts`. Aqui: sessão, o
// MÓDULO, e a forma do que veio. Quem pode, em que loja, é de
// `servidor/compras.ts`.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { moduloLigado } from '@/servidor/modulos'
import { planoLibera } from '@/servidor/planos'
import { colunaDoDia } from '@/servidor/dia'
import {
  buscarParaComprar,
  buscarParaConsumo,
  cancelarPedido,
  criarPedido,
  encerrarPedido,
  enviarPedido,
  receberPedido,
  registrarConsumo,
  salvarFornecedor,
  salvarItensDoPedido,
  type ItemParaComprar,
} from '@/servidor/compras'
import { registrarErro } from '@/servidor/registro'

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)

async function comprasLigadas(orgId: string): Promise<boolean> {
  const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { plano: true, modulos: true } }))
  return !!org && moduloLigado(org, 'compras') && planoLibera(org.plano, 'compras')
}
const DESLIGADO = 'Compras está desligado nesta empresa. Quem responde pela empresa liga em Configurações.'

function traduzir(e: unknown, onde: string): string {
  if (e instanceof SemPermissao) return 'Você não pode fazer isso nesta loja.'
  return `Não deu para salvar. Tente de novo. (código ${registrarErro(onde, e)})`
}

export type EstadoFornecedor = { erro?: string; ok?: string; vez?: number }

export async function salvarFornecedorAcao(slug: string, anterior: EstadoFornecedor, form: FormData): Promise<EstadoFornecedor> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  if (!(await comprasLigadas(sessao.orgId))) return { erro: DESLIGADO, vez }
  const id = texto(form.get('id'), 64)
  if (id && !idValido(id)) return { erro: 'Fornecedor inválido.', vez }
  try {
    const r = await salvarFornecedor(
      sessao,
      {
        nome: texto(form.get('nome'), 150),
        telefone: texto(form.get('telefone'), 30),
        documento: texto(form.get('documento'), 30),
        observacao: texto(form.get('observacao'), 600),
      },
      id || undefined,
    )
    if (!r.ok) return { erro: r.erro, vez }
  } catch (e) {
    return { erro: traduzir(e, 'fornecedor.salvar'), vez }
  }
  revalidatePath(`/${slug}/compras`)
  return { ok: 'Fornecedor salvo.', vez }
}

export async function buscarItensAcao(slug: string, unidadeId: string, termo: string): Promise<ItemParaComprar[]> {
  const sessao = await exigirSessao(slug)
  if (!idValido(unidadeId)) return []
  try {
    return await buscarParaComprar(sessao, unidadeId, texto(termo, 60))
  } catch (e) {
    if (e instanceof SemPermissao) return []
    throw e
  }
}

export async function criarPedidoAcao(
  slug: string,
  d: { unidadeId: unknown; fornecedorId?: unknown; observacao?: unknown; previsto?: unknown; itens: unknown },
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const sessao = await exigirSessao(slug)
  if (!(await comprasLigadas(sessao.orgId))) return { ok: false, erro: DESLIGADO }
  if (!idValido(d.unidadeId)) return { ok: false, erro: 'Escolha a loja.' }
  const fornecedorId = texto(d.fornecedorId, 64)
  if (fornecedorId && !idValido(fornecedorId)) return { ok: false, erro: 'Fornecedor inválido.' }
  if (!Array.isArray(d.itens) || d.itens.length > 200) return { ok: false, erro: 'Itens inválidos.' }
  const itens = d.itens.map((i) => ({
    variacaoId: texto((i as { variacaoId?: unknown }).variacaoId, 64),
    quantidade: numero((i as { quantidade?: unknown }).quantidade),
    custoUnit: (i as { custoUnit?: unknown }).custoUnit == null ? null : numero((i as { custoUnit?: unknown }).custoUnit),
  }))
  if (itens.some((i) => !idValido(i.variacaoId) || Number.isNaN(i.quantidade) || (i.custoUnit !== null && Number.isNaN(i.custoUnit)))) {
    return { ok: false, erro: 'Um dos itens não confere.' }
  }
  try {
    const r = await criarPedido(sessao, {
      unidadeId: d.unidadeId,
      fornecedorId: fornecedorId || null,
      observacao: texto(d.observacao, 500),
      previsto: texto(d.previsto, 10) || null,
      itens,
    })
    if (r.ok) revalidatePath(`/${slug}/compras`)
    return r
  } catch (e) {
    return { ok: false, erro: traduzir(e, 'compra.criar') }
  }
}

/**
 * Troca os itens de um pedido que ainda é rascunho — o "esqueci a acetona"
 * antes de mandar. A função do servidor existia; faltava a tela chegar nela.
 */
export async function salvarItensAcao(
  slug: string,
  id: string,
  d: { itens: unknown },
): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Pedido inválido.' }
  if (!(await comprasLigadas(sessao.orgId))) return { erro: DESLIGADO }
  if (!Array.isArray(d?.itens) || d.itens.length > 200) return { erro: 'Itens inválidos.' }
  const itens = d.itens.map((i) => ({
    variacaoId: texto((i as { variacaoId?: unknown }).variacaoId, 64),
    quantidade: numero((i as { quantidade?: unknown }).quantidade),
    custoUnit: (i as { custoUnit?: unknown }).custoUnit == null ? null : numero((i as { custoUnit?: unknown }).custoUnit),
  }))
  if (itens.some((i) => !idValido(i.variacaoId) || Number.isNaN(i.quantidade) || (i.custoUnit !== null && Number.isNaN(i.custoUnit)))) {
    return { erro: 'Um dos itens não confere.' }
  }
  try {
    const r = await salvarItensDoPedido(sessao, id, itens)
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    return { erro: traduzir(e, 'compra.itens') }
  }
  revalidatePath(`/${slug}/compras`)
  revalidatePath(`/${slug}/compras/${id}`)
  return { ok: 'Itens do pedido salvos.' }
}

export async function mudarPedidoAcao(
  slug: string,
  id: string,
  m: { acao: 'enviar' | 'encerrar' | 'cancelar'; motivo?: string },
): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Pedido inválido.' }
  if (!(await comprasLigadas(sessao.orgId))) return { erro: DESLIGADO }
  try {
    const r =
      m?.acao === 'enviar'
        ? await enviarPedido(sessao, id)
        : m?.acao === 'encerrar'
          ? await encerrarPedido(sessao, id)
          : m?.acao === 'cancelar'
            ? await cancelarPedido(sessao, id, texto(m.motivo, 400))
            : { ok: false as const, erro: 'Ação desconhecida.' }
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    return { erro: traduzir(e, 'compra.mudar') }
  }
  revalidatePath(`/${slug}/compras`)
  revalidatePath(`/${slug}/compras/${id}`)
  return { ok: m.acao === 'enviar' ? 'Pedido marcado como mandado.' : m.acao === 'encerrar' ? 'Pedido encerrado.' : 'Pedido cancelado.' }
}

export async function receberPedidoAcao(
  slug: string,
  id: string,
  d: { chave: unknown; itens: unknown; conta?: { categoriaId?: unknown; vencimento?: unknown; jaPago?: unknown } | null },
): Promise<{ ok?: string; erro?: string; avisos?: string[] }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Pedido inválido.' }
  if (!(await comprasLigadas(sessao.orgId))) return { erro: DESLIGADO }
  if (!Array.isArray(d.itens) || d.itens.length > 200) return { erro: 'Itens inválidos.' }
  const itens = d.itens.map((i) => ({
    itemId: texto((i as { itemId?: unknown }).itemId, 64),
    quantidade: numero((i as { quantidade?: unknown }).quantidade),
    custoUnit: (i as { custoUnit?: unknown }).custoUnit == null ? null : numero((i as { custoUnit?: unknown }).custoUnit),
  }))
  if (itens.some((i) => !idValido(i.itemId) || Number.isNaN(i.quantidade) || (i.custoUnit !== null && Number.isNaN(i.custoUnit)))) {
    return { erro: 'Uma das quantidades não confere.' }
  }
  let conta: { categoriaId: string; vencimento: Date; jaPago: boolean } | null = null
  if (d.conta) {
    const venc = texto(d.conta.vencimento, 10)
    if (!idValido(d.conta.categoriaId) || !/^\d{4}-\d{2}-\d{2}$/.test(venc)) return { erro: 'Escolha a categoria e o vencimento da conta.' }
    conta = { categoriaId: d.conta.categoriaId, vencimento: colunaDoDia(venc), jaPago: d.conta.jaPago === true }
  }
  try {
    const r = await receberPedido(sessao, id, { chave: texto(d.chave, 64), itens, conta })
    if (!r.ok) return { erro: r.erro }
    revalidatePath(`/${slug}/compras`)
    revalidatePath(`/${slug}/compras/${id}`)
    revalidatePath(`/${slug}/estoque`)
    if (r.repetido) return { ok: 'Este recebimento já estava registrado — nada entrou de novo.' }
    return {
      ok: r.situacao === 'RECEBIDO' ? 'Recebido. A mercadoria entrou no estoque.' : 'Parte recebida. O que falta continua no pedido.',
      avisos: [
        ...(r.contaLancada ? ['A conta a pagar do fornecedor foi lançada no Financeiro.'] : []),
        ...r.naoFeito.map((n) => `Não foi feito: ${n}.`),
      ],
    }
  } catch (e) {
    return { erro: traduzir(e, 'compra.receber') }
  }
}

export async function buscarConsumoAcao(slug: string, unidadeId: string, termo: string): Promise<ItemParaComprar[]> {
  const sessao = await exigirSessao(slug)
  if (!idValido(unidadeId)) return []
  try {
    return await buscarParaConsumo(sessao, unidadeId, texto(termo, 60))
  } catch (e) {
    if (e instanceof SemPermissao) return []
    throw e
  }
}

export async function registrarConsumoAcao(
  slug: string,
  d: { unidadeId: unknown; itens: unknown; motivo?: unknown },
): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!(await comprasLigadas(sessao.orgId))) return { erro: DESLIGADO }
  if (!idValido(d.unidadeId)) return { erro: 'Escolha a loja.' }
  if (!Array.isArray(d.itens) || d.itens.length > 100) return { erro: 'Itens inválidos.' }
  const itens = d.itens.map((i) => ({
    variacaoId: texto((i as { variacaoId?: unknown }).variacaoId, 64),
    quantidade: numero((i as { quantidade?: unknown }).quantidade),
  }))
  if (itens.some((i) => !idValido(i.variacaoId) || Number.isNaN(i.quantidade))) return { erro: 'Uma das quantidades não confere.' }
  try {
    const r = await registrarConsumo(sessao, { unidadeId: d.unidadeId, itens, motivo: texto(d.motivo, 200) })
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    return { erro: traduzir(e, 'consumo.registrar') }
  }
  revalidatePath(`/${slug}/compras/consumo`)
  revalidatePath(`/${slug}/estoque`)
  return { ok: 'Material anotado. Saiu do estoque como consumo interno.' }
}
