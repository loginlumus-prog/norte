// A assinatura: o que esta empresa contratou, o que ela está usando, e o que
// isso libera ou impede.
//
// ── por que existe um lugar só para isto ─────────────────────
// Limite de plano espalhado pelo código vira limite que não existe. A prova
// está no próprio projeto: `planos.ts` tinha as regras escritas e testadas
// desde a Fase 1, e NENHUMA delas era consultada em lugar nenhum — dava para
// criar a décima loja no plano de uma. Regra que ninguém chama é comentário.
//
// Agora todo caminho que gasta cota passa por aqui, e a tela lê daqui.
//
// ── o gateway de pagamento ainda não existe, e tudo bem ──────
// O que falta é só a cobrança em si. Tudo o que vem ANTES dela já está de pé:
// quem pode o quê, quanto custa, o que acontece ao trocar, e a carteira de
// crédito com extrato. Quando o gateway entrar, ele escreve em dois lugares —
// `Cobranca` (a assinatura) e `RecargaIA` (a compra de crédito) — e nada mais
// no sistema precisa saber qual gateway é.

import type { Plano, Situacao } from '@prisma/client'
import { comoOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import {
  PLANOS,
  mensalidade,
  mudanca,
  menorQueCabe,
  podeCriarUnidade,
  type Mudanca,
} from './planos'
import { mostrar } from './dinheiro'

export type Uso = { unidades: number; usuarios: number }

export type Assinatura = {
  plano: Plano
  titulo: string
  resumo: string
  situacao: Situacao
  /** Fim do teste, quando a empresa ainda está em teste. */
  testeAte: Date | null
  /** Dias que faltam do teste. Negativo = passou. */
  diasDeTeste: number | null
  uso: Uso
  limite: { unidades: number | null; vagas: number | null }
  mensal: { base: number | null; extras: number; porExtra: number | null; total: number | null }
  credito: {
    saldoCent: number
    avisoCent: number
    /** Quanto o plano inclui por mês, em reais. */
    /** `null` = sai no contrato (só o Corporativo). */
    inclusoMensal: number | null
    /** Gasto dos últimos 30 dias, para dar noção de quanto dura o saldo. */
    gasto30Cent: number
    /** Estimativa de dias que o saldo aguenta no ritmo atual. null = sem gasto. */
    diasQueDura: number | null
    acabou: boolean
    baixo: boolean
  }
  /** Avisos para a tela mostrar sem a pessoa precisar procurar. */
  alertas: { nivel: 'atencao' | 'critico'; texto: string }[]
}

const DIA = 864e5

export async function assinaturaDe(sessao: Sessao): Promise<Assinatura> {
  return comoOrg(sessao.orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: {
        plano: true, situacao: true, testeAte: true,
        creditoIaCent: true, creditoAvisoCent: true,
      },
    })

    const desde30 = new Date(Date.now() - 30 * DIA)
    const [unidades, usuarios, gasto] = await Promise.all([
      // Só unidade ATIVA conta cota. Desativar é o caminho legítimo para
      // caber num plano menor, e ele precisa funcionar.
      db.unidade.count({ where: { ativa: true } }),
      // Cota é de ACESSO, não de cadastro: quem saiu da empresa continua no
      // banco por causa do histórico e não pode ocupar vaga.
      db.usuario.count({ where: { ativo: true, acessos: { some: {} } } }),
      // O que a LOJA pagou, nao o que o fornecedor cobrou da gente: e o
      // consumo dela que a tela dela mostra.
      db.consumoIA.aggregate({
        where: { criadoEm: { gte: desde30 } },
        _sum: { cobradoCent: true },
      }),
    ])

    const p = PLANOS[org.plano]
    const uso: Uso = { unidades, usuarios }
    const gasto30Cent = gasto._sum.cobradoCent ?? 0
    const porDia = gasto30Cent / 30
    const saldoCent = org.creditoIaCent

    const credito = {
      saldoCent,
      avisoCent: org.creditoAvisoCent,
      inclusoMensal: p.creditoMensal,
      gasto30Cent,
      diasQueDura: porDia > 0 ? Math.floor(saldoCent / porDia) : null,
      // `creditoMensal` nulo é o Corporativo: ele TEM assistente, o crédito
      // dele existe e sai no contrato. Então o aviso de "acabou" vale igual —
      // o que não existe é uma cota de tabela para desenhar a régua.
      acabou: p.creditoMensal !== 0 && saldoCent <= 0,
      baixo: p.creditoMensal !== 0 && saldoCent > 0 && saldoCent <= org.creditoAvisoCent,
    }

    const testeAte = org.testeAte
    const diasDeTeste = testeAte
      ? Math.ceil((testeAte.getTime() - Date.now()) / DIA)
      : null

    const alertas: Assinatura['alertas'] = []

    if (org.situacao === 'TESTE' && diasDeTeste !== null) {
      alertas.push(
        diasDeTeste <= 3
          ? { nivel: 'critico', texto: `O teste acaba em ${Math.max(diasDeTeste, 0)} dia(s).` }
          : { nivel: 'atencao', texto: `Teste até o fim: faltam ${diasDeTeste} dias.` },
      )
    }
    if (org.situacao === 'INADIMPLENTE') {
      alertas.push({
        nivel: 'critico',
        texto: 'Há uma mensalidade em aberto. O acesso continua enquanto resolvemos.',
      })
    }
    if (credito.acabou) {
      alertas.push({
        nivel: 'critico',
        texto: 'O crédito de IA acabou — o assistente parou de responder. Recarregue para religar.',
      })
    } else if (credito.baixo) {
      alertas.push({
        nivel: 'atencao',
        texto: `Crédito de IA baixo: ${mostrar(saldoCent)}${
          credito.diasQueDura !== null ? `, cerca de ${credito.diasQueDura} dia(s)` : ''
        }.`,
      })
    }
    // Uso acima da cota acontece de verdade: o plano pode ter sido rebaixado
    // por um gateway, ou o limite pode ter mudado depois da venda.
    if (p.unidades !== null && unidades > p.unidades) {
      alertas.push({
        nivel: 'atencao',
        texto: `Você usa ${unidades} unidades e o plano atende ${p.unidades}.`,
      })
    }

    return {
      plano: org.plano,
      titulo: p.titulo,
      resumo: p.resumo,
      situacao: org.situacao,
      testeAte,
      diasDeTeste,
      uso,
      limite: { unidades: p.unidades, vagas: p.vagas },
      mensal: mensalidade(org.plano, unidades),
      credito,
      alertas,
    }
  })
}

/** As opções de troca, já com o quadro de cada uma. Ordenadas do menor ao maior. */
export async function opcoesDeTroca(sessao: Sessao): Promise<Mudanca[]> {
  const a = await assinaturaDe(sessao)
  return (Object.keys(PLANOS) as Plano[])
    .sort((x, y) => PLANOS[x].degrau - PLANOS[y].degrau)
    .map((p) => mudanca(a.plano, p, a.uso))
}

export class SemCota extends Error {
  constructor(
    readonly motivo: string,
    readonly sugestao: Plano,
  ) {
    super(motivo)
  }
}

/**
 * A trava, chamada ANTES de criar unidade.
 *
 * Devolve o custo extra quando cabe pagando: quem chama é obrigado a mostrar
 * o valor antes de confirmar. Cliente que descobre a cobrança na fatura
 * cancela, e reclama em público — o que custa mais que o cliente.
 */
export async function exigirCotaDeUnidade(
  sessao: Sessao,
): Promise<{ custoExtra: number; novoTotal?: number }> {
  const a = await assinaturaDe(sessao)
  const v = podeCriarUnidade(a.plano, a.uso.unidades)
  if (!v.pode) throw new SemCota(v.motivo, v.sugestao)
  return { custoExtra: v.custoExtra, novoTotal: 'novoTotal' in v ? v.novoTotal : undefined }
}

// Aqui existia `exigirCotaDeUsuario`, que barrava CADASTRAR gente além da cota
// do plano. Ela saiu junto com a cota de cadastro: registrar a equipe inteira
// passou a ser de graça em todo plano, e o que a assinatura limita agora é
// quanta gente fica DENTRO ao mesmo tempo.
//
// A troca não é comercial, é de segurança: cobrar por conta cadastrada empurra
// a loja a compartilhar login, e login compartilhado faz o livro de auditoria
// mentir. A conferência de vaga mora no login — ver `podeAbrirVaga`.

/**
 * Troca o plano.
 *
 * Não mexe em cobrança — isso é do gateway, quando existir. O que ela faz é o
 * que o sistema precisa saber agora: qual plano vale, quais módulos ficam
 * ligados, e o registro no livro de quem trocou o quê.
 */
export async function trocarPlano(sessao: Sessao, para: Plano) {
  exigir(sessao, 'empresa.configurar')

  const a = await assinaturaDe(sessao)
  const m = mudanca(a.plano, para, a.uso)
  if (m.impedimentos.length > 0) throw new SemCota(m.impedimentos.join(' '), a.plano)

  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: { modulos: true },
    })

    // Módulo que o plano novo não libera SAI da lista. Deixar ligado seria
    // vender de graça o que o plano de cima cobra — e, pior, o menu mostraria
    // uma tela que a assinatura não cobre.
    const permitidos = new Set<string>(PLANOS[para].modulos)
    const modulos = antes.modulos.filter((m) => permitidos.has(m))

    await db.org.update({ where: { id: sessao.orgId }, data: { plano: para, modulos } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'plano.trocou',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        alvoNome: PLANOS[para].titulo,
        motivo: `${PLANOS[a.plano].titulo} → ${PLANOS[para].titulo}${
          m.perde.length > 0 ? ` (perdeu: ${m.perde.join(', ')})` : ''
        }`,
      },
    })
  })

  return m
}

/**
 * Põe crédito de IA na conta.
 *
 * Hoje quem chama é o painel do dono do sistema, na mão. Quando o gateway
 * existir, ele chama esta mesma função com `origem` e `referencia` do
 * pagamento — e nada além disto muda.
 */
export async function recarregarCredito(
  orgId: string,
  centavos: number,
  dados: { tipo: 'COMPRA' | 'PLANO' | 'AJUSTE' | 'ESTORNO'; quem: string; origem?: string; referencia?: string; motivo?: string },
) {
  if (!Number.isInteger(centavos) || centavos === 0) {
    throw new Error('Recarga precisa ser um número inteiro de centavos, diferente de zero.')
  }

  return comoOrg(orgId, async (db) => {
    // Uma escrita só, com o delta: ler-somar-gravar abriria corrida entre
    // duas recargas ao mesmo tempo.
    const depois = await db.org.update({
      where: { id: orgId },
      data: { creditoIaCent: { increment: centavos } },
      select: { creditoIaCent: true },
    })

    await db.recargaIA.create({
      data: {
        orgId,
        centavos,
        saldoDepois: depois.creditoIaCent,
        tipo: dados.tipo,
        origem: dados.origem ?? 'manual',
        referencia: dados.referencia,
        motivo: dados.motivo,
        quem: dados.quem,
      },
    })

    return depois.creditoIaCent
  })
}

/** O extrato da carteira. */
export async function extratoDeCredito(sessao: Sessao, quantos = 30) {
  exigir(sessao, 'empresa.configurar')
  return comoOrg(sessao.orgId, (db) =>
    db.recargaIA.findMany({
      orderBy: { criadoEm: 'desc' },
      take: quantos,
      select: {
        id: true, centavos: true, saldoDepois: true, tipo: true,
        origem: true, motivo: true, quem: true, criadoEm: true,
      },
    }),
  )
}

/** O menor plano que comporta o uso de hoje. Serve para sugerir na tela. */
export async function sugestaoDePlano(sessao: Sessao): Promise<Plano> {
  const a = await assinaturaDe(sessao)
  return menorQueCabe(a.uso)
}

/**
 * A versão barata, para a barra lateral.
 *
 * `assinaturaDe` faz quatro consultas — org, contagem de unidades, contagem de
 * gente e o gasto de trinta dias. Isso vale na tela da assinatura e seria
 * desperdício em TODAS as telas do sistema só para escrever o nome do plano no
 * rodapé. Aqui é uma leitura só, da própria linha da empresa.
 */
export async function resumoDaBarra(
  orgId: string,
): Promise<{ titulo: string; alerta: boolean }> {
  const org = await comoOrg(orgId, (db) =>
    db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        plano: true, situacao: true, testeAte: true,
        creditoIaCent: true, creditoAvisoCent: true,
      },
    }),
  )
  const p = PLANOS[org.plano]

  const semCredito = p.creditoMensal !== 0 && org.creditoIaCent <= org.creditoAvisoCent
  const testeAcabando =
    org.situacao === 'TESTE' &&
    org.testeAte !== null &&
    org.testeAte.getTime() - Date.now() < 5 * DIA
  const cobrancaAberta = org.situacao === 'INADIMPLENTE' || org.situacao === 'SUSPENSA'

  return { titulo: p.titulo, alerta: semCredito || testeAcabando || cobrancaAberta }
}
