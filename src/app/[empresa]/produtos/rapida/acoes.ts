'use server'

// A planilha de produtos: mudar nome, gaveta e preço de muitos de uma vez, e
// cadastrar em sequência. Cada linha passa pelas MESMAS regras da ficha
// (`editarProduto`, `criarProduto`) e o estoque pela mesma correção da tela
// de Estoque (`corrigirPeloContado`, com motivo e assinatura). Nada aqui
// decide permissão sozinho.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { criarProduto, editarProduto } from '@/servidor/produto'
import { corrigirPeloContado } from '@/servidor/estoque'
import { comoOrg } from '@/servidor/banco'
import { SemPermissao } from '@/servidor/permissao'

export type EstadoLinha = { ok?: string; erro?: string; precisaPin?: boolean; saldo?: number; produtoId?: string }

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export type LinhaEditada = {
  nome?: string
  categoriaId?: string | null
  precoVista?: string | number
  precoCartao?: string | number | null
  precoCrediario?: string | number | null
  custo?: string | number | null
}

/** Grava nome, gaveta e preços de UM produto. Só os campos que vieram mudam. */
export async function salvarLinha(slug: string, produtoId: string, d: LinhaEditada): Promise<EstadoLinha> {
  const sessao = await exigirSessao(slug)
  const dados: Parameters<typeof editarProduto>[2] = {}
  if (d.nome !== undefined) dados.nome = String(d.nome).slice(0, 200)
  if (d.categoriaId !== undefined) dados.categoriaId = d.categoriaId ? String(d.categoriaId) : null
  for (const campo of ['precoVista', 'precoCartao', 'precoCrediario', 'custo'] as const) {
    if (d[campo] === undefined) continue
    const n = numero(d[campo])
    if (Number.isNaN(n) || (n !== null && n < 0)) return { erro: 'Preço e custo são números, zero ou mais (ex.: 4,50).' }
    if (campo === 'precoVista') {
      if (n === null || n <= 0) return { erro: 'O preço precisa ser maior que zero.' }
      dados.precoVista = n
    } else {
      dados[campo] = n
    }
  }
  try {
    const r = await editarProduto(sessao, produtoId, dados)
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/produtos`)
    return { ok: 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mudar isto (preço e custo pedem permissão própria).' }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
}

/** O saldo NESTA loja pelo que foi contado — a mesma correção da tela de Estoque. */
export async function salvarEstoque(
  slug: string,
  c: { variacaoId: string; unidadeId: string; contado: string | number; motivo: string; visto: number; pin?: string | null },
): Promise<EstadoLinha> {
  const sessao = await exigirSessao(slug)
  const contado = numero(c.contado)
  if (contado === null || Number.isNaN(contado) || contado < 0) return { erro: 'O estoque é um número, zero ou mais.' }
  if (String(c.motivo ?? '').trim().length < 3) return { erro: 'Diga o motivo da mudança de estoque (lá embaixo).' }
  try {
    const r = await corrigirPeloContado(sessao, {
      variacaoId: String(c.variacaoId),
      unidadeId: String(c.unidadeId),
      contado,
      motivo: String(c.motivo),
      saldoVisto: c.visto,
      pin: c.pin ? String(c.pin).replace(/\D/g, '') : null,
    })
    if (!r.ok) return r.motivo === 'mudou' ? { erro: r.erro, saldo: r.saldo } : { erro: r.erro, precisaPin: true }
    revalidatePath(`/${slug}/estoque`)
    revalidatePath(`/${slug}/produtos`)
    return { ok: 'Estoque salvo.', saldo: r.saldo }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer no estoque desta loja.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar o estoque.') }
  }
}

/**
 * Cadastra um produto simples (sem grade) pela planilha, já com o estoque da
 * loja escolhida. Produto com cor, tamanho ou sabor continua pela ficha.
 */
export async function criarLinha(
  slug: string,
  d: { nome: string; categoriaId: string | null; precoVista: string | number; custo: string | number | null; estoque: string | number | null; unidadeId: string | null; motivo: string; pin?: string | null },
): Promise<EstadoLinha> {
  const sessao = await exigirSessao(slug)
  const preco = numero(d.precoVista)
  const custo = numero(d.custo)
  const estoque = numero(d.estoque)
  if (!String(d.nome ?? '').trim()) return { erro: 'Escreva o nome do produto.' }
  if (preco === null || Number.isNaN(preco) || preco <= 0) return { erro: 'O preço precisa ser maior que zero.' }
  if (Number.isNaN(custo) || (custo !== null && custo < 0)) return { erro: 'O custo é um número, zero ou mais.' }
  if (Number.isNaN(estoque) || (estoque !== null && estoque < 0)) return { erro: 'O estoque é um número, zero ou mais.' }
  const pin = d.pin ? String(d.pin).replace(/\D/g, '') : null

  try {
    // Por unidade: o que vende a peso (o quilo do açaí) se cadastra pela
    // ficha, que pergunta a medida.
    const medida = 'UN' as const
    const r = await criarProduto(
      sessao,
      {
        nome: String(d.nome).trim().slice(0, 200),
        categoriaId: d.categoriaId || null,
        medida,
        precoVista: preco,
        custo,
        vendidoEm: [],
      },
      [],
      pin,
    )
    if (!r.ok) return { erro: r.motivo, precisaPin: r.precisaPin }
    revalidatePath(`/${slug}/produtos`)

    if (estoque !== null && estoque > 0 && d.unidadeId) {
      const variacao = await comoOrg(sessao.orgId, (db) =>
        db.variacao.findFirst({ where: { produtoId: r.produtoId }, select: { id: true } }),
      )
      if (variacao) {
        const e = await salvarEstoque(slug, {
          variacaoId: variacao.id,
          unidadeId: d.unidadeId,
          contado: estoque,
          motivo: String(d.motivo ?? '').trim() || 'Estoque inicial',
          visto: 0,
          pin,
        })
        if (e.erro) return { ok: 'Produto cadastrado.', erro: `O produto entrou, mas o estoque não: ${e.erro}`, precisaPin: e.precisaPin, produtoId: r.produtoId }
      }
    }
    return { ok: 'Produto cadastrado.', produtoId: r.produtoId }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode cadastrar produto.' }
    return { erro: recadoDoErro(e, 'Não deu para cadastrar.') }
  }
}
