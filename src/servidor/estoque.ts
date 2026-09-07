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
import { exigir, type Capacidade, type Sessao } from './permissao'
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

  if (m.quantidade < 0) {
    throw new Error('Quantidade é sempre positiva — o sinal vem do tipo do movimento.')
  }

  return comoOrg(sessao.orgId, async (db) => {
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
  })
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
