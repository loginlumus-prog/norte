// Cadastrar e manter produto.
//
// ── a decisão que manda em tudo aqui ─────────────────────────
// Todo produto tem pelo menos UMA variação, mesmo quando não varia. Sem isso,
// estoque e venda teriam dois caminhos ("às vezes é no produto, às vezes na
// variação") — e é exatamente onde bug de estoque nasce.
//
// Quem não varia ganha uma variação `padrao = true`, que a tela nem mostra.
// Quem varia ganha o produto cartesiano dos eixos escolhidos: 2 cores × 3
// tamanhos = 6 variações, cada uma com o próprio código de etiqueta.
//
// ── e a que evita o pior erro possível ───────────────────────
// VARIAÇÃO NUNCA É APAGADA quando tem história. Tirar "Azul P" da grade não
// pode sumir com a venda de março que tinha Azul P dentro, nem com o saldo
// que ainda está na prateleira. Ela é DESATIVADA: some da tela de vender,
// continua no histórico e no relatório.

import { comoOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import type { BancoDaOrg } from './banco'
import { Prisma, type Medida } from '@prisma/client'

export type EixoEscolhido = {
  eixoId: string
  /** Quais opções deste eixo entram na grade. Vazio = o eixo não é usado. */
  opcaoIds: string[]
}

export type DadosProduto = {
  nome: string
  marca?: string | null
  descricao?: string | null
  categoriaId?: string | null
  medida: Medida
  precoVista: number
  precoCartao?: number | null
  precoCrediario?: number | null
  custo?: number | null
  /** Ids das lojas onde é vendido. Vazio = todas. Já normalizado por quem chama. */
  vendidoEm?: string[]
  /**
   * Dias do pedido à prateleira. Nulo = não informado, e a previsão de
   * ruptura usa o prazo padrão dela. É cadastro, não preço: quem pode editar
   * a ficha pode preencher.
   */
  prazoReposicaoDias?: number | null
}

export type ResultadoProduto =
  | { ok: true; produtoId: string; variacoes: number }
  | { ok: false; motivo: string }

// ─────────────────────────────────────────────────────────────
// O CÓDIGO DA ETIQUETA
// ─────────────────────────────────────────────────────────────

/**
 * Três letras do nome, sem acento, mais um número sequencial: CAM001.
 *
 * É o que a pessoa digita no balcão quando o leitor não pega, então precisa
 * ser curto e sem ambiguidade. Acento fora porque teclado de balcão e leitor
 * de código de barras não concordam sobre ele.
 */
export function prefixoDe(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
  return (limpo.slice(0, 3) || 'PRO').padEnd(3, 'X')
}

/**
 * Os próximos N códigos livres desse prefixo.
 *
 * Conta a partir do MAIOR já usado, não da quantidade existente: produto
 * arquivado continua ocupando o código dele, e reaproveitar número faria duas
 * peças diferentes responderem à mesma etiqueta — o pior tipo de erro de
 * balcão, porque ele não parece erro.
 */
export async function proximosCodigos(
  db: BancoDaOrg,
  prefixo: string,
  quantos: number,
): Promise<string[]> {
  const usados = await db.variacao.findMany({
    where: { codigo: { startsWith: prefixo } },
    select: { codigo: true },
  })

  let maior = 0
  for (const u of usados) {
    const n = Number(u.codigo?.slice(prefixo.length) ?? 0)
    if (Number.isFinite(n) && n > maior) maior = n
  }

  return Array.from({ length: quantos }, (_, i) => `${prefixo}${String(maior + 1 + i).padStart(3, '0')}`)
}

// ─────────────────────────────────────────────────────────────
// A GRADE
// ─────────────────────────────────────────────────────────────

/**
 * O produto cartesiano das opções escolhidas.
 *
 * `[[azul, preto], [P, M, G]]` vira as seis combinações, na ordem em que a
 * pessoa lê a etiqueta: cor primeiro, tamanho depois. A ordem importa porque
 * ela vira o nome que aparece no balcão ("Azul · P").
 *
 * Sem eixo nenhum devolve `[[]]` — uma combinação vazia, que é a variação
 * padrão. Devolver `[]` faria o produto nascer sem variação nenhuma, e aí
 * não haveria o que vender.
 */
export function combinar(porEixo: string[][]): string[][] {
  return porEixo.reduce<string[][]>(
    (acumulado, opcoes) => acumulado.flatMap((c) => opcoes.map((o) => [...c, o])),
    [[]],
  )
}

// ─────────────────────────────────────────────────────────────
// CRIAR
// ─────────────────────────────────────────────────────────────

export async function criarProduto(
  sessao: Sessao,
  dados: DadosProduto,
  eixos: EixoEscolhido[] = [],
): Promise<ResultadoProduto> {
  exigir(sessao, 'produto.editar')
  // Nascer com preço é mexer em preço. Quem não pode, não cria.
  exigir(sessao, 'produto.preco')

  const nome = dados.nome.trim()
  if (!nome) return { ok: false, motivo: 'O produto precisa de um nome.' }
  if (dados.precoVista <= 0) return { ok: false, motivo: 'O preço à vista precisa ser maior que zero.' }

  const usados = eixos.filter((e) => e.opcaoIds.length > 0)

  return comoOrg(sessao.orgId, async (db) => {
    // As opções precisam ser desta empresa E do eixo que dizem ser. O que
    // chega do formulário vem do navegador, e o navegador é do usuário.
    const validas = await db.opcao.findMany({
      where: { id: { in: usados.flatMap((e) => e.opcaoIds) } },
      select: { id: true, eixoId: true },
    })
    const doEixo = new Map(validas.map((o) => [o.id, o.eixoId]))
    for (const e of usados) {
      for (const op of e.opcaoIds) {
        if (doEixo.get(op) !== e.eixoId) {
          return { ok: false as const, motivo: 'Uma das opções escolhidas não existe.' }
        }
      }
    }

    const produto = await db.produto.create({
      data: {
        orgId: sessao.orgId,
        nome,
        marca: dados.marca?.trim() || null,
        descricao: dados.descricao?.trim() || null,
        categoriaId: dados.categoriaId || null,
        medida: dados.medida,
        precoVista: dados.precoVista,
        precoCartao: dados.precoCartao ?? dados.precoVista,
        precoCrediario: dados.precoCrediario ?? dados.precoCartao ?? dados.precoVista,
        custo: dados.custo ?? null,
        vendidoEm: dados.vendidoEm ?? [],
        prazoReposicaoDias: dados.prazoReposicaoDias ?? null,
        eixos: {
          create: usados.map((e, i) => ({ orgId: sessao.orgId, eixoId: e.eixoId, ordem: i })),
        },
      },
      select: { id: true },
    })

    const combinacoes = combinar(usados.map((e) => e.opcaoIds))
    const codigos = await proximosCodigos(db, prefixoDe(nome), combinacoes.length)

    for (const [i, opcoes] of combinacoes.entries()) {
      await db.variacao.create({
        data: {
          orgId: sessao.orgId,
          produtoId: produto.id,
          codigo: codigos[i]!,
          padrao: opcoes.length === 0,
          opcoes: {
            create: opcoes.map((opcaoId) => ({ orgId: sessao.orgId, opcaoId })),
          },
        },
      })
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'produto.criou',
        alvoTipo: 'produto',
        alvoId: produto.id,
        alvoNome: nome,
        depois: { medida: dados.medida, precoVista: dados.precoVista, variacoes: combinacoes.length },
      },
    })

    return { ok: true as const, produtoId: produto.id, variacoes: combinacoes.length }
  })
}

// ─────────────────────────────────────────────────────────────
// EDITAR
// ─────────────────────────────────────────────────────────────

/**
 * Editar o cadastro.
 *
 * Preço é conferido separado (`produto.preco`) porque mexer em preço não é
 * corrigir uma descrição — quem pode arrumar o nome de uma peça não deveria
 * poder baixar o preço dela sozinho.
 *
 * O preço antigo vai para o livro. É a pergunta que sempre aparece depois:
 * "quem baixou isso e quando?".
 */
export async function editarProduto(
  sessao: Sessao,
  produtoId: string,
  dados: Partial<DadosProduto> & { ativo?: boolean },
): Promise<ResultadoProduto> {
  exigir(sessao, 'produto.editar')

  const mexeuNoPreco =
    dados.precoVista !== undefined ||
    dados.precoCartao !== undefined ||
    dados.precoCrediario !== undefined ||
    dados.custo !== undefined
  if (mexeuNoPreco) exigir(sessao, 'produto.preco')

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.produto.findUnique({
      where: { id: produtoId },
      select: { nome: true, precoVista: true, precoCartao: true, precoCrediario: true, custo: true, ativo: true },
    })
    if (!antes) return { ok: false as const, motivo: 'Produto não encontrado.' }

    if (dados.nome !== undefined && !dados.nome.trim()) {
      return { ok: false as const, motivo: 'O produto precisa de um nome.' }
    }
    if (dados.precoVista !== undefined && dados.precoVista <= 0) {
      return { ok: false as const, motivo: 'O preço à vista precisa ser maior que zero.' }
    }

    await db.produto.update({
      where: { id: produtoId },
      data: {
        ...(dados.nome !== undefined && { nome: dados.nome.trim() }),
        ...(dados.marca !== undefined && { marca: dados.marca?.trim() || null }),
        ...(dados.descricao !== undefined && { descricao: dados.descricao?.trim() || null }),
        ...(dados.categoriaId !== undefined && { categoriaId: dados.categoriaId || null }),
        ...(dados.medida !== undefined && { medida: dados.medida }),
        ...(dados.precoVista !== undefined && { precoVista: dados.precoVista }),
        ...(dados.precoCartao !== undefined && { precoCartao: dados.precoCartao }),
        ...(dados.precoCrediario !== undefined && { precoCrediario: dados.precoCrediario }),
        ...(dados.custo !== undefined && { custo: dados.custo }),
        ...(dados.vendidoEm !== undefined && { vendidoEm: dados.vendidoEm }),
        ...(dados.prazoReposicaoDias !== undefined && { prazoReposicaoDias: dados.prazoReposicaoDias }),
        ...(dados.ativo !== undefined && { ativo: dados.ativo }),
      },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: mexeuNoPreco ? 'produto.preco.alterou' : 'produto.alterou',
        alvoTipo: 'produto',
        alvoId: produtoId,
        alvoNome: dados.nome?.trim() ?? antes.nome,
        antes: mexeuNoPreco
          ? { precoVista: Number(antes.precoVista ?? 0), custo: Number(antes.custo ?? 0) }
          : { nome: antes.nome, ativo: antes.ativo },
        depois: mexeuNoPreco
          ? { precoVista: dados.precoVista ?? Number(antes.precoVista ?? 0), custo: dados.custo ?? Number(antes.custo ?? 0) }
          : { nome: dados.nome?.trim() ?? antes.nome, ativo: dados.ativo ?? antes.ativo },
      },
    })

    return { ok: true as const, produtoId, variacoes: 0 }
  })
}

// ─────────────────────────────────────────────────────────────
// MEXER NA GRADE DEPOIS
// ─────────────────────────────────────────────────────────────

export type MudancaGrade = {
  criadas: number
  desativadas: number
  reativadas: number
  apagadas: number
}

/**
 * Ajusta a grade para o conjunto de combinações que a pessoa escolheu agora.
 *
 * O cuidado inteiro está no que SAI. Uma combinação que deixou de ser
 * escolhida:
 *
 *   • se nunca teve saldo nem venda, some de vez — é lixo de digitação;
 *   • se teve, é DESATIVADA. Apagar levaria junto a venda de março e o saldo
 *     que ainda está na prateleira, e o relatório do mês fechado mudaria
 *     sozinho.
 *
 * E combinação que volta a ser escolhida é REATIVADA, não recriada: recriar
 * daria um código de etiqueta novo para a mesma peça, e a etiqueta antiga
 * (que está colada no produto) deixaria de encontrar qualquer coisa.
 */
export async function ajustarGrade(
  sessao: Sessao,
  produtoId: string,
  eixos: EixoEscolhido[],
): Promise<MudancaGrade> {
  exigir(sessao, 'produto.editar')

  const usados = eixos.filter((e) => e.opcaoIds.length > 0)

  return comoOrg(sessao.orgId, async (db) => {
    const produto = await db.produto.findUnique({
      where: { id: produtoId },
      select: { nome: true },
    })
    if (!produto) throw new Error('Produto não encontrado.')

    const atuais = await db.variacao.findMany({
      where: { produtoId },
      select: {
        id: true,
        ativa: true,
        opcoes: { select: { opcaoId: true } },
        _count: { select: { vendaItens: true, movimentos: true } },
      },
    })

    // A assinatura de uma variação é o conjunto ordenado das opções dela.
    const chave = (ops: string[]) => [...ops].sort().join('|')
    const existente = new Map(atuais.map((v) => [chave(v.opcoes.map((o) => o.opcaoId)), v]))

    const queridas = combinar(usados.map((e) => e.opcaoIds))
    const chavesQueridas = new Set(queridas.map(chave))

    const r: MudancaGrade = { criadas: 0, desativadas: 0, reativadas: 0, apagadas: 0 }

    // ── o que entra ──
    const novas = queridas.filter((c) => !existente.has(chave(c)))
    const codigos = await proximosCodigos(db, prefixoDe(produto.nome), novas.length)
    for (const [i, opcoes] of novas.entries()) {
      await db.variacao.create({
        data: {
          orgId: sessao.orgId,
          produtoId,
          codigo: codigos[i]!,
          padrao: opcoes.length === 0,
          opcoes: { create: opcoes.map((opcaoId) => ({ orgId: sessao.orgId, opcaoId })) },
        },
      })
      r.criadas++
    }

    // ── o que volta ──
    for (const c of queridas) {
      const v = existente.get(chave(c))
      if (v && !v.ativa) {
        await db.variacao.update({ where: { id: v.id }, data: { ativa: true } })
        r.reativadas++
      }
    }

    // ── o que sai ──
    for (const [k, v] of existente) {
      if (chavesQueridas.has(k)) continue
      const temHistoria = v._count.vendaItens > 0 || v._count.movimentos > 0
      if (temHistoria) {
        if (v.ativa) {
          await db.variacao.update({ where: { id: v.id }, data: { ativa: false } })
          r.desativadas++
        }
      } else {
        await db.variacao.delete({ where: { id: v.id } })
        r.apagadas++
      }
    }

    // Os eixos declarados do produto acompanham a escolha.
    await db.produtoEixo.deleteMany({ where: { produtoId } })
    if (usados.length > 0) {
      await db.produtoEixo.createMany({
        data: usados.map((e, i) => ({ orgId: sessao.orgId, produtoId, eixoId: e.eixoId, ordem: i })),
      })
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'produto.grade.alterou',
        alvoTipo: 'produto',
        alvoId: produtoId,
        alvoNome: produto.nome,
        depois: { ...r },
      },
    })

    return r
  })
}

// ─────────────────────────────────────────────────────────────
// LER
// ─────────────────────────────────────────────────────────────

/** O produto com a grade inteira, para a tela de editar. */
export async function acharProduto(sessao: Sessao, produtoId: string) {
  exigir(sessao, 'produto.ver')

  return comoOrg(sessao.orgId, (db) =>
    db.produto.findUnique({
      where: { id: produtoId },
      select: {
        id: true, nome: true, marca: true, descricao: true, categoriaId: true,
        medida: true, precoVista: true, precoCartao: true, precoCrediario: true,
        custo: true, prazoReposicaoDias: true, vendidoEm: true, ativo: true,
        eixos: { orderBy: { ordem: 'asc' }, select: { eixoId: true, ordem: true } },
        variacoes: {
          orderBy: { codigo: 'asc' },
          select: {
            id: true, codigo: true, codigoBarras: true, ativa: true, padrao: true,
            ajustePreco: true,
            opcoes: { select: { opcaoId: true } },
            estoques: { select: { quantidade: true } },
          },
        },
      },
    }),
  )
}

// ─────────────────────────────────────────────────────────────
// COMO O PRODUTO VENDE
// ─────────────────────────────────────────────────────────────

export type ComoVende = {
  porDia: { dia: string; total: number; quantidade: number }[]
  qtd30: number
  total30: number
  qtd90: number
  total90: number
  custo90: number
  ultimaVenda: Date | null
}

/**
 * Os últimos 90 dias deste produto, dia a dia e somados. É o que responde
 * "vale repor?" e "por quanto está saindo?" — a ficha sem isto é cadastro.
 */
export async function comoVende(sessao: Sessao, produtoId: string, unidadeIds?: string[]): Promise<ComoVende> {
  exigir(sessao, 'produto.ver')
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const de90 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 89)
  const de30 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 29)

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.$queryRaw<{ dia: string; total: string; quantidade: string; custo: string }[]>`
      select to_char((v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as dia,
             sum(i.total) as total, sum(i.quantidade) as quantidade,
             sum(i.quantidade * coalesce(i.custo_unit, 0)) as custo
        from venda_itens i
        join vendas v on v.id = i.venda_id
        join variacoes va on va.id = i.variacao_id
       where va.produto_id = ${produtoId} and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${de90}
         ${unidadeIds ? Prisma.sql`and v.unidade_id = any(${unidadeIds})` : Prisma.empty}
       group by 1 order by 1
    `
    const ultima = await db.vendaItem.findFirst({
      where: { variacao: { produtoId }, venda: { situacao: 'CONCLUIDA' } },
      orderBy: { venda: { criadaEm: 'desc' } },
      select: { venda: { select: { criadaEm: true } } },
    })

    const porDia = linhas.map((l) => ({ dia: l.dia, total: Number(l.total), quantidade: Number(l.quantidade) }))
    const chave30 = `${de30.getFullYear()}-${String(de30.getMonth() + 1).padStart(2, '0')}-${String(de30.getDate()).padStart(2, '0')}`
    const d30 = linhas.filter((l) => l.dia >= chave30)
    return {
      porDia,
      qtd30: d30.reduce((s, l) => s + Number(l.quantidade), 0),
      total30: d30.reduce((s, l) => s + Number(l.total), 0),
      qtd90: linhas.reduce((s, l) => s + Number(l.quantidade), 0),
      total90: linhas.reduce((s, l) => s + Number(l.total), 0),
      custo90: linhas.reduce((s, l) => s + Number(l.custo), 0),
      ultimaVenda: ultima?.venda.criadaEm ?? null,
    }
  })
}

/** O saldo de cada item deste produto em cada loja — a grade vista pelo estoque. */
export async function estoqueDoProduto(sessao: Sessao, produtoId: string) {
  exigir(sessao, 'estoque.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.estoque.findMany({
      where: { variacao: { produtoId }, unidade: { ativa: true } },
      select: {
        variacaoId: true, quantidade: true, minimo: true,
        unidade: { select: { id: true, nome: true } },
      },
    })
    return linhas.map((l) => ({
      variacaoId: l.variacaoId,
      unidadeId: l.unidade.id,
      unidade: l.unidade.nome,
      quantidade: Number(l.quantidade),
      minimo: l.minimo === null ? null : Number(l.minimo),
    }))
  })
}

/** Os eixos da empresa com as opções de cada um — o que a tela oferece. */
export async function eixosDaEmpresa(sessao: Sessao) {
  exigir(sessao, 'produto.ver')

  return comoOrg(sessao.orgId, (db) =>
    db.eixo.findMany({
      orderBy: { ordem: 'asc' },
      select: {
        id: true, nome: true, ehCor: true,
        opcoes: { orderBy: { ordem: 'asc' }, select: { id: true, valor: true, hex: true } },
      },
    }),
  )
}
