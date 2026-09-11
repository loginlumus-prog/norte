// Mexer no estoque.
//
// ── por que isto não é um `update` simples ────────────────────
// Duas vendas do mesmo item no mesmo segundo, em dois caixas: se cada uma ler
// o saldo, somar na memória e gravar, a segunda escreve por cima da primeira e
// uma das baixas desaparece. Com 3 peças em estoque, vende 4.
//
// A correção não é travar na aplicação (não funciona com mais de um servidor),
// é deixar o BANCO fazer a conta:
//
//     update estoque set quantidade = quantidade + $delta ...
//
// O Postgres trava a linha durante o update, então a segunda venda espera a
// primeira e soma sobre o valor já novo. Nunca sobre o valor que ela leu antes.
//
// ── e por que devolve resultado em vez de dar erro ────────────
// Estoque insuficiente é resposta esperada do negócio, não defeito. Quem chama
// decide o que fazer: o balcão avisa a vendedora, uma importação registra e
// segue. Erro fica para o que é erro mesmo.

import { comoOrg } from './banco'
import { exigir, pode, type Capacidade, type Sessao } from './permissao'
import type { TipoMovimento } from '@prisma/client'

/** Que permissão cada tipo de movimento exige. */
const EXIGE: Record<TipoMovimento, Capacidade> = {
  VENDA: 'venda.criar',
  DEVOLUCAO: 'venda.criar',
  ENTRADA: 'estoque.ajustar',
  AJUSTE: 'estoque.ajustar',
  PERDA: 'estoque.ajustar',
  TRANSFERENCIA: 'estoque.ajustar',
  BALANCO: 'estoque.ajustar',
}

/** Movimentos que TIRAM do estoque precisam de saldo. */
const TIRA: TipoMovimento[] = ['VENDA', 'PERDA', 'TRANSFERENCIA']

export type Movimento = {
  variacaoId: string
  unidadeId: string
  tipo: TipoMovimento
  /** Sempre positiva. O sinal vem do tipo, não de quem chama. */
  quantidade: number
  motivo?: string
  /** Id da venda, da entrada de mercadoria, do que originou. */
  referencia?: string
  /**
   * Deixa o saldo ficar negativo. Só para importação de sistema antigo, onde
   * a bagunça já existe e travar impediria a migração.
   */
  permitirNegativo?: boolean
}

export type Resultado =
  | { ok: true; saldo: number }
  | { ok: false; motivo: 'sem_saldo'; saldo: number }

/**
 * Um movimento, atômico: ajusta o saldo e grava no histórico, ou não faz nada.
 *
 * `BALANCO` é diferente dos outros: a quantidade informada é o saldo CONTADO
 * na prateleira, não a diferença. O sistema calcula o ajuste sozinho.
 */
export async function mexerEstoque(
  sessao: Sessao,
  m: Movimento,
): Promise<Resultado> {
  // O `!` é seguro: EXIGE é Record sobre o enum inteiro, então o TypeScript
  // já garante que todo tipo tem entrada. O aviso vem de noUncheckedIndexedAccess,
  // que trata toda indexação como possivelmente vazia.
  exigir(sessao, EXIGE[m.tipo]!, m.unidadeId)
  return comoOrg(sessao.orgId, (db) => mexerEstoqueEm(db, sessao, m))
}

/**
 * A mesma coisa, DENTRO de uma transação que já está aberta.
 *
 * A venda precisa disto: baixar o estoque e gravar a venda têm que acontecer
 * juntos ou não acontecer — senão dá para o estoque baixar e a venda sumir.
 * Como transação não aninha, quem já abriu uma passa o `db` para cá.
 *
 * A permissão é conferida por quem chama (a venda confere `venda.criar` uma
 * vez, e não uma vez por item).
 */
export async function mexerEstoqueEm(
  db: any,
  sessao: Sessao,
  m: Movimento,
): Promise<Resultado> {
  if (m.quantidade < 0) {
    throw new Error('Quantidade é sempre positiva — o sinal vem do tipo do movimento.')
  }

  return (async () => {
    // Garante que a linha de saldo existe, sem correr risco de duas criarem
    // ao mesmo tempo (o índice único resolve; `do nothing` engole o empate).
    await db.$executeRaw`
      insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em)
      values (gen_random_uuid()::text, ${sessao.orgId}, ${m.variacaoId}, ${m.unidadeId}, 0, now())
      on conflict (variacao_id, unidade_id) do nothing
    `

    // BALANCO informa o contado; o delta é a diferença para o que está gravado.
    let delta: number
    if (m.tipo === 'BALANCO') {
      const atual = await saldoDe(db, m.variacaoId, m.unidadeId)
      delta = m.quantidade - atual
    } else {
      delta = TIRA.includes(m.tipo) ? -m.quantidade : m.quantidade
    }

    const permite = m.permitirNegativo || m.tipo === 'BALANCO'

    // A conta acontece DENTRO do banco. É isto que impede a venda dupla.
    const linhas = await db.$queryRaw<{ quantidade: string }[]>`
      update estoque
         set quantidade = quantidade + ${delta}::numeric,
             atualizado_em = now()
       where variacao_id = ${m.variacaoId}
         and unidade_id = ${m.unidadeId}
         and (${permite} or quantidade + ${delta}::numeric >= 0)
      returning quantidade
    `

    if (linhas.length === 0) {
      // Nenhuma linha atualizada = a trava do saldo barrou. Não é erro:
      // a transação continua íntegra e quem chamou decide o que fazer.
      return { ok: false as const, motivo: 'sem_saldo' as const, saldo: await saldoDe(db, m.variacaoId, m.unidadeId) }
    }

    const saldo = Number(linhas[0]!.quantidade)

    await db.movimentoEstoque.create({
      data: {
        orgId: sessao.orgId,
        variacaoId: m.variacaoId,
        unidadeId: m.unidadeId,
        tipo: m.tipo,
        quantidade: delta,
        saldoDepois: saldo,
        motivo: m.motivo,
        referencia: m.referencia,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
      },
    })

    return { ok: true as const, saldo }
  })()
}

async function saldoDe(db: any, variacaoId: string, unidadeId: string): Promise<number> {
  const r = await db.$queryRaw<{ quantidade: string }[]>`
    select quantidade from estoque
     where variacao_id = ${variacaoId} and unidade_id = ${unidadeId}
  `
  return r.length ? Number(r[0]!.quantidade) : 0
}

/** Saldo de uma variação numa unidade. */
export async function saldo(sessao: Sessao, variacaoId: string, unidadeId: string) {
  return comoOrg(sessao.orgId, (db) => saldoDe(db, variacaoId, unidadeId))
}

// ─────────────────────────────────────────────────────────────
// O HISTÓRICO
// ─────────────────────────────────────────────────────────────
//
// Todo movimento fica gravado desde o primeiro dia e não tinha onde ser
// lido. "Quem deu baixa de 30 camisetas na terça?" é a pergunta que decide
// se o estoque é confiável ou é um número.

export type FiltroMovimentos = {
  unidadeIds: string[]
  de: Date
  /** Exclusivo. */
  ate: Date
  tipos?: TipoMovimento[] | null
  /** Nome do produto ou etiqueta. */
  q?: string | null
  variacaoId?: string | null
  /** Todos os itens de um produto — a ficha dele usa. */
  produtoId?: string | null
}

export type MovimentoNaLista = {
  id: string
  criadoEm: Date
  tipo: TipoMovimento
  quantidade: number
  saldoDepois: number
  motivo: string | null
  referencia: string | null
  quem: string
  unidade: string
  unidadeId: string
  variacaoId: string
  descricao: string
  codigo: string | null
  medida: string
}

export async function listarMovimentos(sessao: Sessao, f: FiltroMovimentos): Promise<MovimentoNaLista[]> {
  exigir(sessao, 'estoque.ver')
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'estoque.ver', u))
  if (permitidas.length === 0) return []
  const q = f.q?.trim() ?? ''

  const variacao = {
    ...(f.produtoId ? { produtoId: f.produtoId } : {}),
    ...(q
      ? {
          OR: [
            { codigo: { equals: q, mode: 'insensitive' as const } },
            { produto: { nome: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.movimentoEstoque.findMany({
      where: {
        unidadeId: { in: permitidas },
        criadoEm: { gte: f.de, lt: f.ate },
        ...(f.tipos && f.tipos.length ? { tipo: { in: f.tipos } } : {}),
        ...(f.variacaoId ? { variacaoId: f.variacaoId } : {}),
        ...(Object.keys(variacao).length ? { variacao } : {}),
      },
      orderBy: { criadoEm: 'desc' },
      take: 500,
      select: {
        id: true, criadoEm: true, tipo: true, quantidade: true, saldoDepois: true, motivo: true,
        referencia: true, quem: true, unidadeId: true, variacaoId: true,
        unidade: { select: { nome: true } },
        variacao: {
          select: {
            codigo: true,
            produto: { select: { nome: true, medida: true } },
            opcoes: { select: { opcao: { select: { valor: true } } } },
          },
        },
      },
    })
    return linhas.map((m) => ({
      id: m.id,
      criadoEm: m.criadoEm,
      tipo: m.tipo,
      quantidade: Number(m.quantidade),
      saldoDepois: Number(m.saldoDepois),
      motivo: m.motivo,
      referencia: m.referencia,
      quem: m.quem,
      unidade: m.unidade.nome,
      unidadeId: m.unidadeId,
      variacaoId: m.variacaoId,
      descricao:
        m.variacao.opcoes.length > 0
          ? `${m.variacao.produto.nome} — ${m.variacao.opcoes.map((o) => o.opcao.valor).join(' · ')}`
          : m.variacao.produto.nome,
      codigo: m.variacao.codigo,
      medida: m.variacao.produto.medida,
    }))
  })
}

export const ROTULO_MOVIMENTO: Record<TipoMovimento, string> = {
  ENTRADA: 'Entrada',
  VENDA: 'Venda',
  DEVOLUCAO: 'Devolução',
  AJUSTE: 'Ajuste',
  PERDA: 'Perda',
  TRANSFERENCIA: 'Transferência',
  BALANCO: 'Balanço',
}

// ─────────────────────────────────────────────────────────────
// TRANSFERIR ENTRE LOJAS
// ─────────────────────────────────────────────────────────────

export type Transferencia =
  | { ok: true; saldoOrigem: number; saldoDestino: number }
  | { ok: false; motivo: 'mesma_unidade' | 'quantidade' | 'sem_saldo'; saldo?: number }

/**
 * Tira de uma loja e põe na outra, na mesma transação. Sai como
 * TRANSFERENCIA e entra como ENTRADA com o motivo apontando de onde veio —
 * assim o histórico das duas lojas conta a mesma história.
 */
export async function transferir(
  sessao: Sessao,
  t: { variacaoId: string; deUnidadeId: string; paraUnidadeId: string; quantidade: number; motivo?: string },
): Promise<Transferencia> {
  if (t.deUnidadeId === t.paraUnidadeId) return { ok: false, motivo: 'mesma_unidade' }
  if (!(t.quantidade > 0)) return { ok: false, motivo: 'quantidade' }
  exigir(sessao, 'estoque.ajustar', t.deUnidadeId)
  exigir(sessao, 'estoque.ajustar', t.paraUnidadeId)

  return comoOrg(sessao.orgId, async (db) => {
    const [de, para] = await Promise.all([
      db.unidade.findUnique({ where: { id: t.deUnidadeId }, select: { nome: true } }),
      db.unidade.findUnique({ where: { id: t.paraUnidadeId }, select: { nome: true } }),
    ])
    if (!de || !para) throw new Error('Unidade não encontrada nesta empresa.')

    const saida = await mexerEstoqueEm(db, sessao, {
      variacaoId: t.variacaoId,
      unidadeId: t.deUnidadeId,
      tipo: 'TRANSFERENCIA',
      quantidade: t.quantidade,
      motivo: `Transferência para ${para.nome}${t.motivo ? ` — ${t.motivo}` : ''}`,
    })
    if (!saida.ok) return { ok: false as const, motivo: 'sem_saldo' as const, saldo: saida.saldo }

    const entrada = await mexerEstoqueEm(db, sessao, {
      variacaoId: t.variacaoId,
      unidadeId: t.paraUnidadeId,
      tipo: 'ENTRADA',
      quantidade: t.quantidade,
      motivo: `Transferência de ${de.nome}${t.motivo ? ` — ${t.motivo}` : ''}`,
    })
    if (!entrada.ok) throw new Error('A entrada da transferência falhou; nada foi gravado.')

    const v = await db.variacao.findUnique({
      where: { id: t.variacaoId },
      select: { codigo: true, produto: { select: { nome: true } } },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: t.deUnidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'estoque.transferiu',
        alvoTipo: 'variacao',
        alvoId: t.variacaoId,
        alvoNome: v ? `${v.produto.nome}${v.codigo ? ` (${v.codigo})` : ''}` : null,
        motivo: `${t.quantidade} de ${de.nome} para ${para.nome}${t.motivo ? ` — ${t.motivo}` : ''}`,
      },
    })

    return { ok: true as const, saldoOrigem: saida.saldo, saldoDestino: entrada.saldo }
  })
}

/**
 * Confere se o saldo gravado bate com a soma do histórico.
 *
 * Existe porque saldo guardado é rápido de ler e fácil de corromper: um bug,
 * um script, um `update` na mão. O histórico é a verdade; o saldo é atalho.
 * Divergência aqui é sinal de que alguém mexeu por fora.
 */
export async function conferirSaldos(sessao: Sessao, unidadeId?: string) {
  exigir(sessao, 'estoque.ver', unidadeId)

  return comoOrg(sessao.orgId, (db) =>
    db.$queryRaw<
      { variacao_id: string; unidade_id: string; saldo: string; somado: string }[]
    >`
      select e.variacao_id,
             e.unidade_id,
             e.quantidade as saldo,
             coalesce(sum(m.quantidade), 0) as somado
        from estoque e
        left join movimentos_estoque m
               on m.variacao_id = e.variacao_id
              and m.unidade_id = e.unidade_id
       where (${unidadeId ?? null}::text is null or e.unidade_id = ${unidadeId ?? null})
       group by e.variacao_id, e.unidade_id, e.quantidade
      having e.quantidade <> coalesce(sum(m.quantidade), 0)
    `,
  )
}
