// As sobras da auditoria de 28/09, com banco de verdade (PGlite exposto numa
// porta, como em regras-servidor.test.ts).
//
// O que está provado aqui:
//   • o Painel não soma peça com quilo: "800,381 peças" vira 800 peças e o
//     peso à parte — e serviço não entra no estoque
//   • a lista de clientes não traz a ficha desativada/anonimizada (só quando
//     pedida), e a planilha continua levando tudo
//   • "Precisa de você" só chama quem pode agir: o contador lê o Financeiro,
//     mas não recebe "3 contas vencidas" como tarefa
//   • o turno de caixa FECHADO mostra o vendido do fechamento, mesmo que uma
//     venda dele seja cancelada depois
//   • fechar uma loja confere também a agenda e os pedidos de compra
//   • o rascunho de pedido de compra muda de itens, e fica no livro
//   • "Nenhuma venda nos últimos 7 dias", e não "Nenhuma venda últimos 7 dias"

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { janela } from '../src/servidor/periodo'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  painel: typeof import('../src/servidor/painel')
  cliente: typeof import('../src/servidor/cliente')
  pendencias: typeof import('../src/servidor/pendencias')
  caixa: typeof import('../src/servidor/caixa')
  lojas: typeof import('../src/servidor/lojas')
  compras: typeof import('../src/servidor/compras')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, papel: Papel): Sessao => ({
  orgId: 'org-s',
  usuarioId,
  nome: usuarioId,
  acessos: [{ papel, unidadeId: null, expiraEm: null }],
})
const DONA = sessao('usr-dona', 'DONO')
const CONTADOR = sessao('usr-cont', 'CONTADOR')
const LOJAS = ['u-1', 'u-2']

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-s', 'Loja S', 'loja-s', 'REDE', 'ATIVA', '{multiUnidade,crediario,agenda,compras}', now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('u-1', 'org-s', 'Centro', false, now()),
    ('u-2', 'org-s', 'Shopping', false, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-s', 'Dona', 'dona@s.com', now()),
    ('usr-cont', 'org-s', 'Contador', 'cont@s.com', now());

  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('c-desp', 'org-s', 'Outras despesas', 'DESPESA', 'OUTRA');

  -- 800 camisetas (un), 12,5 kg de sorvete e uma manicure (serviço).
  insert into produtos (id, org_id, nome, medida, custo, servico, atualizado_em) values
    ('p-cam', 'org-s', 'Camiseta', 'UN', 10.00, false, now()),
    ('p-sor', 'org-s', 'Sorvete', 'KG', 20.00, false, now()),
    ('p-man', 'org-s', 'Manicure', 'UN', null, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-cam', 'org-s', 'p-cam', 'CAM', true),
    ('v-sor', 'org-s', 'p-sor', 'SOR', true),
    ('v-man', 'org-s', 'p-man', 'MAN', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-cam', 'org-s', 'v-cam', 'u-1', 800, now()),
    ('e-sor', 'org-s', 'v-sor', 'u-1', 12.5, now()),
    ('e-man', 'org-s', 'v-man', 'u-1', 3, now());

  -- Uma cliente de verdade e uma ficha anonimizada (desativada de vez).
  insert into clientes (id, org_id, nome, ativo, anonimizado_em, atualizado_em) values
    ('cli-ana', 'org-s', 'Ana', true, null, now()),
    ('cli-x', 'org-s', 'Cliente anonimizado', false, now(), now());

  -- Uma conta vencida, sem pagar.
  insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, vencimento, pago_em, quem, atualizado_em) values
    ('l-venc', 'org-s', 'u-1', 'c-desp', 'DESPESA', 'Luz', 90.00, current_date - 5, null, 'Dona', now());

  -- Um turno fechado ontem, com esperado gravado. Nele: uma venda de 50
  -- (concluída) e uma de 30 cancelada ANTES do fechamento.
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura, aberto, aberto_em, fechado_em, fechado_por, saldo_esperado, saldo_contado) values
    ('cx-f', 'org-s', 'u-1', 'Balcão', 0, false, now() - interval '30 hours', now() - interval '20 hours', 'Balcão', 50, 50);
  insert into vendas (id, org_id, unidade_id, caixa_id, numero, situacao, total, criada_em, cancelada_em) values
    ('v-1', 'org-s', 'u-1', 'cx-f', 1, 'CONCLUIDA', 50.00, now() - interval '25 hours', null),
    ('v-2', 'org-s', 'u-1', 'cx-f', 2, 'CANCELADA', 30.00, now() - interval '24 hours', now() - interval '23 hours');

  -- No Shopping: um horário marcado para amanhã e um pedido de compra em rascunho.
  insert into colaboradores (id, org_id, unidade_id, nome, atende, atualizado_em) values
    ('col-1', 'org-s', 'u-2', 'Bia', true, now());
  insert into agendamentos (id, org_id, unidade_id, colaborador_id, cliente_nome, servico, inicio, fim, quem, atualizado_em) values
    ('ag-1', 'org-s', 'u-2', 'col-1', 'Ana', 'Manicure', now() + interval '1 day', now() + interval '1 day 1 hour', 'Dona', now());
  insert into pedidos_compra (id, org_id, unidade_id, quem, atualizado_em) values
    ('pc-1', 'org-s', 'u-2', 'Dona', now());
  insert into itens_compra (id, org_id, pedido_id, variacao_id, descricao, quantidade, custo_unit) values
    ('ic-1', 'org-s', 'pc-1', 'v-cam', 'Camiseta', 5, 10.00);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 53000 + Math.floor(Math.random() * 2500)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    painel: await import('../src/servidor/painel'),
    cliente: await import('../src/servidor/cliente'),
    pendencias: await import('../src/servidor/pendencias'),
    caixa: await import('../src/servidor/caixa'),
    lojas: await import('../src/servidor/lojas'),
    compras: await import('../src/servidor/compras'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linha = async <T>(sql: string) => (await db.query<T>(sql)).rows

describe('o estoque do Painel', () => {
  it('peça num número, quilo no outro — e serviço fora', async () => {
    const r = await m.painel.resumoDoPainel(DONA, LOJAS, janela('30d'))
    expect(r.estoque.unidades).toBe(800)
    expect(r.estoque.quilos).toBe(12.5)
    expect(r.estoque.litros).toBe(0)
    // Camiseta e sorvete; a manicure (serviço) não é item de estoque.
    expect(r.estoque.itens).toBe(2)
    expect(r.estoque.valorCusto).toBe(800 * 10 + 12.5 * 20)
  })
})

describe('a lista de clientes', () => {
  it('não traz a ficha anonimizada, a menos que se peça', async () => {
    const padrao = await m.cliente.listarClientes(DONA)
    expect(padrao.map((c) => c.id)).toEqual(['cli-ana'])
    const desativados = await m.cliente.listarClientes(DONA, undefined, 500, 'inativos')
    expect(desativados.map((c) => c.id)).toEqual(['cli-x'])
    const todos = await m.cliente.listarClientes(DONA, undefined, 500, 'todos')
    expect(todos).toHaveLength(2)
  })
})

describe('"Precisa de você" só para quem pode agir', () => {
  it('a dona vê a conta vencida; o contador, que só lê, não', async () => {
    const daDona = await m.pendencias.pendenciasDoDia(DONA, { modulos: [] }, LOJAS)
    expect(daDona.contasVencidas?.quantas).toBe(1)
    const doContador = await m.pendencias.pendenciasDoDia(CONTADOR, { modulos: [] }, LOJAS)
    expect(doContador.contasVencidas).toBeUndefined()
    expect(m.pendencias.montarPendencias(doContador, 'loja-s')).toEqual([])
  })
})

describe('o turno de caixa fechado', () => {
  it('mostra o que vendeu no fechamento, mesmo com venda cancelada depois', async () => {
    const turno = async () =>
      (await m.caixa.listarCaixas(DONA, { unidadeIds: ['u-1'], de: new Date(Date.now() - 3 * 864e5), ate: new Date() })).find(
        (t) => t.id === 'cx-f',
      )!
    // A cancelada antes de fechar nunca contou.
    expect(await turno()).toMatchObject({ vendas: 1, vendido: 50 })
    // Cancelar hoje a venda de ontem não mexe no turno conferido.
    await db.exec(`update vendas set situacao = 'CANCELADA', cancelada_em = now() where id = 'v-1'`)
    expect(await turno()).toMatchObject({ vendas: 1, vendido: 50, saldoEsperado: 50 })
  })
})

describe('fechar uma loja', () => {
  it('confere o horário marcado e o pedido de compra em aberto', async () => {
    await expect(m.lojas.mudarSituacaoLoja(DONA, 'u-2', false)).rejects.toThrow(/1 horário marcado.*1 pedido de compra em aberto/)
    const [u] = await linha<{ ativa: boolean }>(`select ativa from unidades where id = 'u-2'`)
    expect(u!.ativa).toBe(true)
  })
})

describe('o rascunho do pedido de compra', () => {
  it('muda de itens e fica no livro', async () => {
    const r = await m.compras.salvarItensDoPedido(DONA, 'pc-1', [{ variacaoId: 'v-cam', quantidade: 8, custoUnit: 11 }])
    expect(r).toEqual({ ok: true, id: 'pc-1' })
    const itens = await linha<{ quantidade: string; custo_unit: string }>(`select quantidade::text, custo_unit::text from itens_compra where pedido_id = 'pc-1'`)
    expect(itens).toEqual([{ quantidade: '8.000', custo_unit: '11.00' }])
    const [a] = await linha<{ valor: string }>(`select valor::text from auditoria where acao = 'compra.mudou_itens' and alvo_id = 'pc-1'`)
    expect(Number(a!.valor)).toBe(88)
  })

  it('serviço não entra no pedido, e o que já foi mandado não muda', async () => {
    const s = await m.compras.salvarItensDoPedido(DONA, 'pc-1', [{ variacaoId: 'v-man', quantidade: 1 }])
    expect(s).toMatchObject({ ok: false })
    await db.exec(`update pedidos_compra set situacao = 'ENVIADO' where id = 'pc-1'`)
    const r = await m.compras.salvarItensDoPedido(DONA, 'pc-1', [{ variacaoId: 'v-cam', quantidade: 1 }])
    expect(r).toMatchObject({ ok: false })
  })
})

describe('o período no meio da frase', () => {
  it('"nos últimos 7 dias", "neste mês", "hoje"', () => {
    expect(`Nenhuma venda ${janela('7d').naFrase}.`).toBe('Nenhuma venda nos últimos 7 dias.')
    expect(janela('mes').naFrase).toBe('neste mês')
    expect(janela('mes-passado').naFrase).toBe('no mês passado')
    expect(janela('hoje').naFrase).toBe('hoje')
  })
})
