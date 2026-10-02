// O agente da empresa — a parte que fala com o banco.
//
// As TRAVAS (o catálogo de poderes, o filtro de ferramentas, a conferência
// dos tetos) moram em `poderes.ts`, que é puro. A separação não é organização:
// é o que permite testar a trava sem subir banco, e testar exaustivamente é
// o único jeito de confiar numa trava.

import { marcarHorario, mudarSituacaoAgenda, type DadosHorario } from './agenda'
import { comoOrg } from './banco'
import { exigir, pode, unidadesQuePodem, type Sessao } from './permissao'
import { type ComModulos } from './modulos'
import { centavos, reais } from './dinheiro'
import { lancar } from './financeiro'
import { mexerEstoque } from './estoque'
import { registrarEntrada, type ItemEntrada } from './entrada'
import { criarProduto } from './produto'
import { codigoEncomenda, marcarVista, mudarSituacao } from './encomenda'
import { quantidade as comMedida } from './texto'
import { Prisma, type Medida, type TipoRecibo } from '@prisma/client'
import { custoEmCentavos, cobrancaEmCentavos } from './custo-ia'
import {
  PODERES,
  conferirPoder,
  PoderNegado,
  type AgenteConfig,
  type ChavePoder,
  type Poder,
} from './poderes'
import { garantirCreditoDoMes, recadoSemRespostas, respostasDoMes, vencerTesteSeAcabou, type Respostas } from './assinatura'
import { PLANOS, PRECOS, milhar, planoLibera } from './planos'
import { inicioDeHojeEmSP } from './dia'
import { MAXIMO_RECADO } from './assistente/recado'

export * from './poderes'
export * from './custo-ia'

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÃO
// ─────────────────────────────────────────────────────────────

export type ConfigAgente = {
  nome: string
  personalidade?: string | null
  /** O texto do recado fixo ao cliente (ver assistente/recado.ts). */
  saudacao?: string | null
  manual?: string | null
  poderes: string[]
  descontoMaxPct: number
  valorMaxCent: number
  gastoDiaCent: number
  mensagensDia: number
  ativo: boolean
}

export async function acharAgente(orgId: string) {
  return comoOrg(orgId, (db) => db.agente.findUnique({ where: { orgId } }))
}

/**
 * Cria ou atualiza o agente da empresa.
 *
 * Filtra os poderes contra a lista fechada antes de gravar: o que chega do
 * formulário vem do navegador, e o navegador é do usuário.
 */
export async function salvarAgente(sessao: Sessao, cfg: ConfigAgente) {
  exigir(sessao, 'agente.configurar')
  // A capacidade diz QUEM configura; o plano diz SE a empresa tem assistente.
  // Só a capacidade deixava a empresa do Grátis montar o assistente (e dali
  // abrir sessão de WhatsApp) — o que o plano dela não cobre.
  await exigirPlanoComAssistente(sessao.orgId)

  const poderes = cfg.poderes.filter(
    (p): p is ChavePoder => (PODERES as Record<string, Poder>)[p]?.disponivel === true,
  )

  const dados = {
    nome: cfg.nome.trim(),
    personalidade: cfg.personalidade?.trim() || null,
    saudacao: cfg.saudacao?.trim().slice(0, MAXIMO_RECADO) || null,
    manual: cfg.manual?.trim() || null,
    poderes,
    descontoMaxPct: cfg.descontoMaxPct,
    valorMaxCent: cfg.valorMaxCent,
    gastoDiaCent: cfg.gastoDiaCent,
    mensagensDia: cfg.mensagensDia,
    ativo: cfg.ativo,
  }

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.agente.findUnique({ where: { orgId: sessao.orgId } })

    const agente = await db.agente.upsert({
      where: { orgId: sessao.orgId },
      create: { orgId: sessao.orgId, ...dados },
      update: dados,
    })

    // Mexer no que o agente pode é evento de segurança, não preferência de
    // tela: o livro guarda o antes e o depois para responder "quem soltou a
    // rédea dele?" seis meses depois.
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: antes ? 'agente.alterou' : 'agente.criou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        // O recado vai junto: é texto que sai para cliente em nome da loja.
        antes: antes
          ? {
              poderes: antes.poderes,
              teto: Number(antes.descontoMaxPct),
              valorMax: antes.valorMaxCent,
              ativo: antes.ativo,
              recado: antes.saudacao,
            }
          : undefined,
        depois: { poderes, teto: cfg.descontoMaxPct, valorMax: cfg.valorMaxCent, ativo: cfg.ativo, recado: dados.saudacao },
      },
    })

    return agente
  })
}

// ─────────────────────────────────────────────────────────────
// PROPOR E CONFIRMAR
// ─────────────────────────────────────────────────────────────

/** Proposta vale por 24h. Depois disso o estoque e o preço já são outros. */
const HORAS_DE_VALIDADE = 24

export type NovaProposta = {
  poder: ChavePoder
  /** Escrito para uma pessoa ler no WhatsApp, com o número dentro. */
  resumo: string
  dados: Record<string, unknown>
  valor?: number
  descontoPct?: number
  /**
   * Quem pediu, quando pediu pela conversa. É a única pessoa que pode
   * responder "sim" ali mesmo, no WhatsApp (ver assistente/respostas.ts) — e
   * ainda assim com a capacidade dela conferida na hora. Sem quem pediu (a
   * rotina das 9h), a proposta só se confirma na tela.
   */
  usuarioId?: string | null
}

/**
 * O agente pede. Ninguém executa nada aqui.
 *
 * O teto é conferido ANTES de gravar: proposta acima do teto nem chega a
 * existir, então o dono nunca vê no WhatsApp uma oferta que ele não poderia
 * aceitar. Ver algo e não poder confirmar ensina a pessoa a duvidar da tela.
 */
export async function propor(orgId: string, empresa: ComModulos, p: NovaProposta) {
  const agente = await acharAgente(orgId)
  if (!agente) throw new PoderNegado(p.poder, 'esta empresa não tem agente')
  if (!agente.ativo) throw new PoderNegado(p.poder, 'o agente está desligado')

  const cfg = paraConfig(agente)
  const valorCent = p.valor != null ? centavos(p.valor) : undefined
  conferirPoder(cfg, empresa, p.poder, valorCent, p.descontoPct)

  return comoOrg(orgId, (db) =>
    db.propostaAgente.create({
      data: {
        orgId,
        agenteId: agente.id,
        poder: p.poder,
        resumo: p.resumo,
        dados: p.dados as object,
        valor: p.valor ?? null,
        usuarioId: p.usuarioId ?? null,
        expiraEm: new Date(Date.now() + HORAS_DE_VALIDADE * 3600_000),
      },
    }),
  )
}

export type Resposta =
  | {
      ok: true
      recibo?: { tipo: TipoRecibo; valor: number }
      /** O que foi feito, numa frase para a pessoa ("entrada de 10 kg de Picanha lançada..."). */
      feito?: string
    }
  | {
      ok: false
      motivo: 'nao_existe' | 'ja_respondida' | 'expirada' | 'sem_permissao' | 'falhou'
      detalhe?: string
      /**
       * A recusa em palavras de gente, quando ela é de gente ("Esta
       * encomenda já está entregue."). Erro de máquina não vem aqui: fica no
       * `detalhe`, que vai para o banco e o log — nunca para o WhatsApp.
       */
      recado?: string
    }

/**
 * A pessoa responde. É o único caminho por onde a ação do agente acontece.
 *
 * Três conferências que parecem redundantes e não são:
 *
 * 1. A PESSOA precisa ter a capacidade do poder. O agente nunca pode mais do
 *    que quem confirma — senão confirmar viraria o jeito de o balconista
 *    fazer, pelo agente, o que ele não pode fazer pela tela.
 * 2. O TETO é conferido DE NOVO. O dono pode ter baixado o teto entre a
 *    proposta e o sim, e o que vale é o teto de agora.
 * 3. A VALIDADE. Proposta de ontem fala de um estoque que não existe mais.
 */
export async function responderProposta(
  sessao: Sessao,
  empresa: ComModulos,
  propostaId: string,
  aceita: boolean,
): Promise<Resposta> {
  const proposta = await comoOrg(sessao.orgId, (db) =>
    db.propostaAgente.findUnique({ where: { id: propostaId } }),
  )
  if (!proposta) return { ok: false, motivo: 'nao_existe' }
  if (proposta.situacao !== 'AGUARDANDO' || proposta.respondidaEm) return { ok: false, motivo: 'ja_respondida' }

  const p = PODERES[proposta.poder as ChavePoder] as Poder | undefined
  if (!p) return { ok: false, motivo: 'falhou', detalhe: 'poder desconhecido' }

  // 1. quem confirma precisa poder fazer sozinho
  if (!pode(sessao, p.exige)) return { ok: false, motivo: 'sem_permissao' }

  if (proposta.expiraEm < new Date()) {
    await marcar(sessao.orgId, propostaId, 'EXPIRADA', sessao.nome)
    return { ok: false, motivo: 'expirada' }
  }

  // ── a proposta é TOMADA antes de qualquer coisa ──
  // Carimbar `respondidaEm` só se ninguém carimbou antes. O clique duplo em
  // "Confirmar" (ou duas abas, ou o sim no WhatsApp e na tela ao mesmo
  // tempo) liam os dois AGUARDANDO e EXECUTAVAM os dois: a despesa lançada
  // duas vezes, o estoque ajustado em dobro. Agora o segundo não toma, e
  // desiste com "já respondida".
  const tomou = await comoOrg(sessao.orgId, (db) =>
    db.propostaAgente.updateMany({
      where: { id: propostaId, situacao: 'AGUARDANDO', respondidaEm: null },
      data: { respondidaEm: new Date(), quemRespondeu: sessao.nome },
    }),
  )
  if (tomou.count === 0) return { ok: false, motivo: 'ja_respondida' }

  if (!aceita) {
    await marcar(sessao.orgId, propostaId, 'RECUSADA', sessao.nome)
    return { ok: true }
  }

  // 2. o teto de AGORA
  const agente = await acharAgente(sessao.orgId)
  if (!agente) return { ok: false, motivo: 'falhou', detalhe: 'agente sumiu' }
  try {
    conferirPoder(
      paraConfig(agente),
      empresa,
      proposta.poder,
      proposta.valor != null ? centavos(proposta.valor) : undefined,
    )
  } catch (e) {
    await marcar(sessao.orgId, propostaId, 'FALHOU', sessao.nome, msg(e))
    return { ok: false, motivo: 'falhou', detalhe: msg(e), ...recadoDe(e) }
  }

  // 3. executa
  try {
    const { recibo, feito } = await executar(sessao, proposta.poder as ChavePoder, proposta.dados as Record<string, unknown>)
    await marcar(sessao.orgId, propostaId, 'CONFIRMADA', sessao.nome)

    // Duas linhas no livro, e as duas são verdade: o serviço já gravou a
    // ação em nome de quem confirmou (foi ela que decidiu), e esta aqui
    // guarda que a ideia foi do agente. Sem a segunda, seis meses depois
    // ninguém consegue responder "o assistente serviu para alguma coisa?".
    await comoOrg(sessao.orgId, (db) =>
      db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          autor: 'AGENTE',
          acao: 'agente.proposta.confirmou',
          alvoTipo: 'proposta',
          alvoId: propostaId,
          alvoNome: proposta.resumo.slice(0, 120),
          valor: proposta.valor,
          motivo: proposta.poder,
        },
      }),
    )

    if (recibo) {
      await emitirRecibo(sessao.orgId, agente.id, recibo.tipo, recibo.valor, proposta.resumo)
    }
    return { ok: true, recibo, ...(feito ? { feito } : {}) }
  } catch (e) {
    await marcar(sessao.orgId, propostaId, 'FALHOU', sessao.nome, msg(e))
    return { ok: false, motivo: 'falhou', detalhe: msg(e), ...recadoDe(e) }
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'erro desconhecido')

/**
 * A frase do erro, só quando ela foi escrita para gente: as recusas dos
 * serviços ("Esta encomenda já está entregue.", "Loja não encontrada") são
 * `Error` comum, com a frase pronta. Erro do Prisma, do driver ou de tipo é
 * de máquina e pode carregar dado — esse não sai daqui (mesma régua de
 * `recadoDoErro` em pagina.ts).
 */
function recadoDe(e: unknown): { recado?: string } {
  if (!(e instanceof Error)) return {}
  // A recusa de permissão traz o nome técnico da capacidade: vira frase.
  if (e.name === 'SemPermissao') return { recado: 'Isso não é do seu acesso (nessa loja, pelo menos).' }
  const deMaquina =
    e.name.startsWith('Prisma') ||
    ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DatabaseError'].includes(e.name) ||
    'code' in e
  return deMaquina || !e.message ? {} : { recado: e.message.slice(0, 300) }
}

async function marcar(
  orgId: string,
  id: string,
  situacao: 'CONFIRMADA' | 'RECUSADA' | 'EXPIRADA' | 'FALHOU',
  quem: string,
  erro?: string,
) {
  await comoOrg(orgId, (db) =>
    db.propostaAgente.update({
      where: { id },
      data: { situacao, respondidaEm: new Date(), quemRespondeu: quem, erro: erro ?? null },
    }),
  )
}

/**
 * O que cada poder faz de verdade.
 *
 * Repare que ele chama os MESMOS serviços que a tela chama. O agente não tem
 * um caminho paralelo para escrever no banco — se tivesse, a regra de negócio
 * existiria em dois lugares e um dos dois ficaria para trás.
 *
 * Devolve o recibo (quando há) e, quando dá para dizer melhor que o resumo da
 * proposta, a frase do que foi feito — é ela que volta no WhatsApp depois do
 * "sim" ("entrada de 10 kg de Picanha lançada. Saldo agora: 14 kg.").
 */
type Executado = { recibo?: { tipo: TipoRecibo; valor: number }; feito?: string }

async function executar(
  sessao: Sessao,
  poder: ChavePoder,
  dados: Record<string, unknown>,
): Promise<Executado> {
  switch (poder) {
    case 'lancar.despesa':
    case 'pedir.compra': {
      await lancar(sessao, {
        categoriaId: String(dados.categoriaId ?? ''),
        unidadeId: (dados.unidadeId as string) ?? null,
        tipo: 'DESPESA',
        descricao: String(dados.descricao ?? 'Lançado pelo assistente'),
        valor: Number(dados.valor ?? 0),
        vencimento: new Date(String(dados.vencimento)),
        fornecedor: String(dados.fornecedor ?? ''),
      })
      // Compra feita antes de acabar PODE ser ruptura evitada — mas o valor do
      // recibo não é o da compra: gastar não é ganhar. Aqui ainda não há o que
      // medir; quem emite é `apurarRecibos`, trinta dias depois, com o que a
      // reposição de fato vendeu além do saldo que havia no aviso.
      return {}
    }

    case 'ajustar.estoque': {
      const quantidade = Number(dados.quantidade ?? 0)
      // O MESMO serviço da tela: `mexerEstoque` confere a capacidade NA LOJA
      // da proposta, confere que produto e loja são desta empresa e escreve
      // no livro. Antes ia direto em `mexerEstoqueEm`, que não confere nada —
      // o gerente da loja 3 confirmava ajuste na loja 5, e sem linha no livro.
      const r = await mexerEstoque(sessao, {
        variacaoId: String(dados.variacaoId ?? ''),
        unidadeId: String(dados.unidadeId ?? ''),
        tipo: 'AJUSTE',
        quantidade,
        motivo: String(dados.motivo ?? 'Ajuste proposto pelo assistente'),
      })
      if (!r.ok) throw new Error('O estoque não permite esse ajuste agora.')
      return {}
    }

    case 'estoque.entrada':
      return { feito: await executarEntrada(sessao, dados) }

    case 'encomenda.mudar':
      return { feito: await executarEncomenda(sessao, dados) }

    case 'agenda.marcar': {
      // O MESMO serviço da tela: confere a permissão na loja, a profissional,
      // e trava a agenda dela antes de olhar se o horário está livre. Quem
      // confirma a proposta é quem decide — inclusive o horário fora do
      // funcionamento, que a proposta já avisou.
      const r = await marcarHorario(sessao, { ...(dados as unknown as DadosHorario), confirmar: true })
      if (!r.ok) throw new Error(r.erro)
      return {}
    }

    case 'agenda.desmarcar': {
      const r = await mudarSituacaoAgenda(sessao, String(dados.id ?? ''), {
        para: 'CANCELADO',
        motivo: String(dados.motivo ?? 'Desmarcado pelo assistente'),
      })
      if (!r.ok) throw new Error(r.erro)
      return {}
    }

    default:
      throw new Error(`"${poder}" ainda não sabe executar.`)
  }
}

// ── a entrada de compra ──────────────────────────────────────

/** Um item da proposta de entrada, como `assistente/ferramentas-loja.ts` grava. */
type ItemDaProposta = {
  /** A variação do cadastro. Ausente = produto novo, cadastrado no sim. */
  variacaoId?: string
  nome: string
  medida: Medida
  quantidade: number
  custoUnit?: number | null
  /** Só no produto novo: o preço de venda de partida. */
  precoVista?: number | null
}

const MEDIDAS: readonly Medida[] = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'CX']

function itensDaProposta(dados: Record<string, unknown>): ItemDaProposta[] {
  const brutos = Array.isArray(dados.itens) ? dados.itens : []
  return brutos.flatMap((b): ItemDaProposta[] => {
    if (!b || typeof b !== 'object') return []
    const i = b as Record<string, unknown>
    const custo = i.custoUnit == null ? null : Number(i.custoUnit)
    const preco = i.precoVista == null ? null : Number(i.precoVista)
    return [
      {
        variacaoId: typeof i.variacaoId === 'string' && i.variacaoId ? i.variacaoId : undefined,
        nome: String(i.nome ?? '').trim().slice(0, 120),
        medida: MEDIDAS.includes(i.medida as Medida) ? (i.medida as Medida) : 'UN',
        quantidade: Number(i.quantidade),
        custoUnit: custo != null && Number.isFinite(custo) ? custo : null,
        precoVista: preco != null && Number.isFinite(preco) ? preco : null,
      },
    ]
  })
}

/**
 * A entrada de compra pelos MESMOS serviços da tela: o produto novo nasce por
 * `criarProduto` (com a permissão de cadastrar conferida lá dentro — e aqui
 * antes, para a recusa ter frase clara), e a mercadoria entra por
 * `registrarEntrada`, que confere `estoque.ajustar` NA LOJA, se a loja vende o
 * produto, e quem pode mexer no custo.
 *
 * Produto novo e entrada não são uma transação só (são dois serviços, cada um
 * com a sua): se a entrada for recusada depois do cadastro, o produto fica —
 * é um cadastro válido, e a frase diz.
 */
async function executarEntrada(sessao: Sessao, dados: Record<string, unknown>): Promise<string> {
  const unidadeId = String(dados.unidadeId ?? '')
  const fornecedor = String(dados.fornecedor ?? '').trim().slice(0, 80)
  const documento = String(dados.documento ?? '').trim().slice(0, 60)
  const itens = itensDaProposta(dados)
  if (!unidadeId || itens.length === 0) throw new Error('A proposta de entrada veio sem loja ou sem itens.')
  // Antes de cadastrar qualquer coisa: quem não pode dar entrada nesta loja
  // não deixa produto novo para trás.
  exigir(sessao, 'estoque.ajustar', unidadeId)

  const criados: string[] = []
  const prontos: (ItemDaProposta & { variacaoId: string })[] = []
  for (const i of itens) {
    if (i.variacaoId) {
      prontos.push({ ...i, variacaoId: i.variacaoId })
      continue
    }
    if (!pode(sessao, 'produto.cadastrar')) {
      throw new Error(
        `"${i.nome}" não está cadastrado, e cadastrar produto não é do seu acesso. Peça a quem cadastra, ou cadastre pela tela de Produtos.`,
      )
    }
    const alcance = unidadesQuePodem(sessao, 'produto.cadastrar')
    const r = await criarProduto(sessao, {
      nome: i.nome,
      medida: i.medida,
      precoVista: Number(i.precoVista ?? 0),
      custo: i.custoUnit ?? null,
      // Quem cadastra para todas as lojas cadastra para todas; o gerente,
      // para a loja dele — a mesma régua da tela (`alcancaOProduto`).
      vendidoEm: alcance === 'todas' ? [] : [unidadeId],
    })
    if (!r.ok) {
      throw new Error(
        r.precisaPin
          ? `Cadastrar "${i.nome}" pede o PIN de quem cadastra. Cadastre pela tela de Produtos e me peça a entrada de novo.`
          : r.motivo,
      )
    }
    const v = await comoOrg(sessao.orgId, (db) =>
      db.variacao.findFirst({ where: { produtoId: r.produtoId }, orderBy: { codigo: 'asc' }, select: { id: true } }),
    )
    if (!v) throw new Error(`"${i.nome}" foi cadastrado, mas sem variação para dar entrada.`)
    criados.push(i.nome)
    prontos.push({ ...i, variacaoId: v.id })
  }

  const paraEntrada: ItemEntrada[] = prontos.map((i) => ({
    variacaoId: i.variacaoId,
    quantidade: i.quantidade,
    custoUnit: i.custoUnit ?? null,
  }))
  const r = await registrarEntrada(sessao, {
    unidadeId,
    fornecedor: fornecedor || undefined,
    documento: documento || undefined,
    itens: paraEntrada,
  })
  if (!r.ok) {
    throw new Error(criados.length > 0 ? `${r.motivo} (O cadastro de ${criados.join(', ')} ficou feito.)` : r.motivo)
  }

  // O saldo de agora, na loja da entrada: é a conferência que a pessoa faz de
  // cabeça ("tinha 4, chegaram 10, ficou 14").
  const { loja, saldos } = await comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findUnique({ where: { id: unidadeId }, select: { nome: true } })
    const saldos = await db.estoque.findMany({
      where: { unidadeId, variacaoId: { in: prontos.map((i) => i.variacaoId) } },
      select: { variacaoId: true, quantidade: true },
    })
    return { loja, saldos }
  })
  const saldoDe = new Map(saldos.map((s) => [s.variacaoId, Number(s.quantidade)]))
  const onde = loja ? ` na ${loja.nome}` : ''
  const partes: string[] = []
  if (prontos.length === 1) {
    const i = prontos[0]!
    const saldo = saldoDe.get(i.variacaoId)
    partes.push(
      `entrada de ${comMedida(i.quantidade, i.medida)} de ${i.nome} lançada${onde}.` +
        (saldo != null ? ` Saldo agora: ${comMedida(saldo, i.medida)}.` : ''),
    )
  } else {
    const linhas = prontos.map((i) => {
      const saldo = saldoDe.get(i.variacaoId)
      return `${comMedida(i.quantidade, i.medida)} de ${i.nome}${saldo != null ? ` (saldo ${comMedida(saldo, i.medida)})` : ''}`
    })
    partes.push(`entrada lançada${onde}: ${linhas.join('; ')}.`)
  }
  if (criados.length > 0) {
    partes.push(`Cadastrei ${criados.length === 1 ? 'o produto novo' : 'os produtos novos'}: ${criados.join(', ')}.`)
  }
  if (r.naoFeito.length > 0) partes.push(`Ficou de fora: ${r.naoFeito.join('; ')}.`)
  return partes.join(' ')
}

// ── a encomenda ──────────────────────────────────────────────

/**
 * Aceitar, aprontar ou cancelar, pelos MESMOS serviços da tela de
 * Encomendas: `marcarVista` e `mudarSituacao` conferem a loja da pessoa, a
 * transição e (no cancelar) `venda.cancelar`. Depois do sim que deu certo, a
 * cliente do catálogo recebe o aviso — e o aviso nunca derruba o que já foi
 * feito (ver `avisarClienteDaEncomenda`, que não lança).
 */
async function executarEncomenda(sessao: Sessao, dados: Record<string, unknown>): Promise<string> {
  const id = String(dados.encomendaId ?? '')
  const acao = String(dados.acao ?? '')
  const codigo = codigoEncomenda(id)
  // Import tardio: o aviso mora com o assistente (canal, conversa), e o
  // assistente importa este arquivo — no topo, os dois se puxariam na carga.
  const avisar = async (evento: 'ACEITA' | 'PRONTA' | 'CANCELADA') => {
    const { avisarClienteDaEncomenda } = await import('./assistente/avisos-encomenda')
    await avisarClienteDaEncomenda(sessao.orgId, id, evento)
  }

  if (acao === 'aceitar') {
    const r = await marcarVista(sessao, id)
    if (!r.ok) throw new Error(r.erro)
    if (r.jaEstava) return `o pedido ${codigo} já estava aceito.`
    await avisar('ACEITA')
    return `pedido ${codigo} aceito.`
  }
  if (acao === 'pronta') {
    const r = await mudarSituacao(sessao, id, { para: 'PRONTA' })
    if (!r.ok) throw new Error(r.erro)
    // Pronta é vista, por definição: o pedido do catálogo que ninguém tinha
    // aberto deixa de aparecer como novo.
    if (dados.origem === 'CATALOGO') await marcarVista(sessao, id).catch(() => undefined)
    await avisar('PRONTA')
    return `encomenda ${codigo} marcada como pronta.`
  }
  if (acao === 'cancelar') {
    const r = await mudarSituacao(sessao, id, {
      para: 'CANCELADA',
      motivo: String(dados.motivo ?? ''),
      // Devolver sinal mexe em dinheiro e na gaveta: isso é na tela, com a
      // pessoa escolhendo como devolveu. Pelo WhatsApp, o sinal fica.
      devolveuSinal: false,
    })
    if (!r.ok) throw new Error(r.erro)
    await avisar('CANCELADA')
    return `encomenda ${codigo} cancelada.`
  }
  throw new Error('Essa mudança de encomenda não existe.')
}

// ─────────────────────────────────────────────────────────────
// RECIBO — o número que segura a renovação
// ─────────────────────────────────────────────────────────────

export async function emitirRecibo(
  orgId: string,
  agenteId: string,
  tipo: TipoRecibo,
  valor: number,
  descricao: string,
  alvo?: { tipo: string; id: string },
) {
  return comoOrg(orgId, (db) =>
    db.reciboAgente.create({
      data: {
        orgId,
        agenteId,
        tipo,
        valor,
        descricao,
        alvoTipo: alvo?.tipo ?? null,
        alvoId: alvo?.id ?? null,
      },
    }),
  )
}

// ─────────────────────────────────────────────────────────────
// APURAR — o recibo que se mede, e só ele
// ─────────────────────────────────────────────────────────────
//
// ── por que isto existe ──────────────────────────────────────
// A tela "Trouxe de volta" lia `recibos_agente`, e o único jeito de uma linha
// nascer ali era `executar` devolver um recibo — o que nenhum poder fazia.
// Em empresa de verdade o número era sempre R$ 0; só a empresa de exemplo
// mostrava valor, e era valor escrito à mão.
//
// ── a regra: recibo é conta, não palpite ─────────────────────
// Só vira recibo o que tem conta que qualquer pessoa refaz com o extrato na
// mão. Hoje isso existe para UM caso: a reposição proposta pela rotina de
// "vai faltar" e confirmada por alguém da loja.
//
//   saldo no aviso  = o que havia na prateleira quando o assistente avisou
//   vendido         = o que saiu da variação nos 30 dias depois do sim,
//                     tirando o que voltou em devolução
//   além do saldo   = vendido − saldo no aviso: sem reposição, não existiria
//   unidades        = o menor entre "além do saldo", o que foi pedido e o
//                     que de fato ENTROU no estoque nesses 30 dias
//   valor           = unidades × margem média por unidade dessas vendas
//                     (preço cobrado − custo gravado na venda)
//
// Margem, e não faturamento: a loja teria gastado o custo de qualquer jeito
// para ter a peça. Sem entrada registrada, sem venda além do saldo, ou sem
// custo nas vendas, não há recibo — e zero honesto vale mais que um número
// bonito que a dona não consegue conferir.
//
// Os outros tipos do enum (cobrança recuperada, cliente que voltou, peça
// encalhada, diferença de caixa) ficam sem emissor até existir um poder que
// faça a coisa E uma conta que separe o que o assistente fez do que teria
// acontecido sem ele.

/** Quantos dias depois do sim a reposição é medida. */
export const JANELA_RECIBO_DIAS = 30

/** Proposta confirmada há mais que isto não é mais apurada (a janela fechou há muito). */
const APURA_ATE_DIAS = 90

export type ContaDaReposicao = {
  /** Saldo somado das lojas no momento do aviso. */
  saldoNaProposta: number
  /** Quanto a proposta pedia. */
  pedido: number
  /** Quanto entrou de fato (movimento ENTRADA) na janela. */
  entrou: number
  /** Vendido na janela, líquido de devolução. */
  vendido: number
  /** Das vendas com custo gravado: quantidade e margem em reais. */
  comCusto: { quantidade: number; margem: number }
}

/** A conta do recibo de reposição. Pura: é aqui que "honesto" é provado. */
export function valorDaReposicao(c: ContaDaReposicao): { unidades: number; valor: number } {
  const alem = Math.max(0, c.vendido - Math.max(0, c.saldoNaProposta))
  const unidades = Math.min(alem, Math.max(0, c.pedido), Math.max(0, c.entrou))
  if (unidades <= 0 || c.comCusto.quantidade <= 0) return { unidades: 0, valor: 0 }
  const porUnidade = c.comCusto.margem / c.comCusto.quantidade
  const valor = Math.round(unidades * porUnidade * 100) / 100
  return valor > 0 ? { unidades, valor } : { unidades: 0, valor: 0 }
}

type DadosReposicao = {
  variacaoId?: unknown
  quantidade?: unknown
  saldoNaProposta?: unknown
  unidadeIds?: unknown
  descricao?: unknown
}

const qtdTexto = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

/**
 * Emite os recibos que já dá para medir. Idempotente: roda na rotina das 9h
 * e quando a tela do assistente abre, e cada proposta vira no máximo UM
 * recibo — a trava por proposta segura as duas chamadas ao mesmo tempo.
 *
 * Devolve quantos recibos nasceram agora.
 */
export async function apurarRecibos(orgId: string, agora: Date = new Date()): Promise<number> {
  const fechouAte = new Date(agora.getTime() - JANELA_RECIBO_DIAS * 864e5)
  const desde = new Date(agora.getTime() - APURA_ATE_DIAS * 864e5)

  const candidatas = await comoOrg(orgId, async (db) => {
    const propostas = await db.propostaAgente.findMany({
      where: { poder: 'pedir.compra', situacao: 'CONFIRMADA', respondidaEm: { lte: fechouAte, gte: desde } },
      select: { id: true, agenteId: true, dados: true, respondidaEm: true },
    })
    if (propostas.length === 0) return []
    const feitos = await db.reciboAgente.findMany({
      where: { alvoTipo: 'proposta', alvoId: { in: propostas.map((p) => p.id) } },
      select: { alvoId: true },
    })
    const ja = new Set(feitos.map((f) => f.alvoId))
    return propostas.filter((p) => !ja.has(p.id))
  })

  let emitidos = 0
  for (const p of candidatas) {
    const d = (p.dados ?? {}) as DadosReposicao
    // Só a proposta da rotina de "vai faltar" carrega o saldo do aviso. A de
    // conversa ("registra uma compra de 500") não diz de que peça nem de que
    // saldo partiu — não há conta a fazer, então não há recibo.
    if (typeof d.variacaoId !== 'string' || typeof d.saldoNaProposta !== 'number' || !p.respondidaEm) continue
    const variacaoId = d.variacaoId
    const saldoNaProposta = d.saldoNaProposta
    const pedido = Number(d.quantidade ?? 0)
    const unidades = Array.isArray(d.unidadeIds) ? d.unidadeIds.filter((u): u is string => typeof u === 'string') : null
    const de = p.respondidaEm
    const ate = new Date(de.getTime() + JANELA_RECIBO_DIAS * 864e5)

    const nasceu = await comoOrg(orgId, async (db) => {
      await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`recibo:proposta:${p.id}`}))`
      const existe = await db.reciboAgente.findFirst({ where: { alvoTipo: 'proposta', alvoId: p.id }, select: { id: true } })
      if (existe) return false

      const filtroLoja = unidades ? Prisma.sql`and v.unidade_id = any(${unidades})` : Prisma.empty
      const [venda] = await db.$queryRaw<{ vendido: string | null; q_custo: string | null; margem: string | null }[]>`
        select sum(l.q) as vendido,
               sum(l.q) filter (where l.custo is not null) as q_custo,
               sum(l.t - l.q * l.custo) filter (where l.custo is not null) as margem
          from (select i.quantidade - coalesce(dv.q, 0) as q,
                       i.total - coalesce(dv.v, 0) as t,
                       i.custo_unit as custo
                  from venda_itens i
                  join vendas v on v.id = i.venda_id
                  left join (select venda_item_id, sum(quantidade) as q, sum(valor) as v
                               from devolucao_itens group by 1) dv on dv.venda_item_id = i.id
                 where i.variacao_id = ${variacaoId} and v.situacao = 'CONCLUIDA'
                   and v.criada_em >= ${de} and v.criada_em < ${ate}
                   ${filtroLoja}) l
      `
      const filtroMov = unidades ? Prisma.sql`and m.unidade_id = any(${unidades})` : Prisma.empty
      // A transferência entre lojas também grava ENTRADA no destino (ver
      // `transferir` em estoque.ts). Ela não é compra: a peça só mudou de
      // prateleira. Contada como "entrou", inflava a reposição e o recibo
      // cobrava margem de venda que o assistente não evitou. Quem marca é o
      // `transferencia_id` das duas pernas — não o texto do motivo, que uma
      // entrada comum digitada "Transferência de fornecedor" imitaria.
      const [entrada] = await db.$queryRaw<{ entrou: string | null }[]>`
        select sum(m.quantidade) as entrou
          from movimentos_estoque m
         where m.variacao_id = ${variacaoId} and m.tipo = 'ENTRADA'
           and m.transferencia_id is null
           and m.criado_em >= ${de} and m.criado_em < ${ate}
           ${filtroMov}
      `
      const conta = valorDaReposicao({
        saldoNaProposta,
        pedido,
        entrou: Number(entrada?.entrou ?? 0),
        vendido: Number(venda?.vendido ?? 0),
        comCusto: { quantidade: Number(venda?.q_custo ?? 0), margem: Number(venda?.margem ?? 0) },
      })
      if (conta.valor <= 0) return false

      const oque = typeof d.descricao === 'string' ? d.descricao.replace(/^Reposição:\s*/, '') : 'item'
      await db.reciboAgente.create({
        data: {
          orgId,
          agenteId: p.agenteId,
          tipo: 'RUPTURA_EVITADA',
          valor: conta.valor,
          descricao:
            `Reposição de ${oque}: ${qtdTexto(conta.unidades)} vendido${conta.unidades === 1 ? '' : 's'} ` +
            `em ${JANELA_RECIBO_DIAS} dias além do saldo de ${qtdTexto(saldoNaProposta)} no aviso — a margem dessas vendas.`,
          alvoTipo: 'proposta',
          alvoId: p.id,
        },
      })
      return true
    })
    if (nasceu) emitidos++
  }
  return emitidos
}

export type Balanco = {
  trouxe: number
  custou: number
  porTipo: { tipo: TipoRecibo; valor: number; quantos: number }[]
  mensalidade: number
}

/**
 * O que ele trouxe contra o que ele custou, no período.
 *
 * O custo aqui é o de IA, não a mensalidade — a mensalidade paga o sistema
 * inteiro. Misturar os dois faria o agente parecer caro num mês fraco e
 * barato num mês forte, sem que nada dele tivesse mudado.
 */
export async function balanco(orgId: string, de: Date, ate: Date): Promise<Balanco> {
  return comoOrg(orgId, async (db) => {
    const recibos = await db.reciboAgente.groupBy({
      by: ['tipo'],
      where: { criadoEm: { gte: de, lte: ate } },
      _sum: { valor: true },
      _count: true,
    })

    const gasto = await db.consumoIA.aggregate({
      where: { criadoEm: { gte: de, lte: ate } },
      _sum: { cobradoCent: true },
    })

    const porTipo = recibos.map((r) => ({
      tipo: r.tipo,
      valor: Number(r._sum.valor ?? 0),
      quantos: r._count,
    }))

    return {
      trouxe: porTipo.reduce((s, r) => s + r.valor, 0),
      custou: reais(gasto._sum.cobradoCent ?? 0),
      porTipo: porTipo.sort((a, b) => b.valor - a.valor),
      mensalidade: 0,
    }
  })
}

// ─────────────────────────────────────────────────────────────
// CONSUMO DE IA — o custo variável de cada cliente
// ─────────────────────────────────────────────────────────────

export async function registrarConsumo(
  orgId: string,
  agenteId: string,
  modelo: string,
  entradaTokens: number,
  saidaTokens: number,
) {
  // Dois numeros, e eles sao diferentes de proposito: `custoCent` e o que o
  // fornecedor cobra da gente, `cobradoCent` e o que sai da carteira da loja.
  // Debitar o custo bruto — que era o que acontecia aqui — da margem ZERO, e
  // zero de margem e prejuizo: em cima dele ainda correm a taxa do meio de
  // pagamento, a chamada repetida que se paga duas vezes e cobra uma, e o
  // imposto sobre a receita.
  const custoCent = custoEmCentavos(modelo, entradaTokens, saidaTokens)
  const cobradoCent = cobrancaEmCentavos(modelo, entradaTokens, saidaTokens)

  await comoOrg(orgId, async (db) => {
    await db.consumoIA.create({
      data: { orgId, agenteId, modelo, entradaTokens, saidaTokens, custoCent, cobradoCent },
    })
    // E DESCONTA da carteira, na mesma transação. Registrar o gasto sem
    // descontar deixaria o saldo mentindo para sempre — e o saldo é o que
    // decide se o assistente responde.
    //
    // O saldo PODE ficar negativo, de propósito: a chamada já aconteceu e o
    // custo é real. Fingir que parou em zero seria a gente pagando a
    // diferença calada. A trava fica na porta de entrada, não aqui.
    await db.org.update({
      where: { id: orgId },
      data: { creditoIaCent: { decrement: cobradoCent } },
    })
  })

  return { custoCent, cobradoCent }
}

/**
 * Já pode gastar mais hoje?
 *
 * O teto diário existe por dois motivos, e o segundo é o que importa: um
 * defeito que faça o agente responder a si mesmo em laço queima a conta do
 * mês numa madrugada, e ninguém está olhando às três da manhã.
 */
export type VeredictoIA = {
  pode: boolean
  /**
   * `sem_respostas`: a franquia do mês (ou do teste) acabou — é o que o
   * cliente lê. `sem_credito`: a trava de custo por baixo dela segurou antes
   * (ver "a trava de dinheiro" em planos.ts).
   */
  motivo: 'ok' | 'sem_agente' | 'teto_do_dia' | 'sem_credito' | 'sem_respostas'
  gastoCent: number
  tetoCent: number
  saldoCent: number
  /** As respostas do período, quando o plano tem assistente. */
  respostas: Respostas | null
  /** Frase pronta para a tela e para o log. */
  recado: string
}

export async function podeGastarHoje(orgId: string, agora: Date = new Date()): Promise<VeredictoIA> {
  const agente = await acharAgente(orgId)
  if (!agente) {
    return {
      pode: false, motivo: 'sem_agente', gastoCent: 0, tetoCent: 0, saldoCent: 0, respostas: null,
      recado: 'Esta empresa não tem assistente configurado.',
    }
  }

  // O plano antes do crédito: o teste que venceu desce para o Grátis aqui
  // (ver `planoTemAssistente`) — e antes de `garantirCreditoDoMes`, que
  // senão completaria a carteira do assistente numa empresa que não o tem.
  if (!(await planoTemAssistente(orgId))) {
    return {
      pode: false, motivo: 'sem_agente', gastoCent: 0, tetoCent: agente.gastoDiaCent, saldoCent: 0, respostas: null,
      recado: `O assistente está desligado no plano desta empresa. Ligue em Assinatura (+R$ ${PRECOS.assistente} por mês, ${milhar(PRECOS.respostasDoAssistente)} respostas).`,
    }
  }

  // O teto do mês cai antes de conferir o saldo: no dia 1º, a primeira
  // mensagem do mês não pode ser recusada por uma trava que o mês já repôs.
  await garantirCreditoDoMes(orgId, agora)
  const respostas = await respostasDoMes(orgId, agora)

  // "Hoje" é o dia de São Paulo. Com `setHours(0)`, num servidor em UTC o
  // teto virava à meia-noite de Greenwich — 21h da loja — e o gasto das 22h30
  // contava num "amanhã" que ainda não tinha começado.
  const inicio = inicioDeHojeEmSP(agora)

  // Em série, e não em Promise.all: dentro de uma transação as duas consultas
  // correm na MESMA conexão, então disparar juntas não ganha tempo nenhum — o
  // driver só enfileira, avisa que isso acaba no pg@9, e o aviso vira erro na
  // tela de quem está desenvolvendo.
  const { gastoCent, saldoCent } = await comoOrg(orgId, async (db) => {
    const hoje = await db.consumoIA.aggregate({
      where: { criadoEm: { gte: inicio } },
      _sum: { cobradoCent: true },
    })
    const org = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { creditoIaCent: true },
    })
    return { gastoCent: hoje._sum.cobradoCent ?? 0, saldoCent: org.creditoIaCent }
  })
  const base = { gastoCent, tetoCent: agente.gastoDiaCent, saldoCent, respostas }

  // Três travas, e elas respondem perguntas diferentes.
  //
  // As RESPOSTAS são o comercial: é o que o plano promete e o que o cliente
  // lê. Acabou a franquia, o assistente para até o dia 1º ou um pacote. Vêm
  // primeiro porque são o que o cliente entende e resolve sozinho.
  if (respostas.acabou) {
    return { pode: false, motivo: 'sem_respostas', ...base, recado: recadoSemRespostas(respostas.periodo) }
  }

  // O SALDO é a trava de custo por baixo da franquia: quem gasta muito mais
  // que a média por resposta (áudio longo, laço de ferramenta) para aqui
  // antes de as respostas acabarem. No Corporativo, sem franquia de tabela, é
  // a única trava comercial — a carteira do contrato.
  if (saldoCent <= 0) {
    return {
      pode: false, motivo: 'sem_credito', ...base,
      recado:
        respostas.total === null
          ? 'O crédito de IA do contrato acabou. Fale com a gente para repor.'
          : respostas.periodo === 'teste'
            ? 'O assistente chegou ao limite de uso do teste. Para continuar, assine em Assinatura.'
            : `O assistente chegou ao limite de uso deste mês. Compre um pacote de +${milhar(PRECOS.pacoteRespostas)} respostas em Assinatura ou espere o dia 1º.`,
    }
  }

  // O TETO DIÁRIO é segurança, e é o que importa de madrugada: um defeito que
  // faça o agente responder a si mesmo em laço queima o crédito do mês numa
  // noite, e ninguém está olhando às três da manhã.
  if (gastoCent >= agente.gastoDiaCent) {
    return {
      pode: false, motivo: 'teto_do_dia', ...base,
      recado: 'O assistente já usou o teto de hoje. Ele volta amanhã.',
    }
  }

  return { pode: true, motivo: 'ok', ...base, recado: 'ok' }
}

// ─────────────────────────────────────────────────────────────

type LinhaAgente = {
  poderes: string[]
  descontoMaxPct: unknown
  valorMaxCent: number
}

/** O agente do banco, reduzido ao que decide permissão. */
export const paraConfig = (a: LinhaAgente): AgenteConfig => ({
  poderes: a.poderes,
  descontoMaxPct: Number(a.descontoMaxPct),
  valorMaxCent: a.valorMaxCent,
})

/**
 * O plano da empresa tem o assistente AGORA?
 *
 * O teste vencido desce para o Grátis antes de o plano ser lido: a empresa
 * de teste que acabou em 10/09 continuava com `plano = PRO` no banco até
 * alguém abrir uma tela, e o assistente seguia respondendo — e gastando —
 * por conta de um plano que ela não tem mais.
 */
export async function planoTemAssistente(orgId: string): Promise<boolean> {
  await vencerTesteSeAcabou(orgId)
  const org = await comoOrg(orgId, (db) => db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true } }))
  return planoLibera(org.plano, 'agente')
}

/**
 * Levanta erro quando o plano da empresa não tem o assistente.
 *
 * Exportada para os outros caminhos que ligam o assistente ao mundo (conectar
 * o WhatsApp por QR, a linha Z-API, o número oficial da Meta) usarem a mesma
 * régua — ver `assistente/`.
 */
export async function exigirPlanoComAssistente(orgId: string): Promise<void> {
  if (await planoTemAssistente(orgId)) return
  // Desde 02/10/2026 o assistente é uma chave do Norte (+R$ 149 por mês), não
  // um plano "de cima": a frase diz onde ligar e quanto custa.
  const comAssistente = Object.values(PLANOS).some((p) => p.aVenda && (p.modulos as readonly string[]).includes('agente'))
  throw new Error(
    comAssistente
      ? `O assistente está desligado no plano desta empresa. Ligue em Assinatura: +R$ ${PRECOS.assistente} por mês, com ${milhar(PRECOS.respostasDoAssistente)} respostas.`
      : 'O plano desta empresa não tem o assistente.',
  )
}
