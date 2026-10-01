// O recibo do crediário com banco de verdade (PGlite exposto numa porta, como
// em escola-banco.test.ts): tudo passa pelo comoOrg — papel sem privilégio e
// RLS valendo.
//
// O que se prova aqui: várias parcelas num recibo só, em duas formas, com
// troco; tudo entra no turno aberto (o dinheiro na gaveta, o Pix na linha da
// maquininha); dinheiro sem caixa aberto é recusado; multa uma vez e juro sem
// cobrar duas vezes os mesmos dias; valor livre abatendo das mais antigas;
// perdão só com o PIN de quem negocia; a baixa externa fora do caixa e do DRE;
// a conta da tela que mudou é recusada; os papéis (recibo, carnê, credor) com
// e sem os dados da loja; e o isolamento entre empresas.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco, comoApp } from './banco'
import { SemPermissao, type Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  recibos: typeof import('../src/servidor/recibos')
  crediario: typeof import('../src/servidor/crediario')
  caixa: typeof import('../src/servidor/caixa')
  senha: typeof import('../src/servidor/senha')
  fin: typeof import('../src/servidor/financeiro')
  papel: typeof import('../src/app/[empresa]/crediario/Papel')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-dona', nome: 'Dona Lia', acessos: [{ papel: 'DONO', unidadeId: null }] }
const GER: Sessao = { orgId: 'org-a', usuarioId: 'usr-ger', nome: 'Gil Gerente', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-a1' }] }
const VEND: Sessao = { orgId: 'org-a', usuarioId: 'usr-vend', nome: 'Vera Vendedora', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a1' }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em) values
    ('org-a', 'Loja Exemplo', 'exemplo', 'REDE', 'ATIVA', '{crediario,multiUnidade}', now()),
    ('org-b', 'Loja Vizinha', 'vizinha', 'REDE', 'ATIVA', '{crediario}', now());
  -- A multa nasce desligada (é regra de cada loja); estas lojas cobram 2%.
  update orgs set crediario_multa_pct = 2;
  insert into unidades (id, org_id, nome, maquininhas, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro', '[{"nome":"Banco X","formas":["PIX","DEBITO","CREDITO"]},{"nome":"Banco Y","formas":["CREDITO"]}]', now()),
    ('uni-a2', 'org-a', 'Bairro', null, now()),
    ('uni-b1', 'org-b', 'Vizinha', null, now());
  insert into usuarios (id, org_id, nome, email, senha_hash, sessoes_desde, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona Lia', 'dona@a.com', 'x', '2026-01-01', now()),
    ('usr-ger', 'org-a', 'Gil Gerente', 'gil@a.com', 'x', '2026-01-01', now()),
    ('usr-vend', 'org-a', 'Vera Vendedora', 'vera@a.com', 'x', '2026-01-01', now()),
    ('usr-bia', 'org-b', 'Bia', 'bia@b.com', 'x', '2026-01-01', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-ger', 'org-a', 'usr-ger', 'uni-a1', 'GERENTE'),
    ('ac-vend', 'org-a', 'usr-vend', 'uni-a1', 'BALCAO'),
    ('ac-bia', 'org-b', 'usr-bia', null, 'DONO');
  insert into clientes (id, org_id, nome, documento, atualizado_em) values
    ('cli-maria', 'org-a', 'Maria Souza', '52998224725', now()),
    ('cli-joana', 'org-a', 'Joana Lima', null, now()),
    ('cli-ana', 'org-a', 'Ana Paz', null, now()),
    ('cli-b', 'org-b', 'Cliente Vizinha', null, now());
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id, criada_em) values
    ('v-10', 'org-a', 'uni-a1', 10, 'CONCLUIDA', 300, 'cli-maria', '2026-07-10T15:00:00Z'),
    ('v-11', 'org-a', 'uni-a1', 11, 'SALDO_IMPORTADO', 50, 'cli-maria', '2026-05-10T15:00:00Z'),
    ('v-12', 'org-a', 'uni-a2', 1, 'CONCLUIDA', 100, 'cli-maria', '2026-09-01T15:00:00Z'),
    ('v-20', 'org-a', 'uni-a1', 20, 'CONCLUIDA', 100, 'cli-joana', '2026-08-10T15:00:00Z'),
    ('v-30', 'org-a', 'uni-a1', 30, 'CONCLUIDA', 200, 'cli-ana', '2026-07-10T15:00:00Z'),
    ('v-b', 'org-b', 'uni-b1', 1, 'CONCLUIDA', 100, 'cli-b', '2026-08-10T15:00:00Z');
  insert into venda_itens (id, org_id, venda_id, descricao, codigo, quantidade, preco_unit, total) values
    ('vi-1', 'org-a', 'v-10', 'Vestido longo', '005220', 1, 300, 300);
  insert into pagamentos (id, org_id, venda_id, forma, valor) values
    ('pg-1', 'org-a', 'v-10', 'CREDIARIO', 300);
  insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
    ('p1', 'org-a', 'v-10', 'cli-maria', 'uni-a1', 1, 3, '2026-08-10', 100),
    ('p2', 'org-a', 'v-10', 'cli-maria', 'uni-a1', 2, 3, '2026-09-10', 100),
    ('p3', 'org-a', 'v-10', 'cli-maria', 'uni-a1', 3, 3, '2026-11-10', 100),
    ('p4', 'org-a', 'v-11', 'cli-maria', 'uni-a1', 1, 1, '2026-06-10', 50),
    ('p5', 'org-a', 'v-12', 'cli-maria', 'uni-a2', 1, 1, '2026-10-01', 100),
    ('p6', 'org-a', 'v-20', 'cli-joana', 'uni-a1', 1, 1, '2026-09-10', 100),
    ('p7', 'org-a', 'v-30', 'cli-ana', 'uni-a1', 1, 2, '2026-08-10', 100),
    ('p8', 'org-a', 'v-30', 'cli-ana', 'uni-a1', 2, 2, '2026-09-10', 100),
    ('pb', 'org-b', 'v-b', 'cli-b', 'uni-b1', 1, 1, '2026-09-10', 100);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 53000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    recibos: await import('../src/servidor/recibos'),
    crediario: await import('../src/servidor/crediario'),
    caixa: await import('../src/servidor/caixa'),
    senha: await import('../src/servidor/senha'),
    fin: await import('../src/servidor/financeiro'),
    papel: await import('../src/app/[empresa]/crediario/Papel'),
  }
  // O PIN da gerente (como `definirMeuPin` guarda), e o caixa do Centro aberto.
  const hash = await m.senha.guardarSenha('pin:usr-ger:4821')
  await db.query(`update usuarios set pin_hash = $1 where id = 'usr-ger'`, [hash])
  const ab = await m.caixa.abrirCaixa(DONA, 'uni-a1', 100)
  expect(ab.ok).toBe(true)
  if (ab.ok) caixaId = ab.caixaId
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

let caixaId = ''
const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const um = async <T,>(sql: string, p: unknown[] = []) => (await linhas<T>(sql, p))[0]!
const AGORA = new Date('2026-10-10T12:00:00-03:00')
const SEMANA = new Date(AGORA.getTime() + 7 * 864e5)
const parcela = (id: string) =>
  um<{ pago: string; desconto: string; juros: string; multa: string; multa_cobrada: boolean; ate: string | null; quitada: boolean }>(
    `select pago, desconto, juros, multa, multa_cobrada, to_char(juros_ate, 'YYYY-MM-DD') ate, quitada_em is not null quitada from parcelas where id = $1`,
    [id],
  )

let reciboMaria = ''

// ─────────────────────────────────────────────────────────────
describe('várias parcelas num recibo, em duas formas', () => {
  it('a ficha mostra as abertas da loja, da mais antiga, com o atraso de hoje — e a outra loja à parte', async () => {
    const f = await m.recibos.fichaParaReceber(VEND, 'cli-maria', 'uni-a1', AGORA)
    expect(f!.parcelas.map((p) => [p.id, p.multaC, p.jurosC])).toEqual([
      ['p4', 100, 610],
      ['p1', 200, 610],
      ['p2', 200, 300],
      ['p3', 0, 0],
    ])
    expect(f!.parcelas[0]!.importada).toBe(true)
    expect(f!.caixaAberto).toBe(true)
    expect(f!.negocia).toBe(false)
    expect(f!.maquininhas.map((x) => x.nome)).toEqual(['Banco X', 'Banco Y'])
    // A vendedora só enxerga o Centro: a dívida do Bairro não aparece para ela.
    expect(f!.outrasLojas).toEqual([])
    const dona = await m.recibos.fichaParaReceber(DONA, 'cli-maria', 'uni-a1', AGORA)
    expect(dona!.outrasLojas).toEqual([{ unidadeId: 'uni-a2', nome: 'Bairro', devendoC: 10000, vencidoC: 10000 }])
  })

  it('a vendedora recebe p1 e p2: R$ 150 no Pix (Banco X) e o resto em dinheiro, com troco', async () => {
    const r = await m.recibos.receberVarias(
      VEND,
      {
        clienteId: 'cli-maria',
        unidadeId: 'uni-a1',
        parcelaIds: ['p1', 'p2'],
        formas: [
          { forma: 'PIX', valor: 150, maquininha: 'Banco X' },
          { forma: 'DINHEIRO', valor: 63.1 },
        ],
        entregue: 70,
        esperado: 213.1,
      },
      AGORA,
    )
    expect(r).toMatchObject({ ok: true, troco: 6.9, recebido: 213.1, saldoDepois: 150, quitou: false })
    if (!r.ok) return
    reciboMaria = r.reciboId

    for (const id of ['p1', 'p2']) {
      expect(await parcela(id)).toMatchObject({ pago: '100.00', quitada: true, multa_cobrada: true, ate: '2026-10-10', multa: '2.00' })
    }
    expect((await parcela('p1')).juros).toBe('6.10')
    expect((await parcela('p2')).juros).toBe('3.00')

    const rec = await linhas<{ parcela_id: string; forma: string; valor: string; juros: string; multa: string; maquininha: string | null; caixa_id: string; recibo_id: string }>(
      `select parcela_id, forma, valor, juros, multa, maquininha, caixa_id, recibo_id from recebimentos where recibo_id = $1 order by parcela_id, forma desc`,
      [reciboMaria],
    )
    expect(rec.map((x) => [x.parcela_id, x.forma, x.valor, x.maquininha])).toEqual([
      ['p1', 'PIX', '108.10', 'Banco X'],
      ['p2', 'PIX', '41.90', 'Banco X'],
      ['p2', 'DINHEIRO', '63.10', null],
    ])
    expect(rec.every((x) => x.caixa_id === caixaId)).toBe(true)
    const recibo = await um<{ valor: string; juros: string; multa: string; troco: string; saldo_antes: string; saldo_depois: string; quem: string }>(
      `select valor, juros, multa, troco, saldo_antes, saldo_depois, quem from recibos_crediario where id = $1`,
      [reciboMaria],
    )
    expect(recibo).toEqual({ valor: '213.10', juros: '9.10', multa: '4.00', troco: '6.90', saldo_antes: '350.00', saldo_depois: '150.00', quem: 'Vera Vendedora' })
  })

  it('tudo entra no turno: o dinheiro (sem o troco) na gaveta, o Pix na linha da maquininha', async () => {
    const c = await m.caixa.conferirCaixa(DONA, caixaId)
    expect(c.dinheiroRecebido).toBe(63.1)
    expect(c.recebidoCrediario).toBe(213.1)
    expect(c.esperado).toBe(100 + 63.1)
    expect(c.recibos).toBe(1)
    expect(c.atrasoRecebido).toBe(13.1)
    expect(c.recebidoPorForma).toEqual([
      { forma: 'DINHEIRO', maquininha: null, total: 63.1 },
      { forma: 'PIX', maquininha: 'Banco X', total: 150 },
    ])
  })

  it('maquininha que não é da loja (ou não aceita a forma) é recusada', async () => {
    const r = await m.recibos.receberVarias(VEND, { clienteId: 'cli-maria', unidadeId: 'uni-a1', parcelaIds: ['p3'], formas: [{ forma: 'PIX', valor: 100, maquininha: 'Banco Y' }] }, AGORA)
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/não é maquininha/) })
  })

  it('a conta da tela que mudou é recusada — nada entra', async () => {
    const r = await m.recibos.receberVarias(
      VEND,
      { clienteId: 'cli-maria', unidadeId: 'uni-a1', parcelaIds: ['p4'], formas: [{ forma: 'PIX', valor: 57.1 }], esperado: 57.0 },
      AGORA,
    )
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/mudou/) })
    expect((await parcela('p4')).pago).toBe('0.00')
  })

  it('dinheiro sem caixa aberto é recusado; Pix entra, sem turno', async () => {
    const semCaixa = await m.recibos.receberVarias(DONA, { clienteId: 'cli-maria', unidadeId: 'uni-a2', parcelaIds: ['p5'], formas: [{ forma: 'DINHEIRO', valor: 102.27 }] }, AGORA)
    expect(semCaixa).toMatchObject({ ok: false, erro: expect.stringMatching(/caixa desta loja precisa estar aberto/) })
    const ficha = await m.recibos.fichaParaReceber(DONA, 'cli-maria', 'uni-a2', AGORA)
    const p5 = ficha!.parcelas[0]!
    const total = (p5.restaC + p5.multaC + p5.jurosC) / 100
    const pix = await m.recibos.receberVarias(DONA, { clienteId: 'cli-maria', unidadeId: 'uni-a2', parcelaIds: ['p5'], formas: [{ forma: 'PIX', valor: total }] }, AGORA)
    expect(pix).toMatchObject({ ok: true, quitou: true })
    const { caixa_id } = await um<{ caixa_id: string | null }>(`select caixa_id from recebimentos where parcela_id = 'p5'`)
    expect(caixa_id).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
describe('multa uma vez, juro sem cobrar duas vezes', () => {
  it('Joana paga R$ 60 de uma parcela de R$ 100 com 30 dias: R$ 5 de atraso, R$ 55 abatem', async () => {
    const r = await m.recibos.receberVarias(VEND, { clienteId: 'cli-joana', unidadeId: 'uni-a1', parcelaIds: ['p6'], formas: [{ forma: 'PIX', valor: 60 }] }, AGORA)
    expect(r).toMatchObject({ ok: true, saldoDepois: 45 })
    expect(await parcela('p6')).toMatchObject({ pago: '55.00', multa: '2.00', juros: '3.00', multa_cobrada: true, ate: '2026-10-10', quitada: false })
  })

  it('uma semana depois: sem multa de novo, e o juro só dos 7 dias novos sobre os R$ 45', async () => {
    const [p] = await m.crediario.listarParcelas(DONA, { unidadeIds: ['uni-a1'], clienteId: 'cli-joana' }, SEMANA)
    expect(p).toMatchObject({ diasAtraso: 37, diasJuros: 7, multaHoje: 0, jurosHoje: 0.31, resta: 45 })
    const r = await m.recibos.receberVarias(VEND, { clienteId: 'cli-joana', unidadeId: 'uni-a1', parcelaIds: ['p6'], formas: [{ forma: 'DINHEIRO', valor: 45.31 }], esperado: 45.31 }, SEMANA)
    expect(r).toMatchObject({ ok: true, quitou: true })
    expect(await parcela('p6')).toMatchObject({ pago: '100.00', multa: '2.00', juros: '3.31', quitada: true })
  })
})

describe('valor livre: das mais antigas', () => {
  it('Ana dá R$ 150 sem marcar nada: quita a de agosto (com o atraso) e o resto abate a de setembro', async () => {
    const r = await m.recibos.receberVarias(VEND, { clienteId: 'cli-ana', unidadeId: 'uni-a1', parcelaIds: [], formas: [{ forma: 'PIX', valor: 150 }] }, AGORA)
    expect(r).toMatchObject({ ok: true, saldoDepois: 63.1 })
    expect(await parcela('p7')).toMatchObject({ pago: '100.00', quitada: true })
    expect(await parcela('p8')).toMatchObject({ pago: '36.90', multa: '2.00', juros: '3.00', quitada: false })
  })

  it('valor que não cobre nem o atraso da próxima é recusado com o número certo', async () => {
    const r = await m.recibos.receberVarias(VEND, { clienteId: 'cli-ana', unidadeId: 'uni-a1', parcelaIds: [], formas: [{ forma: 'PIX', valor: 500 }] }, AGORA)
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/Passa do que ela deve/) })
  })
})

// ─────────────────────────────────────────────────────────────
describe('perdão do atraso: só com quem negocia o crediário', () => {
  const perdao = (pin?: string) => ({
    clienteId: 'cli-maria',
    unidadeId: 'uni-a1',
    parcelaIds: ['p4'],
    formas: [{ forma: 'DINHEIRO' as const, valor: 50 }],
    perdoarAtraso: true,
    motivo: 'cliente antiga, acordo',
    autorizacao: pin ? { pin } : null,
  })

  it('a vendedora sem PIN é recusada; com PIN errado também', async () => {
    expect(await m.recibos.receberVarias(VEND, perdao(), AGORA)).toMatchObject({ ok: false, erro: expect.stringMatching(/PIN/) })
    expect(await m.recibos.receberVarias(VEND, perdao('1111'), AGORA)).toMatchObject({ ok: false, erro: expect.stringMatching(/não confere/) })
    expect(await m.recibos.receberVarias(VEND, { ...perdao('4821'), motivo: '' }, AGORA)).toMatchObject({ ok: false, erro: expect.stringMatching(/motivo/) })
    expect((await parcela('p4')).pago).toBe('0.00')
  })

  it('com o PIN da gerente passa: a parcela quita sem o atraso, e o recibo diz quem autorizou', async () => {
    const r = await m.recibos.receberVarias(VEND, perdao('4821'), AGORA)
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(await parcela('p4')).toMatchObject({ pago: '50.00', juros: '0.00', multa: '0.00', multa_cobrada: true, ate: '2026-10-10', quitada: true })
    const rec = await um<{ perdoado: string; autorizado_por: string; motivo: string; quem: string }>(
      `select perdoado, autorizado_por, motivo, quem from recibos_crediario where id = $1`,
      [r.reciboId],
    )
    expect(rec).toEqual({ perdoado: '7.10', autorizado_por: 'Gil Gerente', motivo: 'cliente antiga, acordo', quem: 'Vera Vendedora' })
    const { n } = await um<{ n: number }>(`select count(*)::int n from auditoria where acao = 'autorizacao.pin' and usuario_id = 'usr-ger'`)
    expect(n).toBe(1)
  })

  it('cobrar mais atraso do que a regra pelo caminho antigo é recusado; menos, só para quem negocia', async () => {
    await db.exec(`
      insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id) values ('v-40', 'org-a', 'uni-a1', 40, 'CONCLUIDA', 100, 'cli-ana');
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values ('p9', 'org-a', 'v-40', 'cli-ana', 'uni-a1', 1, 1, '2026-09-10', 100);
    `)
    expect(await m.crediario.receberParcela(VEND, { parcelaId: 'p9', valor: 110, juros: 10, forma: 'PIX' }, AGORA)).toMatchObject({ ok: false, motivo: 'juros_acima' })
    expect(await m.crediario.receberParcela(VEND, { parcelaId: 'p9', valor: 100, juros: 0, forma: 'PIX' }, AGORA)).toMatchObject({ ok: false, motivo: 'recusado' })
    const ok = await m.crediario.receberParcela(GER, { parcelaId: 'p9', valor: 100, juros: 0, forma: 'PIX' }, AGORA)
    expect(ok).toMatchObject({ ok: true, quitada: true, juros: 0 })
  })
})

// ─────────────────────────────────────────────────────────────
describe('já pagou fora (baixa externa)', () => {
  it('é de quem negocia o crediário: a vendedora não dá baixa', async () => {
    await expect(
      m.recibos.baixaExterna(VEND, { clienteId: 'cli-maria', unidadeId: 'uni-a1', parcelaIds: ['p3'], valor: 100, referencia: 'sistema antigo, recibo 123', pagoEm: '2026-10-05' }, AGORA),
    ).rejects.toBeInstanceOf(SemPermissao)
  })

  it('a gerente dá baixa: abate a dívida, fica no livro — e não entra no caixa nem no DRE', async () => {
    const antes = await m.caixa.conferirCaixa(DONA, caixaId)
    const semRef = await m.recibos.baixaExterna(GER, { clienteId: 'cli-maria', unidadeId: 'uni-a1', parcelaIds: ['p3'], valor: 100, referencia: '', pagoEm: '2026-10-05' }, AGORA)
    expect(semRef).toMatchObject({ ok: false, erro: expect.stringMatching(/de onde veio/) })
    const futuro = await m.recibos.baixaExterna(GER, { clienteId: 'cli-maria', unidadeId: 'uni-a1', parcelaIds: ['p3'], valor: 100, referencia: 'recibo 123', pagoEm: '2026-10-20' }, AGORA)
    expect(futuro.ok).toBe(false)

    const r = await m.recibos.baixaExterna(GER, { clienteId: 'cli-maria', unidadeId: 'uni-a1', parcelaIds: ['p3'], valor: 100, forma: 'PIX', referencia: 'sistema antigo, recibo 123', pagoEm: '2026-10-05' }, AGORA)
    expect(r).toMatchObject({ ok: true, quitou: true, saldoDepois: 0 })
    expect(await parcela('p3')).toMatchObject({ pago: '100.00', quitada: true, juros: '0.00', multa: '0.00' })
    const x = await um<{ externo: boolean; caixa_id: string | null; forma: string }>(`select externo, caixa_id, forma from recebimentos where parcela_id = 'p3'`)
    expect(x).toEqual({ externo: true, caixa_id: null, forma: 'PIX' })
    const depois = await m.caixa.conferirCaixa(DONA, caixaId)
    expect(depois.recebidoCrediario).toBe(antes.recebidoCrediario)
    const { motivo } = await um<{ motivo: string }>(`select motivo from auditoria where acao = 'crediario.baixa_externa'`)
    expect(motivo).toMatch(/05\/10\/2026 · sistema antigo, recibo 123/)
  })

  it('o DRE conta multa e juro do que entrou aqui, e nada da baixa externa', async () => {
    await db.exec(`update recebimentos set juros = 99 where externo`)
    const dre = await m.fin.montarDRE(DONA, ['uni-a1', 'uni-a2'], new Date('2026-10-01T03:00:00Z'), new Date('2026-11-01T02:59:59Z'))
    const texto = JSON.stringify(dre)
    // p1 + p2 (13,10) + p5 + p6 (5,00 e 0,31) + p7/p8 (8,10 + 5,00)
    const recebido = await um<{ s: string }>(`select sum(juros + multa) s from recebimentos where not externo`)
    expect(texto).toContain('Juros e multa de crediário recebidos')
    expect(texto).toContain(`"valor":${Number(recebido.s)}`)
    await db.exec(`update recebimentos set juros = 0 where externo`)
  })
})

// ─────────────────────────────────────────────────────────────
describe('os papéis', () => {
  it('o recibo: as parcelas pagas, as formas, o troco, o saldo fotografado e o que falta', async () => {
    const r = await m.recibos.acharRecibo(VEND, reciboMaria)
    expect(r).toMatchObject({ valor: 213.1, juros: 9.1, multa: 4, troco: 6.9, saldoAntes: 350, saldoDepois: 150, quem: 'Vera Vendedora' })
    expect(r!.cliente.cpf).toBe('529.982.247-25')
    expect(r!.parcelas.map((p) => [p.numero, p.abatido, p.emAtraso, p.quitou])).toEqual([
      [1, 100, true, true],
      [2, 100, true, true],
    ])
    expect(r!.formas).toEqual([
      { forma: 'PIX', maquininha: 'Banco X', valor: 150 },
      { forma: 'DINHEIRO', maquininha: null, valor: 63.1 },
    ])
    expect(r!.codigo).toMatch(/^R-[A-Z0-9]{6}$/)
  })

  it('o credor sem os dados da loja diz o que falta, e o papel sai com a linha em branco', async () => {
    const c = await m.banco.comoOrg('org-a', (x) => m.recibos.credorDaLoja(x, 'org-a', 'uni-a1'))
    expect(c.faltando).toEqual(['razão social', 'CNPJ', 'endereço', 'telefone'])
    const html = renderToStaticMarkup(createElement(m.papel.Credor, { c }))
    expect(html).toContain('CNPJ ______')
    expect(html).toContain('Razão social: ______')
  })

  it('com os dados da loja preenchidos, sai completo', async () => {
    await db.exec(`
      update unidades set razao_social = 'Exemplo Modas Ltda', documento = '11222333000181', inscricao_estadual = '123456',
             endereco = 'Rua A', numero = '10', bairro = 'Centro', cidade = 'Salvador', estado = 'BA', telefone = '7133334444'
       where id = 'uni-a1'`)
    const c = await m.banco.comoOrg('org-a', (x) => m.recibos.credorDaLoja(x, 'org-a', 'uni-a1'))
    expect(c).toMatchObject({ razaoSocial: 'Exemplo Modas Ltda', cnpj: '11.222.333/0001-81', ie: '123456', faltando: [] })
    const html = renderToStaticMarkup(createElement(m.papel.Credor, { c }))
    expect(html).toContain('CNPJ 11.222.333/0001-81')
    expect(html).not.toContain('____')
  })

  it('o carnê da venda: as peças, o financiado, as parcelas como estão hoje e o saldo da loja', async () => {
    const c = await m.recibos.carneDaVenda(DONA, 'v-10')
    expect(c).toMatchObject({ vendaNumero: 10, total: 300, financiado: 300, pagoAgora: 0, saldoNaLoja: 0 })
    expect(c!.cliente.cpf).toBe('529.982.247-25')
    expect(c!.itens).toEqual([{ descricao: 'Vestido longo', codigo: '005220', quantidade: 1, total: 300 }])
    expect(c!.parcelas.map((p) => [p.numero, p.quitada])).toEqual([
      [1, true],
      [2, true],
      [3, true],
    ])
    expect(c!.regra).toMatchObject({ multaPct: 2, jurosMes: 3 })
    expect(await m.recibos.carneDaVenda(DONA, 'v-b')).toBeNull()
  })

  it('o fechamento impresso só sai de turno fechado', async () => {
    expect(await m.caixa.turnoParaImprimir(DONA, caixaId)).toBeNull()
    // Abertura 100 + o dinheiro do crediário: 63,10 (Maria) + 45,31 (Joana) + 50 (Maria, com perdão).
    const conf = await m.caixa.conferirCaixa(DONA, caixaId)
    expect(conf.esperado).toBe(258.41)
    await m.caixa.fecharCaixa(DONA, caixaId, 250)
    const t = await m.caixa.turnoParaImprimir(DONA, caixaId)
    expect(t).toMatchObject({ saldoEsperado: 258.41, saldoContado: 250, diferenca: -8.41 })
    expect(t!.conferencia.recebidoCrediario).toBeGreaterThan(213)
  })
})

// ─────────────────────────────────────────────────────────────
describe('isolamento', () => {
  it('a outra empresa não vê nem grava recibo daqui (RLS)', async () => {
    const delas = await comoApp(db, 'org-b', (tx) => tx.query<{ n: number }>(`select count(*)::int n from recibos_crediario`))
    expect(delas.rows[0]!.n).toBe(0)
    const nossas = await comoApp(db, 'org-a', (tx) => tx.query<{ n: number }>(`select count(*)::int n from recibos_crediario`))
    expect(nossas.rows[0]!.n).toBeGreaterThan(0)
    await expect(
      comoApp(db, 'org-b', (tx) =>
        tx.query(`insert into recibos_crediario (id, org_id, unidade_id, cliente_id, valor, saldo_antes, saldo_depois, quem) values ('r-x', 'org-a', 'uni-a1', 'cli-maria', 1, 1, 0, 'x')`),
      ),
    ).rejects.toThrow()
  })

  it('a vizinha não recebe parcela de cliente daqui', async () => {
    const VIZ: Sessao = { orgId: 'org-b', usuarioId: 'usr-bia', nome: 'Bia', acessos: [{ papel: 'DONO', unidadeId: null }] }
    const r = await m.recibos.receberVarias(VIZ, { clienteId: 'cli-ana', unidadeId: 'uni-a1', parcelaIds: ['p8'], formas: [{ forma: 'PIX', valor: 10 }] }, AGORA)
    expect(r).toMatchObject({ ok: false, erro: 'Cliente não encontrado.' })
  })
})
