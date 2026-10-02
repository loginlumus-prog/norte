// Registrar uma venda.
//
// É a operação mais delicada do sistema, porque toca três coisas ao mesmo
// tempo: o estoque baixa, a venda nasce, o dinheiro entra. Ou os três
// acontecem, ou nenhum acontece. Meio-termo aqui significa estoque baixado
// sem venda registrada — mercadoria que sumiu do sistema e continua na
// prateleira, ou o contrário.
//
// Por isso tudo mora numa transação só, e por isso o estoque é movido por
// `mexerEstoqueEm` (que entra na transação de quem chama) em vez de
// `mexerEstoque` (que abriria a sua própria).
//
// ── três decisões que parecem detalhe ────────────────────────
//
// 1. O item guarda FOTOGRAFIA de nome, preço e custo. Renomear um produto ou
//    mudar o preço não pode reescrever a venda de março, senão o relatório de
//    um mês fechado muda sozinho.
//
// 2. O número da venda vem de um contador no banco, não de `max(numero)+1`.
//    Duas vendas simultâneas leriam o mesmo máximo e brigariam pelo mesmo
//    número.
//
// 3. Falta de estoque é conferida ANTES de qualquer escrita. Assim a recusa
//    é uma saída limpa, não uma transação abortada no meio.
//
// ── e uma que é de segurança, não de contabilidade ───────────
//
// 4. O PREÇO DE TABELA VEM DO BANCO, SEMPRE. O `precoUnit` que chega do
//    navegador é PEDIDO, não ordem. Esta função é uma Server Action disfarçada
//    de função: qualquer pessoa com login monta a chamada na mão. Sem teto,
//    quem opera o balcão vende a peça de R$ 500 por um centavo, o pagamento
//    "fecha" (porque bate com o total que ela mesma inventou), o estoque baixa
//    certinho e o relatório do mês nunca acusa nada — só a margem despenca e
//    ninguém sabe por quê.
//
//    A diferença entre a tabela e o cobrado é DESCONTO, e desconto tem teto:
//    o da empresa (`descontoMaximo`) para quem opera, e `venda.desconto` para
//    quem passa dele — ou o PIN de quem tem `venda.desconto`, digitado na hora
//    no balcão de quem vende (ver autorizacao.ts). A venda guarda quem
//    autorizou.

import { vendidoNaLoja } from './catalogo-loja'
import { comoOrg, type BancoDaOrg } from './banco'
import type { Prisma, SituacaoVenda } from '@prisma/client'
import { exigir, numeroDaBusca, pode, textoDaBusca, type Sessao } from './permissao'
import { SELECT_ACESSO, acessosDoBanco } from './cargos'
import { mexerEstoqueEm } from './estoque'
import { centavos, reais, multiplicar, mostrar } from './dinheiro'
import { tabelaDe, precoNaTabela, ROTULO_TABELA, type Tabela } from './preco'
import { normalizarCodigo, pedeInteiro, travarVenda, venceu } from './devolucao'
import { agendaDoCrediario, primeiroVencimentoPadrao, problemaDoPrimeiroVencimento } from './crediario-agenda'
import { assinarExcecao, autorizarComPin } from './autorizacao'
import { maquininhaDoPagamento, maquininhasNoBanco } from './maquininhas'
import { cpfValido } from './cliente'
import { travarCaixaAberto } from './caixa'
import { codigoEncomenda, entregarPelaVenda, travarParaVenda } from './encomenda'
import { lerTaxas, taxaDe, ROTULO_FORMA } from './taxas'
import {
  programaNoPlano,
  conferirUso,
  pontosGanhos as calcularGanho,
  RECADO_PONTOS,
  DESLIGADO,
} from './pontos'
import type { FormaPagamento } from '@prisma/client'
import { PLANOS, planoLibera } from './planos'
import { diaEmSP, inicioDoDiaEmSP, primeiroDoMes } from './dia'
import { plural } from './texto'

export type ItemDaVenda = {
  /** Nulo = item avulso, fora do catálogo. Aí `avulso` é obrigatório. */
  variacaoId: string | null
  quantidade: number
  /** Se não vier, usa o preço do produto conforme a forma de pagamento. */
  precoUnit?: number
  desconto?: number
  /**
   * Item que não existe no cadastro: um conserto, uma peça que ninguém
   * cadastrou, um serviço. Não mexe em estoque. Preço digitado na hora é o
   * mesmo buraco que desconto sem teto, e leva a mesma trava: quem pode
   * passar do teto lança; quem não pode, lança com o PIN de quem pode.
   */
  avulso?: { descricao: string; precoUnit: number }
}

export type PagamentoDaVenda = {
  forma: FormaPagamento
  /**
   * O que este pagamento cobre da venda. No crédito parcelado com juro, o
   * juro é somado AQUI no servidor (ver `creditoJurosPct`) — a tela manda o
   * valor sem ele.
   */
  valor: number
  parcelas?: number
  referencia?: string
  /** Em qual maquininha caiu (Pix, débito, crédito). Ver maquininhas.ts. */
  maquininha?: string | null
  /** Crediário: o dia do 1º vencimento ('AAAA-MM-DD'). Sem vir, hoje + o intervalo da loja. */
  primeiroVencimento?: string | null
}

export type NovaVenda = {
  unidadeId: string
  caixaId?: string | null
  clienteId?: string | null
  /**
   * Quem vendeu, quando não é quem está no caixa. É o que faz meta e comissão
   * existirem: a vendedora atende no salão, a caixa registra. Sem vir, é a
   * própria pessoa da sessão. Conferido no servidor: precisa ser gente ativa
   * da empresa, com acesso de venda NESTA unidade.
   */
  vendedorId?: string | null
  /** Pontos que o cliente quer gastar nesta venda. Confere no servidor. */
  pontosUsar?: number
  itens: ItemDaVenda[]
  pagamentos: PagamentoDaVenda[]
  /** Desconto sobre o total da venda, além dos descontos por item. */
  desconto?: number
  /**
   * Acréscimo sobre o total: a peça saiu da promoção e a etiqueta ficou com
   * o preço velho. Entra no total, nos pontos e no livro.
   */
  acrescimo?: number
  /**
   * O PIN de quem autoriza o que passa da regra (desconto acima do teto,
   * item avulso), digitado no balcão. Conferido aqui, nunca guardado.
   */
  autorizacao?: { pin: string } | null
  /**
   * O CPF que a cliente ditou no crediário, quando a ficha não tem. Vai para
   * a ficha na mesma transação da venda (só se a ficha estiver sem CPF).
   */
  clienteCpf?: string | null
  observacoes?: string
  /**
   * O horário da agenda que esta venda cobra ("Atender e cobrar"). A venda
   * carimba o horário como atendido e guarda o próprio id nele — na mesma
   * transação, e só se ninguém cobrou antes (ver agenda.ts).
   */
  agendamentoId?: string | null
  /**
   * A encomenda que esta venda recebe ("Receber no balcão"). O servidor lança
   * sozinho a linha do que FALTA pagar — valor lido da encomenda, nunca do
   * navegador — e marca a encomenda entregue na mesma transação.
   */
  encomendaId?: string | null
  /**
   * O troco que a gaveta devolveu (o entregue menos o que ficou). Não é
   * pagamento — o DINHEIRO que chega aqui já é o que ficou —, mas o
   * comprovante e a ficha mostram "recebeu R$ 100, troco R$ 17". Sem coluna
   * própria na venda, vai no livro da venda (`venda.registrou`, em `depois`),
   * e `acharVenda` lê de lá. Só vale com dinheiro na venda.
   */
  troco?: number
  /**
   * A chave que o balcão gerou para esta venda (ver `Venda.chave`). Com ela,
   * mandar de novo a mesma venda devolve a que já entrou, sem gravar outra.
   */
  chave?: string | null
  /**
   * A venda aconteceu SEM INTERNET e está subindo agora, da fila do aparelho.
   * `quando` é a hora em que ela aconteceu de verdade. A peça já saiu da loja
   * e o dinheiro já está na gaveta: o estoque não trava (fica negativo, como
   * em "vender sem estoque"), e se o turno de caixa em que ela aconteceu já
   * fechou, ela entra no caixa aberto da loja. Desconto, PIN, preço e o resto
   * seguem a mesma régua de sempre — offline não é atalho.
   */
  offline?: { quando: Date } | null
}

export type ResultadoVenda =
  | {
      ok: true
      vendaId: string
      numero: number
      total: number
      pontosUsados: number
      pontosGanhos: number
      /** O que saiu sem o sistema ter estoque: vai para "Vendido sem estoque — conferir". */
      semEstoque: string[]
      /** Quem autorizou com o PIN, quando foi preciso. */
      autorizadoPor: string | null
    }
  | { ok: false; motivo: 'sem_itens' }
  | { ok: false; motivo: 'sem_estoque'; faltando: { descricao: string; pedido: number; tem: number }[] }
  | { ok: false; motivo: 'pagamento_nao_fecha'; total: number; pago: number }
  | { ok: false; motivo: 'caixa_fechado' }
  | { ok: false; motivo: 'desconto_acima_do_teto'; percentual: number; teto: number }
  /** O PIN digitado não autorizou (errado, de quem não pode, ou freio). Nada foi gravado. */
  | { ok: false; motivo: 'autorizacao_recusada'; recado: string }
  /** Parcelas do crédito, maquininha ou acréscimo fora do que a loja aceita. */
  | { ok: false; motivo: 'pagamento_recusado'; recado: string }
  | { ok: false; motivo: 'pontos_recusados'; recado: string }
  | { ok: false; motivo: 'avulso_negado' }
  | { ok: false; motivo: 'vendedor_invalido' }
  | { ok: false; motivo: 'vale_recusado'; recado: string }
  | { ok: false; motivo: 'crediario_recusado'; recado: string }
  /** Produto que não é vendido nesta loja — ver `catalogo-loja.ts`. */
  | { ok: false; motivo: 'fora_da_loja'; itens: string[] }
  /** Material de uso (a luva, a acetona): tem estoque, não se vende. */
  | { ok: false; motivo: 'uso_interno'; itens: string[] }
  /** O plano tem teto de vendas no mês (o Grátis) e ele foi alcançado. */
  | { ok: false; motivo: 'teto_do_plano'; recado: string }
  /** Depósito ou loja desativada: ali não se vende. */
  | { ok: false; motivo: 'loja_nao_vende' }
  /** Produto ou variação desativados no cadastro depois de entrarem no pedido. */
  | { ok: false; motivo: 'item_inativo'; itens: string[] }
  /** Peça, par ou caixa com quantidade quebrada (1,5 camiseta). */
  | { ok: false; motivo: 'quantidade_fracionada'; itens: string[] }
  /** A encomenda não pode ser recebida (já entregue, de outra loja, sem saldo). */
  | { ok: false; motivo: 'encomenda_recusada'; recado: string }
  /** O horário da agenda já foi cobrado (outra aba, outro caixa) ou não está mais de pé. */
  | { ok: false; motivo: 'agendamento_recusado'; recado: string }

/** Troco acima disto é dedo errado (R$ 5.000 de troco não sai de gaveta de loja). */
const TETO_DO_TROCO_CENT = 500_000

export async function registrarVenda(
  sessao: Sessao,
  pedido: NovaVenda,
  /**
   * A troca (troca.ts): a venda nasce DENTRO da transação que já devolveu a
   * peça — ou as duas acontecem, ou nenhuma. O PIN, quando a troca pediu,
   * já foi conferido lá fora (a conferência abre transação própria, e
   * transação não aninha): vem pronto em `autorizador`. Sem isto, a venda
   * abre a própria transação, como sempre.
   */
  dentro?: { db: BancoDaOrg; autorizador: { usuarioId: string; nome: string } | null },
): Promise<ResultadoVenda> {
  exigir(sessao, 'venda.criar', pedido.unidadeId)

  // ── a forma do que chegou ──
  // Quantidade que não é número positivo não é item: `NaN < saldo` é falso e
  // passava pela conferência de estoque; quantidade negativa virava desconto
  // escondido (o item "devolvia" dinheiro dentro da própria venda). Desconto
  // negativo é o contrário — cobrança acima da etiqueta — e vira zero: o
  // pagamento deixa de fechar e a tela mostra o total certo.
  if (pedido.itens.some((i) => !Number.isFinite(i.quantidade) || i.quantidade <= 0)) {
    return { ok: false, motivo: 'sem_itens' }
  }
  // Pagamento negativo seria dinheiro SAINDO da gaveta dentro de uma venda.
  // Zero não é pagamento (sobra do troco): sai da lista em vez de virar uma
  // linha de R$ 0 — ou um crediário de zero parcelas.
  if (pedido.pagamentos.some((p) => !Number.isFinite(p.valor) || p.valor < 0)) {
    return { ok: false, motivo: 'pagamento_nao_fecha', total: 0, pago: 0 }
  }
  // A chave vem do navegador: só letras, números e hífen, de tamanho de uuid.
  const chave = typeof pedido.chave === 'string' && /^[\w-]{8,64}$/.test(pedido.chave) ? pedido.chave : null
  // A hora de quando estava sem internet: nem no futuro, nem de mais de 7 dias.
  const quando = pedido.offline?.quando instanceof Date && Number.isFinite(pedido.offline.quando.getTime())
    ? new Date(Math.min(pedido.offline.quando.getTime(), Date.now()))
    : null
  const offline = quando && Date.now() - quando.getTime() <= 7 * 864e5 ? { quando } : null
  const v: NovaVenda = {
    ...pedido,
    chave,
    offline,
    desconto: Math.max(0, pedido.desconto ?? 0),
    acrescimo: Number.isFinite(pedido.acrescimo) ? Math.max(0, pedido.acrescimo ?? 0) : 0,
    itens: pedido.itens.map((i) => (i.desconto !== undefined ? { ...i, desconto: Math.max(0, i.desconto) } : i)),
    pagamentos: pedido.pagamentos.filter((p) => centavos(p.valor) > 0),
  }

  if (v.itens.length === 0 && !v.encomendaId) return { ok: false, motivo: 'sem_itens' }

  // ── 0. item avulso é privilégio, não é atalho ──
  // Quem lança "Conserto — R$ 30" está inventando um preço. É exatamente o
  // que o teto de desconto existe para impedir, então a trava é a mesma —
  // `venda.desconto`, ou o PIN de quem o tem (lá embaixo, "a autorização").
  const avulsos = v.itens.filter((i) => !i.variacaoId)
  if (avulsos.length > 0) {
    for (const a of avulsos) {
      if (!a.avulso || !a.avulso.descricao.trim() || !(a.avulso.precoUnit >= 0) || !(a.quantidade > 0)) {
        return { ok: false, motivo: 'avulso_negado' }
      }
    }
    // O avulso é gravado como UN: conta-se, não se pesa.
    const quebrados = avulsos.filter((a) => !Number.isInteger(a.quantidade))
    if (quebrados.length > 0) {
      return { ok: false, motivo: 'quantidade_fracionada', itens: quebrados.map((a) => a.avulso!.descricao.trim()) }
    }
  }
  const doCatalogo = v.itens.filter((i): i is ItemDaVenda & { variacaoId: string } => !!i.variacaoId)

  // A forma de pagamento escolhe a tabela de preço. Decidido aqui, uma vez,
  // e usado em todo item — ver preco.ts.
  const tabela: Tabela = tabelaDe(v.pagamentos.map((p) => p.forma))

  // ── 0.0 a autorização, quando veio um PIN ──
  // ANTES da transação da venda: a conferência abre as próprias (o freio e o
  // livro), e transação não aninha. A tela só manda o PIN depois de o
  // servidor dizer que precisa (desconto acima do teto, avulso) — então o
  // livro de "autorizou" fala de um pedido de verdade. Quem já tem o poder
  // não precisa de PIN, e o PIN que veio à toa é ignorado.
  let autorizador: { usuarioId: string; nome: string } | null = dentro?.autorizador ?? null
  const temPoder = pode(sessao, 'venda.desconto', v.unidadeId)
  if (!temPoder && v.autorizacao?.pin && !dentro) {
    const pedidoDe = [
      avulsos.length > 0 ? plural(avulsos.length, 'item avulso', 'itens avulsos') : null,
      (v.desconto ?? 0) > 0 || v.itens.some((i) => (i.desconto ?? 0) > 0 || i.precoUnit != null)
        ? `desconto${(v.desconto ?? 0) > 0 ? ` de ${mostrar(centavos(v.desconto ?? 0))}` : ''} acima do teto`
        : null,
    ].filter(Boolean)
    const r = await autorizarComPin({
      orgId: sessao.orgId,
      unidadeId: v.unidadeId,
      pin: v.autorizacao.pin,
      capacidade: 'venda.desconto',
      motivo: `Venda no balcão: ${pedidoDe.join(' e ') || 'acima da regra'}`,
      quemPediu: { usuarioId: sessao.usuarioId, nome: sessao.nome },
    })
    if (!r.ok) return { ok: false, motivo: 'autorizacao_recusada', recado: r.erro }
    autorizador = r.autorizador
  }
  const podeDesconto = temPoder || !!autorizador
  if (avulsos.length > 0 && !podeDesconto) return { ok: false, motivo: 'avulso_negado' }

  const corpo = async (db: BancoDaOrg): Promise<ResultadoVenda> => {
    // ── 0.0 a mesma venda de novo ──
    // A chave é da empresa (único no banco): se ela já entrou, devolve a que
    // entrou. A trava da chave faz a segunda chamada ao mesmo tempo esperar a
    // primeira terminar, e aí achar a venda pronta.
    if (v.chave) {
      await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`venda-chave:${sessao.orgId}:${v.chave}`}))`
      const ja = await db.venda.findFirst({
        where: { chave: v.chave },
        select: { id: true, numero: true, total: true, pontosUsados: true, pontosGanhos: true, autorizadoPor: true },
      })
      if (ja) {
        return {
          ok: true as const,
          vendaId: ja.id,
          numero: ja.numero,
          total: Number(ja.total),
          pontosUsados: ja.pontosUsados,
          pontosGanhos: ja.pontosGanhos,
          semEstoque: [],
          autorizadoPor: ja.autorizadoPor,
        }
      }
    }
    const empresa = await db.org.findUnique({
      where: { id: sessao.orgId },
      select: {
        plano: true,
        descontoMaximo: true, modulos: true,
        pontosAtivo: true, pontosPorReal: true, pontoVale: true, pontosMinimo: true,
        crediarioMaxParcelas: true, crediarioDiasEntre: true,
        vendeSemEstoque: true, valePorLoja: true, creditoMaxParcelas: true, creditoJurosPct: true,
      },
    })
    // ── 0.01 onde se vende ──
    // O id da loja vem do navegador. Depósito guarda estoque e não tem
    // balcão; loja desativada fechou. Vender ali baixava estoque de onde
    // ninguém atende — e com um caixa aberto por engano, até em dinheiro.
    const loja = await db.unidade.findUnique({
      where: { id: v.unidadeId },
      select: { ativa: true, ehDeposito: true },
    })
    if (!loja || !loja.ativa || loja.ehDeposito) return { ok: false as const, motivo: 'loja_nao_vende' as const }

    const teto = Number(empresa?.descontoMaximo ?? 0)
    // Pontos são do plano pago (`RECURSOS`). Plano que não abre o programa não
    // pontua nem desconta, mesmo com o programa ligado de antes da troca.
    const programa = empresa ? programaNoPlano(empresa) : DESLIGADO

    // ── 0.05 o teto de vendas do plano ──
    // O Grátis é vendido com "até 300 vendas no mês" (`tetoVendasMes`), na
    // página e nos termos — e nada contava. Conta as vendas CONCLUÍDAS desde a
    // meia-noite do dia 1º em São Paulo; a cancelada não ocupa lugar.
    const tetoMes = empresa ? PLANOS[empresa.plano].tetoVendasMes : null
    if (tetoMes !== null) {
      const noMes = await db.venda.count({
        where: { situacao: 'CONCLUIDA', criadaEm: { gte: inicioDoDiaEmSP(primeiroDoMes(diaEmSP())) } },
      })
      if (noMes >= tetoMes) {
        return {
          ok: false as const,
          motivo: 'teto_do_plano' as const,
          recado:
            // Sem "veja em Assinatura": quem está no balcão quase nunca abre
            // aquela tela. A tela do balcão completa a frase — o link para
            // quem pode ver o plano, "fale com quem responde pela empresa"
            // para quem não pode.
            `O plano ${PLANOS[empresa!.plano].titulo} vai até ${tetoMes} vendas por mês, e este mês chegou lá. ` +
            `Para continuar vendendo hoje, o caminho é o plano ${PLANOS.BALCAO.titulo}.`,
        }
      }
    }

    // ── 0.15 o horário da agenda, se esta venda cobra um ──
    // Travado aqui (FOR UPDATE) e conferido antes de qualquer escrita: duas
    // abas cobrando o mesmo horário esperam uma pela outra, e a segunda acha
    // o horário já cobrado — em vez de o cliente pagar a manicure duas vezes.
    if (v.agendamentoId) {
      const [ag] = await db.$queryRaw<{ unidade_id: string; venda_id: string | null; situacao: string }[]>`
        select unidade_id, venda_id, situacao::text as situacao
          from agendamentos where id = ${v.agendamentoId} for update
      `
      if (!ag || ag.unidade_id !== v.unidadeId) {
        return { ok: false as const, motivo: 'agendamento_recusado' as const, recado: 'Esse horário não é desta loja. A venda pode ser feita sem ele.' }
      }
      if (ag.venda_id) {
        return { ok: false as const, motivo: 'agendamento_recusado' as const, recado: 'Esse horário já foi cobrado em outra venda. Confira em Vendas antes de cobrar de novo.' }
      }
      if (!['MARCADO', 'CONFIRMADO', 'ATENDIDO'].includes(ag.situacao)) {
        return { ok: false as const, motivo: 'agendamento_recusado' as const, recado: 'Esse horário foi desmarcado ou anotado como falta. Para cobrar assim mesmo, tire o horário da venda.' }
      }
    }

    // ── 0.16 a encomenda, se esta venda recebe uma ──
    // O valor da linha vem da encomenda, travada aqui — nunca do navegador.
    // Sem `venda.desconto`: não é preço inventado por quem opera, é o saldo
    // de um pedido que a loja já anotou (o avulso pede o poder porque o preço
    // dele é digitado na hora; este não é).
    let daEncomenda: { faltaC: number; linha: string } | null = null
    if (v.encomendaId) {
      const e = await travarParaVenda(db, empresa, v.encomendaId, v.unidadeId)
      if (!e.ok) return { ok: false as const, motivo: 'encomenda_recusada' as const, recado: e.recado }
      daEncomenda = e
    }

    // ── 0.2 crediário é módulo, e é dívida com nome ──
    // Sem o módulo, a forma não existe. Com ele, precisa de cliente — não há
    // para quem cobrar uma parcela sem nome — e cabe no máximo de vezes que
    // a loja decidiu.
    const fiado = v.pagamentos.filter((p) => p.forma === 'CREDIARIO')
    let primeiroVencimento: string | null = null
    if (fiado.length > 0) {
      // Módulo ligado E plano que abre: o módulo pode ter ficado ligado de
      // um plano anterior, e a lista de módulos já foi gravada sem conferir
      // plano — ver `comecar/acoes.ts`.
      if (!empresa?.modulos.includes('crediario') || !planoLibera(empresa.plano, 'crediario')) {
        return { ok: false as const, motivo: 'crediario_recusado' as const, recado: 'O crediário está desligado nesta empresa.' }
      }
      if (!v.clienteId) {
        return { ok: false as const, motivo: 'crediario_recusado' as const, recado: 'Venda no crediário precisa de cliente cadastrado.' }
      }
      if (fiado.length > 1) {
        return { ok: false as const, motivo: 'crediario_recusado' as const, recado: 'Só um lançamento de crediário por venda.' }
      }
      const n = fiado[0]!.parcelas ?? 1
      if (!Number.isInteger(n) || n < 1 || n > (empresa.crediarioMaxParcelas ?? 1)) {
        return {
          ok: false as const,
          motivo: 'crediario_recusado' as const,
          recado: `A loja parcela em até ${empresa.crediarioMaxParcelas}×.`,
        }
      }
      // O 1º vencimento vem da tela (a cliente que recebe dia 10 começa dia
      // 10); sem vir, hoje + o intervalo da loja. Conferido no calendário de
      // São Paulo — ver crediario-agenda.ts.
      const hoje = diaEmSP()
      const primeiro = fiado[0]!.primeiroVencimento || primeiroVencimentoPadrao(hoje, empresa.crediarioDiasEntre)
      const problema = problemaDoPrimeiroVencimento(primeiro, hoje, empresa.crediarioDiasEntre)
      if (problema) return { ok: false as const, motivo: 'crediario_recusado' as const, recado: problema }
      primeiroVencimento = primeiro
      if (v.clienteCpf && !cpfValido(v.clienteCpf)) {
        return { ok: false as const, motivo: 'crediario_recusado' as const, recado: 'Esse CPF não confere. Confira os números ou siga sem CPF.' }
      }
    }

    // ── 0.3 as formas, as vezes e a maquininha ──
    // Tudo vem do navegador. Parcela só existe no crédito (até o máximo da
    // loja) e no crediário (conferido acima); no resto, é 1. A maquininha
    // precisa ser uma DESTA loja que aceita a forma — senão o fechamento
    // ganharia uma maquininha que extrato nenhum confere.
    const maquininhas = await maquininhasNoBanco(db, v.unidadeId)
    const maquininhaDe: (string | null)[] = []
    for (const p of v.pagamentos) {
      if (p.forma === 'CREDITO') {
        const n = p.parcelas ?? 1
        const max = empresa?.creditoMaxParcelas ?? 1
        if (!Number.isInteger(n) || n < 1 || n > max) {
          return { ok: false as const, motivo: 'pagamento_recusado' as const, recado: `O crédito vai em até ${max}×.` }
        }
      }
      const m = maquininhaDoPagamento(maquininhas, p.forma, p.maquininha)
      if (!m.ok) {
        return {
          ok: false as const,
          motivo: 'pagamento_recusado' as const,
          recado: `A maquininha “${String(p.maquininha ?? '').slice(0, 40)}” não é desta loja para ${ROTULO_FORMA[p.forma] ?? p.forma}. Escolha de novo.`,
        }
      }
      maquininhaDe.push(m.nome)
    }

    // ── 0.1 quem vendeu ──
    // O id vem do navegador. Precisa ser gente ativa desta empresa, com
    // acesso de venda nesta unidade — senão a comissão do mês vai para um
    // nome que ninguém escolheu, ou para alguém que já saiu.
    let vendedor = { id: sessao.usuarioId, nome: sessao.nome }
    if (v.vendedorId && v.vendedorId !== sessao.usuarioId) {
      const agora = new Date()
      const pessoa = await db.usuario.findUnique({
        where: { id: v.vendedorId },
        select: {
          nome: true, ativo: true,
          acessos: { select: SELECT_ACESSO },
        },
      })
      // A mesma régua do balcão (`pode`): o cargo vende se marca "Vender".
      const podeVender =
        !!pessoa?.ativo &&
        pode({ orgId: sessao.orgId, usuarioId: v.vendedorId, nome: pessoa.nome, acessos: acessosDoBanco(pessoa.acessos) }, 'venda.criar', v.unidadeId, agora)
      if (!podeVender) return { ok: false as const, motivo: 'vendedor_invalido' as const }
      vendedor = { id: v.vendedorId, nome: pessoa!.nome }
    }

    // ── 1. o que está sendo vendido, com preço e custo de agora ──
    const variacoes = await db.variacao.findMany({
      where: { id: { in: doCatalogo.map((i) => i.variacaoId) } },
      select: {
        id: true, codigo: true, ajustePreco: true, ativa: true,
        produto: {
          select: {
            nome: true, medida: true, custo: true, ativo: true,
            precoVista: true, precoCartao: true, precoCrediario: true,
            vendidoEm: true, servico: true, usoInterno: true,
          },
        },
        opcoes: { select: { opcao: { select: { valor: true } } } },
      },
    })
    const porId = new Map(variacoes.map((x) => [x.id, x]))

    // ── 1a. só o que ainda está no cadastro ──
    // Produto desativado (ou a variação: a cor que saiu de linha) some da
    // busca e da grade — mas o pedido montado antes, o guardado no navegador
    // ou o POST na mão ainda o traziam, e a venda baixava estoque de uma peça
    // que a loja tirou de circulação. Variação que nem existe mais entra aqui
    // também, em vez de virar "item removido" sem preço.
    const inativos = [
      ...new Set(
        doCatalogo
          .filter((i) => {
            const x = porId.get(i.variacaoId)
            return !x || !x.ativa || !x.produto.ativo
          })
          .map((i) => descrever(porId.get(i.variacaoId))),
      ),
    ]
    if (inativos.length > 0) return { ok: false as const, motivo: 'item_inativo' as const, itens: inativos }

    // ── 1a'. peça se conta, quilo se pesa ──
    // `pedeInteiro`: UN, PAR e CX só em número inteiro. "1,5 camiseta"
    // deixava o estoque em 48,5 peças e abria a devolução de meia peça.
    const quebrados = [
      ...new Set(
        doCatalogo
          .filter((i) => pedeInteiro(porId.get(i.variacaoId)?.produto.medida) && !Number.isInteger(i.quantidade))
          .map((i) => descrever(porId.get(i.variacaoId))),
      ),
    ]
    if (quebrados.length > 0) return { ok: false as const, motivo: 'quantidade_fracionada' as const, itens: quebrados }

    // ── 1b. só o que ESTA loja vende ──
    // A tela do balcão já só mostra o catálogo da loja; esta conferência é a
    // que vale, porque a tela é do navegador e o navegador é do usuário. Sem
    // ela, um código de barras bipado de cabeça venderia picolé na loja de
    // roupa e baixaria estoque de um lugar onde ele não existe.
    const foraDaLoja = [
      ...new Set(
        doCatalogo
          .map((i) => porId.get(i.variacaoId))
          .filter((x): x is NonNullable<typeof x> => !!x && !vendidoNaLoja(x.produto.vendidoEm, v.unidadeId))
          .map((x) => descrever(x)),
      ),
    ]
    if (foraDaLoja.length > 0) return { ok: false as const, motivo: 'fora_da_loja' as const, itens: foraDaLoja }

    // ── 1c. material de uso não se vende ──
    // A grade e a busca do balcão já não o mostram (`aVendaNaLoja`); esta é a
    // trava que vale — o pedido guardado no navegador de antes de marcar o
    // produto, ou o POST na mão, venderiam a luva da clínica e baixariam o
    // estoque como venda, sumindo com ela do "Material usado".
    const deUso = [
      ...new Set(
        doCatalogo
          .map((i) => porId.get(i.variacaoId))
          .filter((x): x is NonNullable<typeof x> => !!x && x.produto.usoInterno)
          .map((x) => descrever(x)),
      ),
    ]
    if (deUso.length > 0) return { ok: false as const, motivo: 'uso_interno' as const, itens: deUso }

    // ── 2. estoque: confere TUDO antes de escrever qualquer coisa ──
    // Serviço não tem estoque: a manicure não "acaba". Fica fora da
    // conferência e da baixa (ver `mexerEstoqueEm`).
    const deEstoque = doCatalogo.filter((i) => !porId.get(i.variacaoId)?.produto.servico)
    const saldos = await db.estoque.findMany({
      where: { unidadeId: v.unidadeId, variacaoId: { in: deEstoque.map((i) => i.variacaoId) } },
      select: { variacaoId: true, quantidade: true },
    })
    const saldoDe = new Map(saldos.map((e) => [e.variacaoId, Number(e.quantidade)]))

    const faltando = deEstoque
      .filter((i) => (saldoDe.get(i.variacaoId) ?? 0) < i.quantidade)
      .map((i) => ({
        variacaoId: i.variacaoId,
        descricao: descrever(porId.get(i.variacaoId)),
        pedido: i.quantidade,
        tem: saldoDe.get(i.variacaoId) ?? 0,
      }))
    // A loja que liga "vender o que o sistema diz que acabou" (estoque
    // importado sem balanço, a peça achada no provador) não trava: a peça
    // está na mão da cliente, e o sistema é que está errado. A venda passa,
    // o saldo fica negativo, e o item leva o saldo que o sistema tinha — é a
    // pendência "vendeu 2, havia 1" que a gerente confere na prateleira.
    // A venda de quando estava sem internet já aconteceu: a peça saiu.
    const vendeSemEstoque = !!empresa?.vendeSemEstoque || !!v.offline
    if (faltando.length > 0 && !vendeSemEstoque) {
      return {
        ok: false as const,
        motivo: 'sem_estoque' as const,
        faltando: faltando.map(({ descricao, pedido, tem }) => ({ descricao, pedido, tem })),
      }
    }
    const saldoQueFaltou = new Map(faltando.map((f) => [f.variacaoId, f.tem]))

    // ── 3. as contas, em centavos inteiros ──
    // O preço vem do banco como decimal exato; ler o TEXTO dele (e não o
    // número) evita o erro de ponto flutuante antes que ele exista.
    const itens = v.itens.map((i) => {
      // Avulso: o preço É o que a pessoa digitou. A trava foi lá em cima,
      // na permissão; aqui ele entra como tabela dele mesmo, sem desconto.
      if (!i.variacaoId) {
        const precoCent = centavos(i.avulso!.precoUnit)
        const totalCent = multiplicar(precoCent, i.quantidade)
        return {
          variacaoId: null,
          descricao: i.avulso!.descricao.trim(),
          codigo: null,
          medida: 'UN' as const,
          quantidade: i.quantidade,
          precoUnit: reais(precoCent),
          desconto: 0,
          total: reais(totalCent),
          custoUnit: null,
          saldoNaVenda: null as number | null,
          _cent: totalCent,
          _tabelaCent: totalCent,
        }
      }

      const va = porId.get(i.variacaoId)
      // O preço de tabela é do banco, NA TABELA DA FORMA DE PAGAMENTO. O do
      // navegador só é aceito para BAIXO — vender por mais caro do que a
      // etiqueta é sempre erro de sincronia, e erro de sincronia não pode
      // virar cobrança a mais no cliente.
      const p = va?.produto
      const tabelaCent =
        precoNaTabela(
          {
            vista: centavos(p?.precoVista ?? 0),
            cartao: p?.precoCartao != null ? centavos(p.precoCartao) : null,
            crediario: p?.precoCrediario != null ? centavos(p.precoCrediario) : null,
          },
          tabela,
        ) + centavos(va?.ajustePreco ?? 0)
      const pedidoCent = i.precoUnit != null ? centavos(i.precoUnit) : tabelaCent
      const precoCent = Math.max(0, Math.min(pedidoCent, tabelaCent))
      const descontoCent = centavos(i.desconto ?? 0)
      const totalCent = multiplicar(precoCent, i.quantidade) - descontoCent
      return {
        variacaoId: i.variacaoId,
        descricao: descrever(va),
        codigo: va?.codigo ?? null,
        medida: va?.produto.medida ?? 'UN',
        quantidade: i.quantidade,
        precoUnit: reais(precoCent),
        desconto: reais(descontoCent),
        total: reais(totalCent),
        custoUnit: va?.produto.custo != null ? reais(centavos(va.produto.custo)) : null,
        saldoNaVenda: saldoQueFaltou.has(i.variacaoId) ? saldoQueFaltou.get(i.variacaoId)! : null,
        _cent: totalCent,
        _tabelaCent: multiplicar(tabelaCent, i.quantidade),
      }
    })

    // A linha da encomenda: o que falta, lido lá em cima com a encomenda
    // travada. Entra como tabela dela mesma — não é desconto de ninguém.
    if (daEncomenda) {
      itens.push({
        variacaoId: null,
        descricao: daEncomenda.linha,
        codigo: null,
        medida: 'UN' as const,
        quantidade: 1,
        precoUnit: reais(daEncomenda.faltaC),
        desconto: 0,
        total: reais(daEncomenda.faltaC),
        custoUnit: null,
        saldoNaVenda: null,
        _cent: daEncomenda.faltaC,
        _tabelaCent: daEncomenda.faltaC,
      })
    }

    const subtotalCent = itens.reduce((s, i) => s + i._cent, 0)
    const descontoCent = centavos(v.desconto ?? 0)
    const liquidoCent = subtotalCent - descontoCent
    const pagoCent = v.pagamentos.reduce((s, p) => s + centavos(p.valor), 0)

    // ── 3.0 o acréscimo ──
    // Cobrar a mais é o lado seguro, e por isso não pede poder. O teto é só
    // contra o dedo errado — um zero a mais vira R$ 1.500 numa peça de R$ 150.
    const acrescimoCent = centavos(v.acrescimo ?? 0)
    const tetoAcrescimo = Math.max(100_000, subtotalCent * 10)
    if (acrescimoCent > tetoAcrescimo) {
      return {
        ok: false as const,
        motivo: 'pagamento_recusado' as const,
        recado: `Acréscimo de ${mostrar(acrescimoCent)} parece dedo errado. Confira o valor.`,
      }
    }
    const totalCent = liquidoCent + acrescimoCent

    // ── 3.1 o desconto, medido contra a TABELA ──
    // Não contra o subtotal: o subtotal já embute o desconto dado no item, e
    // medir contra ele daria sempre zero — que é exatamente o buraco. E sem o
    // acréscimo: cobrar a etiqueta velha de uma peça não abre espaço para dar
    // 30% na outra.
    const tabelaCent = itens.reduce((s, i) => s + i._tabelaCent, 0)
    const abatidoCent = tabelaCent - liquidoCent
    const percentual = tabelaCent > 0 ? (abatidoCent / tabelaCent) * 100 : 0

    if (liquidoCent < 0) {
      return { ok: false as const, motivo: 'desconto_acima_do_teto' as const, percentual, teto }
    }
    const passouDoTeto = percentual > teto + 0.001
    if (passouDoTeto && !podeDesconto) {
      return {
        ok: false as const,
        motivo: 'desconto_acima_do_teto' as const,
        percentual: Math.round(percentual * 10) / 10,
        teto,
      }
    }
    // A autorização entra na venda só quando foi ELA que deixou passar: quem
    // já tem o poder, ou o PIN que chegou sem precisar, não vira "autorizou".
    const autorizou = !temPoder && autorizador && (passouDoTeto || avulsos.length > 0) ? autorizador : null

    // ── 3.2 os pontos que o cliente resolveu gastar ──
    // Entram AQUI, depois da trava de desconto, e isso é a decisão que
    // importa: se entrassem antes, o cliente gastando os pontos DELE derrubaria
    // o total abaixo do teto e a venda seria recusada por "desconto acima do
    // teto". O teto existe para o julgamento de quem vende — quanto a pessoa
    // pode abrir mão por conta própria. Ponto não é julgamento de ninguém: é
    // saldo, e quem confere o saldo é o banco, logo abaixo.
    let pontosUsados = 0
    let pontosCent = 0

    if ((v.pontosUsar ?? 0) > 0) {
      if (!v.clienteId) {
        return {
          ok: false as const,
          motivo: 'pontos_recusados' as const,
          recado: RECADO_PONTOS.sem_cliente,
        }
      }
      // O saldo vem do banco, agora, dentro da transação. O número que a tela
      // mandou é pedido: quem monta o POST na mão pede 90.000 pontos.
      const dono = await db.cliente.findUnique({
        where: { id: v.clienteId },
        select: { pontos: true },
      })
      const r = conferirUso(
        Math.floor(v.pontosUsar ?? 0),
        dono?.pontos ?? 0,
        totalCent,
        programa,
      )
      if (!r.ok) {
        return {
          ok: false as const,
          motivo: 'pontos_recusados' as const,
          recado: RECADO_PONTOS[r.motivo],
        }
      }
      pontosUsados = r.pontos
      pontosCent = r.centavos
    }

    const aPagarCent = totalCent - pontosCent

    // ── 3.25 o juro do crédito parcelado ──
    // Só quando a loja cobra (`creditoJurosPct`, zero no padrão) e só em 2× ou
    // mais. A tela manda o valor SEM juro e o servidor soma: o juro é regra da
    // loja, não número digitado. Entra no pagamento e no total — é o que a
    // cliente paga na maquininha —, e fica à parte (`juros`) para a devolução
    // não devolver juro de parcelamento como se fosse peça.
    const jurosPct = Number(empresa?.creditoJurosPct ?? 0)
    const jurosDe = v.pagamentos.map((p) =>
      p.forma === 'CREDITO' && (p.parcelas ?? 1) > 1 && jurosPct > 0
        ? Math.round((centavos(p.valor) * jurosPct) / 100)
        : 0,
    )
    const jurosCent = jurosDe.reduce((s, j) => s + j, 0)

    const subtotal = reais(subtotalCent)
    const desconto = reais(descontoCent)
    const total = reais(aPagarCent + jurosCent)

    // O que a venda gera de pontos sai do que foi REALMENTE pago. Pontuar em
    // cima do preço cheio faria a loja pagar duas vezes pelo mesmo desconto.
    // E a parte no crediário fica de fora: ela ainda não foi paga — pontuar
    // a promessa daria ponto a quem não pagou a parcela.
    const fiadoCent = fiado.reduce((s, p) => s + centavos(p.valor), 0)
    const ganhos = v.clienteId ? calcularGanho(Math.max(0, aPagarCent - fiadoCent), programa) : 0

    // Comparação entre inteiros: ou bate, ou não bate. Sem "quase".
    // E um centavo de diferença trava a venda de propósito — caixa que fecha
    // "quase certo" todo dia é caixa que ninguém confere mais.
    if (pagoCent !== aPagarCent) {
      return {
        ok: false as const,
        motivo: 'pagamento_nao_fecha' as const,
        total: reais(aPagarCent),
        pago: reais(pagoCent),
      }
    }

    // ── o caixa da venda ──
    // O id vem do navegador. Precisa ser o caixa aberto DESTA loja: com o de
    // outra, o dinheiro desta venda entrava na conferência da gaveta da loja
    // vizinha — e as duas fechavam errado, uma sobrando e a outra faltando.
    // Sem id, vale o caixa aberto da loja; e venda com dinheiro precisa dele,
    // senão o dinheiro entra no sistema sem gaveta nenhuma para conferir.
    //
    // E o turno fica PRESO até a venda terminar (`travarCaixaAberto`): o
    // fechamento feito no outro tablet no mesmo segundo espera esta venda e
    // a conta dentro — em vez de fechar a gaveta sem ela e deixar a venda
    // pendurada num turno já contado.
    let caixaId: string | null = null
    if (v.caixaId) {
      caixaId = await travarCaixaAberto(db, v.unidadeId, v.caixaId)
      // Sem internet, o turno em que a venda aconteceu pode ter fechado antes
      // de ela subir: entra no caixa aberto da loja, se houver um.
      if (!caixaId && v.offline) caixaId = await travarCaixaAberto(db, v.unidadeId)
      if (!caixaId) return { ok: false as const, motivo: 'caixa_fechado' as const }
    } else {
      caixaId = await travarCaixaAberto(db, v.unidadeId)
      if (!caixaId && v.pagamentos.some((p) => p.forma === 'DINHEIRO')) {
        return { ok: false as const, motivo: 'caixa_fechado' as const }
      }
    }

    // ── 3.3 o vale de troca, quando paga com ele ──
    // O código vem do navegador; o saldo vem do banco, agora. Primeiro
    // confere TODOS os vales sem escrever nada — uma recusa aqui é saída
    // limpa. Só depois desconta, e desconto que falha (dois caixas gastando o
    // mesmo vale no mesmo segundo) estoura a transação inteira em vez de
    // devolver "não deu": devolver depois de escrever deixaria o primeiro
    // desconto gravado numa venda que não aconteceu.
    const valeDoPagamento = new Map<number, string>()
    const valesConferidos: { indice: number; id: string; valorCent: number }[] = []
    for (const [i, p] of v.pagamentos.entries()) {
      if (p.forma !== 'VALE') continue
      const codigo = normalizarCodigo(p.referencia ?? '')
      const valorCent = centavos(p.valor)
      const vale = codigo
        ? await db.vale.findFirst({
            where: { codigo },
            select: { id: true, saldo: true, validade: true, unidadeId: true, unidade: { select: { nome: true } } },
          })
        : null
      if (!vale) {
        return { ok: false as const, motivo: 'vale_recusado' as const, recado: 'Vale não encontrado. Confira o código.' }
      }
      // Loja com CNPJ próprio: o vale de uma não paga a venda da outra.
      if (!valeServeNaLoja(!!empresa?.valePorLoja, vale.unidadeId, v.unidadeId)) {
        return {
          ok: false as const,
          motivo: 'vale_recusado' as const,
          recado: `Este vale é da ${vale.unidade?.nome ?? 'outra loja'} e só vale lá.`,
        }
      }
      if (vale.validade && venceu(vale.validade)) {
        return { ok: false as const, motivo: 'vale_recusado' as const, recado: 'Este vale já venceu.' }
      }
      if (centavos(vale.saldo) < valorCent) {
        return {
          ok: false as const,
          motivo: 'vale_recusado' as const,
          recado: `O vale só tem ${mostrar(centavos(vale.saldo))}.`,
        }
      }
      valesConferidos.push({ indice: i, id: vale.id, valorCent })
    }
    for (const c of valesConferidos) {
      const mexeu = await db.vale.updateMany({
        where: { id: c.id, saldo: { gte: reais(c.valorCent) } },
        data: { saldo: { decrement: reais(c.valorCent) } },
      })
      if (mexeu.count === 0) throw new ValeDisputado(c.id)
      const depois = await db.vale.findUnique({ where: { id: c.id }, select: { saldo: true } })
      if (depois && centavos(depois.saldo) <= 0) {
        await db.vale.update({ where: { id: c.id }, data: { usadoEm: new Date() } })
      }
      valeDoPagamento.set(c.indice, c.id)
    }

    // ── 3.4 a taxa da maquininha de HOJE, gravada em cada pagamento ──
    // O DRE desconta a taxa venda a venda; com ela gravada aqui, mudar a taxa
    // em Configurações amanhã não reescreve o mês que já fechou.
    const taxas = await lerTaxas(db)

    // ── 4. o número, sem corrida ──
    // O banco incrementa e devolve numa operação só.
    const linhas = await db.$queryRaw<{ numero: number }[]>`
      update unidades
         set proxima_venda = proxima_venda + 1
       where id = ${v.unidadeId}
      returning proxima_venda - 1 as numero
    `
    // Nenhuma linha = a unidade não existe nesta empresa (o RLS não a enxerga).
    // Melhor parar aqui do que gravar venda órfã.
    if (linhas.length === 0) throw new Error('Unidade não encontrada nesta empresa.')
    const numero = linhas[0]!.numero

    // ── 5. grava ──
    const venda = await db.venda.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: v.unidadeId,
        caixaId,
        clienteId: v.clienteId ?? null,
        numero,
        vendedorId: vendedor.id,
        vendedorNome: vendedor.nome,
        situacao: 'CONCLUIDA',
        subtotal,
        desconto,
        acrescimo: reais(acrescimoCent),
        descontoPontos: reais(pontosCent),
        pontosUsados,
        pontosGanhos: ganhos,
        total,
        autorizadoPorId: autorizou?.usuarioId ?? null,
        autorizadoPor: autorizou?.nome ?? null,
        // A venda que recebeu uma encomenda aponta para ela — um campo de
        // verdade, e não o código escrito na observação (o `@unique` é a
        // garantia de que a encomenda não se recebe em duas vendas).
        encomendaId: v.encomendaId && daEncomenda ? v.encomendaId : null,
        observacoes: v.observacoes || undefined,
        chave: v.chave ?? null,
        // A hora de verdade da venda: a de quando estava sem internet, se foi.
        ...(v.offline ? { criadaEm: v.offline.quando } : {}),
        concluidaEm: v.offline?.quando ?? new Date(),
        itens: {
          create: itens.map(({ _cent, _tabelaCent, ...i }) => ({ orgId: sessao.orgId, ...i })),
        },
        pagamentos: {
          create: v.pagamentos.map((p, i) => {
            // Parcela só no crédito e no crediário; no resto é sempre 1.
            const parcelas = p.forma === 'CREDITO' || p.forma === 'CREDIARIO' ? (p.parcelas ?? 1) : 1
            return {
              orgId: sessao.orgId,
              forma: p.forma,
              valor: reais(centavos(p.valor) + jurosDe[i]!),
              juros: reais(jurosDe[i]!),
              parcelas,
              referencia: p.forma === 'VALE' ? normalizarCodigo(p.referencia ?? '') : p.referencia,
              valeId: valeDoPagamento.get(i) ?? null,
              maquininha: maquininhaDe[i] ?? null,
              taxaPct: taxaDe(taxas, p.forma, parcelas),
            }
          }),
        },
      },
      select: { id: true, numero: true },
    })

    // ── 5.1 as parcelas do crediário ──
    // Nascem junto com a venda, na mesma transação: venda fiada sem parcela
    // escrita é o caderno que some.
    if (fiado.length > 0 && v.clienteId) {
      const p = fiado[0]!
      // O 1º vencimento escolhido e as seguintes no mesmo dia de cada mês —
      // ver crediario-agenda.ts.
      const parcelas = agendaDoCrediario({
        totalCent: centavos(p.valor),
        parcelas: p.parcelas ?? 1,
        primeiroVencimento: primeiroVencimento!,
        diasEntre: empresa?.crediarioDiasEntre ?? 30,
      })
      await db.parcela.createMany({
        data: parcelas.map((x) => ({
          orgId: sessao.orgId,
          vendaId: venda.id,
          clienteId: v.clienteId!,
          unidadeId: v.unidadeId,
          numero: x.numero,
          de: x.de,
          vencimento: x.vencimento,
          valor: reais(x.valorCent),
        })),
      })

      // O CPF que a cliente ditou vai para a ficha — só se ela estiver sem.
      // O carnê é confissão de dívida e precisa do CPF; a próxima venda já
      // não pergunta.
      if (v.clienteCpf && pode(sessao, 'cliente.editar')) {
        const cpf = v.clienteCpf.replace(/\D/g, '')
        const anotou = await db.cliente.updateMany({
          where: { id: v.clienteId, OR: [{ documento: null }, { documento: '' }] },
          data: { documento: cpf },
        })
        if (anotou.count > 0) {
          await db.auditoria.create({
            data: {
              orgId: sessao.orgId,
              unidadeId: v.unidadeId,
              usuarioId: sessao.usuarioId,
              quem: sessao.nome,
              acao: 'cliente.alterou',
              alvoTipo: 'cliente',
              alvoId: v.clienteId,
              motivo: `CPF anotado no crediário da venda ${numero}`,
            },
          })
        }
      }
    }

    // ── 5.2 o horário da agenda que esta venda cobrou ──
    // A condição `vendaId: null` é a segunda trava (a primeira é o FOR UPDATE
    // lá em cima): se por qualquer caminho o horário já tiver venda, esta
    // desiste inteira em vez de cobrar duas vezes.
    if (v.agendamentoId) {
      const marcou = await db.agendamento.updateMany({
        where: { id: v.agendamentoId, vendaId: null },
        data: { vendaId: venda.id, situacao: 'ATENDIDO' },
      })
      if (marcou.count === 0) throw new AgendamentoJaCobrado()
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: v.unidadeId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'agenda.atendeu',
          alvoTipo: 'agendamento',
          alvoId: v.agendamentoId,
          alvoNome: `Venda ${numero}`,
          valor: total,
          depois: { situacao: 'ATENDIDO', vendaId: venda.id },
        },
      })
    }

    // ── 5.3 a encomenda que esta venda recebeu sai como entregue ──
    // Na mesma transação: venda que não fecha deixa a encomenda como estava.
    if (v.encomendaId && daEncomenda) {
      await entregarPelaVenda(db, sessao, v.encomendaId, {
        id: venda.id,
        numero,
        unidadeId: v.unidadeId,
        faltaC: daEncomenda.faltaC,
      })
    }

    // ── 6. baixa o estoque, na MESMA transação ──
    // Só o que é do catálogo: item avulso não tem de onde sair.
    const semEstoque = new Set(faltando.map((f) => f.descricao))
    for (const i of doCatalogo) {
      const r = await mexerEstoqueEm(db, sessao, {
        variacaoId: i.variacaoId,
        unidadeId: v.unidadeId,
        tipo: 'VENDA',
        quantidade: i.quantidade,
        referencia: venda.id,
        motivo: `Venda ${numero}`,
        permitirNegativo: vendeSemEstoque,
      })
      // Só chega aqui se alguém levou o estoque entre a conferência e agora.
      // Lançar desfaz a venda inteira — é rollback limpo, não erro de banco.
      if (!r.ok) throw new EstoqueSumiu(i.variacaoId)
      // Vendendo sem estoque, o mesmo caminho não trava: o saldo ficou
      // negativo (outro caixa levou a última, ou a peça veio em duas linhas).
      // Vira pendência como a outra — a peça saiu, o sistema não a tinha.
      if (vendeSemEstoque && r.saldo < 0 && !saldoQueFaltou.has(i.variacaoId)) {
        await db.vendaItem.updateMany({
          where: { vendaId: venda.id, variacaoId: i.variacaoId, saldoNaVenda: null },
          data: { saldoNaVenda: r.saldo + i.quantidade },
        })
        saldoQueFaltou.set(i.variacaoId, r.saldo + i.quantidade)
        semEstoque.add(descrever(porId.get(i.variacaoId)))
      }
    }

    // ── 6.1 os pontos ──
    // Duas escritas: o extrato (que é a verdade) e o saldo do cliente (que é
    // a conta rápida que o balcão lê). Dentro da MESMA transação da venda: se
    // qualquer coisa aqui falhar, a venda não aconteceu — o contrário criaria
    // venda com pontos cobrados e não creditados, ou pior, o inverso.
    if (v.clienteId && (pontosUsados > 0 || ganhos > 0)) {
      // Uma escrita só para o saldo, com o delta. Ler-somar-gravar abriria
      // corrida entre duas vendas do mesmo cliente em caixas diferentes.
      //
      // E condicional: o saldo lido lá em cima é uma fotografia. Dois caixas
      // gastando os mesmos 500 pontos do mesmo cliente liam 500 os dois, e o
      // saldo terminava em −500 — o desconto dado duas vezes. Com a condição,
      // o segundo não acha mais o saldo e a venda dele volta inteira.
      const mexeu = await db.cliente.updateMany({
        where: { id: v.clienteId, ...(pontosUsados > 0 ? { pontos: { gte: pontosUsados } } : {}) },
        data: { pontos: { increment: ganhos - pontosUsados } },
      })
      if (mexeu.count === 0) throw new PontosDisputados()
      const depois = await db.cliente.findUniqueOrThrow({ where: { id: v.clienteId }, select: { pontos: true } })

      // O extrato é reconstruído de trás para frente: o saldo final é o que o
      // banco acabou de devolver, e cada linha guarda onde ela parou.
      const linhas: { tipo: 'USOU' | 'GANHOU'; pontos: number }[] = []
      if (pontosUsados > 0) linhas.push({ tipo: 'USOU', pontos: -pontosUsados })
      if (ganhos > 0) linhas.push({ tipo: 'GANHOU', pontos: ganhos })

      let saldo = depois.pontos
      const paraGravar = [...linhas].reverse().map((l) => {
        const registro = { ...l, saldoDepois: saldo }
        saldo -= l.pontos
        return registro
      })

      await db.movimentoPontos.createMany({
        data: paraGravar.map((l) => ({
          orgId: sessao.orgId,
          clienteId: v.clienteId!,
          tipo: l.tipo,
          pontos: l.pontos,
          saldoDepois: l.saldoDepois,
          vendaId: venda.id,
          motivo: `Venda ${numero}`,
          quem: sessao.nome,
        })),
      })
    }

    // O troco, para o papel (ver `NovaVenda.troco`). Só com dinheiro na venda,
    // e com teto: número de dedo errado não vai para o comprovante.
    const trocoCent =
      v.pagamentos.some((p) => p.forma === 'DINHEIRO') && Number.isFinite(v.troco) && (v.troco ?? 0) > 0
        ? centavos(v.troco ?? 0)
        : 0
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: v.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'venda.registrou',
        alvoTipo: 'venda',
        alvoId: venda.id,
        alvoNome: `Venda ${numero}`,
        valor: total,
        ...(trocoCent > 0 && trocoCent <= TETO_DO_TROCO_CENT ? { depois: { troco: reais(trocoCent) } } : {}),
        // Desconto entra no livro com o número. É o que permite ao dono
        // perguntar depois "quem andou dando 40%?" e ter resposta. E quando
        // quem vendeu não é quem registrou, os dois nomes ficam.
        motivo:
          [
            abatidoCent > 0 ? `desconto ${(Math.round(percentual * 10) / 10).toFixed(1)}%` : null,
            acrescimoCent > 0 ? `acréscimo ${mostrar(acrescimoCent)}` : null,
            avulsos.length > 0 ? plural(avulsos.length, 'item avulso', 'itens avulsos') : null,
            autorizou ? `autorizado por ${autorizou.nome}` : null,
            semEstoque.size > 0 ? `${plural(semEstoque.size, 'item', 'itens')} sem estoque no sistema` : null,
            jurosCent > 0 ? `juro do crédito ${mostrar(jurosCent)}` : null,
            vendedor.id !== sessao.usuarioId ? `vendedor: ${vendedor.nome}` : null,
            tabela !== 'vista' ? `preço ${ROTULO_TABELA[tabela]}` : null,
            fiado.length > 0 ? `crediário em ${fiado[0]!.parcelas ?? 1}×` : null,
            v.encomendaId ? `encomenda ${codigoEncomenda(v.encomendaId)}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
      },
    })

    return {
      ok: true as const,
      vendaId: venda.id,
      numero,
      total,
      pontosUsados,
      pontosGanhos: ganhos,
      semEstoque: [...semEstoque],
      autorizadoPor: autorizou?.nome ?? null,
    }
  }
  return dentro ? corpo(dentro.db) : comoOrg(sessao.orgId, corpo)
}

/**
 * O vale serve nesta loja? Com a regra "vale por loja" ligada, só na loja
 * que o emitiu. Vale sem loja (de antes da regra, ou trazido do sistema
 * anterior sem loja) serve em qualquer uma — prender ele numa loja seria
 * tirar da cliente um crédito que ela tem.
 */
export function valeServeNaLoja(valePorLoja: boolean, valeUnidadeId: string | null, unidadeId: string): boolean {
  return !valePorLoja || !valeUnidadeId || valeUnidadeId === unidadeId
}

/** Dois caixas gastaram o mesmo vale no mesmo instante. Raro, e a venda não pode ficar. */
export class ValeDisputado extends Error {
  constructor(readonly valeId: string) {
    super('O vale acabou de ser usado em outro caixa. Nada foi gravado.')
    this.name = 'ValeDisputado'
  }
}

/** Os pontos do cliente foram gastos em outro caixa no mesmo instante. */
export class PontosDisputados extends Error {
  constructor() {
    super('Os pontos deste cliente acabaram de ser usados em outro caixa. Nada foi gravado.')
    this.name = 'PontosDisputados'
  }
}

/** O horário da agenda foi cobrado por outra venda no mesmo instante. */
export class AgendamentoJaCobrado extends Error {
  constructor() {
    super('Esse horário acabou de ser cobrado em outra venda. Nada foi gravado.')
    this.name = 'AgendamentoJaCobrado'
  }
}

/** Alguém levou a última peça entre a conferência e a baixa. Raro, e correto. */
export class EstoqueSumiu extends Error {
  constructor(readonly variacaoId: string) {
    super('O estoque acabou enquanto a venda era registrada. Nada foi gravado.')
    this.name = 'EstoqueSumiu'
  }
}

function descrever(v: {
  produto: { nome: string }
  opcoes: { opcao: { valor: string } }[]
} | undefined): string {
  if (!v) return 'item removido'
  const partes = v.opcoes.map((o) => o.opcao.valor)
  return partes.length ? `${v.produto.nome} — ${partes.join(' · ')}` : v.produto.nome
}

// ─────────────────────────────────────────────────────────────
// O QUE JÁ FOI VENDIDO
// ─────────────────────────────────────────────────────────────
//
// Até aqui o sistema sabia VENDER e não sabia MOSTRAR o que vendeu. Não
// existia tela para achar a venda de ontem, conferir o que saiu num dia, ou
// localizar uma venda quando o cliente volta com a peça. Loja não opera assim:
// "consultar vendas" é a segunda tela mais aberta de qualquer balcão, depois do
// próprio balcão.

export type FiltroVendas = {
  unidadeIds: string[]
  de: Date
  /** Exclusivo. */
  ate: Date
  /** Número da venda, ou pedaço do nome do cliente. */
  q?: string | null
  situacao?: SituacaoVenda | null
  /** Só as vendas desta pessoa. */
  vendedorId?: string | null
  /** Só as vendas que tiveram esta forma de pagamento (inteira ou em parte). */
  forma?: FormaPagamento | null
}

export type VendaNaLista = {
  id: string
  numero: number
  criadaEm: Date
  situacao: SituacaoVenda
  total: number
  itens: number
  cliente: string | null
  vendedor: string | null
  vendedorId: string | null
  unidade: string
  /** As formas usadas, para a lista dizer "Pix + Dinheiro" sem abrir a venda. */
  formas: string[]
  /** Quanto desta venda já voltou em devolução. Zero na maioria. */
  devolvido: number
}

/**
 * O `where` da lista, da planilha e do resumo — um lugar só, para os três
 * contarem as mesmas vendas. Null quando a pessoa não alcança loja nenhuma.
 */
function ondeDasVendas(sessao: Sessao, f: FiltroVendas): Prisma.VendaWhereInput | null {
  // A unidade vem do endereço, e o endereço é de quem digita. Só entram as
  // unidades em que a pessoa pode VER venda — o gerente da loja 3 não lista a
  // loja 5 trocando o número na URL.
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'venda.ver', u))
  if (permitidas.length === 0) return null
  const q = textoDaBusca(f.q)
  const numero = numeroDaBusca(q)

  // ── a busca ──
  // A cliente volta para trocar e não lembra o número da venda: lembra a
  // PEÇA ("a blusa listrada"), tem a ETIQUETA na mão (0056522), ou sabe
  // QUANTO pagou ("foi 189,90"). Como no balcão de onde a loja veio, a busca
  // acha por tudo isso — além do número e do nome, como antes.
  //
  // - só algarismos: o número da venda, e (com 3 ou mais) o código da etiqueta
  //   de alguma peça — "56522" acha 0056522, como no balcão;
  // - com vírgula de centavos ("189,90", "R$ 89,9", "1.234,50"): o total da
  //   venda, ou o preço de alguma peça dela;
  // - o resto: nome do cliente, nome da peça, código, referência do
  //   fornecedor, ou quem vendeu.
  const insensivel = 'insensitive' as const
  const dinheiro = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2})|\.(\d{2}))?$/i.exec(q)
  const temCentavos = !!dinheiro && (q.includes(',') || /^R\$/i.test(q) || /\.\d{2}$/.test(q))
  const valor = dinheiro && temCentavos
    ? `${dinheiro[1]!.replace(/\./g, '')}.${(dinheiro[2] ?? dinheiro[3] ?? '0').padEnd(2, '0')}`
    : null
  // A etiqueta antiga com o tipo de preço grudado no fim (0056522AV): procura
  // também sem o final, como a busca do balcão (servidor/etiqueta.ts).
  const semFinal = /^(.*\d)\s*(AV|CA|CR)$/i.exec(q)?.[1] ?? null
  const pedacoDeCodigo = (t: string) => t.length >= 3 && /\d/.test(t)
  const peloCodigo = (t: string): Prisma.VendaItemWhereInput =>
    pedacoDeCodigo(t) ? { codigo: { contains: t, mode: insensivel } } : { codigo: { equals: t, mode: insensivel } }

  const busca: Prisma.VendaWhereInput | null = !q
    ? null
    : valor !== null
      ? {
          OR: [
            { total: valor },
            { itens: { some: { OR: [{ total: valor }, { precoUnit: valor }] } } },
          ],
        }
      : numero !== null
        ? { OR: [{ numero }, ...(q.length >= 3 ? [{ itens: { some: peloCodigo(q) } }] : [])] }
        : {
            OR: [
              { cliente: { nome: { contains: q, mode: insensivel } } },
              { vendedorNome: { contains: q, mode: insensivel } },
              {
                itens: {
                  some: {
                    OR: [
                      { descricao: { contains: q, mode: insensivel } },
                      peloCodigo(q),
                      ...(semFinal ? [peloCodigo(semFinal)] : []),
                      ...(q.length >= 3 ? [{ variacao: { produto: { referencia: { contains: q, mode: insensivel } } } }] : []),
                    ],
                  },
                },
              },
            ],
          }

  return {
    unidadeId: { in: permitidas },
    criadaEm: { gte: f.de, lt: f.ate },
    // O saldo de crediário trazido do sistema anterior não é venda deste
    // balcão: fica fora da lista, da planilha e do resumo (ele se vê pela
    // parcela, no Crediário).
    ...(f.situacao ? { situacao: f.situacao } : { situacao: { not: 'SALDO_IMPORTADO' as const } }),
    ...(f.vendedorId ? { vendedorId: f.vendedorId } : {}),
    ...(f.forma ? { pagamentos: { some: { forma: f.forma } } } : {}),
    ...(busca ? { AND: [busca] } : {}),
  }
}

export type ResumoVendas = {
  concluidas: number
  /** Soma das concluídas, em reais. */
  total: number
  canceladas: number
  totalCanceladas: number
}

/**
 * Os números do alto da tela de Vendas, somados NO BANCO e sem teto.
 *
 * Antes eles saíam da lista, que para em 500: num mês de loja movimentada o
 * "Vendido" e o ticket médio eram os das 500 vendas mais recentes, e o número
 * grande — o que a pessoa veio ver — ficava menor do que a loja vendeu.
 */
export async function resumoVendas(sessao: Sessao, f: FiltroVendas): Promise<ResumoVendas> {
  exigir(sessao, 'venda.ver')
  const vazio = { concluidas: 0, total: 0, canceladas: 0, totalCanceladas: 0 }
  const where = ondeDasVendas(sessao, f)
  if (!where) return vazio
  const grupos = await comoOrg(sessao.orgId, (db) =>
    db.venda.groupBy({ by: ['situacao'], where, _count: { _all: true }, _sum: { total: true } }),
  )
  const de = (s: SituacaoVenda) => grupos.find((g) => g.situacao === s)
  return {
    concluidas: de('CONCLUIDA')?._count._all ?? 0,
    total: reais(centavos(de('CONCLUIDA')?._sum.total ?? 0)),
    canceladas: de('CANCELADA')?._count._all ?? 0,
    totalCanceladas: reais(centavos(de('CANCELADA')?._sum.total ?? 0)),
  }
}

export async function listarVendas(sessao: Sessao, f: FiltroVendas): Promise<VendaNaLista[]> {
  exigir(sessao, 'venda.ver')

  const where = ondeDasVendas(sessao, f)
  if (!where) return []

  return comoOrg(sessao.orgId, async (db) => {
    const vendas = await db.venda.findMany({
      where,
      orderBy: { criadaEm: 'desc' },
      // Um dia cheio de loja grande são umas 300 vendas. Quinhentas cobrem
      // qualquer filtro razoável; acima disso a pessoa está pedindo relatório,
      // não lista.
      take: 500,
      select: {
        id: true,
        numero: true,
        criadaEm: true,
        situacao: true,
        total: true,
        vendedorNome: true,
        vendedorId: true,
        cliente: { select: { nome: true } },
        unidade: { select: { nome: true } },
        _count: { select: { itens: true } },
        pagamentos: { select: { forma: true } },
        devolucoes: { select: { valor: true } },
      },
    })

    return vendas.map((v) => ({
      id: v.id,
      numero: v.numero,
      criadaEm: v.criadaEm,
      situacao: v.situacao,
      total: Number(v.total),
      itens: v._count.itens,
      cliente: v.cliente?.nome ?? null,
      vendedor: v.vendedorNome,
      vendedorId: v.vendedorId,
      unidade: v.unidade.nome,
      formas: [...new Set(v.pagamentos.map((p) => p.forma))],
      devolvido: v.devolucoes.reduce((s, d) => s + Number(d.valor), 0),
    }))
  })
}

export type ItemVendido = {
  vendaId: string
  numero: number
  criadaEm: Date
  situacao: SituacaoVenda
  unidade: string
  cliente: string | null
  vendedor: string | null
  descricao: string
  codigo: string | null
  medida: string
  quantidade: number
  precoUnit: number
  total: number
  custoUnit: number | null
  formas: string
  totalVenda: number
}

/**
 * Uma linha por ITEM vendido — é o que vai para a planilha. O contador e
 * quem analisa querem saber o que saiu, não só quanto; e planilha com a
 * venda numa linha e os itens em outra tabela ninguém consegue cruzar.
 */
export async function listarItensVendidos(
  sessao: Sessao,
  f: FiltroVendas,
  // Teto contra a planilha que derruba o servidor, não contra a loja: 90 dias
  // de uma loja com 100 itens por dia já são 9.000 linhas, e o teto antigo
  // (5.000) cortava a planilha no meio, sem aviso.
  limite = 100_000,
): Promise<ItemVendido[]> {
  exigir(sessao, 'venda.ver')
  // O custo é o segredo da margem. A planilha de vendas vai para quem vê
  // venda — inclusive o balcão —, e a coluna de custo só sai para quem já
  // vê custo em outra tela (preço ou financeiro), como nas planilhas de
  // produto e de estoque.
  const veCusto = pode(sessao, 'produto.preco') || pode(sessao, 'financeiro.ver')
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'venda.ver', u))
  if (permitidas.length === 0) return []
  const q = textoDaBusca(f.q)
  const numero = numeroDaBusca(q)

  return comoOrg(sessao.orgId, async (db) => {
    const itens = await db.vendaItem.findMany({
      where: {
        venda: {
          unidadeId: { in: permitidas },
          criadaEm: { gte: f.de, lt: f.ate },
          ...(f.situacao ? { situacao: f.situacao } : { situacao: { not: 'SALDO_IMPORTADO' as const } }),
          ...(f.vendedorId ? { vendedorId: f.vendedorId } : {}),
          ...(f.forma ? { pagamentos: { some: { forma: f.forma } } } : {}),
          ...(numero !== null ? { numero } : q ? { cliente: { nome: { contains: q, mode: 'insensitive' } } } : {}),
        },
      },
      orderBy: [{ venda: { criadaEm: 'desc' } }, { id: 'asc' }],
      take: limite,
      select: {
        descricao: true, codigo: true, medida: true, quantidade: true, precoUnit: true, total: true, custoUnit: true,
        venda: {
          select: {
            id: true, numero: true, criadaEm: true, situacao: true, total: true, vendedorNome: true,
            cliente: { select: { nome: true } },
            unidade: { select: { nome: true } },
            pagamentos: { select: { forma: true } },
          },
        },
      },
    })
    return itens.map((i) => ({
      vendaId: i.venda.id,
      numero: i.venda.numero,
      criadaEm: i.venda.criadaEm,
      situacao: i.venda.situacao,
      unidade: i.venda.unidade.nome,
      cliente: i.venda.cliente?.nome ?? null,
      vendedor: i.venda.vendedorNome,
      descricao: i.descricao,
      codigo: i.codigo,
      medida: i.medida,
      quantidade: Number(i.quantidade),
      precoUnit: Number(i.precoUnit),
      total: Number(i.total),
      custoUnit: !veCusto || i.custoUnit === null ? null : Number(i.custoUnit),
      formas: [...new Set(i.venda.pagamentos.map((p) => p.forma))].join(' + '),
      totalVenda: Number(i.venda.total),
    }))
  })
}

/** A venda inteira, para a ficha. */
export async function acharVenda(sessao: Sessao, vendaId: string) {
  exigir(sessao, 'venda.ver')
  const v = await comoOrg(sessao.orgId, (db) =>
    db.venda.findUnique({
      where: { id: vendaId },
      include: {
        itens: {
          orderBy: { id: 'asc' },
          // `servico`: a ficha mostra "1×" para a consulta, e não "1 un".
          include: {
            devolucoes: { select: { quantidade: true } },
            variacao: { select: { produto: { select: { servico: true } } } },
          },
        },
        pagamentos: {
          orderBy: { criadoEm: 'asc' },
          include: { vale: { select: { codigo: true } } },
        },
        devolucoes: {
          orderBy: { criadaEm: 'asc' },
          include: {
            itens: { select: { vendaItemId: true, quantidade: true, valor: true } },
            vale: { select: { codigo: true, saldo: true, validade: true } },
          },
        },
        parcelas: {
          orderBy: { numero: 'asc' },
          select: { id: true, numero: true, de: true, vencimento: true, valor: true, pago: true, desconto: true, quitadaEm: true },
        },
        cliente: { select: { id: true, nome: true, telefone: true } },
        unidade: { select: { id: true, nome: true } },
        caixa: { select: { id: true, aberto: true } },
        encomenda: { select: { id: true, descricao: true } },
      },
    }),
  )
  // Achar por id passa pelo RLS (só vem venda desta empresa), mas a unidade
  // ainda precisa ser conferida: gerente de uma loja não abre venda da outra.
  if (!v || !pode(sessao, 'venda.ver', v.unidadeId)) return null
  // O troco mora no livro da venda (ver `NovaVenda.troco`). Só se procura
  // quando houve dinheiro: as outras formas não dão troco.
  const troco = v.pagamentos.some((p) => p.forma === 'DINHEIRO') ? await trocoDaVenda(sessao, v.id) : 0
  return { ...v, troco }
}

/** O troco que o balcão deu nesta venda, lido do livro. Zero quando não houve. */
async function trocoDaVenda(sessao: Sessao, vendaId: string): Promise<number> {
  const registro = await comoOrg(sessao.orgId, (db) =>
    db.auditoria.findFirst({
      where: { alvoTipo: 'venda', alvoId: vendaId, acao: 'venda.registrou' },
      select: { depois: true },
    }),
  )
  const depois = registro?.depois
  const t = depois && typeof depois === 'object' && !Array.isArray(depois) ? Number((depois as Record<string, unknown>).troco) : 0
  return Number.isFinite(t) && t > 0 ? reais(centavos(t)) : 0
}

export type Cancelamento =
  | {
      ok: true
      numero: number
      /** O dinheiro que saiu da gaveta de AGORA (a venda era de um turno já fechado). */
      sangria: number
    }
  | { ok: false; motivo: 'nao_achada' | 'ja_cancelada' | 'saldo_importado' | 'sem_motivo' | 'ja_devolvida' | 'crediario_recebido' | 'caixa_fechado' }
  /** A empresa pede o PIN de quem cancela (`Org.pinNasExcecoes`), e ele não veio ou não confere. */
  | { ok: false; motivo: 'assinatura'; erro: string }

/**
 * Uma parcela desta venda recebeu dinheiro entre a leitura e o apagar. Lançado
 * para desfazer a transação inteira (o estoque já tinha voltado) e virar a
 * mesma resposta de "crediário recebido" do lado de fora.
 */
class ParcelaRecebidaNoCaminho extends Error {
  constructor() {
    super('Uma parcela desta venda acabou de ser recebida. Nada foi cancelado.')
    this.name = 'ParcelaRecebidaNoCaminho'
  }
}

/**
 * A parcela já tem rastro de dinheiro ou de acerto: pago, juro, multa,
 * desconto, ou qualquer recebimento (a baixa externa e o desconto que quitou
 * sem dinheiro também deixam um). Parcela assim não se apaga.
 */
export function parcelaMexida(p: {
  pago: unknown
  juros: unknown
  multa: unknown
  desconto: unknown
  _count?: { recebimentos: number }
}): boolean {
  const algum = (x: unknown) => centavos(Number(x ?? 0) || 0) > 0
  return algum(p.pago) || algum(p.juros) || algum(p.multa) || algum(p.desconto) || (p._count?.recebimentos ?? 0) > 0
}

/**
 * Desfaz uma venda: o estoque volta, os pontos voltam, e a venda fica marcada
 * — nunca apagada. Cancelar é evento, e evento fica no livro.
 *
 * ── o que NÃO acontece aqui ──────────────────────────────────
 * O dinheiro não volta sozinho. Se a venda foi em Pix ou cartão, devolver é
 * ato de gente, feito por fora, e o sistema não tem como saber se aconteceu.
 * Por isso o motivo é obrigatório: é ele que, no livro, conta o que foi feito
 * com o dinheiro. A exceção é o DINHEIRO de um turno já fechado: esse volta
 * pela gaveta aberta agora, como sangria (ver "o dinheiro da gaveta").
 *
 * E a venda cancelada some do DRE, do painel e do fechamento do caixa sozinha:
 * todos eles só somam `CONCLUIDA`. Não existe "estorno" a lançar — a venda
 * simplesmente deixa de contar, e o histórico de estoque ganha uma devolução
 * apontando para ela.
 */
export async function cancelarVenda(
  sessao: Sessao,
  vendaId: string,
  motivo: string,
  /** O PIN de quem cancela, quando a empresa pede assinatura nas exceções. */
  pin?: string | null,
): Promise<Cancelamento> {
  const texto = motivo.trim()
  if (texto.length < 3) return { ok: false, motivo: 'sem_motivo' }

  // Fora da transação: a conferência do PIN abre a dela (o freio).
  const assinatura = await assinarExcecao(sessao, { pin })
  if (!assinatura.ok) return { ok: false, motivo: 'assinatura', erro: assinatura.erro }

  try {
    return await cancelarNaTransacao(sessao, vendaId, texto, assinatura.assinou)
  } catch (e) {
    if (e instanceof ParcelaRecebidaNoCaminho) return { ok: false, motivo: 'crediario_recebido' }
    throw e
  }
}

async function cancelarNaTransacao(sessao: Sessao, vendaId: string, texto: string, assinado = false): Promise<Cancelamento> {
  return comoOrg(sessao.orgId, async (db) => {
    // Trava a linha da venda até o fim da transação. Dois cliques em
    // "Cancelar" (ou cancelar enquanto outra pessoa devolve) liam os dois
    // CONCLUIDA, e o estoque voltava DUAS vezes. Com a trava, o segundo
    // espera o primeiro terminar e já lê CANCELADA.
    await travarVenda(db, vendaId)
    const v = await db.venda.findUnique({
      where: { id: vendaId },
      select: {
        id: true,
        numero: true,
        unidadeId: true,
        situacao: true,
        clienteId: true,
        pontosGanhos: true,
        pontosUsados: true,
        total: true,
        caixaId: true,
        itens: { select: { variacaoId: true, quantidade: true } },
        devolucoes: { select: { id: true } },
        pagamentos: { select: { forma: true, valor: true, valeId: true } },
        parcelas: {
          select: { id: true, pago: true, juros: true, multa: true, desconto: true, _count: { select: { recebimentos: true } } },
        },
      },
    })
    if (!v) return { ok: false as const, motivo: 'nao_achada' as const }

    // Conferido DEPOIS de achar, porque a unidade da venda é o que decide.
    exigir(sessao, 'venda.cancelar', v.unidadeId)

    if (v.situacao === 'CANCELADA') return { ok: false as const, motivo: 'ja_cancelada' as const }
    // O saldo trazido do sistema anterior não se cancela: cancelar apagaria as
    // parcelas — a dívida da pessoa sumiria sem ninguém receber nada.
    if (v.situacao === 'SALDO_IMPORTADO') return { ok: false as const, motivo: 'saldo_importado' as const }

    // Venda que já teve devolução não se cancela inteira: o que voltou já
    // devolveu estoque, pontos e dinheiro (ou vale). Cancelar por cima fazia
    // tudo isso voltar DE NOVO — estoque em dobro, pontos tirados duas vezes,
    // e o DRE descontando a devolução de uma venda que nem conta mais. O
    // caminho é devolver o que resta.
    if (v.devolucoes.length > 0) return { ok: false as const, motivo: 'ja_devolvida' as const }

    // Fiado que já mexeu: o dinheiro entrou (às vezes na gaveta), e cancelar
    // não tem como devolvê-lo. Devolver os itens abate a dívida e mostra o que
    // sobra para acertar com o cliente.
    //
    // "Mexeu" é qualquer rastro na parcela, não só o pago: a parcela quitada
    // por DESCONTO (pago zero), a multa cobrada, a baixa externa — todas têm
    // um recebimento pendurado nela, e apagar a parcela por baixo dele dava o
    // erro cru do banco na cara de quem cancelava.
    if (v.parcelas.some(parcelaMexida)) {
      return { ok: false as const, motivo: 'crediario_recebido' as const }
    }

    // ── 0. o dinheiro da gaveta ──
    // Venda em dinheiro de um turno AINDA ABERTO: cancelada, ela sai sozinha
    // da conta daquela gaveta (o esperado só soma CONCLUIDA), e o dinheiro
    // volta ao cliente dali mesmo. Mas a venda de ontem, de um turno já
    // fechado e conferido, não: a gaveta de ontem já foi contada com esse
    // dinheiro dentro, e o dinheiro que volta ao cliente hoje sai da gaveta
    // de HOJE. Sem a sangria, o turno de hoje fechava sobrando exatamente o
    // valor devolvido — e o turno fechado mudava de cara depois de conferido.
    const dinheiroC = v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + centavos(p.valor), 0)
    let caixaDaSangria: string | null = null
    if (dinheiroC > 0) {
      const turnoDaVenda = v.caixaId ? await travarCaixaAberto(db, v.unidadeId, v.caixaId) : null
      if (!turnoDaVenda) {
        caixaDaSangria = await travarCaixaAberto(db, v.unidadeId)
        if (!caixaDaSangria) return { ok: false as const, motivo: 'caixa_fechado' as const }
      }
    }

    // ── 1. o estoque volta ──
    // Uma DEVOLUCAO por item, apontando para a venda. Assim o histórico do
    // produto mostra os dois movimentos, um cancelando o outro, em vez de a
    // venda simplesmente sumir e o saldo "aparecer" sem explicação. Item
    // avulso não tem para onde voltar.
    for (const i of v.itens) {
      if (!i.variacaoId) continue
      await mexerEstoqueEm(db, sessao, {
        variacaoId: i.variacaoId,
        unidadeId: v.unidadeId,
        tipo: 'DEVOLUCAO',
        quantidade: Number(i.quantidade),
        referencia: v.id,
        motivo: `Cancelamento da venda ${v.numero}`,
      })
    }

    // ── 2. os pontos voltam ao que eram ──
    // O que a venda deu, sai; o que ela gastou, volta. Uma escrita só no saldo,
    // com o delta — mesma razão da venda: duas cancelando ao mesmo tempo não
    // podem se atropelar.
    const delta = v.pontosUsados - v.pontosGanhos
    if (v.clienteId && delta !== 0) {
      const depois = await db.cliente.update({
        where: { id: v.clienteId },
        data: { pontos: { increment: delta } },
        select: { pontos: true },
      })
      await db.movimentoPontos.create({
        data: {
          orgId: sessao.orgId,
          clienteId: v.clienteId,
          tipo: 'AJUSTE',
          pontos: delta,
          saldoDepois: depois.pontos,
          vendaId: v.id,
          motivo: `Cancelamento da venda ${v.numero}`,
          quem: sessao.nome,
        },
      })
    }

    // ── 2.1 o vale volta a valer ──
    // A venda paga com vale descontou o saldo dele. Cancelada, a venda some
    // de todo lugar — e o cliente perdia o vale junto.
    const notas: string[] = []
    for (const p of v.pagamentos) {
      if (p.forma !== 'VALE' || !p.valeId) continue
      await db.vale.update({
        where: { id: p.valeId },
        data: { saldo: { increment: p.valor }, usadoEm: null },
      })
      notas.push(`vale de ${mostrar(centavos(p.valor))} devolvido`)
    }

    // ── 2.2 o fiado deixa de existir ──
    // As parcelas continuavam em aberto depois do cancelamento: o cliente
    // seguia "devendo" uma venda que não aconteceu, e aparecia na cobrança e
    // no "fiado vencido" do painel. Sem recebimento nenhum (conferido acima),
    // apagar é seguro: não leva dinheiro de ninguém junto.
    //
    // E o apagar CONFERE de novo, na própria condição: só sai parcela sem
    // rastro nenhum (a mesma régua de `parcelaMexida`). Se alguma recebeu no
    // caminho (o recebimento também trava a venda, mas esta é a garantia), a
    // contagem não bate e o cancelamento inteiro volta — apagar parcela
    // recebida apagaria junto o recebimento, e o dinheiro que entrou na gaveta
    // ficaria sem dono.
    if (v.parcelas.length > 0) {
      const apagou = await db.parcela.deleteMany({
        where: { vendaId: v.id, pago: 0, juros: 0, multa: 0, desconto: 0, recebimentos: { none: {} } },
      })
      if (apagou.count !== v.parcelas.length) throw new ParcelaRecebidaNoCaminho()
      notas.push(`${plural(v.parcelas.length, 'parcela do crediário cancelada', 'parcelas do crediário canceladas')}`)
    }

    // ── 2.3 o dinheiro volta ao cliente pela gaveta de agora ──
    if (caixaDaSangria) {
      await db.caixaMovimento.create({
        data: {
          orgId: sessao.orgId,
          caixaId: caixaDaSangria,
          tipo: 'SANGRIA',
          valor: reais(dinheiroC),
          motivo: `Cancelamento da venda ${v.numero} (de um turno já fechado)`,
          quem: sessao.nome,
        },
      })
      notas.push(`${mostrar(dinheiroC)} devolvido em dinheiro pela gaveta aberta`)
    }

    // ── 3. a marca ──
    await db.venda.update({
      where: { id: v.id },
      data: { situacao: 'CANCELADA', canceladaEm: new Date(), motivoCancelamento: texto },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: v.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'venda.cancelou',
        alvoTipo: 'venda',
        alvoId: v.id,
        alvoNome: `Venda ${v.numero}`,
        valor: v.total,
        motivo: [texto, ...notas].join(' · '),
        assinado,
      },
    })

    return { ok: true as const, numero: v.numero, sangria: caixaDaSangria ? reais(dinheiroC) : 0 }
  })
}

// ─────────────────────────────────────────────────────────────
// AS REGRAS DO BALCÃO (Configurações)
// ─────────────────────────────────────────────────────────────

export type ConfigDoBalcaoNaEmpresa = {
  vendeSemEstoque: boolean
  valePorLoja: boolean
  creditoMaxParcelas: number
  creditoJurosPct: number
}

export async function configDoBalcao(sessao: Sessao): Promise<ConfigDoBalcaoNaEmpresa> {
  const o = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: { vendeSemEstoque: true, valePorLoja: true, creditoMaxParcelas: true, creditoJurosPct: true },
    }),
  )
  return { ...o, creditoJurosPct: Number(o.creditoJurosPct) }
}

/**
 * Grava as regras do balcão. É regra de dinheiro e de estoque da empresa
 * inteira — quem configura a empresa, e com linha no livro mostrando o antes
 * e o depois ("quem ligou a venda sem estoque?" tem resposta).
 */
export async function salvarConfigDoBalcao(sessao: Sessao, c: ConfigDoBalcaoNaEmpresa): Promise<ConfigDoBalcaoNaEmpresa> {
  exigir(sessao, 'empresa.configurar')
  const novo: ConfigDoBalcaoNaEmpresa = {
    vendeSemEstoque: !!c.vendeSemEstoque,
    valePorLoja: !!c.valePorLoja,
    creditoMaxParcelas: Math.min(Math.max(Math.round(Number(c.creditoMaxParcelas) || 1), 1), 24),
    // Juro de parcelamento acima de 20% é dedo errado, não política.
    creditoJurosPct: Math.min(Math.max(Math.round((Number(c.creditoJurosPct) || 0) * 100) / 100, 0), 20),
  }
  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.org.findUniqueOrThrow({
      where: { id: sessao.orgId },
      select: { vendeSemEstoque: true, valePorLoja: true, creditoMaxParcelas: true, creditoJurosPct: true },
    })
    await db.org.update({ where: { id: sessao.orgId }, data: novo })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.configurou',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        alvoNome: 'balcão',
        antes: { ...antes, creditoJurosPct: Number(antes.creditoJurosPct) },
        depois: novo,
      },
    })
  })
  return novo
}
