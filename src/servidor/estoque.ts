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

import { ondeOCodigo } from './etiqueta'
import { randomUUID } from 'node:crypto'
import { comoOrg } from './banco'
import { exigir, pode, SemPermissao, soPelaEmpresa, textoDaBusca, unidadesQuePodem, type Capacidade, type Sessao } from './permissao'
import { assinarExcecao } from './autorizacao'
import type { TipoMovimento } from '@prisma/client'
import { vendidoNaLoja } from './catalogo-loja'

/** Que permissão cada tipo de movimento exige. */
const EXIGE: Record<TipoMovimento, Capacidade> = {
  VENDA: 'venda.criar',
  DEVOLUCAO: 'venda.criar',
  ENTRADA: 'estoque.ajustar',
  AJUSTE: 'estoque.ajustar',
  PERDA: 'estoque.ajustar',
  TRANSFERENCIA: 'estoque.ajustar',
  BALANCO: 'estoque.ajustar',
  // O material que se gasta atendendo (esmalte, luva, algodão). Quem atende
  // anota; quem ajusta estoque não precisa ser chamado para isso.
  CONSUMO: 'estoque.consumir',
}

/** Movimentos que TIRAM do estoque precisam de saldo. */
const TIRA: TipoMovimento[] = ['VENDA', 'PERDA', 'TRANSFERENCIA', 'CONSUMO']

export type Movimento = {
  variacaoId: string
  unidadeId: string
  tipo: TipoMovimento
  /** Sempre positiva. O sinal vem do tipo, não de quem chama. */
  quantidade: number
  motivo?: string
  /** Id da venda, da entrada de mercadoria, do que originou. */
  referencia?: string
  /** As duas pernas de uma transferência entre lojas levam o mesmo id. */
  transferenciaId?: string
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
  return comoOrg(sessao.orgId, async (db) => {
    // A variação e a loja vêm da tela. Procurar as duas aqui passa pelo RLS:
    // id de outra empresa não aparece — e a linha de saldo não nasce
    // apontando para o produto de outra empresa (a chave estrangeira do
    // banco não olha o RLS).
    const v = await db.variacao.findUnique({
      where: { id: m.variacaoId },
      select: { codigo: true, produto: { select: { nome: true } } },
    })
    const loja = await db.unidade.findUnique({ where: { id: m.unidadeId }, select: { id: true } })
    if (!v || !loja) throw new Error('Produto ou loja não encontrado nesta empresa.')

    // Travado (for update), como a conta do balanço lá embaixo: o "antes" do
    // livro é o mesmo saldo de que o ajuste parte.
    const antes = m.tipo === 'BALANCO' ? await saldoDe(db, m.variacaoId, m.unidadeId, true) : null
    const r = await mexerEstoqueEm(db, sessao, m)

    // Correção de saldo é o movimento que MAIS precisa de livro: é onde some
    // mercadoria sem venda. Venda, entrada e transferência escrevem a linha
    // delas; o ajuste à mão não escrevia nenhuma — "quem zerou as camisetas
    // na terça?" não tinha resposta no livro de auditoria.
    if (r.ok && (m.tipo === 'BALANCO' || m.tipo === 'AJUSTE' || m.tipo === 'PERDA')) {
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          unidadeId: m.unidadeId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'estoque.ajustou',
          alvoTipo: 'variacao',
          alvoId: m.variacaoId,
          alvoNome: `${v.produto.nome}${v.codigo ? ` (${v.codigo})` : ''}`,
          motivo: m.motivo ?? null,
          antes: antes !== null ? { saldo: antes } : undefined,
          depois: { saldo: r.saldo, tipo: m.tipo },
        },
      })
    }
    return r
  })
}

export type Correcao =
  | { ok: true; saldo: number; antes: number }
  /** O saldo mudou entre a pessoa olhar e mandar (uma venda, outra pessoa contando). */
  | { ok: false; motivo: 'mudou'; saldo: number; erro: string }
  /** A exceção pede a assinatura de quem corrige (o PIN dela). */
  | { ok: false; motivo: 'assinatura'; erro: string }

/**
 * Corrigir o saldo pelo que foi CONTADO na prateleira — o "corrigir" da tela
 * de Estoque.
 *
 * ── "o número mudou enquanto você contava" ───────────────────
 * A tela manda também o saldo que ELA mostrava quando a pessoa começou a
 * contar (`saldoVisto`). Se o banco já não está nele, uma venda (ou outra
 * pessoa) mexeu no meio da contagem — e gravar o contado por cima apagaria
 * esse movimento em silêncio: a peça vendida às 15h02 "voltava" ao estoque
 * no balanço das 15h03. Melhor recusar e mostrar o número novo.
 *
 * ── a assinatura ─────────────────────────────────────────────
 * Quem corrige porque a EMPRESA deixou (a vendedora, ver EXTRAS_DO_BALCAO)
 * assina sempre com o PIN dela; os outros, quando a empresa pede assinatura
 * nas exceções.
 */
export async function corrigirPeloContado(
  sessao: Sessao,
  c: { variacaoId: string; unidadeId: string; contado: number; motivo: string; saldoVisto?: number | null; pin?: string | null },
): Promise<Correcao> {
  exigir(sessao, 'estoque.ajustar', c.unidadeId)
  if (!Number.isFinite(c.contado) || c.contado < 0) throw new Error('O que você contou precisa ser um número, zero ou mais.')
  const motivo = c.motivo.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (motivo.length < 3) throw new Error('Diga o motivo da correção. Sem isso não dá para conferir depois.')

  const assinatura = await assinarExcecao(sessao, { pin: c.pin, sempre: soPelaEmpresa(sessao, 'estoque.ajustar', c.unidadeId) })
  if (!assinatura.ok) return { ok: false, motivo: 'assinatura', erro: assinatura.erro }

  return comoOrg(sessao.orgId, async (db) => {
    const v = await db.variacao.findUnique({
      where: { id: c.variacaoId },
      select: { codigo: true, produto: { select: { nome: true } } },
    })
    const loja = await db.unidade.findUnique({ where: { id: c.unidadeId }, select: { id: true } })
    if (!v || !loja) throw new Error('Produto ou loja não encontrado nesta empresa.')

    // Travado: a venda que chegar agora espera esta correção terminar.
    const antes = await saldoDe(db, c.variacaoId, c.unidadeId, true)
    if (c.saldoVisto !== null && c.saldoVisto !== undefined && Number.isFinite(c.saldoVisto) && Number(c.saldoVisto) !== antes) {
      return {
        ok: false as const,
        motivo: 'mudou' as const,
        saldo: antes,
        erro: `O estoque mudou enquanto você contava: agora o sistema diz ${antes} (você viu ${c.saldoVisto}). Confira a prateleira e mande de novo.`,
      }
    }

    const r = await mexerEstoqueEm(db, sessao, {
      variacaoId: c.variacaoId,
      unidadeId: c.unidadeId,
      tipo: 'BALANCO',
      quantidade: c.contado,
      motivo,
    })
    if (!r.ok) throw new Error('Não deu para corrigir o saldo.')
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: c.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'estoque.ajustou',
        alvoTipo: 'variacao',
        alvoId: c.variacaoId,
        alvoNome: `${v.produto.nome}${v.codigo ? ` (${v.codigo})` : ''}`,
        motivo,
        antes: { saldo: antes },
        depois: { saldo: r.saldo, tipo: 'BALANCO' },
        assinado: assinatura.assinou,
      },
    })
    return { ok: true as const, saldo: r.saldo, antes }
  })
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
  // `NaN < 0` é falso: sem o isFinite, uma quantidade que não é número
  // passava daqui e gravava `NaN` no saldo — que o Postgres aceita em coluna
  // numeric, e aí nenhuma conta do estoque fecha mais.
  if (!Number.isFinite(m.quantidade)) throw new Error('A quantidade precisa ser um número.')
  if (m.quantidade < 0) {
    throw new Error('Quantidade é sempre positiva — o sinal vem do tipo do movimento.')
  }

  return (async () => {
    // Serviço não tem estoque (ver `Produto.servico`): a manicure vendida, a
    // venda cancelada ou devolvida não mexem em saldo nenhum. Aqui, e não em
    // cada chamador, para a venda, o cancelamento e a devolução concordarem.
    const [tipoDoProduto] = await db.$queryRaw<{ servico: boolean }[]>`
      select p.servico from variacoes v join produtos p on p.id = v.produto_id where v.id = ${m.variacaoId}
    `
    if (tipoDoProduto?.servico) return { ok: true as const, saldo: 0 }

    // Garante que a linha de saldo existe, sem correr risco de duas criarem
    // ao mesmo tempo (o índice único resolve; `do nothing` engole o empate).
    await db.$executeRaw`
      insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em)
      values (gen_random_uuid()::text, ${sessao.orgId}, ${m.variacaoId}, ${m.unidadeId}, 0, now())
      on conflict (variacao_id, unidade_id) do nothing
    `

    // BALANCO informa o contado; o delta é a diferença para o que está gravado.
    //
    // A leitura TRAVA a linha (for update). Sem a trava, uma venda que
    // baixasse 2 entre esta leitura e o update abaixo seria somada por cima:
    // contou 10, o saldo lido era 12, a venda deixou 10, o delta de -2 levava
    // a 8 — duas peças sumidas no próprio balanço, que existe para achar peça
    // sumida. Travada, a venda espera, e o saldo termina no contado.
    let delta: number
    if (m.tipo === 'BALANCO') {
      const atual = await saldoDe(db, m.variacaoId, m.unidadeId, true)
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
        transferenciaId: m.transferenciaId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
      },
    })

    return { ok: true as const, saldo }
  })()
}

async function saldoDe(db: any, variacaoId: string, unidadeId: string, travar = false): Promise<number> {
  const r = travar
    ? await db.$queryRaw<{ quantidade: string }[]>`
        select quantidade from estoque
         where variacao_id = ${variacaoId} and unidade_id = ${unidadeId}
           for update
      `
    : await db.$queryRaw<{ quantidade: string }[]>`
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
  const q = textoDaBusca(f.q)

  const variacao = {
    ...(f.produtoId ? { produtoId: f.produtoId } : {}),
    ...(q
      ? {
          OR: [
            ...ondeOCodigo(q),
            { produto: { nome: { contains: q, mode: 'insensitive' as const } } },
            { produto: { referencia: { contains: q, mode: 'insensitive' as const } } },
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
      },
    })
    // A loja, o produto e as opções vêm em consultas próprias, uma depois da
    // outra: no mesmo `select` o Prisma as busca AO MESMO TEMPO, e dentro do
    // comoOrg a conexão é uma só — o `pg` avisa e, no pg@9, quebra.
    const idsUni = [...new Set(linhas.map((m) => m.unidadeId))]
    const idsVar = [...new Set(linhas.map((m) => m.variacaoId))]
    const unidades = idsUni.length
      ? await db.unidade.findMany({ where: { id: { in: idsUni } }, select: { id: true, nome: true } })
      : []
    const variacoes = idsVar.length
      ? await db.variacao.findMany({
          where: { id: { in: idsVar } },
          select: { id: true, codigo: true, produto: { select: { nome: true, medida: true } } },
        })
      : []
    const opcoes = idsVar.length
      ? await db.variacaoOpcao.findMany({
          where: { variacaoId: { in: idsVar } },
          select: { variacaoId: true, opcao: { select: { valor: true } } },
        })
      : []
    const nomeDa = new Map(unidades.map((u) => [u.id, u.nome]))
    const varDe = new Map(variacoes.map((v) => [v.id, v]))
    const opcoesDe = new Map<string, string[]>()
    for (const o of opcoes) opcoesDe.set(o.variacaoId, [...(opcoesDe.get(o.variacaoId) ?? []), o.opcao.valor])
    return linhas.map((m) => {
      const v = varDe.get(m.variacaoId)!
      const ops = opcoesDe.get(m.variacaoId) ?? []
      return {
        id: m.id,
        criadoEm: m.criadoEm,
        tipo: m.tipo,
        quantidade: Number(m.quantidade),
        saldoDepois: Number(m.saldoDepois),
        motivo: m.motivo,
        referencia: m.referencia,
        quem: m.quem,
        unidade: nomeDa.get(m.unidadeId) ?? '',
        unidadeId: m.unidadeId,
        variacaoId: m.variacaoId,
        descricao: ops.length > 0 ? `${v.produto.nome} — ${ops.join(' · ')}` : v.produto.nome,
        codigo: v.codigo,
        medida: v.produto.medida,
      }
    })
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
  CONSUMO: 'Consumo interno',
}

// ─────────────────────────────────────────────────────────────
// TRANSFERIR ENTRE LOJAS
// ─────────────────────────────────────────────────────────────

export type Transferencia =
  | { ok: true; saldoOrigem: number; saldoDestino: number }
  | { ok: false; motivo: 'mesma_unidade' | 'quantidade' | 'sem_saldo'; saldo?: number }
  /** Quem transfere porque a empresa deixou (a vendedora) assina com o PIN dela. */
  | { ok: false; motivo: 'assinatura'; erro: string }

/** Teto de uma transferência: mais que isto é dedo, não caixa de mercadoria. */
const TRANSFERENCIA_MAXIMA = 1_000_000

/**
 * Tira de uma loja e põe na outra, na mesma transação. Sai como
 * TRANSFERENCIA e entra como ENTRADA com o motivo apontando de onde veio —
 * assim o histórico das duas lojas conta a mesma história.
 *
 * As duas pernas levam o MESMO `transferenciaId`. É ele — e não o texto do
 * motivo — que diz a quem soma "o que entrou" (o recibo de reposição do
 * assistente, ver agente.ts) que aquela ENTRADA é peça mudando de prateleira,
 * não mercadoria nova.
 */
export async function transferir(
  sessao: Sessao,
  t: { variacaoId: string; deUnidadeId: string; paraUnidadeId: string; quantidade: number; motivo?: string; pin?: string | null },
): Promise<Transferencia> {
  if (t.deUnidadeId === t.paraUnidadeId) return { ok: false, motivo: 'mesma_unidade' }
  if (!(t.quantidade > 0) || !Number.isFinite(t.quantidade) || t.quantidade > TRANSFERENCIA_MAXIMA) return { ok: false, motivo: 'quantidade' }
  exigir(sessao, 'estoque.ajustar', t.deUnidadeId)
  exigir(sessao, 'estoque.ajustar', t.paraUnidadeId)
  // A vendedora que mexe no estoque porque a empresa deixou assina sempre —
  // a mesma régua da correção pelo contado. Transferir não é exceção: para
  // quem mexe no estoque pelo papel, não pede.
  let assinou = false
  if (soPelaEmpresa(sessao, 'estoque.ajustar', t.deUnidadeId) || soPelaEmpresa(sessao, 'estoque.ajustar', t.paraUnidadeId)) {
    const a = await assinarExcecao(sessao, { pin: t.pin, sempre: true })
    if (!a.ok) return { ok: false, motivo: 'assinatura', erro: a.erro }
    assinou = a.assinou
  }

  const transferenciaId = randomUUID()
  return comoOrg(sessao.orgId, async (db) => {
    const de = await db.unidade.findUnique({ where: { id: t.deUnidadeId }, select: { nome: true } })
    const para = await db.unidade.findUnique({
      where: { id: t.paraUnidadeId },
      select: { nome: true, ativa: true, ehDeposito: true },
    })
    if (!de || !para) throw new Error('Unidade não encontrada nesta empresa.')
    // Loja fechada não recebe: a mercadoria sumiria de todas as telas, que só
    // listam loja aberta.
    if (!para.ativa) throw new Error(`${para.nome} está fechada. Reabra a loja antes de mandar mercadoria para lá.`)

    // Mandar para uma loja que NÃO VENDE o produto é deixar a peça onde o
    // balcão não pode vendê-la (ver `catalogo-loja.ts`). Depósito é a
    // exceção: ele não vende nada, e guardar é o trabalho dele.
    const produto = await db.variacao.findUnique({
      where: { id: t.variacaoId },
      select: { produto: { select: { nome: true, vendidoEm: true } } },
    })
    if (!produto) throw new Error('Produto não encontrado nesta empresa.')
    if (!para.ehDeposito && !vendidoNaLoja(produto.produto.vendidoEm, t.paraUnidadeId)) {
      throw new Error(
        `${para.nome} não vende ${produto.produto.nome}. Marque a loja na ficha do produto, ou mande para um depósito.`,
      )
    }

    const saida = await mexerEstoqueEm(db, sessao, {
      variacaoId: t.variacaoId,
      unidadeId: t.deUnidadeId,
      tipo: 'TRANSFERENCIA',
      quantidade: t.quantidade,
      motivo: `Transferência para ${para.nome}${t.motivo ? ` — ${t.motivo}` : ''}`,
      transferenciaId,
    })
    if (!saida.ok) return { ok: false as const, motivo: 'sem_saldo' as const, saldo: saida.saldo }

    const entrada = await mexerEstoqueEm(db, sessao, {
      variacaoId: t.variacaoId,
      unidadeId: t.paraUnidadeId,
      tipo: 'ENTRADA',
      quantidade: t.quantidade,
      motivo: `Transferência de ${de.nome}${t.motivo ? ` — ${t.motivo}` : ''}`,
      transferenciaId,
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
        assinado: assinou,
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
export async function conferirSaldos(sessao: Sessao, unidades?: string | string[]) {
  // Uma loja, as lojas da tela, ou — sem nada — a empresa inteira, que só
  // quem vê o estoque de todas pede. A lista vem da tela (o "Todas as
  // unidades" do gerente de duas lojas): o que não é dele sai daqui.
  const pedidas = unidades === undefined ? undefined : Array.isArray(unidades) ? unidades : [unidades]
  if (pedidas === undefined) {
    if (unidadesQuePodem(sessao, 'estoque.ver') !== 'todas') throw new SemPermissao('estoque.ver')
  } else if (pedidas.length === 1) {
    exigir(sessao, 'estoque.ver', pedidas[0])
  }
  const lojas = pedidas?.filter((u) => pode(sessao, 'estoque.ver', u)) ?? null
  if (lojas && lojas.length === 0) return []

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
       where (${lojas === null} or e.unidade_id = any(${lojas ?? []}::text[]))
       group by e.variacao_id, e.unidade_id, e.quantidade
      having e.quantidade <> coalesce(sum(m.quantidade), 0)
    `,
  )
}

// ─────────────────────────────────────────────────────────────
// VENDIDO SEM ESTOQUE — CONFERIR
// ─────────────────────────────────────────────────────────────
//
// Com "vender o que o sistema diz que acabou" ligado (`Org.vendeSemEstoque`),
// a venda passa e o item guarda o saldo que o sistema tinha (`saldoNaVenda`).
// Cada um é uma pergunta para a gerente: a peça estava mesmo na loja e o
// estoque é que estava errado (conta a prateleira e corrige), ou saiu uma
// peça que não era a do código? A lista some item a item com "já conferi".

export type ParaConferir = {
  vendaItemId: string
  vendaId: string
  vendaNumero: number
  vendidaEm: Date
  unidadeId: string
  unidade: string
  variacaoId: string | null
  descricao: string
  codigo: string | null
  vendido: number
  /** O que o sistema dizia ter na hora da venda (0, ou menos que o vendido). */
  tinha: number
  /** O saldo de agora — negativo enquanto ninguém contou a prateleira. */
  saldoAgora: number
  vendedor: string | null
}

/** Os itens vendidos sem estoque que ninguém conferiu ainda, das lojas pedidas que a pessoa vê. */
export async function listarParaConferir(sessao: Sessao, unidadeIds: string[], limite = 200): Promise<ParaConferir[]> {
  const lojas = unidadeIds.filter((u) => pode(sessao, 'estoque.ver', u))
  if (lojas.length === 0) return []
  return comoOrg(sessao.orgId, async (db) => {
    const itens = await db.vendaItem.findMany({
      where: {
        saldoNaVenda: { not: null },
        conferidoEm: null,
        venda: { unidadeId: { in: lojas }, situacao: 'CONCLUIDA' },
      },
      orderBy: { venda: { criadaEm: 'desc' } },
      take: limite,
      select: {
        id: true, variacaoId: true, descricao: true, codigo: true, quantidade: true, saldoNaVenda: true,
        venda: {
          select: { id: true, numero: true, criadaEm: true, unidadeId: true, vendedorNome: true, unidade: { select: { nome: true } } },
        },
      },
    })
    // O saldo de agora, numa consulta só (e não uma por linha).
    const saldos = await db.estoque.findMany({
      where: {
        unidadeId: { in: lojas },
        variacaoId: { in: [...new Set(itens.map((i) => i.variacaoId).filter((x): x is string => !!x))] },
      },
      select: { variacaoId: true, unidadeId: true, quantidade: true },
    })
    const agora = new Map(saldos.map((e) => [`${e.variacaoId}:${e.unidadeId}`, Number(e.quantidade)]))
    return itens.map((i) => ({
      vendaItemId: i.id,
      vendaId: i.venda.id,
      vendaNumero: i.venda.numero,
      vendidaEm: i.venda.criadaEm,
      unidadeId: i.venda.unidadeId,
      unidade: i.venda.unidade.nome,
      variacaoId: i.variacaoId,
      descricao: i.descricao,
      codigo: i.codigo,
      vendido: Number(i.quantidade),
      tinha: Number(i.saldoNaVenda),
      saldoAgora: agora.get(`${i.variacaoId}:${i.venda.unidadeId}`) ?? 0,
      vendedor: i.venda.vendedorNome,
    }))
  })
}

/**
 * "Já conferi": o item sai da lista, com quem e quando. Quem corrige estoque
 * (`estoque.ajustar`) na loja da venda — conferir é contar a prateleira e,
 * se preciso, corrigir o saldo, que é o mesmo poder.
 */
export async function marcarConferido(
  sessao: Sessao,
  vendaItemId: string,
  pin?: string | null,
): Promise<{ ok: true } | { ok: false; erro: string; precisaPin?: true }> {
  // A loja da venda primeiro (numa leitura só): a assinatura confere o PIN
  // numa transação própria, e transação não aninha.
  const alvo = await comoOrg(sessao.orgId, (db) =>
    db.vendaItem.findUnique({ where: { id: vendaItemId }, select: { venda: { select: { unidadeId: true } } } }),
  )
  if (!alvo) return { ok: false, erro: 'Item não encontrado na lista.' }
  exigir(sessao, 'estoque.ajustar', alvo.venda.unidadeId)
  // A vendedora que confere porque a empresa deixou assina — tirar o item
  // da lista é dizer "a prateleira bate", e isso precisa ter nome.
  let assinou = false
  if (soPelaEmpresa(sessao, 'estoque.ajustar', alvo.venda.unidadeId)) {
    const a = await assinarExcecao(sessao, { pin, sempre: true })
    if (!a.ok) return { ok: false, erro: a.erro, precisaPin: true }
    assinou = a.assinou
  }

  return comoOrg(sessao.orgId, async (db) => {
    const item = await db.vendaItem.findUnique({
      where: { id: vendaItemId },
      select: {
        id: true, descricao: true, quantidade: true, saldoNaVenda: true, conferidoEm: true,
        venda: { select: { id: true, numero: true, unidadeId: true } },
      },
    })
    if (!item || item.saldoNaVenda === null) return { ok: false as const, erro: 'Item não encontrado na lista.' }
    exigir(sessao, 'estoque.ajustar', item.venda.unidadeId)
    // A condição no update é a trava do clique duplo: o segundo não acha mais
    // o item em aberto e não escreve outra linha no livro.
    const r = await db.vendaItem.updateMany({
      where: { id: item.id, conferidoEm: null },
      data: { conferidoEm: new Date(), conferidoPor: sessao.nome },
    })
    if (r.count === 0) return { ok: true as const }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: item.venda.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'estoque.conferiu',
        alvoTipo: 'venda',
        alvoId: item.venda.id,
        alvoNome: `Venda ${item.venda.numero}`,
        motivo: `${item.descricao}: vendeu ${Number(item.quantidade)}, o sistema tinha ${Number(item.saldoNaVenda)}`,
        assinado: assinou,
      },
    })
    return { ok: true as const }
  })
}
