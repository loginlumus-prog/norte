// AUDITORIA (estoque — serviços da tela) — prova de defeitos e confere os
// fluxos que estão certos. Banco de verdade (PGlite com RLS), sessão de dona.
//
// Os `it` que eram BUG foram corrigidos (02/10/2026) e agora conferem o
// comportamento certo: custo médio, bonificação que não zera custo, nota
// repetida recusada, conta sem custo avisada, medida que não muda por cima
// do saldo.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  entrada: typeof import('../src/servidor/entrada')
  estoque: typeof import('../src/servidor/estoque')
  produto: typeof import('../src/servidor/produto')
  compras: typeof import('../src/servidor/compras')
  venda: typeof import('../src/servidor/venda')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-e', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
// A vendedora que dá entrada porque a empresa deixou (EXTRAS_DO_BALCAO).
const VENDEDORA: Sessao = {
  orgId: 'org-e', usuarioId: 'usr-vend', nome: 'Vendedora',
  acessos: [{ papel: 'BALCAO', unidadeId: 'uni-1', expiraEm: null }],
  balcaoAmpliado: true,
}
const round4 = (v: number) => Math.round(v * 10_000) / 10_000

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, atualizada_em, configurada_em) values
    ('org-e', 'Loja E', 'loja-e', 'REDE', 'ATIVA', '{multiUnidade}', 10, now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-1', 'org-e', 'Centro', now()),
    ('uni-2', 'org-e', 'Bairro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-e', 'Dona', 'd@e.com', now()),
    ('usr-vend', 'org-e', 'Vendedora', 'v@e.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-dona', 'org-e', 'usr-dona', null, 'DONO');
  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values ('cat-merc', 'org-e', 'Compra de mercadoria', 'DESPESA', 'MERCADORIA');
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-1', 'org-e', 'uni-1', 'Dona', 0);

  insert into produtos (id, org_id, nome, medida, preco_vista, custo, atualizado_em) values
    ('p-cam', 'org-e', 'Camiseta', 'UN', 50.00, 10.00, now()),
    ('p-grade', 'org-e', 'Calça', 'UN', 120.00, null, now()),
    ('p-queijo', 'org-e', 'Queijo minas', 'KG', 45.00, 20.00, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-cam', 'org-e', 'p-cam', 'CAM1', true),
    ('v-p', 'org-e', 'p-grade', 'CAL-P', false),
    ('v-gg', 'org-e', 'p-grade', 'CAL-GG', false),
    ('v-queijo', 'org-e', 'p-queijo', 'QJ1', true);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    entrada: await import('../src/servidor/entrada'),
    estoque: await import('../src/servidor/estoque'),
    produto: await import('../src/servidor/produto'),
    compras: await import('../src/servidor/compras'),
    venda: await import('../src/servidor/venda'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const uma = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!
const num = async (sql: string, p: unknown[] = []) => Number(Object.values(await uma<Record<string, unknown>>(sql, p))[0])
const saldo = (v: string, u: string) => num(`select coalesce((select quantidade from estoque where variacao_id = $1 and unidade_id = $2), 0) q`, [v, u])
const custo = (p: string) => num(`select coalesce(custo, -1) c from produtos where id = $1`, [p])

describe('AUDITORIA — custo na entrada', () => {
  it('corrigido: entrada com custo 0 (bonificação/brinde) NÃO mexe no custo — a venda seguinte grava o CMV de verdade', async () => {
    await m.entrada.registrarEntrada(DONA, { unidadeId: 'uni-1', itens: [{ variacaoId: 'v-cam', quantidade: 100, custoUnit: 10 }] })
    expect(await custo('p-cam')).toBe(10)
    const r = await m.entrada.registrarEntrada(DONA, { unidadeId: 'uni-1', fornecedor: 'Brinde', itens: [{ variacaoId: 'v-cam', quantidade: 2, custoUnit: 0 }] })
    expect(r.ok).toBe(true)
    expect(await custo('p-cam')).toBe(10)

    const v = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-1', caixaId: 'cx-1',
      itens: [{ variacaoId: 'v-cam', quantidade: 1 }],
      pagamentos: [{ forma: 'DINHEIRO', valor: 50 }],
    })
    expect(v.ok).toBe(true)
    const cmv = await num(`select i.custo_unit c from venda_itens i where i.variacao_id = 'v-cam' order by i.id desc limit 1`)
    expect(cmv).toBe(10) // a peça custou R$ 10, e é isso que a margem da venda vê
  })

  it('corrigido: o custo é a MÉDIA ponderada — 101 peças a R$ 10 + 10 a R$ 15 custam R$ 10,45, não R$ 15', async () => {
    await db.exec(`update produtos set custo = 10 where id = 'p-cam'`)
    const antes = await saldo('v-cam', 'uni-1')
    await m.entrada.registrarEntrada(DONA, { unidadeId: 'uni-1', itens: [{ variacaoId: 'v-cam', quantidade: 10, custoUnit: 15 }] })
    const media = (antes * 10 + 10 * 15) / (antes + 10)
    expect(await custo('p-cam')).toBe(round4(media))
    expect(media).toBeCloseTo(10.45, 2)
  })

  it('corrigido: dois tamanhos com custos diferentes na mesma nota — cada um guarda o seu, e o produto fica com a média', async () => {
    await m.entrada.registrarEntrada(DONA, {
      unidadeId: 'uni-1',
      itens: [
        { variacaoId: 'v-p', quantidade: 10, custoUnit: 40 },
        { variacaoId: 'v-gg', quantidade: 10, custoUnit: 55 },
      ],
    })
    expect(await custo('p-grade')).toBe(47.5)
    expect(await num(`select custo c from variacoes where id = 'v-p'`)).toBe(40)
    expect(await num(`select custo c from variacoes where id = 'v-gg'`)).toBe(55)
  })

  it('corrigido: a mesma nota lançada duas vezes é recusada na segunda — e passa se a pessoa confirma que é outra entrega', async () => {
    const nota = {
      unidadeId: 'uni-2', fornecedor: 'Laticínio X', documento: 'NF 12345',
      itens: [{ variacaoId: 'v-queijo', quantidade: 5.5, custoUnit: 20 }],
      conta: { categoriaId: 'cat-merc', vencimento: new Date('2026-11-01T00:00:00Z'), jaPago: false },
    }
    const a = await m.entrada.registrarEntrada(DONA, nota)
    const b = await m.entrada.registrarEntrada(DONA, { ...nota, documento: ' nf 12345 ', fornecedor: 'laticínio x' })
    expect(a.ok).toBe(true)
    expect(b).toMatchObject({ ok: false, documentoRepetido: true })
    expect(await saldo('v-queijo', 'uni-2')).toBe(5.5)
    expect(await num(`select count(*) n from lancamentos where documento = 'NF 12345'`)).toBe(1)

    // Outra entrega com o mesmo número: a pessoa confirma.
    const c = await m.entrada.registrarEntrada(DONA, { ...nota, repetirDocumento: true })
    expect(c.ok).toBe(true)
    expect(await saldo('v-queijo', 'uni-2')).toBe(11)
    expect(await num(`select sum(valor) s from lancamentos where documento = 'NF 12345'`)).toBe(220)
  })

  it('a mesma CHAVE (clique duplo, reenvio) não dá entrada duas vezes', async () => {
    const e = { unidadeId: 'uni-1', chave: 'tela-entrada-0001', itens: [{ variacaoId: 'v-cam', quantidade: 3 }] }
    const antes = await saldo('v-cam', 'uni-1')
    const a = await m.entrada.registrarEntrada(DONA, e)
    const b = await m.entrada.registrarEntrada(DONA, e)
    expect(a).toMatchObject({ ok: true, itens: 1 })
    expect(b).toMatchObject({ ok: true, repetido: true, itens: 1 })
    expect(await saldo('v-cam', 'uni-1')).toBe(antes + 3)
  })

  it('quantidade absurda (zeros a mais) é recusada', async () => {
    const r = await m.entrada.registrarEntrada(DONA, { unidadeId: 'uni-1', itens: [{ variacaoId: 'v-cam', quantidade: 5_000_000 }] })
    expect(r.ok).toBe(false)
  })

  it('a vendedora que dá entrada porque a empresa deixou assina com o PIN — sem ele, nada entra', async () => {
    const antes = await saldo('v-cam', 'uni-1')
    const r = await m.entrada.registrarEntrada(VENDEDORA, { unidadeId: 'uni-1', itens: [{ variacaoId: 'v-cam', quantidade: 1 }] })
    expect(r).toMatchObject({ ok: false, precisaPin: true })
    expect(await saldo('v-cam', 'uni-1')).toBe(antes)
  })

  it('corrigido: pediu a conta a pagar, mas sem custo nos itens — o resultado diz que a conta não nasceu', async () => {
    const r = await m.entrada.registrarEntrada(DONA, {
      unidadeId: 'uni-2', fornecedor: 'Sem preço', documento: 'NF 999',
      itens: [{ variacaoId: 'v-queijo', quantidade: 1 }],
      conta: { categoriaId: 'cat-merc', vencimento: new Date('2026-11-01T00:00:00Z'), jaPago: false },
    })
    expect(r).toMatchObject({ ok: true, contaLancada: false })
    expect(r.ok && r.naoFeito.join(' ')).toMatch(/conta a pagar/)
  })
})

describe('AUDITORIA — cadastro mexendo no que já está no estoque', () => {
  it('corrigido: trocar a medida de KG para G com saldo na prateleira é recusado — 12 kg não viram 12 g', async () => {
    const antes = await saldo('v-queijo', 'uni-2')
    expect(antes).toBe(12) // 5,5 + 5,5 + 1
    const r = await m.produto.editarProduto(DONA, 'p-queijo', { medida: 'G' })
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.motivo).toMatch(/medida/)
    expect(await num(`select count(*) n from produtos where id = 'p-queijo' and medida = 'KG'`)).toBe(1)
  })
})

describe('AUDITORIA — transferência e contagem (fluxos conferidos)', () => {
  it('correto: transferir mais do que tem é recusado e nada se move; a que passa grava as duas pernas', async () => {
    const r = await m.estoque.transferir(DONA, { variacaoId: 'v-queijo', deUnidadeId: 'uni-2', paraUnidadeId: 'uni-1', quantidade: 999 })
    expect(r).toMatchObject({ ok: false, motivo: 'sem_saldo' })
    expect(await saldo('v-queijo', 'uni-1')).toBe(0)

    const ok = await m.estoque.transferir(DONA, { variacaoId: 'v-queijo', deUnidadeId: 'uni-2', paraUnidadeId: 'uni-1', quantidade: 2.25 })
    expect(ok).toMatchObject({ ok: true, saldoOrigem: 9.75, saldoDestino: 2.25 })
    const pernas = await num(`select count(distinct transferencia_id) n from movimentos_estoque where transferencia_id is not null`)
    expect(pernas).toBe(1)
    expect(await m.estoque.conferirSaldos(DONA)).toEqual([])
  })

  it('correto: a contagem recusa quando o saldo mudou no meio, e grava o delta certo quando não mudou', async () => {
    const mudou = await m.estoque.corrigirPeloContado(DONA, { variacaoId: 'v-queijo', unidadeId: 'uni-1', contado: 2, motivo: 'contagem', saldoVisto: 3 })
    expect(mudou).toMatchObject({ ok: false, motivo: 'mudou', saldo: 2.25 })
    const ok = await m.estoque.corrigirPeloContado(DONA, { variacaoId: 'v-queijo', unidadeId: 'uni-1', contado: 2.1, motivo: 'contagem', saldoVisto: 2.25 })
    expect(ok).toMatchObject({ ok: true, saldo: 2.1, antes: 2.25 })
    expect(await m.estoque.conferirSaldos(DONA)).toEqual([])
  })
})

describe('AUDITORIA — pedido de compra (fluxos conferidos)', () => {
  it('correto: parcial, clique duplo com a mesma chave, e receber a mais é recusado', async () => {
    const p = await m.compras.criarPedido(DONA, { unidadeId: 'uni-1', itens: [{ variacaoId: 'v-cam', quantidade: 10, custoUnit: 12 }] })
    if (!p.ok) throw new Error(p.erro)
    const ped = await m.compras.acharPedido(DONA, p.id)
    const itemId = ped!.itensLista[0]!.id
    const antes = await saldo('v-cam', 'uni-1')

    const r1 = await m.compras.receberPedido(DONA, p.id, { chave: 'chave-0001-aaaa', itens: [{ itemId, quantidade: 4 }] })
    const r1b = await m.compras.receberPedido(DONA, p.id, { chave: 'chave-0001-aaaa', itens: [{ itemId, quantidade: 4 }] })
    expect(r1).toMatchObject({ ok: true, repetido: false, situacao: 'PARCIAL' })
    expect(r1b).toMatchObject({ ok: true, repetido: true })
    expect(await saldo('v-cam', 'uni-1')).toBe(antes + 4)

    const demais = await m.compras.receberPedido(DONA, p.id, { chave: 'chave-0002-bbbb', itens: [{ itemId, quantidade: 7 }] })
    expect(demais.ok).toBe(false)
    const r2 = await m.compras.receberPedido(DONA, p.id, { chave: 'chave-0003-cccc', itens: [{ itemId, quantidade: 6 }] })
    expect(r2).toMatchObject({ ok: true, situacao: 'RECEBIDO' })
    expect(await saldo('v-cam', 'uni-1')).toBe(antes + 10)
    // O recebimento entra no custo médio, como a entrada da tela: as peças
    // que já estavam (a ~R$ 10,45) pesam junto com as 10 a R$ 12.
    const c = await custo('p-cam')
    expect(c).toBeGreaterThan(10.45)
    expect(c).toBeLessThan(12)
  })
})
