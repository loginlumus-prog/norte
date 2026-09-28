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
import { comoOrg, type BancoDaOrg } from './banco'
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
import { MODULOS } from './modulos'
import { diaEmSP } from './dia'

const mostrarDia = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)
import { plural } from './texto'

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

/**
 * Deposita o crédito de IA incluso no plano, uma vez por mês.
 *
 * A tabela de planos promete "R$ 100 de crédito de IA por mês" — e até 25/09
 * nada no código depositava: o crédito só chegava se alguém pusesse à mão.
 * Agora ele cai sozinho na primeira vez que o mês é olhado (a tela da
 * assinatura, ou o assistente antes de gastar), sem precisar de agendador.
 *
 * Uma vez por mês, e não mais: o recibo do depósito leva `plano:AAAA-MM` na
 * referência, e a trava de transação impede que duas conversas chegando ao
 * mesmo tempo depositem duas vezes. Quem sobe de plano no meio do mês recebe
 * o do plano novo se ainda não recebeu nenhum naquele mês. O que sobra de um
 * mês passa para o outro — o crédito é da loja, não vence.
 *
 * Empresa suspensa ou cancelada não recebe. Corporativo (`creditoMensal`
 * nulo) tem o crédito no contrato, e o Grátis e o Balcão não têm assistente.
 */
export async function garantirCreditoDoMes(orgId: string, agora = new Date()): Promise<number> {
  const mes = diaEmSP(agora).slice(0, 7)
  const referencia = `plano:${mes}`
  return comoOrg(orgId, async (db) => {
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`credito-do-mes:${orgId}`}))`
    const org = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { plano: true, situacao: true },
    })
    const incluso = PLANOS[org.plano].creditoMensal
    if (!incluso || org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') return 0

    const ja = await db.recargaIA.findFirst({
      where: { tipo: 'PLANO', referencia },
      select: { id: true },
    })
    if (ja) return 0

    const centavos = incluso * 100
    const depois = await db.org.update({
      where: { id: orgId },
      data: { creditoIaCent: { increment: centavos } },
      select: { creditoIaCent: true },
    })
    const [ano, m] = mes.split('-')
    await db.recargaIA.create({
      data: {
        orgId,
        centavos,
        saldoDepois: depois.creditoIaCent,
        tipo: 'PLANO',
        origem: 'plano',
        referencia,
        motivo: `Crédito incluso no plano ${PLANOS[org.plano].titulo} — ${m}/${ano}`,
        quem: 'Norte',
      },
    })
    return centavos
  })
}

export const assinaturaDe = (sessao: Sessao): Promise<Assinatura> => assinaturaDaEmpresa(sessao.orgId)

/**
 * O teste que venceu vira Grátis — na primeira vez que alguém olha.
 *
 * `situacao = TESTE` com `testeAte` no passado continuava com o plano pago e
 * tudo liberado para sempre: nada no sistema olhava a data (o cadastro pelo
 * site nem cria teste por isso — ver autocadastro.ts; quem cria é a equipe,
 * em scripts/criar-empresa.ts). Sem agendador, a troca acontece aqui, e isto
 * é chamado nos caminhos que TODA tela percorre (`resumoDaBarra`, na barra
 * lateral) e nos que decidem plano (`assinaturaDaEmpresa`, `planoDaEmpresa`).
 *
 * É a mesma troca da tela (`aplicarTroca`): os módulos que o Grátis não tem
 * saem, e fica no livro, assinada pelo sistema. Loja demais para o Grátis não
 * impede — o teste acabou de qualquer jeito, e o aviso de "você usa 3 lojas
 * e o plano atende 1" já existe. Os dados ficam todos; só o que o plano não
 * cobre desliga. `testeAte` fica gravado: é por ele que a tela diz quando o
 * teste acabou.
 */
export async function vencerTesteSeAcabou(orgId: string, agora = new Date()): Promise<boolean> {
  const org = await comoOrg(orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true, situacao: true, testeAte: true } }),
  )
  if (org.situacao !== 'TESTE' || !org.testeAte || org.testeAte > agora) return false
  // Primeiro o plano, depois a situação: se cair no meio, a próxima olhada
  // termina o serviço (com o plano já no Grátis, só a situação muda).
  if (org.plano !== 'GRATIS') {
    await aplicarTroca(orgId, 'GRATIS', { usuarioId: null, quem: 'Norte', autor: 'SISTEMA' }, { forcar: true })
  }
  await comoOrg(orgId, (db) =>
    db.org.updateMany({ where: { id: orgId, situacao: 'TESTE' }, data: { situacao: 'ATIVA' } }),
  )
  return true
}

/**
 * A assinatura de uma empresa pelo id — o mesmo quadro da tela, sem sessão.
 * Existe para a equipe do Norte (scripts/operacao.ts), que age SOBRE a
 * empresa e não DENTRO dela; quem vem da tela passa por `assinaturaDe`.
 */
export async function assinaturaDaEmpresa(orgId: string): Promise<Assinatura> {
  await vencerTesteSeAcabou(orgId)
  await garantirCreditoDoMes(orgId)
  return comoOrg(orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        plano: true, situacao: true, testeAte: true,
        creditoIaCent: true, creditoAvisoCent: true,
      },
    })

    const desde30 = new Date(Date.now() - 30 * DIA)
    // Só unidade ATIVA conta cota. Desativar é o caminho legítimo para
    // caber num plano menor, e ele precisa funcionar.
    const unidades = await db.unidade.count({ where: { ativa: true } })
    // Cota é de ACESSO, não de cadastro: quem saiu da empresa continua no
    // banco por causa do histórico e não pode ocupar vaga.
    // O acesso do NOSSO suporte não é gente da loja: a conta de suporte
    // existe na empresa (é assim que o livro diz quem olhou), mas não entra
    // na conta de "pessoas cadastradas" que a loja lê.
    const usuarios = await db.usuario.count({
      where: { ativo: true, acessos: { some: { papel: { not: 'SUPORTE' } } } },
    })
    // O que a LOJA pagou, nao o que o fornecedor cobrou da gente: e o
    // consumo dela que a tela dela mostra.
    const gasto = await db.consumoIA.aggregate({
      where: { criadoEm: { gte: desde30 } },
      _sum: { cobradoCent: true },
    })

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
          ? {
              nivel: 'critico',
              texto: diasDeTeste <= 0 ? 'O teste acaba hoje.' : `O teste acaba em ${plural(diasDeTeste, 'dia', 'dias')}.`,
            }
          : { nivel: 'atencao', texto: `Teste até o fim: faltam ${diasDeTeste} dias.` },
      )
    }
    // O teste acabou há pouco: a loja precisa saber por que o menu encolheu.
    if (
      org.situacao !== 'TESTE' &&
      org.plano === 'GRATIS' &&
      testeAte !== null &&
      testeAte.getTime() <= Date.now() &&
      Date.now() - testeAte.getTime() < 30 * DIA
    ) {
      alertas.push({
        nivel: 'atencao',
        texto: `O teste acabou em ${mostrarDia(testeAte)} e a empresa voltou para o plano ${PLANOS.GRATIS.titulo}. Os dados continuam todos aqui; para religar o que desligou, escolha um plano abaixo.`,
      })
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
          credito.diasQueDura !== null ? `, cerca de ${plural(credito.diasQueDura, 'dia', 'dias')}` : ''
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
 * A empresa pode subir de plano e pôr crédito sozinha, sem pagar?
 *
 * Enquanto o gateway de pagamento não existe, NÃO: subir de plano e recarregar
 * crédito de IA viram PEDIDO, que a gente confirma junto com o pagamento. Antes
 * de 25/09 os dois cliques liberavam na hora — qualquer dono ia para o Direção
 * e punha R$ 5.000 de crédito de IA de graça, e o crédito é gasto real nosso
 * com a IA. Descer de plano continua imediato: não custa nada a ninguém.
 *
 * `NORTE_ASSINATURA_LIVRE=1` liga o clique direto — para o banco local, as
 * conferências e, no futuro, quando o gateway cobrar antes de liberar.
 */
export const assinaturaLivre = () => process.env.NORTE_ASSINATURA_LIVRE === '1'

/** Registra o pedido no livro da empresa e no log do servidor, onde a gente lê. */
export async function registrarPedido(
  sessao: Sessao,
  pedido: { tipo: 'plano'; para: Plano } | { tipo: 'credito'; centavos: number },
) {
  exigir(sessao, 'empresa.configurar')
  const texto =
    pedido.tipo === 'plano'
      ? `Pediu o plano ${PLANOS[pedido.para].titulo}`
      : `Pediu ${mostrar(pedido.centavos)} de crédito de IA`
  await comoOrg(sessao.orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: pedido.tipo === 'plano' ? 'plano.pediu' : 'credito.pediu',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        alvoNome: pedido.tipo === 'plano' ? PLANOS[pedido.para].titulo : mostrar(pedido.centavos),
        motivo: texto,
        // O que foi pedido, em forma de máquina. O título e o "R$ 200,00"
        // acima são para gente ler; a equipe atende pelo que está aqui
        // (src/servidor/pedidos.ts) — e título de plano muda de nome.
        depois: pedido.tipo === 'plano' ? { plano: pedido.para } : { centavos: pedido.centavos },
      },
    }),
  )
  // O log do servidor avisa que chegou; quem ATENDE lê a lista pela
  // ferramenta de operação (`npm run operacao -- pedidos`). Sem dado
  // pessoal: a empresa pelo id, e o que foi pedido.
  console.info(`[pedido-assinatura] org=${sessao.orgId} ${texto}`)
}

/**
 * O quadro da troca, só lendo: plano de hoje, lojas ativas, e o que mudaria.
 *
 * Não deposita o crédito do mês nem grava nada — é o que a ferramenta da
 * equipe mostra ANTES do `--confirmar`, e prévia que escreve no banco não é
 * prévia.
 */
export async function previaDeTroca(orgId: string, para: Plano): Promise<Mudanca> {
  const { plano, unidades } = await comoOrg(orgId, async (db) => {
    // Em sequência: dentro do comoOrg é uma conexão só.
    const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true } })
    // Só loja ATIVA conta, como em `assinaturaDaEmpresa`.
    const unidades = await db.unidade.count({ where: { ativa: true } })
    return { plano: org.plano, unidades }
  })
  return mudanca(plano, para, { unidades })
}

/** Quem assina a troca no livro. */
type AutorDaTroca = {
  usuarioId: string | null
  quem: string
  autor: 'PESSOA' | 'SISTEMA'
  /** O pedido que esta troca atende, quando é a equipe respondendo um. */
  pedidoId?: string | null
}

/**
 * O miolo da troca, igual para a loja e para a equipe: as mesmas travas
 * (`mudanca` — loja demais para o plano novo impede), os mesmos módulos
 * desligados, a mesma linha no livro. Duas cópias disto divergiriam no dia
 * em que uma regra nova entrasse numa só.
 */
async function aplicarTroca(
  orgId: string,
  para: Plano,
  por: AutorDaTroca,
  /** `forcar`: o teste que venceu desce mesmo com loja demais. Ver `vencerTesteSeAcabou`. */
  opcoes: { forcar?: boolean } = {},
): Promise<Mudanca> {
  const m = await previaDeTroca(orgId, para)
  if (m.impedimentos.length > 0 && !opcoes.forcar) throw new SemCota(m.impedimentos.join(' '), m.de)
  // Subindo (ou de lado), o crédito incluso do mês cai ANTES, no plano de
  // hoje — era o que a troca já fazia. DESCENDO, não: depositar o crédito do
  // plano de cima no dia de sair dele dava R$ 100 de IA a quem acabou de
  // deixar de pagar por ela (Rede → Grátis no dia 1º levava o mês inteiro).
  // Se o mês ainda não recebeu nada, o plano novo deposita o dele na próxima
  // vez que a assinatura for olhada.
  if (m.sentido !== 'descer') await garantirCreditoDoMes(orgId)

  await comoOrg(orgId, async (db) => {
    const antes = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { modulos: true },
    })

    // Módulo que o plano novo não libera SAI da lista. Deixar ligado seria
    // vender de graça o que o plano de cima cobra — e, pior, o menu mostraria
    // uma tela que a assinatura não cobre.
    const permitidos = new Set<string>(PLANOS[para].modulos)
    const modulos = antes.modulos.filter((m) => permitidos.has(m))

    await db.org.update({ where: { id: orgId }, data: { plano: para, modulos } })
    await db.auditoria.create({
      data: {
        orgId,
        usuarioId: por.usuarioId,
        quem: por.quem,
        autor: por.autor,
        acao: 'plano.trocou',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: PLANOS[para].titulo,
        motivo: `${opcoes.forcar ? 'Teste acabou: ' : ''}${PLANOS[m.de].titulo} → ${PLANOS[para].titulo}${
          m.perde.length > 0 ? ` (perdeu: ${m.perde.map((x) => MODULOS[x]?.titulo ?? x).join(', ')})` : ''
        }`,
        antes: { plano: m.de, modulos: antes.modulos },
        depois: { de: m.de, para, modulos, ...(por.pedidoId ? { pedidoId: por.pedidoId } : {}) },
      },
    })
  })

  return m
}

/**
 * Troca o plano.
 *
 * Não mexe em cobrança — isso é do gateway, quando existir. O que ela faz é o
 * que o sistema precisa saber agora: qual plano vale, quais módulos ficam
 * ligados, e o registro no livro de quem trocou o quê.
 */
export async function trocarPlano(sessao: Sessao, para: Plano) {
  exigir(sessao, 'empresa.configurar')
  return aplicarTroca(sessao.orgId, para, { usuarioId: sessao.usuarioId, quem: sessao.nome, autor: 'PESSOA' })
}

/**
 * A troca feita pela equipe do Norte — o pedido de subir que a loja fez, já
 * pago, ou o Corporativo fechado em contrato.
 *
 * Mesmas travas da tela (`aplicarTroca`), sem sessão: quem chama é a
 * ferramenta de operação, do laptop. No livro da loja a linha sai assinada
 * "Equipe Norte (<quem rodou>)" e aponta para o pedido que atende — é isso
 * que tira o pedido da lista de abertos (src/servidor/pedidos.ts).
 */
export async function trocarPlanoComoEquipe(
  orgId: string,
  para: Plano,
  quem: string,
  opcoes: { pedidoId?: string | null } = {},
): Promise<Mudanca> {
  return aplicarTroca(orgId, para, {
    usuarioId: null,
    quem: quemDaEquipe(quem),
    autor: 'SISTEMA',
    pedidoId: opcoes.pedidoId ?? null,
  })
}

/**
 * Como a equipe do Norte assina no livro da loja: "Equipe Norte (Fulano)".
 *
 * O nome de quem rodou vai junto porque "o Norte" não é ninguém — a loja tem
 * direito de saber QUEM daqui mexeu na conta dela, e nós também, na hora de
 * perguntar por quê. E-mail não entra: o livro não se apaga.
 */
export function quemDaEquipe(nome: string): string {
  const n = nome.trim().replace(/\s+/g, ' ')
  if (/^Equipe Norte \(.+\)$/.test(n)) return n
  if (n.length < 2 || n.length > 60 || n.includes('@') || !/\p{L}/u.test(n)) {
    throw new Error('Diga quem está rodando: --quem "Seu nome" (de 2 a 60 caracteres, sem e-mail).')
  }
  return `Equipe Norte (${n})`
}

type DadosDaRecarga = {
  tipo: 'COMPRA' | 'PLANO' | 'AJUSTE' | 'ESTORNO'
  quem: string
  origem?: string
  referencia?: string
  motivo?: string
}

/**
 * O miolo da recarga, dentro de uma transação que já existe — para quem
 * precisa gravar a linha do livro JUNTO (a equipe, em operacao.ts). Recarga
 * e linha do livro na mesma transação: ou as duas, ou nenhuma.
 */
export async function creditarNaTransacao(
  db: BancoDaOrg,
  orgId: string,
  centavos: number,
  dados: DadosDaRecarga,
): Promise<number> {
  if (!Number.isInteger(centavos) || centavos === 0) {
    throw new Error('Recarga precisa ser um número inteiro de centavos, diferente de zero.')
  }

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
}

/**
 * Põe crédito de IA na conta.
 *
 * Hoje quem chama é a tela (no modo livre) e a equipe do Norte, pela
 * ferramenta de operação. Quando o gateway existir, ele chama esta mesma
 * função com `origem` e `referencia` do pagamento — e nada além disto muda.
 */
export async function recarregarCredito(orgId: string, centavos: number, dados: DadosDaRecarga) {
  if (!Number.isInteger(centavos) || centavos === 0) {
    throw new Error('Recarga precisa ser um número inteiro de centavos, diferente de zero.')
  }
  return comoOrg(orgId, (db) => creditarNaTransacao(db, orgId, centavos, dados))
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
  const ler = () =>
    comoOrg(orgId, (db) =>
      db.org.findUniqueOrThrow({
        where: { id: orgId },
        select: {
          plano: true, situacao: true, testeAte: true,
          creditoIaCent: true, creditoAvisoCent: true,
        },
      }),
    )
  let org = await ler()
  // Toda tela passa por aqui: é o lugar que garante que o teste vencido não
  // segue com o plano pago. Só relê quando de fato venceu — uma vez.
  if (org.situacao === 'TESTE' && org.testeAte && org.testeAte <= new Date()) {
    if (await vencerTesteSeAcabou(orgId)) org = await ler()
  }
  const p = PLANOS[org.plano]

  const semCredito = p.creditoMensal !== 0 && org.creditoIaCent <= org.creditoAvisoCent
  const testeAcabando =
    org.situacao === 'TESTE' &&
    org.testeAte !== null &&
    org.testeAte.getTime() - Date.now() < 5 * DIA
  const cobrancaAberta = org.situacao === 'INADIMPLENTE' || org.situacao === 'SUSPENSA'

  return { titulo: p.titulo, alerta: semCredito || testeAcabando || cobrancaAberta }
}
