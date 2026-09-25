// O que cada ferramenta faz de verdade, quando o modelo pede.
//
// ── ler: direto, com os mesmos serviços da tela ──────────────
// A ferramenta de leitura chama a MESMA função que a tela chama, com a
// sessão da PESSOA que está falando (montada do banco, com os papéis de
// agora). Então o assistente não tem um caminho paralelo para o banco: ele
// enxerga o que ela enxergaria na tela, e a regra de quem vê o quê continua
// morando num lugar só.
//
// Quem fala é sempre alguém da EQUIPE: mensagem de cliente não chega ao
// modelo (ver `conversa.ts`), então aqui não existe caminho "de cliente".
//
// A exceção de forma é `consultar.produto`: uma consulta própria, pequena,
// que devolve o que a vitrine devolveria — nome, preço, tem ou não tem. É a
// resposta pronta para quem da equipe precisa responder rápido a um cliente;
// quem quer o saldo de cada loja usa `ver.estoque`.
//
// ── escrever: nunca ──────────────────────────────────────────
// A ferramenta de escrita monta a PROPOSTA (`propor` em agente.ts, que confere
// o teto antes de gravar) e para. Quem executa é a pessoa que confirma, pela
// tela, com a capacidade dela conferida de novo. Não existe neste arquivo uma
// linha que escreva em lançamento, estoque ou preço.

import { comoOrg } from '../banco'
import { propor, AcimaDoTeto, PoderNegado, PODERES, type ChavePoder, type Poder } from '../agente'
import { resumoDoPainel } from '../painel'
import { janela, type Periodo } from '../periodo'
import { previsaoDeRuptura } from '../ruptura'
import { listarCaixas } from '../caixa'
import { aVencer } from '../financeiro'
import { mostrar } from '../dinheiro'
import { pode, type Sessao } from '../permissao'
import type { ComModulos } from '../modulos'
import { unidadesVisiveis } from './contexto'
import { buscarNoGuia } from '../guia'
import { CAPACIDADES } from '../permissao'
import type { Equipe } from './regras'

export type ResultadoFerramenta = { texto: string; erro?: boolean; propostaId?: string }

/** O modelo lê resultado de ferramenta por token. Resultado gigante é conta grande. */
const MAXIMO_RESULTADO = 6000
const json = (v: unknown): ResultadoFerramenta => ({ texto: JSON.stringify(v).slice(0, MAXIMO_RESULTADO) })
const falha = (texto: string): ResultadoFerramenta => ({ texto, erro: true })

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
/** Reais soltos (já somados, já divididos) para "R$ 1234,56". */
const brl = (v: number) => mostrar(Math.round(v * 100))
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)

/**
 * Executa a ferramenta que o modelo pediu. O chamador já conferiu que ela
 * estava na mesa desta conversa; aqui confere de novo a capacidade de quem
 * fala, porque conferir duas vezes é barato e esquecer uma vez não é.
 */
export async function executarFerramenta(
  orgId: string,
  empresa: ComModulos,
  quem: Equipe,
  poder: ChavePoder,
  entrada: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const p: Poder = PODERES[poder]
  if (p.semIA) return falha('Ferramenta indisponível nesta conversa.')
  if (!p.sempre && !pode(quem.sessao, p.exige)) return falha('Esta pessoa não tem permissão para isso.')

  try {
    switch (poder) {
      case 'ver.resumo':
        return await verResumo(quem.sessao, str(entrada.periodo, 20))
      case 'ver.estoque':
        return await verEstoque(quem.sessao, str(entrada.busca, 60))
      case 'ver.caixa':
        return await verCaixa(quem.sessao)
      case 'ver.contas':
        return await verContas(quem.sessao)
      case 'consultar.produto':
        return await consultarProduto(orgId, str(entrada.busca, 60))
      case 'explicar.sistema':
        return explicarSistema(empresa, quem.sessao, str(entrada.pergunta, 300))
      case 'lancar.despesa':
      case 'pedir.compra':
        return await proporLancamento(orgId, empresa, poder, entrada)
      case 'ajustar.estoque':
        return await proporAjuste(orgId, empresa, quem.sessao, entrada)
      default:
        return falha('Ferramenta indisponível nesta conversa.')
    }
  } catch (e) {
    // Os dois erros de trava viram frase para o modelo repassar. O resto é
    // defeito nosso: vai para o log, e o modelo recebe uma frase neutra.
    if (e instanceof AcimaDoTeto || e instanceof PoderNegado) return falha(e.message)
    console.error(`[assistente] ferramenta ${poder} falhou:`, e instanceof Error ? e.message : e)
    return falha('Não consegui consultar isso agora.')
  }
}


// ─────────────────────────────────────────────────────────────
// LER
// ─────────────────────────────────────────────────────────────

const PERIODOS_ACEITOS = new Set(['hoje', 'ontem', '7d', '30d', 'mes', 'mes-passado'])

async function verResumo(sessao: Sessao, pedido: string): Promise<ResultadoFerramenta> {
  const periodo = PERIODOS_ACEITOS.has(pedido) ? pedido : 'hoje'
  // "Ontem" é o "hoje" de 24 horas atrás: mesma janela de calendário, com a
  // comparação contra anteontem — que é o que o dono quer ouvir de manhã.
  const j =
    periodo === 'ontem'
      ? { ...janela('hoje', new Date(Date.now() - 864e5)), rotulo: 'Ontem', comparacao: 'vs anteontem' }
      : janela(periodo as Periodo)

  const unidades = await unidadesVisiveis(sessao, 'relatorio.ver')
  const r = await resumoDoPainel(sessao, unidades, j)
  const variacao =
    r.anterior.total > 0 ? Math.round(((r.atual.total - r.anterior.total) / r.anterior.total) * 100) : null

  return json({
    periodo: j.rotulo,
    vendas: r.atual.vendas,
    total: brl(r.atual.total),
    ticketMedio: brl(r.atual.ticket),
    comparacao: { com: j.comparacao, total: brl(r.anterior.total), variacaoPct: variacao },
    devolucoes: r.devolucoes.quantas > 0 ? { quantas: r.devolucoes.quantas, valor: brl(r.devolucoes.valor) } : null,
    maisVendidos: r.maisVendidos.slice(0, 5).map((m) => ({ item: m.descricao, quantidade: m.quantidade })),
    porForma: r.porForma.map((f) => ({ forma: f.forma, total: brl(f.total) })),
    porLoja: r.porUnidade.length > 1 ? r.porUnidade.map((u) => ({ loja: u.nome, total: brl(u.total) })) : undefined,
  })
}

async function verEstoque(sessao: Sessao, busca: string): Promise<ResultadoFerramenta> {
  const unidades = await unidadesVisiveis(sessao, 'estoque.ver')
  if (unidades.length === 0) return falha('Nenhuma loja visível para esta pessoa.')

  if (!busca) {
    const linhas = await previsaoDeRuptura(sessao, unidades)
    const urgentes = linhas.filter((l) => ['ja_faltou', 'pedir_agora', 'atencao'].includes(l.previsao.situacao))
    return json({
      vaiFaltar: urgentes.slice(0, 12).map((l) => ({
        peca: [l.nome, l.opcoes].filter(Boolean).join(' — '),
        codigo: l.codigo,
        saldo: l.saldo,
        vendidos30dias: l.vendidos30,
        situacao: l.previsao.situacao,
        duraDias: l.previsao.duraDias === null ? null : Math.floor(l.previsao.duraDias),
        pedirAte: l.previsao.pedirAte?.toISOString().slice(0, 10) ?? null,
      })),
      totalNaLista: urgentes.length,
    })
  }

  const termo = `%${busca.replace(/[%_]/g, '')}%`
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.$queryRaw<{ nome: string; codigo: string | null; opcoes: string | null; loja: string; saldo: string }[]>`
      select p.nome, vr.codigo,
             (select string_agg(op.valor, ' · ' order by ex.ordem, op.ordem)
                from variacao_opcoes vo join opcoes op on op.id = vo.opcao_id join eixos ex on ex.id = op.eixo_id
               where vo.variacao_id = vr.id) as opcoes,
             u.nome as loja, e.quantidade as saldo
        from variacoes vr
        join produtos p on p.id = vr.produto_id
        join estoque e on e.variacao_id = vr.id and e.unidade_id = any(${unidades})
        join unidades u on u.id = e.unidade_id
       where p.ativo and vr.ativa
         and (p.nome ilike ${termo} or p.marca ilike ${termo} or vr.codigo ilike ${termo})
       order by p.nome, vr.codigo, u.nome
       limit 40
    `,
  )
  if (linhas.length === 0) return json({ achados: 0, recado: 'Nada com esse nome ou código.' })
  return json({
    achados: linhas.length,
    itens: linhas.map((l) => ({
      peca: [l.nome, l.opcoes].filter(Boolean).join(' — '),
      codigo: l.codigo,
      loja: l.loja,
      saldo: Number(l.saldo),
    })),
  })
}

async function verCaixa(sessao: Sessao): Promise<ResultadoFerramenta> {
  const unidades = await unidadesVisiveis(sessao, 'caixa.ver')
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1)
  const turnos = await listarCaixas(sessao, { unidadeIds: unidades, de: hoje, ate: amanha })
  return json({
    turnosHoje: turnos.slice(0, 10).map((t) => ({
      loja: t.unidade,
      aberto: t.aberto,
      abertoPor: t.abertoPor,
      vendas: t.vendas,
      vendido: brl(t.vendido),
      fechadoPor: t.fechadoPor,
      diferenca: t.diferenca === null ? null : brl(t.diferenca),
    })),
  })
}

async function verContas(sessao: Sessao): Promise<ResultadoFerramenta> {
  const unidades = await unidadesVisiveis(sessao, 'financeiro.ver')
  const a = await aVencer(sessao, unidades, 15)
  const linha = (l: { descricao: string; valor: number; vencimento: Date }) => ({
    conta: l.descricao,
    valor: brl(l.valor),
    vence: l.vencimento.toISOString().slice(0, 10),
  })
  return json({
    vencidas: a.vencidas.slice(0, 10).map(linha),
    totalVencido: brl(a.totalVencido),
    vencemHoje: a.hoje.slice(0, 10).map(linha),
    proximos15dias: a.proximas.slice(0, 10).map(linha),
    totalProximos: brl(a.totalProximos),
  })
}

/**
 * A vitrine: nome, preço, tem ou não tem.
 *
 * "Tem" é saldo em loja de verdade — depósito não conta, porque o cliente
 * a quem a equipe repassa o "tem" vai até a loja. A quantidade por loja é
 * `ver.estoque`, que confere as lojas que a pessoa enxerga.
 */
async function consultarProduto(orgId: string, busca: string): Promise<ResultadoFerramenta> {
  if (busca.length < 2) return falha('Diga o nome ou o código da peça.')
  const termo = `%${busca.replace(/[%_]/g, '')}%`
  const linhas = await comoOrg(orgId, (db) =>
    db.$queryRaw<
      { produto: string; opcoes: string | null; vista: string | null; cartao: string | null; ajuste: string | null; tem: boolean }[]
    >`
      select p.nome as produto,
             (select string_agg(op.valor, ' · ' order by ex.ordem, op.ordem)
                from variacao_opcoes vo join opcoes op on op.id = vo.opcao_id join eixos ex on ex.id = op.eixo_id
               where vo.variacao_id = vr.id) as opcoes,
             p.preco_vista as vista, p.preco_cartao as cartao, vr.ajuste_preco as ajuste,
             coalesce((select sum(e.quantidade) > 0
                         from estoque e join unidades u on u.id = e.unidade_id
                        where e.variacao_id = vr.id and u.ativa and not u.eh_deposito), false) as tem
        from variacoes vr
        join produtos p on p.id = vr.produto_id
       where p.ativo and vr.ativa
         and (p.nome ilike ${termo} or p.marca ilike ${termo} or vr.codigo ilike ${termo})
       order by p.nome, vr.codigo
       limit 20
    `,
  )
  if (linhas.length === 0) return json({ achados: 0, recado: 'Não achei essa peça no catálogo.' })
  const preco = (base: string | null, ajuste: string | null) =>
    base === null ? null : brl(Number(base) + Number(ajuste ?? 0))
  return json({
    itens: linhas.map((l) => ({
      peca: [l.produto, l.opcoes].filter(Boolean).join(' — '),
      precoVista: preco(l.vista, l.ajuste),
      precoCartao: l.cartao === l.vista ? undefined : preco(l.cartao, l.ajuste),
      disponivel: l.tem,
    })),
  })
}

// ─────────────────────────────────────────────────────────────
// PROPOR
// ─────────────────────────────────────────────────────────────

const dataValida = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}
const dataBR = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

async function proporLancamento(
  orgId: string,
  empresa: ComModulos,
  poder: 'lancar.despesa' | 'pedir.compra',
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const descricao = str(e.descricao, 120)
  const valor = numero(e.valor)
  const vencimento = dataValida(str(e.vencimento, 10))
  const fornecedor = str(e.fornecedor, 80)
  if (!descricao) return falha('Falta dizer o que é a conta.')
  if (!(valor > 0)) return falha('O valor precisa ser maior que zero.')
  if (!vencimento) return falha('A data de vencimento precisa ser AAAA-MM-DD.')

  const categoria = await acharCategoria(orgId, poder === 'pedir.compra' ? 'Compra de mercadoria' : str(e.categoria, 60))
  if (!categoria) return falha('O financeiro desta loja ainda não foi preparado; alguém precisa abrir a tela do Financeiro uma vez.')

  const oque = poder === 'pedir.compra' ? 'Registrar compra de mercadoria' : 'Lançar conta a pagar'
  const resumo =
    `${oque}: "${descricao}" — ${brl(valor)}, vence ${dataBR(vencimento)}` +
    `${fornecedor ? `, ${fornecedor}` : ''} (${categoria.nome}).`

  const proposta = await propor(orgId, empresa, {
    poder,
    resumo,
    valor,
    dados: {
      categoriaId: categoria.id,
      unidadeId: null,
      descricao,
      valor,
      vencimento: vencimento.toISOString(),
      fornecedor,
    },
  })
  return {
    texto: `Proposta criada e esperando confirmação de uma pessoa da loja na tela do assistente: ${resumo} Nada foi lançado ainda.`,
    propostaId: proposta.id,
  }
}

/** A categoria pelo nome que a pessoa disse; se não bater, "Outras despesas". */
async function acharCategoria(orgId: string, nome: string) {
  const todas = await comoOrg(orgId, (db) =>
    db.categoriaFinanceira.findMany({
      where: { tipo: 'DESPESA' },
      orderBy: { ordem: 'asc' },
      select: { id: true, nome: true },
    }),
  )
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
  const pedido = norm(nome)
  return (
    (pedido && todas.find((c) => norm(c.nome) === pedido)) ||
    (pedido && todas.find((c) => norm(c.nome).includes(pedido))) ||
    todas.find((c) => norm(c.nome) === 'outras despesas') ||
    todas[0] ||
    null
  )
}

async function proporAjuste(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const codigo = str(e.codigo, 40)
  const quantidade = numero(e.quantidade)
  const motivo = str(e.motivo, 200)
  const loja = str(e.loja, 60)
  if (!codigo) return falha('Falta o código da etiqueta.')
  if (!(quantidade > 0)) return falha('A quantidade precisa ser positiva — perda e quebra se registram na tela de estoque.')
  if (!motivo) return falha('Todo ajuste precisa de motivo escrito.')

  // Só nas lojas em que ESTA pessoa pode ajustar: senão confirmar a proposta
  // seria o caminho para mexer na loja dos outros.
  const permitidas = await unidadesVisiveis(sessao, 'estoque.ajustar')
  const achado = await comoOrg(orgId, async (db) => {
    const variacao = await db.variacao.findFirst({
      where: { codigo, ativa: true },
      select: { id: true, codigo: true, produto: { select: { nome: true } } },
    })
    const unidades = await db.unidade.findMany({
      where: { id: { in: permitidas }, ativa: true },
      select: { id: true, nome: true },
    })
    return { variacao, unidades }
  })
  if (!achado.variacao) return falha(`Não achei a etiqueta "${codigo}".`)

  const unidade = loja
    ? achado.unidades.find((u) => u.nome.toLowerCase().includes(loja.toLowerCase()))
    : achado.unidades.length === 1
      ? achado.unidades[0]
      : undefined
  if (!unidade) {
    return falha(`Em qual loja? ${achado.unidades.map((u) => u.nome).join(', ') || 'Nenhuma loja permitida.'}`)
  }

  const resumo =
    `Somar ${quantidade} ao estoque de "${achado.variacao.produto.nome}" (cód. ${achado.variacao.codigo}) ` +
    `na ${unidade.nome}. Motivo: ${motivo}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'ajustar.estoque',
    resumo,
    dados: { variacaoId: achado.variacao.id, unidadeId: unidade.id, quantidade, motivo },
  })
  return {
    texto: `Proposta criada e esperando confirmação na tela do assistente: ${resumo} O estoque ainda não mudou.`,
    propostaId: proposta.id,
  }
}

/**
 * O Guia, para quem pergunta pelo WhatsApp. As três telas que melhor
 * respondem, com os passos — filtradas pelo que ESTA pessoa abre, igual à
 * busca do Guia na tela. Não lê dado da loja: é o manual.
 */
export function explicarSistema(empresa: ComModulos, sessao: Sessao, pergunta: string): ResultadoFerramenta {
  if (!pergunta) return falha('Diga qual é a dúvida.')
  const quem = { capacidades: CAPACIDADES.filter((c) => pode(sessao, c)), modulos: empresa.modulos }
  const achados = buscarNoGuia(pergunta, undefined, quem).slice(0, 3)
  if (achados.length === 0) {
    return json({ achou: false, recado: 'O Guia não tem isso. Diga que não sabe e sugira perguntar ao suporte do Norte.' })
  }
  // Encolhe até caber, em vez de cortar o JSON no meio (JSON cortado é
  // lixo para o modelo): menos passos por tela, depois menos telas.
  for (const [telas, comoFazer] of [[3, 2], [2, 2], [2, 1], [1, 1]] as const) {
    const texto = JSON.stringify({
      achou: true,
      telas: achados.slice(0, telas).map((a) => ({
        tela: a.entrada.titulo,
        oQueE: a.entrada.oQueE.slice(0, 300),
        comoFazer: a.passos.slice(0, comoFazer).map((c) => ({ titulo: c.titulo, passos: c.passos })),
      })),
    })
    if (texto.length <= MAXIMO_RESULTADO) return { texto }
  }
  const a = achados[0]!
  return json({ achou: true, telas: [{ tela: a.entrada.titulo, oQueE: a.entrada.oQueE.slice(0, 300) }] })
}
