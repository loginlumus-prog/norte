// As regras do servidor, com banco de verdade.
//
// Cada `it` aqui é um defeito achado na auditoria de 25/09 — a prova de que
// ele existia (o cenário que passava) virou a prova de que ele não passa
// mais. O banco é o PGlite de `tests/banco.ts` exposto numa porta, como em
// `assistente-fluxo.test.ts`: o código roda INTEIRO — `comoOrg`, Prisma, a
// troca de papel e o RLS.
//
// O que este arquivo NÃO prova: corrida entre duas transações ao mesmo
// tempo. O PGlite é um backend só (pool de um), então duas transações nunca
// se sobrepõem aqui. As travas de corrida (`travarVenda`, o `updateMany` com
// condição no recebimento e no fechamento do caixa) estão justificadas no
// código; a exceção é a proposta do assistente, que abre VÁRIAS transações
// e por isso se intercala mesmo com pool de um — essa está provada abaixo.
//
// As sessões são montadas à mão: é o que o cookie assinado entrega depois de
// conferido, e é exatamente o que um atacante com login tem nas mãos.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

// Importados depois de o banco subir: `banco.ts` lê DATABASE_URL no primeiro uso.
let m: {
  financeiro: typeof import('../src/servidor/financeiro')
  auditoria: typeof import('../src/servidor/auditoria')
  venda: typeof import('../src/servidor/venda')
  devolucao: typeof import('../src/servidor/devolucao')
  caixa: typeof import('../src/servidor/caixa')
  estoque: typeof import('../src/servidor/estoque')
  entrada: typeof import('../src/servidor/entrada')
  equipe: typeof import('../src/servidor/equipe')
  convite: typeof import('../src/servidor/convite')
  metas: typeof import('../src/servidor/metas')
  pendencias: typeof import('../src/servidor/pendencias')
  crediario: typeof import('../src/servidor/crediario')
  agente: typeof import('../src/servidor/agente')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[], orgId = 'org-a'): Sessao => ({
  orgId,
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])
const GER_CENTRO = sessao('usr-ger1', 'Gerente Centro', [{ papel: 'GERENTE', unidadeId: 'uni-a1' }])
const FIN_CENTRO = sessao('usr-fin1', 'Financeiro Centro', [{ papel: 'FINANCEIRO', unidadeId: 'uni-a1' }])
const DONA_GRATIS = sessao('usr-g', 'Dona Grátis', [{ papel: 'DONO', unidadeId: null }], 'org-g')

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,metas,agente,multiUnidade,encomenda}', now(), now()),
    ('org-g', 'Loja Grátis', 'loja-g', 'GRATIS', 'ATIVA', '{}', now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, now()),
    ('uni-a2', 'org-a', 'Loja Shopping', false, now()),
    ('uni-a3', 'org-a', 'Sorveteria', false, now()),
    ('uni-a9', 'org-a', 'Depósito', true, now()),
    ('uni-g1', 'org-g', 'Única', false, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona',  'org-a', 'Dona',              'dona@a.com',  now()),
    ('usr-dona2', 'org-a', 'Sócia',             'socia@a.com', now()),
    ('usr-ger1',  'org-a', 'Gerente Centro',    'g1@a.com',    now()),
    ('usr-ger2',  'org-a', 'Gerente Shopping',  'g2@a.com',    now()),
    ('usr-fin1',  'org-a', 'Financeiro Centro', 'f1@a.com',    now()),
    ('usr-bal1',  'org-a', 'Balcão Centro',     'b1@a.com',    now()),
    ('usr-g',     'org-g', 'Dona Grátis',       'g@g.com',     now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona',  'org-a', 'usr-dona',  null,     'DONO'),
    ('ac-dona2', 'org-a', 'usr-dona2', null,     'DONO'),
    ('ac-ger1',  'org-a', 'usr-ger1',  'uni-a1', 'GERENTE'),
    ('ac-ger2',  'org-a', 'usr-ger2',  'uni-a2', 'GERENTE'),
    ('ac-fin1',  'org-a', 'usr-fin1',  'uni-a1', 'FINANCEIRO'),
    ('ac-bal1',  'org-a', 'usr-bal1',  'uni-a1', 'BALCAO'),
    ('ac-g',     'org-g', 'usr-g',     null,     'DONO');

  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('cat-desp', 'org-a', 'Outras despesas', 'DESPESA', 'OUTRA'),
    ('cat-rec',  'org-a', 'Outras receitas', 'RECEITA', 'RECEITA_OUTRA');

  insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, vencimento, quem, atualizado_em) values
    ('lan-a2', 'org-a', 'uni-a2', 'cat-desp', 'DESPESA', 'Luz do shopping', 300.00, '2026-09-10', 'Dona', now()),
    ('lan-a1', 'org-a', 'uni-a1', 'cat-desp', 'DESPESA', 'Luz do centro',   200.00, '2026-09-10', 'Dona', now());

  insert into produtos (id, org_id, nome, preco_vista, preco_cartao, preco_crediario, custo, vendido_em, atualizado_em) values
    ('p-cam', 'org-a', 'Camiseta', 50.00, 50.00, 50.00, 20.00, '{uni-a1,uni-a2}', now()),
    ('p-sor', 'org-a', 'Sorvete',  10.00, 10.00, 10.00,  3.00, '{uni-a3}',        now()),
    ('p-g',   'org-g', 'Coisa',     5.00,  5.00,  5.00,  1.00, '{}',              now());

  insert into variacoes (id, org_id, produto_id, codigo) values
    ('var-cam', 'org-a', 'p-cam', 'CAM-1'),
    ('var-sor', 'org-a', 'p-sor', 'SOR-1'),
    ('var-g',   'org-g', 'p-g',   'G-1');

  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-cam', 'uni-a1', 50, now()),
    ('e2', 'org-a', 'var-cam', 'uni-a3', 0,  now()),
    ('e3', 'org-a', 'var-sor', 'uni-a3', 20, now()),
    ('e4', 'org-g', 'var-g',   'uni-g1', 1000, now());

  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Balcão Centro', 100),
    ('cx-a2', 'org-a', 'uni-a2', 'Gerente Shopping', 100),
    ('cx-g',  'org-g', 'uni-g1', 'Dona Grátis', 0);

  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-a', 'Cliente Um', now());

  insert into vales (id, org_id, codigo, valor, saldo, quem) values
    ('vale-1', 'org-a', 'VT-ABC234', 50.00, 50.00, 'Dona');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 59000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url

  m = {
    financeiro: await import('../src/servidor/financeiro'),
    auditoria: await import('../src/servidor/auditoria'),
    venda: await import('../src/servidor/venda'),
    devolucao: await import('../src/servidor/devolucao'),
    caixa: await import('../src/servidor/caixa'),
    estoque: await import('../src/servidor/estoque'),
    entrada: await import('../src/servidor/entrada'),
    equipe: await import('../src/servidor/equipe'),
    convite: await import('../src/servidor/convite'),
    metas: await import('../src/servidor/metas'),
    pendencias: await import('../src/servidor/pendencias'),
    crediario: await import('../src/servidor/crediario'),
    agente: await import('../src/servidor/agente'),
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

const vendaSimples = (extra: Partial<Parameters<typeof m.venda.registrarVenda>[1]> = {}) => ({
  unidadeId: 'uni-a1',
  caixaId: 'cx-a1',
  itens: [{ variacaoId: 'var-cam', quantidade: 1 }],
  pagamentos: [{ forma: 'DINHEIRO' as const, valor: 50 }],
  ...extra,
})

// ─────────────────────────────────────────────────────────────
// DINHEIRO
// ─────────────────────────────────────────────────────────────

describe('financeiro: a loja do lançamento decide', () => {
  it('o financeiro da loja Centro não dá baixa na conta da loja Shopping colando o id', async () => {
    await expect(m.financeiro.marcarPago(FIN_CENTRO, 'lan-a2', m.financeiro.hojeParaColuna())).rejects.toThrow(/permissão/)
    const [l] = await linha<{ pago_em: Date | null }>(`select pago_em from lancamentos where id = 'lan-a2'`)
    expect(l!.pago_em).toBeNull()
  })

  it('na própria loja dá baixa — uma vez só, mesmo com clique duplo', async () => {
    await m.financeiro.marcarPago(FIN_CENTRO, 'lan-a1', m.financeiro.hojeParaColuna())
    await m.financeiro.marcarPago(FIN_CENTRO, 'lan-a1', m.financeiro.hojeParaColuna())
    const livro = await linha(`select id from auditoria where acao = 'financeiro.pagou' and alvo_id = 'lan-a1'`)
    expect(livro).toHaveLength(1)
  })

  it('a baixa das 22h em São Paulo fica no dia de São Paulo, não no seguinte', () => {
    const as22h = new Date('2026-09-30T22:00:00-03:00')
    expect(m.financeiro.hojeParaColuna(as22h).toISOString().slice(0, 10)).toBe('2026-09-30')
  })

  it('despesa numa categoria de receita é recusada — o DRE somaria como dinheiro que entrou', async () => {
    await expect(
      m.financeiro.lancar(DONA, {
        categoriaId: 'cat-rec', tipo: 'DESPESA', descricao: 'Aluguel', valor: 100,
        vencimento: new Date('2026-09-10T00:00:00Z'),
      }),
    ).rejects.toThrow(/categoria é de receita/)
  })

  it('categoria que não é desta empresa não vira lançamento', async () => {
    await expect(
      m.financeiro.lancar(DONA, {
        categoriaId: 'cat-de-outra-empresa', tipo: 'DESPESA', descricao: 'X', valor: 10,
        vencimento: new Date('2026-09-10T00:00:00Z'),
      }),
    ).rejects.toThrow(/Categoria não encontrada/)
  })

  it('mês que não é mês (?mes=2026-13) devolve lista vazia, não erro', async () => {
    await expect(
      m.financeiro.listarLancamentos(DONA, { unidadeIds: ['uni-a1'], ano: 2026, mes: 13 }),
    ).resolves.toEqual([])
  })

  it('o DRE e as contas a vencer ignoram loja pedida que a pessoa não alcança', async () => {
    const r = await m.financeiro.aVencer(FIN_CENTRO, ['uni-a2'], 3650, new Date('2026-09-25T12:00:00-03:00'))
    expect(r.vencidas.map((v) => v.descricao)).not.toContain('Luz do shopping')
  })
})

describe('livro de auditoria: assunto e busca juntos', () => {
  it('as três condições ficam no AND — nenhuma apaga a outra', () => {
    const f = m.auditoria.filtroDoLivro(['uni-a1'], ['caixa.'], 'Ana')
    expect(f).toHaveLength(3)
    expect(JSON.stringify(f[1])).toContain('caixa.')
    expect(JSON.stringify(f[2])).toContain('Ana')
  })

  it('filtrar por "caixa" e buscar um nome não traz o que a pessoa fez em outro assunto', async () => {
    const de = new Date(Date.now() - 864e5)
    const ate = new Date(Date.now() + 864e5)
    // O financeiro de cima deixou 'financeiro.pagou' no nome dele.
    const so = await m.auditoria.listarAuditoria(DONA, {
      unidadeIds: ['uni-a1', 'uni-a2'], de, ate, assunto: 'caixa', q: 'Financeiro Centro',
    })
    expect(so.filter((l) => !l.acao.startsWith('caixa.'))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// VENDA
// ─────────────────────────────────────────────────────────────

describe('venda: o caixa, a forma e o plano', () => {
  it('o caixa aberto de OUTRA loja não recebe o dinheiro desta venda', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({ caixaId: 'cx-a2' }))
    expect(r).toMatchObject({ ok: false, motivo: 'caixa_fechado' })
  })

  it('quantidade negativa não é item (era desconto escondido)', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({
      itens: [{ variacaoId: 'var-cam', quantidade: 2 }, { variacaoId: 'var-cam', quantidade: -1 }],
    }))
    expect(r).toMatchObject({ ok: false, motivo: 'sem_itens' })
  })

  it('pagamento negativo (dinheiro saindo da gaveta dentro da venda) é recusado', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({
      pagamentos: [{ forma: 'PIX', valor: 100 }, { forma: 'DINHEIRO', valor: -50 }],
    }))
    expect(r).toMatchObject({ ok: false, motivo: 'pagamento_nao_fecha' })
  })

  it('desconto negativo não cobra acima da etiqueta', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({ desconto: -20, pagamentos: [{ forma: 'DINHEIRO', valor: 70 }] }))
    expect(r).toMatchObject({ ok: false, motivo: 'pagamento_nao_fecha', total: 50 })
  })

  it('sem caixa informado, a venda entra no caixa aberto da loja', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({ caixaId: null }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [v] = await linha<{ caixa_id: string | null }>(`select caixa_id from vendas where id = $1`, [r.vendaId])
    expect(v!.caixa_id).toBe('cx-a1')
  })

  it('o Grátis para no teto de vendas do mês que a página promete', async () => {
    const teto = 300
    const valores = Array.from({ length: teto }, (_, i) =>
      `('vg-${i}', 'org-g', 'uni-g1', ${i + 1}, 'CONCLUIDA', 5, now())`,
    ).join(',')
    await db.exec(`insert into vendas (id, org_id, unidade_id, numero, situacao, total, criada_em) values ${valores}`)
    await db.exec(`update unidades set proxima_venda = ${teto + 1} where id = 'uni-g1'`)
    const r = await m.venda.registrarVenda(DONA_GRATIS, {
      unidadeId: 'uni-g1', caixaId: 'cx-g',
      itens: [{ variacaoId: 'var-g', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 5 }],
    })
    expect(r).toMatchObject({ ok: false, motivo: 'teto_do_plano' })
  })
})

describe('cancelar e devolver sem contar duas vezes', () => {
  it('venda que já teve devolução não se cancela inteira (o estoque voltaria em dobro)', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({ itens: [{ variacaoId: 'var-cam', quantidade: 2 }], pagamentos: [{ forma: 'DINHEIRO', valor: 100 }] }))
    if (!r.ok) throw new Error(JSON.stringify(r))
    const [item] = await linha<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    const d = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: item!.id, quantidade: 1 }], destino: 'ESTORNO', motivo: 'não serviu' })
    expect(d.ok).toBe(true)
    const antes = await linha<{ quantidade: string }>(`select quantidade from estoque where id = 'e1'`)
    const c = await m.venda.cancelarVenda(DONA, r.vendaId, 'engano')
    expect(c).toMatchObject({ ok: false, motivo: 'ja_devolvida' })
    expect(await linha(`select quantidade from estoque where id = 'e1'`)).toEqual(antes)
  })

  it('cancelar a venda paga com vale devolve o saldo do vale', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({ pagamentos: [{ forma: 'VALE', valor: 50, referencia: 'VT-ABC234' }] }))
    if (!r.ok) throw new Error(JSON.stringify(r))
    expect((await linha<{ saldo: string }>(`select saldo from vales where id = 'vale-1'`))[0]!.saldo).toBe('0.00')
    const c = await m.venda.cancelarVenda(DONA, r.vendaId, 'desistiu')
    expect(c.ok).toBe(true)
    expect((await linha<{ saldo: string }>(`select saldo from vales where id = 'vale-1'`))[0]!.saldo).toBe('50.00')
  })

  it('cancelar a venda no crediário apaga as parcelas — o cliente não segue devendo', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({
      clienteId: 'cli-1', pagamentos: [{ forma: 'CREDIARIO', valor: 50, parcelas: 1 }],
    }))
    if (!r.ok) throw new Error(JSON.stringify(r))
    expect(await linha(`select id from parcelas where venda_id = $1`, [r.vendaId])).toHaveLength(1)
    const c = await m.venda.cancelarVenda(DONA, r.vendaId, 'desistiu')
    expect(c.ok).toBe(true)
    expect(await linha(`select id from parcelas where venda_id = $1`, [r.vendaId])).toHaveLength(0)
  })

  it('devolver em dinheiro a peça do crediário ainda não paga abate a dívida e não tira da gaveta', async () => {
    const r = await m.venda.registrarVenda(DONA, vendaSimples({
      clienteId: 'cli-1', pagamentos: [{ forma: 'CREDIARIO', valor: 50, parcelas: 1 }],
    }))
    if (!r.ok) throw new Error(JSON.stringify(r))
    const [item] = await linha<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    const sangriasAntes = await linha(`select id from caixa_movimentos where caixa_id = 'cx-a1' and tipo = 'SANGRIA'`)
    const d = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: item!.id, quantidade: 1 }], destino: 'DINHEIRO', motivo: 'não serviu' })
    expect(d).toMatchObject({ ok: true, valor: 0, abatido: 50 })
    expect(await linha(`select id from caixa_movimentos where caixa_id = 'cx-a1' and tipo = 'SANGRIA'`)).toEqual(sangriasAntes)
    const [p] = await linha<{ valor: string; quitada_em: Date | null }>(`select valor, quitada_em from parcelas where venda_id = $1`, [r.vendaId])
    expect(p!.valor).toBe('0.00')
    expect(p!.quitada_em).not.toBeNull()
  })

  it('a parte que abate e a que sobra, em centavos, da última parcela para a primeira', () => {
    const r = m.devolucao.abaterDoFiado(
      [
        { id: 'p1', numero: 1, valorCent: 3334, pagoCent: 3334 },
        { id: 'p2', numero: 2, valorCent: 3333, pagoCent: 1000 },
        { id: 'p3', numero: 3, valorCent: 3333, pagoCent: 0 },
      ],
      5000,
    )
    expect(r.abatidoCent).toBe(5000)
    expect(r.parcelas).toEqual([
      { id: 'p3', novoValorCent: 0, quitada: true },
      { id: 'p2', novoValorCent: 1666, quitada: false },
    ])
    expect(m.devolucao.abaterDoFiado([], 5000)).toEqual({ abatidoCent: 0, parcelas: [] })
  })
})

describe('caixa', () => {
  it('a conferência da gaveta confere a loja do caixa', async () => {
    await expect(m.caixa.conferirCaixa(GER_CENTRO, 'cx-a2')).rejects.toThrow(/permissão/)
  })

  // Em sequência o segundo já era recusado; a corrida de verdade (dois ao
  // mesmo tempo) é o que o `updateMany where aberto` fecha — e o PGlite, com
  // um backend só, não reproduz duas transações simultâneas.
  it('fechar duas vezes o mesmo turno: o segundo é recusado e o livro tem um fechamento', async () => {
    // Na Sorveteria, que não tem caixa aberto: a loja só pode ter UM aberto
    // (índice caixas_um_aberto_por_unidade), e o Shopping já tem o cx-a2.
    await db.exec(`insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-dup', 'org-a', 'uni-a3', 'X', 0)`)
    await m.caixa.fecharCaixa(DONA, 'cx-dup', 0)
    await expect(m.caixa.fecharCaixa(DONA, 'cx-dup', 0)).rejects.toThrow(/fechado/)
    expect(await linha(`select id from auditoria where acao = 'caixa.fechou' and alvo_id = 'cx-dup'`)).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────
// ESTOQUE E CATÁLOGO POR LOJA
// ─────────────────────────────────────────────────────────────

describe('estoque: onde a mercadoria pode ir', () => {
  it('transferir camiseta para a sorveteria (que não vende camiseta) é recusado', async () => {
    await expect(
      m.estoque.transferir(DONA, { variacaoId: 'var-cam', deUnidadeId: 'uni-a1', paraUnidadeId: 'uni-a3', quantidade: 1 }),
    ).rejects.toThrow(/Sorveteria não vende Camiseta/)
  })

  it('para o depósito pode: guardar é o trabalho dele', async () => {
    const r = await m.estoque.transferir(DONA, { variacaoId: 'var-cam', deUnidadeId: 'uni-a1', paraUnidadeId: 'uni-a9', quantidade: 1 })
    expect(r.ok).toBe(true)
  })

  it('dar entrada de sorvete na loja de roupa é recusado; no depósito passa', async () => {
    const na = await m.entrada.registrarEntrada(DONA, { unidadeId: 'uni-a1', itens: [{ variacaoId: 'var-sor', quantidade: 5 }] })
    expect(na).toMatchObject({ ok: false })
    if (!na.ok) expect(na.motivo).toMatch(/não vende Sorvete/)
    const dep = await m.entrada.registrarEntrada(DONA, { unidadeId: 'uni-a9', itens: [{ variacaoId: 'var-sor', quantidade: 5 }] })
    expect(dep.ok).toBe(true)
  })

  it('corrigir o saldo à mão escreve no livro, com o antes e o depois', async () => {
    const r = await m.estoque.mexerEstoque(DONA, { variacaoId: 'var-cam', unidadeId: 'uni-a1', tipo: 'BALANCO', quantidade: 7, motivo: 'contagem' })
    expect(r).toMatchObject({ ok: true, saldo: 7 })
    const [l] = await linha<{ antes: { saldo: number }; depois: { saldo: number } }>(
      `select antes, depois from auditoria where acao = 'estoque.ajustou' order by criado_em desc limit 1`,
    )
    expect(l!.depois.saldo).toBe(7)
    expect(typeof l!.antes.saldo).toBe('number')
  })

  it('quantidade que não é número não entra no saldo', async () => {
    await expect(
      m.estoque.mexerEstoque(DONA, { variacaoId: 'var-cam', unidadeId: 'uni-a1', tipo: 'AJUSTE', quantidade: Number.NaN }),
    ).rejects.toThrow(/número/)
  })

  it('"acabou" não conta a linha zerada de produto que a loja não vende', async () => {
    const c = await m.pendencias.pendenciasDoDia(DONA, { modulos: [] }, ['uni-a3'])
    // e2 = camiseta zerada na sorveteria: não é falta, a sorveteria nem vende.
    expect(c.acabaram).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// EQUIPE
// ─────────────────────────────────────────────────────────────

describe('equipe: ninguém mexe em quem está acima ou em outra loja', () => {
  it('o gerente do Centro não desativa a dona', async () => {
    const r = await m.equipe.mudarSituacao(GER_CENTRO, 'usr-dona2', false)
    expect(r.ok).toBe(false)
    expect((await linha<{ ativo: boolean }>(`select ativo from usuarios where id = 'usr-dona2'`))[0]!.ativo).toBe(true)
  })

  it('o gerente do Centro não rebaixa a sócia nem mexe no gerente do Shopping', async () => {
    expect((await m.equipe.mudarAcesso(GER_CENTRO, 'usr-dona2', { papel: 'BALCAO', unidadeId: 'uni-a1' })).ok).toBe(false)
    expect((await m.equipe.mudarAcesso(GER_CENTRO, 'usr-ger2', { papel: 'BALCAO', unidadeId: 'uni-a1' })).ok).toBe(false)
  })

  it('o gerente do Centro não dá balcão "para todas as lojas"', async () => {
    const r = await m.equipe.mudarAcesso(GER_CENTRO, 'usr-bal1', { papel: 'BALCAO', unidadeId: null })
    expect(r.ok).toBe(false)
    await expect(
      m.convite.convidar(GER_CENTRO, { email: 'nova@a.com', papel: 'BALCAO', unidadeId: null }, 'http://x/loja-a'),
    ).rejects.toThrow(/todas as lojas/)
  })

  it('na própria loja ele continua podendo', async () => {
    const r = await m.equipe.mudarAcesso(GER_CENTRO, 'usr-bal1', { papel: 'BALCAO', unidadeId: 'uni-a1' })
    expect(r.ok).toBe(true)
  })

  it('ninguém define a própria comissão', async () => {
    await expect(
      m.metas.salvarMeta(GER_CENTRO, { usuarioId: 'usr-ger1', mes: '2026-09', valor: 1000, comissaoPct: 50 }),
    ).rejects.toThrow(/própria/)
  })

  it('o gerente do Centro não define a comissão do gerente do Shopping', async () => {
    await expect(
      m.metas.salvarMeta(GER_CENTRO, { usuarioId: 'usr-ger2', mes: '2026-09', valor: 1000, comissaoPct: 50 }),
    ).rejects.toThrow(/não pode definir/)
  })
})

// ─────────────────────────────────────────────────────────────
// ASSISTENTE
// ─────────────────────────────────────────────────────────────

describe('proposta do assistente', () => {
  it('confirmar duas vezes ao mesmo tempo executa uma vez só', async () => {
    await db.exec(`
      insert into agentes (id, org_id, nome, poderes, atualizado_em) values ('ag-a', 'org-a', 'Nina', '{ajustar.estoque}', now());
      insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, expira_em) values
        ('prop-1', 'org-a', 'ag-a', 'ajustar.estoque', 'Somar 3 camisetas',
         '{"variacaoId":"var-cam","unidadeId":"uni-a1","quantidade":3,"motivo":"achou no fundo"}', now() + interval '1 day');
    `)
    const antes = Number((await linha<{ quantidade: string }>(`select quantidade from estoque where id = 'e1'`))[0]!.quantidade)
    const empresa = { modulos: ['agente'] }
    const [a, b] = await Promise.all([
      m.agente.responderProposta(DONA, empresa, 'prop-1', true),
      m.agente.responderProposta(DONA, empresa, 'prop-1', true),
    ])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const depois = Number((await linha<{ quantidade: string }>(`select quantidade from estoque where id = 'e1'`))[0]!.quantidade)
    expect(depois - antes).toBe(3)
  })

  it('o gerente do Centro não confirma ajuste de estoque de outra loja', async () => {
    await db.exec(`
      insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, expira_em) values
        ('prop-2', 'org-a', 'ag-a', 'ajustar.estoque', 'Somar sorvete',
         '{"variacaoId":"var-sor","unidadeId":"uni-a3","quantidade":3,"motivo":"x"}', now() + interval '1 day');
    `)
    const r = await m.agente.responderProposta(GER_CENTRO, { modulos: ['agente'] }, 'prop-2', true)
    expect(r.ok).toBe(false)
  })
})
