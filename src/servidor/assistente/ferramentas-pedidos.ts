// As ferramentas de pedido e de vitrine pelo WhatsApp: o pedido de compra ao
// fornecedor, o pedido da loja à fábrica, a postagem e o ajuste do catálogo.
//
// A mesma regra de ferramentas.ts: ESCREVER só monta a proposta; quem executa
// é o dono que confirma, pelos MESMOS serviços da tela (`criarPedido` de
// compras.ts e de fabrica.ts, `criarPostagem`, `salvarCatalogo` — ver
// agente-acoes.ts).
//
// O pedido de compra nasce RASCUNHO: é o que a tela faz ao montar, e mandar ao
// fornecedor é outro passo, de quem confere a nota de pedido inteira. O
// pedido à fábrica nasce feito — é o "Pedir" da loja, e a fábrica é da casa.

import type { Medida } from '@prisma/client'
import { comoOrg } from '../banco'
import { propor } from '../agente'
import type { Capacidade, Sessao } from '../permissao'
import type { ComModulos } from '../modulos'
import { centavos, mostrar, multiplicar } from '../dinheiro'
import { quantidade as comMedida } from '../texto'
import { vendidoNaLoja } from '../catalogo-loja'
import { unidadesVisiveis } from './contexto'
import { candidatosDe, converter, escolherLoja, escolherProduto, medidaDoTexto, nomeCompleto } from './ferramentas-loja'
import { aposentarAnteriores, RECADO_DO_FECHO } from './propostas'
import type { ResultadoFerramenta } from './ferramentas'

const MAXIMO_RESULTADO = 6000
const MAXIMO_ITENS = 20
const json = (v: unknown): ResultadoFerramenta => ({ texto: JSON.stringify(v).slice(0, MAXIMO_RESULTADO) })
const falha = (texto: string): ResultadoFerramenta => ({ texto, erro: true })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const brl = (v: number) => mostrar(Math.round(v * 100))
const dataBR = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`

type Loja = { id: string; nome: string; ehDeposito: boolean; ehFabrica: boolean }

async function lojasQuePode(sessao: Sessao, cap: Capacidade): Promise<Loja[]> {
  const ids = await unidadesVisiveis(sessao, cap)
  return comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({
      where: { id: { in: ids }, ativa: true },
      orderBy: { criadaEm: 'asc' },
      select: { id: true, nome: true, ehDeposito: true, ehFabrica: true },
    }),
  )
}

function lojaDita(lojas: Loja[], pedida: string): Loja | null {
  if (pedida) return escolherLoja(lojas, pedida)
  const deVenda = lojas.filter((l) => !l.ehDeposito && !l.ehFabrica)
  if (deVenda.length === 1) return deVenda[0]!
  return lojas.length === 1 ? lojas[0]! : null
}

type Linha = { variacaoId: string; nome: string; medida: Medida; quantidade: number; custoUnit: number | null; custoHoje: number | null }

/**
 * Os itens ditos, achados no cadastro — a mesma busca da entrada de compra,
 * sem chutar: o que tem dois candidatos volta como pergunta, o que não existe
 * volta dito, e o que a loja não vende é recusado (a tela recusaria).
 */
async function itensDoPedido(
  orgId: string,
  bruto: unknown,
  loja: Loja,
): Promise<{ linhas: Linha[] } | { resultado: ResultadoFerramenta }> {
  if (!Array.isArray(bruto) || bruto.length === 0) return { resultado: falha('Diga o que pedir: produto e quantidade.') }
  if (bruto.length > MAXIMO_ITENS) return { resultado: falha(`Até ${MAXIMO_ITENS} itens por pedido — um pedido maior se monta na tela.`) }
  const pedidos = bruto.map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : {}))
  const candidatos = await candidatosDe(orgId, pedidos.map((p) => str(p.produto, 120)).filter(Boolean))
  const linhas: Linha[] = []
  const escolher: { pedido: string; opcoes: { produto: string; codigo: string | null }[] }[] = []
  const recusas: string[] = []
  for (const p of pedidos) {
    const nome = str(p.produto, 120)
    const q = numero(p.quantidade)
    if (!nome) return { resultado: falha('Um dos itens veio sem o nome ou o código do produto.') }
    if (!(q > 0) || q > 1_000_000) return { resultado: falha(`A quantidade de "${nome}" precisa ser maior que zero.`) }
    const a = escolherProduto(nome, candidatos)
    if (a.tipo === 'varios') {
      escolher.push({ pedido: nome, opcoes: a.candidatos.map((c) => ({ produto: nomeCompleto(c), codigo: c.codigo })) })
      continue
    }
    if (a.tipo === 'nenhum') {
      recusas.push(`Não achei "${nome}" no cadastro — produto novo se cadastra antes (produto_cadastrar).`)
      continue
    }
    const c = a.produto
    if (!loja.ehDeposito && !vendidoNaLoja(c.vendidoEm, loja.id)) {
      recusas.push(`A ${loja.nome} não vende ${nomeCompleto(c)} (está na ficha do produto, em "Vendido em").`)
      continue
    }
    const unidade = str(p.unidade, 20)
    const dita = unidade ? medidaDoTexto(unidade) : null
    const naMedida = converter(q, dita, c.medida)
    if (naMedida === null) {
      recusas.push(`${nomeCompleto(c)} é contado em ${comMedida(1, c.medida).split(' ')[1]}: pergunte quanto é nessa medida.`)
      continue
    }
    const custo = p.custoUnit == null ? null : numero(p.custoUnit)
    if (custo !== null && !(custo >= 0)) return { resultado: falha(`O custo de "${nome}" não pode ser negativo.`) }
    linhas.push({ variacaoId: c.variacaoId, nome: nomeCompleto(c), medida: c.medida, quantidade: naMedida, custoUnit: custo, custoHoje: c.custo ?? null })
  }
  if (recusas.length > 0) return { resultado: falha(recusas.join(' ')) }
  if (escolher.length > 0) {
    return {
      resultado: json({
        propostaCriada: false,
        escolherEntre: escolher,
        recado: 'Há mais de um produto com esse nome: pergunte qual é e chame de novo com o código escolhido.',
      }),
    }
  }
  if (new Set(linhas.map((l) => l.variacaoId)).size !== linhas.length) {
    return { resultado: falha('O mesmo item apareceu duas vezes: some as quantidades numa linha só.') }
  }
  return { linhas }
}

// ─────────────────────────────────────────────────────────────
// O PEDIDO DE COMPRA
// ─────────────────────────────────────────────────────────────

export async function proporPedidoDeCompra(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const lojas = (await lojasQuePode(sessao, 'compra.gerir')).filter((l) => !l.ehFabrica)
  const loja = lojaDita(lojas, str(e.loja, 60))
  if (!loja) return falha(lojas.length === 0 ? 'Esta pessoa não monta pedido de compra em loja nenhuma.' : `Para qual loja é o pedido? ${lojas.map((l) => l.nome).join(', ')}.`)
  const r = await itensDoPedido(orgId, e.itens, loja)
  if ('resultado' in r) return r.resultado

  let fornecedor: { id: string; nome: string } | null = null
  const pedidoFornecedor = str(e.fornecedor, 80)
  if (pedidoFornecedor) {
    const todos = await comoOrg(orgId, (db) =>
      db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
    )
    fornecedor = escolherLoja(todos, pedidoFornecedor)
    if (!fornecedor) {
      return falha(
        todos.length === 0
          ? 'Esta empresa ainda não tem fornecedor cadastrado: monte sem fornecedor, ou cadastre na tela de Compras.'
          : `Não achei o fornecedor "${pedidoFornecedor}". Os cadastrados: ${todos.slice(0, 20).map((f) => f.nome).join(', ')}.`,
      )
    }
  }
  const previsto = str(e.previsto, 10)
  if (previsto && !/^\d{4}-\d{2}-\d{2}$/.test(previsto)) return falha('A data prevista precisa ser AAAA-MM-DD.')
  const observacao = str(e.observacao, 500)

  // O total estimado pelo custo dito, ou pelo do cadastro — o mesmo que o
  // pedido fotografa (ver `itensConferidos` em compras.ts). É ele que passa
  // pelo teto de valor do assistente.
  let totalC = 0
  const partes = r.linhas.map((l) => {
    const custo = l.custoUnit ?? l.custoHoje
    if (custo != null) totalC += multiplicar(centavos(custo), l.quantidade)
    return `${comMedida(l.quantidade, l.medida)} ${l.nome}${l.custoUnit != null ? ` (${brl(l.custoUnit)}/${comMedida(1, l.medida).split(' ')[1]})` : ''}`
  })
  const resumo =
    `Montar pedido de compra para a ${loja.nome}${fornecedor ? `, fornecedor ${fornecedor.nome}` : ''}: ${partes.join('; ')}.` +
    (totalC > 0 ? ` Total estimado: ${mostrar(totalC)}.` : '') +
    (previsto ? ` Previsto para ${dataBR(previsto)}.` : '') +
    ' Fica como rascunho, para mandar ao fornecedor pela tela de Compras.'
  const proposta = await propor(orgId, empresa, {
    poder: 'compras.pedido',
    resumo,
    ...(totalC > 0 ? { valor: totalC / 100 } : {}),
    usuarioId: sessao.usuarioId,
    dados: {
      unidadeId: loja.id,
      fornecedorId: fornecedor?.id ?? null,
      previsto: previsto || null,
      observacao: observacao || null,
      itens: r.linhas.map((l) => ({ variacaoId: l.variacaoId, quantidade: l.quantidade, custoUnit: l.custoUnit, nome: l.nome, medida: l.medida })),
    },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'compras.pedido', novaId: proposta.id })
  return { texto: `Proposta criada — o pedido ainda não existe: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

// ─────────────────────────────────────────────────────────────
// O PEDIDO À FÁBRICA
// ─────────────────────────────────────────────────────────────

export async function proporPedidoAFabrica(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const lojas = (await lojasQuePode(sessao, 'fabrica.pedir')).filter((l) => !l.ehFabrica)
  const loja = lojaDita(lojas, str(e.loja, 60))
  if (!loja) return falha(lojas.length === 0 ? 'Esta pessoa não pede à fábrica por loja nenhuma.' : `Para qual loja é o pedido? ${lojas.map((l) => l.nome).join(', ')}.`)
  const fabricas = await comoOrg(orgId, (db) =>
    db.unidade.findMany({ where: { ehFabrica: true, ativa: true }, orderBy: { criadaEm: 'asc' }, select: { id: true, nome: true } }),
  )
  if (fabricas.length === 0) return falha('Esta empresa não tem fábrica aberta.')
  const pedidaFabrica = str(e.fabrica, 60)
  const fabrica = pedidaFabrica ? escolherLoja(fabricas, pedidaFabrica) : fabricas.length === 1 ? fabricas[0]! : null
  if (!fabrica) return falha(`Para qual fábrica? ${fabricas.map((f) => f.nome).join(', ')}.`)
  const r = await itensDoPedido(orgId, e.itens, loja)
  if ('resultado' in r) return r.resultado
  const observacao = str(e.observacao, 500)

  const resumo =
    `Pedir à ${fabrica.nome} para a ${loja.nome}: ${r.linhas.map((l) => `${comMedida(l.quantidade, l.medida)} ${l.nome}`).join('; ')}.` +
    (observacao ? ` Observação: ${observacao}.` : '')
  const proposta = await propor(orgId, empresa, {
    poder: 'fabrica.pedir',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: {
      lojaId: loja.id,
      fabricaId: fabrica.id,
      fabrica: fabrica.nome,
      observacao: observacao || null,
      itens: r.linhas.map((l) => ({ variacaoId: l.variacaoId, quantidade: l.quantidade })),
    },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'fabrica.pedir', novaId: proposta.id })
  return { texto: `Proposta criada — o pedido ainda não foi feito: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

// ─────────────────────────────────────────────────────────────
// O CATÁLOGO
// ─────────────────────────────────────────────────────────────

/**
 * As lojas que TÊM catálogo (o link já criado na tela). As de toda a empresa,
 * e não só as de quem pede: mexer no catálogo é `empresa.configurar`, que só
 * o dono tem — quem pede não tem loja "dela" nesse assunto, e quem decide é o
 * dono, no sim.
 */
async function lojasComCatalogo(orgId: string) {
  return comoOrg(orgId, (db) =>
    db.catalogoLoja.findMany({
      where: { unidade: { ativa: true } },
      orderBy: { unidade: { criadaEm: 'asc' } },
      select: {
        unidadeId: true, ativo: true, entrega: true, retirada: true, taxaEntrega: true, pedidoMinimo: true, recado: true,
        unidade: { select: { nome: true } },
      },
    }),
  )
}

type ComCatalogo = Awaited<ReturnType<typeof lojasComCatalogo>>[number]

function catalogoDito(lojas: ComCatalogo[], pedida: string): ComCatalogo | null {
  if (lojas.length === 1 && !pedida) return lojas[0]!
  const achada = pedida ? escolherLoja(lojas.map((l) => ({ ...l, nome: l.unidade.nome })), pedida) : null
  return achada ? lojas.find((l) => l.unidadeId === achada.unidadeId)! : null
}

const perguntaDoCatalogo = (lojas: ComCatalogo[]) =>
  lojas.length === 0
    ? 'Nenhuma loja tem catálogo ainda: o link (endereço e WhatsApp) se cria na tela de Catálogo.'
    : `De qual loja é o catálogo? ${lojas.map((l) => l.unidade.nome).join(', ')}.`

export async function proporPostagem(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const titulo = str(e.titulo, 80)
  const texto = str(e.texto, 400)
  if (titulo.length < 2) return falha('Falta o título da postagem (ex.: "Sabor novo: pistache").')
  if (!texto) return falha('Falta o texto da postagem: pelo WhatsApp a postagem é de texto (foto, pela tela de Catálogo).')
  const lojas = await lojasComCatalogo(orgId)
  const loja = catalogoDito(lojas, str(e.loja, 60))
  if (!loja) return falha(perguntaDoCatalogo(lojas))
  const stories = e.stories === 'dia' || e.stories === 'sempre' ? e.stories : 'nao'

  let produto: { id: string; nome: string } | null = null
  const pedidoProduto = str(e.produto, 120)
  if (pedidoProduto) {
    const a = escolherProduto(pedidoProduto, await candidatosDe(orgId, [pedidoProduto]))
    if (a.tipo === 'varios') {
      return json({
        propostaCriada: false,
        escolherEntre: [{ pedido: pedidoProduto, opcoes: a.candidatos.map((c) => ({ produto: nomeCompleto(c), codigo: c.codigo })) }],
        recado: 'Há mais de um produto assim: pergunte qual e chame de novo com o código.',
      })
    }
    if (a.tipo === 'nenhum') return falha(`Não achei "${pedidoProduto}" no cadastro.`)
    const v = await comoOrg(orgId, (db) =>
      db.variacao.findUnique({ where: { id: a.produto.variacaoId }, select: { produto: { select: { id: true, nome: true } } } }),
    )
    produto = v?.produto ?? null
  }

  const resumo =
    `Postar no catálogo da ${loja.unidade.nome}: "${titulo}" — ${texto}` +
    (produto ? ` (ligado a ${produto.nome})` : '') +
    (stories === 'dia' ? '. Nas bolinhas do topo por um dia.' : stories === 'sempre' ? '. Nas bolinhas do topo enquanto existir.' : '.')
  const proposta = await propor(orgId, empresa, {
    poder: 'catalogo.postar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { unidadeId: loja.unidadeId, loja: loja.unidade.nome, titulo, texto, produtoId: produto?.id ?? null, stories },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'catalogo.postar', novaId: proposta.id })
  return { texto: `Proposta criada — nada foi postado ainda: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

export async function proporAjusteDoCatalogo(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const lojas = await lojasComCatalogo(orgId)
  const loja = catalogoDito(lojas, str(e.loja, 60))
  if (!loja) return falha(perguntaDoCatalogo(lojas))
  const mudancas: Record<string, unknown> = {}
  const linhas: string[] = []
  const dinheiroAtual = (v: unknown) => (v == null ? null : Number(v))

  if (typeof e.aberto === 'boolean' && e.aberto !== loja.ativo) {
    mudancas.ativo = e.aberto
    linhas.push(e.aberto ? 'abrir o catálogo' : 'fechar o catálogo')
  }
  for (const [k, rotulo] of [['entrega', 'entrega'], ['retirada', 'retirada']] as const) {
    if (typeof e[k] === 'boolean' && e[k] !== loja[k]) {
      mudancas[k] = e[k]
      linhas.push(`${e[k] ? 'com' : 'sem'} ${rotulo}`)
    }
  }
  for (const [k, rotulo] of [['taxaEntrega', 'taxa de entrega'], ['pedidoMinimo', 'pedido mínimo']] as const) {
    if (e[k] == null) continue
    const v = numero(e[k])
    if (!(v >= 0) || v > 100_000) return falha(`O valor de ${rotulo} precisa ser zero ou mais.`)
    const atual = dinheiroAtual(loja[k])
    if ((atual ?? 0) === v) continue
    mudancas[k] = v
    linhas.push(v === 0 ? `sem ${rotulo}` : `${rotulo} ${atual ? `${brl(atual)} → ` : ''}${brl(v)}`)
  }
  const fica = { entrega: (mudancas.entrega as boolean | undefined) ?? loja.entrega, retirada: (mudancas.retirada as boolean | undefined) ?? loja.retirada }
  if (!fica.entrega && !fica.retirada) return falha('O catálogo precisa de pelo menos um jeito de a cliente receber: retirada ou entrega.')
  if (linhas.length === 0) return falha(`Nada a mudar no catálogo da ${loja.unidade.nome}: diga o que muda.`)

  const resumo = `Ajustar o catálogo da ${loja.unidade.nome}: ${linhas.join('; ')}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'catalogo.ajustar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { unidadeId: loja.unidadeId, loja: loja.unidade.nome, mudancas },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'catalogo.ajustar', novaId: proposta.id, mesmoAlvo: { campo: 'unidadeId', valor: loja.unidadeId } })
  return { texto: `Proposta criada — o catálogo ainda não mudou: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}
