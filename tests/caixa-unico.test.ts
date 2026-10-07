// Uma loja, no máximo UM caixa aberto — garantido pelo banco (índice único
// parcial `caixas_um_aberto_por_unidade`, no schema), e não só pela trava do
// `abrirCaixa`.
//
// A corrida de verdade (duas máquinas abrindo ao mesmo tempo) o PGlite não
// reproduz: é um backend só. O que se prova aqui é o que a corrida
// encontraria — o banco recusando o segundo aberto venha de onde vier — e que
// o erro que o Prisma entrega nesse caso é reconhecido pelo `abrirCaixa` e
// vira a resposta educada "já está aberto", e não um erro de máquina.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco, semear, comoApp } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  caixa: typeof import('../src/servidor/caixa')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = {
  orgId: 'org-a',
  usuarioId: 'usr-a1',
  nome: 'Ana',
  acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }],
} as Sessao

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await semear(db)
  const porta = 53000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = { caixa: await import('../src/servidor/caixa'), banco: await import('../src/servidor/banco') }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

describe('o banco: um aberto por loja', () => {
  it('o segundo caixa aberto na mesma loja é recusado, venha de onde vier', async () => {
    await comoApp(db, 'org-b', (tx) => tx.query(`insert into caixas (id, org_id, unidade_id, aberto_por) values ('b-1', 'org-b', 'uni-b1', 'X')`))
    await expect(
      comoApp(db, 'org-b', (tx) => tx.query(`insert into caixas (id, org_id, unidade_id, aberto_por) values ('b-2', 'org-b', 'uni-b1', 'Y')`)),
    ).rejects.toThrow(/caixas_um_aberto_por_unidade/)
    // nem o admin, que passa por cima do RLS
    await expect(db.query(`insert into caixas (id, org_id, unidade_id, aberto_por) values ('b-3', 'org-b', 'uni-b1', 'Z')`)).rejects.toThrow(
      /caixas_um_aberto_por_unidade/,
    )
  })

  it('fechado não conta: a loja tem quantos turnos FECHADOS quiser, e outra loja abre o seu', async () => {
    await db.exec(`
      insert into caixas (id, org_id, unidade_id, aberto_por, aberto) values
        ('b-f1', 'org-b', 'uni-b1', 'X', false),
        ('b-f2', 'org-b', 'uni-b1', 'X', false);
      insert into caixas (id, org_id, unidade_id, aberto_por) values ('b-dep', 'org-b', 'uni-b2', 'X');
    `)
  })

  it('reabrir um turno fechado com outro aberto na loja também é recusado', async () => {
    await expect(db.query(`update caixas set aberto = true where id = 'b-f1'`)).rejects.toThrow(/caixas_um_aberto_por_unidade/)
  })
})

describe('abrirCaixa', () => {
  it('o erro do índice, como o Prisma entrega, é reconhecido', async () => {
    await m.banco.comoOrg('org-a', (tx) => tx.caixa.create({ data: { orgId: 'org-a', unidadeId: 'uni-a1', abertoPor: 'Ana' } }))
    const erro = await m.banco
      .comoOrg('org-a', (tx) => tx.caixa.create({ data: { orgId: 'org-a', unidadeId: 'uni-a1', abertoPor: 'Outra' } }))
      .then(() => null, (e: unknown) => e)
    expect(erro).not.toBeNull()
    expect(m.caixa.ehCaixaJaAberto(erro)).toBe(true)
  })

  it('outro erro de banco NÃO vira "já aberto"', async () => {
    const erro = await m.banco
      .comoOrg('org-a', (tx) => tx.caixa.create({ data: { orgId: 'org-a', unidadeId: 'nao-existe', abertoPor: 'Ana' } }))
      .then(() => null, (e: unknown) => e)
    expect(erro).not.toBeNull()
    expect(m.caixa.ehCaixaJaAberto(erro)).toBe(false)
    expect(m.caixa.ehCaixaJaAberto(new Error('qualquer'))).toBe(false)
    expect(m.caixa.ehCaixaJaAberto(null)).toBe(false)
  })

  it('com caixa aberto, a resposta continua a educada, com quem abriu', async () => {
    const r = await m.caixa.abrirCaixa(DONA, 'uni-a1', 50)
    expect(r).toMatchObject({ ok: false, motivo: 'ja_aberto', abertoPor: 'Ana' })
  })

  it('fechado o turno, abre de novo normalmente', async () => {
    await db.exec(`update caixas set aberto = false where unidade_id = 'uni-a1'`)
    const r = await m.caixa.abrirCaixa(DONA, 'uni-a1', 50)
    expect(r.ok).toBe(true)
    const n = await db.query<{ n: number }>(`select count(*)::int n from caixas where unidade_id = 'uni-a1' and aberto`)
    expect(n.rows[0]!.n).toBe(1)
  })
})

describe('apagar turno de teste', () => {
  const GERENTE: Sessao = { orgId: 'org-a', usuarioId: 'usr-a1', nome: 'Gê', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-a1', expiraEm: null }] } as Sessao
  const turno = async (id: string) => {
    await db.exec(`update caixas set aberto = false where unidade_id = 'uni-a1' and aberto`)
    await db.exec(`insert into caixas (id, org_id, unidade_id, aberto, aberto_por, saldo_esperado, saldo_contado) values ('${id}', 'org-a', 'uni-a1', false, 'Teste', 100, 0)`)
  }

  it('só o dono, com motivo, e só turno fechado sem venda valendo', async () => {
    await turno('t-1')
    await expect(m.caixa.apagarTurno(GERENTE, 't-1', 'turno de teste')).rejects.toThrow()
    await expect(m.caixa.apagarTurno(DONA, 't-1', 'ok')).rejects.toThrow('Diga por que')
    await m.caixa.apagarTurno(DONA, 't-1', 'turno de teste')
    expect((await db.query(`select 1 from caixas where id = 't-1'`)).rows).toHaveLength(0)
    const livro = await db.query<{ motivo: string }>(`select motivo from auditoria where acao = 'caixa.apagou' and alvo_id = 't-1'`)
    expect(livro.rows[0]!.motivo).toBe('turno de teste')
  })

  it('com venda valendo, recusa; cancelada, solta a venda e apaga', async () => {
    await turno('t-2')
    await db.exec(`insert into vendas (id, org_id, unidade_id, numero, total, situacao, caixa_id) values ('v-t2', 'org-a', 'uni-a1', 9901, 10, 'CONCLUIDA', 't-2')`)
    await expect(m.caixa.apagarTurno(DONA, 't-2', 'turno de teste')).rejects.toThrow('cancele')
    await db.exec(`update vendas set situacao = 'CANCELADA' where id = 'v-t2'`)
    await m.caixa.apagarTurno(DONA, 't-2', 'turno de teste')
    const v = await db.query<{ caixa_id: string | null }>(`select caixa_id from vendas where id = 'v-t2'`)
    expect(v.rows[0]!.caixa_id).toBeNull()
  })

  it('turno aberto não apaga', async () => {
    await db.exec(`insert into caixas (id, org_id, unidade_id, aberto, aberto_por) values ('t-3', 'org-a', 'uni-a1', true, 'Teste')`)
    await expect(m.caixa.apagarTurno(DONA, 't-3', 'turno de teste')).rejects.toThrow('Feche')
  })
})
