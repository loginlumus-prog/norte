// Produtos, Estoque, Preços e Lojas, com banco de verdade.
//
// Cada `it` aqui é um defeito da auditoria de 27/09 — o cenário que passava
// virou a prova de que não passa mais. O banco é o PGlite de `tests/banco.ts`
// exposto numa porta, como em `regras-servidor.test.ts`: `comoOrg`, Prisma,
// a troca de papel e o RLS rodam inteiros.
//
// O que NÃO se prova aqui: corrida entre duas transações (o PGlite é um
// backend só). As travas de corrida — o `for update` do balanço e o
// `pg_advisory_xact_lock` da cota de lojas — estão justificadas no código;
// aqui se prova que o caminho por elas continua fazendo a conta certa.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  produto: typeof import('../src/servidor/produto')
  estoque: typeof import('../src/servidor/estoque')
  precificacao: typeof import('../src/servidor/precificacao')
  lojas: typeof import('../src/servidor/lojas')
  agente: typeof import('../src/servidor/agente')
  assinatura: typeof import('../src/servidor/assinatura')
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

// Plano Balcão: três lojas. A empresa já está com as três abertas.
const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO', 'ATIVA', '{multiUnidade,encomenda}', now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, now()),
    ('uni-a2', 'org-a', 'Loja Shopping', false, now()),
    ('uni-a9', 'org-a', 'Depósito', true, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona', 'dona@a.com', now()),
    ('usr-ger1', 'org-a', 'Gerente Centro', 'g1@a.com', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null,     'DONO'),
    ('ac-ger1', 'org-a', 'usr-ger1', 'uni-a1', 'GERENTE');

  insert into eixos (id, org_id, nome, ordem) values ('eixo-cor', 'org-a', 'Cor', 0);
  insert into opcoes (id, org_id, eixo_id, valor, ordem) values ('op-azul', 'org-a', 'eixo-cor', 'Azul', 0);

  insert into produtos (id, org_id, nome, preco_vista, preco_cartao, preco_crediario, custo, vendido_em, atualizado_em) values
    ('p-cam', 'org-a', 'Camiseta', 50.00, 50.00, 50.00, 20.00, '{uni-a1,uni-a2}', now()),
    ('p-sor', 'org-a', 'Picolé',   10.00, 10.00, 10.00,  3.00, '{uni-a2}',        now()),
    ('p-rep', 'org-a', 'Meia',     20.00, 20.00, 20.00, 10.00, '{}',              now());

  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('var-cam', 'org-a', 'p-cam', 'CAM001', true),
    ('var-sor', 'org-a', 'p-sor', 'PIC001', true),
    ('var-rep', 'org-a', 'p-rep', 'MEI001', true);

  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-cam', 'uni-a1', 10, now()),
    ('e2', 'org-a', 'var-cam', 'uni-a2', 5,  now()),
    ('e3', 'org-a', 'var-sor', 'uni-a2', 8,  now());

  insert into vendas (id, org_id, unidade_id, numero, situacao, total, criada_em) values
    ('v-centro',   'org-a', 'uni-a1', 1, 'CONCLUIDA', 50,  now()),
    ('v-shopping', 'org-a', 'uni-a2', 2, 'CONCLUIDA', 100, now());
  insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, quantidade, preco_unit, total, custo_unit) values
    ('vi-1', 'org-a', 'v-centro',   'var-cam', 'Camiseta', 1, 50, 50,  20),
    ('vi-2', 'org-a', 'v-shopping', 'var-cam', 'Camiseta', 2, 50, 100, 20);

  insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, para, quem, atualizada_em) values
    ('enc-1', 'org-a', 'uni-a2', 'Cliente', 'Bolo', now() + interval '2 days', 'Dona', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 56000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url

  m = {
    produto: await import('../src/servidor/produto'),
    estoque: await import('../src/servidor/estoque'),
    precificacao: await import('../src/servidor/precificacao'),
    lojas: await import('../src/servidor/lojas'),
    agente: await import('../src/servidor/agente'),
    assinatura: await import('../src/servidor/assinatura'),
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

// ─────────────────────────────────────────────────────────────
// A FICHA DO PRODUTO VÊ SÓ AS LOJAS DE QUEM ABRE
// ─────────────────────────────────────────────────────────────

describe('ficha do produto: o gerente lê a loja dele', () => {
  it('o saldo da grade soma só as lojas que a pessoa alcança — o mesmo número do Estoque', async () => {
    const soma = (p: Awaited<ReturnType<typeof m.produto.acharProduto>>) =>
      p!.variacoes[0]!.estoques.reduce((t, e) => t + Number(e.quantidade), 0)
    expect(soma(await m.produto.acharProduto(GER_CENTRO, 'p-cam'))).toBe(10)
    expect(soma(await m.produto.acharProduto(DONA, 'p-cam'))).toBe(15)
  })

  it('"Onde está" não mostra o saldo do Shopping ao gerente do Centro', async () => {
    const r = await m.produto.estoqueDoProduto(GER_CENTRO, 'p-cam')
    expect(r.map((l) => l.unidadeId)).toEqual(['uni-a1'])
  })

  it('"Como vende" conta só a venda da loja dele, e a dona vê as duas', async () => {
    expect((await m.produto.comoVende(GER_CENTRO, 'p-cam')).qtd30).toBe(1)
    expect((await m.produto.comoVende(DONA, 'p-cam')).qtd30).toBe(3)
    // Pedir a loja do vizinho não abre a porta.
    expect((await m.produto.comoVende(GER_CENTRO, 'p-cam', ['uni-a2'])).qtd30).toBe(0)
  })

  it('custo e margem: só de produto vendido em alguma loja de quem pergunta', () => {
    expect(m.produto.podeVerCustoDe(GER_CENTRO, ['uni-a2'])).toBe(false)
    expect(m.produto.podeVerCustoDe(GER_CENTRO, ['uni-a1', 'uni-a2'])).toBe(true)
    expect(m.produto.podeVerCustoDe(GER_CENTRO, [])).toBe(true)
    expect(m.produto.podeVerCustoDe(DONA, ['uni-a2'])).toBe(true)
  })

  it('Preços: o gerente do Centro não lê o custo do picolé que só o Shopping vende', async () => {
    const ger = await m.precificacao.analisarCatalogo(GER_CENTRO, 40)
    expect(ger.map((l) => l.produtoId).sort()).toEqual(['p-cam', 'p-rep'])
    const dona = await m.precificacao.analisarCatalogo(DONA, 40)
    expect(dona.map((l) => l.produtoId)).toContain('p-sor')
  })
})

// ─────────────────────────────────────────────────────────────
// A GRADE NÃO ESCONDE SALDO
// ─────────────────────────────────────────────────────────────

describe('grade: o item que sai não leva o saldo junto', () => {
  const COR_AZUL = [{ eixoId: 'eixo-cor', opcaoIds: ['op-azul'] }]

  it('pôr cor na camiseta que tem 15 sem variação é recusado, e nada muda', async () => {
    await expect(m.produto.ajustarGrade(DONA, 'p-cam', COR_AZUL)).rejects.toThrow(m.produto.GradeRecusada)
    await expect(m.produto.ajustarGrade(DONA, 'p-cam', COR_AZUL)).rejects.toThrow(/Loja Centro: 10.*Loja Shopping: 5|Loja Shopping: 5.*Loja Centro: 10/)
    const vs = await linha<{ id: string; ativa: boolean }>(`select id, ativa from variacoes where produto_id = 'p-cam'`)
    expect(vs).toEqual([{ id: 'var-cam', ativa: true }])
  })

  it('zerado pelo balanço, a grade muda — e o item velho é desativado, não apagado', async () => {
    for (const unidadeId of ['uni-a1', 'uni-a2']) {
      const r = await m.estoque.mexerEstoque(DONA, { variacaoId: 'var-cam', unidadeId, tipo: 'BALANCO', quantidade: 0, motivo: 'vai virar grade' })
      expect(r).toEqual({ ok: true, saldo: 0 })
    }
    const g = await m.produto.ajustarGrade(DONA, 'p-cam', COR_AZUL)
    expect(g).toMatchObject({ criadas: 1, desativadas: 1 })
  })
})

// ─────────────────────────────────────────────────────────────
// BALANÇO
// ─────────────────────────────────────────────────────────────

describe('balanço: o saldo termina no que foi contado', () => {
  it('contou 3 com 8 gravado: fica 3, o movimento é −5 e o livro guarda o antes', async () => {
    const r = await m.estoque.mexerEstoque(DONA, { variacaoId: 'var-sor', unidadeId: 'uni-a2', tipo: 'BALANCO', quantidade: 3, motivo: 'contagem' })
    expect(r).toEqual({ ok: true, saldo: 3 })
    const [mov] = await linha<{ quantidade: string }>(
      `select quantidade from movimentos_estoque where variacao_id = 'var-sor' and tipo = 'BALANCO' order by criado_em desc limit 1`,
    )
    expect(Number(mov!.quantidade)).toBe(-5)
    const [aud] = await linha<{ antes: { saldo: number } }>(
      `select antes from auditoria where acao = 'estoque.ajustou' and alvo_id = 'var-sor' order by criado_em desc limit 1`,
    )
    expect(aud!.antes.saldo).toBe(8)
  })

  it('a ficha sabe quem tem história: "já tem venda" só onde teve venda ou movimento', async () => {
    const p = await m.produto.acharProduto(DONA, 'p-rep')
    expect(p!.variacoes.filter((v) => v._count.vendaItens > 0 || v._count.movimentos > 0)).toHaveLength(0)
    const q = await m.produto.acharProduto(DONA, 'p-sor')
    expect(q!.variacoes.filter((v) => v._count.vendaItens > 0 || v._count.movimentos > 0)).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────
// O SALDO NUMA VISTA (Produtos e Estoque)
// ─────────────────────────────────────────────────────────────

describe('saldoNaVista: Produtos e Estoque contam igual', () => {
  const CENTRO = { id: 'c', ehDeposito: false }
  const SHOP = { id: 's', ehDeposito: false }
  const DEP = { id: 'd', ehDeposito: true }

  it('soma só as lojas da vista, e o mínimo é o maior delas', () => {
    const r = m.produto.saldoNaVista([], [
      { unidadeId: 'c', quantidade: 3, minimo: 2 },
      { unidadeId: 's', quantidade: 9, minimo: 5 },
    ], [CENTRO])
    expect(r).toEqual({ aparece: true, saldo: 3, minimo: 2, nivel: 'bom' })
    expect(m.produto.saldoNaVista([], [
      { unidadeId: 'c', quantidade: 3, minimo: 2 },
      { unidadeId: 's', quantidade: 1, minimo: 5 },
    ], [CENTRO, SHOP]).nivel).toBe('atencao')
  })

  it('item nunca estocado que a loja vende aparece como "acabou"', () => {
    expect(m.produto.saldoNaVista(['c'], [], [CENTRO])).toMatchObject({ aparece: true, nivel: 'critico' })
  })

  it('o que a loja não vende e não tem ali não aparece — não é "acabou"', () => {
    expect(m.produto.saldoNaVista(['s'], [{ unidadeId: 'c', quantidade: 0, minimo: null }], [CENTRO]).aparece).toBe(false)
    // Com saldo, aparece: é mercadoria de verdade, alguém precisa tirar de lá.
    expect(m.produto.saldoNaVista(['s'], [{ unidadeId: 'c', quantidade: 2, minimo: null }], [CENTRO]).aparece).toBe(true)
  })

  it('depósito não vende: só aparece o que tem linha nele', () => {
    expect(m.produto.saldoNaVista([], [], [DEP]).aparece).toBe(false)
    expect(m.produto.saldoNaVista([], [{ unidadeId: 'd', quantidade: 0, minimo: null }], [DEP]).aparece).toBe(true)
  })

  it('a empresa inteira de quem responde por ela vê tudo', () => {
    expect(m.produto.saldoNaVista(['loja-fechada'], [], [CENTRO], true).aparece).toBe(true)
  })
})

describe('endereço com parâmetro repetido não derruba a tela', () => {
  it('?alvo=1&alvo=2 cai no alvo padrão', () => {
    expect(m.precificacao.lerAlvo(['1', '2'])).toBe(m.precificacao.ALVO_PADRAO)
    expect(m.precificacao.lerAlvo('35')).toBe(35)
  })
})

// ─────────────────────────────────────────────────────────────
// LOJAS
// ─────────────────────────────────────────────────────────────

describe('lojas: a cota conferida dentro, e fechar com pendência', () => {
  it('"só dela" é só dela: o picolé do Shopping conta, a camiseta das duas não', async () => {
    const lojas = await m.lojas.listarLojas(DONA)
    expect(lojas.find((l) => l.id === 'uni-a2')!.exclusivos).toBe(1)
    expect(lojas.find((l) => l.id === 'uni-a1')!.exclusivos).toBe(0)
  })

  it('com as três do plano abertas, a quarta é recusada', async () => {
    await expect(m.lojas.criarLoja(DONA, { nome: 'Quarta' })).rejects.toThrow(m.assinatura.SemCota)
    const [n] = await linha<{ n: number }>(`select count(*)::int n from unidades where org_id = 'org-a'`)
    expect(n!.n).toBe(3)
  })

  it('fechar a loja com saldo e encomenda diz as duas coisas de uma vez', async () => {
    const recusa = m.lojas.mudarSituacaoLoja(DONA, 'uni-a2', false)
    await expect(recusa).rejects.toThrow(m.lojas.LojaRecusada)
    await expect(m.lojas.mudarSituacaoLoja(DONA, 'uni-a2', false)).rejects.toThrow(/saldo no estoque.*encomenda por entregar/)
    const [u] = await linha<{ ativa: boolean }>(`select ativa from unidades where id = 'uni-a2'`)
    expect(u!.ativa).toBe(true)
  })

  it('fechou o depósito vazio, abriu outra no lugar — e reabrir o depósito passaria do plano', async () => {
    await m.lojas.mudarSituacaoLoja(DONA, 'uni-a9', false)
    const r = await m.lojas.criarLoja(DONA, { nome: 'Loja Bairro' })
    expect(r.loja.nome).toBe('Loja Bairro')
    await expect(m.lojas.mudarSituacaoLoja(DONA, 'uni-a9', true)).rejects.toThrow(m.assinatura.SemCota)
    const [n] = await linha<{ n: number }>(`select count(*)::int n from unidades where org_id = 'org-a' and ativa`)
    expect(n!.n).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────
// O RECIBO DO ASSISTENTE
// ─────────────────────────────────────────────────────────────

describe('recibo de ruptura evitada: transferência não é compra', () => {
  it('peça que só veio de outra loja não vira "reposição que o assistente evitou"', async () => {
    await db.exec(`
      insert into agentes (id, org_id, nome, atualizado_em) values ('ag-a', 'org-a', 'Assistente', now());
      insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, situacao, expira_em, respondida_em) values
        ('prop-1', 'org-a', 'ag-a', 'pedir.compra', 'Reposição: Meia',
         '{"variacaoId":"var-rep","quantidade":10,"saldoNaProposta":0,"unidadeIds":["uni-a1"],"descricao":"Reposição: Meia"}',
         'CONFIRMADA', now(), now() - interval '31 days');
      insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em) values
        ('mv-t', 'org-a', 'var-rep', 'uni-a1', 'ENTRADA', 10, 10, 'Transferência de Loja Shopping', 'Dona', now() - interval '30 days');
      insert into vendas (id, org_id, unidade_id, numero, situacao, total, criada_em) values
        ('v-rep', 'org-a', 'uni-a1', 3, 'CONCLUIDA', 100, now() - interval '20 days');
      insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, quantidade, preco_unit, total, custo_unit) values
        ('vi-rep', 'org-a', 'v-rep', 'var-rep', 'Meia', 5, 20, 100, 10);
    `)
    expect(await m.agente.apurarRecibos('org-a')).toBe(0)

    // A compra de verdade entra — aí sim há o que medir.
    await db.exec(`
      insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em) values
        ('mv-c', 'org-a', 'var-rep', 'uni-a1', 'ENTRADA', 10, 20, 'Entrada — Fornecedor', 'Dona', now() - interval '29 days');
    `)
    expect(await m.agente.apurarRecibos('org-a')).toBe(1)
    const [r] = await linha<{ valor: string }>(`select valor from recibos_agente where alvo_id = 'prop-1'`)
    expect(Number(r!.valor)).toBe(50) // 5 vendidas × R$ 10 de margem
  })
})
