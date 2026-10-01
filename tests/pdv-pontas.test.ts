// As pontas soltas da Fase 1A do balcão, achadas testando de ponta a ponta:
//
//   1. a tela de "venda concluída" fala a forma como a pessoa fala
//      ("Crediário 3×", "Crédito 2× · Banco X", "Dividido: …"), não o nome do
//      banco ("CREDIARIO")
//   2. a cliente que só tem compra trazida do sistema anterior não é
//      "primeira compra aqui"
//   3. o troco da venda fica guardado e volta no comprovante e na ficha
//   4. cancelar venda no crediário com QUALQUER rastro na parcela (desconto,
//      multa, recebimento) recusa com a frase, em vez do erro cru do banco
//   5. o fechamento do caixa confere cada maquininha com vendas e crediário
//      juntos
//   6. a taxa da maquininha no DRE conta também a parcela do crediário
//      recebida no cartão ou no Pix
//
// Mesmo arranjo de `pdv-balcao.test.ts`: o PGlite exposto numa porta, e o
// código rodando inteiro (comoOrg, Prisma, RLS).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'
import { brl, historicoDoCliente, rotuloDoPagamento } from '../src/app/[empresa]/balcao/conta'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  venda: typeof import('../src/servidor/venda')
  caixa: typeof import('../src/servidor/caixa')
  cliente: typeof import('../src/servidor/cliente')
  taxas: typeof import('../src/servidor/taxas')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, crediario_max_parcelas, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,multiUnidade}', 15, 12, now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, ativa, maquininhas, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, '[{"nome":"Stone","formas":["DEBITO","CREDITO"]},{"nome":"Conta PJ","formas":["PIX"]}]', now()),
    ('uni-a2', 'org-a', 'Loja Bairro', false, true, null, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona', 'dona@a.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO');

  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, ativo, atualizado_em) values
    ('p-cam', 'org-a', 'Camiseta', 'UN', 50.00, 50.00, 50.00, 20.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-cam', 'org-a', 'p-cam', 'CAM-1', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-cam', 'uni-a1', 100, now());

  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Dona', 0);

  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-a', 'Cliente Um', now()),
    ('cli-velha', 'org-a', 'Rosa Antiga', now()),
    ('cli-ambas', 'org-a', 'Lia Ambas', now()),
    ('cli-nova', 'org-a', 'Bia Novinha', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 50000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    venda: await import('../src/servidor/venda'),
    caixa: await import('../src/servidor/caixa'),
    cliente: await import('../src/servidor/cliente'),
    taxas: await import('../src/servidor/taxas'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linha = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

// ─────────────────────────────────────────────────────────────
describe('1. a forma como se fala', () => {
  it('crediário e crédito com as vezes e a maquininha; dividido junta as partes', () => {
    expect(rotuloDoPagamento([{ forma: 'CREDIARIO', parcelas: 3 }])).toBe('Crediário 3×')
    expect(rotuloDoPagamento([{ forma: 'CREDIARIO', parcelas: 1 }])).toBe('Crediário 1×')
    expect(rotuloDoPagamento([{ forma: 'CREDITO', parcelas: 2, maquininha: 'Banco X' }])).toBe('Crédito 2× · Banco X')
    expect(rotuloDoPagamento([{ forma: 'CREDITO', parcelas: 1 }])).toBe('Crédito')
    expect(rotuloDoPagamento([{ forma: 'VALE' }])).toBe('Vale-troca')
    expect(rotuloDoPagamento([{ forma: 'PIX', maquininha: 'Conta PJ' }, { forma: 'DINHEIRO' }])).toBe(
      'Dividido: Pix · Conta PJ + Dinheiro',
    )
    expect(rotuloDoPagamento([])).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────
describe('2. a cliente com histórico trazido do sistema anterior', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into vendas (id, org_id, unidade_id, numero, cliente_id, situacao, subtotal, total, criada_em) values
        ('vh-1', 'org-a', 'uni-a1', 801, 'cli-velha', 'SALDO_IMPORTADO', 300, 300, '2024-03-15 15:00'),
        ('vh-2', 'org-a', 'uni-a1', 802, 'cli-velha', 'SALDO_IMPORTADO', 200, 200, '2025-01-10 15:00'),
        ('vh-3', 'org-a', 'uni-a1', 803, 'cli-ambas', 'SALDO_IMPORTADO', 90, 90, '2023-11-20 15:00'),
        ('vh-4', 'org-a', 'uni-a1', 804, 'cli-ambas', 'CONCLUIDA', 120, 120, '2026-09-01 15:00'),
        ('vh-5', 'org-a', 'uni-a1', 805, 'cli-ambas', 'CANCELADA', 999, 999, '2020-01-01 15:00');
    `)
  })

  it('a lista conta as trazidas à parte, sem mexer em compras e gastou, e sabe desde quando', async () => {
    const [velha] = await m.cliente.listarClientes(DONA, 'Rosa Antiga')
    expect(velha).toMatchObject({ compras: 0, gastou: 0, anteriores: 2, ultimaCompra: null })
    expect(velha!.primeiraCompra?.toISOString().slice(0, 10)).toBe('2024-03-15')

    const [ambas] = await m.cliente.listarClientes(DONA, 'Lia Ambas')
    // A cancelada não é compra nem "desde".
    expect(ambas).toMatchObject({ compras: 1, gastou: 120, anteriores: 1 })
    expect(ambas!.primeiraCompra?.toISOString().slice(0, 10)).toBe('2023-11-20')

    const [nova] = await m.cliente.listarClientes(DONA, 'Bia Novinha')
    expect(nova).toMatchObject({ compras: 0, anteriores: 0, primeiraCompra: null })
  })

  it('o balcão diz "cliente desde", e "primeira compra" só para quem é nova de verdade', () => {
    const p = { compra: 'compra', compras: 'compras', vendaFeminina: true }
    expect(historicoDoCliente({ compras: 0, gastou: 0, anteriores: 2, desde: '2024-03' }, p)).toBe(
      '2 compras no sistema anterior · cliente desde 03/2024',
    )
    expect(historicoDoCliente({ compras: 1, gastou: 120, anteriores: 1, desde: '2023-11' }, p)).toBe(
      `1 compra · ${brl(120)} · cliente desde 11/2023`,
    )
    expect(historicoDoCliente({ compras: 3, gastou: 80, anteriores: 0, desde: '2026-01' }, p)).toBe(`3 compras · ${brl(80)}`)
    expect(historicoDoCliente({ compras: 0, gastou: 0, anteriores: 0, desde: null }, p)).toBe('primeira compra aqui')
    // A venda guardada no aparelho antes do campo existir: como sempre foi.
    expect(historicoDoCliente({ compras: 0, gastou: 0 }, p)).toBe('primeira compra aqui')
    expect(historicoDoCliente({ compras: 0, gastou: 0 }, { compra: 'atendimento', compras: 'atendimentos', vendaFeminina: false })).toBe(
      'primeiro atendimento aqui',
    )
  })
})

// ─────────────────────────────────────────────────────────────
describe('3. o troco fica guardado para o papel', () => {
  const vender = (pagamentos: Parameters<typeof m.venda.registrarVenda>[1]['pagamentos'], troco: number) =>
    m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1',
      caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-cam', quantidade: 1 }],
      pagamentos,
      troco,
    })

  it('no dinheiro, a ficha da venda devolve o troco dado', async () => {
    const r = await vender([{ forma: 'DINHEIRO', valor: 50 }], 50)
    if (!r.ok) throw new Error(r.motivo)
    const v = await m.venda.acharVenda(DONA, r.vendaId)
    expect(v?.troco).toBe(50)
    // O pagamento continua sendo o que FICOU na gaveta.
    expect(Number(v?.pagamentos[0]?.valor)).toBe(50)
  })

  it('sem dinheiro não há troco, e troco de dedo errado não vai para o papel', async () => {
    const pix = await vender([{ forma: 'PIX', valor: 50, maquininha: 'Conta PJ' }], 30)
    if (!pix.ok) throw new Error(pix.motivo)
    expect((await m.venda.acharVenda(DONA, pix.vendaId))?.troco).toBe(0)

    const absurdo = await vender([{ forma: 'DINHEIRO', valor: 50 }], 99_999)
    if (!absurdo.ok) throw new Error(absurdo.motivo)
    expect((await m.venda.acharVenda(DONA, absurdo.vendaId))?.troco).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
describe('4. cancelar venda no crediário com parcela mexida', () => {
  const fiado = async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1',
      caixaId: 'cx-a1',
      clienteId: 'cli-1',
      itens: [{ variacaoId: 'var-cam', quantidade: 1 }],
      pagamentos: [{ forma: 'CREDIARIO', valor: 50, parcelas: 2 }],
    })
    if (!r.ok) throw new Error(r.motivo)
    const [p] = await linha<{ id: string }>(`select id from parcelas where venda_id = $1 and numero = 1`, [r.vendaId])
    return { vendaId: r.vendaId, parcelaId: p!.id }
  }
  const conferirIntacta = async (vendaId: string) => {
    const [v] = await linha<{ situacao: string }>(`select situacao::text from vendas where id = $1`, [vendaId])
    expect(v!.situacao).toBe('CONCLUIDA')
    const [n] = await linha<{ n: number }>(`select count(*)::int n from parcelas where venda_id = $1`, [vendaId])
    expect(n!.n).toBe(2)
  }

  it('parcela quitada por DESCONTO (pago zero) recusa com a frase — antes, o erro cru do banco', async () => {
    const { vendaId, parcelaId } = await fiado()
    await db.query(`update parcelas set desconto = 25, quitada_em = now() where id = $1`, [parcelaId])
    await db.query(
      `insert into recebimentos (id, org_id, parcela_id, forma, valor, desconto, quem) values ('rc-desc', 'org-a', $1, 'DINHEIRO', 0, 25, 'Dona')`,
      [parcelaId],
    )
    expect(await m.venda.cancelarVenda(DONA, vendaId, 'errou')).toEqual({ ok: false, motivo: 'crediario_recebido' })
    await conferirIntacta(vendaId)
  })

  it('parcela com multa cobrada também', async () => {
    const { vendaId, parcelaId } = await fiado()
    await db.query(`update parcelas set multa = 1 where id = $1`, [parcelaId])
    expect(await m.venda.cancelarVenda(DONA, vendaId, 'errou')).toEqual({ ok: false, motivo: 'crediario_recebido' })
    await conferirIntacta(vendaId)
  })

  it('qualquer recebimento pendurado na parcela (a baixa de fora) também', async () => {
    const { vendaId, parcelaId } = await fiado()
    await db.query(
      `insert into recebimentos (id, org_id, parcela_id, forma, valor, externo, quem) values ('rc-ext', 'org-a', $1, 'PIX', 10, true, 'Dona')`,
      [parcelaId],
    )
    expect(await m.venda.cancelarVenda(DONA, vendaId, 'errou')).toEqual({ ok: false, motivo: 'crediario_recebido' })
    await conferirIntacta(vendaId)
  })

  it('sem rastro nenhum, cancela e apaga as parcelas como sempre', async () => {
    const { vendaId } = await fiado()
    expect(await m.venda.cancelarVenda(DONA, vendaId, 'errou o cliente')).toMatchObject({ ok: true })
    const [n] = await linha<{ n: number }>(`select count(*)::int n from parcelas where venda_id = $1`, [vendaId])
    expect(n!.n).toBe(0)
  })

  it('a régua é uma só', () => {
    const limpa = { pago: 0, juros: 0, multa: 0, desconto: 0, _count: { recebimentos: 0 } }
    expect(m.venda.parcelaMexida(limpa)).toBe(false)
    expect(m.venda.parcelaMexida({ ...limpa, desconto: '0.01' })).toBe(true)
    expect(m.venda.parcelaMexida({ ...limpa, juros: 2 })).toBe(true)
    expect(m.venda.parcelaMexida({ ...limpa, _count: { recebimentos: 1 } })).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
describe('5. o fechamento confere cada maquininha', () => {
  beforeAll(async () => {
    // Um turno fechado só para isto: vendas por maquininha, uma cancelada (fora),
    // uma sem maquininha marcada, e o crediário recebido no mesmo turno.
    await db.exec(`
      insert into caixas (id, org_id, unidade_id, aberto, aberto_por, saldo_abertura) values
        ('cx-conf', 'org-a', 'uni-a1', false, 'Dona', 0);
      insert into vendas (id, org_id, unidade_id, caixa_id, numero, situacao, subtotal, total) values
        ('vc-1', 'org-a', 'uni-a1', 'cx-conf', 901, 'CONCLUIDA', 100, 100),
        ('vc-2', 'org-a', 'uni-a1', 'cx-conf', 902, 'CONCLUIDA', 80, 80),
        ('vc-3', 'org-a', 'uni-a1', 'cx-conf', 903, 'CANCELADA', 70, 70),
        ('vc-4', 'org-a', 'uni-a1', null, 904, 'CONCLUIDA', 100, 100);
      insert into pagamentos (id, org_id, venda_id, forma, valor, maquininha) values
        ('pc-1', 'org-a', 'vc-1', 'CREDITO', 60, 'Stone'),
        ('pc-2', 'org-a', 'vc-1', 'PIX', 40, 'Conta PJ'),
        ('pc-3', 'org-a', 'vc-2', 'DEBITO', 30, 'Stone'),
        ('pc-4', 'org-a', 'vc-2', 'DINHEIRO', 20, null),
        ('pc-5', 'org-a', 'vc-2', 'CREDITO', 30, null),
        ('pc-6', 'org-a', 'vc-3', 'CREDITO', 70, 'Stone'),
        ('pc-7', 'org-a', 'vc-4', 'CREDIARIO', 100, null);
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
        ('pa-conf', 'org-a', 'vc-4', 'cli-1', 'uni-a1', 1, 1, '2026-12-10', 100);
      insert into recebimentos (id, org_id, parcela_id, caixa_id, forma, valor, maquininha, quem) values
        ('rcc-1', 'org-a', 'pa-conf', 'cx-conf', 'CREDITO', 25, 'Stone', 'Dona'),
        ('rcc-2', 'org-a', 'pa-conf', 'cx-conf', 'DINHEIRO', 10, null, 'Dona');
    `)
  })

  it('vendas e crediário juntos por máquina, as com nome primeiro; dinheiro e cancelada fora', async () => {
    const c = await m.caixa.conferirCaixa(DONA, 'cx-conf')
    expect(c.maquininhas).toEqual([
      { maquininha: 'Conta PJ', total: 40, formas: [{ forma: 'PIX', vendas: 40, crediario: 0, total: 40 }] },
      {
        maquininha: 'Stone',
        total: 115,
        formas: [
          { forma: 'DEBITO', vendas: 30, crediario: 0, total: 30 },
          { forma: 'CREDITO', vendas: 60, crediario: 25, total: 85 },
        ],
      },
      { maquininha: null, total: 30, formas: [{ forma: 'CREDITO', vendas: 30, crediario: 0, total: 30 }] },
    ])
    // As listas separadas continuam lá (o papel mostra as duas).
    expect(c.porMaquininha).toContainEqual({ forma: 'CREDITO', maquininha: 'Stone', total: 60 })
    expect(c.recebidoPorForma).toContainEqual({ forma: 'CREDITO', maquininha: 'Stone', total: 25 })
  })

  it('loja sem maquininha nenhuma: um grupo só, sem nome', () => {
    const g = m.caixa.naMaquininha(
      [{ forma: 'PIX', maquininha: null, total: 10 }, { forma: 'CREDIARIO', maquininha: null, total: 99 }],
      [{ forma: 'TRANSFERENCIA', maquininha: null, total: 5 }],
    )
    expect(g).toEqual([
      {
        maquininha: null,
        total: 15,
        formas: [
          { forma: 'PIX', vendas: 10, crediario: 0, total: 10 },
          { forma: 'TRANSFERENCIA', vendas: 0, crediario: 5, total: 5 },
        ],
      },
    ])
  })
})

// ─────────────────────────────────────────────────────────────
describe('6. a taxa da maquininha no DRE conta o crediário recebido no cartão e no Pix', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into taxas_pagamento (id, org_id, forma, parcelas, percentual, atualizada_em) values
        ('tx-deb', 'org-a', 'DEBITO', 1, 2, now()),
        ('tx-pix', 'org-a', 'PIX', 1, 1, now());
      insert into vendas (id, org_id, unidade_id, numero, cliente_id, situacao, subtotal, total, criada_em) values
        ('vt-1', 'org-a', 'uni-a2', 1, 'cli-1', 'CONCLUIDA', 500, 500, '2026-01-10 15:00');
      insert into pagamentos (id, org_id, venda_id, forma, valor) values
        ('pt-pg', 'org-a', 'vt-1', 'CREDIARIO', 500);
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
        ('pt-1', 'org-a', 'vt-1', 'cli-1', 'uni-a2', 1, 1, '2026-02-10', 500);
      insert into recebimentos (id, org_id, parcela_id, forma, valor, taxa_pct, externo, quem, criado_em) values
        -- a taxa do dia do recebimento
        ('rt-1', 'org-a', 'pt-1', 'DEBITO', 100, 3, false, 'Dona', '2026-09-15 12:00'),
        -- recebimento de antes da coluna: a taxa de hoje (2%)
        ('rt-2', 'org-a', 'pt-1', 'DEBITO', 50, null, false, 'Dona', '2026-09-16 12:00'),
        -- baixa externa: o dinheiro não passou por aqui
        ('rt-3', 'org-a', 'pt-1', 'PIX', 200, 1, true, 'Dona', '2026-09-17 12:00'),
        -- dinheiro não tem maquininha
        ('rt-4', 'org-a', 'pt-1', 'DINHEIRO', 80, null, false, 'Dona', '2026-09-18 12:00'),
        -- fora do período
        ('rt-5', 'org-a', 'pt-1', 'PIX', 100, 1, false, 'Dona', '2020-01-01 12:00');
    `)
  })

  it('soma com a taxa gravada, cai na de hoje quando é nula, e deixa de fora a baixa externa e o dinheiro', async () => {
    // Setembro de 2026 em São Paulo.
    const de = new Date('2026-09-01T03:00:00Z')
    const ate = new Date('2026-10-01T02:59:59Z')
    const r = await m.banco.comoOrg('org-a', (tx) => m.taxas.taxasDoPeriodo(tx, ['uni-a2'], de, ate))
    expect(r.totalCent).toBe(400)
    expect(r.porForma).toEqual([{ forma: 'DEBITO', parcelado: false, valorCent: 15000, taxaCent: 400, percentual: 2.67 }])
  })
})
