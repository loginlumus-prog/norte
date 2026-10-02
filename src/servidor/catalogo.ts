// O CATÁLOGO DA LOJA: o link que a loja manda para a cliente.
//
// Cada loja (unidade) tem o seu — com o estoque DELA, porque a sorveteria do
// bairro A e a do bairro B não têm os mesmos sabores no freezer. A cliente abre
// o link no celular, navega por categoria, monta o pedido e manda. O pedido
// entra no Norte como ENCOMENDA (origem CATALOGO), com os itens, e a loja vê
// em Encomendas — e o assistente avisa a equipe no WhatsApp.
//
// O que este arquivo garante:
//
// • A página é PÚBLICA, e por isso não confia em nada que vem dela. O preço
//   de cada item é lido aqui, do cadastro — o navegador manda só "qual" e
//   "quanto". Produto que a loja não vende, inativo, material de uso, sem
//   preço ou esgotado não entra.
// • O que sai para fora é só o que um cartaz na vitrine mostraria: nome,
//   foto, preço, se tem. Custo, saldo exato, fornecedor e qualquer dado de
//   cliente nunca saem.
// • Abuso tem freio: por aparelho (IP resumido, nunca guardado cru), por
//   telefone e por loja, contando as próprias encomendas do catálogo. E o
//   formulário leva o carimbo assinado do cadastro (robô que posta direto
//   não tem).
// • O pagamento é COMBINADO, não cobrado: a cliente diz como vai pagar, e a
//   loja recebe na entrega/retirada pelo balcão, como qualquer encomenda.
//
// Ver também: encomenda.ts (o que a loja faz com o pedido), venda.ts (receber
// no balcão: os itens viram linhas de verdade e baixam o estoque).

import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { FormaPagamento, Prisma } from '@prisma/client'
import { acharOrgPorSlug, comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { soDigitos } from './cliente'
import { moduloLigado } from './modulos'
import { planoLibera } from './planos'
import { aVendaNaLoja, alcancaOProduto } from './catalogo-loja'
import { pedeInteiro } from './devolucao'
import { codigoEncomenda } from './encomenda'

// ─────────────────────────────────────────────────────────────
// REGRAS PURAS (testadas sem banco)
// ─────────────────────────────────────────────────────────────

/** O pedaço do link: letras, números e hífen, de 2 a 40. */
export const ENDERECO = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** "Itinga (SESI)" → "itinga-sesi". */
export function sugerirEndereco(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'loja'
  )
}

/** WhatsApp da loja: só dígitos, com DDI. "(71) 99999-0000" vira "5571999990000". */
export function limparWhatsapp(t: string | null | undefined): string | null {
  const d = soDigitos(t ?? '')
  if (!d) return null
  const comDdi = d.length === 10 || d.length === 11 ? `55${d}` : d
  return comDdi.length >= 12 && comDdi.length <= 13 ? comDdi : null
}

/** Telefone da cliente: celular brasileiro com DDD, só dígitos, sem o 55. */
export function limparTelefone(t: string): string | null {
  let d = soDigitos(t)
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  return d.length === 10 || d.length === 11 ? d : null
}

export const FORMAS_DO_CATALOGO: { forma: FormaPagamento; rotulo: string }[] = [
  { forma: 'PIX', rotulo: 'Pix' },
  { forma: 'DINHEIRO', rotulo: 'Dinheiro' },
  { forma: 'DEBITO', rotulo: 'Cartão de débito' },
  { forma: 'CREDITO', rotulo: 'Cartão de crédito' },
]

/** As palavras da situação, para a cliente (acompanhar) e para a loja. */
export function situacaoParaCliente(e: { situacao: string; vistaEm: Date | null; entrega: boolean }): {
  passo: 0 | 1 | 2 | 3
  titulo: string
  texto: string
  cancelado: boolean
} {
  if (e.situacao === 'CANCELADA') {
    return { passo: 0, titulo: 'Pedido cancelado', texto: 'A loja cancelou este pedido. Fale com ela pelo WhatsApp se tiver dúvida.', cancelado: true }
  }
  if (e.situacao === 'ENTREGUE') {
    return { passo: 3, titulo: e.entrega ? 'Entregue' : 'Retirado', texto: 'Pedido concluído. Obrigado pela preferência!', cancelado: false }
  }
  if (e.situacao === 'PRONTA') {
    return {
      passo: 2,
      titulo: e.entrega ? 'Saiu para entrega' : 'Pronto para retirar',
      texto: e.entrega ? 'Seu pedido está a caminho.' : 'Pode vir buscar: seu pedido está separado.',
      cancelado: false,
    }
  }
  if (e.vistaEm) return { passo: 1, titulo: 'Pedido aceito', texto: 'A loja recebeu e já está preparando.', cancelado: false }
  return { passo: 0, titulo: 'Pedido enviado', texto: 'Esperando a loja confirmar.', cancelado: false }
}

export type ItemPedido = { variacaoId: string; quantidade: number; observacao?: string | null }

export type PedidoDoCatalogo = {
  nome: string
  telefone: string
  entrega: boolean
  endereco?: string | null
  /** ISO; vazio = o quanto antes. */
  para?: string | null
  forma: FormaPagamento
  /** "Troco para R$ 50" — só com dinheiro. */
  trocoPara?: number | null
  observacao?: string | null
  itens: ItemPedido[]
}

const CONTROLE = /[\u0000-\u001f\u007f]/
const MAX_ITENS = 60
const MAX_QTD = 999

/** Confere o que a cliente mandou, antes de olhar o banco. Puro. */
export function conferirPedido(
  p: PedidoDoCatalogo,
  agora = new Date(),
): { ok: true; limpo: PedidoDoCatalogo & { telefone: string; paraData: Date | null } } | { ok: false; erro: string } {
  const nome = (p.nome ?? '').trim().replace(/\s+/g, ' ')
  if (nome.length < 2 || nome.length > 80 || CONTROLE.test(nome)) return { ok: false, erro: 'Diga o seu nome.' }
  const telefone = limparTelefone(p.telefone ?? '')
  if (!telefone) return { ok: false, erro: 'Confira o seu WhatsApp, com DDD: (71) 99999-0000.' }
  if (!FORMAS_DO_CATALOGO.some((f) => f.forma === p.forma)) return { ok: false, erro: 'Escolha como vai pagar.' }
  const endereco = (p.endereco ?? '').trim()
  if (p.entrega && (endereco.length < 8 || endereco.length > 300 || CONTROLE.test(endereco))) {
    return { ok: false, erro: 'Para entrega, diga o endereço completo: rua, número e bairro.' }
  }
  const observacao = (p.observacao ?? '').trim()
  if (observacao.length > 500) return { ok: false, erro: 'A observação ficou longa demais (até 500 letras).' }
  if (!Array.isArray(p.itens) || p.itens.length === 0) return { ok: false, erro: 'O pedido está vazio.' }
  if (p.itens.length > MAX_ITENS) return { ok: false, erro: `No máximo ${MAX_ITENS} itens diferentes por pedido.` }
  const juntos = new Map<string, ItemPedido>()
  for (const i of p.itens) {
    if (typeof i?.variacaoId !== 'string' || !/^[\w-]{1,64}$/.test(i.variacaoId)) return { ok: false, erro: 'Um item do pedido não é válido.' }
    const q = Number(i.quantidade)
    if (!Number.isFinite(q) || q <= 0 || q > MAX_QTD) return { ok: false, erro: 'Confira as quantidades.' }
    const obs = (i.observacao ?? '').trim().slice(0, 200) || null
    const ja = juntos.get(i.variacaoId)
    juntos.set(i.variacaoId, { variacaoId: i.variacaoId, quantidade: Math.round(((ja?.quantidade ?? 0) + q) * 1000) / 1000, observacao: obs ?? ja?.observacao ?? null })
  }
  // Conferido DEPOIS de juntar: a quantidade grava com 3 casas (0,0004 kg
  // virava um item de zero, a R$ 0), e o teto vale para o item, não para cada
  // linha mandada — 999 + 999 do mesmo picolé passava como 1998.
  for (const i of juntos.values()) {
    if (i.quantidade <= 0 || i.quantidade > MAX_QTD) return { ok: false, erro: 'Confira as quantidades.' }
  }
  let paraData: Date | null = null
  if (p.para) {
    const d = new Date(p.para)
    if (Number.isNaN(d.getTime())) return { ok: false, erro: 'Confira o dia e a hora.' }
    if (d.getTime() < agora.getTime() - 10 * 60_000) return { ok: false, erro: 'Esse horário já passou. Escolha outro.' }
    if (d.getTime() > agora.getTime() + 60 * 864e5) return { ok: false, erro: 'Dá para pedir com até 60 dias de antecedência.' }
    paraData = d
  }
  const trocoPara = p.forma === 'DINHEIRO' && p.trocoPara && Number(p.trocoPara) > 0 ? Math.min(Number(p.trocoPara), 100_000) : null
  return {
    ok: true,
    limpo: {
      ...p,
      nome,
      telefone,
      endereco: p.entrega ? endereco : null,
      observacao: observacao || null,
      trocoPara,
      itens: [...juntos.values()],
      paraData,
    },
  }
}

/** "2× Picolé de morango, 1× Pote 1 L" — a descrição da encomenda. */
export function resumoDosItens(itens: { descricao: string; quantidade: number }[], max = 280): string {
  const t = itens.map((i) => `${qtdEmTexto(i.quantidade)}× ${i.descricao}`).join(', ')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function qtdEmTexto(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** O texto que a cliente manda para a loja pelo WhatsApp depois de pedir. */
export function mensagemDoPedido(p: {
  codigo: string
  nome: string
  itens: { descricao: string; quantidade: number; totalC: number }[]
  totalC: number
  taxaC: number
  entrega: boolean
  endereco: string | null
  forma: string
  link: string
}): string {
  const linhas = [
    `Olá! Fiz o pedido ${p.codigo} pelo catálogo.`,
    '',
    ...p.itens.map((i) => `${qtdEmTexto(i.quantidade)}× ${i.descricao} — ${brl(i.totalC)}`),
    ...(p.taxaC > 0 ? [`Entrega — ${brl(p.taxaC)}`] : []),
    `*Total: ${brl(p.totalC)}*`,
    '',
    p.entrega ? `Entregar em: ${p.endereco}` : 'Vou retirar na loja.',
    `Pagamento: ${p.forma}`,
    `Nome: ${p.nome}`,
    '',
    `Acompanhar: ${p.link}`,
  ]
  return linhas.join('\n')
}

// ─────────────────────────────────────────────────────────────
// O QUE A TELA DE CONFIGURAR LÊ E GRAVA (com sessão)
// ─────────────────────────────────────────────────────────────

export type CatalogoDaLoja = {
  unidadeId: string
  lojaNome: string
  existe: boolean
  ativo: boolean
  endereco: string
  whatsapp: string | null
  recado: string | null
  retirada: boolean
  entrega: boolean
  taxaEntrega: number | null
  pedidoMinimo: number | null
  chavePix: string | null
  mostrarEsgotado: boolean
  /** Pedidos do catálogo nos últimos 30 dias, para a tela mostrar que funciona. */
  pedidos30d: number
  /** Quantos produtos a cliente vê agora no link desta loja (com foto ou sem). */
  aparecendo: number
  /** Os que aparecem SEM foto — com o ícone e o "Pedir foto" no lugar dela. */
  semFoto: FotosQueFaltam
}

export type ProdutoSemFoto = {
  id: string
  nome: string
  preco: number
  /** Saldo somado das opções NESTA loja; nulo quando a loja não conta o estoque dele. */
  estoque: number | null
}

export type FotosQueFaltam = { total: number; produtos: ProdutoSemFoto[]; mais: boolean }

const SEM_FOTO_POR_PAGINA = 30

/** As lojas que podem ter catálogo (depósito e fábrica não vendem). */
export async function listarCatalogos(sessao: Sessao): Promise<{ lojas: CatalogoDaLoja[]; encomendaLigada: boolean }> {
  exigir(sessao, 'venda.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { plano: true, modulos: true, telefone: true } })
    const unidades = await db.unidade.findMany({
      where: { ativa: true, ehDeposito: false, ehFabrica: false },
      orderBy: { criadaEm: 'asc' },
      select: { id: true, nome: true, telefone: true, catalogo: true },
    })
    const desde = new Date(Date.now() - 30 * 864e5)
    const contagem = await db.encomenda.groupBy({
      by: ['unidadeId'],
      where: { origem: 'CATALOGO', criadaEm: { gte: desde } },
      _count: { _all: true },
    })
    const porLoja = new Map(contagem.map((c) => [c.unidadeId, c._count._all]))
    const usados = new Set(unidades.map((u) => u.catalogo?.endereco).filter(Boolean))
    const vendeSemEstoque = (await db.org.findUnique({ where: { id: sessao.orgId }, select: { vendeSemEstoque: true } }))?.vendeSemEstoque ?? false
    // Uma loja por vez: dentro de comoOrg nada corre em paralelo.
    const vitrines = new Map<string, { aparecendo: number; semFoto: FotosQueFaltam }>()
    for (const u of unidades) {
      if (!pode(sessao, 'venda.ver', u.id)) continue
      const esgotadoAparece = u.catalogo?.mostrarEsgotado ?? false
      const aparecendo = await db.produto.count({
        where: { AND: [filtroDaVitrine(u.id), esgotadoAparece ? {} : filtroDisponivel(u.id, vendeSemEstoque)] },
      })
      vitrines.set(u.id, { aparecendo, semFoto: await lerFotosQueFaltam(db, u.id, esgotadoAparece, vendeSemEstoque, 0) })
    }
    const lojas = unidades
      .filter((u) => pode(sessao, 'venda.ver', u.id))
      .map((u): CatalogoDaLoja => {
        const c = u.catalogo
        let sugestao = sugerirEndereco(u.nome)
        for (let n = 2; !c && usados.has(sugestao); n++) sugestao = `${sugerirEndereco(u.nome).slice(0, 36)}-${n}`
        if (!c) usados.add(sugestao)
        return {
          unidadeId: u.id,
          lojaNome: u.nome,
          existe: !!c,
          ativo: c?.ativo ?? false,
          endereco: c?.endereco ?? sugestao,
          whatsapp: c?.whatsapp ?? limparWhatsapp(u.telefone ?? org?.telefone ?? null),
          recado: c?.recado ?? null,
          retirada: c?.retirada ?? true,
          entrega: c?.entrega ?? false,
          taxaEntrega: c?.taxaEntrega != null ? Number(c.taxaEntrega) : null,
          pedidoMinimo: c?.pedidoMinimo != null ? Number(c.pedidoMinimo) : null,
          chavePix: c?.chavePix ?? null,
          mostrarEsgotado: c?.mostrarEsgotado ?? false,
          pedidos30d: porLoja.get(u.id) ?? 0,
          aparecendo: vitrines.get(u.id)?.aparecendo ?? 0,
          semFoto: vitrines.get(u.id)?.semFoto ?? { total: 0, produtos: [], mais: false },
        }
      })
    return { lojas, encomendaLigada: !!org && moduloLigado(org, 'encomenda') }
  })
}

/**
 * Os produtos que aparecem no catálogo desta loja SEM foto (com o ícone no
 * lugar): a lista que a tela mostra com o botão de tirar a foto ali mesmo.
 * Mesma régua da vitrine (ativo, vendido aqui, com preço, e — se a loja
 * esconde o esgotado — com estoque), para a conta bater com o link.
 */
async function lerFotosQueFaltam(
  db: BancoDaOrg,
  unidadeId: string,
  esgotadoAparece: boolean,
  vendeSemEstoque: boolean,
  pular: number,
): Promise<FotosQueFaltam> {
  const where: Prisma.ProdutoWhereInput = {
    AND: [filtroDaVitrine(unidadeId), { fotoId: null }, esgotadoAparece ? {} : filtroDisponivel(unidadeId, vendeSemEstoque)],
  }
  const total = await db.produto.count({ where })
  const lidos = await db.produto.findMany({
    where,
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    skip: pular,
    take: SEM_FOTO_POR_PAGINA,
    select: { id: true, nome: true, precoVista: true },
  })
  // O saldo à parte (lista aninhada na mesma consulta corre em paralelo na
  // conexão da transação).
  const saldos = lidos.length
    ? await db.estoque.findMany({
        where: { unidadeId, variacao: { ativa: true, produtoId: { in: lidos.map((p) => p.id) } } },
        select: { quantidade: true, variacao: { select: { produtoId: true } } },
      })
    : []
  const estoque = new Map<string, number>()
  for (const s of saldos) estoque.set(s.variacao.produtoId, (estoque.get(s.variacao.produtoId) ?? 0) + Number(s.quantidade))
  return {
    total,
    produtos: lidos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.precoVista ?? 0), estoque: estoque.has(p.id) ? Math.round(estoque.get(p.id)! * 1000) / 1000 : null })),
    mais: pular + lidos.length < total,
  }
}

/** A próxima página da lista "sem foto" de uma loja (o "mostrar mais" da tela). */
export async function fotosQueFaltam(sessao: Sessao, unidadeId: string, pular: number): Promise<FotosQueFaltam> {
  exigir(sessao, 'venda.ver', unidadeId)
  const p = Math.max(0, Math.min(Math.floor(Number(pular) || 0), 50_000))
  return comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findFirst({ where: { id: unidadeId, ativa: true }, select: { catalogo: { select: { mostrarEsgotado: true } } } })
    if (!loja) return { total: 0, produtos: [], mais: false }
    const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { vendeSemEstoque: true } })
    return lerFotosQueFaltam(db, unidadeId, loja.catalogo?.mostrarEsgotado ?? false, org?.vendeSemEstoque ?? false, p)
  })
}

export type DadosCatalogo = {
  ativo: boolean
  endereco: string
  whatsapp: string | null
  recado: string | null
  retirada: boolean
  entrega: boolean
  taxaEntrega: number | null
  pedidoMinimo: number | null
  chavePix: string | null
  mostrarEsgotado: boolean
}

export async function salvarCatalogo(
  sessao: Sessao,
  unidadeId: string,
  d: DadosCatalogo,
): Promise<{ ok: true; endereco: string } | { ok: false; erro: string }> {
  exigir(sessao, 'empresa.configurar')
  const endereco = (d.endereco ?? '').trim().toLowerCase()
  if (!ENDERECO.test(endereco)) return { ok: false, erro: 'O endereço do link usa só letras sem acento, números e hífen (ex.: centro, loja-2).' }
  const whatsapp = d.whatsapp ? limparWhatsapp(d.whatsapp) : null
  if (d.whatsapp && !whatsapp) return { ok: false, erro: 'Confira o WhatsApp da loja, com DDD: (71) 99999-0000.' }
  if (d.ativo && !whatsapp) return { ok: false, erro: 'Para abrir o catálogo, diga o WhatsApp da loja: é para onde os pedidos vão.' }
  if (!d.retirada && !d.entrega) return { ok: false, erro: 'Escolha pelo menos um jeito de a cliente receber: retirada ou entrega.' }
  const recado = (d.recado ?? '').trim().slice(0, 200) || null
  const chavePix = (d.chavePix ?? '').trim().slice(0, 120) || null
  const dinheiro = (v: number | null) => (v != null && Number.isFinite(v) && v > 0 ? Math.min(v, 100_000) : null)

  return comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findFirst({ where: { id: unidadeId, ativa: true }, select: { id: true, nome: true, ehDeposito: true, ehFabrica: true } })
    if (!loja || loja.ehDeposito || loja.ehFabrica) return { ok: false as const, erro: 'Essa loja não vende ao público.' }
    const outro = await db.catalogoLoja.findFirst({ where: { endereco, NOT: { unidadeId } }, select: { id: true } })
    if (outro) return { ok: false as const, erro: 'Outra loja da empresa já usa esse endereço. Escolha outro.' }

    // Abrir o catálogo liga as encomendas: é para lá que os pedidos vão.
    if (d.ativo) {
      const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { plano: true, modulos: true } })
      if (!org || !planoLibera(org.plano, 'encomenda')) {
        return { ok: false as const, erro: 'O plano desta empresa não tem encomendas, e o catálogo precisa delas.' }
      }
      if (!moduloLigado(org, 'encomenda')) {
        await db.org.update({ where: { id: sessao.orgId }, data: { modulos: [...org.modulos, 'encomenda'] } })
      }
    }

    const dados = {
      ativo: d.ativo,
      endereco,
      whatsapp,
      recado,
      retirada: d.retirada,
      entrega: d.entrega,
      taxaEntrega: d.entrega ? dinheiro(d.taxaEntrega) : null,
      pedidoMinimo: dinheiro(d.pedidoMinimo),
      chavePix,
      mostrarEsgotado: d.mostrarEsgotado,
    }
    const antes = await db.catalogoLoja.findUnique({ where: { unidadeId } })
    await db.catalogoLoja.upsert({
      where: { unidadeId },
      create: { orgId: sessao.orgId, unidadeId, ...dados },
      update: dados,
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: antes?.ativo !== d.ativo ? (d.ativo ? 'catalogo.abriu' : 'catalogo.fechou') : 'catalogo.ajustou',
        alvoTipo: 'catalogo',
        alvoId: unidadeId,
        alvoNome: loja.nome,
        depois: { ...dados, taxaEntrega: dados.taxaEntrega, pedidoMinimo: dados.pedidoMinimo } as Prisma.InputJsonValue,
      },
    })
    return { ok: true as const, endereco }
  })
}

// ─────────────────────────────────────────────────────────────
// A FOTO DO PRODUTO
// ─────────────────────────────────────────────────────────────

/** A foto já chega reduzida do aparelho; isto é o teto de quem burlar a tela. */
export const FOTO_MAX_BYTES = 1_500_000

/** O tipo pelo começo do arquivo — nunca pelo que o navegador diz. */
export function tipoDaImagem(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

/**
 * Quem pode mexer na foto deste produto: quem edita produto em TODAS as lojas
 * em que ele é vendido (a mesma régua da ficha — `alcancaOProduto`). A foto
 * aparece no catálogo de cada uma dessas lojas; o gerente de uma loja só não
 * troca a vitrine da loja vizinha.
 */
function alcancaAFoto(sessao: Sessao, vendidoEm: readonly string[]): boolean {
  return alcancaOProduto(unidadesQuePodem(sessao, 'produto.editar'), vendidoEm)
}

const FORA_DO_ALCANCE = 'Este produto também é vendido em loja que você não alcança. Quem responde por todas elas troca a foto.'

export async function guardarFotoDoProduto(
  sessao: Sessao,
  produtoId: string,
  bytes: Uint8Array,
): Promise<{ ok: true; fotoId: string } | { ok: false; erro: string }> {
  exigir(sessao, 'produto.editar')
  if (bytes.length === 0 || bytes.length > FOTO_MAX_BYTES) return { ok: false, erro: 'A foto ficou grande demais. Tente outra.' }
  const mime = tipoDaImagem(bytes)
  if (!mime) return { ok: false, erro: 'Esse arquivo não é uma foto (JPG, PNG ou WebP).' }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return comoOrg(sessao.orgId, async (db) => {
    const produto = await db.produto.findUnique({ where: { id: produtoId }, select: { id: true, nome: true, fotoId: true, vendidoEm: true } })
    if (!produto) return { ok: false as const, erro: 'Esse produto não existe.' }
    if (!alcancaAFoto(sessao, produto.vendidoEm)) return { ok: false as const, erro: FORA_DO_ALCANCE }
    const midia = await db.midia.upsert({
      where: { orgId_sha256: { orgId: sessao.orgId, sha256 } },
      create: { orgId: sessao.orgId, nome: `foto-${produtoId}`, mime, tipo: 'imagem', tamanho: bytes.length, sha256, dados: Buffer.from(bytes) },
      update: {},
      select: { id: true },
    })
    await db.produto.update({ where: { id: produtoId }, data: { fotoId: midia.id } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'produto.foto',
        alvoTipo: 'produto',
        alvoId: produtoId,
        alvoNome: produto.nome,
      },
    })
    return { ok: true as const, fotoId: midia.id }
  })
}

export async function tirarFotoDoProduto(sessao: Sessao, produtoId: string): Promise<{ ok: boolean; erro?: string }> {
  exigir(sessao, 'produto.editar')
  return comoOrg(sessao.orgId, async (db) => {
    const produto = await db.produto.findUnique({ where: { id: produtoId }, select: { nome: true, fotoId: true, vendidoEm: true } })
    if (!produto) return { ok: false }
    if (!alcancaAFoto(sessao, produto.vendidoEm)) return { ok: false, erro: FORA_DO_ALCANCE }
    const r = await db.produto.updateMany({ where: { id: produtoId }, data: { fotoId: null } })
    // Tirar a foto também vai para o livro: a vitrine de todas as lojas muda.
    if (r.count > 0 && produto.fotoId) {
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'produto.foto',
          alvoTipo: 'produto',
          alvoId: produtoId,
          alvoNome: produto.nome,
          motivo: 'foto retirada',
        },
      })
    }
    return { ok: r.count > 0 }
  })
}

/**
 * A foto para a página pública. Só sai a mídia que é FOTO DE PRODUTO desta
 * empresa — a mídia das campanhas (áudio, vídeo) não vaza por este caminho.
 */
export async function lerFotoPublica(slug: string, id: string): Promise<{ mime: string; dados: Uint8Array } | null> {
  if (!/^[\w-]{1,64}$/.test(id)) return null
  const org = await acharOrgPorSlug(slug)
  // A mesma régua da vitrine: empresa fora do ar não mostra nada, e a foto do
  // produto desativado (ou de material de uso) não sai pelo link público.
  if (!org || !SITUACOES_NO_AR.has(org.situacao)) return null
  return comoOrg(org.id, async (db) => {
    const usada = await db.produto.findFirst({ where: { fotoId: id, ativo: true, usoInterno: false }, select: { id: true } })
    if (!usada) return null
    const m = await db.midia.findUnique({ where: { id }, select: { mime: true, dados: true } })
    return m ? { mime: m.mime, dados: new Uint8Array(m.dados) } : null
  })
}

export const fotoUrl = (slug: string, fotoId: string | null | undefined) => (fotoId ? `/${slug}/foto/${fotoId}` : null)

// ─────────────────────────────────────────────────────────────
// A PÁGINA PÚBLICA
// ─────────────────────────────────────────────────────────────

const SITUACOES_NO_AR = new Set(['TESTE', 'ATIVA', 'INADIMPLENTE'])

export type OpcaoNoCatalogo = {
  variacaoId: string
  /** "P · Azul"; vazio quando o produto não tem grade. */
  rotulo: string
  preco: number
  disponivel: boolean
}

export type ProdutoNoCatalogo = {
  id: string
  nome: string
  descricao: string | null
  categoriaId: string | null
  medida: string
  foto: string | null
  /** O menor preço entre as opções: "a partir de". */
  preco: number
  variavel: boolean
  disponivel: boolean
  opcoes: OpcaoNoCatalogo[]
}

export type VitrinePublica = {
  empresa: { nome: string; slug: string; logoUrl: string | null; corMarca: string | null }
  loja: {
    nome: string
    endereco: string | null
    horario: string | null
    whatsapp: string | null
    recado: string | null
    retirada: boolean
    entrega: boolean
    taxaEntrega: number | null
    pedidoMinimo: number | null
  }
  endereco: string
  categorias: { id: string; nome: string; total: number }[]
}

type Aberto = { orgId: string; empresa: VitrinePublica['empresa']; catalogo: { id: string; unidadeId: string; mostrarEsgotado: boolean; chavePix: string | null; whatsapp: string | null; retirada: boolean; entrega: boolean; taxaEntrega: number | null; pedidoMinimo: number | null; recado: string | null } }

/** A empresa e o catálogo do link, se estiverem no ar. */
async function abrir(slug: string, endereco: string): Promise<Aberto | null> {
  if (!ENDERECO.test(endereco)) return null
  const org = await acharOrgPorSlug(slug)
  if (!org || !SITUACOES_NO_AR.has(org.situacao)) return null
  const c = await comoOrg(org.id, (db) =>
    db.catalogoLoja.findFirst({
      // Depósito e fábrica não vendem ao público: o catálogo ligado de antes
      // (a loja que virou depósito) não abre nem recebe pedido.
      where: { endereco, ativo: true, unidade: { ativa: true, ehDeposito: false, ehFabrica: false } },
      select: { id: true, unidadeId: true, mostrarEsgotado: true, chavePix: true, whatsapp: true, retirada: true, entrega: true, taxaEntrega: true, pedidoMinimo: true, recado: true },
    }),
  )
  if (!c) return null
  return {
    orgId: org.id,
    empresa: { nome: org.nome, slug: org.slug, logoUrl: org.logoUrl, corMarca: org.corMarca },
    catalogo: { ...c, taxaEntrega: c.taxaEntrega != null ? Number(c.taxaEntrega) : null, pedidoMinimo: c.pedidoMinimo != null ? Number(c.pedidoMinimo) : null },
  }
}

/** O que o catálogo mostra: produto ativo, vendido nesta loja, que não é material de uso, com preço. */
function filtroDaVitrine(unidadeId: string, extra: Prisma.ProdutoWhereInput = {}): Prisma.ProdutoWhereInput {
  return {
    ativo: true,
    ...aVendaNaLoja(unidadeId),
    precoVista: { gt: 0 },
    variacoes: { some: { ativa: true } },
    ...extra,
  }
}

/**
 * O pedaço de `where` de "tem para vender", a mesma régua de
 * `disponivelNoCatalogo` no banco: serviço, feito no dia ou alguma opção ativa
 * sem saldo lançado nesta loja ou com saldo positivo. Serve para CONTAR (a
 * vitrine pública decide item a item, com `montarProduto`).
 */
function filtroDisponivel(unidadeId: string, vendeSemEstoque: boolean): Prisma.ProdutoWhereInput {
  if (vendeSemEstoque) return {}
  return {
    OR: [
      { servico: true },
      { feitoNoDia: true },
      {
        variacoes: {
          some: {
            ativa: true,
            OR: [{ estoques: { none: { unidadeId } } }, { estoques: { some: { unidadeId, quantidade: { gt: 0 } } } }],
          },
        },
      },
    ],
  }
}

const SELECAO_PRODUTO = (unidadeId: string) =>
  ({
    id: true,
    nome: true,
    descricao: true,
    categoriaId: true,
    medida: true,
    fotoId: true,
    precoVista: true,
    servico: true,
    feitoNoDia: true,
    variacoes: {
      where: { ativa: true },
      orderBy: [{ padrao: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        ajustePreco: true,
        opcoes: { select: { opcao: { select: { valor: true, ordem: true, eixo: { select: { ordem: true } } } } } },
        estoques: { where: { unidadeId }, select: { quantidade: true } },
      },
    },
  }) satisfies Prisma.ProdutoSelect

type ProdutoLido = Prisma.ProdutoGetPayload<{ select: ReturnType<typeof SELECAO_PRODUTO> }>

/**
 * Tem para vender? Com estoque lançado, só se o saldo é positivo. Sem linha
 * de estoque (a loja ainda não controla), serviço, feito no dia ou a empresa
 * que vende sem estoque: tem — o catálogo não esconde o que a loja não conta.
 */
export function disponivelNoCatalogo(
  p: { servico: boolean; feitoNoDia: boolean },
  estoques: { quantidade: { toString(): string } }[],
  vendeSemEstoque: boolean,
): boolean {
  if (p.servico || p.feitoNoDia || vendeSemEstoque) return true
  if (estoques.length === 0) return true
  return Number(estoques[0]!.quantidade) > 0
}

function montarProduto(slug: string, p: ProdutoLido, vendeSemEstoque: boolean): ProdutoNoCatalogo {
  const base = Number(p.precoVista ?? 0)
  const opcoes = p.variacoes.map((v): OpcaoNoCatalogo => {
    const rotulo = [...v.opcoes]
      .sort((a, b) => (a.opcao.eixo?.ordem ?? 0) - (b.opcao.eixo?.ordem ?? 0) || a.opcao.ordem - b.opcao.ordem)
      .map((o) => o.opcao.valor)
      .join(' · ')
    return {
      variacaoId: v.id,
      rotulo,
      preco: Math.round((base + Number(v.ajustePreco ?? 0)) * 100) / 100,
      disponivel: disponivelNoCatalogo(p, v.estoques, vendeSemEstoque),
    }
  })
  const comPreco = opcoes.filter((o) => o.preco > 0)
  const disponiveis = comPreco.filter((o) => o.disponivel)
  const precos = (disponiveis.length ? disponiveis : comPreco).map((o) => o.preco)
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    categoriaId: p.categoriaId,
    medida: p.medida,
    foto: fotoUrl(slug, p.fotoId),
    preco: precos.length ? Math.min(...precos) : base,
    variavel: new Set(precos).size > 1,
    disponivel: disponiveis.length > 0,
    opcoes: comPreco,
  }
}

export async function lerVitrinePublica(slug: string, endereco: string): Promise<VitrinePublica | null> {
  const a = await abrir(slug, endereco)
  if (!a) return null
  return comoOrg(a.orgId, async (db) => {
    const u = await db.unidade.findUnique({
      where: { id: a.catalogo.unidadeId },
      select: { nome: true, apelido: true, endereco: true, numero: true, bairro: true, cidade: true, horario: true },
    })
    const porCategoria = await db.produto.groupBy({
      by: ['categoriaId'],
      where: filtroDaVitrine(a.catalogo.unidadeId),
      _count: { _all: true },
    })
    const ids = porCategoria.map((c) => c.categoriaId).filter((x): x is string => !!x)
    const nomes = ids.length
      ? await db.categoria.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, ordem: true } })
      : []
    const total = new Map(porCategoria.map((c) => [c.categoriaId, c._count._all]))
    const categorias = nomes
      .sort((x, y) => x.ordem - y.ordem || x.nome.localeCompare(y.nome, 'pt-BR'))
      .map((c) => ({ id: c.id, nome: c.nome, total: total.get(c.id) ?? 0 }))
    const semCategoria = total.get(null) ?? 0
    if (semCategoria > 0 && categorias.length > 0) categorias.push({ id: 'outros', nome: 'Outros', total: semCategoria })
    const endTexto = u ? [u.endereco && `${u.endereco}${u.numero ? `, ${u.numero}` : ''}`, u.bairro, u.cidade].filter(Boolean).join(' — ') : ''
    return {
      empresa: a.empresa,
      loja: {
        nome: u?.apelido || u?.nome || '',
        endereco: endTexto || null,
        horario: u?.horario ?? null,
        whatsapp: a.catalogo.whatsapp,
        recado: a.catalogo.recado,
        retirada: a.catalogo.retirada,
        entrega: a.catalogo.entrega,
        taxaEntrega: a.catalogo.taxaEntrega,
        pedidoMinimo: a.catalogo.pedidoMinimo,
      },
      endereco,
      categorias,
    }
  })
}

const POR_PAGINA = 40

/** Uma página de produtos: por categoria, por busca, ou tudo. */
export async function produtosDoCatalogo(
  slug: string,
  endereco: string,
  filtro: { categoriaId?: string | null; busca?: string | null; pular?: number },
): Promise<{ produtos: ProdutoNoCatalogo[]; mais: boolean; proximo: number } | null> {
  const a = await abrir(slug, endereco)
  if (!a) return null
  const pular = Math.max(0, Math.min(Math.floor(filtro.pular ?? 0), 20_000))
  const busca = (filtro.busca ?? '').trim().slice(0, 60)
  const categoria = filtro.categoriaId && /^[\w-]{1,64}$/.test(filtro.categoriaId) ? filtro.categoriaId : null
  return comoOrg(a.orgId, async (db) => {
    const org = await db.org.findUnique({ where: { id: a.orgId }, select: { vendeSemEstoque: true } })
    const extra: Prisma.ProdutoWhereInput = {}
    if (categoria === 'outros') extra.categoriaId = null
    else if (categoria) extra.categoriaId = categoria
    if (busca.length >= 2) {
      extra.AND = busca.split(/\s+/).slice(0, 5).map((w) => ({ nome: { contains: w, mode: 'insensitive' as const } }))
    }
    const lidos = await db.produto.findMany({
      where: filtroDaVitrine(a.catalogo.unidadeId, extra),
      orderBy: [{ categoria: { ordem: 'asc' } }, { nome: 'asc' }],
      skip: pular,
      take: POR_PAGINA * 2,
      select: SELECAO_PRODUTO(a.catalogo.unidadeId),
    })
    let produtos = lidos.map((p) => montarProduto(slug, p, org?.vendeSemEstoque ?? false))
    if (!a.catalogo.mostrarEsgotado) produtos = produtos.filter((p) => p.disponivel)
    // Leu o dobro para a página não sair vazia quando muita coisa está
    // esgotada; o "mais" segue pelo que foi LIDO, não pelo que sobrou.
    const pagina = produtos.slice(0, POR_PAGINA)
    const lidosUsados = pagina.length < produtos.length ? lidos.findIndex((p) => p.id === pagina.at(-1)?.id) + 1 : lidos.length
    return { produtos: pagina, mais: lidos.length === POR_PAGINA * 2 || lidosUsados < lidos.length, proximo: pular + lidosUsados }
  })
}

// ─────────────────────────────────────────────────────────────
// O PEDIDO
// ─────────────────────────────────────────────────────────────

/** O IP vira um resumo que não volta a ser IP — só serve para contar. */
export function resumirIp(ip: string | null): string | null {
  if (!ip) return null
  const s = process.env.SEGREDO_SESSAO ?? ''
  return createHmac('sha256', s).update(`ip.${ip}`).digest('base64url').slice(0, 32)
}

export const FREIO = { porAparelhoHora: 6, porTelefoneHora: 6, porLojaHora: 300 }

export type PedidoFeito =
  | {
      ok: true
      codigo: string
      acompanhamento: string
      totalC: number
      whatsapp: string | null
      mensagem: string
    }
  | { ok: false; erro: string; mudou?: boolean }

/**
 * A cliente pediu. Tudo numa transação: lê os preços, confere o que acabou,
 * grava a encomenda com os itens e o livro. O aviso para a equipe sai DEPOIS
 * (quem chama dispara), porque WhatsApp lento não pode segurar o pedido.
 */
export async function fazerPedidoPeloCatalogo(
  slug: string,
  endereco: string,
  p: PedidoDoCatalogo,
  ip: string | null,
  base: string,
  agora = new Date(),
): Promise<PedidoFeito & { encomendaId?: string; orgId?: string }> {
  const a = await abrir(slug, endereco)
  if (!a) return { ok: false, erro: 'Este catálogo não está mais no ar.' }
  const v = conferirPedido(p, agora)
  if (!v.ok) return v
  const d = v.limpo
  if (d.entrega && !a.catalogo.entrega) return { ok: false, erro: 'Esta loja não faz entrega. Escolha retirar.' }
  if (!d.entrega && !a.catalogo.retirada) return { ok: false, erro: 'Esta loja só faz entrega.' }
  const ipResumo = resumirIp(ip)

  return comoOrg(a.orgId, async (db: BancoDaOrg) => {
    const org = await db.org.findUnique({ where: { id: a.orgId }, select: { plano: true, modulos: true, vendeSemEstoque: true } })
    if (!org || !moduloLigado(org, 'encomenda') || !planoLibera(org.plano, 'encomenda')) {
      return { ok: false as const, erro: 'Esta loja não está recebendo pedidos pelo catálogo agora.' }
    }

    // ── o freio ──
    // Contar e gravar na mesma transação não basta: dez pedidos mandados no
    // mesmo instante contavam os dez "zero na última hora" e passavam todos.
    // A trava (por aparelho e por telefone, sempre nessa ordem) faz o segundo
    // esperar o primeiro gravar — e já contá-lo.
    if (ipResumo) await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`catalogo-freio:${a.orgId}:ip:${ipResumo}`}))`
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`catalogo-freio:${a.orgId}:tel:${d.telefone}`}))`
    const umaHora = new Date(agora.getTime() - 3600_000)
    if (ipResumo) {
      const doAparelho = await db.encomenda.count({ where: { origem: 'CATALOGO', ipResumo, criadaEm: { gte: umaHora } } })
      if (doAparelho >= FREIO.porAparelhoHora) return { ok: false as const, erro: 'Muitos pedidos deste aparelho em pouco tempo. Fale com a loja pelo WhatsApp.' }
    }
    const doTelefone = await db.encomenda.count({ where: { origem: 'CATALOGO', telefone: d.telefone, criadaEm: { gte: umaHora } } })
    if (doTelefone >= FREIO.porTelefoneHora) return { ok: false as const, erro: 'Muitos pedidos deste telefone em pouco tempo. Fale com a loja pelo WhatsApp.' }
    const daLoja = await db.encomenda.count({ where: { origem: 'CATALOGO', unidadeId: a.catalogo.unidadeId, criadaEm: { gte: umaHora } } })
    if (daLoja >= FREIO.porLojaHora) return { ok: false as const, erro: 'A loja está com muitos pedidos agora. Tente daqui a pouco ou fale pelo WhatsApp.' }

    // ── os preços, daqui ──
    const variacoes = await db.variacao.findMany({
      where: { id: { in: d.itens.map((i) => i.variacaoId) }, ativa: true, produto: filtroDaVitrine(a.catalogo.unidadeId) },
      select: {
        id: true,
        ajustePreco: true,
        opcoes: { select: { opcao: { select: { valor: true, ordem: true, eixo: { select: { ordem: true } } } } } },
        produto: { select: { nome: true, medida: true, precoVista: true, servico: true, feitoNoDia: true } },
      },
    })
    // O saldo numa leitura à parte: com duas listas aninhadas na mesma
    // consulta (opções e estoques), o Prisma lê as duas em paralelo na
    // conexão da transação — o mesmo problema do Promise.all em comoOrg.
    const saldos = await db.estoque.findMany({
      where: { unidadeId: a.catalogo.unidadeId, variacaoId: { in: variacoes.map((x) => x.id) } },
      select: { variacaoId: true, quantidade: true },
    })
    const porId = new Map(variacoes.map((x) => [x.id, { ...x, estoques: saldos.filter((e) => e.variacaoId === x.id) }]))
    const itens: { variacaoId: string; descricao: string; quantidade: number; precoC: number; totalC: number; observacao: string | null }[] = []
    const fora: string[] = []
    for (const i of d.itens) {
      const x = porId.get(i.variacaoId)
      if (!x) {
        fora.push('um item')
        continue
      }
      const rotulo = [...x.opcoes]
        .sort((m, n) => (m.opcao.eixo?.ordem ?? 0) - (n.opcao.eixo?.ordem ?? 0) || m.opcao.ordem - n.opcao.ordem)
        .map((o) => o.opcao.valor)
        .join(' · ')
      const descricao = rotulo ? `${x.produto.nome} — ${rotulo}` : x.produto.nome
      if (!disponivelNoCatalogo(x.produto, x.estoques, org.vendeSemEstoque)) {
        fora.push(descricao)
        continue
      }
      // Peça, par e caixa não se pedem em fração: o balcão recusa "1,5 caixa"
      // (ver `pedeInteiro`), e o pedido aceito no link ficava sem como sair.
      // Recusa aqui, com o nome, em vez de arredondar escondido.
      const quantidade = i.quantidade
      if (pedeInteiro(x.produto.medida) && !Number.isInteger(quantidade)) {
        return { ok: false as const, erro: `${descricao} vai em número inteiro. Confira a quantidade.` }
      }
      // A loja que não vende sem estoque não aceita pedido de mais do que tem:
      // 50 potes com 1 na prateleira viravam um pedido "aceito" de R$ 1.500
      // que o balcão nunca conseguiria entregar. Sem reservar — o saldo é o
      // de agora, e dois pedidos do último ainda podem disputá-lo no balcão.
      if (!org.vendeSemEstoque && !x.produto.servico && !x.produto.feitoNoDia && x.estoques.length > 0) {
        const tem = Number(x.estoques[0]!.quantidade)
        if (quantidade > tem) {
          return {
            ok: false as const,
            mudou: true,
            erro: tem > 0
              ? `Só há ${qtdEmTexto(tem)} de ${descricao} agora. Diminua a quantidade e mande de novo.`
              : `${descricao} acabou. Tire do pedido e mande de novo.`,
          }
        }
      }
      const precoC = centavos(Number(x.produto.precoVista ?? 0) + Number(x.ajustePreco ?? 0))
      if (precoC <= 0) {
        fora.push(descricao)
        continue
      }
      itens.push({ variacaoId: x.id, descricao, quantidade, precoC, totalC: Math.round(precoC * quantidade), observacao: i.observacao ?? null })
    }
    if (fora.length > 0) {
      return {
        ok: false as const,
        mudou: true,
        erro: `${fora.length === 1 ? 'Um item acabou' : 'Alguns itens acabaram'} ou saiu do catálogo enquanto você escolhia${fora.some((f) => f !== 'um item') ? `: ${fora.filter((f) => f !== 'um item').join(', ')}` : ''}. Tire do pedido e mande de novo.`,
      }
    }
    const subtotalC = itens.reduce((s, i) => s + i.totalC, 0)
    const minimoC = a.catalogo.pedidoMinimo ? centavos(a.catalogo.pedidoMinimo) : 0
    if (subtotalC < minimoC) return { ok: false as const, erro: `O pedido mínimo desta loja é ${brl(minimoC)}.` }
    const taxaC = d.entrega && a.catalogo.taxaEntrega ? centavos(a.catalogo.taxaEntrega) : 0
    const totalC = subtotalC + taxaC

    const acompanhamento = randomBytes(16).toString('base64url')
    const forma = FORMAS_DO_CATALOGO.find((f) => f.forma === d.forma)!.rotulo
    const obs = [
      d.paraData ? null : 'Pediu para o quanto antes.',
      d.trocoPara ? `Troco para ${brl(centavos(d.trocoPara))}.` : null,
      ...itens.filter((i) => i.observacao).map((i) => `${i.descricao}: ${i.observacao}`),
      d.observacao,
    ]
      .filter(Boolean)
      .join('\n')
    const criada = await db.encomenda.create({
      data: {
        orgId: a.orgId,
        unidadeId: a.catalogo.unidadeId,
        clienteNome: d.nome,
        telefone: d.telefone,
        descricao: resumoDosItens(itens.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade }))),
        valor: reais(totalC),
        // "O quanto antes" ganha meia hora: com a hora de agora, o pedido já
        // nascia "atrasado" na tela de Encomendas.
        para: d.paraData ?? new Date(agora.getTime() + 30 * 60_000),
        entrega: d.entrega,
        endereco: d.endereco,
        observacao: obs || null,
        origem: 'CATALOGO',
        acompanhamento,
        formaCombinada: d.forma,
        taxaEntrega: taxaC > 0 ? reais(taxaC) : null,
        ipResumo,
        quem: 'Catálogo',
      },
      select: { id: true },
    })
    // Em separado, e não aninhado no create: aninhado, o Prisma manda as
    // inserções em paralelo na mesma conexão da transação (ver memória do
    // projeto sobre Promise.all em comoOrg).
    await db.encomendaItem.createMany({
      data: itens.map((i) => ({
        orgId: a.orgId,
        encomendaId: criada.id,
        variacaoId: i.variacaoId,
        descricao: i.descricao,
        quantidade: i.quantidade,
        precoUnit: reais(i.precoC),
        total: reais(i.totalC),
        observacao: i.observacao,
      })),
    })
    await db.auditoria.create({
      data: {
        orgId: a.orgId,
        unidadeId: a.catalogo.unidadeId,
        quem: 'Catálogo',
        acao: 'encomenda.pelo_catalogo',
        alvoTipo: 'encomenda',
        alvoId: criada.id,
        alvoNome: codigoEncomenda(criada.id),
        valor: reais(totalC),
        // Sem nome nem telefone no livro: a encomenda já guarda, e o livro é
        // lido por mais gente.
        depois: { itens: itens.length, entrega: d.entrega, forma: d.forma },
      },
    })
    const codigo = codigoEncomenda(criada.id)
    const link = `${base}/${slug}/pedido/${acompanhamento}`
    return {
      ok: true as const,
      encomendaId: criada.id,
      orgId: a.orgId,
      codigo,
      acompanhamento,
      totalC,
      whatsapp: a.catalogo.whatsapp,
      mensagem: mensagemDoPedido({
        codigo,
        nome: d.nome,
        itens: itens.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade, totalC: i.totalC })),
        totalC,
        taxaC,
        entrega: d.entrega,
        endereco: d.endereco ?? null,
        forma,
        link,
      }),
    }
  })
}

// ─────────────────────────────────────────────────────────────
// ACOMPANHAR
// ─────────────────────────────────────────────────────────────

export type PedidoAcompanhado = {
  empresa: VitrinePublica['empresa']
  loja: { nome: string; whatsapp: string | null; catalogo: string | null }
  codigo: string
  criadoEm: string
  para: string
  entrega: boolean
  endereco: string | null
  primeiroNome: string
  itens: { descricao: string; quantidade: number; total: number }[]
  taxaEntrega: number
  total: number
  forma: string | null
  chavePix: string | null
  situacao: ReturnType<typeof situacaoParaCliente>
}

/** A página de acompanhar: o link secreto é a chave. */
export async function acompanharPedido(slug: string, token: string): Promise<PedidoAcompanhado | null> {
  if (!/^[\w-]{16,64}$/.test(token)) return null
  const org = await acharOrgPorSlug(slug)
  if (!org) return null
  return comoOrg(org.id, async (db) => {
    const e = await db.encomenda.findUnique({
      where: { acompanhamento: token },
      select: {
        id: true,
        orgId: true,
        criadaEm: true,
        para: true,
        entrega: true,
        endereco: true,
        clienteNome: true,
        valor: true,
        taxaEntrega: true,
        situacao: true,
        vistaEm: true,
        formaCombinada: true,
        unidade: { select: { nome: true, apelido: true, catalogo: { select: { whatsapp: true, endereco: true, ativo: true, chavePix: true } } } },
        itens: { select: { descricao: true, quantidade: true, total: true } },
      },
    })
    if (!e || e.orgId !== org.id) return null
    const cat = e.unidade.catalogo
    return {
      empresa: { nome: org.nome, slug: org.slug, logoUrl: org.logoUrl, corMarca: org.corMarca },
      loja: { nome: e.unidade.apelido || e.unidade.nome, whatsapp: cat?.whatsapp ?? null, catalogo: cat?.ativo ? cat.endereco : null },
      codigo: codigoEncomenda(e.id),
      criadoEm: e.criadaEm.toISOString(),
      para: e.para.toISOString(),
      entrega: e.entrega,
      endereco: e.endereco,
      primeiroNome: e.clienteNome.split(' ')[0] ?? '',
      itens: e.itens.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade), total: Number(i.total) })),
      taxaEntrega: Number(e.taxaEntrega ?? 0),
      total: Number(e.valor),
      forma: FORMAS_DO_CATALOGO.find((f) => f.forma === e.formaCombinada)?.rotulo ?? null,
      chavePix: e.formaCombinada === 'PIX' && e.situacao !== 'CANCELADA' ? (cat?.chavePix ?? null) : null,
      situacao: situacaoParaCliente(e),
    }
  })
}
