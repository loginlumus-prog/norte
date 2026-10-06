// A fábrica: ficha técnica, ordem de produção e o pedido das lojas.
//
// ── o caminho do estoque ─────────────────────────────────────
// O insumo (leite, calda, pote, palito) é produto de MATERIAL DE USO: entra
// por compra ou entrada de mercadoria, como qualquer coisa. A ORDEM DE
// PRODUÇÃO é o único jeito de ele virar produto pronto: ao encerrar, baixa o
// que foi USADO (CONSUMO) e dá ENTRADA no que SAIU, na fábrica, com lote,
// validade e o custo apurado. O pronto vai às lojas pelo PEDIDO: a loja pede, a
// fábrica manda (transferência, com as duas pernas no mesmo id) e a loja
// confere ao receber — o que faltou na conferência sai como PERDA na loja.
//
// Tudo passa por `mexerEstoqueEm`: não existe um segundo jeito de o saldo
// andar, e é isso que mantém "estoque = soma dos movimentos" verdadeiro.
//
// ── o custo ──────────────────────────────────────────────────
// O custo do pronto é o custo dos insumos USADOS dividido pelo que saiu, e ele
// entra no custo médio DAQUELE sabor (a variação) e do produto — que é o que
// a loja enxerga como CMV. Quem vende o picolé vê a margem sobre o que a
// fábrica gastou de verdade. Só com `produto.preco`: o cargo de produção
// registra a produção, e o custo fica com quem decide preço.
//
// ── quem pode ────────────────────────────────────────────────
// Sem capacidade nova: produzir e mandar é mexer no estoque DA FÁBRICA
// (`estoque.ajustar` nela); pedir e conferir é mexer no estoque DA LOJA
// (`estoque.ajustar` na loja); a receita mexe no custo, é ficha de produto
// (`produto.editar` NA fábrica, ou pela empresa inteira). Um cargo "Produção
// da fábrica" preso à fábrica faz o trabalho dela e não toca nas lojas. A
// vendedora que mexe em estoque porque a empresa deixou assina com o PIN.

import { randomUUID } from 'node:crypto'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, exigirQueNaoSejaSuporte, pode, SemPermissao, soPelaEmpresa, unidadesQuePodem, type Sessao } from './permissao'
import { assinarExcecao } from './autorizacao'
import { mexerEstoqueEm } from './estoque'
import { alcancaOProduto, vendidoNaLoja } from './catalogo-loja'
import { arred4, atualizarCustoMedio, QUANTIDADE_MAXIMA } from './entrada'
import { diaEmSP, somarDias } from './dia'

export class FabricaRecusou extends Error {}

/**
 * A recusa que pede o PIN de quem faz: a tela mostra o campo e manda de novo.
 * É `FabricaRecusou` (a frase passa como está) com a marca `precisaPin`.
 */
export class FabricaPedePin extends FabricaRecusou {
  readonly precisaPin = true
}

/**
 * A assinatura de quem mexe no estoque da fábrica ou da loja.
 *
 * Quem faz porque a EMPRESA deixou (a vendedora, ver EXTRAS_DO_BALCAO)
 * assina sempre, com o PIN dela — a mesma régua da correção do estoque e da
 * entrada de mercadoria. `excecao`: o movimento é baixa (a falta que vira
 * perda na conferência), e aí vale também o "PIN nas exceções" da empresa.
 * Fora de qualquer transação: o PIN é conferido numa transação própria.
 */
async function assinar(sessao: Sessao, unidadeId: string, pin: string | null | undefined, excecao = false): Promise<boolean> {
  const sempre = soPelaEmpresa(sessao, 'estoque.ajustar', unidadeId)
  if (!sempre && !excecao) return false
  const a = await assinarExcecao(sessao, { pin, sempre })
  if (!a.ok) throw new FabricaPedePin(a.erro)
  return a.assinou
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const arred = (v: number, casas = 3) => Math.round(v * 10 ** casas) / 10 ** casas

// ─────────────────────────────────────────────────────────────
// FICHA TÉCNICA
// ─────────────────────────────────────────────────────────────

export type ItemDaReceita = { insumoId: string; quantidade: number }

export type ReceitaNaTela = {
  id: string
  variacaoId: string
  produto: string
  codigo: string | null
  medida: string
  rendimento: number
  validadeDias: number | null
  observacao: string | null
  itens: { insumoId: string; nome: string; codigo: string | null; medida: string; quantidade: number; custo: number | null }[]
  /** Custo de uma batelada e de uma unidade pronta, pelo custo de hoje dos insumos. Nulo se falta custo. */
  custoBatelada: number | null
  custoUnidade: number | null
}

const nomeDaVariacao = (v: { produto: { nome: string }; opcoes?: { opcao: { valor: string } }[] }) =>
  v.opcoes && v.opcoes.length > 0 ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}` : v.produto.nome

export async function listarReceitas(sessao: Sessao): Promise<ReceitaNaTela[]> {
  exigir(sessao, 'produto.ver')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.receita.findMany({
      select: {
        id: true, variacaoId: true, rendimento: true, validadeDias: true, observacao: true,
        variacao: { select: { codigo: true, produto: { select: { nome: true, medida: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } } },
        itens: {
          orderBy: { ordem: 'asc' },
          select: {
            insumoId: true, quantidade: true,
            insumo: { select: { codigo: true, produto: { select: { nome: true, medida: true, custo: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } } },
          },
        },
      },
    }),
  )
  const verCusto = pode(sessao, 'produto.preco') || pode(sessao, 'financeiro.ver')
  return linhas
    .map((r) => {
      const itens = r.itens.map((i) => ({
        insumoId: i.insumoId,
        nome: nomeDaVariacao(i.insumo),
        codigo: i.insumo.codigo,
        medida: i.insumo.produto.medida,
        quantidade: n(i.quantidade),
        custo: verCusto && i.insumo.produto.custo != null ? n(i.insumo.produto.custo) : null,
      }))
      const faltaCusto = !verCusto || itens.some((i) => i.custo === null)
      const custoBatelada = faltaCusto ? null : arred(itens.reduce((s, i) => s + i.quantidade * (i.custo ?? 0), 0), 2)
      const rendimento = n(r.rendimento)
      return {
        id: r.id,
        variacaoId: r.variacaoId,
        produto: nomeDaVariacao(r.variacao),
        codigo: r.variacao.codigo,
        medida: r.variacao.produto.medida,
        rendimento,
        validadeDias: r.validadeDias,
        observacao: r.observacao,
        itens,
        custoBatelada,
        custoUnidade: custoBatelada !== null && rendimento > 0 ? arred(custoBatelada / rendimento, 4) : null,
      }
    })
    .sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR'))
}

/**
 * A ficha técnica é da fábrica: decide o que ela baixa de insumo e o custo do
 * que sai. Quem mexe nela edita produto NA fábrica (o cargo de produção preso
 * a ela) ou pela empresa inteira — e não o gerente de uma loja qualquer, que
 * com `produto.editar` da loja dele reescrevia a receita e o CMV da rede.
 */
async function exigirAlcanceDaFabrica(sessao: Sessao): Promise<void> {
  exigir(sessao, 'produto.editar')
  const alcance = unidadesQuePodem(sessao, 'produto.editar')
  if (alcance === 'todas') return
  const fabricas = await comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({ where: { ehFabrica: true, id: { in: alcance } }, select: { id: true } }),
  )
  if (fabricas.length === 0) throw new SemPermissao('produto.editar')
}

export async function salvarReceita(
  sessao: Sessao,
  d: { variacaoId: string; rendimento: number; validadeDias: number | null; observacao?: string | null; itens: ItemDaReceita[] },
): Promise<{ id: string }> {
  await exigirAlcanceDaFabrica(sessao)
  if (!(d.rendimento > 0) || !Number.isFinite(d.rendimento)) throw new FabricaRecusou('Quanto rende uma batelada? Precisa ser maior que zero.')
  if (d.validadeDias !== null && (!Number.isInteger(d.validadeDias) || d.validadeDias < 1 || d.validadeDias > 3650)) {
    throw new FabricaRecusou('A validade é em dias, de 1 a 3650 (ou em branco).')
  }
  const itens = d.itens.filter((i) => i.insumoId && i.quantidade > 0)
  if (itens.length === 0) throw new FabricaRecusou('Ponha pelo menos um insumo, com a quantidade de uma batelada.')
  if (itens.some((i) => !Number.isFinite(i.quantidade))) throw new FabricaRecusou('Quantidade de insumo precisa ser um número.')
  if (itens.some((i) => i.insumoId === d.variacaoId)) throw new FabricaRecusou('O produto não pode ser insumo dele mesmo.')
  if (new Set(itens.map((i) => i.insumoId)).size !== itens.length) throw new FabricaRecusou('Um insumo aparece duas vezes: junte as quantidades numa linha só.')

  return comoOrg(sessao.orgId, async (db) => {
    // Tudo vem do formulário: procurar aqui passa pelo RLS.
    const ids = [d.variacaoId, ...itens.map((i) => i.insumoId)]
    const achadas = await db.variacao.findMany({ where: { id: { in: ids } }, select: { id: true, produto: { select: { nome: true, servico: true } } } })
    if (achadas.length !== new Set(ids).size) throw new FabricaRecusou('Produto ou insumo não encontrado nesta empresa.')
    if (achadas.some((a) => a.produto.servico)) throw new FabricaRecusou('Serviço não entra em receita.')

    const ja = await db.receita.findUnique({ where: { variacaoId: d.variacaoId }, select: { id: true } })
    const dados = {
      rendimento: d.rendimento,
      validadeDias: d.validadeDias,
      observacao: d.observacao?.trim().slice(0, 500) || null,
    }
    const receita = ja
      ? await db.receita.update({ where: { id: ja.id }, data: dados, select: { id: true } })
      : await db.receita.create({ data: { orgId: sessao.orgId, variacaoId: d.variacaoId, ...dados }, select: { id: true } })
    await db.receitaItem.deleteMany({ where: { receitaId: receita.id } })
    await db.receitaItem.createMany({
      data: itens.map((i, ordem) => ({ orgId: sessao.orgId, receitaId: receita.id, insumoId: i.insumoId, quantidade: i.quantidade, ordem })),
    })
    const nome = achadas.find((a) => a.id === d.variacaoId)!.produto.nome
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: ja ? 'fabrica.receita.alterou' : 'fabrica.receita.criou',
        alvoTipo: 'variacao', alvoId: d.variacaoId, alvoNome: nome,
        depois: { rendimento: d.rendimento, validadeDias: d.validadeDias, itens: itens.length },
      },
    })
    return receita
  })
}

export async function apagarReceita(sessao: Sessao, receitaId: string) {
  await exigirAlcanceDaFabrica(sessao)
  exigirQueNaoSejaSuporte(sessao, 'apaga ficha técnica')
  await comoOrg(sessao.orgId, async (db) => {
    const r = await db.receita.findUnique({ where: { id: receitaId }, select: { variacaoId: true, variacao: { select: { produto: { select: { nome: true } } } } } })
    if (!r) return
    await db.receita.delete({ where: { id: receitaId } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'fabrica.receita.apagou', alvoTipo: 'variacao', alvoId: r.variacaoId, alvoNome: r.variacao.produto.nome,
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// ORDEM DE PRODUÇÃO
// ─────────────────────────────────────────────────────────────

async function exigirFabrica(db: BancoDaOrg, unidadeId: string) {
  const u = await db.unidade.findUnique({ where: { id: unidadeId }, select: { nome: true, ehFabrica: true, ativa: true } })
  if (!u) throw new FabricaRecusou('Fábrica não encontrada nesta empresa.')
  if (!u.ehFabrica) throw new FabricaRecusou(`${u.nome} não está marcada como fábrica (Lojas › editar).`)
  if (!u.ativa) throw new FabricaRecusou(`${u.nome} está fechada.`)
  return u
}

/** O próximo número da empresa, sob trava: duas ordens ao mesmo tempo não pegam o mesmo. */
async function proximoNumero(db: BancoDaOrg, orgId: string, tabela: 'ordem' | 'pedido'): Promise<number> {
  await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`fabrica:${tabela}:${orgId}`}))`
  const r =
    tabela === 'ordem'
      ? await db.ordemProducao.aggregate({ _max: { numero: true } })
      : await db.pedidoFabrica.aggregate({ _max: { numero: true } })
  return (r._max.numero ?? 0) + 1
}

/**
 * "L021026-2": L, o dia (DDMMAA) e a ordem do dia. Curto para a etiqueta,
 * único na empresa.
 *
 * Conta a partir do MAIOR número já usado no dia, não de quantas ordens o
 * dia tem: renomear o lote ao encerrar ("ESPECIAL-NATAL") tirava uma ordem da
 * contagem, e a próxima repetia o lote de outra. Quem chama segura a trava da
 * numeração (`proximoNumero`) e o banco tem lote único por empresa por baixo.
 */
async function proximoLote(db: BancoDaOrg, hoje: string): Promise<string> {
  const [a, m, d] = hoje.split('-')
  const base = `L${d}${m}${a!.slice(2)}`
  const doDia = await db.ordemProducao.findMany({ where: { lote: { startsWith: `${base}-` } }, select: { lote: true } })
  const maior = doDia.reduce((mx, o) => {
    const n = Number(o.lote.slice(base.length + 1))
    return Number.isInteger(n) && n > mx ? n : mx
  }, 0)
  return `${base}-${maior + 1}`
}

export async function abrirOrdem(
  sessao: Sessao,
  d: { unidadeId: string; variacaoId: string; bateladas: number; observacao?: string | null },
): Promise<{ id: string; numero: number; lote: string }> {
  exigir(sessao, 'estoque.ajustar', d.unidadeId)
  if (!(d.bateladas > 0) || !Number.isFinite(d.bateladas)) throw new FabricaRecusou('Quantas bateladas? Precisa ser maior que zero.')

  return comoOrg(sessao.orgId, async (db) => {
    await exigirFabrica(db, d.unidadeId)
    const v = await db.variacao.findUnique({
      where: { id: d.variacaoId },
      select: { produto: { select: { nome: true, servico: true } }, receita: { select: { rendimento: true, itens: { select: { insumoId: true, quantidade: true } } } } },
    })
    if (!v) throw new FabricaRecusou('Produto não encontrado nesta empresa.')
    if (v.produto.servico) throw new FabricaRecusou('Serviço não se produz.')
    // Sem receita, "bateladas" é a quantidade pronta: a fábrica que ainda não
    // montou a ficha técnica consegue registrar a produção e o lote mesmo assim.
    const prevista = v.receita ? arred(n(v.receita.rendimento) * d.bateladas) : d.bateladas
    const numero = await proximoNumero(db, sessao.orgId, 'ordem')
    const lote = await proximoLote(db, diaEmSP(new Date()))
    const ordem = await db.ordemProducao.create({
      data: {
        orgId: sessao.orgId, numero, unidadeId: d.unidadeId, variacaoId: d.variacaoId,
        bateladas: d.bateladas, quantidadePrevista: prevista, lote,
        observacao: d.observacao?.trim().slice(0, 500) || null,
        quem: sessao.nome, usuarioId: sessao.usuarioId,
        consumos: v.receita
          ? { create: v.receita.itens.map((i) => ({ orgId: sessao.orgId, insumoId: i.insumoId, previsto: arred(n(i.quantidade) * d.bateladas) })) }
          : undefined,
      },
      select: { id: true, numero: true, lote: true },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: d.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'fabrica.ordem.abriu', alvoTipo: 'ordem', alvoId: ordem.id, alvoNome: `OP ${numero} · ${v.produto.nome}`,
        depois: { bateladas: d.bateladas, prevista, lote },
      },
    })
    return ordem
  })
}

export type Encerramento = {
  produzida: number
  /**
   * O que foi usado de cada insumo. Insumo da receita sem linha aqui = usou o
   * previsto. Insumo que NÃO está na receita entra também: baixa do estoque,
   * entra no custo e fica na ordem (com previsto zero), à vista de quem olha.
   */
  consumos?: { insumoId: string; usado: number }[]
  lote?: string | null
  /** AAAA-MM-DD. Sem ela, a da receita (dias de validade a partir de hoje). */
  validade?: string | null
  /** O PIN de quem encerra, quando pede assinatura (a vendedora). */
  pin?: string | null
}

export async function encerrarOrdem(sessao: Sessao, ordemId: string, e: Encerramento) {
  if (!(e.produzida > 0) || !Number.isFinite(e.produzida)) throw new FabricaRecusou('Quanto saiu de verdade? Precisa ser maior que zero.')
  if (e.produzida > QUANTIDADE_MAXIMA) throw new FabricaRecusou('Quantidade produzida alta demais. Confira se não sobrou um zero.')
  if (e.validade && !/^\d{4}-\d{2}-\d{2}$/.test(e.validade)) throw new FabricaRecusou('Validade inválida.')

  // A permissão é na fábrica DA ORDEM — lida antes, numa leitura só.
  const alvo = await comoOrg(sessao.orgId, (db) => db.ordemProducao.findUnique({ where: { id: ordemId }, select: { unidadeId: true } }))
  if (!alvo) throw new FabricaRecusou('Ordem não encontrada nesta empresa.')
  exigir(sessao, 'estoque.ajustar', alvo.unidadeId)
  const assinou = await assinar(sessao, alvo.unidadeId, e.pin)

  return comoOrg(sessao.orgId, async (db) => {
    // Travada: duas pessoas encerrando a mesma ordem não dão duas entradas.
    await db.$executeRaw`select id from ordens_producao where id = ${ordemId} for update`
    const o = await db.ordemProducao.findUniqueOrThrow({
      where: { id: ordemId },
      select: {
        numero: true, situacao: true, unidadeId: true, variacaoId: true, lote: true,
        variacao: { select: { produtoId: true, produto: { select: { nome: true, vendidoEm: true } }, receita: { select: { validadeDias: true } } } },
      },
    })
    if (o.situacao !== 'ABERTA') throw new FabricaRecusou(`A OP ${o.numero} já está ${o.situacao === 'ENCERRADA' ? 'encerrada' : 'cancelada'}.`)
    // Fábrica fechada (ou que deixou de ser fábrica) não recebe produção: o
    // pronto entraria numa unidade que nenhuma tela de estoque mostra.
    await exigirFabrica(db, o.unidadeId)
    // O custo de um insumo: o da variação, quando ela tem o próprio (a calda
    // de morango e a de chocolate), senão o do produto.
    const custoDe = (i: { custo: unknown; produto: { custo: unknown } }) =>
      i.custo != null ? n(i.custo) : i.produto.custo != null ? n(i.produto.custo) : null
    // Os consumos numa consulta à parte: relação "para muitos" no mesmo
    // select corre em paralelo dentro da transação.
    const consumos = (
      await db.ordemConsumo.findMany({
        where: { ordemId },
        select: { id: true, insumoId: true, previsto: true, insumo: { select: { custo: true, produto: { select: { custo: true } } } } },
      })
    ).map((c) => ({ id: c.id, insumoId: c.insumoId, previsto: n(c.previsto), custo: custoDe(c.insumo) }))

    const lote = (e.lote?.trim() || o.lote).slice(0, 40)
    // Lote é o que a etiqueta e o recall procuram: o escrito à mão não pode
    // ser o de outra ordem (o banco também recusa, mas sem esta frase).
    if (lote !== o.lote) {
      const outra = await db.ordemProducao.findFirst({ where: { lote, id: { not: ordemId } }, select: { numero: true } })
      if (outra) throw new FabricaRecusou(`O lote ${lote} já é da OP ${outra.numero}. Escreva outro, ou deixe o da ordem.`)
    }
    const hoje = diaEmSP(new Date())
    const validade = e.validade ?? (o.variacao.receita?.validadeDias ? somarDias(hoje, o.variacao.receita.validadeDias) : null)
    const motivo = `Produção OP ${o.numero} · lote ${lote}`

    // O que foi usado e não está na receita: antes era ignorado em silêncio
    // (não baixava, não custava). Agora entra na ordem como consumo extra.
    const daReceita = new Set(consumos.map((c) => c.insumoId))
    const extras = (e.consumos ?? []).filter((c) => !daReceita.has(c.insumoId) && Number(c.usado) > 0)
    if (new Set(extras.map((c) => c.insumoId)).size !== extras.length) throw new FabricaRecusou('Um insumo aparece duas vezes: junte as quantidades.')
    if (extras.some((c) => c.insumoId === o.variacaoId)) throw new FabricaRecusou('O produto não pode ser insumo dele mesmo.')
    if (extras.length > 0) {
      const achadas = await db.variacao.findMany({
        where: { id: { in: extras.map((c) => c.insumoId) } },
        select: { id: true, custo: true, produto: { select: { servico: true, custo: true } } },
      })
      if (achadas.length !== extras.length) throw new FabricaRecusou('Insumo não encontrado nesta empresa.')
      if (achadas.some((a) => a.produto.servico)) throw new FabricaRecusou('Serviço não entra em produção.')
      for (const x of extras) {
        const a = achadas.find((v) => v.id === x.insumoId)!
        const criado = await db.ordemConsumo.create({
          data: { orgId: sessao.orgId, ordemId, insumoId: x.insumoId, previsto: 0 },
          select: { id: true },
        })
        consumos.push({ id: criado.id, insumoId: x.insumoId, previsto: 0, custo: custoDe(a) })
      }
    }

    // 1. Baixa o que foi usado. Insumo sem estoque lançado não trava a
    //    produção (permitirNegativo): o saldo negativo é o aviso de que falta
    //    dar entrada na compra — travar aqui pararia a fábrica por papelada.
    const usados = new Map((e.consumos ?? []).map((c) => [c.insumoId, c.usado]))
    let custoTotal = 0
    let faltouCusto = false
    for (const c of consumos) {
      const usado = usados.has(c.insumoId) ? Number(usados.get(c.insumoId)) : c.previsto
      if (!Number.isFinite(usado) || usado < 0) throw new FabricaRecusou('Quantidade usada de insumo precisa ser zero ou mais.')
      if (usado > QUANTIDADE_MAXIMA) throw new FabricaRecusou('Quantidade usada de insumo alta demais. Confira se não sobrou um zero.')
      const custo = c.custo
      if (custo === null && usado > 0) faltouCusto = true
      custoTotal += usado * (custo ?? 0)
      if (usado > 0) {
        await mexerEstoqueEm(db, sessao, {
          variacaoId: c.insumoId, unidadeId: o.unidadeId, tipo: 'CONSUMO', quantidade: usado,
          motivo, referencia: ordemId, permitirNegativo: true,
        })
      }
      await db.ordemConsumo.update({ where: { id: c.id }, data: { usado, custoUnitario: custo } })
    }

    // 2. Entra o que saiu, na fábrica.
    const entrada = await mexerEstoqueEm(db, sessao, {
      variacaoId: o.variacaoId, unidadeId: o.unidadeId, tipo: 'ENTRADA', quantidade: e.produzida, motivo, referencia: ordemId,
    })
    if (!entrada.ok) throw new FabricaRecusou('Não deu para dar entrada na produção.')

    // 3. O custo do pronto entra no CUSTO MÉDIO dele — é o CMV que a loja
    //    enxerga. Só com o custo de TODOS os insumos: meia conta seria custo
    //    falso. E só da variação produzida (o sabor desta ordem) e do produto
    //    pela média: antes o lote de chocolate reescrevia o custo do coco.
    //    Mexer no custo é `produto.preco` em todas as lojas que vendem o
    //    produto, como na entrada de mercadoria: o cargo de produção registra
    //    a produção, e o custo fica como estava — a tela diz.
    const custoUnitario = consumos.length > 0 && !faltouCusto ? arred4(custoTotal / e.produzida) : null
    const podeCusto =
      pode(sessao, 'produto.preco') && alcancaOProduto(unidadesQuePodem(sessao, 'produto.preco'), o.variacao.produto.vendidoEm)
    let custoAtualizado = false
    if (custoUnitario !== null && custoUnitario > 0 && podeCusto) {
      await atualizarCustoMedio(
        db,
        [{ variacaoId: o.variacaoId, quantidade: e.produzida, custoUnit: custoUnitario }],
        new Map([[o.variacaoId, e.produzida]]),
      )
      custoAtualizado = true
    }

    await db.ordemProducao.update({
      where: { id: ordemId },
      data: {
        situacao: 'ENCERRADA', quantidadeProduzida: e.produzida, lote,
        fabricadaEm: new Date(), validade: validade ? new Date(`${validade}T12:00:00Z`) : null,
        custoTotal: consumos.length > 0 && !faltouCusto ? Math.round(custoTotal * 100) / 100 : null,
        custoUnitario,
        encerradaPor: sessao.nome, encerradaEm: new Date(),
      },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: o.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'fabrica.ordem.encerrou', alvoTipo: 'ordem', alvoId: ordemId, alvoNome: `OP ${o.numero} · ${o.variacao.produto.nome}`,
        depois: {
          produzida: e.produzida, lote, validade, custoUnitario, custoAtualizado,
          ...(extras.length > 0 ? { foraDaReceita: extras.map((x) => ({ insumoId: x.insumoId, usado: Number(x.usado) })) } : {}),
        },
        assinado: assinou,
      },
    })
    return {
      saldo: entrada.saldo, custoUnitario, faltouCusto, lote, validade,
      /** O custo do produto mudou com esta produção (quem encerrou pode mexer em custo). */
      custoAtualizado,
      /** Insumos usados que não estavam na ficha técnica. */
      foraDaReceita: extras.length,
    }
  })
}

export async function cancelarOrdem(sessao: Sessao, ordemId: string, motivo: string) {
  const alvo = await comoOrg(sessao.orgId, (db) => db.ordemProducao.findUnique({ where: { id: ordemId }, select: { unidadeId: true } }))
  if (!alvo) throw new FabricaRecusou('Ordem não encontrada nesta empresa.')
  exigir(sessao, 'estoque.ajustar', alvo.unidadeId)
  await comoOrg(sessao.orgId, async (db) => {
    const r = await db.ordemProducao.updateMany({ where: { id: ordemId, situacao: 'ABERTA' }, data: { situacao: 'CANCELADA', encerradaPor: sessao.nome, encerradaEm: new Date() } })
    if (r.count === 0) throw new FabricaRecusou('Só ordem aberta se cancela.')
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: alvo.unidadeId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'fabrica.ordem.cancelou', alvoTipo: 'ordem', alvoId: ordemId, motivo: motivo.trim().slice(0, 200) || null,
      },
    })
  })
}

export type OrdemNaTela = {
  id: string
  numero: number
  unidadeId: string
  unidade: string
  /** O produto pronto — a tela acha a ficha técnica dele (validade em dias) por aqui. */
  variacaoId: string
  produto: string
  codigo: string | null
  medida: string
  bateladas: number
  prevista: number
  produzida: number | null
  lote: string
  validade: string | null
  situacao: 'ABERTA' | 'ENCERRADA' | 'CANCELADA'
  custoUnitario: number | null
  quem: string
  criadaEm: Date
  encerradaEm: Date | null
  consumos: { insumoId: string; nome: string; medida: string; previsto: number; usado: number | null }[]
}

export async function listarOrdens(sessao: Sessao, filtro: { situacao?: 'ABERTA' | 'ENCERRADA'; limite?: number } = {}): Promise<OrdemNaTela[]> {
  exigir(sessao, 'estoque.ver')
  const lojas = unidadesQuePodem(sessao, 'estoque.ver')
  const verCusto = pode(sessao, 'produto.preco') || pode(sessao, 'financeiro.ver')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.ordemProducao.findMany({
      where: {
        ...(filtro.situacao ? { situacao: filtro.situacao } : { situacao: { not: 'CANCELADA' } }),
        ...(lojas === 'todas' ? {} : { unidadeId: { in: lojas } }),
      },
      orderBy: { numero: 'desc' },
      take: filtro.limite ?? 50,
      select: {
        id: true, numero: true, unidadeId: true, variacaoId: true, bateladas: true, quantidadePrevista: true, quantidadeProduzida: true, lote: true, validade: true,
        situacao: true, custoUnitario: true, quem: true, criadaEm: true, encerradaEm: true,
        unidade: { select: { nome: true } },
        variacao: { select: { codigo: true, produto: { select: { nome: true, medida: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } } },
        consumos: {
          select: {
            insumoId: true, previsto: true, usado: true,
            insumo: { select: { produto: { select: { nome: true, medida: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } } },
          },
        },
      },
    }),
  )
  return linhas.map((o) => ({
    id: o.id,
    numero: o.numero,
    unidadeId: o.unidadeId,
    unidade: o.unidade.nome,
    variacaoId: o.variacaoId,
    produto: nomeDaVariacao(o.variacao),
    codigo: o.variacao.codigo,
    medida: o.variacao.produto.medida,
    bateladas: n(o.bateladas),
    prevista: n(o.quantidadePrevista),
    produzida: o.quantidadeProduzida == null ? null : n(o.quantidadeProduzida),
    lote: o.lote,
    validade: o.validade ? o.validade.toISOString().slice(0, 10) : null,
    situacao: o.situacao,
    custoUnitario: verCusto && o.custoUnitario != null ? n(o.custoUnitario) : null,
    quem: o.quem,
    criadaEm: o.criadaEm,
    encerradaEm: o.encerradaEm,
    consumos: o.consumos.map((c) => ({
      insumoId: c.insumoId,
      nome: nomeDaVariacao(c.insumo),
      medida: c.insumo.produto.medida,
      previsto: n(c.previsto),
      usado: c.usado == null ? null : n(c.usado),
    })),
  }))
}

/**
 * Uma ordem só, com o que a etiqueta do lote pede: o produto, o lote, o dia
 * em que saiu e a validade. Quem não vê o estoque da fábrica dela não acha.
 */
export async function acharOrdem(sessao: Sessao, ordemId: string) {
  exigir(sessao, 'estoque.ver')
  const o = await comoOrg(sessao.orgId, (db) =>
    db.ordemProducao.findUnique({
      where: { id: ordemId },
      select: {
        id: true, numero: true, unidadeId: true, situacao: true, lote: true, validade: true, fabricadaEm: true,
        quantidadeProduzida: true, quantidadePrevista: true,
        unidade: { select: { nome: true } },
        variacao: { select: { codigo: true, produto: { select: { nome: true, medida: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } } },
      },
    }),
  )
  if (!o || !pode(sessao, 'estoque.ver', o.unidadeId)) return null
  return {
    id: o.id,
    numero: o.numero,
    situacao: o.situacao,
    unidade: o.unidade.nome,
    produto: nomeDaVariacao(o.variacao),
    codigo: o.variacao.codigo,
    medida: o.variacao.produto.medida,
    lote: o.lote,
    /** AAAA-MM-DD, no dia de São Paulo. */
    fabricadaEm: o.fabricadaEm ? diaEmSP(o.fabricadaEm) : null,
    validade: o.validade ? o.validade.toISOString().slice(0, 10) : null,
    quantidade: o.quantidadeProduzida == null ? n(o.quantidadePrevista) : n(o.quantidadeProduzida),
  }
}

// ─────────────────────────────────────────────────────────────
// O PEDIDO DA LOJA À FÁBRICA
// ─────────────────────────────────────────────────────────────

export async function criarPedido(
  sessao: Sessao,
  d: { lojaId: string; fabricaId?: string | null; itens: { variacaoId: string; quantidade: number }[]; observacao?: string | null; pin?: string | null },
): Promise<{ id: string; numero: number }> {
  exigir(sessao, 'fabrica.pedir', d.lojaId)
  const itens = d.itens.filter((i) => i.quantidade > 0)
  if (itens.length === 0) throw new FabricaRecusou('Ponha a quantidade de pelo menos um item.')
  if (itens.some((i) => !Number.isFinite(i.quantidade))) throw new FabricaRecusou('Quantidade precisa ser um número.')
  if (itens.some((i) => i.quantidade > QUANTIDADE_MAXIMA)) throw new FabricaRecusou('Uma das quantidades está alta demais. Confira se não sobrou um zero.')
  if (new Set(itens.map((i) => i.variacaoId)).size !== itens.length) throw new FabricaRecusou('O mesmo item aparece duas vezes: junte as quantidades numa linha só.')
  const assinou = await assinar(sessao, d.lojaId, d.pin)

  return comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findUnique({ where: { id: d.lojaId }, select: { nome: true, ehDeposito: true, ehFabrica: true, ativa: true } })
    if (!loja || !loja.ativa) throw new FabricaRecusou('Loja não encontrada ou fechada.')
    if (loja.ehFabrica) throw new FabricaRecusou('A fábrica não pede para ela mesma.')
    // Com mais de uma fábrica, quem pede escolhe para qual: antes o pedido
    // sem fábrica caía na mais antiga, que podia nem fazer aquele produto.
    const abertas = await db.unidade.findMany({ where: { ehFabrica: true, ativa: true }, orderBy: { criadaEm: 'asc' }, select: { id: true, nome: true } })
    if (!d.fabricaId && abertas.length > 1) throw new FabricaRecusou('Escolha para qual fábrica vai o pedido.')
    const fabrica = d.fabricaId ? abertas.find((f) => f.id === d.fabricaId) : abertas[0]
    if (!fabrica) {
      throw new FabricaRecusou(
        d.fabricaId ? 'Essa fábrica não existe ou está fechada.' : 'Esta empresa não tem fábrica aberta (Lojas › marque a unidade como fábrica).',
      )
    }

    const variacoes = await db.variacao.findMany({
      where: { id: { in: itens.map((i) => i.variacaoId) } },
      select: { id: true, produto: { select: { nome: true, vendidoEm: true } } },
    })
    if (variacoes.length !== new Set(itens.map((i) => i.variacaoId)).size) throw new FabricaRecusou('Produto não encontrado nesta empresa.')
    const naoVende = variacoes.find((v) => !loja.ehDeposito && !vendidoNaLoja(v.produto.vendidoEm, d.lojaId))
    if (naoVende) throw new FabricaRecusou(`${loja.nome} não vende ${naoVende.produto.nome}. Marque a loja na ficha do produto.`)

    const numero = await proximoNumero(db, sessao.orgId, 'pedido')
    const pedido = await db.pedidoFabrica.create({
      data: {
        orgId: sessao.orgId, numero, lojaId: d.lojaId, fabricaId: fabrica.id,
        observacao: d.observacao?.trim().slice(0, 500) || null, pedidoPor: sessao.nome,
        itens: { create: itens.map((i) => ({ orgId: sessao.orgId, variacaoId: i.variacaoId, pedida: i.quantidade })) },
      },
      select: { id: true, numero: true },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: d.lojaId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'fabrica.pedido.fez', alvoTipo: 'pedido', alvoId: pedido.id, alvoNome: `Pedido ${numero} · ${loja.nome} → ${fabrica.nome}`,
        depois: { itens: itens.length },
        assinado: assinou,
      },
    })
    return pedido
  })
}

/**
 * O lote que deve ir na caixa: o MAIS ANTIGO que ainda tem o que mandar — o
 * que vence primeiro sai primeiro. Antes ia o da produção mais nova, e o lote
 * velho ficava no freezer da fábrica até vencer, com a etiqueta da loja
 * dizendo outro lote.
 *
 * "Ainda tem" é o produzido menos o que já foi mandado com aquele lote. É
 * conta aproximada (a perda na fábrica não diz o lote), mas é a ordem certa.
 * Lote vencido não entra. Sem nenhum assim, o da produção mais recente.
 */
async function loteProvavel(db: BancoDaOrg, variacaoId: string, fabricaId: string): Promise<string | null> {
  const hoje = diaEmSP(new Date())
  const [antigo] = await db.$queryRaw<{ lote: string }[]>`
    select o.lote
      from ordens_producao o
      left join pedido_fabrica_itens i on i.variacao_id = o.variacao_id and i.lote = o.lote
     where o.variacao_id = ${variacaoId} and o.unidade_id = ${fabricaId} and o.situacao = 'ENCERRADA'
       and (o.validade is null or o.validade >= ${hoje}::date)
     group by o.id, o.lote, o.quantidade_produzida, o.fabricada_em, o.numero
    having coalesce(o.quantidade_produzida, 0) - coalesce(sum(i.enviada), 0) > 0
     order by o.fabricada_em asc nulls last, o.numero asc
     limit 1
  `
  if (antigo) return antigo.lote
  const o = await db.ordemProducao.findFirst({
    where: { variacaoId, unidadeId: fabricaId, situacao: 'ENCERRADA' },
    orderBy: { encerradaEm: 'desc' },
    select: { lote: true },
  })
  return o?.lote ?? null
}

/**
 * A fábrica manda. Cada item enviado é uma transferência fábrica → loja (as
 * duas pernas no mesmo id), tudo numa transação: ou a remessa sai inteira, ou
 * nada sai. A permissão é da FÁBRICA — o pedido da loja é a autorização do
 * outro lado.
 *
 * ── a remessa pode ser parcial ────────────────────────────────
 * Pediu 50 e só tem 20: mandam-se 20 e o pedido CONTINUA ABERTO com os 30 que
 * faltam — antes a primeira remessa fechava o pedido, e o resto não tinha
 * caminho. Cada item soma o que já foi; nunca passa do pedido. O pedido vira
 * "a caminho" (a loja confere) quando tudo foi, ou quando a fábrica diz que o
 * resto não vai (`encerrar`).
 */
export async function enviarPedido(
  sessao: Sessao,
  pedidoId: string,
  itens: { itemId: string; enviada: number; lote?: string | null }[],
  opcoes: { encerrar?: boolean; pin?: string | null } = {},
) {
  const alvo = await comoOrg(sessao.orgId, (db) => db.pedidoFabrica.findUnique({ where: { id: pedidoId }, select: { fabricaId: true } }))
  if (!alvo) throw new FabricaRecusou('Pedido não encontrado nesta empresa.')
  exigir(sessao, 'estoque.ajustar', alvo.fabricaId)
  if (itens.some((i) => !Number.isFinite(i.enviada) || i.enviada < 0)) throw new FabricaRecusou('Quantidade enviada precisa ser zero ou mais.')
  const assinou = await assinar(sessao, alvo.fabricaId, opcoes.pin)

  return comoOrg(sessao.orgId, async (db) => {
    await db.$executeRaw`select id from pedidos_fabrica where id = ${pedidoId} for update`
    const p = await db.pedidoFabrica.findUniqueOrThrow({
      where: { id: pedidoId },
      select: {
        numero: true, situacao: true, lojaId: true, fabricaId: true,
        loja: { select: { nome: true, ehDeposito: true, ativa: true } }, fabrica: { select: { nome: true, ativa: true } },
      },
    })
    if (p.situacao !== 'ABERTO') throw new FabricaRecusou(`O pedido ${p.numero} não está aberto.`)
    if (!p.loja.ativa) throw new FabricaRecusou(`${p.loja.nome} está fechada.`)
    if (!p.fabrica.ativa) throw new FabricaRecusou(`${p.fabrica.nome} está fechada.`)
    const doPedido = await db.pedidoFabricaItem.findMany({
      where: { pedidoId },
      select: { id: true, variacaoId: true, pedida: true, enviada: true, lote: true, variacao: { select: { produto: { select: { nome: true } } } } },
    })
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { vendeSemEstoque: true } })

    const porItem = new Map(itens.map((i) => [i.itemId, i]))
    let algum = false
    let faltaMandar = false
    for (const it of doPedido) {
      const pedida = n(it.pedida)
      const jaFoi = n(it.enviada)
      const resta = arred(Math.max(0, pedida - jaFoi))
      const pedidoAqui = porItem.get(it.id)
      // Sem linha na remessa: vai o que falta (o "mandar tudo" da tela).
      const agora = pedidoAqui ? pedidoAqui.enviada : resta
      if (agora > resta + 1e-9) {
        throw new FabricaRecusou(
          `${it.variacao.produto.nome}: a loja pediu ${pedida.toLocaleString('pt-BR')}` +
            (jaFoi > 0 ? ` e já foram ${jaFoi.toLocaleString('pt-BR')}` : '') +
            ` — dá para mandar no máximo ${resta.toLocaleString('pt-BR')}. O que a loja quiser a mais é outro pedido.`,
        )
      }
      if (agora > 0) {
        algum = true
        const loteAgora = (pedidoAqui?.lote?.trim() || (await loteProvavel(db, it.variacaoId, p.fabricaId)) || null)?.slice(0, 40) ?? null
        const transferenciaId = randomUUID()
        const motivo = `Pedido ${p.numero}${loteAgora ? ` · lote ${loteAgora}` : ''}`
        const saida = await mexerEstoqueEm(db, sessao, {
          variacaoId: it.variacaoId, unidadeId: p.fabricaId, tipo: 'TRANSFERENCIA', quantidade: agora,
          motivo: `Transferência para ${p.loja.nome} — ${motivo}`, referencia: pedidoId, transferenciaId,
          // A fábrica que ainda não lança a produção (empresa que vende sem
          // estoque) manda assim mesmo; as outras só mandam o que produziram.
          permitirNegativo: org.vendeSemEstoque,
        })
        if (!saida.ok) {
          throw new FabricaRecusou(`${p.fabrica.nome} tem ${saida.saldo} de ${it.variacao.produto.nome}: não dá para mandar ${agora}. Encerre a ordem de produção antes.`)
        }
        await mexerEstoqueEm(db, sessao, {
          variacaoId: it.variacaoId, unidadeId: p.lojaId, tipo: 'ENTRADA', quantidade: agora,
          motivo: `Transferência de ${p.fabrica.nome} — ${motivo}`, referencia: pedidoId, transferenciaId,
        })
        // Remessa com outro lote: os dois ficam no item, para o rastreio.
        const lote = it.lote && loteAgora && it.lote !== loteAgora && !it.lote.split(' + ').includes(loteAgora)
          ? `${it.lote} + ${loteAgora}`.slice(0, 120)
          : (it.lote ?? loteAgora)
        await db.pedidoFabricaItem.update({ where: { id: it.id }, data: { enviada: arred(jaFoi + agora), lote } })
      } else if (it.enviada === null) {
        await db.pedidoFabricaItem.update({ where: { id: it.id }, data: { enviada: 0 } })
      }
      if (arred(jaFoi + agora) < pedida) faltaMandar = true
    }
    if (!algum && !(opcoes.encerrar && doPedido.some((i) => n(i.enviada) > 0))) {
      throw new FabricaRecusou('Nada para mandar: ponha a quantidade de pelo menos um item, ou cancele o pedido.')
    }

    // Tudo foi, ou a fábrica disse que o resto não vai: o pedido segue para
    // a loja conferir. Senão continua aberto, esperando o resto.
    const fecha = !faltaMandar || opcoes.encerrar === true
    await db.pedidoFabrica.update({
      where: { id: pedidoId },
      data: { ...(fecha ? { situacao: 'ENVIADO' as const } : {}), enviadoPor: sessao.nome, enviadoEm: new Date() },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: p.fabricaId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'fabrica.pedido.enviou', alvoTipo: 'pedido', alvoId: pedidoId, alvoNome: `Pedido ${p.numero} · ${p.fabrica.nome} → ${p.loja.nome}`,
        depois: { fechou: fecha, faltaMandar: faltaMandar && !fecha },
        assinado: assinou,
      },
    })
    return { fechou: fecha }
  })
}

/**
 * A loja confere o que chegou.
 *
 * Veio a MENOS: a diferença sai como PERDA na loja (já tinha entrado no
 * envio), com o pedido no motivo. Veio a MAIS: a diferença entra na loja e
 * sai da fábrica, como a transferência que ela foi de verdade — antes a
 * conferência cortava no enviado e a peça a mais sumia das duas contas. Tudo
 * fica à vista de quem olha o pedido. Conferir mexe em saldo fora do envio
 * (perda, sobra): assina quem faz porque a empresa deixou, e todos quando a
 * empresa pede assinatura nas exceções e houve diferença.
 */
export async function receberPedido(
  sessao: Sessao,
  pedidoId: string,
  itens: { itemId: string; recebida: number }[],
  pin?: string | null,
) {
  const alvo = await comoOrg(sessao.orgId, async (db) => {
    const p = await db.pedidoFabrica.findUnique({ where: { id: pedidoId }, select: { lojaId: true } })
    const enviados = p ? await db.pedidoFabricaItem.findMany({ where: { pedidoId }, select: { id: true, enviada: true } }) : []
    return p ? { ...p, enviados } : null
  })
  if (!alvo) throw new FabricaRecusou('Pedido não encontrado nesta empresa.')
  exigir(sessao, 'estoque.ajustar', alvo.lojaId)
  if (itens.some((i) => !Number.isFinite(i.recebida) || i.recebida < 0)) throw new FabricaRecusou('Quantidade recebida precisa ser zero ou mais.')
  const informado = new Map(itens.map((i) => [i.itemId, i.recebida]))
  const comDiferenca = alvo.enviados.some((i) => informado.has(i.id) && arred(Number(informado.get(i.id))) !== arred(n(i.enviada)))
  const assinou = await assinar(sessao, alvo.lojaId, pin, comDiferenca)

  return comoOrg(sessao.orgId, async (db) => {
    await db.$executeRaw`select id from pedidos_fabrica where id = ${pedidoId} for update`
    const p = await db.pedidoFabrica.findUniqueOrThrow({
      where: { id: pedidoId },
      select: { numero: true, situacao: true, lojaId: true, fabricaId: true, loja: { select: { nome: true } }, fabrica: { select: { nome: true } } },
    })
    if (p.situacao !== 'ENVIADO') throw new FabricaRecusou(p.situacao === 'RECEBIDO' ? `O pedido ${p.numero} já foi conferido.` : `O pedido ${p.numero} ainda não foi enviado.`)
    const doPedido = await db.pedidoFabricaItem.findMany({
      where: { pedidoId },
      select: { id: true, variacaoId: true, enviada: true, variacao: { select: { produto: { select: { nome: true } } } } },
    })
    let faltas = 0
    let sobras = 0
    for (const it of doPedido) {
      const enviada = n(it.enviada)
      const recebida = arred(informado.has(it.id) ? Number(informado.get(it.id)) : enviada)
      // Item que não foi não se confere; e "chegou" muito acima do que foi é
      // dedo, não caixa — a sobra de verdade é pouca.
      if (enviada <= 0) {
        await db.pedidoFabricaItem.update({ where: { id: it.id }, data: { recebida: 0 } })
        continue
      }
      if (recebida > enviada * 2) {
        throw new FabricaRecusou(
          `${it.variacao.produto.nome}: foram ${enviada.toLocaleString('pt-BR')} e está escrito que chegaram ${recebida.toLocaleString('pt-BR')}. Confira a contagem.`,
        )
      }
      const falta = arred(enviada - recebida)
      if (falta > 0) {
        faltas++
        await mexerEstoqueEm(db, sessao, {
          variacaoId: it.variacaoId, unidadeId: p.lojaId, tipo: 'PERDA', quantidade: falta,
          motivo: `Faltou no recebimento do pedido ${p.numero}`, referencia: pedidoId, permitirNegativo: true,
        })
      } else if (falta < 0) {
        sobras++
        const transferenciaId = randomUUID()
        await mexerEstoqueEm(db, sessao, {
          variacaoId: it.variacaoId, unidadeId: p.fabricaId, tipo: 'TRANSFERENCIA', quantidade: -falta,
          motivo: `Transferência para ${p.loja.nome} — chegou a mais no pedido ${p.numero}`, referencia: pedidoId, transferenciaId,
          permitirNegativo: true,
        })
        await mexerEstoqueEm(db, sessao, {
          variacaoId: it.variacaoId, unidadeId: p.lojaId, tipo: 'ENTRADA', quantidade: -falta,
          motivo: `Transferência de ${p.fabrica.nome} — chegou a mais no pedido ${p.numero}`, referencia: pedidoId, transferenciaId,
        })
      }
      await db.pedidoFabricaItem.update({ where: { id: it.id }, data: { recebida } })
    }
    await db.pedidoFabrica.update({ where: { id: pedidoId }, data: { situacao: 'RECEBIDO', recebidoPor: sessao.nome, recebidoEm: new Date() } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, unidadeId: p.lojaId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'fabrica.pedido.recebeu', alvoTipo: 'pedido', alvoId: pedidoId, alvoNome: `Pedido ${p.numero} · ${p.loja.nome}`,
        depois: { itensComFalta: faltas, itensAMais: sobras },
        assinado: assinou,
      },
    })
    return { faltas, sobras }
  })
}

export async function cancelarPedido(sessao: Sessao, pedidoId: string) {
  const alvo = await comoOrg(sessao.orgId, (db) => db.pedidoFabrica.findUnique({ where: { id: pedidoId }, select: { lojaId: true, fabricaId: true } }))
  if (!alvo) throw new FabricaRecusou('Pedido não encontrado nesta empresa.')
  // Cancela quem pediu (a loja) ou quem atende (a fábrica).
  if (!pode(sessao, 'estoque.ajustar', alvo.lojaId) && !pode(sessao, 'estoque.ajustar', alvo.fabricaId)) exigir(sessao, 'estoque.ajustar', alvo.lojaId)
  await comoOrg(sessao.orgId, async (db) => {
    // Parte já saiu (remessa parcial): o pedido não se cancela — a fábrica
    // diz que o resto não vai, e a loja confere o que chegou.
    const jaFoi = await db.pedidoFabricaItem.count({ where: { pedidoId, enviada: { gt: 0 } } })
    if (jaFoi > 0) throw new FabricaRecusou('Parte deste pedido já foi mandada. A fábrica fecha o envio ("o resto não vai") e a loja confere o que chegou.')
    const r = await db.pedidoFabrica.updateMany({ where: { id: pedidoId, situacao: 'ABERTO' }, data: { situacao: 'CANCELADO' } })
    if (r.count === 0) throw new FabricaRecusou('Só pedido aberto se cancela. O que já saiu volta por transferência.')
    await db.auditoria.create({
      data: { orgId: sessao.orgId, unidadeId: alvo.lojaId, usuarioId: sessao.usuarioId, quem: sessao.nome, acao: 'fabrica.pedido.cancelou', alvoTipo: 'pedido', alvoId: pedidoId },
    })
  })
}

export type PedidoNaTela = {
  id: string
  numero: number
  lojaId: string
  loja: string
  fabricaId: string
  fabrica: string
  situacao: 'ABERTO' | 'ENVIADO' | 'RECEBIDO' | 'CANCELADO'
  observacao: string | null
  pedidoPor: string
  enviadoPor: string | null
  recebidoPor: string | null
  criadoEm: Date
  enviadoEm: Date | null
  recebidoEm: Date | null
  itens: { id: string; variacaoId: string; nome: string; codigo: string | null; medida: string; pedida: number; enviada: number | null; recebida: number | null; lote: string | null; saldoNaFabrica: number }[]
}

export async function listarPedidos(sessao: Sessao, filtro: { abertos?: boolean; limite?: number } = {}): Promise<PedidoNaTela[]> {
  exigir(sessao, 'estoque.ver')
  const unidades = unidadesQuePodem(sessao, 'estoque.ver')
  const linhas = await comoOrg(sessao.orgId, async (db) => {
    const pedidos = await db.pedidoFabrica.findMany({
      where: {
        ...(filtro.abertos ? { situacao: { in: ['ABERTO', 'ENVIADO'] } } : {}),
        ...(unidades === 'todas' ? {} : { OR: [{ lojaId: { in: unidades } }, { fabricaId: { in: unidades } }] }),
      },
      orderBy: { numero: 'desc' },
      take: filtro.limite ?? 60,
      select: {
        id: true, numero: true, lojaId: true, fabricaId: true, situacao: true, observacao: true,
        pedidoPor: true, enviadoPor: true, recebidoPor: true, criadoEm: true, enviadoEm: true, recebidoEm: true,
        loja: { select: { nome: true } }, fabrica: { select: { nome: true } },
        itens: {
          select: {
            id: true, variacaoId: true, pedida: true, enviada: true, recebida: true, lote: true,
            variacao: { select: { codigo: true, produto: { select: { nome: true, medida: true } }, opcoes: { select: { opcao: { select: { valor: true } } } } } },
          },
        },
      },
    })
    const fabricas = [...new Set(pedidos.map((p) => p.fabricaId))]
    const variacoes = [...new Set(pedidos.flatMap((p) => p.itens.map((i) => i.variacaoId)))]
    const saldos = fabricas.length && variacoes.length
      ? await db.estoque.findMany({ where: { unidadeId: { in: fabricas }, variacaoId: { in: variacoes } }, select: { unidadeId: true, variacaoId: true, quantidade: true } })
      : []
    return { pedidos, saldos }
  })
  const saldo = new Map(linhas.saldos.map((s) => [`${s.unidadeId}|${s.variacaoId}`, n(s.quantidade)]))
  return linhas.pedidos.map((p) => ({
    id: p.id, numero: p.numero, lojaId: p.lojaId, loja: p.loja.nome, fabricaId: p.fabricaId, fabrica: p.fabrica.nome,
    situacao: p.situacao, observacao: p.observacao, pedidoPor: p.pedidoPor, enviadoPor: p.enviadoPor, recebidoPor: p.recebidoPor,
    criadoEm: p.criadoEm, enviadoEm: p.enviadoEm, recebidoEm: p.recebidoEm,
    itens: p.itens
      .map((i) => ({
        id: i.id, variacaoId: i.variacaoId, nome: nomeDaVariacao(i.variacao), codigo: i.variacao.codigo, medida: i.variacao.produto.medida,
        pedida: n(i.pedida), enviada: i.enviada == null ? null : n(i.enviada), recebida: i.recebida == null ? null : n(i.recebida),
        lote: i.lote, saldoNaFabrica: saldo.get(`${p.fabricaId}|${i.variacaoId}`) ?? 0,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  }))
}

/**
 * O que a loja costuma pedir: os produtos que ela vende, com o saldo dela e o
 * que vendeu nos últimos 7 dias — a conta que a gerente faz de cabeça para
 * saber quanto pedir.
 */
export async function catalogoParaPedir(sessao: Sessao, lojaId: string) {
  exigir(sessao, 'estoque.ver', lojaId)
  const desde = new Date(Date.now() - 7 * 864e5)
  return comoOrg(sessao.orgId, async (db) => {
    const variacoes = await db.variacao.findMany({
      where: { ativa: true, produto: { ativo: true, servico: false, usoInterno: false } },
      select: {
        id: true, codigo: true,
        produto: { select: { nome: true, medida: true, vendidoEm: true, categoria: { select: { nome: true } } } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
        estoques: { where: { unidadeId: lojaId }, select: { quantidade: true } },
      },
    })
    const vendas = await db.$queryRaw<{ variacao_id: string; q: string }[]>`
      select i.variacao_id, sum(i.quantidade) q
        from venda_itens i join vendas v on v.id = i.venda_id
       where v.unidade_id = ${lojaId} and v.situacao = 'CONCLUIDA' and v.criada_em >= ${desde}
       group by 1`
    const vendeu = new Map(vendas.map((v) => [v.variacao_id, n(v.q)]))
    return variacoes
      .filter((v) => vendidoNaLoja(v.produto.vendidoEm, lojaId))
      .map((v) => ({
        variacaoId: v.id,
        nome: nomeDaVariacao(v),
        codigo: v.codigo,
        medida: v.produto.medida,
        gaveta: v.produto.categoria?.nome ?? null,
        saldo: v.estoques[0] ? n(v.estoques[0].quantidade) : null,
        vendeu7: vendeu.get(v.id) ?? 0,
      }))
      .sort((a, b) => (a.gaveta ?? '').localeCompare(b.gaveta ?? '', 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'))
  })
}

// ─────────────────────────────────────────────────────────────
// LEITURAS PARA AS TELAS
// ─────────────────────────────────────────────────────────────

export type UnidadeDaFabrica = { id: string; nome: string; ehFabrica: boolean; ehDeposito: boolean }

/**
 * As unidades abertas que a pessoa enxerga no estoque, dizendo qual é fábrica.
 * A tela separa daqui as fábricas (onde se produz) e as lojas (quem pede).
 */
export async function unidadesDaFabrica(sessao: Sessao): Promise<UnidadeDaFabrica[]> {
  exigir(sessao, 'estoque.ver')
  const permitidas = unidadesQuePodem(sessao, 'estoque.ver')
  return comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({
      where: { ativa: true, ...(permitidas === 'todas' ? {} : { id: { in: permitidas } }) },
      orderBy: [{ ehFabrica: 'desc' }, { ehDeposito: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, ehFabrica: true, ehDeposito: true },
    }),
  )
}

/**
 * As fábricas abertas da empresa, para onde a loja pode PEDIR — todas, e não
 * só as que a pessoa enxerga no estoque. A gerente presa à loja dela não vê o
 * estoque da fábrica (nem deve), mas precisa mandar o pedido para lá: com
 * `unidadesDaFabrica`, a lista de destinos dela vinha vazia e a tela dizia
 * "esta empresa ainda não tem fábrica". Só id e nome.
 */
export async function fabricasParaPedir(sessao: Sessao): Promise<{ id: string; nome: string }[]> {
  exigir(sessao, 'estoque.ver')
  return comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({
      where: { ativa: true, ehFabrica: true },
      orderBy: [{ criadaEm: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true },
    }),
  )
}

export type ItemDoCatalogo = {
  variacaoId: string
  nome: string
  codigo: string | null
  medida: string
  /** Material de uso (leite, palito, pote): o insumo típico. */
  usoInterno: boolean
  temReceita: boolean
  /** Só para quem vê custo. */
  custo: number | null
}

/**
 * O catálogo inteiro que a fábrica usa ou faz: o que vira insumo e o que
 * sai pronto. Uma leitura só, e a busca é na tela — a fábrica trabalha com
 * algumas dezenas de itens, não com o catálogo de uma loja de roupa.
 */
export async function catalogoDaFabrica(sessao: Sessao): Promise<ItemDoCatalogo[]> {
  exigir(sessao, 'estoque.ver')
  const verCusto = pode(sessao, 'produto.preco') || pode(sessao, 'financeiro.ver')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.variacao.findMany({
      where: { ativa: true, produto: { ativo: true, servico: false } },
      take: 5000,
      select: {
        id: true, codigo: true,
        produto: { select: { nome: true, medida: true, usoInterno: true, custo: true } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
        receita: { select: { id: true } },
      },
    }),
  )
  return linhas
    .map((v) => ({
      variacaoId: v.id,
      nome: nomeDaVariacao(v),
      codigo: v.codigo,
      medida: v.produto.medida,
      usoInterno: v.produto.usoInterno,
      temReceita: !!v.receita,
      custo: verCusto && v.produto.custo != null ? n(v.produto.custo) : null,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
