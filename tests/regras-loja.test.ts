// Mais regras do servidor, com banco de verdade — as da segunda rodada da
// auditoria (25/09).
//
// Mesma montagem de `regras-servidor.test.ts`: o PGlite exposto numa porta e
// o código rodando INTEIRO (`comoOrg`, Prisma, troca de papel, RLS). Arquivo
// separado porque cada arquivo tem o próprio banco — e estes cenários semeiam
// produto, recibo e tentativa de login que os de lá não precisam enxergar.
//
// Cada `describe` é um defeito: o cenário que passava virou a prova de que
// ele não passa mais.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { guardarSenha } from '../src/servidor/senha'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  produto: typeof import('../src/servidor/produto')
  entrada: typeof import('../src/servidor/entrada')
  agente: typeof import('../src/servidor/agente')
  autenticacao: typeof import('../src/servidor/autenticacao')
  limite: typeof import('../src/servidor/limite')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-a',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])
const GER_CENTRO = sessao('usr-ger1', 'Gerente Centro', [{ papel: 'GERENTE', unidadeId: 'uni-a1' }])

const SENHA = 'senha-certa-2026'

const SEMENTE = (hash: string) => `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{agente,multiUnidade}', now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, now()),
    ('uni-a2', 'org-a', 'Loja Shopping', false, now()),
    ('uni-a9', 'org-a', 'Depósito', true, now());

  insert into usuarios (id, org_id, nome, email, senha_hash, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona',           'dona@a.com', '${hash}', now()),
    ('usr-ger1', 'org-a', 'Gerente Centro', 'g1@a.com',   '${hash}', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null,     'DONO'),
    ('ac-ger1', 'org-a', 'usr-ger1', 'uni-a1', 'GERENTE');

  -- vendido em todas (vazio), só no Centro, e no Centro + Shopping
  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, vendido_em, atualizado_em) values
    ('p-todas',  'org-a', 'Camiseta', 'UN', 50.00, 50.00, 50.00, 20.00, '{}',              now()),
    ('p-centro', 'org-a', 'Boné',     'UN', 30.00, 30.00, 30.00, 10.00, '{uni-a1}',        now()),
    ('p-ambas',  'org-a', 'Meia',     'UN', 15.00, 15.00, 15.00,  5.00, '{uni-a1,uni-a2}', now());

  insert into eixos (id, org_id, nome, ordem) values ('eixo-tam', 'org-a', 'Tamanho', 0);
  insert into opcoes (id, org_id, eixo_id, valor, ordem) values
    ('op-p', 'org-a', 'eixo-tam', 'P', 0),
    ('op-m', 'org-a', 'eixo-tam', 'M', 1);

  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('var-todas',  'org-a', 'p-todas',  'CAM001', true),
    ('var-centro', 'org-a', 'p-centro', 'BON001', true),
    ('var-ambas',  'org-a', 'p-ambas',  'MEI001', true);

  insert into agentes (id, org_id, nome, poderes, ativo, atualizado_em)
    values ('ag-a', 'org-a', 'Nina', '{pedir.compra}', true, now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE(await guardarSenha(SENHA)))
  const porta = 59000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url

  m = {
    produto: await import('../src/servidor/produto'),
    entrada: await import('../src/servidor/entrada'),
    agente: await import('../src/servidor/agente'),
    autenticacao: await import('../src/servidor/autenticacao'),
    limite: await import('../src/servidor/limite'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  const g = globalThis as { __prismaNorte?: unknown }
  delete g.__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linha = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const precoDe = async (id: string) =>
  Number((await linha<{ preco_vista: string }>(`select preco_vista from produtos where id = $1`, [id]))[0]!.preco_vista)
const lojasDe = async (id: string) =>
  (await linha<{ vendido_em: string[] }>(`select vendido_em from produtos where id = $1`, [id]))[0]!.vendido_em

/** O que a ficha manda num "Salvar" sem mudar nada — ela manda TODOS os campos. */
const fichaDe = (p: { nome: string; preco: number; custo: number; vendidoEm: string[] }) => ({
  nome: p.nome,
  medida: 'UN' as const,
  precoVista: p.preco,
  precoCartao: p.preco,
  precoCrediario: p.preco,
  custo: p.custo,
  vendidoEm: p.vendidoEm,
  ativo: true,
})

// ─────────────────────────────────────────────────────────────
// 1. CATÁLOGO: O GERENTE E AS LOJAS QUE ELE NÃO CUIDA
// ─────────────────────────────────────────────────────────────

describe('catálogo: o gerente de uma loja não decide pelas outras', () => {
  it('não muda o preço do produto vendido em todas as lojas', async () => {
    const r = await m.produto.editarProduto(GER_CENTRO, 'p-todas', fichaDe({ nome: 'Camiseta', preco: 9.9, custo: 20, vendidoEm: [] }))
    expect(r).toEqual({ ok: false, motivo: m.produto.MOTIVO_FORA_DO_ALCANCE })
    expect(await precoDe('p-todas')).toBe(50)
  })

  it('não tira o Shopping de um produto que o Shopping também vende', async () => {
    const r = await m.produto.editarProduto(GER_CENTRO, 'p-ambas', fichaDe({ nome: 'Meia', preco: 15, custo: 5, vendidoEm: ['uni-a1'] }))
    expect(r.ok).toBe(false)
    expect(await lojasDe('p-ambas')).toEqual(['uni-a1', 'uni-a2'])
  })

  it('não desativa nem muda a medida do produto de todas', async () => {
    const r1 = await m.produto.editarProduto(GER_CENTRO, 'p-todas', { ...fichaDe({ nome: 'Camiseta', preco: 50, custo: 20, vendidoEm: [] }), ativo: false })
    const r2 = await m.produto.editarProduto(GER_CENTRO, 'p-todas', { ...fichaDe({ nome: 'Camiseta', preco: 50, custo: 20, vendidoEm: [] }), medida: 'KG' })
    expect([r1.ok, r2.ok]).toEqual([false, false])
  })

  it('corrige o NOME do produto de todas: a ficha manda o preço igual, e isso não é mexer em preço', async () => {
    const r = await m.produto.editarProduto(GER_CENTRO, 'p-todas', fichaDe({ nome: 'Camiseta básica', preco: 50, custo: 20, vendidoEm: [] }))
    expect(r.ok).toBe(true)
    const [p] = await linha<{ nome: string }>(`select nome from produtos where id = 'p-todas'`)
    expect(p!.nome).toBe('Camiseta básica')
    // e o livro não diz que o preço mudou
    const livro = await linha(`select id from auditoria where alvo_id = 'p-todas' and acao = 'produto.preco.alterou'`)
    expect(livro).toHaveLength(0)
  })

  it('no que é só da loja dele, muda o preço', async () => {
    const r = await m.produto.editarProduto(GER_CENTRO, 'p-centro', fichaDe({ nome: 'Boné', preco: 35, custo: 10, vendidoEm: ['uni-a1'] }))
    expect(r.ok).toBe(true)
    expect(await precoDe('p-centro')).toBe(35)
  })

  it('não põe o produto dele no balcão do Shopping', async () => {
    const r = await m.produto.editarProduto(GER_CENTRO, 'p-centro', fichaDe({ nome: 'Boné', preco: 35, custo: 10, vendidoEm: ['uni-a1', 'uni-a2'] }))
    expect(r.ok).toBe(false)
    expect(await lojasDe('p-centro')).toEqual(['uni-a1'])
  })

  it('cadastra produto só da loja dele; "em todas" ou em loja alheia, não', async () => {
    const base = { nome: 'Chaveiro', medida: 'UN' as const, precoVista: 5 }
    expect((await m.produto.criarProduto(GER_CENTRO, { ...base, vendidoEm: [] })).ok).toBe(false)
    expect((await m.produto.criarProduto(GER_CENTRO, { ...base, vendidoEm: ['uni-a2'] })).ok).toBe(false)
    expect((await m.produto.criarProduto(GER_CENTRO, { ...base })).ok).toBe(false) // sem lista = todas
    const r = await m.produto.criarProduto(GER_CENTRO, { ...base, vendidoEm: ['uni-a1'] })
    expect(r.ok).toBe(true)
  })

  it('a grade do produto de todas: mudar é recusado; salvar sem mudar passa', async () => {
    await expect(
      m.produto.ajustarGrade(GER_CENTRO, 'p-todas', [{ eixoId: 'eixo-tam', opcaoIds: ['op-p', 'op-m'] }]),
    ).rejects.toThrow(/lojas que você não cuida/)
    const nada = await m.produto.ajustarGrade(GER_CENTRO, 'p-todas', [{ eixoId: 'eixo-tam', opcaoIds: [] }])
    expect(nada).toEqual({ criadas: 0, desativadas: 0, reativadas: 0, apagadas: 0 })
    const [n] = await linha<{ n: number }>(`select count(*)::int as n from variacoes where produto_id = 'p-todas'`)
    expect(n!.n).toBe(1)
  })

  it('a dona decide por todas', async () => {
    const r = await m.produto.editarProduto(DONA, 'p-todas', fichaDe({ nome: 'Camiseta básica', preco: 55, custo: 20, vendidoEm: ['uni-a1'] }))
    expect(r.ok).toBe(true)
    expect(await precoDe('p-todas')).toBe(55)
    // devolve para "todas" para os testes seguintes
    await m.produto.editarProduto(DONA, 'p-todas', { vendidoEm: [] })
    expect(await lojasDe('p-todas')).toEqual([])
  })

  it('a entrada de mercadoria do gerente não reescreve o custo do produto de todas', async () => {
    const r = await m.entrada.registrarEntrada(GER_CENTRO, {
      unidadeId: 'uni-a1',
      itens: [
        { variacaoId: 'var-todas', quantidade: 2, custoUnit: 1 },
        { variacaoId: 'var-centro', quantidade: 2, custoUnit: 12 },
      ],
    } as Parameters<typeof m.entrada.registrarEntrada>[1])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.naoFeito.join(' ')).toMatch(/Camiseta/)
    const custos = await linha<{ id: string; custo: string }>(`select id, custo from produtos where id in ('p-todas', 'p-centro') order by id`)
    expect(custos.map((c) => [c.id, Number(c.custo)])).toEqual([
      ['p-centro', 12],
      ['p-todas', 20],
    ])
  })
})

// ─────────────────────────────────────────────────────────────
// 2. "TROUXE DE VOLTA": O RECIBO QUE SE MEDE
// ─────────────────────────────────────────────────────────────

describe('recibo da reposição: só o que a conta sustenta', () => {
  // Uma variação só para esta conta, para as vendas dos outros testes não
  // entrarem nela.
  beforeAll(async () => {
    await db.exec(`
      insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, vendido_em, atualizado_em)
        values ('p-rep', 'org-a', 'Regata', 'UN', 50, 50, 50, 20, '{}', now());
      insert into variacoes (id, org_id, produto_id, codigo, padrao) values ('var-rep', 'org-a', 'p-rep', 'REG001', true);
    `)
  })

  const proposta = (id: string, diasAtras: number, dados: Record<string, unknown>) =>
    db.query(
      `insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, valor, situacao, expira_em, respondida_em, criada_em)
       values ($1, 'org-a', 'ag-a', 'pedir.compra', 'Repor', $2::jsonb, 400, 'CONFIRMADA',
               now() - ($3 || ' days')::interval + interval '1 day', now() - ($3 || ' days')::interval, now() - ($3 || ' days')::interval)`,
      [id, JSON.stringify(dados), diasAtras],
    )

  /** Uma venda concluída de `qtd` regatas a R$ 50, custo R$ 20, há `diasAtras`. */
  let n = 0
  const vendeu = async (qtd: number, diasAtras: number, custo: number | null = 20) => {
    n++
    await db.query(
      `insert into vendas (id, org_id, unidade_id, numero, situacao, subtotal, total, criada_em)
       values ($1, 'org-a', 'uni-a1', $2, 'CONCLUIDA', $3, $3, now() - ($4 || ' days')::interval)`,
      [`vd-rep-${n}`, 9000 + n, qtd * 50, diasAtras],
    )
    await db.query(
      `insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, medida, quantidade, preco_unit, total, custo_unit)
       values ($1, 'org-a', $2, 'var-rep', 'Regata', 'UN', $3, 50, $4, $5)`,
      [`vi-rep-${n}`, `vd-rep-${n}`, qtd, qtd * 50, custo],
    )
  }
  const entrou = (qtd: number, diasAtras: number) =>
    db.query(
      `insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em)
       values ($1, 'org-a', 'var-rep', 'uni-a1', 'ENTRADA', $2, $2, 'Reposição', 'Dona', now() - ($3 || ' days')::interval)`,
      [`mv-rep-${qtd}-${diasAtras}`, qtd, diasAtras],
    )

  it('a conta: o que vendeu além do saldo do aviso, limitado ao que entrou, vezes a margem', () => {
    const conta = (o: Partial<Parameters<typeof m.agente.valorDaReposicao>[0]>) =>
      m.agente.valorDaReposicao({ saldoNaProposta: 2, pedido: 20, entrou: 20, vendido: 10, comCusto: { quantidade: 10, margem: 300 }, ...o })
    expect(conta({})).toEqual({ unidades: 8, valor: 240 })
    expect(conta({ vendido: 2 })).toEqual({ unidades: 0, valor: 0 }) // vendeu só o que já tinha
    expect(conta({ entrou: 0 })).toEqual({ unidades: 0, valor: 0 }) // a mercadoria nunca chegou
    expect(conta({ entrou: 3 })).toEqual({ unidades: 3, valor: 90 }) // chegou só um pouco
    expect(conta({ pedido: 5 })).toEqual({ unidades: 5, valor: 150 }) // não credita mais que o pedido
    expect(conta({ comCusto: { quantidade: 0, margem: 0 } })).toEqual({ unidades: 0, valor: 0 }) // sem custo, sem margem
    expect(conta({ comCusto: { quantidade: 10, margem: -50 } })).toEqual({ unidades: 0, valor: 0 }) // vendeu no prejuízo
  })

  it('confirmada há 35 dias: vira UM recibo, com o valor da conta — mesmo apurando duas vezes ao mesmo tempo', async () => {
    await proposta('prop-rep', 35, {
      variacaoId: 'var-rep', quantidade: 20, saldoNaProposta: 2, unidadeIds: ['uni-a1', 'uni-a2'],
      descricao: 'Reposição: 20 × Regata (cód. REG001)',
    })
    await entrou(20, 33)
    await vendeu(4, 30)
    await vendeu(6, 20)
    await vendeu(3, 40) // antes do sim: não conta
    await vendeu(5, 2) // depois dos 30 dias: não conta

    const [a, b] = await Promise.all([m.agente.apurarRecibos('org-a'), m.agente.apurarRecibos('org-a')])
    expect(a + b).toBe(1)
    const recibos = await linha<{ tipo: string; valor: string; alvo_id: string; descricao: string }>(
      `select tipo, valor, alvo_id, descricao from recibos_agente`,
    )
    expect(recibos).toHaveLength(1)
    // vendeu 10 na janela, havia 2 no aviso: 8 a mais, R$ 30 de margem cada
    expect(recibos[0]).toMatchObject({ tipo: 'RUPTURA_EVITADA', alvo_id: 'prop-rep' })
    expect(Number(recibos[0]!.valor)).toBe(240)
    expect(recibos[0]!.descricao).toMatch(/Regata/)

    const bal = await m.agente.balanco('org-a', new Date(Date.now() - 864e5), new Date(Date.now() + 864e5))
    expect(bal.trouxe).toBe(240)
    // e apurar de novo não repete
    expect(await m.agente.apurarRecibos('org-a')).toBe(0)
  })

  it('janela ainda aberta, proposta sem o saldo do aviso ou sem venda além dele: nenhum recibo', async () => {
    await proposta('prop-aberta', 10, { variacaoId: 'var-rep', quantidade: 20, saldoNaProposta: 0 })
    await proposta('prop-conversa', 40, { descricao: 'Compra de mercadoria', valor: 500 })
    await proposta('prop-sobrou', 45, { variacaoId: 'var-rep', quantidade: 20, saldoNaProposta: 50 })
    expect(await m.agente.apurarRecibos('org-a')).toBe(0)
    const [n] = await linha<{ n: number }>(`select count(*)::int as n from recibos_agente`)
    expect(n!.n).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────
// 3. O FREIO DO LOGIN, COM TENTATIVAS AO MESMO TEMPO
// ─────────────────────────────────────────────────────────────

describe('freio de login: tentativas simultâneas não passam juntas', () => {
  it('doze senhas erradas disparadas juntas: só cinco chegam a conferir a senha', async () => {
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) => m.autenticacao.entrar('loja-a', 'g1@a.com', `chute-${i}`, '10.0.0.9')),
    )
    const motivos = rs.map((r) => (r.ok ? 'ok' : r.motivo))
    expect(motivos.filter((x) => x === 'credenciais')).toHaveLength(m.limite.MAX_POR_EMAIL)
    expect(motivos.filter((x) => x === 'muitas_tentativas')).toHaveLength(12 - m.limite.MAX_POR_EMAIL)

    // e a senha certa, agora, também espera: bloqueado é bloqueado
    const certa = await m.autenticacao.entrar('loja-a', 'g1@a.com', SENHA, '10.0.0.9')
    expect(certa.ok).toBe(false)
    if (!certa.ok) expect(certa.motivo).toBe('muitas_tentativas')
  }, 30_000)

  it('o acerto fica anotado como acerto (a reserva vira)', async () => {
    const r = await m.autenticacao.entrar('loja-a', 'dona@a.com', SENHA, '10.0.0.7')
    expect(r.ok).toBe(true)
    const t = await linha<{ sucesso: boolean }>(`select sucesso from tentativas_login where email = 'dona@a.com'`)
    expect(t.map((x) => x.sucesso)).toEqual([true])
  })
})
