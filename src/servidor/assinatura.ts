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
// quem pode o quê, quanto custa, o que acontece ao trocar, as respostas do
// assistente no mês e a carteira que trava o custo de IA por baixo. Quando o
// gateway entrar, ele escreve em dois lugares — `Cobranca` (a assinatura) e
// `adicionarPacoteDeRespostas` (o pacote pago) — e nada mais no sistema
// precisa saber qual gateway é.

import type { Plano, Situacao } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, exigirQueNaoSejaSuporte, type Sessao } from './permissao'
import {
  PLANOS,
  PRECOS,
  PACOTES,
  TETO_IA_DO_TESTE_CENT,
  respostasDoPlano,
  somar,
  tetoDoMesCent,
  tetoDoPacoteCent,
  type Pacote,
  mensalidade,
  milhar,
  mudanca,
  menorQueCabe,
  podeCriarUnidade,
  type Mudanca,
} from './planos'
import { mostrar } from './dinheiro'
import { MODULOS, moduloLigado } from './modulos'
import { diaEmSP, inicioDoDiaEmSP, somarDias } from './dia'

/** As lojas de venda que contam para a franquia e para a conta (depósito não). */
const lojasDeVenda = (db: BancoDaOrg) => db.unidade.count({ where: { ativa: true, ehDeposito: false } })

/**
 * Quantas respostas um pacote do mês trouxe, pela referência
 * (`respostas:AAAA-MM:300`). Os de antes de 06/10/2026 não têm o número no fim
 * — eram todos de 500.
 */
export const respostasDaReferencia = (referencia: string | null) => {
  const n = Number(referencia?.split(':')[2])
  return Number.isInteger(n) && n > 0 ? n : 500
}

/** O preço de um pacote pelo tamanho (o de 500, de antes de 06/10/2026, custava R$ 49). */
const precoDoPacote = (respostas: number) =>
  respostas === PACOTES.grande.respostas ? PACOTES.grande.preco : respostas === PACOTES.pequeno.respostas ? PACOTES.pequeno.preco : 49

const mostrarDia = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)
import { plural } from './texto'

export type Uso = {
  unidades: number
  usuarios: number
  /** Fábricas ativas: cobradas à parte (`PRECOS.fabrica`). */
  fabricas?: number
  /** Marcas do Farol contratadas (0 sem o módulo). */
  farolMarcas?: number
}

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
  mensal: ReturnType<typeof mensalidade>
  /** As respostas do assistente no período — o que o cliente lê. */
  respostas: Respostas
  /**
   * A carteira de IA, que o cliente NÃO lê como dinheiro: é a trava nossa de
   * custo (ver "a trava de dinheiro" em planos.ts). `travou` = o assistente
   * parou por ela, antes de as respostas acabarem.
   */
  credito: { saldoCent: number; travou: boolean }
  /** Avisos para a tela mostrar sem a pessoa precisar procurar. */
  alertas: { nivel: 'atencao' | 'critico'; texto: string }[]
}

const DIA = 864e5

/** 'AAAA-MM' do mês de São Paulo. É a chave do mês em tudo daqui. */
export const mesEmSP = (agora: Date = new Date()) => diaEmSP(agora).slice(0, 7)

/** Meia-noite do dia 1º deste mês, em São Paulo. */
export const inicioDoMesEmSP = (agora: Date = new Date()) => inicioDoDiaEmSP(`${mesEmSP(agora)}-01`)

/** Meia-noite do dia 1º do mês que vem, em São Paulo: quando as respostas voltam. */
export const proximoMesEmSP = (agora: Date = new Date()) =>
  inicioDoDiaEmSP(`${somarDias(`${mesEmSP(agora)}-28`, 4).slice(0, 7)}-01`)

/**
 * Completa a carteira até o teto do mês, uma vez por mês.
 *
 * A carteira é a trava de CUSTO por baixo das respostas (ver "a trava de
 * dinheiro" em planos.ts). No começo do mês ela vai ATÉ o teto — não soma:
 * sobra de um mês não vira crédito acumulado, senão um mês parado bancava um
 * mês de uso fora da curva e a empresa custava mais do que paga. Saldo acima
 * do teto (recarga comprada no modelo antigo) fica como está: é do cliente.
 *
 * Cai sozinho na primeira vez que o mês é olhado (a tela da assinatura, ou o
 * assistente antes de gastar), sem agendador. Uma vez por mês, e não mais: o
 * recibo leva `plano:AAAA-MM` na referência — gravado mesmo quando o saldo já
 * estava no teto (valor zero), senão o meio do mês completaria de novo — e a
 * trava de transação impede que duas conversas ao mesmo tempo completem duas
 * vezes. Quem liga o assistente no meio do mês recebe o teto na próxima
 * olhada, se o mês ainda não tinha recibo.
 *
 * No TESTE o teto é o das respostas do teste, UMA vez para o teste inteiro (o
 * teste de 30 dias que atravessa a virada recebia duas). Empresa suspensa ou
 * cancelada não recebe; plano sem assistente, também não. O Corporativo
 * (`respostasMes` nulo) tem a carteira posta pela equipe, pelo contrato.
 */
export async function garantirCreditoDoMes(orgId: string, agora = new Date()): Promise<number> {
  const mes = mesEmSP(agora)
  const referencia = `plano:${mes}`
  return comoOrg(orgId, async (db) => {
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`credito-do-mes:${orgId}`}))`
    const org = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { plano: true, situacao: true, creditoIaCent: true },
    })
    if (!PLANOS[org.plano].respostasMes || org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') return 0
    const emTeste = org.situacao === 'TESTE'
    // A franquia cresce com as lojas (cada loja a mais soma respostas), e o
    // teto da carteira acompanha.
    const teto = emTeste ? TETO_IA_DO_TESTE_CENT : tetoDoMesCent(org.plano, await lojasDeVenda(db))

    const ja = await db.recargaIA.findFirst({
      where: { tipo: 'PLANO', referencia },
      select: { id: true },
    })
    if (ja) return 0
    // O teto do teste é um por TESTE, não um por mês. Qualquer recibo de
    // plano já gravado (o teste nasce sem nenhum) é o dele.
    if (emTeste) {
      const doTeste = await db.recargaIA.findFirst({ where: { tipo: 'PLANO', origem: 'plano' }, select: { id: true } })
      if (doTeste) return 0
    }

    const centavos = Math.max(0, teto - org.creditoIaCent)
    const depois =
      centavos > 0
        ? await db.org.update({
            where: { id: orgId },
            data: { creditoIaCent: { increment: centavos } },
            select: { creditoIaCent: true },
          })
        : { creditoIaCent: org.creditoIaCent }
    const [ano, m] = mes.split('-')
    await db.recargaIA.create({
      data: {
        orgId,
        centavos,
        saldoDepois: depois.creditoIaCent,
        tipo: 'PLANO',
        origem: 'plano',
        referencia,
        motivo: emTeste
          ? `Teto de IA do teste (${milhar(PRECOS.respostasDoTeste)} respostas)`
          : `Teto de IA do mês, ${PLANOS[org.plano].titulo} — ${m}/${ano}`,
        quem: 'Norte',
      },
    })
    return centavos
  })
}

// ─────────────────────────────────────────────────────────────
// AS RESPOSTAS DO MÊS — a unidade que o cliente lê
// ─────────────────────────────────────────────────────────────
//
// O que conta como resposta, como o mês vira e o que o pacote faz estão em
// "o assistente, em respostas" (planos.ts). Aqui é a conta: a franquia do
// plano mais os pacotes do mês, contra as mensagens marcadas `resposta_ia`
// desde o dia 1º (no teste, desde que a empresa nasceu).

export type Respostas = {
  /** O que o plano dá no período. 0 = sem assistente; `null` = no contrato (Corporativo). */
  incluidas: number | null
  /** Pacotes que entraram neste mês. */
  pacotes: number
  /** O que os pacotes do mês custaram (há dois tamanhos). */
  valorPacotes?: number
  /** Franquia + pacotes. `null` = sem número de tabela. */
  total: number | null
  /** Respostas que já saíram no período. */
  usadas: number
  /** O que falta. `null` = sem número de tabela. */
  restam: number | null
  acabou: boolean
  /** Perto do fim: 10% ou menos do total. */
  baixo: boolean
  /** 'mes' = mês de calendário em São Paulo; 'teste' = o teste inteiro. */
  periodo: 'mes' | 'teste'
  desde: Date
  /** Quando a franquia volta: o dia 1º do mês que vem. `null` no teste. */
  renovaEm: Date | null
}

/** A franquia do período, pelo plano, pelas lojas de venda e pela situação. Pura. */
export function franquiaDeRespostas(plano: Plano, situacao: Situacao, lojas = 1): number | null {
  const doPlano = respostasDoPlano(plano, lojas)
  if (!doPlano) return doPlano
  return situacao === 'TESTE' ? Math.min(doPlano, PRECOS.respostasDoTeste) : doPlano
}

/** A conta, sem banco: franquia, pacotes e o que já foi usado. */
export function contaDeRespostas(
  incluidas: number | null,
  pacotes: number,
  usadas: number,
  /** As respostas que os pacotes do mês trouxeram (há dois tamanhos). */
  dosPacotes = pacotes * PRECOS.pacoteRespostas,
): Pick<Respostas, 'incluidas' | 'pacotes' | 'total' | 'usadas' | 'restam' | 'acabou' | 'baixo'> {
  if (incluidas === null) {
    return { incluidas, pacotes, total: null, usadas, restam: null, acabou: false, baixo: false }
  }
  const total = incluidas + dosPacotes
  const restam = Math.max(0, total - usadas)
  return {
    incluidas,
    pacotes,
    total,
    usadas,
    restam,
    // Sem assistente (total zero) não "acabou" nada: não havia o que acabar.
    acabou: total > 0 && restam === 0,
    baixo: total > 0 && restam > 0 && restam <= Math.ceil(total / 10),
  }
}

/**
 * O aviso que vai no fim da resposta quando ela cruza uma marca: quando
 * sobram 10% do total, e na última. Uma vez cada — é igualdade, não "menor
 * que", e a contagem só anda para a frente. `restam` é o que sobra DEPOIS
 * desta resposta.
 */
export function avisoDeRespostas(
  restam: number | null,
  total: number | null,
  periodo: Respostas['periodo'],
): string | null {
  if (restam === null || !total) return null
  if (restam === 0) {
    return periodo === 'teste'
      ? 'Esta foi a última resposta do teste. Para continuar, assine em Assinatura.'
      : `Esta foi a última resposta do mês. Para continuar, compre um pacote de respostas em Assinatura — ou espere o dia 1º.`
  }
  if (restam === Math.ceil(total / 10)) {
    return `Faltam ${milhar(restam)} respostas ${periodo === 'teste' ? 'no teste' : 'este mês'}.`
  }
  return null
}

/** O recado de quando as respostas acabaram — o mesmo na tela e no WhatsApp. */
export function recadoSemRespostas(periodo: Respostas['periodo']): string {
  return periodo === 'teste'
    ? 'As respostas do teste acabaram. Para continuar com o assistente, assine em Assinatura.'
    : 'As respostas do mês acabaram — compre um pacote de respostas em Assinatura ou espere o dia 1º.'
}

/** As respostas de uma empresa agora. Só lê. */
export async function respostasDoMes(orgId: string, agora = new Date()): Promise<Respostas> {
  const mes = mesEmSP(agora)
  return comoOrg(orgId, async (db) => {
    // Em sequência: dentro do comoOrg é uma conexão só.
    const org = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { plano: true, situacao: true, criadaEm: true },
    })
    const emTeste = org.situacao === 'TESTE'
    // No teste, desde que a empresa nasceu (o teste começa no cadastro); fora
    // dele, desde o dia 1º. No mês em que o teste vira assinatura, o que foi
    // usado no teste naquele mês conta — no máximo as respostas do teste.
    const desde = emTeste ? org.criadaEm : inicioDoMesEmSP(agora)
    const usadas = await db.mensagemAgente.count({ where: { respostaIa: true, criadaEm: { gte: desde } } })
    const pacotes = await db.recargaIA.findMany({
      where: { origem: 'pacote', referencia: { startsWith: `respostas:${mes}` }, centavos: { gt: 0 } },
      select: { referencia: true },
    })
    const lojas = await lojasDeVenda(db)
    const dosPacotes = pacotes.reduce((t, x) => t + respostasDaReferencia(x.referencia), 0)
    const valorPacotes = somar(...pacotes.map((x) => precoDoPacote(respostasDaReferencia(x.referencia))))
    return {
      valorPacotes,
      ...contaDeRespostas(franquiaDeRespostas(org.plano, org.situacao, lojas), pacotes.length, usadas, dosPacotes),
      periodo: emTeste ? 'teste' : 'mes',
      desde,
      renovaEm: emTeste ? null : proximoMesEmSP(agora),
    }
  })
}

/**
 * Soma um pacote de respostas ao mês: +`PRECOS.pacoteRespostas` na franquia
 * e o teto dele na carteira, na mesma transação, com a linha no livro.
 *
 * Quem chama: a equipe atendendo o pedido pago (ferramenta de operação), a
 * tela no modo livre e, no futuro, o retorno do gateway. O pacote vale para o
 * mês em que entrou (ver planos.ts). `pedidoId` fecha o pedido da loja
 * (pedidos.ts).
 */
export async function adicionarPacoteDeRespostas(
  orgId: string,
  por: { quem: string; autor: 'PESSOA' | 'SISTEMA'; usuarioId?: string | null; pedidoId?: string | null; pacote?: Pacote },
  agora = new Date(),
): Promise<Respostas> {
  const pac = PACOTES[por.pacote ?? 'pequeno']
  const mes = mesEmSP(agora)
  const [ano, m] = mes.split('-')
  // Ler antes, fora da transação de escrita: estourar DENTRO dela aborta a
  // transação, e no banco local a conexão fica inutilizável.
  const org = await comoOrg(orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true, situacao: true } }),
  )
  if (!PLANOS[org.plano].respostasMes) {
    throw new Error('Pacote de respostas é para quem tem o assistente ligado (o Corporativo é pelo contrato).')
  }
  if (org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') {
    throw new Error('A empresa está suspensa ou cancelada: o pacote não entra.')
  }
  // O teto do mês cai ANTES do pacote: senão o primeiro olhar do mês, depois
  // do pacote, veria a carteira acima do teto e não completaria nada — e o
  // pacote viraria só a franquia do mês.
  await garantirCreditoDoMes(orgId, agora)
  await comoOrg(orgId, async (db) => {
    const saldo = await creditarNaTransacao(db, orgId, tetoDoPacoteCent(por.pacote ?? 'pequeno'), {
      tipo: 'COMPRA',
      origem: 'pacote',
      // O tamanho no fim: há dois pacotes (ver `respostasDaReferencia`).
      referencia: `respostas:${mes}:${pac.respostas}`,
      motivo: `Pacote de +${milhar(pac.respostas)} respostas — ${m}/${ano}`,
      quem: por.quem,
    })
    await db.auditoria.create({
      data: {
        orgId,
        usuarioId: por.usuarioId ?? null,
        quem: por.quem,
        autor: por.autor,
        acao: 'respostas.adicionou',
        alvoTipo: 'empresa',
        alvoId: orgId,
        alvoNome: `+${milhar(pac.respostas)} respostas`,
        valor: pac.preco,
        motivo: `Pacote de +${milhar(pac.respostas)} respostas para ${m}/${ano}`,
        depois: {
          mes,
          respostas: pac.respostas,
          saldoDepois: saldo,
          ...(por.pedidoId ? { pedidoId: por.pedidoId } : {}),
        },
      },
    })
  })
  return respostasDoMes(orgId, agora)
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
export async function assinaturaDaEmpresa(orgId: string, agora = new Date()): Promise<Assinatura> {
  await vencerTesteSeAcabou(orgId, agora)
  await garantirCreditoDoMes(orgId, agora)
  // Fora do comoOrg de baixo: é outra transação, e transação dentro de
  // transação não existe aqui.
  const respostas = await respostasDoMes(orgId, agora)
  return comoOrg(orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        plano: true, situacao: true, testeAte: true,
        creditoIaCent: true, modulos: true, farolMarcas: true,
      },
    })

    // Só unidade ATIVA conta cota. Desativar é o caminho legítimo para
    // caber num plano menor, e ele precisa funcionar. E só LOJA: o depósito
    // não vende e não entra na conta (tabela de 02/10/2026) — menos no
    // Grátis, que é de uma unidade só, seja ela qual for.
    const unidades = await db.unidade.count({
      where: { ativa: true, ...(org.plano === 'GRATIS' ? {} : { ehDeposito: false }) },
    })
    // Cota é de ACESSO, não de cadastro: quem saiu da empresa continua no
    // banco por causa do histórico e não pode ocupar vaga.
    // O acesso do NOSSO suporte não é gente da loja: a conta de suporte
    // existe na empresa (é assim que o livro diz quem olhou), mas não entra
    // na conta de "pessoas cadastradas" que a loja lê.
    const usuarios = await db.usuario.count({
      where: { ativo: true, acessos: { some: { papel: { not: 'SUPORTE' } } } },
    })
    // A fábrica é uma parcela só (PRECOS.fabrica), com qualquer número de
    // unidades de fábrica; a contagem é para a tela dizer quantas.
    const fabricas = await db.unidade.count({ where: { ativa: true, ehFabrica: true } })
    // E o Farol, pelas marcas CONTRATADAS (não pelas cadastradas: o teto de
    // cadastro é este mesmo número — ver farol.ts).
    const farolMarcas = moduloLigado(org, 'farol') ? org.farolMarcas : 0

    const p = PLANOS[org.plano]
    const uso: Uso = { unidades, usuarios, fabricas, farolMarcas }
    const saldoCent = org.creditoIaCent
    // A trava de custo segurou o assistente antes de as respostas acabarem.
    // `respostasMes` nulo é o Corporativo: lá a carteira É o limite, posta
    // pela equipe conforme o contrato.
    const credito = { saldoCent, travou: p.respostasMes !== 0 && saldoCent <= 0 && !respostas.acabou }

    const testeAte = org.testeAte
    const diasDeTeste = testeAte
      ? Math.ceil((testeAte.getTime() - agora.getTime()) / DIA)
      : null

    const alertas: Assinatura['alertas'] = []

    // Só a reta final vira aviso: os dias que faltam e o que acontece depois já
    // estão no quadro do teste, no alto da tela (assinatura/page.tsx). Aviso
    // amarelo durante trinta dias seguidos deixa de ser lido no terceiro.
    if (org.situacao === 'TESTE' && diasDeTeste !== null && diasDeTeste <= 3) {
      alertas.push({
        nivel: 'critico',
        texto: diasDeTeste <= 0 ? 'O teste acaba hoje.' : `O teste acaba em ${plural(diasDeTeste, 'dia', 'dias')}.`,
      })
    }
    // O teste acabou há pouco: a loja precisa saber por que o menu encolheu.
    if (
      org.situacao !== 'TESTE' &&
      org.plano === 'GRATIS' &&
      testeAte !== null &&
      testeAte.getTime() <= agora.getTime() &&
      agora.getTime() - testeAte.getTime() < 30 * DIA
    ) {
      alertas.push({
        nivel: 'atencao',
        texto: `O teste acabou em ${mostrarDia(testeAte)} e a empresa voltou para o plano ${PLANOS.GRATIS.titulo}. Os dados continuam todos aqui; para religar o que desligou, assine o ${PLANOS.BALCAO.titulo} abaixo.`,
      })
    }
    if (org.situacao === 'INADIMPLENTE') {
      alertas.push({
        nivel: 'critico',
        texto: 'Há uma mensalidade em aberto. O acesso continua enquanto resolvemos.',
      })
    }
    if (respostas.acabou) {
      alertas.push({ nivel: 'critico', texto: `${recadoSemRespostas(respostas.periodo)} O assistente parou de responder.` })
    } else if (credito.travou) {
      alertas.push({
        nivel: 'critico',
        texto:
          p.respostasMes === null
            ? 'O crédito de IA do contrato acabou e o assistente parou de responder. Fale com a gente para repor.'
            : 'O assistente chegou ao limite de uso deste mês — respostas muito longas gastam mais. Compre um pacote de respostas abaixo ou espere o dia 1º.',
      })
    } else if (respostas.baixo && respostas.restam !== null) {
      alertas.push({
        nivel: 'atencao',
        texto: `Faltam ${milhar(respostas.restam)} respostas ${respostas.periodo === 'teste' ? 'no teste' : 'este mês'}.`,
      })
    }
    // Uso acima da cota acontece de verdade: o plano pode ter sido rebaixado
    // por um gateway, ou o limite pode ter mudado depois da venda. Plano que
    // cobra loja a mais não tem "acima da cota" — a conta é que cresce, e ela
    // já está na tela.
    if (p.unidades !== null && p.porUnidadeExtra === null && unidades > p.unidades) {
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
      mensal: mensalidade(org.plano, unidades, fabricas, farolMarcas),
      respostas,
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
export const assinaturaLivre = () => {
  if (process.env.NORTE_ASSINATURA_LIVRE !== '1') return false
  // Em produção, nunca: a variável esquecida no painel da hospedagem daria
  // plano e crédito de graça a qualquer dono que clicasse.
  if (process.env.NODE_ENV === 'production') {
    avisarLivreIgnorada()
    return false
  }
  return true
}

let avisouLivre = false
function avisarLivreIgnorada() {
  if (avisouLivre) return
  avisouLivre = true
  console.error('[assinatura] NORTE_ASSINATURA_LIVRE=1 em produção: IGNORADA. Tire a variável do ambiente.')
}

/**
 * Registra o pedido no livro da empresa e no log do servidor, onde a gente lê.
 *
 * Dois pedidos existem: o de plano (assinar, ligar o assistente) e o de
 * pacote de respostas. O antigo pedido de "R$ X de crédito de IA" saiu com o
 * modelo de 02/10/2026 — os que já estão no livro continuam legíveis
 * (pedidos.ts), mas a loja não pede mais dinheiro de IA: pede respostas.
 */
export async function registrarPedido(
  sessao: Sessao,
  pedido: { tipo: 'plano'; para: Plano } | { tipo: 'respostas'; pacote?: Pacote },
) {
  exigir(sessao, 'empresa.configurar')
  exigirQueNaoSejaSuporte(sessao, 'mexe na Assinatura')
  const pac = PACOTES[pedido.tipo === 'respostas' ? (pedido.pacote ?? 'pequeno') : 'pequeno']
  const pacote = `+${milhar(pac.respostas)} respostas`
  const texto =
    pedido.tipo === 'plano'
      ? `Pediu o plano ${PLANOS[pedido.para].titulo}`
      : `Pediu um pacote de ${pacote} (${mostrar(Math.round(pac.preco * 100))})`
  await comoOrg(sessao.orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: pedido.tipo === 'plano' ? 'plano.pediu' : 'respostas.pediu',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        alvoNome: pedido.tipo === 'plano' ? PLANOS[pedido.para].titulo : pacote,
        motivo: texto,
        // O que foi pedido, em forma de máquina. O título acima é para gente
        // ler; a equipe atende pelo que está aqui (src/servidor/pedidos.ts) —
        // e título de plano muda de nome.
        depois:
          pedido.tipo === 'plano'
            ? { plano: pedido.para }
            : { respostas: pac.respostas, preco: pac.preco },
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
  const { plano, unidades, fabricas, farolMarcas } = await comoOrg(orgId, async (db) => {
    // Em sequência: dentro do comoOrg é uma conexão só.
    const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true, modulos: true, farolMarcas: true } })
    // Só loja ATIVA conta, e depósito fora — como em `assinaturaDaEmpresa`.
    const unidades = await db.unidade.count({ where: { ativa: true, ehDeposito: false } })
    // A fábrica e o Farol também estão na conta: a prévia que os deixava de
    // fora mostrava um valor menor que o da fatura.
    const fabricas = await db.unidade.count({ where: { ativa: true, ehFabrica: true } })
    return { plano: org.plano, unidades, fabricas, farolMarcas: moduloLigado(org, 'farol') ? org.farolMarcas : 0 }
  })
  return mudanca(plano, para, { unidades, fabricas, farolMarcas })
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
  // Subindo (ou de lado), o teto do mês cai ANTES, no plano de hoje — era o
  // que a troca já fazia. DESCENDO, não: completar a carteira do assistente
  // no dia de desligá-lo dava o mês inteiro de IA a quem acabou de deixar de
  // pagar por ela (Rede → Grátis no dia 1º levava o mês inteiro). Se o mês
  // ainda não recebeu nada, o plano novo completa o dele na próxima vez que a
  // assinatura for olhada.
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
  exigirQueNaoSejaSuporte(sessao, 'mexe na Assinatura')
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
  const m = await aplicarTroca(orgId, para, {
    usuarioId: null,
    quem: quemDaEquipe(quem),
    autor: 'SISTEMA',
    pedidoId: opcoes.pedidoId ?? null,
  })
  // A equipe aplicando um plano PAGO a quem está em teste é a assinatura
  // confirmada: o teste acaba ali, e a empresa fica ATIVA — senão o prazo do
  // teste venceria depois e desceria para o Grátis quem já pagou.
  if (PLANOS[para].mensal !== 0) {
    const virou = await comoOrg(orgId, (db) =>
      db.org.updateMany({ where: { id: orgId, situacao: 'TESTE' }, data: { situacao: 'ATIVA' } }),
    )
    if (virou.count > 0) await completarCreditoDaConversao(orgId)
  }
  return m
}

/**
 * Quem assina no mês em que testou já teve, naquele mês, o teto do TESTE — e
 * o recibo do mês (`plano:AAAA-MM`) não cai de novo. Pagava o assistente
 * cheio e ficava com a trava do teste até o mês seguinte (e as respostas
 * paravam bem antes das 1.000). Aqui completa a carteira até o teto do mês,
 * uma vez (`:conversao`).
 */
export async function completarCreditoDaConversao(orgId: string, agora = new Date()): Promise<number> {
  const mes = mesEmSP(agora)
  const referencia = `plano:${mes}:conversao`
  return comoOrg(orgId, async (db) => {
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`credito-do-mes:${orgId}`}))`
    const org = await db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { plano: true, situacao: true, creditoIaCent: true },
    })
    if (!PLANOS[org.plano].respostasMes || org.situacao !== 'ATIVA') return 0
    if (await db.recargaIA.findFirst({ where: { tipo: 'PLANO', referencia }, select: { id: true } })) return 0
    // Sem recibo do mês ainda: o normal (`garantirCreditoDoMes`) cuida, já
    // com o teto cheio.
    const doMes = await db.recargaIA.findFirst({
      where: { tipo: 'PLANO', origem: 'plano', referencia: `plano:${mes}` },
      select: { id: true },
    })
    if (!doMes) return 0
    const falta = tetoDoMesCent(org.plano, await lojasDeVenda(db)) - org.creditoIaCent
    if (falta <= 0) return 0
    const [ano, m] = mes.split('-')
    await creditarNaTransacao(db, orgId, falta, {
      tipo: 'PLANO',
      origem: 'plano',
      referencia,
      motivo: `Teto de IA do mês, ${PLANOS[org.plano].titulo}, completando o do teste — ${m}/${ano}`,
      quem: 'Norte',
    })
    return falta
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

  // A carteira perto do fim é o sinal barato de "o assistente vai parar": a
  // contagem de respostas é uma consulta a mais, e esta função é uma leitura
  // só (a tela da Assinatura conta de verdade).
  const semCredito = p.respostasMes !== 0 && org.creditoIaCent <= org.creditoAvisoCent
  const testeAcabando =
    org.situacao === 'TESTE' &&
    org.testeAte !== null &&
    org.testeAte.getTime() - Date.now() < 5 * DIA
  const cobrancaAberta = org.situacao === 'INADIMPLENTE' || org.situacao === 'SUSPENSA'

  return { titulo: p.titulo, alerta: semCredito || testeAcabando || cobrancaAberta }
}
