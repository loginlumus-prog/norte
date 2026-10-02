// As ferramentas de tocar a loja pelo WhatsApp: a compra que chegou e as
// encomendas.
//
// A mesma regra de ferramentas.ts: LER chama o banco com a sessão da PESSOA
// que está falando — só as lojas que ela vê. ESCREVER só monta a proposta;
// quem executa é a pessoa que confirma (o "SIM" na conversa, ou a tela), pelos
// mesmos serviços da tela (ver `executar` em agente.ts).
//
// ── "comprei 10 kg de picanha a 39,90 o quilo" ───────────────
// O modelo entende a frase; o servidor acha o produto. A busca é por CÓDIGO
// primeiro (etiqueta ou código de barras) e depois pelo NOME, sem acento e
// sem caixa. O que ela não faz é chutar: dois produtos que servem ("Picanha
// bovina" e "Picanha suína") voltam como pergunta, e o modelo pergunta à
// pessoa qual — proposta com o produto errado é estoque errado depois do sim.
// O resumo da proposta leva o nome DO CADASTRO, para a pessoa conferir antes
// de responder SIM.
//
// Produto que não existe pode nascer junto, se a pessoa disser o preço de
// venda — e só se ela puder cadastrar produto (conferido de novo no sim).

import type { Medida } from '@prisma/client'
import { comoOrg } from '../banco'
import { propor } from '../agente'
import { pode, type Sessao } from '../permissao'
import type { ComModulos } from '../modulos'
import { centavos, mostrar, multiplicar } from '../dinheiro'
import { quantidade as comMedida } from '../texto'
import { vendidoNaLoja } from '../catalogo-loja'
import { codigoEncomenda, ehFinal, ROTULO_ENCOMENDA, type SituacaoEncomenda } from '../encomenda'
import { diaEmSP, inicioDoDiaEmSP, somarDias } from '../dia'
import { unidadesVisiveis } from './contexto'
import { comoRecebe, finalDoCodigo, itensEmTexto, primeiroNome, quandoFalado } from './encomenda-texto'
import type { ResultadoFerramenta } from './ferramentas'

const MAXIMO_RESULTADO = 6000
const json = (v: unknown): ResultadoFerramenta => ({ texto: JSON.stringify(v).slice(0, MAXIMO_RESULTADO) })
const falha = (texto: string): ResultadoFerramenta => ({ texto, erro: true })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const brlC = (cent: number) => mostrar(Math.round(cent))
const brl = (v: number) => mostrar(Math.round(v * 100))

// ─────────────────────────────────────────────────────────────
// ACHAR O PRODUTO (puro)
// ─────────────────────────────────────────────────────────────

/** Sem acento, sem caixa, sem pontuação: "Picolé · Morango" → "picole morango". */
export const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Palavras que não dizem qual é o produto. */
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'kg', 'g', 'un', 'l', 'ml'])

export const palavrasDe = (s: string) => normalizar(s).split(' ').filter((p) => p.length >= 2 && !VAZIAS.has(p))

/** A palavra pedida bate com a do cadastro? Início de palavra, e o plural não separa. */
function bate(pedida: string, doCadastro: string): boolean {
  if (doCadastro === pedida || doCadastro.startsWith(pedida)) return true
  const sing = (p: string) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p)
  return sing(doCadastro) === sing(pedida)
}

export type Candidato = {
  variacaoId: string
  codigo: string | null
  codigoBarras: string | null
  nome: string
  /** "P · Azul", quando o produto tem grade. */
  opcoes: string | null
  medida: Medida
  vendidoEm: string[]
}

export type Achado =
  | { tipo: 'um'; produto: Candidato }
  | { tipo: 'varios'; candidatos: Candidato[] }
  | { tipo: 'nenhum' }

export const nomeCompleto = (c: Pick<Candidato, 'nome' | 'opcoes'>) => (c.opcoes ? `${c.nome} — ${c.opcoes}` : c.nome)

/**
 * O produto que a pessoa disse, dentre os candidatos — em degraus, e o
 * primeiro degrau que acha alguém decide:
 *
 *   1. o código da etiqueta ou o código de barras, exato;
 *   2. o nome completo (com a grade), exato;
 *   3. o nome do produto, exato ("picanha" acha "Picanha", mesmo havendo
 *      "Picanha suína");
 *   4. todas as palavras pedidas no nome ("picanha bov" acha "Picanha bovina").
 *
 * Um só no degrau: é ele. Mais de um: a pessoa escolhe. Nenhum: não existe.
 */
export function escolherProduto(pedido: string, candidatos: readonly Candidato[]): Achado {
  const p = normalizar(pedido)
  if (!p) return { tipo: 'nenhum' }
  const decide = (lista: Candidato[]): Achado | null =>
    lista.length === 1 ? { tipo: 'um', produto: lista[0]! } : lista.length > 1 ? { tipo: 'varios', candidatos: lista.slice(0, 8) } : null

  const cru = pedido.trim().toLowerCase()
  const porCodigo = candidatos.filter((c) => c.codigo?.toLowerCase() === cru || (c.codigoBarras && c.codigoBarras === pedido.trim()))
  const palavras = palavrasDe(pedido)
  return (
    decide(porCodigo) ??
    decide(candidatos.filter((c) => normalizar(nomeCompleto(c)) === p)) ??
    decide(candidatos.filter((c) => normalizar(c.nome) === p)) ??
    decide(
      palavras.length === 0
        ? []
        : candidatos.filter((c) => {
            const doCadastro = normalizar(nomeCompleto(c)).split(' ')
            return palavras.every((w) => doCadastro.some((d) => bate(w, d)))
          }),
    ) ?? { tipo: 'nenhum' }
  )
}

/** "kg", "quilo", "gramas", "litro", "un", "caixa"... → a medida do cadastro. Nulo = não disse. */
export function medidaDoTexto(t: string): Medida | null {
  const n = normalizar(t)
  if (!n) return null
  if (/^(kg|kgs|quilo|quilos|kilo|kilos|quilograma|quilogramas)$/.test(n)) return 'KG'
  if (/^(g|gr|grs|grama|gramas)$/.test(n)) return 'G'
  if (/^(l|lt|lts|litro|litros)$/.test(n)) return 'L'
  if (/^(ml|mililitro|mililitros)$/.test(n)) return 'ML'
  if (/^(m|metro|metros)$/.test(n)) return 'M'
  if (/^(par|pares)$/.test(n)) return 'PAR'
  if (/^(cx|caixa|caixas)$/.test(n)) return 'CX'
  if (/^(un|und|unid|unidade|unidades|pc|pca|peca|pecas)$/.test(n)) return 'UN'
  return null
}

/**
 * A quantidade dita numa medida, na medida do cadastro. "500 g" de um
 * produto vendido em quilo são 0,5 kg — e somar 500 ao saldo em quilo seria
 * o pior erro possível desta ferramenta. Medida que não converte (quilo de um
 * produto vendido por unidade) volta nula, e a pessoa é perguntada.
 */
export function converter(q: number, de: Medida | null, para: Medida): number | null {
  if (!de || de === para) return q
  const fator: Partial<Record<`${Medida}>${Medida}`, number>> = {
    'G>KG': 1 / 1000,
    'KG>G': 1000,
    'ML>L': 1 / 1000,
    'L>ML': 1000,
  }
  const f = fator[`${de}>${para}`]
  return f ? Math.round(q * f * 1000) / 1000 : null
}

/** "kg" de "1 kg" — a sigla da medida, para o preço por unidade. */
const sigla = (m: Medida) => comMedida(1, m).split(' ')[1] ?? 'un'

/** "picanha bovina" → "Picanha bovina", para o produto que nasce do que a pessoa disse. */
const comMaiuscula = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ─────────────────────────────────────────────────────────────
// A ENTRADA DE COMPRA
// ─────────────────────────────────────────────────────────────

/** Até onde a lista de itens de uma proposta vai. Nota maior é a tela de Estoque. */
const MAXIMO_ITENS = 20

type Loja = { id: string; nome: string; ehDeposito: boolean }

/** As lojas onde a pessoa dá entrada, e a que ela quis dizer. */
async function lojaDaEntrada(sessao: Sessao, pedida: string): Promise<{ loja: Loja | null; lojas: Loja[] }> {
  const ids = await unidadesVisiveis(sessao, 'estoque.ajustar')
  const lojas = await comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({
      where: { id: { in: ids }, ativa: true },
      orderBy: { criadaEm: 'asc' },
      select: { id: true, nome: true, ehDeposito: true },
    }),
  )
  if (pedida) {
    const p = normalizar(pedida)
    const achadas = lojas.filter((l) => normalizar(l.nome).includes(p))
    return { loja: achadas.length === 1 ? achadas[0]! : null, lojas }
  }
  // Sem dizer: a única loja que ela alcança. O depósito só entra se for a
  // única coisa — compra que chega sem dizer onde é compra de balcão.
  const lojasDeVenda = lojas.filter((l) => !l.ehDeposito)
  if (lojasDeVenda.length === 1) return { loja: lojasDeVenda[0]!, lojas }
  if (lojas.length === 1) return { loja: lojas[0]!, lojas }
  return { loja: null, lojas }
}

// O banco compara sem acento do mesmo jeito que `normalizar` (sem depender
// da extensão unaccent, que nem todo Postgres tem).
const COM_ACENTO = 'áàâãäéèêëíìîïóòôõöúùûüçñ'
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuucn'

/** Os candidatos do cadastro para as palavras pedidas (o filtro grosso; o fino é `escolherProduto`). */
async function candidatosDe(orgId: string, pedidos: string[]): Promise<Candidato[]> {
  const termos = new Set<string>()
  const codigos = new Set<string>()
  for (const p of pedidos) {
    codigos.add(p.trim().toLowerCase())
    for (const w of palavrasDe(p)) termos.add(`%${w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w}%`)
  }
  if (termos.size === 0 && codigos.size === 0) return []
  const linhas = await comoOrg(orgId, (db) =>
    db.$queryRaw<
      { variacaoId: string; codigo: string | null; codigoBarras: string | null; nome: string; opcoes: string | null; medida: Medida; vendidoEm: string[] | null }[]
    >`
      select vr.id as "variacaoId", vr.codigo, vr.codigo_barras as "codigoBarras", p.nome, p.medida as medida,
             p.vendido_em as "vendidoEm",
             (select string_agg(op.valor, ' · ' order by ex.ordem, op.ordem)
                from variacao_opcoes vo join opcoes op on op.id = vo.opcao_id join eixos ex on ex.id = op.eixo_id
               where vo.variacao_id = vr.id) as opcoes
        from variacoes vr
        join produtos p on p.id = vr.produto_id
       where p.ativo and vr.ativa and not p.servico
         and (lower(vr.codigo) = any(${[...codigos]}) or vr.codigo_barras = any(${[...codigos]})
              or translate(lower(p.nome), ${COM_ACENTO}, ${SEM_ACENTO}) like any(${[...termos]}))
       order by p.nome, vr.codigo
       limit 120
    `,
  )
  return linhas.map((l) => ({ ...l, vendidoEm: l.vendidoEm ?? [] }))
}

type ItemPedido = { produto: string; quantidade: number; custoUnit: number | null; medidaDita: Medida | null; precoVista: number | null }

function lerItens(bruto: unknown): ItemPedido[] | string {
  if (!Array.isArray(bruto) || bruto.length === 0) return 'Diga o que chegou: produto e quantidade.'
  if (bruto.length > MAXIMO_ITENS) return `Até ${MAXIMO_ITENS} itens por vez — uma nota maior se lança na tela de Estoque.`
  const itens: ItemPedido[] = []
  for (const b of bruto) {
    const o = b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
    const produto = str(o.produto, 120)
    const quantidade = numero(o.quantidade)
    const custo = o.custoUnit == null ? null : numero(o.custoUnit)
    const preco = o.precoVista == null ? null : numero(o.precoVista)
    if (!produto) return 'Um dos itens veio sem o nome ou o código do produto.'
    if (!(quantidade > 0) || quantidade > 1_000_000) return `A quantidade de "${produto}" precisa ser maior que zero.`
    if (custo !== null && !(custo >= 0)) return `O custo de "${produto}" não pode ser negativo.`
    if (preco !== null && !(preco > 0)) return `O preço de venda de "${produto}" precisa ser maior que zero.`
    itens.push({ produto, quantidade, custoUnit: custo, medidaDita: medidaDoTexto(str(o.unidade, 20)), precoVista: preco })
  }
  return itens
}

export async function proporEntrada(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const pedidos = lerItens(e.itens)
  if (typeof pedidos === 'string') return falha(pedidos)
  const fornecedor = str(e.fornecedor, 80)
  const documento = str(e.documento, 60)

  const { loja, lojas } = await lojaDaEntrada(sessao, str(e.loja, 60))
  if (!loja) {
    return falha(
      lojas.length === 0
        ? 'Esta pessoa não dá entrada de mercadoria em loja nenhuma.'
        : `Em qual loja? ${lojas.map((l) => l.nome).join(', ')}.`,
    )
  }

  const candidatos = await candidatosDe(orgId, pedidos.map((p) => p.produto))
  const podeCadastrar = pode(sessao, 'produto.cadastrar')

  type Linha = { variacaoId?: string; nome: string; medida: Medida; quantidade: number; custoUnit: number | null; precoVista?: number }
  const linhas: Linha[] = []
  const escolher: { pedido: string; opcoes: { produto: string; codigo: string | null }[] }[] = []
  const semCadastro: string[] = []
  const recusas: string[] = []

  for (const p of pedidos) {
    const a = escolherProduto(p.produto, candidatos)
    if (a.tipo === 'varios') {
      escolher.push({ pedido: p.produto, opcoes: a.candidatos.map((c) => ({ produto: nomeCompleto(c), codigo: c.codigo })) })
      continue
    }
    if (a.tipo === 'um') {
      const c = a.produto
      if (!loja.ehDeposito && !vendidoNaLoja(c.vendidoEm, loja.id)) {
        recusas.push(`A ${loja.nome} não vende ${nomeCompleto(c)} (está na ficha do produto, em "Vendido em").`)
        continue
      }
      const q = converter(p.quantidade, p.medidaDita, c.medida)
      if (q === null) {
        recusas.push(`${nomeCompleto(c)} é contado em ${sigla(c.medida)}, e a pessoa disse em ${p.medidaDita ? sigla(p.medidaDita) : '?'}: pergunte quanto é em ${sigla(c.medida)}.`)
        continue
      }
      // O custo dito por quilo vale por quilo do cadastro; dito por grama de
      // um produto em quilo, converte junto (o contrário da quantidade).
      const custo = p.custoUnit === null ? null : p.medidaDita && p.medidaDita !== c.medida ? Math.round((p.custoUnit * p.quantidade * 100) / q) / 100 : p.custoUnit
      linhas.push({ variacaoId: c.variacaoId, nome: nomeCompleto(c), medida: c.medida, quantidade: q, custoUnit: custo })
      continue
    }
    // Não existe no cadastro.
    if (!podeCadastrar) {
      recusas.push(`Não achei "${p.produto}" no cadastro, e esta pessoa não cadastra produto: quem cadastra precisa criar pela tela de Produtos.`)
      continue
    }
    if (p.precoVista === null) {
      semCadastro.push(p.produto)
      continue
    }
    linhas.push({
      nome: comMaiuscula(p.produto),
      medida: p.medidaDita ?? 'UN',
      quantidade: p.quantidade,
      custoUnit: p.custoUnit,
      precoVista: p.precoVista,
    })
  }

  if (recusas.length > 0) return falha(recusas.join(' '))
  if (escolher.length > 0 || semCadastro.length > 0) {
    // Não é erro: é pergunta. Nada vira proposta enquanto a pessoa não
    // disser qual — proposta com o produto errado é saldo errado depois do sim.
    return json({
      propostaCriada: false,
      ...(escolher.length > 0 ? { escolherEntre: escolher } : {}),
      ...(semCadastro.length > 0 ? { naoCadastrados: semCadastro } : {}),
      recado:
        (escolher.length > 0
          ? 'Há mais de um produto com esse nome: pergunte à pessoa qual é e chame de novo com o código escolhido. '
          : '') +
        (semCadastro.length > 0
          ? 'Não achei no cadastro: pergunte se o nome é outro ou se é produto novo. Se for novo, pergunte o preço de venda (à vista) e chame de novo com "precoVista" — ele é cadastrado junto, depois do SIM.'
          : ''),
    })
  }

  // ── o resumo, com os nomes DO CADASTRO ──
  let totalC = 0
  let todosComCusto = true
  const partes = linhas.map((l) => {
    const s = sigla(l.medida)
    let t = `${comMedida(l.quantidade, l.medida)} ${l.nome}`
    if (l.custoUnit !== null) {
      const linhaC = multiplicar(centavos(l.custoUnit), l.quantidade)
      totalC += linhaC
      t += ` (${brl(l.custoUnit)}/${s} = ${brlC(linhaC)})`
    } else {
      todosComCusto = false
    }
    if (l.precoVista != null) t += ` — produto novo, cadastrado com venda a ${brl(l.precoVista)}/${s}`
    return t
  })
  const resumo =
    `Entrada na ${loja.nome}: ${partes.join('; ')}.` +
    (linhas.length > 1 && totalC > 0 ? ` Total${todosComCusto ? '' : ' (dos itens com custo)'}: ${brlC(totalC)}.` : '') +
    ` Fornecedor: ${fornecedor || '—'}.` +
    (documento ? ` Nota: ${documento}.` : '')

  const proposta = await propor(orgId, empresa, {
    poder: 'estoque.entrada',
    resumo,
    ...(totalC > 0 ? { valor: totalC / 100 } : {}),
    usuarioId: sessao.usuarioId,
    dados: {
      unidadeId: loja.id,
      fornecedor,
      documento,
      itens: linhas.map((l) => ({
        ...(l.variacaoId ? { variacaoId: l.variacaoId } : {}),
        nome: l.nome,
        medida: l.medida,
        quantidade: l.quantidade,
        custoUnit: l.custoUnit,
        ...(l.precoVista != null ? { precoVista: l.precoVista } : {}),
      })),
    },
  })
  return {
    texto:
      `Proposta criada — nada foi lançado ainda. Mostre à pessoa este resumo, com os nomes como estão no cadastro, ` +
      `e termine com "Responda SIM para lançar": ${resumo}`,
    propostaId: proposta.id,
  }
}

// ─────────────────────────────────────────────────────────────
// AS ENCOMENDAS
// ─────────────────────────────────────────────────────────────

/** Quantos dias para a frente "as próximas" olha. */
const DIAS_A_FRENTE = 7

const SELECT_ENCOMENDA = {
  id: true,
  unidadeId: true,
  origem: true,
  vistaEm: true,
  clienteNome: true,
  descricao: true,
  valor: true,
  para: true,
  entrega: true,
  situacao: true,
  unidade: { select: { nome: true } },
  itens: { select: { descricao: true, quantidade: true }, take: 12 },
} as const

/**
 * O que sai hoje e nos próximos dias, nas lojas que a pessoa vê — com os
 * pedidos NOVOS do catálogo (que ninguém aceitou ainda) primeiro, qualquer
 * que seja o dia. O nome da cliente vai só o primeiro; telefone e endereço
 * não vão: quem precisa deles abre a tela.
 */
export async function verEncomendas(sessao: Sessao, agora = new Date()): Promise<ResultadoFerramenta> {
  const unidades = await unidadesVisiveis(sessao, 'venda.ver')
  if (unidades.length === 0) return falha('Nenhuma loja visível para esta pessoa.')
  const ate = inicioDoDiaEmSP(somarDias(diaEmSP(agora), DIAS_A_FRENTE + 1))

  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.encomenda.findMany({
      where: {
        unidadeId: { in: unidades },
        situacao: { in: ['ABERTA', 'PRONTA'] },
        OR: [{ para: { lt: ate } }, { origem: 'CATALOGO', vistaEm: null }],
      },
      orderBy: { para: 'asc' },
      take: 30,
      select: SELECT_ENCOMENDA,
    }),
  )
  if (linhas.length === 0) return json({ encomendas: [], recado: `Nenhuma encomenda em aberto até os próximos ${DIAS_A_FRENTE} dias.` })

  const novo = (l: (typeof linhas)[number]) => l.origem === 'CATALOGO' && !l.vistaEm
  const variasLojas = new Set(linhas.map((l) => l.unidadeId)).size > 1
  const ordenadas = [...linhas.filter(novo), ...linhas.filter((l) => !novo(l))]
  const novos = ordenadas.filter(novo).length
  return json({
    novosDoCatalogo: novos,
    encomendas: ordenadas.slice(0, 20).map((l) => ({
      codigo: codigoEncomenda(l.id),
      ...(novo(l) ? { novo: true } : {}),
      ...(l.origem === 'CATALOGO' ? { doCatalogo: true } : {}),
      situacao: ROTULO_ENCOMENDA[l.situacao as SituacaoEncomenda],
      atrasada: l.para.getTime() < agora.getTime() || undefined,
      quando: comoRecebe(l, agora),
      cliente: primeiroNome(l.clienteNome),
      itens: itensEmTexto(
        l.itens.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade) })),
        l.descricao,
      ),
      total: brl(Number(l.valor)),
      ...(variasLojas ? { loja: l.unidade.nome } : {}),
    })),
    ...(linhas.length > 20 ? { maisNaTela: linhas.length - 20 } : {}),
    ...(novos > 0
      ? { recado: 'Os pedidos "novo" vieram do catálogo e ninguém aceitou ainda: ofereça aceitar (você propõe, a pessoa responde SIM).' }
      : {}),
  })
}

const ACOES = ['aceitar', 'pronta', 'cancelar'] as const
type Acao = (typeof ACOES)[number]

/** A encomenda pelo código "ENC-XXXXXX", só nas lojas que a pessoa vê. */
export async function acharPeloCodigo(sessao: Sessao, codigo: string) {
  const fim = finalDoCodigo(codigo)
  if (!fim) return { erro: 'O código da encomenda é como "ENC-A1B2C3" — consulte as encomendas antes.' } as const
  const unidades = await unidadesVisiveis(sessao, 'venda.ver')
  const achadas = await comoOrg(sessao.orgId, (db) =>
    db.encomenda.findMany({
      where: { unidadeId: { in: unidades }, id: { endsWith: fim } },
      take: 3,
      select: { ...SELECT_ENCOMENDA, sinal: true, telefone: true },
    }),
  )
  if (achadas.length === 0) return { erro: `Não achei a encomenda ENC-${fim.toUpperCase()} nas lojas desta pessoa.` } as const
  if (achadas.length > 1) return { erro: 'Esse código bate com mais de uma encomenda. Abra a tela de Encomendas.' } as const
  return { encomenda: achadas[0]! } as const
}

export async function proporMudancaEncomenda(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
  agora = new Date(),
): Promise<ResultadoFerramenta> {
  const acao = str(e.acao, 20) as Acao
  const motivo = str(e.motivo, 300)
  if (!ACOES.includes(acao)) return falha('A ação é "aceitar", "pronta" ou "cancelar".')
  if (acao === 'cancelar' && motivo.length < 3) return falha('Cancelar pede o motivo, em uma frase.')

  const r = await acharPeloCodigo(sessao, str(e.codigo, 40))
  if ('erro' in r) return falha(r.erro!)
  const enc = r.encomenda
  const codigo = codigoEncomenda(enc.id)
  const doCatalogo = enc.origem === 'CATALOGO'

  // As mesmas recusas da tela, agora — para a pessoa não responder SIM a uma
  // proposta que vai falhar. A trava de verdade é no sim (o serviço confere).
  const cap = acao === 'cancelar' ? 'venda.cancelar' : 'venda.criar'
  if (!pode(sessao, cap, enc.unidadeId)) return falha('Esta pessoa não pode fazer isso nas encomendas dessa loja.')
  if (ehFinal(enc.situacao as SituacaoEncomenda)) {
    return falha(`A encomenda ${codigo} já está ${ROTULO_ENCOMENDA[enc.situacao as SituacaoEncomenda].toLowerCase()}.`)
  }
  if (acao === 'aceitar' && !doCatalogo) return falha(`A ${codigo} foi anotada no balcão — não há o que aceitar.`)
  if (acao === 'aceitar' && enc.vistaEm) return falha(`O pedido ${codigo} já foi aceito.`)
  if (acao === 'pronta' && enc.situacao === 'PRONTA') return falha(`A ${codigo} já está pronta.`)

  const oQue = itensEmTexto(
    enc.itens.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade) })),
    enc.descricao,
    120,
  )
  const quem = primeiroNome(enc.clienteNome)
  const detalhe = `${quem ? `de ${quem} ` : ''}(${oQue}, ${brl(Number(enc.valor))}, ${comoRecebe(enc, agora)})`
  const avisa = doCatalogo && enc.telefone ? ' A cliente recebe o aviso pelo WhatsApp.' : ''
  const sinal = Number(enc.sinal)
  const resumo =
    acao === 'aceitar'
      ? `Aceitar o pedido ${codigo} ${detalhe}.${avisa}`
      : acao === 'pronta'
        ? `Marcar a encomenda ${codigo} como pronta ${detalhe}.${avisa}`
        : `Cancelar a encomenda ${codigo} ${detalhe}. Motivo: ${motivo}.` +
          (sinal > 0 ? ` O sinal de ${brl(sinal)} fica como receita — para devolver, cancele pela tela de Encomendas.` : '') +
          avisa

  const proposta = await propor(orgId, empresa, {
    poder: 'encomenda.mudar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { encomendaId: enc.id, acao, origem: enc.origem, ...(acao === 'cancelar' ? { motivo } : {}) },
  })
  return {
    texto: `Proposta criada — nada mudou ainda. Mostre o resumo e termine com "Responda SIM para confirmar": ${resumo}`,
    propostaId: proposta.id,
  }
}
