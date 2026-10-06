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
import { SemPermissao, unidadesQuePodem } from '@/servidor/permissao'
import { lerCusto } from '@/servidor/dinheiro'

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

/** O que uma linha da planilha muda, validado e gravado — sem mexer em cache de página. */
async function gravarLinha(sessao: Awaited<ReturnType<typeof exigirSessao>>, produtoId: string, d: LinhaEditada): Promise<EstadoLinha> {
  const dados: Parameters<typeof editarProduto>[2] = {}
  if (d.nome !== undefined) dados.nome = String(d.nome).slice(0, 200)
  if (d.categoriaId !== undefined) dados.categoriaId = d.categoriaId ? String(d.categoriaId) : null
  // Custo em % do preço ("35%"): a base é o preço que veio na linha, senão o
  // que o produto já tem (ver `lerCusto`).
  if (typeof d.custo === 'string' && /%\s*$/.test(d.custo)) {
    const base =
      numero(d.precoVista) ||
      Number((await comoOrg(sessao.orgId, (db) => db.produto.findUnique({ where: { id: produtoId }, select: { precoVista: true } })))?.precoVista ?? 0)
    const c = lerCusto(d.custo, base)
    if (c && 'erro' in c) return { erro: c.erro }
    d = { ...d, custo: c ? c.valor : null }
  }
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
    return { ok: 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mudar isto (preço e custo pedem permissão própria).' }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
}

/** Grava nome, gaveta e preços de UM produto. Só os campos que vieram mudar. */
export async function salvarLinha(slug: string, produtoId: string, d: LinhaEditada): Promise<EstadoLinha> {
  const sessao = await exigirSessao(slug)
  const r = await gravarLinha(sessao, produtoId, d)
  if (r.ok) revalidatePath(`/${slug}/produtos`)
  return r
}

/**
 * Grava VÁRIAS linhas numa chamada só — o "Salvar" da planilha.
 *
 * Antes o navegador chamava `salvarLinha` uma vez por linha, em fila, e cada
 * chamada recarregava a lista de produtos inteira no servidor (a lista da
 * Donna tem milhares). Com dezenas de linhas, a conta virava minutos, e
 * qualquer queda no meio mostrava a tela de erro com metade já salva. Agora é
 * uma ida ao servidor: cada linha com a sua resposta (a que falhou não leva as
 * outras junto), e a lista recarrega uma vez no fim.
 */
export async function salvarLinhas(
  slug: string,
  linhas: { produtoId: string; dados: LinhaEditada }[],
): Promise<Record<string, EstadoLinha>> {
  const sessao = await exigirSessao(slug)
  const saida: Record<string, EstadoLinha> = {}
  // Um teto: a planilha mostra uma página de cada vez, e este endereço é público.
  for (const l of linhas.slice(0, 300)) {
    saida[String(l.produtoId)] = await gravarLinha(sessao, String(l.produtoId), l.dados ?? {})
  }
  if (Object.values(saida).some((r) => r.ok)) revalidatePath(`/${slug}/produtos`)
  return saida
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
    // Nasce vendido na loja da planilha — a que está escolhida no alto e onde
    // o estoque entra. Antes nascia em TODAS (vazio): o produto cadastrado
    // na contagem da sorveteria aparecia no balcão da loja de roupa. Em
    // outra loja, marca-se na ficha. Depósito não vende: aí vale o alcance de
    // quem cadastra, como na ficha.
    const alcance = unidadesQuePodem(sessao, 'produto.cadastrar')
    const unidadeId = typeof d.unidadeId === 'string' && d.unidadeId ? d.unidadeId : null
    const loja = unidadeId
      ? await comoOrg(sessao.orgId, (db) => db.unidade.findFirst({ where: { id: unidadeId, ativa: true }, select: { id: true, ehDeposito: true } }))
      : null
    const vendidoEm = loja && !loja.ehDeposito ? [loja.id] : alcance === 'todas' ? [] : alcance
    const r = await criarProduto(
      sessao,
      {
        nome: String(d.nome).trim().slice(0, 200),
        categoriaId: d.categoriaId || null,
        medida,
        precoVista: preco,
        custo,
        vendidoEm,
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
