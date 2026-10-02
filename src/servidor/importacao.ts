// Trazer produtos de outro sistema — a parte que GRAVA.
//
// A planilha é lida no navegador (importacao-planilha.ts) e chega aqui em
// lotes de até 200 linhas, já como produtos. Cada lote passa pelas mesmas
// regras do cadastro de um produto só (`criarProduto`) e da correção de
// estoque (`corrigirPeloContado`): quem cadastra, em que lojas o produto
// nasce, quem assina, o que vai para o livro de auditoria. Nada aqui decide
// permissão por conta própria nem confia no que veio do navegador — cada
// item é conferido de novo (`conferirItem`).
//
// ── trazer DUAS VEZES não duplica ────────────────────────────
// A importação de verdade nunca é uma só: a internet caiu no lote 7, a dona
// achou um erro na planilha e mandou de novo, o sistema antigo exportou
// outra vez na semana seguinte. Por isso cada linha procura primeiro o que
// já existe — pelo código da etiqueta e pelo código de barras; sem eles,
// pelo nome (sem acento, sem caixa) — e o que já existe é ATUALIZADO (preço
// e estoque) ou PULADO, como a pessoa escolheu. O estoque entra como saldo
// CONTADO (balanço), não como entrada: mandar a mesma planilha de novo deixa
// o saldo no mesmo número, em vez de somar duas vezes.
//
// ── e o tamanho da transação ─────────────────────────────────
// Um lote de 200 produtos numa transação só passaria do prazo do Prisma
// (5 s) num banco hospedado. Cada lote é gravado em fatias pequenas, cada
// fatia numa transação: se uma linha derruba a fatia (código que outra
// pessoa acabou de usar), a fatia é refeita linha a linha e só a culpada
// fica de fora, com o motivo.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, soPelaEmpresa, unidadesQuePodem, SemPermissao, type Sessao } from './permissao'
import { assinarExcecao } from './autorizacao'
import { alcancaOProduto, vendidoNaLoja } from './catalogo-loja'
import { prefixoDe, proximosCodigos } from './produto'
import { mexerEstoqueEm } from './estoque'
import { perguntar, temChaveIA } from './ia'
import {
  MAX_CODIGO,
  MAX_NOME,
  MOTIVO_IMPORTACAO,
  SISTEMA_DA_IA,
  TAM_LOTE,
  amostraSegura,
  chaveDoNome,
  conferirItem,
  lerRespostaDaIA,
  pedidoParaIA,
  pesoDo,
  type Campo,
  type ItemImportado,
  type VariacaoImportada,
} from './importacao-planilha'

export type SeJaExiste = 'atualizar' | 'pular'

export type EntradaLote = {
  /** A loja onde o estoque da planilha entra. Sem estoque na planilha, pode faltar. */
  unidadeId: string | null
  seJaExiste: SeJaExiste
  /** Os itens como vieram do navegador — conferidos aqui, um a um. */
  itens: unknown[]
  pin?: string | null
}

export type SituacaoLinha = 'criado' | 'atualizado' | 'pulado' | 'erro'
export type LinhaDoLote = { linha: number; nome: string; situacao: SituacaoLinha; recado?: string }

export type ResultadoLote =
  | {
      ok: true
      criados: number
      atualizados: number
      pulados: number
      erros: number
      categoriasNovas: string[]
      linhas: LinhaDoLote[]
    }
  | { ok: false; erro: string; precisaPin?: true }

/** Recusa do lote inteiro, com frase de gente (loja fechada, loja de outra empresa). */
export class ImportacaoRecusada extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'ImportacaoRecusada'
  }
}

/** Linhas por transação. Ver "o tamanho da transação", lá em cima. */
const POR_FATIA = 40

// Os acentos que o Postgres tira na comparação por nome — o par do
// `chaveDoNome` do navegador. Maiúsculas e minúsculas, porque o `lower` do
// banco, conforme a configuração, só baixa as letras sem acento.
const COM_ACENTO = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ'
const SEM_ACENTO = 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'

const unicos = <T>(l: (T | null | undefined)[]) => [...new Set(l.filter((x): x is T => x !== null && x !== undefined))]

/** Dinheiro compara em centavos — a mesma régua de `editarProduto`. */
function mudou(novo: number | null, antigo: unknown): boolean {
  if (novo === null) return false
  const a = antigo == null ? null : Math.round(Number(antigo) * 100)
  return a !== Math.round(novo * 100)
}

/**
 * A etiqueta foi feita pelo Norte? Três letras do nome e um número (CAM001,
 * ver `prefixoDe`). Produto cadastrado à mão antes da importação tem só
 * etiquetas assim — e é com ESTE que a linha da planilha pode casar pelo
 * nome, mesmo trazendo um código próprio.
 */
const doNorte = (codigo: string, nome: string) => new RegExp(`^${prefixoDe(nome)}\\d{3,}$`).test(codigo.toUpperCase())

const SELECT_EXISTENTE = {
  id: true, nome: true, ativo: true, servico: true, vendidoEm: true,
  precoVista: true, precoCartao: true, custo: true,
  variacoes: {
    where: { ativa: true },
    select: { id: true, codigo: true, codigoBarras: true, opcoes: { select: { opcaoId: true } } },
  },
} as const

type Existente = {
  id: string
  nome: string
  ativo: boolean
  servico: boolean
  vendidoEm: string[]
  precoVista: unknown
  precoCartao: unknown
  custo: unknown
  variacoes: { id: string; codigo: string | null; codigoBarras: string | null; opcoes: { opcaoId: string }[] }[]
}

type Eixo = { id: string; opcoes: Map<string, string> }

type Contexto = {
  sessao: Sessao
  unidadeId: string | null
  /** A loja do estoque é depósito: guarda o que as lojas vendem, qualquer produto. */
  deposito: boolean
  lojaNome: string
  vendidoEm: string[]
  seJaExiste: SeJaExiste
  categorias: Map<string, string>
  eixos: { tamanho: Eixo | null; cor: Eixo | null }
  assinou: boolean
}

// ─────────────────────────────────────────────────────────────
// O LOTE
// ─────────────────────────────────────────────────────────────

export async function importarLote(sessao: Sessao, e: EntradaLote): Promise<ResultadoLote> {
  // A mesma capacidade de cadastrar um produto — a vendedora a tem quando a
  // empresa deixa, e aí assina (ver EXTRAS_DO_BALCAO).
  exigir(sessao, 'produto.cadastrar')

  if (!Array.isArray(e.itens) || e.itens.length === 0) return { ok: false, erro: 'Nada para trazer neste lote.' }
  if (e.itens.length > TAM_LOTE) return { ok: false, erro: `Lote grande demais: no máximo ${TAM_LOTE} linhas por vez.` }

  const linhas: LinhaDoLote[] = []
  const itens: ItemImportado[] = []
  for (const x of e.itens) {
    const r = conferirItem(x)
    if (typeof r === 'string') {
      const o = (x ?? {}) as { linha?: unknown; nome?: unknown }
      linhas.push({
        linha: typeof o.linha === 'number' ? o.linha : 0,
        nome: typeof o.nome === 'string' ? o.nome.slice(0, MAX_NOME) : '',
        situacao: 'erro',
        recado: r,
      })
    } else itens.push(r)
  }
  if (itens.reduce((s, i) => s + pesoDo(i), 0) > TAM_LOTE) {
    return { ok: false, erro: `Lote grande demais: no máximo ${TAM_LOTE} linhas por vez.` }
  }

  const seJaExiste: SeJaExiste = e.seJaExiste === 'atualizar' ? 'atualizar' : 'pular'
  const unidadeId = typeof e.unidadeId === 'string' && e.unidadeId.trim() ? e.unidadeId.trim() : null
  const comEstoque = itens.some((i) => i.estoque !== null || i.variacoes.some((v) => v.estoque !== null))
  if (comEstoque) {
    if (!unidadeId) return { ok: false, erro: 'A planilha tem estoque: escolha em que loja ele entra.' }
    exigir(sessao, 'estoque.ajustar', unidadeId)
  }

  // Em que lojas o produto NASCE. Quem responde pela empresa inteira
  // cadastra para todas (vazio = todas, inclusive as que abrirem); o gerente
  // de uma loja cadastra só para as dele — a mesma regra da ficha.
  const alcance = unidadesQuePodem(sessao, 'produto.cadastrar')
  const vendidoEm = alcance === 'todas' ? [] : unidadeId && alcance.includes(unidadeId) ? [unidadeId] : alcance
  if (!alcancaOProduto(alcance, vendidoEm)) throw new SemPermissao('produto.cadastrar')

  // A assinatura, UMA vez por lote: a vendedora que cadastra ou corrige
  // estoque porque a empresa deixou assina sempre; os outros, quando a
  // empresa pede assinatura nas exceções e a planilha mexe em estoque.
  const soCadastro = soPelaEmpresa(sessao, 'produto.cadastrar')
  const soEstoque = comEstoque && !!unidadeId && soPelaEmpresa(sessao, 'estoque.ajustar', unidadeId)
  let assinou = false
  if (comEstoque || soCadastro) {
    const a = await assinarExcecao(sessao, { pin: e.pin, sempre: soCadastro || soEstoque })
    if (!a.ok) return { ok: false, erro: a.erro, precisaPin: true }
    assinou = a.assinou
  }

  let preparo: Awaited<ReturnType<typeof preparar>>
  try {
    preparo = await comoOrg(sessao.orgId, (db) => preparar(db, sessao.orgId, unidadeId, itens))
  } catch (erro) {
    if (erro instanceof ImportacaoRecusada) return { ok: false, erro: erro.message }
    throw erro
  }

  const ctx: Contexto = {
    sessao,
    unidadeId,
    deposito: preparo.deposito,
    lojaNome: preparo.lojaNome,
    vendidoEm,
    seJaExiste,
    categorias: preparo.categorias,
    eixos: preparo.eixos,
    assinou,
  }

  for (const fatia of fatiar(itens)) {
    try {
      linhas.push(...(await comoOrg(sessao.orgId, (db) => gravarFatia(db, ctx, fatia))))
    } catch {
      // Uma linha derrubou a transação da fatia inteira, que foi desfeita.
      // De novo, uma por uma: só a culpada fica de fora.
      for (const item of fatia) {
        try {
          linhas.push(...(await comoOrg(sessao.orgId, (db) => gravarFatia(db, ctx, [item]))))
        } catch (erro) {
          linhas.push({ linha: item.linha, nome: item.nome, situacao: 'erro', recado: recadoDaLinha(erro) })
        }
      }
    }
  }

  const conta = (s: SituacaoLinha) => linhas.filter((l) => l.situacao === s).length
  const r = {
    ok: true as const,
    criados: conta('criado'),
    atualizados: conta('atualizado'),
    pulados: conta('pulado'),
    erros: conta('erro'),
    categoriasNovas: preparo.novas,
    linhas: linhas.sort((a, b) => a.linha - b.linha),
  }

  // Uma linha no livro para o lote, além da de cada produto e de cada
  // saldo: "quem trouxe 900 produtos na terça?" tem resposta direta.
  if (r.criados + r.atualizados > 0) {
    await comoOrg(sessao.orgId, (db) =>
      db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          unidadeId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'produto.importou',
          alvoTipo: 'importacao',
          alvoNome: `${r.criados} novos, ${r.atualizados} atualizados`,
          motivo: MOTIVO_IMPORTACAO,
          depois: { criados: r.criados, atualizados: r.atualizados, pulados: r.pulados, erros: r.erros, categoriasNovas: r.categoriasNovas.length },
          assinado: assinou,
        },
      }),
    )
  }
  return r
}

/** Fatias de até `POR_FATIA` linhas; produto com grade nunca se parte. */
function fatiar(itens: ItemImportado[]): ItemImportado[][] {
  const r: ItemImportado[][] = []
  let atual: ItemImportado[] = []
  let peso = 0
  for (const i of itens) {
    if (atual.length > 0 && peso + pesoDo(i) > POR_FATIA) {
      r.push(atual)
      atual = []
      peso = 0
    }
    atual.push(i)
    peso += pesoDo(i)
  }
  if (atual.length) r.push(atual)
  return r
}

/** A frase da linha que não entrou. O erro de máquina vai para o log, não para a tela. */
function recadoDaLinha(e: unknown): string {
  if (e instanceof ImportacaoRecusada) return e.message
  if (e && typeof e === 'object' && 'code' in e && (e as { code?: unknown }).code === 'P2002') {
    return 'o código ou o código de barras já é de outro produto'
  }
  console.error('[importacao] linha recusada', e instanceof Error ? e.name : typeof e)
  return 'não deu para gravar esta linha'
}

// ─────────────────────────────────────────────────────────────
// ANTES DAS LINHAS: LOJA, CATEGORIAS, TAMANHOS E CORES
// ─────────────────────────────────────────────────────────────

async function preparar(db: BancoDaOrg, orgId: string, unidadeId: string | null, itens: ItemImportado[]) {
  let deposito = false
  let lojaNome = ''
  if (unidadeId) {
    // Pelo RLS: loja de outra empresa não aparece.
    const loja = await db.unidade.findUnique({ where: { id: unidadeId }, select: { nome: true, ativa: true, ehDeposito: true } })
    if (!loja) throw new ImportacaoRecusada('Loja não encontrada nesta empresa.')
    if (!loja.ativa) throw new ImportacaoRecusada(`${loja.nome} está fechada. Escolha uma loja aberta para o estoque.`)
    deposito = loja.ehDeposito
    lojaNome = loja.nome
  }

  // As categorias citadas que ainda não existem nascem aqui — comparadas
  // pelo nome sem acento nem caixa, como o cadastro do ramo faz
  // (`semearRamo`): "Calçados" e "CALCADOS" são uma só.
  const existentes = await db.categoria.findMany({ select: { id: true, nome: true, ordem: true } })
  const categorias = new Map(existentes.map((c) => [chaveDoNome(c.nome), c.id]))
  let ordem = existentes.reduce((m, c) => Math.max(m, c.ordem), -1) + 1
  const novas: string[] = []
  for (const nome of unicos(itens.map((i) => i.categoria))) {
    const k = chaveDoNome(nome)
    if (categorias.has(k)) continue
    const c = await db.categoria.create({ data: { orgId, nome, ordem: ordem++ }, select: { id: true } })
    categorias.set(k, c.id)
    novas.push(nome)
  }

  const valores = (k: 'tamanho' | 'cor') => unicos(itens.flatMap((i) => i.variacoes.map((v) => v[k])))
  const tamanhos = valores('tamanho')
  const cores = valores('cor')
  const eixos = {
    // A loja de calçado já tem "Numeração" (do cadastro do ramo): o número
    // do sapato entra nela, e não num "Tamanho" novo ao lado.
    tamanho: tamanhos.length ? await eixoCom(db, orgId, ['tamanho', 'numeracao'], 'Tamanho', false, tamanhos) : null,
    cor: cores.length ? await eixoCom(db, orgId, ['cor', 'cores'], 'Cor', true, cores) : null,
  }
  return { deposito, lojaNome, categorias, novas, eixos }
}

/** O eixo (achado pelo nome, ou criado) com todas as opções pedidas. */
async function eixoCom(db: BancoDaOrg, orgId: string, nomes: string[], nomeNovo: string, ehCor: boolean, valores: string[]): Promise<Eixo> {
  const todos = await db.eixo.findMany({ select: { id: true, nome: true, ordem: true, opcoes: { select: { id: true, valor: true, ordem: true } } } })
  let eixo = nomes.map((n) => todos.find((e) => chaveDoNome(e.nome) === n)).find(Boolean)
  if (!eixo) {
    const criado = await db.eixo.create({
      data: { orgId, nome: nomeNovo, ehCor, ordem: todos.reduce((m, e) => Math.max(m, e.ordem), -1) + 1 },
      select: { id: true, nome: true, ordem: true },
    })
    eixo = { ...criado, opcoes: [] }
  }
  const opcoes = new Map(eixo.opcoes.map((o) => [chaveDoNome(o.valor), o.id]))
  let ordem = eixo.opcoes.reduce((m, o) => Math.max(m, o.ordem), -1) + 1
  for (const valor of valores) {
    const k = chaveDoNome(valor)
    if (opcoes.has(k)) continue
    const o = await db.opcao.create({ data: { orgId, eixoId: eixo.id, valor, ordem: ordem++ }, select: { id: true } })
    opcoes.set(k, o.id)
  }
  return { id: eixo.id, opcoes }
}

// ─────────────────────────────────────────────────────────────
// AS LINHAS
// ─────────────────────────────────────────────────────────────

async function gravarFatia(db: BancoDaOrg, ctx: Contexto, fatia: ItemImportado[]): Promise<LinhaDoLote[]> {
  // ── quem já existe: pelo código, pelo código de barras, pelo nome ──
  const codigos = unicos(fatia.flatMap((i) => [i.codigo, ...i.variacoes.map((v) => v.codigo)]))
  const eans = unicos(fatia.flatMap((i) => [i.codigoBarras, ...i.variacoes.map((v) => v.codigoBarras)]))
  const chaves = unicos(fatia.map((i) => chaveDoNome(i.nome)))
  const porCodigo =
    codigos.length + eans.length > 0
      ? await db.$queryRaw<{ produto_id: string; codigo: string | null; codigo_barras: string | null }[]>`
          select produto_id, codigo, codigo_barras from variacoes
           where upper(codigo) = any(${codigos}::text[]) or codigo_barras = any(${eans}::text[])
        `
      : []
  const porNome = await db.$queryRaw<{ id: string; nome: string }[]>`
    select id, nome from produtos
     where ativo
       and btrim(regexp_replace(lower(translate(nome, ${COM_ACENTO}, ${SEM_ACENTO})), '[[:space:]]+', ' ', 'g')) = any(${chaves}::text[])
  `
  const ids = unicos([...porCodigo.map((r) => r.produto_id), ...porNome.map((r) => r.id)])
  const achados: Existente[] = ids.length ? await db.produto.findMany({ where: { id: { in: ids } }, select: SELECT_EXISTENTE }) : []

  const doId = new Map(achados.map((p) => [p.id, p]))
  const idPorCodigo = new Map<string, string>()
  const idPorEan = new Map<string, string>()
  const idsPorNome = new Map<string, string[]>()
  const anotar = (p: Existente) => {
    doId.set(p.id, p)
    for (const v of p.variacoes) {
      if (v.codigo) idPorCodigo.set(v.codigo.toUpperCase(), p.id)
      if (v.codigoBarras) idPorEan.set(v.codigoBarras, p.id)
    }
    const k = chaveDoNome(p.nome)
    idsPorNome.set(k, unicos([...(idsPorNome.get(k) ?? []), p.id]))
  }
  for (const p of achados) anotar(p)
  // Variação desativada também ocupa o código: casa pelo código mesmo assim.
  for (const r of porCodigo) {
    if (r.codigo && !idPorCodigo.has(r.codigo.toUpperCase())) idPorCodigo.set(r.codigo.toUpperCase(), r.produto_id)
    if (r.codigo_barras && !idPorEan.has(r.codigo_barras)) idPorEan.set(r.codigo_barras, r.produto_id)
  }

  const acharExistente = (item: ItemImportado): Existente | null => {
    for (const c of [item.codigo, ...item.variacoes.map((v) => v.codigo)]) {
      const id = c ? idPorCodigo.get(c) : undefined
      if (id && doId.has(id)) return doId.get(id)!
    }
    for (const e of [item.codigoBarras, ...item.variacoes.map((v) => v.codigoBarras)]) {
      const id = e ? idPorEan.get(e) : undefined
      if (id && doId.has(id)) return doId.get(id)!
    }
    // Pelo nome. Se a linha traz código próprio, ela só casa com produto
    // cujas etiquetas são todas do Norte (o cadastrado à mão antes): duas
    // linhas "Brinco" com códigos diferentes são dois brincos.
    const temCodigo = !!item.codigo || item.variacoes.some((v) => v.codigo)
    const candidatos = (idsPorNome.get(chaveDoNome(item.nome)) ?? []).map((id) => doId.get(id)!).filter(Boolean)
    return candidatos.find((p) => !temCodigo || p.variacoes.every((v) => !v.codigo || doNorte(v.codigo, p.nome))) ?? null
  }

  const feitas: LinhaDoLote[] = []
  for (const item of fatia) {
    const existente = acharExistente(item)
    if (existente) {
      feitas.push(await atualizar(db, ctx, item, existente))
      continue
    }
    const criado = await criar(db, ctx, item)
    anotar(criado.produto)
    feitas.push(criado.linha)
  }
  return feitas
}

/** Tamanho e cor da opção, em ids de opção do Norte (a ordem não importa). */
function opcoesDa(ctx: Contexto, v: Pick<VariacaoImportada, 'tamanho' | 'cor'>): string[] {
  const r: string[] = []
  if (v.cor && ctx.eixos.cor) r.push(ctx.eixos.cor.opcoes.get(chaveDoNome(v.cor))!)
  if (v.tamanho && ctx.eixos.tamanho) r.push(ctx.eixos.tamanho.opcoes.get(chaveDoNome(v.tamanho))!)
  return r.filter(Boolean)
}

const rotuloDa = (v: Pick<VariacaoImportada, 'tamanho' | 'cor'>) => [v.cor, v.tamanho].filter(Boolean).join(' · ')

async function criar(db: BancoDaOrg, ctx: Contexto, item: ItemImportado): Promise<{ produto: Existente; linha: LinhaDoLote }> {
  const { sessao } = ctx
  const orgId = sessao.orgId
  const categoriaId = item.categoria ? (ctx.categorias.get(chaveDoNome(item.categoria)) ?? null) : null
  // Cor primeiro, tamanho depois: é a ordem em que se lê a etiqueta ("Azul · P").
  const eixosUsados = [
    item.variacoes.some((v) => v.cor) ? ctx.eixos.cor?.id : undefined,
    item.variacoes.some((v) => v.tamanho) ? ctx.eixos.tamanho?.id : undefined,
  ].filter((x): x is string => !!x)

  const produto = await db.produto.create({
    data: {
      orgId,
      nome: item.nome,
      marca: item.marca,
      categoriaId,
      medida: item.medida,
      precoVista: item.precoVista,
      precoCartao: item.precoCartao ?? item.precoVista,
      precoCrediario: item.precoCartao ?? item.precoVista,
      custo: item.custo,
      vendidoEm: ctx.vendidoEm,
      eixos: { create: eixosUsados.map((eixoId, i) => ({ orgId, eixoId, ordem: i })) },
    },
    select: { id: true },
  })

  const pedidas: VariacaoImportada[] = item.variacoes.length
    ? item.variacoes
    : [{ linha: item.linha, tamanho: null, cor: null, codigo: item.codigo, codigoBarras: item.codigoBarras, estoque: item.estoque }]
  // O código que a planilha trouxe é a etiqueta que já está colada na peça:
  // fica. Sem código, o Norte dá um (CAM001), como no cadastro à mão.
  const faltam = pedidas.filter((v) => !v.codigo).length
  const gerados = faltam ? await proximosCodigos(db, prefixoDe(item.nome), faltam) : []
  let g = 0
  const recados: string[] = []
  const variacoes: Existente['variacoes'] = []
  for (const v of pedidas) {
    const opcoes = opcoesDa(ctx, v)
    const criada = await db.variacao.create({
      data: {
        orgId,
        produtoId: produto.id,
        codigo: (v.codigo ?? gerados[g++]!).slice(0, MAX_CODIGO),
        codigoBarras: v.codigoBarras,
        padrao: opcoes.length === 0,
        opcoes: { create: opcoes.map((opcaoId) => ({ orgId, opcaoId })) },
      },
      select: { id: true, codigo: true, codigoBarras: true },
    })
    variacoes.push({ ...criada, opcoes: opcoes.map((opcaoId) => ({ opcaoId })) })
    if (v.estoque !== null) {
      const r = await lancarSaldo(db, ctx, { id: produto.id, nome: item.nome, vendidoEm: ctx.vendidoEm, servico: false }, criada, v.estoque, rotuloDa(v))
      if (r) recados.push(r)
    }
  }

  await db.auditoria.create({
    data: {
      orgId,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao: 'produto.criou',
      alvoTipo: 'produto',
      alvoId: produto.id,
      alvoNome: item.nome,
      motivo: MOTIVO_IMPORTACAO,
      depois: { medida: item.medida, precoVista: item.precoVista, variacoes: pedidas.length, linha: item.linha },
      assinado: ctx.assinou,
    },
  })

  return {
    produto: {
      id: produto.id, nome: item.nome, ativo: true, servico: false, vendidoEm: ctx.vendidoEm,
      precoVista: item.precoVista, precoCartao: item.precoCartao ?? item.precoVista, custo: item.custo, variacoes,
    },
    linha: { linha: item.linha, nome: item.nome, situacao: 'criado', recado: recados.join('; ') || undefined },
  }
}

async function atualizar(db: BancoDaOrg, ctx: Contexto, item: ItemImportado, p: Existente): Promise<LinhaDoLote> {
  const base = { linha: item.linha, nome: item.nome }
  if (ctx.seJaExiste === 'pular') {
    return { ...base, situacao: 'pulado', recado: p.nome === item.nome ? 'já existe' : `já existe como "${p.nome}"` }
  }
  const { sessao } = ctx
  const recados: string[] = []

  // ── o preço: as mesmas regras de `editarProduto` ──
  const dados: { precoVista?: number; precoCartao?: number; custo?: number } = {}
  if (mudou(item.precoVista, p.precoVista)) dados.precoVista = item.precoVista
  if (item.precoCartao !== null && mudou(item.precoCartao, p.precoCartao)) dados.precoCartao = item.precoCartao
  if (item.custo !== null && mudou(item.custo, p.custo)) dados.custo = item.custo
  if (Object.keys(dados).length > 0) {
    // Preço vale em toda loja onde o produto é vendido: só muda quem tem
    // `produto.preco` em todas elas.
    if (!pode(sessao, 'produto.preco') || !alcancaOProduto(unidadesQuePodem(sessao, 'produto.preco'), p.vendidoEm)) {
      recados.push('o preço não mudou: mexer em preço pede permissão própria')
    } else {
      await db.produto.update({ where: { id: p.id }, data: dados })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'produto.preco.alterou',
          alvoTipo: 'produto',
          alvoId: p.id,
          alvoNome: p.nome,
          motivo: MOTIVO_IMPORTACAO,
          antes: { precoVista: Number(p.precoVista ?? 0), custo: Number(p.custo ?? 0) },
          depois: { precoVista: dados.precoVista ?? Number(p.precoVista ?? 0), custo: dados.custo ?? Number(p.custo ?? 0) },
          assinado: ctx.assinou,
        },
      })
      recados.push('preço atualizado')
    }
  }

  // ── o estoque: o saldo contado, na variação certa ──
  const porCodigo = (c: string | null, e: string | null) =>
    p.variacoes.find((v) => (c && v.codigo?.toUpperCase() === c) || (e && v.codigoBarras === e))
  if (item.variacoes.length === 0 && item.estoque !== null) {
    const alvo = porCodigo(item.codigo, item.codigoBarras) ?? (p.variacoes.length === 1 ? p.variacoes[0] : undefined)
    if (!alvo) recados.push('no Norte este produto tem grade: o estoque de cada opção se lança na tela de Estoque')
    else {
      const r = await lancarSaldo(db, ctx, p, alvo, item.estoque, '')
      if (r) recados.push(r)
    }
  }
  for (const v of item.variacoes) {
    if (v.estoque === null) continue
    const chave = opcoesDa(ctx, v).sort().join('|')
    const alvo = porCodigo(v.codigo, v.codigoBarras) ?? p.variacoes.find((x) => x.opcoes.map((o) => o.opcaoId).sort().join('|') === chave)
    if (!alvo) recados.push(`${rotuloDa(v)} não existe neste produto — acrescente pela ficha`)
    else {
      const r = await lancarSaldo(db, ctx, p, alvo, v.estoque, rotuloDa(v))
      if (r) recados.push(r)
    }
  }
  if (!p.ativo) recados.push('está fora de venda, e continua')

  return { ...base, situacao: 'atualizado', recado: recados.join('; ') || 'já existia, sem mudança' }
}

/**
 * O saldo desta loja passa a ser o da planilha — o mesmo balanço da
 * correção pelo contado, com o motivo da importação, uma linha no livro e o
 * movimento no histórico. Igual ao que já está: nada é gravado. Devolve um
 * recado quando NÃO lança.
 */
async function lancarSaldo(
  db: BancoDaOrg,
  ctx: Contexto,
  p: Pick<Existente, 'id' | 'nome' | 'vendidoEm' | 'servico'>,
  v: { id: string; codigo: string | null },
  alvo: number,
  rotulo: string,
): Promise<string | null> {
  const unidadeId = ctx.unidadeId
  if (!unidadeId) return null
  if (p.servico) return 'é serviço: não tem estoque'
  // A loja que não vende o produto não guarda saldo dele (o balcão não
  // venderia); o depósito guarda qualquer coisa — ver `transferir`.
  if (!ctx.deposito && !vendidoNaLoja(p.vendidoEm, unidadeId)) return `${ctx.lojaNome} não vende este produto: o estoque não entrou`
  const quantidade = Math.max(0, alvo)
  const [linha] = await db.$queryRaw<{ quantidade: string }[]>`
    select quantidade from estoque where variacao_id = ${v.id} and unidade_id = ${unidadeId}
  `
  const antes = linha ? Number(linha.quantidade) : null
  if (antes === quantidade || (antes === null && quantidade === 0)) return null

  const r = await mexerEstoqueEm(db, ctx.sessao, {
    variacaoId: v.id,
    unidadeId,
    tipo: 'BALANCO',
    quantidade,
    motivo: MOTIVO_IMPORTACAO,
  })
  if (!r.ok) throw new ImportacaoRecusada('não deu para lançar o estoque')
  await db.auditoria.create({
    data: {
      orgId: ctx.sessao.orgId,
      unidadeId,
      usuarioId: ctx.sessao.usuarioId,
      quem: ctx.sessao.nome,
      acao: 'estoque.ajustou',
      alvoTipo: 'variacao',
      alvoId: v.id,
      alvoNome: `${p.nome}${rotulo ? ` — ${rotulo}` : ''}${v.codigo ? ` (${v.codigo})` : ''}`,
      motivo: MOTIVO_IMPORTACAO,
      antes: { saldo: antes ?? 0 },
      depois: { saldo: r.saldo, tipo: 'BALANCO' },
      assinado: ctx.assinou,
    },
  })
  return null
}

// ─────────────────────────────────────────────────────────────
// A PRÉVIA: O QUE JÁ EXISTE
// ─────────────────────────────────────────────────────────────

const listaDeTexto = (x: unknown, max: number, tam: number): string[] =>
  Array.isArray(x) ? unicos(x.slice(0, max).map((v) => (typeof v === 'string' ? v.trim().slice(0, tam) : null)).filter((v) => !!v)) : []

/**
 * Dos códigos e nomes da planilha, quais o Norte já tem — para a prévia
 * dizer "40 já existem" antes de a pessoa mandar. Até 2 mil de cada por
 * chamada; a tela manda em pedaços.
 */
export async function conferirExistentes(
  sessao: Sessao,
  p: { codigos: unknown; nomes: unknown },
): Promise<{ codigos: string[]; nomes: string[] }> {
  exigir(sessao, 'produto.ver')
  const codigos = listaDeTexto(p.codigos, 2000, MAX_CODIGO).map((c) => c.toUpperCase())
  const nomes = listaDeTexto(p.nomes, 2000, MAX_NOME).map(chaveDoNome)
  return comoOrg(sessao.orgId, async (db) => {
    const c = codigos.length
      ? await db.$queryRaw<{ codigo: string | null; codigo_barras: string | null }[]>`
          select upper(codigo) as codigo, codigo_barras from variacoes
           where upper(codigo) = any(${codigos}::text[]) or codigo_barras = any(${codigos}::text[])
        `
      : []
    const n = nomes.length
      ? await db.$queryRaw<{ nome: string }[]>`
          select nome from produtos
           where ativo
             and btrim(regexp_replace(lower(translate(nome, ${COM_ACENTO}, ${SEM_ACENTO})), '[[:space:]]+', ' ', 'g')) = any(${nomes}::text[])
        `
      : []
    const pedidos = new Set(codigos)
    return {
      codigos: unicos(c.flatMap((r) => [r.codigo, r.codigo_barras]).filter((x) => x && pedidos.has(x))),
      nomes: unicos(n.map((r) => chaveDoNome(r.nome))),
    }
  })
}

// ─────────────────────────────────────────────────────────────
// A IA: QUE COLUNA É O QUÊ
// ─────────────────────────────────────────────────────────────

// Um teto por empresa por dia, na memória do processo — como o do Guia: é
// para não estourar a conta, não é regra de negócio. Cada planilha pede uma
// vez; 40 é folga para quem tenta várias.
const TETO_POR_DIA = 40
const pedidosDoDia = new Map<string, number>()

function contarPedido(orgId: string): boolean {
  const dia = new Date().toISOString().slice(0, 10)
  if (pedidosDoDia.size > 500) for (const k of pedidosDoDia.keys()) if (!k.endsWith(dia)) pedidosDoDia.delete(k)
  const chave = `${orgId}:${dia}`
  const n = (pedidosDoDia.get(chave) ?? 0) + 1
  pedidosDoDia.set(chave, n)
  return n <= TETO_POR_DIA
}

/**
 * Pergunta à IA o que é cada coluna, quando os títulos não dizem.
 *
 * Sobe SÓ a amostra (títulos e até oito linhas, cortadas — ver
 * `amostraParaIA`); a planilha inteira nunca sai do navegador. Sem chave,
 * sem cota ou com resposta torta, devolve `ok: false` e a tela fica com o
 * palpite das regras — a importação nunca depende da IA.
 */
export async function sugerirColunas(
  sessao: Sessao,
  bruto: unknown,
): Promise<{ ok: true; cabecalho: number | null; campos: Campo[] } | { ok: false }> {
  exigir(sessao, 'produto.cadastrar')
  if (!temChaveIA()) return { ok: false }
  const linhas = amostraSegura(bruto)
  if (!linhas || !contarPedido(sessao.orgId)) return { ok: false }
  const colunas = linhas.reduce((m, l) => Math.max(m, l.length), 0)
  try {
    const r = await perguntar({ sistema: SISTEMA_DA_IA, mensagens: [{ papel: 'usuario', texto: pedidoParaIA(linhas) }], maxTokens: 500 })
    const lido = lerRespostaDaIA(r.texto, colunas)
    return lido ? { ok: true, ...lido } : { ok: false }
  } catch {
    return { ok: false }
  }
}
