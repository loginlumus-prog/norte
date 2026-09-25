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

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, type Sessao } from './permissao'
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

/**
 * O erro é o do índice "um caixa aberto por loja"?
 *
 * Olha o NOME do índice, e não só o código P2002: outro índice único que um
 * dia apareça em `caixas` não pode virar "já tem caixa aberto" por engano.
 */
export function ehCaixaJaAberto(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const x = e as { code?: unknown; meta?: unknown; message?: unknown }
  if (x.code !== 'P2002' && x.code !== '23505') return false
  return `${JSON.stringify(x.meta ?? null)} ${String(x.message ?? '')}`.includes('caixas_um_aberto_por_unidade')
}

export async function abrirCaixa(
  sessao: Sessao,
  unidadeId: string,
  saldoAbertura: number,
): Promise<Abertura> {
  exigir(sessao, 'caixa.operar', unidadeId)
  // `NaN` e negativo não são troco de gaveta: o primeiro estourava lá dentro
  // com o erro cru do conversor de dinheiro; o segundo abria o turno com uma
  // "falta" que ninguém tirou.
  if (!Number.isFinite(saldoAbertura) || saldoAbertura < 0) {
    throw new Error('O troco da abertura precisa ser um valor, zero ou mais.')
  }

  // Confere fora da transação: dois caixas abertos na mesma loja seria um
  // estado sem conserto, e recusar é resposta esperada, não erro.
  const jaAberto = await caixaAberto(sessao, unidadeId)
  if (jaAberto) {
    return { ok: false, motivo: 'ja_aberto', caixaId: jaAberto.id, abertoPor: jaAberto.abertoPor }
  }

  // A conferência de cima é a resposta educada; esta é a garantia. Dois
  // cliques em "Abrir caixa" (ou duas máquinas na mesma loja) passavam juntos
  // pela conferência e abriam dois turnos — e aí a venda cai num, o dinheiro
  // é contado no outro, e a gaveta nunca mais bate. A trava por loja faz o
  // segundo esperar o primeiro e encontrar o caixa já aberto.
  //
  // E por baixo da trava, o banco: o índice único parcial
  // `caixas_um_aberto_por_unidade` recusa o segundo aberto venha de onde vier
  // (script, rotina, código que esqueceu a trava). Se ele disparar aqui, a
  // resposta é a mesma de sempre — "já está aberto", com quem abriu —, e não
  // um erro de máquina na cara de quem está no balcão.
  let caixa: { jaAberto?: { id: string; abertoPor: string }; criado?: { id: string } }
  try {
    caixa = await abrirNaTrava(sessao, unidadeId, saldoAbertura)
  } catch (e) {
    if (!ehCaixaJaAberto(e)) throw e
    // A transação que estourou já morreu; a leitura é outra, fora dela.
    const outro = await caixaAberto(sessao, unidadeId)
    if (!outro) throw e
    return { ok: false, motivo: 'ja_aberto', caixaId: outro.id, abertoPor: outro.abertoPor }
  }

  if (caixa.jaAberto) {
    return { ok: false, motivo: 'ja_aberto', caixaId: caixa.jaAberto.id, abertoPor: caixa.jaAberto.abertoPor }
  }
  return { ok: true, caixaId: caixa.criado!.id }
}

function abrirNaTrava(sessao: Sessao, unidadeId: string, saldoAbertura: number) {
  return comoOrg(sessao.orgId, async (db) => {
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`abrir-caixa:${unidadeId}`}))`
    const outro = await db.caixa.findFirst({
      where: { unidadeId, aberto: true },
      select: { id: true, abertoPor: true },
    })
    if (outro) return { jaAberto: outro }
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
    return { criado }
  })
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
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('O valor precisa ser maior que zero.')
  if (tipo !== 'SANGRIA' && tipo !== 'SUPRIMENTO') throw new Error('Isso não é sangria nem suprimento.')

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
  /** Parcela de crediário recebida em dinheiro neste turno. Entra na gaveta. */
  dinheiroRecebido: number
  /** Crediário recebido em todas as formas — para a pessoa conferir. */
  recebidoCrediario: number
  suprimentos: number
  sangrias: number
  esperado: number
  /** Total de todas as formas — para a pessoa conferir a maquininha depois. */
  vendidoTotal: number
  porForma: { forma: string; total: number }[]
  vendas: number
}

/**
 * Quanto deveria ter na gaveta agora.
 *
 * Confere a LOJA do caixa: sem isso, qualquer sessão lia a gaveta de
 * qualquer loja pelo id — quanto entrou em dinheiro, quanto saiu em sangria.
 */
export async function conferirCaixa(sessao: Sessao, caixaId: string): Promise<Conferencia> {
  exigir(sessao, 'caixa.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const dono = await db.caixa.findUnique({ where: { id: caixaId }, select: { unidadeId: true } })
    if (!dono) throw new CaixaFechado()
    exigir(sessao, 'caixa.ver', dono.unidadeId)
    return conferirEm(db, caixaId)
  })
}

/** A conta da gaveta, dentro de uma transação que já está aberta. */
async function conferirEm(db: BancoDaOrg, caixaId: string): Promise<Conferencia> {
  {
    const caixa = await db.caixa.findUnique({
      where: { id: caixaId },
      select: { saldoAbertura: true },
    })

    const movs = await db.caixaMovimento.groupBy({ by: ['tipo'], where: { caixaId }, _sum: { valor: true } })
    const formas = await db.$queryRaw<{ forma: string; total: string }[]>`
      select p.forma::text as forma, sum(p.valor) as total
        from pagamentos p join vendas v on v.id = p.venda_id
       where v.caixa_id = ${caixaId} and v.situacao = 'CONCLUIDA'
       group by 1 order by 2 desc
    `
    const totalVendas = await db.venda.count({ where: { caixaId, situacao: 'CONCLUIDA' } })
    // A parcela recebida no balcão é dinheiro que entrou pela mesma gaveta.
    const recebidos = await db.recebimento.groupBy({ by: ['forma'], where: { caixaId }, _sum: { valor: true } })

    const soma = (t: TipoCaixa) =>
      centavos(movs.find((m) => m.tipo === t)?._sum.valor ?? 0)

    const aberturaC = centavos(caixa?.saldoAbertura ?? 0)
    const dinheiroC = centavos(formas.find((f) => f.forma === 'DINHEIRO')?.total ?? 0)
    const recebidoDinheiroC = centavos(recebidos.find((r) => r.forma === 'DINHEIRO')?._sum.valor ?? 0)
    const recebidoC = recebidos.reduce((s, r) => s + centavos(r._sum.valor ?? 0), 0)
    const supC = soma('SUPRIMENTO')
    const sanC = soma('SANGRIA')

    return {
      abertura: reais(aberturaC),
      dinheiroVendido: reais(dinheiroC),
      dinheiroRecebido: reais(recebidoDinheiroC),
      recebidoCrediario: reais(recebidoC),
      suprimentos: reais(supC),
      sangrias: reais(sanC),
      esperado: reais(aberturaC + dinheiroC + recebidoDinheiroC + supC - sanC),
      vendidoTotal: reais(formas.reduce((s, f) => s + centavos(f.total), 0)),
      porForma: formas.map((f) => ({ forma: f.forma, total: reais(centavos(f.total)) })),
      vendas: totalVendas,
    }
  }
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
  if (!Number.isFinite(saldoContado) || saldoContado < 0) {
    throw new Error('O contado na gaveta precisa ser um valor, zero ou mais.')
  }
  const contadoC = centavos(saldoContado)

  return comoOrg(sessao.orgId, async (db) => {
    const caixa = await db.caixa.findUnique({
      where: { id: caixaId },
      select: { unidadeId: true, aberto: true },
    })
    if (!caixa?.aberto) throw new CaixaFechado()
    exigir(sessao, 'caixa.operar', caixa.unidadeId)

    // O esperado é contado DENTRO da mesma transação do fechamento. Antes ele
    // vinha de uma leitura anterior, e a venda que entrasse entre a conta e o
    // fechamento ficava fora do esperado — a gaveta "sobrava" o valor dela.
    const conf = await conferirEm(db, caixaId)
    const esperadoC = centavos(conf.esperado)
    const difC = contadoC - esperadoC

    // Fecha só se ainda estiver aberto. Dois cliques em "Fechar" liam os dois
    // "aberto", e o livro ganhava dois fechamentos do mesmo turno.
    const fechou = await db.caixa.updateMany({
      where: { id: caixaId, aberto: true },
      data: {
        aberto: false,
        fechadoPor: sessao.nome,
        fechadoEm: new Date(),
        saldoEsperado: reais(esperadoC),
        saldoContado: reais(contadoC),
        observacoes,
      },
    })
    if (fechou.count === 0) throw new CaixaFechado()

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

    return { esperado: reais(esperadoC), contado: reais(contadoC), diferenca: reais(difC) }
  })
}

export class CaixaFechado extends Error {
  constructor() {
    super('Este caixa já foi fechado.')
    this.name = 'CaixaFechado'
  }
}

// ─────────────────────────────────────────────────────────────
// OS TURNOS QUE JÁ PASSARAM
// ─────────────────────────────────────────────────────────────
//
// O fechamento gravava a diferença no livro e ninguém lia. A pergunta que o
// dono faz é simples e tem que ter uma tela: "em qual turno faltou dinheiro,
// e quem estava no caixa?". É esta lista.

export type TurnoDeCaixa = {
  id: string
  unidade: string
  unidadeId: string
  aberto: boolean
  abertoPor: string
  abertoEm: Date
  fechadoPor: string | null
  fechadoEm: Date | null
  saldoAbertura: number
  saldoEsperado: number | null
  saldoContado: number | null
  /** Positiva sobra, negativa falta. Nula enquanto está aberto. */
  diferenca: number | null
  observacoes: string | null
  vendas: number
  vendido: number
  sangrias: number
  suprimentos: number
  /** Horas desde que abriu. Turno aberto há mais de um dia é esquecimento. */
  horasAberto: number
}

export async function listarCaixas(
  sessao: Sessao,
  f: { unidadeIds: string[]; de: Date; ate: Date },
): Promise<TurnoDeCaixa[]> {
  exigir(sessao, 'caixa.ver')

  // A unidade vem do endereço. Só as que a pessoa pode ver.
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'caixa.ver', u))
  if (permitidas.length === 0) return []

  return comoOrg(sessao.orgId, async (db) => {
    // Uma consulta só, com os totais por turno calculados no banco. Buscar os
    // turnos e depois somar as vendas de cada um seriam duzentas idas ao banco
    // para uma tela de lista.
    const linhas = await db.$queryRaw<
      {
        id: string
        unidade: string
        unidade_id: string
        aberto: boolean
        aberto_por: string
        aberto_em: Date
        fechado_por: string | null
        fechado_em: Date | null
        saldo_abertura: string
        saldo_esperado: string | null
        saldo_contado: string | null
        observacoes: string | null
        vendas: number
        vendido: string
        sangrias: string
        suprimentos: string
      }[]
    >`
      select c.id, u.nome as unidade, c.unidade_id, c.aberto, c.aberto_por, c.aberto_em,
             c.fechado_por, c.fechado_em, c.saldo_abertura, c.saldo_esperado, c.saldo_contado,
             c.observacoes,
             (select count(*) from vendas v where v.caixa_id = c.id and v.situacao = 'CONCLUIDA')::int as vendas,
             (select coalesce(sum(v.total), 0) from vendas v where v.caixa_id = c.id and v.situacao = 'CONCLUIDA') as vendido,
             (select coalesce(sum(m.valor), 0) from caixa_movimentos m where m.caixa_id = c.id and m.tipo = 'SANGRIA') as sangrias,
             (select coalesce(sum(m.valor), 0) from caixa_movimentos m where m.caixa_id = c.id and m.tipo = 'SUPRIMENTO') as suprimentos
        from caixas c
        join unidades u on u.id = c.unidade_id
       where c.unidade_id = any(${permitidas})
         and (c.aberto or (c.aberto_em >= ${f.de} and c.aberto_em < ${f.ate}))
       order by c.aberto desc, c.aberto_em desc
       limit 300
    `

    const agora = Date.now()
    return linhas.map((l) => {
      const esperado = l.saldo_esperado === null ? null : reais(centavos(l.saldo_esperado))
      const contado = l.saldo_contado === null ? null : reais(centavos(l.saldo_contado))
      return {
        id: l.id,
        unidade: l.unidade,
        unidadeId: l.unidade_id,
        aberto: l.aberto,
        abertoPor: l.aberto_por,
        abertoEm: l.aberto_em,
        fechadoPor: l.fechado_por,
        fechadoEm: l.fechado_em,
        saldoAbertura: reais(centavos(l.saldo_abertura)),
        saldoEsperado: esperado,
        saldoContado: contado,
        diferenca:
          esperado !== null && contado !== null ? reais(centavos(contado) - centavos(esperado)) : null,
        observacoes: l.observacoes,
        vendas: Number(l.vendas),
        vendido: reais(centavos(l.vendido)),
        sangrias: reais(centavos(l.sangrias)),
        suprimentos: reais(centavos(l.suprimentos)),
        horasAberto: (agora - new Date(l.aberto_em).getTime()) / 36e5,
      }
    })
  })
}

/** Os movimentos de um turno, para a ficha dele. */
export async function movimentosDoCaixa(sessao: Sessao, caixaId: string) {
  exigir(sessao, 'caixa.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const caixa = await db.caixa.findUnique({ where: { id: caixaId }, select: { unidadeId: true } })
    if (!caixa || !pode(sessao, 'caixa.ver', caixa.unidadeId)) return []
    const movs = await db.caixaMovimento.findMany({
      where: { caixaId },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, tipo: true, valor: true, motivo: true, quem: true, criadoEm: true },
    })
    return movs.map((m) => ({ ...m, valor: Number(m.valor) }))
  })
}
