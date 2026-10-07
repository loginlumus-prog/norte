// Entrada de mercadoria.
//
// É a operação que enche o estoque, e ela toca três coisas que normalmente
// moram em telas diferentes:
//
//   1. o SALDO sobe;
//   2. o CUSTO da peça passa a ser o CUSTO MÉDIO do que está na prateleira
//      com o que chegou — é ele que vira CMV quando a peça vender, e é dele
//      que sai a margem do mês;
//   3. o FORNECEDOR passa a ter uma conta a pagar.
//
// Fazer as três de uma vez é o ponto: quem recebe a caixa do fornecedor faz
// isso uma vez por semana, e é o momento em que a informação está fresca.
// Separado em três telas, o custo nunca é atualizado e a conta é lançada de
// cabeça no fim do mês, com o valor errado.
//
// ── e as três têm permissões diferentes ─────────────────────
// Dar entrada é `estoque.ajustar`. Mexer no custo é `produto.preco`. Lançar a
// conta é `financeiro.lancar`. Quem só tem a primeira registra a entrada e o
// resto simplesmente não acontece — o resultado diz o que foi feito, para a
// tela não mentir que gravou tudo.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, soPelaEmpresa, unidadesQuePodem, type Sessao } from './permissao'
import { assinarExcecao } from './autorizacao'
import { mexerEstoqueEm } from './estoque'
import { centavos, multiplicar, reais } from './dinheiro'
import { colunaDoDia, diaEmSP } from './dia'
import { alcancaOProduto, vendidoNaLoja } from './catalogo-loja'

/** Teto de uma linha de entrada: mais que isto é dedo (um zero a mais), não mercadoria. */
export const QUANTIDADE_MAXIMA = 1_000_000
const CUSTO_MAXIMO = 10_000_000

export type ItemEntrada = {
  variacaoId: string
  quantidade: number
  /** Quanto custou a unidade nesta compra. Sem isto, o custo fica como está. */
  custoUnit?: number | null
}

export type NovaEntrada = {
  unidadeId: string
  fornecedor?: string
  /** Número da nota ou do pedido. */
  documento?: string
  itens: ItemEntrada[]
  /** Gera a conta a pagar do fornecedor. */
  conta?: {
    categoriaId: string
    vencimento: Date
    jaPago: boolean
  }
  /**
   * Sorteada quando a tela abriu. O mesmo envio repetido (o clique duplo, a
   * internet que caiu depois de gravar) não dá entrada de novo.
   */
  chave?: string | null
  /**
   * A mesma nota do mesmo fornecedor já entrou nesta loja e a pessoa disse
   * que é outra entrega com o mesmo número. Sem isto, a segunda é recusada.
   */
  repetirDocumento?: boolean
  /** O PIN de quem dá entrada, quando ela pede assinatura (a vendedora). */
  pin?: string | null
}

export type ResultadoEntrada =
  | {
      ok: true
      itens: number
      /** Soma de quantidade × custo, em reais. */
      total: number
      custosAtualizados: number
      contaLancada: boolean
      /** O que não foi feito por falta de permissão, para a tela avisar. */
      naoFeito: string[]
      /** Esta chave já tinha dado entrada: nada mudou agora. */
      repetido?: true
    }
  | {
      ok: false
      motivo: string
      /** A assinatura de quem dá entrada (o PIN dela) — a tela mostra o campo. */
      precisaPin?: true
      /** A mesma nota já entrou: a tela pergunta se é outra entrega. */
      documentoRepetido?: true
    }

/** Há quanto tempo uma nota repetida ainda é "a mesma nota". */
const JANELA_DA_NOTA_DIAS = 365

export async function registrarEntrada(
  sessao: Sessao,
  e: NovaEntrada,
): Promise<ResultadoEntrada> {
  exigir(sessao, 'estoque.ajustar', e.unidadeId)

  // Quem dá entrada porque a EMPRESA deixou (a vendedora, ver
  // EXTRAS_DO_BALCAO) assina sempre, com o PIN dela — como na correção do
  // estoque. Entrada de mercadoria não é exceção: para os outros, não pede.
  let assinou = false
  if (soPelaEmpresa(sessao, 'estoque.ajustar', e.unidadeId)) {
    const a = await assinarExcecao(sessao, { pin: e.pin, sempre: true })
    if (!a.ok) return { ok: false, motivo: a.erro, precisaPin: true }
    assinou = a.assinou
  }

  const chave = typeof e.chave === 'string' ? e.chave.trim().slice(0, 64) : ''
  const documento = e.documento?.trim() ?? ''
  return comoOrg(sessao.orgId, async (db) => {
    // ── a mesma entrada, de novo ──
    // A chave é sorteada pela tela: o segundo clique (ou o reenvio depois de
    // a internet cair) espera o primeiro gravar, acha a linha dele no livro
    // e devolve o que ele fez, sem dar entrada outra vez.
    if (chave.length >= 8) {
      await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`entrada:${sessao.orgId}:${chave}`}))`
      const ja = await db.auditoria.findFirst({
        where: { alvoTipo: 'entrada', alvoId: chave },
        select: { valor: true, depois: true },
      })
      if (ja) {
        const d = (ja.depois ?? {}) as { itens?: number; contaLancada?: boolean }
        return {
          ok: true as const,
          repetido: true as const,
          itens: Number(d.itens ?? 0),
          total: Number(ja.valor ?? 0),
          custosAtualizados: 0,
          contaLancada: d.contaLancada === true,
          naoFeito: [],
        }
      }
    }

    // ── a mesma NOTA, de novo ──
    // Quem recebe duas caixas da mesma nota, ou digita a nota de ontem outra
    // vez, dobrava o saldo e a conta a pagar sem aviso. A nota do mesmo
    // fornecedor nesta loja é recusada com o dia em que entrou; se é mesmo
    // outra entrega com o mesmo número, a pessoa confirma.
    if (documento && !e.repetirDocumento) {
      const desde = new Date(Date.now() - JANELA_DA_NOTA_DIAS * 864e5)
      const ja = await db.auditoria.findFirst({
        where: {
          acao: 'estoque.entrada',
          unidadeId: e.unidadeId,
          criadoEm: { gte: desde },
          motivo: { equals: documento, mode: 'insensitive' },
          alvoNome: { equals: e.fornecedor?.trim() || 'Entrada de mercadoria', mode: 'insensitive' },
        },
        orderBy: { criadoEm: 'desc' },
        select: { criadoEm: true, quem: true },
      })
      if (ja) {
        const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(ja.criadoEm)
        return {
          ok: false as const,
          documentoRepetido: true as const,
          motivo:
            `A nota ${documento}${e.fornecedor?.trim() ? ` de ${e.fornecedor.trim()}` : ''} já entrou nesta loja em ${dia} (por ${ja.quem}). ` +
            'Se é outra entrega com o mesmo número, confirme para dar entrada de novo.',
        }
      }
    }

    return registrarEntradaEm(db, sessao, { ...e, chave: chave.length >= 8 ? chave : null }, assinou)
  })
}

/**
 * A mesma entrada, DENTRO de uma transação que já está aberta.
 *
 * O recebimento de um pedido de compra (compras.ts) precisa disto: dar
 * entrada e marcar o pedido como recebido têm de acontecer juntos, ou nenhum
 * dos dois — senão o clique duplo dá entrada duas vezes, ou o pedido fica
 * "recebido" sem a mercadoria no estoque. É o mesmo caminho da tela de
 * entrada, sem cópia: saldo, custo e conta a pagar, com as mesmas travas.
 */
export async function registrarEntradaEm(
  db: BancoDaOrg,
  sessao: Sessao,
  e: NovaEntrada,
  /** Quem chamou já conferiu o PIN de quem dá entrada (vai para o livro). */
  assinou = false,
): Promise<ResultadoEntrada> {
  exigir(sessao, 'estoque.ajustar', e.unidadeId)

  const itens = e.itens.filter((i) => i.quantidade > 0)
  if (itens.length === 0) return { ok: false, motivo: 'Nenhum item com quantidade.' }
  // `Infinity > 0` é verdade, e o Postgres guarda infinito em numeric.
  if (itens.some((i) => !Number.isFinite(i.quantidade))) return { ok: false, motivo: 'Uma das quantidades não é um número.' }
  if (itens.some((i) => i.quantidade > QUANTIDADE_MAXIMA)) {
    return { ok: false, motivo: `Uma das quantidades passa de ${QUANTIDADE_MAXIMA.toLocaleString('pt-BR')}. Confira se não sobrou um zero.` }
  }
  if (itens.some((i) => i.custoUnit != null && !(Number.isFinite(i.custoUnit) && i.custoUnit >= 0))) {
    return { ok: false, motivo: 'O custo de uma peça não pode ser negativo.' }
  }
  if (itens.some((i) => i.custoUnit != null && i.custoUnit > CUSTO_MAXIMO)) {
    return { ok: false, motivo: 'O custo de uma das peças está alto demais. Confira se não sobrou um zero.' }
  }
  if (e.conta && Number.isNaN(e.conta.vencimento.getTime())) {
    return { ok: false, motivo: 'A data de vencimento da conta não é uma data.' }
  }

  const podeCusto = pode(sessao, 'produto.preco')
  const podeLancar = e.conta ? pode(sessao, 'financeiro.lancar', e.unidadeId) : true

  const naoFeito: string[] = []
  if (!podeCusto && itens.some((i) => i.custoUnit != null)) {
    naoFeito.push('o custo das peças (precisa de permissão de preço)')
  }
  if (e.conta && !podeLancar) {
    naoFeito.push('a conta a pagar do fornecedor (precisa de permissão do financeiro)')
  }

  {
    // Tudo numa transação: ou o saldo sobe, o custo muda e a conta nasce, ou
    // nada disso acontece. Meio-termo aqui é estoque que existe no sistema e
    // não foi pago, ou conta paga de mercadoria que não entrou.
    const loja = await db.unidade.findUnique({
      where: { id: e.unidadeId },
      select: { nome: true, ativa: true, ehDeposito: true },
    })
    if (!loja) return { ok: false as const, motivo: 'Loja não encontrada nesta empresa.' }
    if (!loja.ativa) return { ok: false as const, motivo: `${loja.nome} está fechada. Reabra a loja antes de dar entrada nela.` }

    const variacoes = await db.variacao.findMany({
      where: { id: { in: itens.map((i) => i.variacaoId) } },
      select: {
        id: true,
        produtoId: true,
        ativa: true,
        composicao: { select: { id: true }, take: 1 },
        produto: { select: { nome: true, vendidoEm: true, ativo: true } },
      },
    })
    const produtoDaVariacao = new Map(variacoes.map((v) => [v.id, v.produto]))
    if (variacoes.length !== new Set(itens.map((i) => i.variacaoId)).size) {
      return { ok: false as const, motivo: 'Um dos itens não existe nesta empresa.' }
    }
    // Item fora de uso some do Estoque: o saldo que entrasse nele ficaria
    // invisível.
    const parados = [...new Set(variacoes.filter((v) => !v.ativa || !v.produto.ativo).map((v) => v.produto.nome))]
    if (parados.length > 0) {
      return { ok: false as const, motivo: `${parados.join(', ')} não está em uso. Reative na ficha do produto antes de dar entrada.` }
    }
    // Item composto não tem estoque próprio: a venda baixa os componentes, e
    // o que entrasse no próprio combo nunca mais sairia.
    const compostos = [...new Set(variacoes.filter((v) => v.composicao.length > 0).map((v) => v.produto.nome))]
    if (compostos.length > 0) {
      return {
        ok: false as const,
        motivo: `${compostos.join(', ')} é montado com outros itens e não tem estoque próprio. Dê entrada nos componentes.`,
      }
    }

    // Mercadoria só entra onde ela pode ser vendida — ou num depósito, que
    // guarda o que as lojas vão vender. Peça que entra na sorveteria sem a
    // sorveteria vender aquilo fica presa: o balcão recusa a venda (ver
    // `catalogo-loja.ts`) e o saldo vira dinheiro parado que ninguém acha.
    if (!loja.ehDeposito) {
      const fora = [...new Set(variacoes.filter((v) => !vendidoNaLoja(v.produto.vendidoEm, e.unidadeId)).map((v) => v.produto.nome))]
      if (fora.length > 0) {
        return {
          ok: false as const,
          motivo: `${loja.nome} não vende ${fora.join(', ')}. Marque a loja na ficha do produto, ou dê entrada num depósito.`,
        }
      }
    }

    // A categoria da conta do fornecedor vem do navegador: precisa ser uma
    // categoria de DESPESA desta empresa, senão o DRE soma a compra como
    // receita (ou nasce um lançamento apontando para categoria alheia).
    if (e.conta && podeLancar) {
      const cat = await db.categoriaFinanceira.findUnique({ where: { id: e.conta.categoriaId }, select: { tipo: true } })
      if (!cat || cat.tipo !== 'DESPESA') return { ok: false as const, motivo: 'Escolha uma categoria de despesa para a conta.' }
    }

    // ── 1. o saldo ──
    let totalCent = 0
    for (const i of itens) {
      const r = await mexerEstoqueEm(db, sessao, {
        variacaoId: i.variacaoId,
        unidadeId: e.unidadeId,
        tipo: 'ENTRADA',
        quantidade: i.quantidade,
        motivo: e.fornecedor ? `Entrada — ${e.fornecedor}` : 'Entrada de mercadoria',
        referencia: e.documento,
      })
      if (!r.ok) return { ok: false as const, motivo: 'Não deu para dar entrada neste item.' }
      // `multiplicar` arredonda: com quantidade quebrada (2,5 kg) a conta
      // dava centavo fracionado, e a soma carregava a fração até o lançamento.
      if (i.custoUnit != null) totalCent += multiplicar(centavos(i.custoUnit), i.quantidade)
    }

    // ── 2. o custo ──
    // Vale o CUSTO MÉDIO: o que já estava na prateleira, ao custo de antes,
    // mais o que chegou, ao custo desta nota. "O custo da última compra"
    // fazia as 98 peças compradas a R$ 10 passarem a custar R$ 15 porque
    // chegaram 10 a R$ 15 — e toda venda seguinte gravava a margem errada.
    //
    // Item que chegou de graça (bonificação, brinde) não mexe no custo:
    // custo zero na nota não é o custo da peça, e virava CMV zero em toda
    // venda até a próxima compra.
    let custosAtualizados = 0
    if (podeCusto) {
      // O custo é do produto, e o produto pode ser vendido em lojas que quem
      // dá a entrada não cuida: a margem de lá mudaria sem ninguém de lá ter
      // decidido. A mercadoria entra; o custo fica como estava — e a tela diz.
      const alcance = unidadesQuePodem(sessao, 'produto.preco')
      const deOutros = new Set<string>()
      const comCusto: { variacaoId: string; quantidade: number; custoUnit: number }[] = []
      for (const i of itens) {
        if (i.custoUnit == null || !(i.custoUnit > 0)) continue
        const produto = produtoDaVariacao.get(i.variacaoId)
        if (produto && !alcancaOProduto(alcance, produto.vendidoEm)) {
          deOutros.add(produto.nome)
          continue
        }
        comCusto.push({ variacaoId: i.variacaoId, quantidade: i.quantidade, custoUnit: i.custoUnit })
      }
      // O saldo já subiu (passo 1): o que esta entrada pôs, com ou sem custo,
      // sai da conta do "antes".
      const entrou = new Map<string, number>()
      for (const i of itens) entrou.set(i.variacaoId, (entrou.get(i.variacaoId) ?? 0) + i.quantidade)
      custosAtualizados = await atualizarCustoMedio(db, comCusto, entrou)
      if (deOutros.size > 0) {
        naoFeito.push(`o custo de ${[...deOutros].join(', ')} (vendido também em lojas que você não cuida)`)
      }
    }

    // ── 3. a conta do fornecedor ──
    let contaLancada = false
    if (e.conta && podeLancar && totalCent > 0) {
      await db.lancamento.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: e.unidadeId,
          categoriaId: e.conta.categoriaId,
          tipo: 'DESPESA',
          descricao: e.fornecedor
            ? `Mercadoria — ${e.fornecedor}`
            : 'Entrada de mercadoria',
          valor: reais(totalCent),
          vencimento: e.conta.vencimento,
          // Coluna `date`: o dia de hoje em São Paulo. `new Date()` depois das
          // 21h já é amanhã em UTC — ver `dia.ts`.
          pagoEm: e.conta.jaPago ? colunaDoDia(diaEmSP()) : null,
          fornecedor: e.fornecedor || null,
          documento: e.documento || null,
          quem: sessao.nome,
        },
      })
      contaLancada = true
    } else if (e.conta && podeLancar) {
      // Pediu a conta e ela não nasceu: sem o custo dos itens não há total. A
      // tela não pode dizer "registrada" e deixar a pessoa achar que a conta
      // a pagar entrou.
      naoFeito.push('a conta a pagar do fornecedor (nenhum item veio com custo, e a conta é o total da nota)')
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: e.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'estoque.entrada',
        alvoTipo: 'entrada',
        // A chave da tela: é por ela que o reenvio acha esta linha (pelo
        // índice de alvo do livro) e não dá entrada de novo.
        alvoId: e.chave || null,
        alvoNome: e.fornecedor?.trim() || 'Entrada de mercadoria',
        valor: totalCent > 0 ? reais(totalCent) : null,
        motivo: e.documento?.trim() || null,
        depois: {
          itens: itens.length,
          custosAtualizados,
          contaLancada,
          // Item a item: "quem deu entrada de 30 na terça, e a quanto?" tem
          // resposta no livro, não só o total.
          linhas: itens.slice(0, 200).map((i) => ({ variacaoId: i.variacaoId, quantidade: i.quantidade, custoUnit: i.custoUnit ?? null })),
        },
        assinado: assinou,
      },
    })

    return {
      ok: true as const,
      itens: itens.length,
      total: reais(totalCent),
      custosAtualizados,
      contaLancada,
      naoFeito,
    }
  }
}

// ─────────────────────────────────────────────────────────────
// O CUSTO MÉDIO
// ─────────────────────────────────────────────────────────────

/** Custo com quatro casas: o mililitro de calda custa R$ 0,0028. */
export const arred4 = (v: number) => Math.round(v * 10_000) / 10_000

/**
 * O custo médio ponderado depois de uma entrada: o que já estava, ao custo de
 * antes, mais o que chegou, ao custo novo. Sem saldo antes (zero, ou negativo,
 * que é estoque que ninguém lançou) ou sem custo antes, vale o custo novo —
 * não há o que pesar.
 */
export function custoMedio(saldoAntes: number, custoAntes: number | null, quantidade: number, custoNovo: number): number {
  if (!(saldoAntes > 0) || custoAntes === null || !(quantidade > 0)) return arred4(custoNovo)
  return arred4((saldoAntes * custoAntes + quantidade * custoNovo) / (saldoAntes + quantidade))
}

/**
 * Atualiza o custo médio do que entrou, DENTRO da transação da entrada (ou da
 * produção), DEPOIS de o saldo subir. Devolve quantos produtos mudaram.
 *
 * O saldo de antes é o de TODAS as lojas: o custo é um número só para a
 * empresa, e a peça que está no depósito custou o mesmo que a da vitrine.
 * `jaEntrou` é o que esta mesma operação pôs no saldo (com ou sem custo) —
 * sai da conta para sobrar o "antes".
 *
 * Duas contas, porque o custo mora em dois lugares:
 *   • o da VARIAÇÃO, quando o produto tem grade: o picolé de chocolate e o
 *     de coco saem da fábrica com custos diferentes, e o P e o GG da mesma
 *     calça também podem chegar assim na nota;
 *   • o do PRODUTO, a média de tudo — é o custo que as telas e os
 *     relatórios leem, e o que vale para a variação sem custo próprio.
 *
 * Quem chama confere antes quem pode mexer no custo (`produto.preco` em
 * todas as lojas que vendem o produto). Linha com custo zero não entra.
 */
export async function atualizarCustoMedio(
  db: BancoDaOrg,
  linhas: { variacaoId: string; quantidade: number; custoUnit: number }[],
  jaEntrou: Map<string, number>,
): Promise<number> {
  const validas = linhas.filter((l) => l.quantidade > 0 && Number.isFinite(l.custoUnit) && l.custoUnit > 0)
  if (validas.length === 0) return 0

  // Por variação: quanto chegou com custo, e quanto isso custou.
  const porVariacao = new Map<string, { quantidade: number; valor: number }>()
  for (const l of validas) {
    const a = porVariacao.get(l.variacaoId) ?? { quantidade: 0, valor: 0 }
    porVariacao.set(l.variacaoId, { quantidade: a.quantidade + l.quantidade, valor: a.valor + l.quantidade * l.custoUnit })
  }
  const variacoes = await db.variacao.findMany({
    where: { id: { in: [...porVariacao.keys()] } },
    select: { id: true, produtoId: true, custo: true, produto: { select: { custo: true } } },
  })
  const produtoIds = [...new Set(variacoes.map((v) => v.produtoId))]
  // O saldo de cada variação dos produtos, somando as lojas — e quantas
  // variações cada produto tem: só o que tem grade guarda custo na variação.
  const saldos = await db.$queryRaw<{ variacao_id: string; produto_id: string; q: string }[]>`
    select v.id as variacao_id, v.produto_id, coalesce(sum(e.quantidade), 0) as q
      from variacoes v left join estoque e on e.variacao_id = v.id
     where v.produto_id = any(${produtoIds}::text[])
     group by v.id, v.produto_id
  `
  const antesDe = (variacaoId: string, q: string) => Number(q) - (jaEntrou.get(variacaoId) ?? 0)
  const saldoVar = new Map(saldos.map((s) => [s.variacao_id, antesDe(s.variacao_id, s.q)]))
  const saldoProd = new Map<string, number>()
  const variacoesDoProduto = new Map<string, number>()
  for (const s of saldos) {
    saldoProd.set(s.produto_id, (saldoProd.get(s.produto_id) ?? 0) + antesDe(s.variacao_id, s.q))
    variacoesDoProduto.set(s.produto_id, (variacoesDoProduto.get(s.produto_id) ?? 0) + 1)
  }

  // ── a variação ──
  for (const v of variacoes) {
    if ((variacoesDoProduto.get(v.produtoId) ?? 0) < 2) continue
    const c = porVariacao.get(v.id)!
    const antes = v.custo != null ? Number(v.custo) : v.produto.custo != null ? Number(v.produto.custo) : null
    await db.variacao.update({
      where: { id: v.id },
      data: { custo: custoMedio(saldoVar.get(v.id) ?? 0, antes, c.quantidade, c.valor / c.quantidade) },
    })
  }

  // ── o produto ──
  for (const produtoId of produtoIds) {
    const doProduto = variacoes.filter((v) => v.produtoId === produtoId)
    const quantidade = doProduto.reduce((s, v) => s + porVariacao.get(v.id)!.quantidade, 0)
    const valor = doProduto.reduce((s, v) => s + porVariacao.get(v.id)!.valor, 0)
    const custo = doProduto[0]!.produto.custo
    await db.produto.update({
      where: { id: produtoId },
      data: { custo: custoMedio(saldoProd.get(produtoId) ?? 0, custo != null ? Number(custo) : null, quantidade, valor / quantidade) },
    })
  }
  return produtoIds.length
}

/**
 * O ponto em que a peça precisa ser reposta.
 *
 * Sem ele o sistema só avisa quando o saldo chega a zero — que é tarde: a
 * venda já foi perdida, e a reposição ainda vai demorar o prazo do
 * fornecedor. O mínimo é o que transforma "acabou" em "está acabando".
 */
export async function definirMinimo(
  sessao: Sessao,
  variacaoId: string,
  unidadeId: string,
  minimo: number,
) {
  exigir(sessao, 'estoque.ajustar', unidadeId)
  if (!Number.isFinite(minimo)) throw new Error('O mínimo precisa ser um número.')
  if (minimo < 0) throw new Error('O mínimo não pode ser negativo.')

  await comoOrg(sessao.orgId, async (db) => {
    // Os dois ids vêm da tela: procurar passa pelo RLS, e id de outra empresa
    // não cria linha de saldo apontando para lá.
    const v = await db.variacao.findUnique({
      where: { id: variacaoId },
      select: { codigo: true, produto: { select: { nome: true } } },
    })
    const loja = await db.unidade.findUnique({ where: { id: unidadeId }, select: { id: true } })
    if (!v || !loja) throw new Error('Produto ou loja não encontrado nesta empresa.')

    const antes = await db.estoque.findUnique({
      where: { variacaoId_unidadeId: { variacaoId, unidadeId } },
      select: { minimo: true },
    })
    await db.estoque.upsert({
      where: { variacaoId_unidadeId: { variacaoId, unidadeId } },
      create: { orgId: sessao.orgId, variacaoId, unidadeId, quantidade: 0, minimo },
      update: { minimo },
    })
    // O mínimo decide o que aparece como "hora de pedir". Zerar o mínimo de
    // tudo cala o alarme da loja — e isso precisa ter nome no livro.
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'estoque.minimo',
        alvoTipo: 'variacao',
        alvoId: variacaoId,
        alvoNome: `${v.produto.nome}${v.codigo ? ` (${v.codigo})` : ''}`,
        antes: { minimo: antes?.minimo != null ? Number(antes.minimo) : null },
        depois: { minimo },
      },
    })
  })
}
