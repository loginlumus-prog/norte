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
import { exigir, soPelaEmpresa, unidadesQuePodem, type Capacidade, type Sessao } from './permissao'
import { assinarExcecao } from './autorizacao'
import type { BancoDaOrg } from './banco'
import { Prisma, type Medida } from '@prisma/client'
import { alcancaOProduto, alcanceComum, vendidoNaLoja } from './catalogo-loja'
import { diaEmSP, inicioDoDiaEmSP, somarDias } from './dia'

export type EixoEscolhido = {
  eixoId: string
  /** Quais opções deste eixo entram na grade. Vazio = o eixo não é usado. */
  opcaoIds: string[]
}

export type DadosProduto = {
  nome: string
  marca?: string | null
  /** A referência do fornecedor (a da caixa e da nota de compra). */
  referencia?: string | null
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
  /** É serviço: não tem estoque (ver `Produto.servico`). */
  servico?: boolean
  /** Minutos que o serviço ocupa na agenda. Nulo = não informado. */
  duracaoMin?: number | null
  /** Material de uso: tem estoque, não vende (ver `Produto.usoInterno`). */
  usoInterno?: boolean
  /** Feito no dia: zerado depois de fechar não é falta (ver `Produto.feitoNoDia`). */
  feitoNoDia?: boolean
}

export type ResultadoProduto =
  | { ok: true; produtoId: string; variacoes: number }
  /** `precisaPin`: o cadastro pede a assinatura de quem cadastra (a vendedora, ver EXTRAS_DO_BALCAO). */
  | { ok: false; motivo: string; precisaPin?: true }

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
  /** O PIN de quem cadastra, quando o cadastro pede assinatura. */
  pin?: string | null,
): Promise<ResultadoProduto> {
  // Cadastrar é a capacidade própria (o preço de PARTIDA vem junto). Quem tem
  // editar e preço tem esta; a vendedora a ganha quando a empresa deixa
  // (EXTRAS_DO_BALCAO) — e o preço, depois de publicado, continua com quem
  // tem `produto.preco` (ver `editarProduto`).
  exigir(sessao, 'produto.cadastrar')

  const nome = dados.nome.trim()
  if (!nome) return { ok: false, motivo: 'O produto precisa de um nome.' }
  if (dados.precoVista <= 0) return { ok: false, motivo: 'O preço à vista precisa ser maior que zero.' }

  // O gerente cadastra o que a loja DELE vende. Produto que nasce em loja
  // alheia — ou em todas (vazio) — decide preço por quem não estava lá.
  const lojas = dados.vendidoEm ?? []
  if (!alcancaOProduto(alcanceDe(sessao, 'produto.cadastrar'), lojas)) {
    return { ok: false, motivo: MOTIVO_FORA_DO_ALCANCE }
  }

  // A vendedora que cadastra porque a empresa deixou assina sempre, com o
  // PIN dela — foi a condição para deixar. Para quem cadastra pelo papel,
  // cadastro não é exceção: não pede.
  const assinatura = soPelaEmpresa(sessao, 'produto.cadastrar')
    ? await assinarExcecao(sessao, { pin, sempre: true })
    : ({ ok: true, assinou: false } as const)
  if (!assinatura.ok) return { ok: false, motivo: assinatura.erro, precisaPin: true }

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
        referencia: dados.referencia?.trim() || null,
        descricao: dados.descricao?.trim() || null,
        categoriaId: dados.categoriaId || null,
        medida: dados.medida,
        precoVista: dados.precoVista,
        precoCartao: dados.precoCartao ?? dados.precoVista,
        precoCrediario: dados.precoCrediario ?? dados.precoCartao ?? dados.precoVista,
        custo: dados.custo ?? null,
        vendidoEm: dados.vendidoEm ?? [],
        prazoReposicaoDias: dados.prazoReposicaoDias ?? null,
        servico: dados.servico ?? false,
        duracaoMin: dados.duracaoMin ?? null,
        usoInterno: dados.usoInterno ?? false,
        feitoNoDia: dados.feitoNoDia ?? false,
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
        assinado: assinatura.assinou,
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
  /** Nome do que o livro de auditoria escreve, quando não é "alterou" (ver `excluirProduto`). */
  acaoNoLivro?: 'produto.excluiu' | 'produto.reativou',
): Promise<ResultadoProduto> {
  exigir(sessao, 'produto.editar')

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.produto.findUnique({
      where: { id: produtoId },
      select: {
        nome: true, precoVista: true, precoCartao: true, precoCrediario: true, custo: true, ativo: true,
        medida: true, vendidoEm: true, usoInterno: true,
      },
    })
    if (!antes) return { ok: false as const, motivo: 'Produto não encontrado.' }

    if (dados.nome !== undefined && !dados.nome.trim()) {
      return { ok: false as const, motivo: 'O produto precisa de um nome.' }
    }
    if (dados.precoVista !== undefined && dados.precoVista <= 0) {
      return { ok: false as const, motivo: 'O preço à vista precisa ser maior que zero.' }
    }

    // O que MUDOU de fato, e não o que veio no formulário. A ficha manda
    // todos os campos a cada "Salvar": contar presença como mudança travaria
    // o gerente de corrigir o nome de uma peça que a loja dele divide com
    // outra, e escreveria "alterou o preço" no livro sem o preço ter mudado.
    const mexeuNoCusto = mudou(dados.custo, antes.custo, 4)
    const mexeuNoPreco =
      mudou(dados.precoVista, antes.precoVista) ||
      mudou(dados.precoCartao, antes.precoCartao) ||
      mudou(dados.precoCrediario, antes.precoCrediario) ||
      mexeuNoCusto
    const mexeuNoVendidoEm = dados.vendidoEm !== undefined && !mesmasLojas(dados.vendidoEm, antes.vendidoEm)
    const mexeuNoResto =
      mexeuNoVendidoEm ||
      (dados.ativo !== undefined && dados.ativo !== antes.ativo) ||
      (dados.medida !== undefined && dados.medida !== antes.medida) ||
      // Virar material de uso tira o produto do balcão de TODAS as lojas dele:
      // é decisão do mesmo tamanho que tirar de venda.
      (dados.usoInterno !== undefined && dados.usoInterno !== antes.usoInterno)

    if (mexeuNoPreco) exigir(sessao, 'produto.preco')
    // Preço, custo, lojas, medida e situação valem em TODA loja onde o
    // produto é vendido: quem decide precisa alcançar cada uma — antes e
    // depois da mudança (tirar uma loja também é decidir por ela).
    if (mexeuNoPreco && !alcancaOProduto(alcanceDe(sessao, 'produto.preco'), antes.vendidoEm)) {
      return { ok: false as const, motivo: MOTIVO_FORA_DO_ALCANCE }
    }
    if (mexeuNoResto && !alcancaOProduto(alcanceDe(sessao, 'produto.editar'), antes.vendidoEm)) {
      return { ok: false as const, motivo: MOTIVO_FORA_DO_ALCANCE }
    }
    if (mexeuNoVendidoEm && !alcancaOProduto(alcanceDe(sessao, 'produto.editar'), dados.vendidoEm)) {
      return { ok: false as const, motivo: MOTIVO_FORA_DO_ALCANCE }
    }
    // E o resto da ficha (nome, descrição, marca, categoria, serviço, feito
    // no dia) também é de quem cuida do produto: ele precisa passar pelo
    // balcão de alguma loja de quem edita. `produto.editar` sem loja deixava o
    // gerente do Centro renomear o picolé que só a sorveteria vende. Vendido
    // em todas (vazio) inclui as lojas que abrirem: só quem edita pela
    // empresa inteira alcança.
    if (!tocaAlguma(alcanceDe(sessao, 'produto.editar'), antes.vendidoEm)) {
      return { ok: false as const, motivo: MOTIVO_DE_OUTRA_LOJA }
    }

    // ── a medida não muda por cima do saldo ──
    // Trocar quilo por grama com 11 kg na prateleira não converte nada: o
    // saldo passava a ser "11 g", e o preço por quilo virava preço por grama.
    if (dados.medida !== undefined && dados.medida !== antes.medida) {
      const comSaldo = await saldosDoProduto(db, produtoId)
      if (comSaldo.length > 0) {
        return {
          ok: false as const,
          motivo:
            `Ainda tem saldo deste produto (${comSaldo.map((s) => `${s.loja}: ${s.quantidade.toLocaleString('pt-BR')}`).join('; ')}). ` +
            'Trocar a medida não converte o estoque. Zere antes na tela de Estoque — ou cadastre um produto novo na medida nova.',
        }
      }
    }

    // ── tirar uma loja não pode deixar mercadoria presa nela ──
    // A loja que deixa de vender o produto não vende mais o que tem na
    // prateleira (o balcão recusa) — o saldo vira dinheiro parado que nenhuma
    // tela mostra. Recusa e diz quanto transferir, de onde.
    if (mexeuNoVendidoEm) {
      const lojas = await db.unidade.findMany({ where: { ativa: true, ehDeposito: false }, select: { id: true } })
      const saem = lojas
        .map((l) => l.id)
        .filter((u) => vendidoNaLoja(antes.vendidoEm, u) && !vendidoNaLoja(dados.vendidoEm, u))
      if (saem.length > 0) {
        const presos = await saldosDoProduto(db, produtoId, saem)
        if (presos.length > 0) {
          return {
            ok: false as const,
            motivo:
              `Ainda tem estoque nas lojas que você está tirando: ${presos.map((s) => `${s.loja} — ${s.item}: ${s.quantidade.toLocaleString('pt-BR')}`).join('; ')}. ` +
              'Transfira para uma loja que continua vendendo (ou para um depósito) na tela de Estoque, e depois tire a loja.',
          }
        }
      }
    }

    await db.produto.update({
      where: { id: produtoId },
      data: {
        ...(dados.nome !== undefined && { nome: dados.nome.trim() }),
        ...(dados.marca !== undefined && { marca: dados.marca?.trim() || null }),
        ...(dados.referencia !== undefined && { referencia: dados.referencia?.trim() || null }),
        ...(dados.descricao !== undefined && { descricao: dados.descricao?.trim() || null }),
        ...(dados.categoriaId !== undefined && { categoriaId: dados.categoriaId || null }),
        ...(dados.medida !== undefined && { medida: dados.medida }),
        ...(dados.precoVista !== undefined && { precoVista: dados.precoVista }),
        ...(dados.precoCartao !== undefined && { precoCartao: dados.precoCartao }),
        ...(dados.precoCrediario !== undefined && { precoCrediario: dados.precoCrediario }),
        ...(dados.custo !== undefined && { custo: dados.custo }),
        ...(dados.vendidoEm !== undefined && { vendidoEm: dados.vendidoEm }),
        ...(dados.prazoReposicaoDias !== undefined && { prazoReposicaoDias: dados.prazoReposicaoDias }),
        ...(dados.servico !== undefined && { servico: dados.servico }),
        ...(dados.duracaoMin !== undefined && { duracaoMin: dados.duracaoMin }),
        ...(dados.usoInterno !== undefined && { usoInterno: dados.usoInterno }),
        ...(dados.feitoNoDia !== undefined && { feitoNoDia: dados.feitoNoDia }),
        ...(dados.ativo !== undefined && { ativo: dados.ativo }),
      },
    })
    // O custo digitado na ficha é o custo de TODAS as variações: o custo
    // próprio que cada sabor ganhou na fábrica (ou cada tamanho na nota) sai,
    // senão continuaria valendo por cima do que a pessoa acabou de decidir.
    if (mexeuNoCusto) {
      await db.variacao.updateMany({ where: { produtoId, custo: { not: null } }, data: { custo: null } })
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: acaoNoLivro ?? (mexeuNoPreco ? 'produto.preco.alterou' : 'produto.alterou'),
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

/**
 * "Excluir produto": o produto nunca é apagado de verdade (venda, estoque e
 * relatório antigos apontam para ele) — sai de venda, e some do balcão, da
 * lista, do catálogo e do estoque. É `ativo = false` pela mesma regra de
 * `editarProduto` (permissão, alcance de loja), só que o livro diz "excluiu"
 * em vez de "alterou", e a pessoa o acha pelo nome que ela usa.
 */
export const excluirProduto = (sessao: Sessao, produtoId: string) =>
  editarProduto(sessao, produtoId, { ativo: false }, 'produto.excluiu')

/** O contrário de `excluirProduto`: de volta ao balcão, com a grade e o saldo. */
export const reativarProduto = (sessao: Sessao, produtoId: string) =>
  editarProduto(sessao, produtoId, { ativo: true }, 'produto.reativou')

/** A grade não pode mudar como pedido — a mensagem diz o que resolver antes. */
export class GradeRecusada extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'GradeRecusada'
  }
}

/** Frase única para o "não é seu para decidir": a tela e o teste usam a mesma. */
export const MOTIVO_FORA_DO_ALCANCE =
  'Este produto também é vendido em lojas que você não cuida. Preço, custo, lojas, medida, situação e grade dele ficam com quem responde por todas elas.'

/** Frase do produto que não passa por nenhuma loja de quem tenta editar. */
export const MOTIVO_DE_OUTRA_LOJA =
  'Este produto não é vendido em nenhuma das suas lojas. Quem cuida dele é quem responde pelas lojas onde ele é vendido.'

function alcanceDe(sessao: Sessao, capacidade: Capacidade) {
  return unidadesQuePodem(sessao, capacidade)
}

/**
 * O alcance toca alguma loja onde o produto é vendido? Vazio = todas,
 * inclusive as futuras: só quem alcança a empresa inteira.
 */
function tocaAlguma(alcance: 'todas' | readonly string[], vendidoEm: readonly string[]): boolean {
  if (alcance === 'todas') return true
  if (vendidoEm.length === 0) return false
  return vendidoEm.some((u) => alcance.includes(u))
}

/** O saldo diferente de zero do produto, por loja e item — nas lojas pedidas, ou em todas. */
async function saldosDoProduto(db: BancoDaOrg, produtoId: string, unidadeIds?: string[]) {
  const linhas = await db.estoque.findMany({
    where: { variacao: { produtoId }, quantidade: { not: 0 }, ...(unidadeIds ? { unidadeId: { in: unidadeIds } } : {}) },
    select: {
      quantidade: true,
      unidade: { select: { nome: true } },
      variacao: { select: { codigo: true, padrao: true } },
    },
    take: 20,
  })
  return linhas.map((l) => ({
    loja: l.unidade.nome,
    item: l.variacao.padrao ? 'o item' : (l.variacao.codigo ?? 'item'),
    quantidade: Number(l.quantidade),
  }))
}

/**
 * O campo veio e é diferente do que está gravado? Dinheiro compara em
 * centavos; o custo, em quatro casas (o mililitro de calda custa R$ 0,0028).
 */
function mudou(novo: number | null | undefined, antigo: unknown, casas = 2): boolean {
  if (novo === undefined) return false
  const f = 10 ** casas
  const a = antigo == null ? null : Math.round(Number(antigo) * f)
  const n = novo == null ? null : Math.round(novo * f)
  return a !== n
}

const mesmasLojas = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

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
      select: { nome: true, vendidoEm: true, eixos: { orderBy: { ordem: 'asc' }, select: { eixoId: true } } },
    })
    if (!produto) throw new Error('Produto não encontrado.')

    const atuais = await db.variacao.findMany({
      where: { produtoId },
      select: {
        id: true,
        ativa: true,
        padrao: true,
        opcoes: { select: { opcaoId: true, opcao: { select: { valor: true } } } },
        _count: { select: { vendaItens: true, movimentos: true } },
        // Saldo em QUALQUER loja, aberta ou fechada: é mercadoria que existe.
        estoques: { where: { quantidade: { not: 0 } }, select: { quantidade: true, unidade: { select: { nome: true } } } },
      },
    })

    // A assinatura de uma variação é o conjunto ordenado das opções dela.
    const chave = (ops: string[]) => [...ops].sort().join('|')
    const existente = new Map(atuais.map((v) => [chave(v.opcoes.map((o) => o.opcaoId)), v]))

    const queridas = combinar(usados.map((e) => e.opcaoIds))
    const chavesQueridas = new Set(queridas.map(chave))

    const r: MudancaGrade = { criadas: 0, desativadas: 0, reativadas: 0, apagadas: 0 }

    // ── muda alguma coisa? ──
    // A conta vem ANTES de escrever: grade que não muda não pede alcance
    // nenhum (é o "Salvar" de quem só corrigiu o nome), e grade que muda vale
    // para o balcão de toda loja que vende o produto.
    const novas = queridas.filter((c) => !existente.has(chave(c)))
    const voltam = queridas.filter((c) => existente.get(chave(c))?.ativa === false)
    const saem = [...existente].filter(([k, v]) => !chavesQueridas.has(k) && (v.ativa || (v._count.vendaItens === 0 && v._count.movimentos === 0)))
    const eixosIguais = produto.eixos.map((e) => e.eixoId).join('|') === usados.map((e) => e.eixoId).join('|')
    if (novas.length === 0 && voltam.length === 0 && saem.length === 0 && eixosIguais) return r
    if (!alcancaOProduto(alcanceDe(sessao, 'produto.editar'), produto.vendidoEm)) {
      throw new Error(MOTIVO_FORA_DO_ALCANCE)
    }

    // ── o que sai não pode levar saldo junto ──
    // Variação desativada some de toda tela de estoque (todas listam só as
    // ativas) e continua vendável por quem bipar a etiqueta velha. O caso que
    // achou isto: camiseta cadastrada sem grade, com 30 na prateleira; a dona
    // marca as cores, o item "sem variação" sai — e as 30 somem da vista. Mover
    // o saldo sozinho para uma das cores seria adivinhar qual cor é cada peça;
    // recusar e dizer o caminho é o seguro.
    const comSaldo = saem.filter(([, v]) => v.estoques.length > 0)
    if (comSaldo.length > 0) {
      const partes = comSaldo.map(([, v]) => {
        const nome = v.padrao || v.opcoes.length === 0 ? 'o item sem variação' : v.opcoes.map((o) => o.opcao.valor).join(' · ')
        const onde = v.estoques.map((e) => `${e.unidade.nome}: ${Number(e.quantidade).toLocaleString('pt-BR')}`).join(', ')
        return `${nome} (${onde})`
      })
      throw new GradeRecusada(
        `Ainda tem saldo em ${partes.join('; ')}. Zere antes na tela de Estoque — transfira, ` +
          'registre a perda ou corrija pelo que foi contado — e depois tire da grade.',
      )
    }

    // ── o que entra ──
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

/**
 * As lojas ABERTAS que a pessoa alcança com estas capacidades, ou 'todas'.
 *
 * É o recorte de toda leitura por loja desta ficha: o gerente da loja
 * Centro abre a camiseta que também sai no Shopping e lê o saldo, a venda e a
 * margem do Centro — não os do Shopping, que não são dele.
 */
function lojasAlcancadas(sessao: Sessao, ...capacidades: Capacidade[]): 'todas' | string[] {
  let alcance: 'todas' | readonly string[] = 'todas'
  for (const c of capacidades) alcance = alcanceComum(alcance, unidadesQuePodem(sessao, c))
  return alcance === 'todas' ? 'todas' : [...alcance]
}

/** O filtro de loja do Prisma para um alcance: aberta, e dentro dele. */
const lojaNoAlcance = (alcance: 'todas' | string[]) =>
  alcance === 'todas' ? { unidade: { ativa: true } } : { unidadeId: { in: alcance }, unidade: { ativa: true } }

/**
 * O produto com a grade inteira, para a tela de editar.
 *
 * O saldo de cada variação vem SÓ das lojas abertas que a pessoa alcança com
 * `estoque.ver` — o mesmo recorte do Estoque e dos Produtos. Antes vinha de
 * todas, e a ficha do gerente de uma loja somava o saldo da rede inteira:
 * três telas, três números para a mesma peça.
 */
export async function acharProduto(sessao: Sessao, produtoId: string) {
  exigir(sessao, 'produto.ver')
  const alcance = lojasAlcancadas(sessao, 'estoque.ver')

  return comoOrg(sessao.orgId, (db) =>
    db.produto.findUnique({
      where: { id: produtoId },
      select: {
        id: true, nome: true, marca: true, referencia: true, descricao: true, categoriaId: true,
        medida: true, precoVista: true, precoCartao: true, precoCrediario: true,
        custo: true, prazoReposicaoDias: true, vendidoEm: true, ativo: true, servico: true, duracaoMin: true,
        usoInterno: true, feitoNoDia: true, fotoId: true,
        eixos: { orderBy: { ordem: 'asc' }, select: { eixoId: true, ordem: true } },
        variacoes: {
          orderBy: { codigo: 'asc' },
          select: {
            id: true, codigo: true, codigoBarras: true, ativa: true, padrao: true,
            ajustePreco: true,
            opcoes: { select: { opcaoId: true } },
            estoques: { where: lojaNoAlcance(alcance), select: { quantidade: true } },
            // O "já tem venda ou movimento" da ficha: contado, não suposto.
            _count: { select: { vendaItens: true, movimentos: true } },
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
 *
 * Só as lojas que a pessoa alcança com `produto.ver` E `venda.ver` entram —
 * e, se quem chama pedir lojas, só as pedidas dentro desse alcance. O
 * faturamento da loja vizinha não é do gerente desta.
 */
export async function comoVende(sessao: Sessao, produtoId: string, unidadeIds?: string[]): Promise<ComoVende> {
  exigir(sessao, 'produto.ver')
  const alcance = lojasAlcancadas(sessao, 'produto.ver', 'venda.ver')
  const lojas =
    alcance === 'todas' ? unidadeIds : (unidadeIds ?? alcance).filter((u) => alcance.includes(u))
  if (lojas && lojas.length === 0) {
    return { porDia: [], qtd30: 0, total30: 0, qtd90: 0, total90: 0, custo90: 0, ultimaVenda: null }
  }
  // Os dias são os de São Paulo, como o `to_char` da consulta: com o relógio
  // da máquina, num servidor em UTC a venda das 22h caía no dia seguinte.
  const hoje = diaEmSP()
  const de90 = inicioDoDiaEmSP(somarDias(hoje, -89))
  const chave30 = somarDias(hoje, -29)

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
         ${lojas ? Prisma.sql`and v.unidade_id = any(${lojas})` : Prisma.empty}
       group by 1 order by 1
    `
    const ultima = await db.vendaItem.findFirst({
      where: {
        variacao: { produtoId },
        venda: { situacao: 'CONCLUIDA', ...(lojas ? { unidadeId: { in: lojas } } : {}) },
      },
      orderBy: { venda: { criadaEm: 'desc' } },
      select: { venda: { select: { criadaEm: true } } },
    })

    const porDia = linhas.map((l) => ({ dia: l.dia, total: Number(l.total), quantidade: Number(l.quantidade) }))
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

/**
 * O saldo de cada item deste produto em cada loja — a grade vista pelo
 * estoque. Só as lojas abertas que a pessoa alcança com `estoque.ver`.
 */
export async function estoqueDoProduto(sessao: Sessao, produtoId: string) {
  exigir(sessao, 'estoque.ver')
  const alcance = lojasAlcancadas(sessao, 'estoque.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.estoque.findMany({
      where: { variacao: { produtoId }, ...lojaNoAlcance(alcance) },
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

/**
 * Quem pode ver o CUSTO (e a margem) deste produto?
 *
 * Quem tem `produto.preco` em alguma loja onde ele é vendido. O custo é um
 * número só para a empresa; o que decide é se o produto passa pelo balcão de
 * alguma loja da pessoa. O gerente da loja de roupa não lê o custo do picolé
 * que só a sorveteria vende.
 */
export function podeVerCustoDe(sessao: Sessao, vendidoEm: readonly string[] | null | undefined): boolean {
  const alcance = unidadesQuePodem(sessao, 'produto.preco')
  if (alcance === 'todas') return true
  if (alcance.length === 0) return false
  if (!vendidoEm || vendidoEm.length === 0) return true
  return vendidoEm.some((u) => alcance.includes(u))
}

// ─────────────────────────────────────────────────────────────
// O SALDO NUMA VISTA (Produtos e Estoque contam do mesmo jeito)
// ─────────────────────────────────────────────────────────────

export type LinhaDeSaldo = { unidadeId: string; quantidade: number; minimo: number | null }
export type LojaDaVista = { id: string; ehDeposito: boolean }

export type SaldoNaVista = {
  /** A variação entra na lista e na conta desta vista? */
  aparece: boolean
  saldo: number
  /** O maior mínimo entre as lojas da vista; 0 = sem mínimo. */
  minimo: number
  nivel: 'critico' | 'atencao' | 'bom'
  /**
   * Zerado, mas é feito no dia: a sobra saiu como perda ao fechar e amanhã
   * cedo sai fornada nova. A tela escreve "feito no dia" em vez de "acabou",
   * e o nível fica neutro — não entra no "acabaram".
   */
  doDia?: boolean
  /**
   * Nenhuma loja da vista tem linha de estoque desta variação: nunca houve
   * entrada, contagem nem venda que mexesse no saldo. É "ainda não controlo",
   * não "acabou" — a empresa que acabou de chegar ao sistema veria o catálogo
   * inteiro em vermelho. Nível neutro, fora do "acabaram".
   */
  semLancamento?: boolean
}

/**
 * O saldo de uma variação nas lojas que a tela está olhando, e se ela conta.
 *
 * É UMA conta para as duas telas. Antes, Produtos pegava o mínimo da
 * primeira loja e contava como "acabou" o item que a loja nem vende; o
 * Estoque pegava o maior mínimo e pulava esse item — e o "12 acabaram" de
 * uma não batia com o "9 acabaram" da outra, para a mesma pessoa.
 *
 * Aparece quando alguma loja da vista vende o produto (depósito não vende),
 * ou quando há linha de saldo que conta como falta (a régua de
 * `contaComoFalta`: saldo diferente de zero, ou linha de depósito). `todas` =
 * a vista é a empresa inteira de quem responde por ela: aí tudo aparece,
 * inclusive o produto de uma loja que fechou — senão ele sumiria de todo lugar.
 */
export function saldoNaVista(
  vendidoEm: readonly string[] | null | undefined,
  linhas: readonly LinhaDeSaldo[],
  lojas: readonly LojaDaVista[],
  todas = false,
  feitoNoDia = false,
): SaldoNaVista {
  const naVista = linhas.filter((l) => lojas.some((u) => u.id === l.unidadeId))
  const saldo = naVista.reduce((t, l) => t + l.quantidade, 0)
  const minimo = naVista.reduce((m, l) => Math.max(m, l.minimo ?? 0), 0)
  const deposito = new Set(lojas.filter((u) => u.ehDeposito).map((u) => u.id))
  const aparece =
    todas ||
    lojas.some((u) => !u.ehDeposito && vendidoNaLoja(vendidoEm, u.id)) ||
    naVista.some((l) => l.quantidade !== 0 || deposito.has(l.unidadeId))
  // O que é feito no dia zera todo fim de tarde por desenho — "11 acabaram"
  // na padaria às 20h é o dia que deu certo, não falta. A padaria continua
  // vendo o saldo; só não recebe o alarme.
  if (saldo <= 0 && feitoNoDia) return { aparece, saldo, minimo, nivel: 'bom', doDia: true }
  if (naVista.length === 0) return { aparece, saldo, minimo, nivel: 'bom', semLancamento: true }
  const nivel = saldo <= 0 ? 'critico' : minimo > 0 && saldo <= minimo ? 'atencao' : 'bom'
  return { aparece, saldo, minimo, nivel }
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
