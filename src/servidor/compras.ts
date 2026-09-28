// Compras e fornecedores — e o material que se gasta dentro de casa.
//
// ── o pedido ─────────────────────────────────────────────────
// RASCUNHO (montando) → ENVIADO (o fornecedor já sabe) → PARCIAL (chegou uma
// parte) → RECEBIDO. Ou CANCELADO, enquanto nada chegou. O pedido guarda o
// que se pediu e o custo combinado; o que chegou fica em cada item
// (`recebido`) e em cada recebimento.
//
// ── receber é dar entrada, pelo caminho que já existe ────────
// Não existe um segundo jeito de o estoque subir. Receber chama a MESMA
// entrada de mercadoria da tela de Estoque (`registrarEntradaEm`, em
// entrada.ts): o saldo sobe, o custo do produto passa a ser o desta compra
// (com a mesma trava de `produto.preco`) e, se a pessoa pedir e puder, nasce
// a conta a pagar do fornecedor no Financeiro. Tudo numa transação com o
// pedido: ou a mercadoria entrou E o pedido sabe disso, ou nenhum dos dois.
//
// ── o clique duplo não dá entrada duas vezes ─────────────────
// Cada recebimento leva uma CHAVE sorteada quando a tela abriu. O pedido é
// travado (FOR UPDATE) antes de tudo; a chave que já existe devolve "já
// recebido" sem mexer em nada; e o banco tem um único (pedido, chave) por
// baixo. Receber a mais do que falta também é recusado — o que sobra no
// fornecedor é outra conversa, e outro pedido.
//
// ── consumo interno ──────────────────────────────────────────
// O esmalte que a manicure gastou, a luva da clínica, o algodão: sai do
// estoque como CONSUMO — não é venda (não entra no faturamento) e não é perda
// (não é sumiço). Quem atende anota; o saldo fica certo sem balanço.

import type { SituacaoCompra } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, SemPermissao, unidadesQuePodem, type Sessao } from './permissao'
import { registrarEntradaEm } from './entrada'
import { mexerEstoqueEm } from './estoque'
import { centavos, multiplicar, reais } from './dinheiro'
import { soDigitos } from './cliente'
import { colunaDoDia, diaEmSP } from './dia'
import { vendidoNaLoja } from './catalogo-loja'

export type { SituacaoCompra }

// ─────────────────────────────────────────────────────────────
// PURO
// ─────────────────────────────────────────────────────────────

export const ROTULO_COMPRA: Record<SituacaoCompra, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADO: 'Enviado',
  PARCIAL: 'Chegou em parte',
  RECEBIDO: 'Recebido',
  CANCELADO: 'Cancelado',
}

export const NIVEL_COMPRA: Record<SituacaoCompra, 'bom' | 'atencao' | 'critico' | 'neutro'> = {
  RASCUNHO: 'neutro',
  ENVIADO: 'atencao',
  PARCIAL: 'atencao',
  RECEBIDO: 'bom',
  CANCELADO: 'neutro',
}

/** Um código curto para achar o pedido no estoque e no financeiro. */
export const codigoCompra = (id: string) => `COMP-${id.slice(-6).toUpperCase()}`

/** O que ainda falta chegar de um item. Nunca negativo. */
export const falta = (i: { quantidade: number; recebido: number }) => Math.max(0, Math.round((i.quantidade - i.recebido) * 1000) / 1000)

/** Soma de quantidade × custo, em centavos (o que o pedido vale). */
export function valorDoPedido(itens: { quantidade: number; custoUnit: number | null }[]): number {
  return itens.reduce((s, i) => s + (i.custoUnit != null ? multiplicar(centavos(i.custoUnit), i.quantidade) : 0), 0)
}

/**
 * Confere o que chegou contra o que falta. Devolve as linhas prontas ou a
 * frase do problema. Puro — é onde "receber a mais" morre.
 */
export function conferirRecebimento(
  itens: { id: string; descricao: string; quantidade: number; recebido: number; custoUnit: number | null }[],
  chegou: { itemId: string; quantidade: number; custoUnit?: number | null }[],
): { ok: true; linhas: { itemId: string; quantidade: number; custoUnit: number | null }[] } | { ok: false; erro: string } {
  const porId = new Map(itens.map((i) => [i.id, i]))
  const linhas: { itemId: string; quantidade: number; custoUnit: number | null }[] = []
  const vistos = new Set<string>()
  for (const c of chegou) {
    if (!Number.isFinite(c.quantidade) || c.quantidade < 0) return { ok: false, erro: 'Uma das quantidades não é um número.' }
    if (c.quantidade === 0) continue
    const i = porId.get(c.itemId)
    if (!i) return { ok: false, erro: 'Um dos itens não é deste pedido.' }
    if (vistos.has(c.itemId)) return { ok: false, erro: 'O mesmo item veio duas vezes.' }
    vistos.add(c.itemId)
    if (c.quantidade > falta(i) + 1e-9) {
      return { ok: false, erro: `${i.descricao}: faltava chegar ${falta(i).toLocaleString('pt-BR')}, e foi informado ${c.quantidade.toLocaleString('pt-BR')}.` }
    }
    if (c.custoUnit != null && !(Number.isFinite(c.custoUnit) && c.custoUnit >= 0)) {
      return { ok: false, erro: 'O custo de um item não pode ser negativo.' }
    }
    linhas.push({ itemId: c.itemId, quantidade: c.quantidade, custoUnit: c.custoUnit ?? i.custoUnit })
  }
  if (linhas.length === 0) return { ok: false, erro: 'Informe quanto chegou de pelo menos um item.' }
  return { ok: true, linhas }
}

/** Depois do recebimento: chegou tudo, ou uma parte. */
export function situacaoDepois(itens: { quantidade: number; recebido: number }[]): SituacaoCompra {
  return itens.every((i) => falta(i) <= 0) ? 'RECEBIDO' : 'PARCIAL'
}

const limpar = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// ─────────────────────────────────────────────────────────────
// FORNECEDORES
// ─────────────────────────────────────────────────────────────

export type FornecedorNaLista = { id: string; nome: string; telefone: string | null; documento: string | null; observacao: string | null; ativo: boolean; pedidos: number }

export async function listarFornecedores(sessao: Sessao): Promise<FornecedorNaLista[]> {
  exigir(sessao, 'compra.ver')
  const fs = await comoOrg(sessao.orgId, (db) =>
    db.fornecedor.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      take: 500,
      select: { id: true, nome: true, telefone: true, documento: true, observacao: true, ativo: true, _count: { select: { pedidos: true } } },
    }),
  )
  return fs.map(({ _count, ...f }) => ({ ...f, pedidos: _count.pedidos }))
}

export async function salvarFornecedor(
  sessao: Sessao,
  d: { nome: string; telefone?: string | null; documento?: string | null; observacao?: string | null; ativo?: boolean },
  id?: string,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  exigir(sessao, 'compra.gerir')
  const nome = limpar(d.nome, 120)
  if (nome.length < 2) return { ok: false, erro: 'Escreva o nome do fornecedor.' }
  const telefone = soDigitos(d.telefone ?? '')
  if (telefone && (telefone.length < 10 || telefone.length > 13)) return { ok: false, erro: 'O telefone precisa do DDD.' }
  const documento = soDigitos(d.documento ?? '')
  if (documento && documento.length !== 11 && documento.length !== 14) return { ok: false, erro: 'CPF tem 11 números; CNPJ, 14. Ou deixe em branco.' }
  const dados = {
    nome,
    telefone: telefone || null,
    documento: documento || null,
    observacao: limpar(d.observacao, 500) || null,
    ...(d.ativo !== undefined ? { ativo: d.ativo } : {}),
  }
  return comoOrg(sessao.orgId, async (db) => {
    if (id) {
      const r = await db.fornecedor.updateMany({ where: { id }, data: dados })
      if (r.count === 0) return { ok: false as const, erro: 'Esse fornecedor não existe mais.' }
    }
    const f = id ? { id } : await db.fornecedor.create({ data: { orgId: sessao.orgId, ...dados }, select: { id: true } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: id ? 'fornecedor.alterou' : 'fornecedor.criou', alvoTipo: 'fornecedor', alvoId: f.id, alvoNome: nome,
      },
    })
    return { ok: true as const, id: f.id }
  })
}

// ─────────────────────────────────────────────────────────────
// PEDIDOS — leitura
// ─────────────────────────────────────────────────────────────

export type PedidoNaLista = {
  id: string
  codigo: string
  unidadeId: string
  unidadeNome: string
  fornecedorNome: string | null
  situacao: SituacaoCompra
  itens: number
  /** Valor combinado, em reais. */
  valor: number
  previsto: Date | null
  criadoEm: Date
  quem: string
}

function lojasDaCompra(sessao: Sessao, unidadeIds: string[], cap: 'compra.ver' | 'compra.gerir' = 'compra.ver') {
  const p = unidadesQuePodem(sessao, cap)
  return p === 'todas' ? unidadeIds : unidadeIds.filter((u) => p.includes(u))
}

export async function listarPedidos(
  sessao: Sessao,
  f: { unidadeIds: string[]; situacao?: SituacaoCompra | 'abertos' | 'todos' | null },
): Promise<PedidoNaLista[]> {
  exigir(sessao, 'compra.ver')
  const lojas = lojasDaCompra(sessao, f.unidadeIds)
  if (lojas.length === 0) return []
  const sit = f.situacao ?? 'abertos'
  const ps = await comoOrg(sessao.orgId, (db) =>
    db.pedidoCompra.findMany({
      where: {
        unidadeId: { in: lojas },
        ...(sit === 'abertos' ? { situacao: { in: ['RASCUNHO', 'ENVIADO', 'PARCIAL'] as SituacaoCompra[] } } : sit === 'todos' ? {} : { situacao: sit }),
      },
      orderBy: { criadoEm: 'desc' },
      take: 300,
      select: {
        id: true, unidadeId: true, situacao: true, previsto: true, criadoEm: true, quem: true,
        unidade: { select: { nome: true } },
        fornecedor: { select: { nome: true } },
        itens: { select: { quantidade: true, custoUnit: true } },
      },
    }),
  )
  return ps.map((p) => ({
    id: p.id,
    codigo: codigoCompra(p.id),
    unidadeId: p.unidadeId,
    unidadeNome: p.unidade.nome,
    fornecedorNome: p.fornecedor?.nome ?? null,
    situacao: p.situacao,
    itens: p.itens.length,
    valor: reais(valorDoPedido(p.itens.map((i) => ({ quantidade: Number(i.quantidade), custoUnit: i.custoUnit == null ? null : Number(i.custoUnit) })))),
    previsto: p.previsto,
    criadoEm: p.criadoEm,
    quem: p.quem,
  }))
}

export type ItemDoPedido = {
  id: string
  variacaoId: string
  descricao: string
  medida: string
  quantidade: number
  recebido: number
  custoUnit: number | null
}

export type PedidoCompleto = PedidoNaLista & {
  fornecedorId: string | null
  observacao: string | null
  motivoCancelamento: string | null
  itensLista: ItemDoPedido[]
  recebimentos: { id: string; criadoEm: Date; quem: string; total: number; contaLancada: boolean; itens: number }[]
}

export async function acharPedido(sessao: Sessao, id: string): Promise<PedidoCompleto | null> {
  exigir(sessao, 'compra.ver')
  const p = await comoOrg(sessao.orgId, (db) =>
    db.pedidoCompra.findUnique({
      where: { id },
      select: {
        id: true, unidadeId: true, situacao: true, previsto: true, criadoEm: true, quem: true, fornecedorId: true,
        observacao: true, motivoCancelamento: true,
        unidade: { select: { nome: true } },
        fornecedor: { select: { nome: true } },
        itens: {
          orderBy: { descricao: 'asc' },
          select: { id: true, variacaoId: true, descricao: true, quantidade: true, recebido: true, custoUnit: true, variacao: { select: { produto: { select: { medida: true } } } } },
        },
        recebimentos: { orderBy: { criadoEm: 'desc' }, select: { id: true, criadoEm: true, quem: true, total: true, contaLancada: true, itens: true } },
      },
    }),
  )
  if (!p || !pode(sessao, 'compra.ver', p.unidadeId)) return null
  const itensLista = p.itens.map((i) => ({
    id: i.id,
    variacaoId: i.variacaoId,
    descricao: i.descricao,
    medida: i.variacao.produto.medida,
    quantidade: Number(i.quantidade),
    recebido: Number(i.recebido),
    custoUnit: i.custoUnit == null ? null : Number(i.custoUnit),
  }))
  return {
    id: p.id,
    codigo: codigoCompra(p.id),
    unidadeId: p.unidadeId,
    unidadeNome: p.unidade.nome,
    fornecedorId: p.fornecedorId,
    fornecedorNome: p.fornecedor?.nome ?? null,
    situacao: p.situacao,
    itens: itensLista.length,
    valor: reais(valorDoPedido(itensLista)),
    previsto: p.previsto,
    criadoEm: p.criadoEm,
    quem: p.quem,
    observacao: p.observacao,
    motivoCancelamento: p.motivoCancelamento,
    itensLista,
    recebimentos: p.recebimentos.map((r) => ({
      id: r.id,
      criadoEm: r.criadoEm,
      quem: r.quem,
      total: Number(r.total),
      contaLancada: r.contaLancada,
      itens: Array.isArray(r.itens) ? r.itens.length : 0,
    })),
  }
}

export type ItemParaComprar = { variacaoId: string; descricao: string; codigo: string | null; medida: string; custo: number | null; saldo: number }

/**
 * O que dá para pôr num pedido: mercadoria desta loja (ou qualquer uma, se a
 * loja é depósito) — serviço não se compra de fornecedor.
 */
export async function buscarParaComprar(sessao: Sessao, unidadeId: string, termo: string): Promise<ItemParaComprar[]> {
  exigir(sessao, 'compra.gerir', unidadeId)
  return buscarMaterial(sessao, unidadeId, termo)
}

async function buscarMaterial(sessao: Sessao, unidadeId: string, termo: string): Promise<ItemParaComprar[]> {
  const t = termo.trim().slice(0, 60)
  if (t.length < 2) return []
  const vs = await comoOrg(sessao.orgId, (db) =>
    db.variacao.findMany({
      where: {
        ativa: true,
        produto: { ativo: true, servico: false },
        OR: [
          { codigo: { equals: t, mode: 'insensitive' } },
          { codigoBarras: t },
          { produto: { nome: { contains: t, mode: 'insensitive' } } },
        ],
      },
      take: 12,
      orderBy: { produto: { nome: 'asc' } },
      select: {
        id: true, codigo: true,
        produto: { select: { nome: true, medida: true, custo: true, vendidoEm: true } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
        estoques: { where: { unidadeId }, select: { quantidade: true } },
      },
    }),
  )
  return vs.map((v) => ({
    variacaoId: v.id,
    descricao: v.opcoes.length ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}` : v.produto.nome,
    codigo: v.codigo,
    medida: v.produto.medida,
    custo: v.produto.custo == null ? null : Number(v.produto.custo),
    saldo: Number(v.estoques[0]?.quantidade ?? 0),
  }))
}

// ─────────────────────────────────────────────────────────────
// PEDIDOS — escrita
// ─────────────────────────────────────────────────────────────

export type NovoPedido = {
  unidadeId: string
  fornecedorId?: string | null
  observacao?: string | null
  /** 'AAAA-MM-DD' */
  previsto?: string | null
  itens: { variacaoId: string; quantidade: number; custoUnit?: number | null }[]
}

export type ResultadoPedido = { ok: true; id: string } | { ok: false; erro: string }

/** Confere e fotografa os itens de um pedido — dentro da transação. */
async function itensConferidos(db: BancoDaOrg, unidadeId: string, ehDeposito: boolean, itens: NovoPedido['itens']) {
  const limpos = itens.filter((i) => i.quantidade > 0)
  if (limpos.length === 0) return { erro: 'Ponha pelo menos um item com quantidade.' } as const
  if (limpos.some((i) => !Number.isFinite(i.quantidade) || i.quantidade > 1_000_000)) return { erro: 'Uma das quantidades não confere.' } as const
  if (limpos.some((i) => i.custoUnit != null && !(Number.isFinite(i.custoUnit) && i.custoUnit >= 0))) return { erro: 'O custo não pode ser negativo.' } as const
  if (new Set(limpos.map((i) => i.variacaoId)).size !== limpos.length) return { erro: 'O mesmo item aparece duas vezes. Some as quantidades numa linha só.' } as const
  const vs = await db.variacao.findMany({
    where: { id: { in: limpos.map((i) => i.variacaoId) } },
    select: {
      id: true,
      produto: { select: { nome: true, servico: true, custo: true, vendidoEm: true } },
      opcoes: { select: { opcao: { select: { valor: true } } } },
    },
  })
  const porId = new Map(vs.map((v) => [v.id, v]))
  const linhas = []
  for (const i of limpos) {
    const v = porId.get(i.variacaoId)
    if (!v) return { erro: 'Um dos itens não existe nesta empresa.' } as const
    if (v.produto.servico) return { erro: `${v.produto.nome} é serviço: não se compra de fornecedor.` } as const
    if (!ehDeposito && !vendidoNaLoja(v.produto.vendidoEm, unidadeId)) {
      return { erro: `${v.produto.nome} não é desta loja. Marque a loja na ficha do produto, ou peça para um depósito.` } as const
    }
    linhas.push({
      variacaoId: v.id,
      descricao: (v.opcoes.length ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}` : v.produto.nome).slice(0, 200),
      quantidade: i.quantidade,
      custoUnit: i.custoUnit != null ? reais(centavos(i.custoUnit)) : v.produto.custo != null ? Number(v.produto.custo) : null,
    })
  }
  return { linhas } as const
}

export async function criarPedido(sessao: Sessao, d: NovoPedido): Promise<ResultadoPedido> {
  exigir(sessao, 'compra.gerir', d.unidadeId || undefined)
  if (!d.unidadeId) return { ok: false, erro: 'Escolha a loja onde a mercadoria entra.' }
  const previsto = d.previsto && /^\d{4}-\d{2}-\d{2}$/.test(d.previsto) ? colunaDoDia(d.previsto) : null
  return comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findFirst({ where: { id: d.unidadeId, ativa: true }, select: { ehDeposito: true } })
    if (!loja) return { ok: false as const, erro: 'Essa loja não existe ou está fechada.' }
    if (d.fornecedorId) {
      const f = await db.fornecedor.findUnique({ where: { id: d.fornecedorId }, select: { id: true } })
      if (!f) return { ok: false as const, erro: 'Esse fornecedor não foi encontrado.' }
    }
    const c = await itensConferidos(db, d.unidadeId, loja.ehDeposito, d.itens)
    if ('erro' in c) return { ok: false as const, erro: c.erro! }
    const p = await db.pedidoCompra.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: d.unidadeId,
        fornecedorId: d.fornecedorId || null,
        observacao: limpar(d.observacao, 500) || null,
        previsto,
        quem: sessao.nome,
        quemId: sessao.usuarioId,
        itens: { create: c.linhas.map((l) => ({ orgId: sessao.orgId, ...l })) },
      },
      select: { id: true },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: d.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'compra.criou', alvoTipo: 'compra', alvoId: p.id, alvoNome: codigoCompra(p.id),
        valor: reais(valorDoPedido(c.linhas)), depois: { itens: c.linhas.length },
      },
    })
    return { ok: true as const, id: p.id }
  })
}

/** Lê o pedido travado e confere quem pode — o começo de toda mudança. */
async function pedidoTravado(db: BancoDaOrg, sessao: Sessao, id: string) {
  const [trava] = await db.$queryRaw<{ id: string }[]>`select id from pedidos_compra where id = ${id} for update`
  if (!trava) return null
  const p = await db.pedidoCompra.findUnique({
    where: { id },
    select: {
      id: true, unidadeId: true, situacao: true,
      fornecedor: { select: { nome: true } },
      itens: { select: { id: true, variacaoId: true, descricao: true, quantidade: true, recebido: true, custoUnit: true } },
    },
  })
  if (!p) return null
  if (!pode(sessao, 'compra.gerir', p.unidadeId)) throw new SemPermissao('compra.gerir', p.unidadeId)
  return p
}

/** Troca os itens de um pedido que ainda é rascunho. */
export async function salvarItensDoPedido(sessao: Sessao, id: string, itens: NovoPedido['itens']): Promise<ResultadoPedido> {
  exigir(sessao, 'compra.gerir')
  return comoOrg(sessao.orgId, async (db) => {
    const p = await pedidoTravado(db, sessao, id)
    if (!p) return { ok: false as const, erro: 'Esse pedido não existe mais.' }
    if (p.situacao !== 'RASCUNHO') return { ok: false as const, erro: 'Só o rascunho muda de itens. Depois de mandado, o pedido é o que o fornecedor recebeu.' }
    const loja = await db.unidade.findUnique({ where: { id: p.unidadeId }, select: { ehDeposito: true } })
    const c = await itensConferidos(db, p.unidadeId, !!loja?.ehDeposito, itens)
    if ('erro' in c) return { ok: false as const, erro: c.erro! }
    await db.itemCompra.deleteMany({ where: { pedidoId: id } })
    await db.itemCompra.createMany({ data: c.linhas.map((l) => ({ orgId: sessao.orgId, pedidoId: id, ...l })) })
    return { ok: true as const, id }
  })
}

/** Rascunho → enviado: o fornecedor já recebeu o pedido. */
export async function enviarPedido(sessao: Sessao, id: string, agora = new Date()): Promise<ResultadoPedido> {
  exigir(sessao, 'compra.gerir')
  return comoOrg(sessao.orgId, async (db) => {
    const p = await pedidoTravado(db, sessao, id)
    if (!p) return { ok: false as const, erro: 'Esse pedido não existe mais.' }
    if (p.situacao !== 'RASCUNHO') return { ok: false as const, erro: 'Este pedido já foi mandado.' }
    if (p.itens.length === 0) return { ok: false as const, erro: 'O pedido está vazio.' }
    await db.pedidoCompra.update({ where: { id }, data: { situacao: 'ENVIADO', enviadoEm: agora } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: p.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'compra.enviou', alvoTipo: 'compra', alvoId: id, alvoNome: codigoCompra(id),
      },
    })
    return { ok: true as const, id }
  })
}

/** Cancela o que ainda não chegou. O que chegou em parte se ENCERRA, não se cancela. */
export async function cancelarPedido(sessao: Sessao, id: string, motivoBruto: string, agora = new Date()): Promise<ResultadoPedido> {
  exigir(sessao, 'compra.gerir')
  const motivo = limpar(motivoBruto, 300)
  if (motivo.length < 3) return { ok: false, erro: 'Escreva o motivo do cancelamento.' }
  return comoOrg(sessao.orgId, async (db) => {
    const p = await pedidoTravado(db, sessao, id)
    if (!p) return { ok: false as const, erro: 'Esse pedido não existe mais.' }
    if (p.situacao !== 'RASCUNHO' && p.situacao !== 'ENVIADO') {
      return {
        ok: false as const,
        erro: p.situacao === 'PARCIAL' ? 'Parte deste pedido já chegou e entrou no estoque. Use "Dar por encerrado".' : 'Este pedido já foi concluído.',
      }
    }
    await db.pedidoCompra.update({ where: { id }, data: { situacao: 'CANCELADO', canceladoEm: agora, motivoCancelamento: motivo } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: p.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'compra.cancelou', alvoTipo: 'compra', alvoId: id, alvoNome: codigoCompra(id), motivo,
      },
    })
    return { ok: true as const, id }
  })
}

/** O que chegou em parte e não vai chegar o resto: fecha como recebido. */
export async function encerrarPedido(sessao: Sessao, id: string, agora = new Date()): Promise<ResultadoPedido> {
  exigir(sessao, 'compra.gerir')
  return comoOrg(sessao.orgId, async (db) => {
    const p = await pedidoTravado(db, sessao, id)
    if (!p) return { ok: false as const, erro: 'Esse pedido não existe mais.' }
    if (p.situacao !== 'PARCIAL') return { ok: false as const, erro: 'Só o pedido que chegou em parte se encerra.' }
    await db.pedidoCompra.update({ where: { id }, data: { situacao: 'RECEBIDO', recebidoEm: agora } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: p.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'compra.encerrou', alvoTipo: 'compra', alvoId: id, alvoNome: codigoCompra(id),
      },
    })
    return { ok: true as const, id }
  })
}

export type Recebimento = {
  /** Sorteada quando a tela abriu. O mesmo envio repetido não dá entrada de novo. */
  chave: string
  itens: { itemId: string; quantidade: number; custoUnit?: number | null }[]
  /** A conta a pagar do fornecedor, no Financeiro (se a pessoa puder lançar). */
  conta?: { categoriaId: string; vencimento: Date; jaPago: boolean } | null
}

export type ResultadoRecebimento =
  | { ok: true; repetido: boolean; situacao: SituacaoCompra; total: number; contaLancada: boolean; custosAtualizados: number; naoFeito: string[] }
  | { ok: false; erro: string }

/** A entrada falhou lá dentro: desfaz a transação inteira, com a frase. */
class EntradaRecusada extends Error {
  constructor(readonly frase: string) {
    super(frase)
    this.name = 'EntradaRecusada'
  }
}

/**
 * Recebe o que chegou: dá entrada no estoque (pela entrada de mercadoria de
 * sempre), sobe o `recebido` de cada item e anda o pedido — tudo numa
 * transação, e uma vez só por chave.
 */
export async function receberPedido(sessao: Sessao, id: string, r: Recebimento, agora = new Date()): Promise<ResultadoRecebimento> {
  exigir(sessao, 'compra.gerir')
  const chave = limpar(r.chave, 64)
  if (chave.length < 8) return { ok: false, erro: 'Recarregue a tela e receba de novo.' }
  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const p = await pedidoTravado(db, sessao, id)
      if (!p) return { ok: false as const, erro: 'Esse pedido não existe mais.' }

      // Já recebido com esta chave: é o clique duplo. Nada muda.
      const ja = await db.recebimentoCompra.findUnique({ where: { pedidoId_chave: { pedidoId: id, chave } }, select: { total: true, contaLancada: true } })
      if (ja) {
        return { ok: true as const, repetido: true, situacao: p.situacao, total: Number(ja.total), contaLancada: ja.contaLancada, custosAtualizados: 0, naoFeito: [] }
      }
      if (p.situacao === 'CANCELADO' || p.situacao === 'RECEBIDO') {
        return { ok: false as const, erro: `Este pedido já está ${ROTULO_COMPRA[p.situacao].toLowerCase()}.` }
      }
      if (!pode(sessao, 'estoque.ajustar', p.unidadeId)) throw new SemPermissao('estoque.ajustar', p.unidadeId)

      const itens = p.itens.map((i) => ({
        id: i.id,
        variacaoId: i.variacaoId,
        descricao: i.descricao,
        quantidade: Number(i.quantidade),
        recebido: Number(i.recebido),
        custoUnit: i.custoUnit == null ? null : Number(i.custoUnit),
      }))
      const c = conferirRecebimento(itens, r.itens)
      if (!c.ok) return { ok: false as const, erro: c.erro }
      const porId = new Map(itens.map((i) => [i.id, i]))

      // A chave primeiro: o único (pedido, chave) é a última palavra.
      const rec = await db.recebimentoCompra.create({
        data: {
          orgId: sessao.orgId,
          pedidoId: id,
          chave,
          itens: c.linhas,
          quem: sessao.nome,
          quemId: sessao.usuarioId,
        },
        select: { id: true },
      })

      const entrada = await registrarEntradaEm(db, sessao, {
        unidadeId: p.unidadeId,
        fornecedor: p.fornecedor?.nome ?? undefined,
        documento: codigoCompra(id),
        itens: c.linhas.map((l) => ({ variacaoId: porId.get(l.itemId)!.variacaoId, quantidade: l.quantidade, custoUnit: l.custoUnit })),
        conta: r.conta ?? undefined,
      })
      if (!entrada.ok) throw new EntradaRecusada(entrada.motivo)

      for (const l of c.linhas) {
        await db.itemCompra.update({
          where: { id: l.itemId },
          data: { recebido: { increment: l.quantidade }, ...(l.custoUnit != null ? { custoUnit: reais(centavos(l.custoUnit)) } : {}) },
        })
      }
      const depois = itens.map((i) => ({ ...i, recebido: i.recebido + (c.linhas.find((l) => l.itemId === i.id)?.quantidade ?? 0) }))
      const situacao = situacaoDepois(depois)
      await db.pedidoCompra.update({
        where: { id },
        data: { situacao, ...(situacao === 'RECEBIDO' ? { recebidoEm: agora } : {}), ...(p.situacao === 'RASCUNHO' ? { enviadoEm: agora } : {}) },
      })
      await db.recebimentoCompra.update({ where: { id: rec.id }, data: { total: entrada.total, contaLancada: entrada.contaLancada } })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId, unidadeId: p.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
          acao: 'compra.recebeu', alvoTipo: 'compra', alvoId: id, alvoNome: codigoCompra(id),
          valor: entrada.total > 0 ? entrada.total : null,
          depois: { situacao, itens: c.linhas.length, contaLancada: entrada.contaLancada },
        },
      })
      return {
        ok: true as const,
        repetido: false,
        situacao,
        total: entrada.total,
        contaLancada: entrada.contaLancada,
        custosAtualizados: entrada.custosAtualizados,
        naoFeito: entrada.naoFeito,
      }
    })
  } catch (e) {
    if (e instanceof EntradaRecusada) return { ok: false, erro: e.frase }
    // Duas abas com a MESMA chave ao mesmo tempo: a segunda bate no único.
    const x = e as { code?: unknown } | null
    if (x?.code === 'P2002') return { ok: false, erro: 'Este recebimento já foi registrado. Recarregue a tela.' }
    throw e
  }
}

// ─────────────────────────────────────────────────────────────
// CONSUMO INTERNO
// ─────────────────────────────────────────────────────────────

/** Material para anotar o que foi usado: o que esta loja tem. */
export async function buscarParaConsumo(sessao: Sessao, unidadeId: string, termo: string): Promise<ItemParaComprar[]> {
  exigir(sessao, 'estoque.consumir', unidadeId)
  const l = await buscarMaterial(sessao, unidadeId, termo)
  // Custo é da compra, e quem só anota o consumo não o vê.
  return pode(sessao, 'compra.ver', unidadeId) ? l : l.map((i) => ({ ...i, custo: null }))
}

export type ResultadoConsumo = { ok: true; itens: number } | { ok: false; erro: string }

/** A quantidade não saiu porque não havia saldo: desfaz tudo, dizendo qual. */
class SemSaldoParaConsumo extends Error {
  constructor(readonly frase: string) {
    super(frase)
    this.name = 'SemSaldoParaConsumo'
  }
}

/**
 * Anota o material usado: sai do estoque como CONSUMO, item a item, numa
 * transação. Sem saldo em um, nenhum sai — e a frase diz qual.
 */
export async function registrarConsumo(
  sessao: Sessao,
  d: { unidadeId: string; itens: { variacaoId: string; quantidade: number }[]; motivo?: string | null },
): Promise<ResultadoConsumo> {
  exigir(sessao, 'estoque.consumir', d.unidadeId || undefined)
  if (!d.unidadeId) return { ok: false, erro: 'Escolha a loja.' }
  const itens = d.itens.filter((i) => i.quantidade > 0)
  if (itens.length === 0) return { ok: false, erro: 'Ponha pelo menos um item com quantidade.' }
  if (itens.some((i) => !Number.isFinite(i.quantidade) || i.quantidade > 100_000)) return { ok: false, erro: 'Uma das quantidades não confere.' }
  const motivo = limpar(d.motivo, 200) || 'Consumo interno'
  try {
    return await comoOrg(sessao.orgId, async (db) => {
      const loja = await db.unidade.findFirst({ where: { id: d.unidadeId, ativa: true }, select: { nome: true } })
      if (!loja) return { ok: false as const, erro: 'Essa loja não existe ou está fechada.' }
      const vs = await db.variacao.findMany({
        where: { id: { in: itens.map((i) => i.variacaoId) } },
        select: { id: true, produto: { select: { nome: true, servico: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } },
      })
      const porId = new Map(vs.map((v) => [v.id, v]))
      for (const i of itens) {
        const v = porId.get(i.variacaoId)
        if (!v) return { ok: false as const, erro: 'Um dos itens não existe nesta empresa.' }
        if (v.produto.servico) return { ok: false as const, erro: `${v.produto.nome} é serviço: não tem estoque para gastar.` }
        const r = await mexerEstoqueEm(db, sessao, {
          variacaoId: i.variacaoId,
          unidadeId: d.unidadeId,
          tipo: 'CONSUMO',
          quantidade: i.quantidade,
          motivo,
        })
        if (!r.ok) {
          const nome = v.opcoes.length ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}` : v.produto.nome
          throw new SemSaldoParaConsumo(`${nome}: o estoque de ${loja.nome} tem ${r.saldo.toLocaleString('pt-BR')}. Nada foi anotado — confira a quantidade ou dê entrada antes.`)
        }
      }
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId, unidadeId: d.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
          acao: 'estoque.consumo', alvoTipo: 'consumo', alvoNome: motivo,
          depois: { itens: itens.length, dia: diaEmSP() },
        },
      })
      return { ok: true as const, itens: itens.length }
    })
  } catch (e) {
    if (e instanceof SemSaldoParaConsumo) return { ok: false, erro: e.frase }
    throw e
  }
}

export type ConsumoNaLista = { id: string; criadoEm: Date; descricao: string; quantidade: number; medida: string; motivo: string | null; quem: string; unidade: string }

/** O que foi anotado como consumo nos últimos dias, nas lojas visíveis. */
export async function consumosRecentes(sessao: Sessao, unidadeIds: string[], dias = 30): Promise<ConsumoNaLista[]> {
  const lojas = unidadeIds.filter((u) => pode(sessao, 'estoque.ver', u) || pode(sessao, 'estoque.consumir', u))
  if (lojas.length === 0) return []
  const ms = await comoOrg(sessao.orgId, (db) =>
    db.movimentoEstoque.findMany({
      where: { tipo: 'CONSUMO', unidadeId: { in: lojas }, criadoEm: { gte: new Date(Date.now() - dias * 86_400_000) } },
      orderBy: { criadoEm: 'desc' },
      take: 100,
      select: {
        id: true, criadoEm: true, quantidade: true, motivo: true, quem: true,
        unidade: { select: { nome: true } },
        variacao: { select: { produto: { select: { nome: true, medida: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } } },
      },
    }),
  )
  return ms.map((m) => ({
    id: m.id,
    criadoEm: m.criadoEm,
    descricao: m.variacao.opcoes.length ? `${m.variacao.produto.nome} — ${m.variacao.opcoes.map((o) => o.opcao.valor).join(' · ')}` : m.variacao.produto.nome,
    quantidade: Math.abs(Number(m.quantidade)),
    medida: m.variacao.produto.medida,
    motivo: m.motivo,
    quem: m.quem,
    unidade: m.unidade.nome,
  }))
}

/** As categorias de despesa, para a conta a pagar do recebimento. */
export async function categoriasDeDespesa(sessao: Sessao) {
  if (!pode(sessao, 'financeiro.lancar')) return []
  return comoOrg(sessao.orgId, (db) =>
    db.categoriaFinanceira.findMany({ where: { tipo: 'DESPESA', ativa: true }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true } }),
  )
}
