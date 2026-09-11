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
//    quem passa dele.

import { comoOrg } from './banco'
import type { SituacaoVenda } from '@prisma/client'
import { exigir, pode, PODERES, type Papel, type Sessao } from './permissao'
import { mexerEstoqueEm } from './estoque'
import { centavos, reais, multiplicar, mostrar } from './dinheiro'
import { tabelaDe, precoNaTabela, ROTULO_TABELA, type Tabela } from './preco'
import { normalizarCodigo, venceu } from './devolucao'
import { montarParcelas } from './crediario'
import {
  programaDe,
  conferirUso,
  pontosGanhos as calcularGanho,
  RECADO_PONTOS,
  DESLIGADO,
} from './pontos'
import type { FormaPagamento } from '@prisma/client'

export type ItemDaVenda = {
  /** Nulo = item avulso, fora do catálogo. Aí `avulso` é obrigatório. */
  variacaoId: string | null
  quantidade: number
  /** Se não vier, usa o preço do produto conforme a forma de pagamento. */
  precoUnit?: number
  desconto?: number
  /**
   * Item que não existe no cadastro: um conserto, uma peça que ninguém
   * cadastrou, um serviço. Não mexe em estoque. Só quem pode passar do teto
   * de desconto lança — preço digitado na hora é o mesmo buraco que desconto
   * sem teto, e leva a mesma trava.
   */
  avulso?: { descricao: string; precoUnit: number }
}

export type PagamentoDaVenda = {
  forma: FormaPagamento
  valor: number
  parcelas?: number
  referencia?: string
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
  observacoes?: string
}

export type ResultadoVenda =
  | {
      ok: true
      vendaId: string
      numero: number
      total: number
      pontosUsados: number
      pontosGanhos: number
    }
  | { ok: false; motivo: 'sem_itens' }
  | { ok: false; motivo: 'sem_estoque'; faltando: { descricao: string; pedido: number; tem: number }[] }
  | { ok: false; motivo: 'pagamento_nao_fecha'; total: number; pago: number }
  | { ok: false; motivo: 'caixa_fechado' }
  | { ok: false; motivo: 'desconto_acima_do_teto'; percentual: number; teto: number }
  | { ok: false; motivo: 'pontos_recusados'; recado: string }
  | { ok: false; motivo: 'avulso_negado' }
  | { ok: false; motivo: 'vendedor_invalido' }
  | { ok: false; motivo: 'vale_recusado'; recado: string }
  | { ok: false; motivo: 'crediario_recusado'; recado: string }

/** Os papéis que podem vender. Derivado da tabela de poderes, não escrito à mão. */
const PAPEIS_QUE_VENDEM = (Object.keys(PODERES) as Papel[]).filter((p) =>
  PODERES[p].includes('venda.criar'),
)

export async function registrarVenda(
  sessao: Sessao,
  v: NovaVenda,
): Promise<ResultadoVenda> {
  exigir(sessao, 'venda.criar', v.unidadeId)

  if (v.itens.length === 0) return { ok: false, motivo: 'sem_itens' }

  // ── 0. item avulso é privilégio, não é atalho ──
  // Quem lança "Conserto — R$ 30" está inventando um preço. É exatamente o
  // que o teto de desconto existe para impedir, então a trava é a mesma.
  const avulsos = v.itens.filter((i) => !i.variacaoId)
  if (avulsos.length > 0) {
    if (!pode(sessao, 'venda.desconto', v.unidadeId)) return { ok: false, motivo: 'avulso_negado' }
    for (const a of avulsos) {
      if (!a.avulso || !a.avulso.descricao.trim() || !(a.avulso.precoUnit >= 0) || !(a.quantidade > 0)) {
        return { ok: false, motivo: 'avulso_negado' }
      }
    }
  }
  const doCatalogo = v.itens.filter((i): i is ItemDaVenda & { variacaoId: string } => !!i.variacaoId)

  // A forma de pagamento escolhe a tabela de preço. Decidido aqui, uma vez,
  // e usado em todo item — ver preco.ts.
  const tabela: Tabela = tabelaDe(v.pagamentos.map((p) => p.forma))

  return comoOrg(sessao.orgId, async (db) => {
    const empresa = await db.org.findUnique({
      where: { id: sessao.orgId },
      select: {
        descontoMaximo: true, modulos: true,
        pontosAtivo: true, pontosPorReal: true, pontoVale: true, pontosMinimo: true,
        crediarioMaxParcelas: true, crediarioDiasEntre: true,
      },
    })
    const teto = Number(empresa?.descontoMaximo ?? 0)
    const programa = empresa ? programaDe(empresa) : DESLIGADO

    // ── 0.2 crediário é módulo, e é dívida com nome ──
    // Sem o módulo, a forma não existe. Com ele, precisa de cliente — não há
    // para quem cobrar uma parcela sem nome — e cabe no máximo de vezes que
    // a loja decidiu.
    const fiado = v.pagamentos.filter((p) => p.forma === 'CREDIARIO')
    if (fiado.length > 0) {
      if (!empresa?.modulos.includes('crediario')) {
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
          acessos: { select: { papel: true, unidadeId: true, expiraEm: true } },
        },
      })
      const podeVender =
        !!pessoa?.ativo &&
        pessoa.acessos.some(
          (a) =>
            (!a.expiraEm || a.expiraEm > agora) &&
            PAPEIS_QUE_VENDEM.includes(a.papel as Papel) &&
            (a.unidadeId === null || a.unidadeId === v.unidadeId),
        )
      if (!podeVender) return { ok: false as const, motivo: 'vendedor_invalido' as const }
      vendedor = { id: v.vendedorId, nome: pessoa!.nome }
    }

    // ── 1. o que está sendo vendido, com preço e custo de agora ──
    const variacoes = await db.variacao.findMany({
      where: { id: { in: doCatalogo.map((i) => i.variacaoId) } },
      select: {
        id: true, codigo: true, ajustePreco: true,
        produto: {
          select: {
            nome: true, medida: true, custo: true,
            precoVista: true, precoCartao: true, precoCrediario: true,
          },
        },
        opcoes: { select: { opcao: { select: { valor: true } } } },
      },
    })
    const porId = new Map(variacoes.map((x) => [x.id, x]))

    // ── 2. estoque: confere TUDO antes de escrever qualquer coisa ──
    const saldos = await db.estoque.findMany({
      where: { unidadeId: v.unidadeId, variacaoId: { in: doCatalogo.map((i) => i.variacaoId) } },
      select: { variacaoId: true, quantidade: true },
    })
    const saldoDe = new Map(saldos.map((e) => [e.variacaoId, Number(e.quantidade)]))

    const faltando = doCatalogo
      .filter((i) => (saldoDe.get(i.variacaoId) ?? 0) < i.quantidade)
      .map((i) => ({
        descricao: descrever(porId.get(i.variacaoId)),
        pedido: i.quantidade,
        tem: saldoDe.get(i.variacaoId) ?? 0,
      }))
    if (faltando.length > 0) return { ok: false as const, motivo: 'sem_estoque' as const, faltando }

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
        _cent: totalCent,
        _tabelaCent: multiplicar(tabelaCent, i.quantidade),
      }
    })

    const subtotalCent = itens.reduce((s, i) => s + i._cent, 0)
    const descontoCent = centavos(v.desconto ?? 0)
    const totalCent = subtotalCent - descontoCent
    const pagoCent = v.pagamentos.reduce((s, p) => s + centavos(p.valor), 0)

    // ── 3.1 o desconto, medido contra a TABELA ──
    // Não contra o subtotal: o subtotal já embute o desconto dado no item, e
    // medir contra ele daria sempre zero — que é exatamente o buraco.
    const tabelaCent = itens.reduce((s, i) => s + i._tabelaCent, 0)
    const abatidoCent = tabelaCent - totalCent
    const percentual = tabelaCent > 0 ? (abatidoCent / tabelaCent) * 100 : 0

    if (totalCent < 0) {
      return { ok: false as const, motivo: 'desconto_acima_do_teto' as const, percentual, teto }
    }
    if (percentual > teto + 0.001 && !pode(sessao, 'venda.desconto', v.unidadeId)) {
      return {
        ok: false as const,
        motivo: 'desconto_acima_do_teto' as const,
        percentual: Math.round(percentual * 10) / 10,
        teto,
      }
    }

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

    const subtotal = reais(subtotalCent)
    const desconto = reais(descontoCent)
    const total = reais(aPagarCent)

    // O que a venda gera de pontos sai do que foi REALMENTE pago. Pontuar em
    // cima do preço cheio faria a loja pagar duas vezes pelo mesmo desconto.
    const ganhos = v.clienteId ? calcularGanho(aPagarCent, programa) : 0

    // Comparação entre inteiros: ou bate, ou não bate. Sem "quase".
    // E um centavo de diferença trava a venda de propósito — caixa que fecha
    // "quase certo" todo dia é caixa que ninguém confere mais.
    if (pagoCent !== aPagarCent) {
      return {
        ok: false as const,
        motivo: 'pagamento_nao_fecha' as const,
        total,
        pago: reais(pagoCent),
      }
    }

    if (v.caixaId) {
      const caixa = await db.caixa.findUnique({
        where: { id: v.caixaId },
        select: { aberto: true },
      })
      if (!caixa?.aberto) return { ok: false as const, motivo: 'caixa_fechado' as const }
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
        ? await db.vale.findFirst({ where: { codigo }, select: { id: true, saldo: true, validade: true } })
        : null
      if (!vale) {
        return { ok: false as const, motivo: 'vale_recusado' as const, recado: 'Vale não encontrado. Confira o código.' }
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
        caixaId: v.caixaId ?? null,
        clienteId: v.clienteId ?? null,
        numero,
        vendedorId: vendedor.id,
        vendedorNome: vendedor.nome,
        situacao: 'CONCLUIDA',
        subtotal,
        desconto,
        descontoPontos: reais(pontosCent),
        pontosUsados,
        pontosGanhos: ganhos,
        total,
        observacoes: v.observacoes,
        concluidaEm: new Date(),
        itens: {
          create: itens.map(({ _cent, _tabelaCent, ...i }) => ({ orgId: sessao.orgId, ...i })),
        },
        pagamentos: {
          create: v.pagamentos.map((p, i) => ({
            orgId: sessao.orgId,
            forma: p.forma,
            valor: reais(centavos(p.valor)),
            parcelas: p.parcelas ?? 1,
            referencia: p.forma === 'VALE' ? normalizarCodigo(p.referencia ?? '') : p.referencia,
            valeId: valeDoPagamento.get(i) ?? null,
          })),
        },
      },
      select: { id: true, numero: true },
    })

    // ── 5.1 as parcelas do crediário ──
    // Nascem junto com a venda, na mesma transação: venda fiada sem parcela
    // escrita é o caderno que some.
    if (fiado.length > 0 && v.clienteId) {
      const p = fiado[0]!
      const parcelas = montarParcelas(
        centavos(p.valor),
        p.parcelas ?? 1,
        new Date(),
        empresa?.crediarioDiasEntre ?? 30,
      )
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
    }

    // ── 6. baixa o estoque, na MESMA transação ──
    // Só o que é do catálogo: item avulso não tem de onde sair.
    for (const i of doCatalogo) {
      const r = await mexerEstoqueEm(db, sessao, {
        variacaoId: i.variacaoId,
        unidadeId: v.unidadeId,
        tipo: 'VENDA',
        quantidade: i.quantidade,
        referencia: venda.id,
        motivo: `Venda ${numero}`,
      })
      // Só chega aqui se alguém levou o estoque entre a conferência e agora.
      // Lançar desfaz a venda inteira — é rollback limpo, não erro de banco.
      if (!r.ok) throw new EstoqueSumiu(i.variacaoId)
    }

    // ── 6.1 os pontos ──
    // Duas escritas: o extrato (que é a verdade) e o saldo do cliente (que é
    // a conta rápida que o balcão lê). Dentro da MESMA transação da venda: se
    // qualquer coisa aqui falhar, a venda não aconteceu — o contrário criaria
    // venda com pontos cobrados e não creditados, ou pior, o inverso.
    if (v.clienteId && (pontosUsados > 0 || ganhos > 0)) {
      // Uma escrita só para o saldo, com o delta. Ler-somar-gravar abriria
      // corrida entre duas vendas do mesmo cliente em caixas diferentes.
      const depois = await db.cliente.update({
        where: { id: v.clienteId },
        data: { pontos: { increment: ganhos - pontosUsados } },
        select: { pontos: true },
      })

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
        // Desconto entra no livro com o número. É o que permite ao dono
        // perguntar depois "quem andou dando 40%?" e ter resposta. E quando
        // quem vendeu não é quem registrou, os dois nomes ficam.
        motivo:
          [
            abatidoCent > 0 ? `desconto ${(Math.round(percentual * 10) / 10).toFixed(1)}%` : null,
            avulsos.length > 0 ? `${avulsos.length} item(ns) avulso(s)` : null,
            vendedor.id !== sessao.usuarioId ? `vendedor: ${vendedor.nome}` : null,
            tabela !== 'vista' ? `preço ${ROTULO_TABELA[tabela]}` : null,
            fiado.length > 0 ? `crediário em ${fiado[0]!.parcelas ?? 1}×` : null,
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
    }
  })
}

/** Dois caixas gastaram o mesmo vale no mesmo instante. Raro, e a venda não pode ficar. */
export class ValeDisputado extends Error {
  constructor(readonly valeId: string) {
    super('O vale acabou de ser usado em outro caixa. Nada foi gravado.')
    this.name = 'ValeDisputado'
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

export async function listarVendas(sessao: Sessao, f: FiltroVendas): Promise<VendaNaLista[]> {
  exigir(sessao, 'venda.ver')

  // A unidade vem do endereço, e o endereço é de quem digita. Só entram as
  // unidades em que a pessoa pode VER venda — o gerente da loja 3 não lista a
  // loja 5 trocando o número na URL.
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'venda.ver', u))
  if (permitidas.length === 0) return []

  const q = f.q?.trim() ?? ''
  const numero = /^\d+$/.test(q) ? Number(q) : null

  return comoOrg(sessao.orgId, async (db) => {
    const vendas = await db.venda.findMany({
      where: {
        unidadeId: { in: permitidas },
        criadaEm: { gte: f.de, lt: f.ate },
        ...(f.situacao ? { situacao: f.situacao } : {}),
        ...(f.vendedorId ? { vendedorId: f.vendedorId } : {}),
        ...(f.forma ? { pagamentos: { some: { forma: f.forma } } } : {}),
        ...(numero !== null
          ? { numero }
          : q
            ? { cliente: { nome: { contains: q, mode: 'insensitive' } } }
            : {}),
      },
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
export async function listarItensVendidos(sessao: Sessao, f: FiltroVendas): Promise<ItemVendido[]> {
  exigir(sessao, 'venda.ver')
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'venda.ver', u))
  if (permitidas.length === 0) return []
  const q = f.q?.trim() ?? ''
  const numero = /^\d+$/.test(q) ? Number(q) : null

  return comoOrg(sessao.orgId, async (db) => {
    const itens = await db.vendaItem.findMany({
      where: {
        venda: {
          unidadeId: { in: permitidas },
          criadaEm: { gte: f.de, lt: f.ate },
          ...(f.situacao ? { situacao: f.situacao } : {}),
          ...(f.vendedorId ? { vendedorId: f.vendedorId } : {}),
          ...(f.forma ? { pagamentos: { some: { forma: f.forma } } } : {}),
          ...(numero !== null ? { numero } : q ? { cliente: { nome: { contains: q, mode: 'insensitive' } } } : {}),
        },
      },
      orderBy: [{ venda: { criadaEm: 'desc' } }, { id: 'asc' }],
      take: 5000,
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
      custoUnit: i.custoUnit === null ? null : Number(i.custoUnit),
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
          include: { devolucoes: { select: { quantidade: true } } },
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
          select: { id: true, numero: true, de: true, vencimento: true, valor: true, pago: true, quitadaEm: true },
        },
        cliente: { select: { id: true, nome: true, telefone: true } },
        unidade: { select: { id: true, nome: true } },
        caixa: { select: { id: true, aberto: true } },
      },
    }),
  )
  // Achar por id passa pelo RLS (só vem venda desta empresa), mas a unidade
  // ainda precisa ser conferida: gerente de uma loja não abre venda da outra.
  if (!v || !pode(sessao, 'venda.ver', v.unidadeId)) return null
  return v
}

export type Cancelamento =
  | { ok: true; numero: number }
  | { ok: false; motivo: 'nao_achada' | 'ja_cancelada' | 'sem_motivo' }

/**
 * Desfaz uma venda: o estoque volta, os pontos voltam, e a venda fica marcada
 * — nunca apagada. Cancelar é evento, e evento fica no livro.
 *
 * ── o que NÃO acontece aqui ──────────────────────────────────
 * O dinheiro não volta sozinho. Se a venda foi em Pix ou cartão, devolver é
 * ato de gente, feito por fora, e o sistema não tem como saber se aconteceu.
 * Por isso o motivo é obrigatório: é ele que, no livro, conta o que foi feito
 * com o dinheiro.
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
): Promise<Cancelamento> {
  const texto = motivo.trim()
  if (texto.length < 3) return { ok: false, motivo: 'sem_motivo' }

  return comoOrg(sessao.orgId, async (db) => {
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
        itens: { select: { variacaoId: true, quantidade: true } },
      },
    })
    if (!v) return { ok: false as const, motivo: 'nao_achada' as const }

    // Conferido DEPOIS de achar, porque a unidade da venda é o que decide.
    exigir(sessao, 'venda.cancelar', v.unidadeId)

    if (v.situacao === 'CANCELADA') return { ok: false as const, motivo: 'ja_cancelada' as const }

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
        motivo: texto,
      },
    })

    return { ok: true as const, numero: v.numero }
  })
}
