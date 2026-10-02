// Auditoria de lógica (venda, cancelamento, devolução). Cada `it` descreve o
// comportamento ATUAL que a auditoria aponta como problema — o teste passa
// quando o problema existe. Quando o código for corrigido, inverta a
// expectativa.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { pagamentosParaEnviar, contar } from '../src/app/[empresa]/balcao/conta'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  venda: typeof import('../src/servidor/venda')
  devolucao: typeof import('../src/servidor/devolucao')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-a',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, crediario_max_parcelas,
                    vende_sem_estoque, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,multiUnidade,encomenda,agenda}', 10, 12, false, now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, now()),
    ('uni-a2', 'org-a', 'Loja Shopping', false, true, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-dona', 'org-a', 'Dona', 'dona@a.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-dona', 'org-a', 'usr-dona', null, 'DONO');
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, ativo, atualizado_em) values
    ('p-blu', 'org-a', 'Blusa', 'UN', 100.00, 40.00, true, now()),
    ('p-sai', 'org-a', 'Saia', 'UN', 50.00, 20.00, true, now()),
    ('p-uni', 'org-a', 'Peca unica', 'UN', 80.00, 30.00, true, now()),
    ('p-kg', 'org-a', 'Picanha', 'KG', 59.90, 40.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-blu', 'org-a', 'p-blu', 'BLU-1', true),
    ('var-sai', 'org-a', 'p-sai', 'SAI-1', true),
    ('var-uni', 'org-a', 'p-uni', 'UNI-1', true),
    ('var-kg', 'org-a', 'p-kg', 'KG-1', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-blu', 'uni-a1', 100, now()),
    ('e2', 'org-a', 'var-sai', 'uni-a1', 100, now()),
    ('e3', 'org-a', 'var-blu', 'uni-a2', 100, now()),
    ('e4', 'org-a', 'var-uni', 'uni-a1', 1, now()),
    ('e5', 'org-a', 'var-kg', 'uni-a1', 10, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Dona', 100),
    ('cx-a2', 'org-a', 'uni-a2', 'Dona', 100);
  insert into clientes (id, org_id, nome, atualizado_em) values ('cli-1', 'org-a', 'Cliente Um', now());
  insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, valor, sinal, para, quem, atualizada_em) values
    ('enc-1', 'org-a', 'uni-a1', 'Cliente Um', 'Bolo de aniversario', 200.00, 50.00, now() + interval '1 day', 'Dona', now());
  insert into colaboradores (id, org_id, unidade_id, nome, atende, atualizado_em) values
    ('col-1', 'org-a', 'uni-a1', 'Bia', true, now());
  insert into agendamentos (id, org_id, unidade_id, colaborador_id, cliente_nome, servico, inicio, fim, quem, atualizado_em) values
    ('ag-1', 'org-a', 'uni-a1', 'col-1', 'Cliente Um', 'Manicure', now(), now() + interval '1 hour', 'Dona', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 44000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    venda: await import('../src/servidor/venda'),
    devolucao: await import('../src/servidor/devolucao'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const um = async <T>(sql: string, p: unknown[] = []) => (await linhas<T>(sql, p))[0]!

describe('cancelar venda solta o que ela recebeu (corrigido)', () => {
  it('a encomenda recebida na venda volta a esperar depois do cancelamento, e dá para receber de novo', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1',
      caixaId: 'cx-a1',
      encomendaId: 'enc-1',
      itens: [],
      pagamentos: [{ forma: 'PIX', valor: 150 }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const c = await m.venda.cancelarVenda(DONA, r.vendaId, 'cobrado na forma errada')
    expect(c.ok).toBe(true)
    const e = await um<{ situacao: string }>(`select situacao::text from encomendas where id = 'enc-1'`)
    expect(e.situacao).toBe('ABERTA') // voltou para onde estava antes da venda
    const de_novo = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', encomendaId: 'enc-1', itens: [], pagamentos: [{ forma: 'DINHEIRO', valor: 150 }],
    })
    expect(de_novo.ok).toBe(true)
    const de_novo_e = await um<{ situacao: string }>(`select situacao::text from encomendas where id = 'enc-1'`)
    expect(de_novo_e.situacao).toBe('ENTREGUE')
  })

  it('o horário da agenda cobrado se solta da venda cancelada, e dá para cobrar de novo', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', agendamentoId: 'ag-1',
      itens: [{ variacaoId: null, quantidade: 1, avulso: { descricao: 'Manicure', precoUnit: 40 } }],
      pagamentos: [{ forma: 'PIX', valor: 40 }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((await m.venda.cancelarVenda(DONA, r.vendaId, 'lançou errado')).ok).toBe(true)
    const ag = await um<{ venda_id: string | null }>(`select venda_id from agendamentos where id = 'ag-1'`)
    expect(ag.venda_id).toBeNull()
    const de_novo = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', agendamentoId: 'ag-1',
      itens: [{ variacaoId: null, quantidade: 1, avulso: { descricao: 'Manicure', precoUnit: 40 } }],
      pagamentos: [{ forma: 'PIX', valor: 40 }],
    })
    expect(de_novo.ok).toBe(true)
    const ag2 = await um<{ venda_id: string | null }>(`select venda_id from agendamentos where id = 'ag-1'`)
    expect(ag2.venda_id).toBe(de_novo.ok ? de_novo.vendaId : 'x')
  })
})

describe('devolução', () => {
  it('CORRIGIDO: o acréscimo de UMA peça não volta junto com OUTRA — a saia volta pelo que custou', async () => {
    // Blusa 100 + Saia 50, acréscimo de R$ 30 (etiqueta velha da blusa). Total 180.
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', acrescimo: 30,
      itens: [{ variacaoId: 'var-blu', quantidade: 1 }, { variacaoId: 'var-sai', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 180 }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const saia = await um<{ id: string }>(`select id from venda_itens where venda_id = $1 and variacao_id = 'var-sai'`, [r.vendaId])
    const d = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: saia.id, quantidade: 1 }], destino: 'VALE', motivo: 'não serviu' })
    expect(d.ok).toBe(true)
    if (d.ok) expect(d.valor).toBe(50) // a saia custou R$ 50; o acréscimo (da blusa) fica com a loja
  })

  it('CORRIGIDO: a devolução feita na Shopping de uma venda da Centro sai da gaveta da Shopping e a peça volta para lá', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-blu', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 100 }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = await um<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    const estoque = async (u: string) => Number((await um<{ q: string }>(`select quantidade q from estoque where variacao_id = 'var-blu' and unidade_id = $1`, [u])).q)
    const antes = { a1: await estoque('uni-a1'), a2: await estoque('uni-a2') }
    const d = await m.devolucao.devolver(DONA, {
      vendaId: r.vendaId, itens: [{ vendaItemId: item.id, quantidade: 1 }], destino: 'DINHEIRO', motivo: 'cliente devolveu no shopping', unidadeId: 'uni-a2',
    })
    expect(d.ok).toBe(true)
    const s = await linhas<{ caixa_id: string }>(`select caixa_id from caixa_movimentos where (motivo = 'Devolução da venda ' || $1::text or motivo like 'Devolução da venda ' || $1::text || ' (%')`, [String(r.numero)])
    expect(s.map((x) => x.caixa_id)).toEqual(['cx-a2'])
    expect({ a1: await estoque('uni-a1'), a2: await estoque('uni-a2') }).toEqual({ a1: antes.a1, a2: antes.a2 + 1 })
    // O livro das duas lojas registra.
    const livro = await linhas<{ unidade_id: string }>(`select unidade_id from auditoria where acao = 'venda.devolveu' and alvo_id = $1 order by unidade_id`, [r.vendaId])
    expect(livro.map((x) => x.unidade_id)).toEqual(['uni-a1', 'uni-a2'])
  })

  it('CORRIGIDO: devolução em dinheiro feita numa loja sem caixa aberto é recusada', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-blu', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 100 }],
    })
    if (!r.ok) throw new Error(JSON.stringify(r))
    const item = await um<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    await db.query(`update caixas set aberto = false where id = 'cx-a2'`)
    try {
      const d = await m.devolucao.devolver(DONA, {
        vendaId: r.vendaId, itens: [{ vendaItemId: item.id, quantidade: 1 }], destino: 'DINHEIRO', motivo: 'quer o dinheiro', unidadeId: 'uni-a2',
      })
      expect(d).toEqual({ ok: false, motivo: 'caixa_fechado' })
    } finally {
      await db.query(`update caixas set aberto = true where id = 'cx-a2'`)
    }
  })

  it('CORRIGIDO: vale de troca não vira dinheiro — compra paga com vale, devolvida em DINHEIRO, volta como vale', async () => {
    const vale = await um<{ codigo: string }>(`
      insert into vales (id, org_id, codigo, unidade_id, valor, saldo, validade, quem)
      values ('vale-x', 'org-a', 'VT-ABCDEF', 'uni-a1', 100, 100, current_date + 30, 'Dona') returning codigo`)
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-blu', quantidade: 1 }],
      pagamentos: [{ forma: 'VALE', valor: 100, referencia: vale.codigo }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = await um<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    const d = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: item.id, quantidade: 1 }], destino: 'DINHEIRO', motivo: 'quer o dinheiro' })
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d).toMatchObject({ valor: 100, emVale: 100 })
    expect(d.vale).not.toBeNull()
    const s = await linhas(`select id from caixa_movimentos where (motivo = 'Devolução da venda ' || $1::text or motivo like 'Devolução da venda ' || $1::text || ' (%')`, [String(r.numero)])
    expect(s).toEqual([]) // nada saiu da gaveta
  })

  it('CORRIGIDO: compra metade vale, metade dinheiro: em dinheiro sai só o que entrou em dinheiro', async () => {
    await db.query(`insert into vales (id, org_id, codigo, unidade_id, valor, saldo, validade, quem)
      values ('vale-y', 'org-a', 'VT-GHJKMN', 'uni-a1', 100, 100, current_date + 30, 'Dona')`)
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-blu', quantidade: 1 }, { variacaoId: 'var-sai', quantidade: 1 }],
      pagamentos: [{ forma: 'VALE', valor: 100, referencia: 'VT-GHJKMN' }, { forma: 'DINHEIRO', valor: 50 }],
    })
    if (!r.ok) throw new Error(JSON.stringify(r))
    const its = await linhas<{ id: string; variacao_id: string }>(`select id, variacao_id from venda_itens where venda_id = $1`, [r.vendaId])
    const id = (v: string) => its.find((i) => i.variacao_id === v)!.id
    // A saia (50) em dinheiro: os 50 de dinheiro da compra voltam em dinheiro.
    const d1 = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: id('var-sai'), quantidade: 1 }], destino: 'DINHEIRO', motivo: 'não serviu' })
    expect(d1).toMatchObject({ ok: true, valor: 50, emVale: 0, vale: null })
    // A blusa (100) em dinheiro: o dinheiro já voltou todo — os 100 do vale voltam como vale.
    const d2 = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: id('var-blu'), quantidade: 1 }], destino: 'DINHEIRO', motivo: 'não serviu' })
    expect(d2).toMatchObject({ ok: true, valor: 100, emVale: 100 })
    const sangrias = await linhas<{ valor: string }>(`select valor from caixa_movimentos where (motivo = 'Devolução da venda ' || $1::text or motivo like 'Devolução da venda ' || $1::text || ' (%')`, [String(r.numero)])
    expect(sangrias.map((x) => Number(x.valor))).toEqual([50])
  })
})

describe('venda', () => {
  it('a mesma peça em duas linhas com estoque 1 é recusada limpa, como "sem estoque" (somada)', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-uni', quantidade: 1 }, { variacaoId: 'var-uni', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 160 }],
    })
    expect(r).toMatchObject({ ok: false, motivo: 'sem_estoque', faltando: [{ pedido: 2, tem: 1 }] })
  })

  it('crediário para quem tem parcela vencida além da regra, ou passa do limite, pede o PIN (quem tem o poder segue)', async () => {
    const BALCAO = sessao('usr-bal', 'Caixa', [{ papel: 'BALCAO', unidadeId: 'uni-a1' }])
    await db.exec(`
      insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-bal', 'org-a', 'Caixa', 'caixa@a.com', now()) on conflict do nothing;
      insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-bal', 'org-a', 'usr-bal', 'uni-a1', 'BALCAO') on conflict do nothing;
    `)
    const a = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', clienteId: 'cli-1',
      itens: [{ variacaoId: 'var-blu', quantidade: 5 }],
      pagamentos: [{ forma: 'CREDIARIO', valor: 500, parcelas: 5 }],
    })
    expect(a.ok).toBe(true)
    await db.exec(`update parcelas set vencimento = current_date - 90 where cliente_id = 'cli-1'`)
    const pedido = {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', clienteId: 'cli-1',
      itens: [{ variacaoId: 'var-blu', quantidade: 1 }],
      pagamentos: [{ forma: 'CREDIARIO' as const, valor: 100, parcelas: 2 }],
    }
    // Regra desligada (o padrão): passa.
    expect((await m.venda.registrarVenda(BALCAO, pedido)).ok).toBe(true)
    // Regra de 30 dias ligada: o balcão precisa do PIN; a dona segue direto.
    await db.exec(`update orgs set crediario_atraso_dias = 30 where id = 'org-a'`)
    expect(await m.venda.registrarVenda(BALCAO, pedido)).toMatchObject({ ok: false, motivo: 'crediario_pede_autorizacao' })
    expect((await m.venda.registrarVenda(DONA, pedido)).ok).toBe(true)
    await db.exec(`update orgs set crediario_atraso_dias = null where id = 'org-a'`)
    // O limite da cliente: já deve 700; mais 100 passa de 750.
    await db.exec(`update clientes set limite_credito = 750 where id = 'cli-1'`)
    const r = await m.venda.registrarVenda(BALCAO, pedido)
    expect(r).toMatchObject({ ok: false, motivo: 'crediario_pede_autorizacao' })
    if (!r.ok && r.motivo === 'crediario_pede_autorizacao') expect(r.recado).toMatch(/limite de R\$\s?750,00/)
    await db.exec(`update clientes set limite_credito = null where id = 'cli-1'`)
  })

  it('crediário na ficha desativada (ou juntada em outra) é recusado', async () => {
    await db.exec(`insert into clientes (id, org_id, nome, ativo, atualizado_em) values ('cli-velha', 'org-a', 'Ficha velha', false, now())`)
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', clienteId: 'cli-velha',
      itens: [{ variacaoId: 'var-blu', quantidade: 1 }],
      pagamentos: [{ forma: 'CREDIARIO', valor: 100, parcelas: 1 }],
    })
    expect(r).toMatchObject({ ok: false, motivo: 'crediario_recusado' })
  })
})

describe('quilo com 4 casas', () => {
  it('0,3475 kg vira 0,348 ANTES da conta: preço × quantidade gravada = total', async () => {
    const velho = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-kg', quantidade: 0.3475 }],
      pagamentos: [{ forma: 'PIX', valor: 20.82 }],
    })
    expect(velho).toMatchObject({ ok: false, motivo: 'pagamento_nao_fecha', total: 20.85 })
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-kg', quantidade: 0.3475 }],
      pagamentos: [{ forma: 'PIX', valor: 20.85 }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const i = await um<{ quantidade: string; total: string }>(`select quantidade::text, total::text from venda_itens where venda_id = $1`, [r.vendaId])
    expect(i.quantidade).toBe('0.348')
    expect(i.total).toBe('20.85') // 0,348 × 59,90 = 20,8452
  })
})

describe('balcão: troco maior que o dinheiro entregue', () => {
  it('Pix 100 + Dinheiro 10 numa venda de 80: a tela trava, sem troco, com o motivo', () => {
    const c = contar([{ preco: 80, quantidade: 1 }], [{ forma: 'PIX', valor: 100 }, { forma: 'DINHEIRO', valor: 10 }], 0, 0)
    expect(c.sobrouSemDinheiro).toBe(true) // a tela trava
    expect(c.trocoAlemDoDinheiro).toBe(true)
    expect(c.trocoCent).toBe(0)
    const enviados = pagamentosParaEnviar([{ forma: 'PIX', valor: 100 }, { forma: 'DINHEIRO', valor: 10 }], c.trocoCent)
    expect(enviados[1]!.valor).toBe(10)
    // Troco que cabe no dinheiro continua normal: Pix 50 + Dinheiro 50 em 80.
    const ok = contar([{ preco: 80, quantidade: 1 }], [{ forma: 'PIX', valor: 50 }, { forma: 'DINHEIRO', valor: 50 }], 0, 0)
    expect([ok.sobrouSemDinheiro, ok.trocoCent]).toEqual([false, 2000])
  })

  it('o pagamento negativo que chegar ao servidor é recusado com a frase do troco, não "falta R$ 0,00"', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-sai', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 100 }, { forma: 'DINHEIRO', valor: -50 }],
    })
    expect(r).toMatchObject({ ok: false, motivo: 'pagamento_nao_fecha' })
    if (!r.ok && r.motivo === 'pagamento_nao_fecha') expect(r.recado).toMatch(/troco/)
  })
})
