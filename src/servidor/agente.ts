// O agente da empresa — a parte que fala com o banco.
//
// As TRAVAS (o catálogo de poderes, o filtro de ferramentas, a conferência
// dos tetos) moram em `poderes.ts`, que é puro. A separação não é organização:
// é o que permite testar a trava sem subir banco, e testar exaustivamente é
// o único jeito de confiar numa trava.

import { comoOrg } from './banco'
import { exigir, pode, type Sessao } from './permissao'
import { type ComModulos } from './modulos'
import { centavos, reais } from './dinheiro'
import { lancar } from './financeiro'
import { mexerEstoque } from './estoque'
import type { TipoRecibo } from '@prisma/client'
import { custoEmCentavos, cobrancaEmCentavos } from './custo-ia'
import {
  PODERES,
  conferirPoder,
  PoderNegado,
  type AgenteConfig,
  type ChavePoder,
  type Poder,
} from './poderes'
import { garantirCreditoDoMes } from './assinatura'

export * from './poderes'
export * from './custo-ia'

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÃO
// ─────────────────────────────────────────────────────────────

export type ConfigAgente = {
  nome: string
  personalidade?: string | null
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

  const poderes = cfg.poderes.filter(
    (p): p is ChavePoder => (PODERES as Record<string, Poder>)[p]?.disponivel === true,
  )

  const dados = {
    nome: cfg.nome.trim(),
    personalidade: cfg.personalidade?.trim() || null,
    saudacao: cfg.saudacao?.trim() || null,
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
        antes: antes
          ? { poderes: antes.poderes, teto: Number(antes.descontoMaxPct), valorMax: antes.valorMaxCent, ativo: antes.ativo }
          : undefined,
        depois: { poderes, teto: cfg.descontoMaxPct, valorMax: cfg.valorMaxCent, ativo: cfg.ativo },
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
        expiraEm: new Date(Date.now() + HORAS_DE_VALIDADE * 3600_000),
      },
    }),
  )
}

export type Resposta =
  | { ok: true; recibo?: { tipo: TipoRecibo; valor: number } }
  | { ok: false; motivo: 'nao_existe' | 'ja_respondida' | 'expirada' | 'sem_permissao' | 'falhou'; detalhe?: string }

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
    return { ok: false, motivo: 'falhou', detalhe: msg(e) }
  }

  // 3. executa
  try {
    const recibo = await executar(sessao, proposta.poder as ChavePoder, proposta.dados as Record<string, unknown>)
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
    return { ok: true, recibo }
  } catch (e) {
    await marcar(sessao.orgId, propostaId, 'FALHOU', sessao.nome, msg(e))
    return { ok: false, motivo: 'falhou', detalhe: msg(e) }
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'erro desconhecido')

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
 */
async function executar(
  sessao: Sessao,
  poder: ChavePoder,
  dados: Record<string, unknown>,
): Promise<{ tipo: TipoRecibo; valor: number } | undefined> {
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
      // Compra feita antes de acabar é ruptura evitada — e o valor do recibo
      // não é o da compra: gastar não é ganhar. Quem emite recibo de ruptura
      // é o gatilho, quando a peça volta a vender.
      return undefined
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
      return undefined
    }

    default:
      throw new Error(`"${poder}" ainda não sabe executar.`)
  }
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
  motivo: 'ok' | 'sem_agente' | 'teto_do_dia' | 'sem_credito'
  gastoCent: number
  tetoCent: number
  saldoCent: number
  /** Frase pronta para a tela e para o log. */
  recado: string
}

export async function podeGastarHoje(orgId: string): Promise<VeredictoIA> {
  const agente = await acharAgente(orgId)
  if (!agente) {
    return {
      pode: false, motivo: 'sem_agente', gastoCent: 0, tetoCent: 0, saldoCent: 0,
      recado: 'Esta empresa não tem assistente configurado.',
    }
  }

  // O crédito incluso do mês cai antes de conferir o saldo: no dia 1º, a
  // primeira mensagem do mês não pode ser recusada por falta de um crédito
  // que o plano já garante.
  await garantirCreditoDoMes(orgId)

  const inicio = new Date()
  inicio.setHours(0, 0, 0, 0)

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

  // Duas travas, e elas respondem perguntas diferentes.
  //
  // O SALDO é comercial: acabou o crédito, o assistente para até recarregar.
  // Ele vem primeiro porque é o que o cliente resolve sozinho.
  if (saldoCent <= 0) {
    return {
      pode: false, motivo: 'sem_credito', gastoCent, tetoCent: agente.gastoDiaCent, saldoCent,
      recado: 'O crédito de IA acabou. Recarregue para o assistente voltar a responder.',
    }
  }

  // O TETO DIÁRIO é segurança, e é o que importa de madrugada: um defeito que
  // faça o agente responder a si mesmo em laço queima o crédito do mês numa
  // noite, e ninguém está olhando às três da manhã.
  if (gastoCent >= agente.gastoDiaCent) {
    return {
      pode: false, motivo: 'teto_do_dia', gastoCent, tetoCent: agente.gastoDiaCent, saldoCent,
      recado: 'O assistente já usou o teto de hoje. Ele volta amanhã.',
    }
  }

  return {
    pode: true, motivo: 'ok', gastoCent, tetoCent: agente.gastoDiaCent, saldoCent,
    recado: 'ok',
  }
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
