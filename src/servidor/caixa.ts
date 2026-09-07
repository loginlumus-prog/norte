// O caixa do dia: abre, movimenta, fecha.
//
// ── por que venda precisa de caixa aberto ────────────────────
// Sem isso o dinheiro do dia não tem dono nem hora. Na hora que faltar R$ 50
// ninguém sabe em qual turno sumiu, e a conversa vira acusação sem prova.
// Com caixa, a diferença aparece no fechamento, com nome e horário.
//
// ── a conta do fechamento ────────────────────────────────────
//   esperado = abertura + vendas em dinheiro + suprimentos − sangrias
//
// Só DINHEIRO entra nessa conta. Cartão e Pix não passam pela gaveta, então
// somá-los faria o caixa "faltar" todo dia o valor das maquininhas — e caixa
// que falta todo dia é caixa que ninguém confere mais.

import { comoOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import type { TipoCaixa } from '@prisma/client'

export type CaixaAberto = {
  id: string
  abertoPor: string
  abertoEm: Date
  saldoAbertura: number
}

export async function caixaAberto(
  sessao: Sessao,
  unidadeId: string,
): Promise<CaixaAberto | null> {
  return comoOrg(sessao.orgId, (db) =>
    db.caixa.findFirst({
      where: { unidadeId, aberto: true },
      orderBy: { abertoEm: 'desc' },
      select: { id: true, abertoPor: true, abertoEm: true, saldoAbertura: true },
    }),
  ).then((c) => (c ? { ...c, saldoAbertura: Number(c.saldoAbertura) } : null))
}

export type Abertura =
  | { ok: true; caixaId: string }
  | { ok: false; motivo: 'ja_aberto'; caixaId: string; abertoPor: string }

export async function abrirCaixa(
  sessao: Sessao,
  unidadeId: string,
  saldoAbertura: number,
): Promise<Abertura> {
  exigir(sessao, 'caixa.operar', unidadeId)

  // Confere fora da transação: dois caixas abertos na mesma loja seria um
  // estado sem conserto, e recusar é resposta esperada, não erro.
  const jaAberto = await caixaAberto(sessao, unidadeId)
  if (jaAberto) {
    return { ok: false, motivo: 'ja_aberto', caixaId: jaAberto.id, abertoPor: jaAberto.abertoPor }
  }

  const caixa = await comoOrg(sessao.orgId, async (db) => {
    const criado = await db.caixa.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        abertoPorId: sessao.usuarioId,
        abertoPor: sessao.nome,
        saldoAbertura: reais(centavos(saldoAbertura)),
      },
      select: { id: true },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'caixa.abriu',
        alvoTipo: 'caixa',
        alvoId: criado.id,
        valor: saldoAbertura,
      },
    })
    return criado
  })

  return { ok: true, caixaId: caixa.id }
}

/** Sangria tira da gaveta; suprimento põe. Motivo é obrigatório nos dois. */
export async function movimentarCaixa(
  sessao: Sessao,
  caixaId: string,
  tipo: TipoCaixa,
  valor: number,
  motivo: string,
) {
  if (!motivo.trim()) throw new Error('Sangria e suprimento precisam de motivo.')
  if (valor <= 0) throw new Error('O valor precisa ser maior que zero.')

  await comoOrg(sessao.orgId, async (db) => {
    const caixa = await db.caixa.findUnique({
      where: { id: caixaId },
      select: { unidadeId: true, aberto: true },
    })
    if (!caixa?.aberto) throw new CaixaFechado()
    exigir(sessao, 'caixa.operar', caixa.unidadeId)

    await db.caixaMovimento.create({
      data: {
        orgId: sessao.orgId,
        caixaId,
        tipo,
        valor: reais(centavos(valor)),
        motivo: motivo.trim(),
        quem: sessao.nome,
      },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: caixa.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: tipo === 'SANGRIA' ? 'caixa.sangria' : 'caixa.suprimento',
        alvoTipo: 'caixa',
        alvoId: caixaId,
        valor,
        motivo: motivo.trim(),
      },
    })
  })
}

export type Conferencia = {
  abertura: number
  dinheiroVendido: number
  suprimentos: number
  sangrias: number
  esperado: number
  /** Total de todas as formas — para a pessoa conferir a maquininha depois. */
  vendidoTotal: number
  porForma: { forma: string; total: number }[]
  vendas: number
}

/** Quanto deveria ter na gaveta agora. */
export async function conferirCaixa(sessao: Sessao, caixaId: string): Promise<Conferencia> {
  return comoOrg(sessao.orgId, async (db) => {
    const caixa = await db.caixa.findUnique({
      where: { id: caixaId },
      select: { saldoAbertura: true },
    })

    const [movs, formas, totalVendas] = await Promise.all([
      db.caixaMovimento.groupBy({ by: ['tipo'], where: { caixaId }, _sum: { valor: true } }),
      db.$queryRaw<{ forma: string; total: string }[]>`
        select p.forma::text as forma, sum(p.valor) as total
          from pagamentos p join vendas v on v.id = p.venda_id
         where v.caixa_id = ${caixaId} and v.situacao = 'CONCLUIDA'
         group by 1 order by 2 desc
      `,
      db.venda.count({ where: { caixaId, situacao: 'CONCLUIDA' } }),
    ])

    const soma = (t: TipoCaixa) =>
      centavos(movs.find((m) => m.tipo === t)?._sum.valor ?? 0)

    const aberturaC = centavos(caixa?.saldoAbertura ?? 0)
    const dinheiroC = centavos(formas.find((f) => f.forma === 'DINHEIRO')?.total ?? 0)
    const supC = soma('SUPRIMENTO')
    const sanC = soma('SANGRIA')

    return {
      abertura: reais(aberturaC),
      dinheiroVendido: reais(dinheiroC),
      suprimentos: reais(supC),
      sangrias: reais(sanC),
      esperado: reais(aberturaC + dinheiroC + supC - sanC),
      vendidoTotal: reais(formas.reduce((s, f) => s + centavos(f.total), 0)),
      porForma: formas.map((f) => ({ forma: f.forma, total: reais(centavos(f.total)) })),
      vendas: totalVendas,
    }
  })
}

export type Fechamento = {
  esperado: number
  contado: number
  /** Positiva sobra, negativa falta. */
  diferenca: number
}

export async function fecharCaixa(
  sessao: Sessao,
  caixaId: string,
  saldoContado: number,
  observacoes?: string,
): Promise<Fechamento> {
  const conf = await conferirCaixa(sessao, caixaId)
  const esperadoC = centavos(conf.esperado)
  const contadoC = centavos(saldoContado)
  const difC = contadoC - esperadoC

  await comoOrg(sessao.orgId, async (db) => {
    const caixa = await db.caixa.findUnique({
      where: { id: caixaId },
      select: { unidadeId: true, aberto: true },
    })
    if (!caixa?.aberto) throw new CaixaFechado()
    exigir(sessao, 'caixa.operar', caixa.unidadeId)

    await db.caixa.update({
      where: { id: caixaId },
      data: {
        aberto: false,
        fechadoPor: sessao.nome,
        fechadoEm: new Date(),
        saldoEsperado: reais(esperadoC),
        saldoContado: reais(contadoC),
        observacoes,
      },
    })

    // A diferença vai para o livro SEMPRE, inclusive quando é zero: "fechou
    // certo" é informação, e quem confere no fim do mês precisa ver o dia que
    // bateu tanto quanto o dia que não bateu.
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: caixa.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'caixa.fechou',
        alvoTipo: 'caixa',
        alvoId: caixaId,
        valor: reais(difC),
        motivo: observacoes,
        antes: { esperado: reais(esperadoC) },
        depois: { contado: reais(contadoC) },
      },
    })
  })

  return { esperado: reais(esperadoC), contado: reais(contadoC), diferenca: reais(difC) }
}

export class CaixaFechado extends Error {
  constructor() {
    super('Este caixa já foi fechado.')
    this.name = 'CaixaFechado'
  }
}
