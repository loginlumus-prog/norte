// Auditoria do balcão e do estoque. Cada `it` descreve o comportamento ATUAL
// que a auditoria aponta como problema — o teste PASSA quando o problema
// existe. Quando o código for corrigido, inverta a expectativa.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  venda: typeof import('../src/servidor/venda')
  devolucao: typeof import('../src/servidor/devolucao')
  estoque: typeof import('../src/servidor/estoque')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-a',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])
const BALCAO = sessao('usr-bal', 'Bia Balcao', [{ papel: 'BALCAO', unidadeId: 'uni-a1' }])

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, crediario_max_parcelas,
                    vende_sem_estoque, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,multiUnidade,encomenda,agenda}', 10, 12, false, now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona', 'dona@a.com', now()),
    ('usr-bal', 'org-a', 'Bia Balcao', 'bia@a.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-bal', 'org-a', 'usr-bal', 'uni-a1', 'BALCAO');
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, ativo, servico, atualizado_em) values
    ('p-blu', 'org-a', 'Blusa', 'UN', 100.00, 40.00, true, false, now()),
    ('p-uni', 'org-a', 'Peca unica', 'UN', 80.00, 30.00, true, false, now()),
    ('p-casq', 'org-a', 'Casquinha', 'UN', 2.00, 0.50, true, false, now()),
    ('p-agua', 'org-a', 'Agua', 'UN', 3.00, 1.00, true, false, now()),
    ('p-combo', 'org-a', 'Casquinha + Agua', 'UN', 4.50, null, true, false, now()),
    ('p-kit', 'org-a', 'Kit presente', 'UN', 30.00, 10.00, true, false, now()),
    ('p-esc', 'org-a', 'Escova', 'UN', 50.00, 5.00, true, false, now()),
    ('p-saia', 'org-a', 'Saia', 'UN', 100.00, 40.00, true, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-blu', 'org-a', 'p-blu', 'BLU-1', true),
    ('var-uni', 'org-a', 'p-uni', 'UNI-1', true),
    ('var-casq', 'org-a', 'p-casq', 'CASQ', true),
    ('var-agua', 'org-a', 'p-agua', 'AGUA', true),
    ('var-combo', 'org-a', 'p-combo', 'COMBO', true),
    ('var-kit', 'org-a', 'p-kit', 'KIT', true),
    ('var-esc', 'org-a', 'p-esc', 'ESC', true),
    ('var-saia', 'org-a', 'p-saia', 'SAIA', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-blu', 'org-a', 'var-blu', 'uni-a1', 100, now()),
    ('e-uni', 'org-a', 'var-uni', 'uni-a1', 1, now()),
    ('e-casq', 'org-a', 'var-casq', 'uni-a1', 0, now()),
    ('e-agua', 'org-a', 'var-agua', 'uni-a1', 10, now()),
    ('e-kit', 'org-a', 'var-kit', 'uni-a1', 10, now()),
    ('e-esc', 'org-a', 'var-esc', 'uni-a1', 10, now()),
    ('e-saia', 'org-a', 'var-saia', 'uni-a1', 10, now());
  insert into composicoes (id, org_id, variacao_id, componente_id, quantidade) values
    ('c1', 'org-a', 'var-combo', 'var-casq', 1),
    ('c2', 'org-a', 'var-combo', 'var-agua', 1);
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Dona', 100);
  insert into clientes (id, org_id, nome, atualizado_em) values ('cli-1', 'org-a', 'Cliente Um', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 2000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    venda: await import('../src/servidor/venda'),
    devolucao: await import('../src/servidor/devolucao'),
    estoque: await import('../src/servidor/estoque'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const um = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!
const saldo = async (variacaoId: string) =>
  Number((await um<{ quantidade: string }>(`select quantidade from estoque where variacao_id = $1 and unidade_id = 'uni-a1'`, [variacaoId])).quantidade)

describe('1. a marca "sem internet" vem do navegador e abre atalhos numa venda online', () => {
  it('com "vender sem estoque" DESLIGADO, a venda com offline vende 5 de uma peça que tem 1 (estoque -4)', async () => {
    const normal = await m.venda.registrarVenda(BALCAO, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-uni', quantidade: 5, precoUnit: 80 }],
      pagamentos: [{ forma: 'PIX', valor: 400 }],
    })
    expect(normal).toMatchObject({ ok: false, motivo: 'sem_estoque' })

    // O mesmo pedido, agora com a marca que qualquer POST pode pôr.
    const r = await m.venda.registrarVenda(BALCAO, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-uni', quantidade: 5, precoUnit: 80 }],
      pagamentos: [{ forma: 'PIX', valor: 400 }],
      offline: { quando: new Date() },
    })
    expect(r.ok).toBe(true)
    expect(await saldo('var-uni')).toBe(-4)
  })

  it('com a empresa pedindo PIN em toda venda, a venda com offline entra SEM PIN, no nome da conta aberta', async () => {
    await db.exec(`update orgs set pin_em_toda_venda = true where id = 'org-a'`)
    try {
      const semPin = await m.venda.registrarVenda(BALCAO, {
        unidadeId: 'uni-a1', caixaId: 'cx-a1',
        itens: [{ variacaoId: 'var-blu', quantidade: 1, precoUnit: 100 }],
        pagamentos: [{ forma: 'PIX', valor: 100 }],
      })
      expect(semPin).toMatchObject({ ok: false, motivo: 'assinatura_pedida' })

      const r = await m.venda.registrarVenda(BALCAO, {
        unidadeId: 'uni-a1', caixaId: 'cx-a1',
        itens: [{ variacaoId: 'var-blu', quantidade: 1, precoUnit: 100 }],
        pagamentos: [{ forma: 'PIX', valor: 100 }],
        offline: { quando: new Date() },
      })
      expect(r).toMatchObject({ ok: true, vendedor: 'Bia Balcao' })
    } finally {
      await db.exec(`update orgs set pin_em_toda_venda = false where id = 'org-a'`)
    }
  })
})

describe('2. a venda da fila (sem internet) que o preço mudou antes de subir nunca mais entra', () => {
  it('preço BAIXOU entre a venda e a subida: o pago (preço velho) não fecha com o total, recusada para sempre', async () => {
    // A venda aconteceu sem internet a R$ 100 (dinheiro na gaveta, peça na sacola).
    await db.exec(`update produtos set preco_vista = 90 where id = 'p-saia'`)
    try {
      const r = await m.venda.registrarVenda(BALCAO, {
        unidadeId: 'uni-a1', caixaId: 'cx-a1',
        itens: [{ variacaoId: 'var-saia', quantidade: 1, precoUnit: 100 }],
        pagamentos: [{ forma: 'PIX', valor: 100 }],
        chave: 'fila-saia-0001',
        offline: { quando: new Date(Date.now() - 60_000) },
      })
      expect(r).toMatchObject({ ok: false, motivo: 'pagamento_nao_fecha', total: 90, pago: 100 })
      expect(await saldo('var-saia')).toBe(10) // a peça saiu, o estoque não sabe
    } finally {
      await db.exec(`update produtos set preco_vista = 100 where id = 'p-saia'`)
    }
  })

  it('preço SUBIU acima do teto de desconto: o preço velho vira "desconto acima do teto" para quem não pode', async () => {
    await db.exec(`update produtos set preco_vista = 120 where id = 'p-saia'`)
    try {
      const r = await m.venda.registrarVenda(BALCAO, {
        unidadeId: 'uni-a1', caixaId: 'cx-a1',
        itens: [{ variacaoId: 'var-saia', quantidade: 1, precoUnit: 100 }],
        pagamentos: [{ forma: 'PIX', valor: 100 }],
        chave: 'fila-saia-0002',
        offline: { quando: new Date(Date.now() - 60_000) },
      })
      expect(r).toMatchObject({ ok: false, motivo: 'desconto_acima_do_teto' })
    } finally {
      await db.exec(`update produtos set preco_vista = 100 where id = 'p-saia'`)
    }
  })
})

describe('3. o cancelamento devolve o que a venda baixou, não o cadastro de agora', () => {
  it('CORRIGIDO: item que ganhou composição depois de vendido: o cancelamento devolve o próprio item', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-kit', quantidade: 2, precoUnit: 30 }],
      pagamentos: [{ forma: 'PIX', valor: 60 }],
    })
    if (!r.ok) throw new Error(JSON.stringify(r))
    expect(await saldo('var-kit')).toBe(8)

    // Depois da venda, alguém define que o Kit "leva" 1 escova.
    await db.exec(`insert into composicoes (id, org_id, variacao_id, componente_id, quantidade) values ('c-kit', 'org-a', 'var-kit', 'var-esc', 1)`)
    try {
      const c = await m.venda.cancelarVenda(DONA, r.vendaId, 'cliente desistiu')
      expect(c.ok).toBe(true)
      expect(await saldo('var-kit')).toBe(10) // as 2 do kit voltaram
      expect(await saldo('var-esc')).toBe(10) // e nenhuma escova "voltou"
    } finally {
      await db.exec(`delete from composicoes where id = 'c-kit'`)
    }
  })

  // Mantido: virar serviço com saldo agora é recusado na ficha (auditoria-estoque P2); por baixo do banco ainda dá.
  it('produto que virou serviço depois de vendido: o cancelamento não devolve as peças que a venda baixou', async () => {
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-esc', quantidade: 3, precoUnit: 50 }],
      pagamentos: [{ forma: 'PIX', valor: 150 }],
    })
    if (!r.ok) throw new Error(JSON.stringify(r))
    const depoisDaVenda = await saldo('var-esc')
    await db.exec(`update produtos set servico = true where id = 'p-esc'`)
    try {
      const c = await m.venda.cancelarVenda(DONA, r.vendaId, 'lancou errado')
      expect(c.ok).toBe(true)
      expect(await saldo('var-esc')).toBe(depoisDaVenda) // 3 peças sumidas
    } finally {
      await db.exec(`update produtos set servico = false where id = 'p-esc'`)
    }
  })
})

describe('4. "Vendido sem estoque — conferir" vê o item composto', () => {
  it('CORRIGIDO: composto vendido com componente zerado: a linha do composto fica marcada para conferir', async () => {
    await db.exec(`update orgs set vende_sem_estoque = true where id = 'org-a'`)
    try {
      const r = await m.venda.registrarVenda(DONA, {
        unidadeId: 'uni-a1', caixaId: 'cx-a1',
        itens: [{ variacaoId: 'var-combo', quantidade: 1, precoUnit: 4.5 }],
        pagamentos: [{ forma: 'PIX', valor: 4.5 }],
      })
      if (!r.ok) throw new Error(JSON.stringify(r))
      expect(r.semEstoque).toEqual(['Casquinha']) // a venda SABE que faltou
      expect(await saldo('var-casq')).toBe(-1)
      const marcadas = await um<{ n: number }>(
        `select count(*)::int as n from venda_itens where venda_id = $1 and saldo_na_venda is not null`,
        [r.vendaId],
      )
      expect(marcadas.n).toBe(1)
      const lista = await m.estoque.listarParaConferir(DONA, ['uni-a1'])
      expect(lista.some((x) => x.vendaId === r.vendaId)).toBe(true)
    } finally {
      await db.exec(`update orgs set vende_sem_estoque = false where id = 'org-a'`)
    }
  })
})

describe('5. devolução de pedido do catálogo com sinal: o desconto se espalha sobre as peças', () => {
  it('CORRIGIDO: 2 blusas de R$ 100 (sinal R$ 150 já pago), desconto de R$ 10 no balcão: pagou R$ 190, a devolução das duas vale R$ 190', async () => {
    await db.exec(`
      insert into encomendas (id, org_id, unidade_id, cliente_id, cliente_nome, descricao, valor, sinal, origem, para, quem, atualizada_em)
        values ('enc-cat', 'org-a', 'uni-a1', 'cli-1', 'Cliente Um', 'Pedido do catalogo', 200.00, 150.00, 'CATALOGO', now() + interval '1 day', 'Dona', now());
      insert into encomenda_itens (id, org_id, encomenda_id, variacao_id, descricao, quantidade, preco_unit, total)
        values ('ei-1', 'org-a', 'enc-cat', 'var-blu', 'Blusa', 2, 100.00, 200.00);
    `)
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1', clienteId: 'cli-1', encomendaId: 'enc-cat',
      itens: [{ variacaoId: 'var-blu', quantidade: 2, precoUnit: 100 }],
      desconto: 10,
      pagamentos: [{ forma: 'PIX', valor: 40 }],
    })
    if (!r.ok) throw new Error(JSON.stringify(r))
    const linha = await um<{ id: string }>(`select id from venda_itens where venda_id = $1 and variacao_id = 'var-blu'`, [r.vendaId])
    const d = await m.devolucao.devolver(DONA, {
      vendaId: r.vendaId, itens: [{ vendaItemId: linha.id, quantidade: 2 }], destino: 'VALE', motivo: 'não serviu',
    })
    if (!d.ok) throw new Error(JSON.stringify(d))
    // Recebido pela loja: 150 (sinal) + 40 (balcão) = 190. Volta: 190.
    expect(d.valor).toBe(190)
  })
})

describe('6. apagar turno "de teste" não leva a sangria de uma devolução de verdade', () => {
  it('CORRIGIDO: turno cuja única coisa foi devolver dinheiro de uma venda de ontem não se apaga', async () => {
    const caixa = await import('../src/servidor/caixa')
    const r = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', caixaId: 'cx-a1',
      itens: [{ variacaoId: 'var-blu', quantidade: 1, precoUnit: 100 }],
      pagamentos: [{ forma: 'DINHEIRO', valor: 100 }],
    })
    if (!r.ok) throw new Error(JSON.stringify(r))
    await caixa.fecharCaixa(DONA, 'cx-a1', 0)
    const novo = await caixa.abrirCaixa(DONA, 'uni-a1', 200)
    if (!novo.ok) throw new Error('não abriu')
    const linha = await um<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    const d = await m.devolucao.devolver(DONA, {
      vendaId: r.vendaId, itens: [{ vendaItemId: linha.id, quantidade: 1 }], destino: 'DINHEIRO', motivo: 'defeito',
    })
    expect(d).toMatchObject({ ok: true, valor: 100 })
    expect((await um<{ n: number }>(`select count(*)::int as n from caixa_movimentos where caixa_id = $1`, [novo.caixaId])).n).toBe(1)
    await caixa.fecharCaixa(DONA, novo.caixaId, 100) // a gaveta: 200 - 100 devolvidos

    await expect(caixa.apagarTurno(DONA, novo.caixaId, 'turno de teste')).rejects.toThrow(/é de verdade/)
    expect((await um<{ n: number }>(`select count(*)::int as n from caixa_movimentos where caixa_id = $1`, [novo.caixaId])).n).toBe(1)
  })
})
