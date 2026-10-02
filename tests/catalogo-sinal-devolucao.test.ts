// O pedido do catálogo pago todo no sinal, do balcão ao DRE e à devolução.
//
// A venda que recebe o pedido leva os produtos (que baixam o estoque) e uma
// linha NEGATIVA de acerto: "menos o sinal já pago". Pago tudo no sinal, a
// venda fecha em R$ 0. O sinal entrou no financeiro quando foi recebido
// (lançamento de receita, ver encomenda.ts) — e a venda a zero não o conta de
// novo. A linha de acerto não é peça: não volta. Os produtos voltam.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  cat: typeof import('../src/servidor/catalogo')
  enc: typeof import('../src/servidor/encomenda')
  venda: typeof import('../src/servidor/venda')
  dev: typeof import('../src/servidor/devolucao')
  fin: typeof import('../src/servidor/financeiro')
  rec: typeof import('../src/servidor/recorrentes')
  cred: typeof import('../src/servidor/crediario')
  banco: typeof import('../src/servidor/banco')
}

const DONO: Sessao = { orgId: 'org-s', usuarioId: 'usr-dono', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-s', 'Doceria S', 'doceria-s', 'BALCAO', 'ATIVA', '{encomenda}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-s', 'org-s', 'Centro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-dono', 'org-s', 'Dona', 'd@s.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-dono', 'org-s', 'usr-dono', null, 'DONO');
  insert into produtos (id, org_id, nome, medida, preco_vista, ativo, uso_interno, atualizado_em) values
    ('p-bolo', 'org-s', 'Bolo gelado', 'UN', 10.00, true, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('v-bolo', 'org-s', 'p-bolo', 'BOLO', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-bolo', 'org-s', 'v-bolo', 'uni-s', 10, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-s', 'org-s', 'uni-s', 'Dona', 0);
  -- A segunda loja: devolução em outra loja, recorrentes e crediário por loja.
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-b', 'org-s', 'Bairro', now());
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-bolo-b', 'org-s', 'v-bolo', 'uni-b', 0, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-b', 'org-s', 'uni-b', 'Dona', 0);
  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values ('cat-alu', 'org-s', 'Aluguel', 'DESPESA', 'OCUPACAO');
  insert into recorrentes (id, org_id, categoria_id, unidade_id, tipo, descricao, valor, dia_vencimento) values
    ('rec-emp', 'org-s', 'cat-alu', null,    'DESPESA', 'Escritório', 900, 5),
    ('rec-b',   'org-s', 'cat-alu', 'uni-b', 'DESPESA', 'Loja do bairro', 500, 5);
  insert into clientes (id, org_id, nome, atualizado_em) values ('cli-x', 'org-s', 'Cliente X', now());
  insert into vendas (id, org_id, unidade_id, numero, subtotal, total, situacao, cliente_id) values
    ('vd-fiado-b', 'org-s', 'uni-b', 900, 50, 50, 'CONCLUIDA', 'cli-x');
  insert into parcelas (id, org_id, unidade_id, venda_id, cliente_id, numero, de, valor, vencimento) values
    ('par-b', 'org-s', 'uni-b', 'vd-fiado-b', 'cli-x', 1, 1, 50, '2026-01-10');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.SEGREDO_SESSAO ??= 'x'.repeat(40)
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    cat: await import('../src/servidor/catalogo'),
    enc: await import('../src/servidor/encomenda'),
    venda: await import('../src/servidor/venda'),
    dev: await import('../src/servidor/devolucao'),
    fin: await import('../src/servidor/financeiro'),
    rec: await import('../src/servidor/recorrentes'),
    cred: await import('../src/servidor/crediario'),
    banco: await import('../src/servidor/banco'),
  }
  const r = await m.cat.salvarCatalogo(DONO, 'uni-s', {
    ativo: true, endereco: 'centro', whatsapp: '(71) 99999-0000', recado: null, retirada: true, entrega: true,
    taxaEntrega: 5, pedidoMinimo: null, chavePix: 'pix@doceria.com', mostrarEsgotado: false,
  })
  expect(r.ok).toBe(true)
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const FIN_B: Sessao = { orgId: 'org-s', usuarioId: 'usr-dono', nome: 'Fin', acessos: [{ papel: 'FINANCEIRO', unidadeId: 'uni-b', expiraEm: null }] }
const BALCAO_S: Sessao = { orgId: 'org-s', usuarioId: 'usr-dono', nome: 'Balcão', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-s', expiraEm: null }] }

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const saldo = async () => Number((await linhas<{ q: string }>(`select quantidade q from estoque where id = 'e-bolo'`))[0]!.q)

describe('pedido do catálogo pago todo no sinal', () => {
  let vendaId = ''

  it('a venda fecha em R$ 0, o estoque sai, e o DRE conta o sinal uma vez só', async () => {
    const p = await m.cat.fazerPedidoPeloCatalogo(
      'doceria-s', 'centro',
      { nome: 'Cliente Teste', telefone: '71980001234', entrega: false, forma: 'PIX', itens: [{ variacaoId: 'v-bolo', quantidade: 2 }] } as never,
      '10.9.9.1', 'https://norte.test',
    )
    expect(p.ok).toBe(true)
    const id = p.encomendaId!
    const [e] = await linhas<{ para: Date; descricao: string; cliente_nome: string; valor: string; entrega: boolean; endereco: string | null }>(
      `select para, descricao, cliente_nome, valor, entrega, endereco from encomendas where id = $1`, [id],
    )
    const ed = await m.enc.editarEncomenda(DONO, id, {
      clienteNome: e!.cliente_nome, descricao: e!.descricao, valor: Number(e!.valor), sinal: 20, sinalForma: 'PIX',
      dia: m.enc.diaEmSP(new Date(e!.para)), hora: m.enc.horaEmSP(new Date(e!.para)), entrega: e!.entrega, endereco: e!.endereco,
    })
    expect(ed.ok).toBe(true)

    const antes = await saldo()
    const v = await m.venda.registrarVenda(DONO, {
      unidadeId: 'uni-s', caixaId: 'cx-s', encomendaId: id, itens: [{ variacaoId: 'v-bolo', quantidade: 2 }], pagamentos: [],
    })
    expect(v).toMatchObject({ ok: true, total: 0 })
    vendaId = (v as unknown as { vendaId: string }).vendaId
    expect(await saldo()).toBe(antes - 2)

    // A venda: os bolos (+R$ 20) e o acerto do sinal (−R$ 20).
    const itens = await linhas<{ total: string }>(`select total from venda_itens where venda_id = $1 order by total`, [vendaId])
    expect(itens.map((i) => Number(i.total))).toEqual([-20, 20])

    // O DRE do período: R$ 20 do sinal (lançamento de receita), R$ 0 da venda.
    const agora = Date.now()
    const dre = await m.fin.montarDRE(DONO, ['uni-s'], new Date(agora - 864e5), new Date(agora + 864e5))
    expect(dre.resultado).toBe(20)
  })

  it('a linha do sinal não volta; os bolos voltam (em vale: a venda não recebeu dinheiro)', async () => {
    const itens = await linhas<{ id: string; total: string }>(`select id, total from venda_itens where venda_id = $1`, [vendaId])
    const acerto = itens.find((i) => Number(i.total) < 0)!
    const bolos = itens.find((i) => Number(i.total) > 0)!

    const r1 = await m.dev.devolver(DONO, { vendaId, itens: [{ vendaItemId: acerto.id, quantidade: 1 }], destino: 'VALE', motivo: 'teste do acerto' })
    expect(r1).toEqual({ ok: false, motivo: 'item_ajuste' })
    // Junto com os bolos também não: a recusa é do pedido inteiro.
    const r2 = await m.dev.devolver(DONO, {
      vendaId, itens: [{ vendaItemId: bolos.id, quantidade: 1 }, { vendaItemId: acerto.id, quantidade: 1 }], destino: 'VALE', motivo: 'teste do acerto',
    })
    expect(r2).toEqual({ ok: false, motivo: 'item_ajuste' })

    const antes = await saldo()
    // Pedido em dinheiro: a venda fechou em R$ 0 (o dinheiro entrou como
    // sinal), então nada sai da gaveta — o valor vira vale, e `emVale` diz.
    const r3 = await m.dev.devolver(DONO, { vendaId, itens: [{ vendaItemId: bolos.id, quantidade: 1 }], destino: 'DINHEIRO', motivo: 'derreteu' })
    expect(r3).toMatchObject({ ok: true, valor: 10, emVale: 10 })
    expect(r3.ok && r3.vale).toBeTruthy()
    expect(await saldo()).toBe(antes + 1)
  })
})

describe('devolução em outra loja', () => {
  it('a peça volta ao estoque da loja onde a devolução acontece, e o vale é dela', async () => {
    const v = await m.venda.registrarVenda(DONO, {
      unidadeId: 'uni-s', caixaId: 'cx-s', itens: [{ variacaoId: 'v-bolo', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 10 }],
    })
    expect(v.ok).toBe(true)
    const vendaId = (v as unknown as { vendaId: string }).vendaId
    const [item] = await linhas<{ id: string }>(`select id from venda_itens where venda_id = $1`, [vendaId])
    const r = await m.dev.devolver(DONO, { vendaId, itens: [{ vendaItemId: item!.id, quantidade: 1 }], destino: 'VALE', motivo: 'trocou de ideia', unidadeId: 'uni-b' })
    expect(r).toMatchObject({ ok: true, valor: 10, emVale: 10 })
    const [b] = await linhas<{ q: string }>(`select quantidade q from estoque where id = 'e-bolo-b'`)
    expect(Number(b!.q)).toBe(1)
    const [vale] = await linhas<{ unidade_id: string }>(`select unidade_id from vales where id = $1`, [r.ok ? r.vale!.id : ''])
    expect(vale!.unidade_id).toBe('uni-b')
  })
})

describe('recorrentes da empresa (sem loja)', () => {
  it('o financeiro preso a uma loja não vê a conta da empresa; o dono, olhando todas, vê', async () => {
    const daLoja = await m.rec.listarRecorrentes(FIN_B, ['uni-b'])
    expect(daLoja.map((r) => r.id)).toEqual(['rec-b'])
    const todas = await m.rec.listarRecorrentes(DONO, ['uni-s', 'uni-b'])
    expect(todas.map((r) => r.id).sort()).toEqual(['rec-b', 'rec-emp'])
    // O dono olhando UMA loja: a conta da empresa não é dela.
    const umaLoja = await m.rec.listarRecorrentes(DONO, ['uni-b'])
    expect(umaLoja.map((r) => r.id)).toEqual(['rec-b'])
  })
})

describe('crediário: a situação por loja e a regra do atraso', () => {
  it('a balconista do Centro não vê a dívida que a cliente tem no Bairro', async () => {
    const semFiltro = await m.banco.comoOrg('org-s', (d) => m.cred.situacaoDosClientes(d, ['cli-x']))
    expect(semFiltro.get('cli-x')?.devendo).toBe(50)
    const doCentro = await m.banco.comoOrg('org-s', (d) => m.cred.situacaoDosClientes(d, ['cli-x'], BALCAO_S))
    expect(doCentro.get('cli-x')).toBeUndefined()
  })

  it('"parcela atrasada há mais de N dias": grava, lê, desliga com null e não apaga quando não vem', async () => {
    expect((await m.cred.configCrediario(DONO)).atrasoDias).toBeNull()
    await m.cred.salvarConfigCrediario(DONO, { jurosMes: 0, maxParcelas: 3, diasEntre: 30, atrasoDias: 15 })
    expect((await m.cred.configCrediario(DONO)).atrasoDias).toBe(15)
    // A tela do Crediário (RegraDoAtraso) não manda o campo: fica como estava.
    await m.cred.salvarConfigCrediario(DONO, { jurosMes: 1, maxParcelas: 3, diasEntre: 30, multaPct: 2 })
    expect((await m.cred.configCrediario(DONO)).atrasoDias).toBe(15)
    await m.cred.salvarConfigCrediario(DONO, { jurosMes: 1, maxParcelas: 3, diasEntre: 30, atrasoDias: 999 })
    expect((await m.cred.configCrediario(DONO)).atrasoDias).toBe(365)
    await m.cred.salvarConfigCrediario(DONO, { jurosMes: 1, maxParcelas: 3, diasEntre: 30, atrasoDias: null })
    expect((await m.cred.configCrediario(DONO)).atrasoDias).toBeNull()
  })
})
