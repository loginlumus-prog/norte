// O primeiro teste do Norte, escrito antes de qualquer tela.
//
// Ele tenta VAZAR dado de uma empresa para outra, de seis jeitos diferentes,
// e precisa falhar nos seis. Se algum dia um destes passar, o produto não pode
// subir — vazamento entre clientes mata o negócio no primeiro dia.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite, Transaction } from '@electric-sql/pglite'
import { subirBanco, semear, comoApp, PAPEL_APP } from './banco'

let db: PGlite

beforeAll(async () => {
  db = await subirBanco()
  await semear(db)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

// ─────────────────────────────────────────────────────────────
// CANÁRIOS — provam que o próprio teste tem valor
// ─────────────────────────────────────────────────────────────

describe('canários (se estes falharem, os outros não valem nada)', () => {
  it('o teste não roda como superusuário', async () => {
    const r = await comoApp(db, 'org-a', (tx) =>
      tx.query<{ usuario: string; super: boolean | null }>(
        `select current_user as usuario, (select usesuper from pg_user
          where usename = current_user) as super`,
      ),
    )
    expect(r.rows[0]!.usuario).toBe(PAPEL_APP)
    // superusuário ignora RLS mesmo com FORCE. Se isto virar true um dia,
    // todos os testes abaixo passam sem provar nada.
    expect(r.rows[0]!.super).not.toBe(true)
  })

  it('sem org na requisição, não volta NADA (nem tudo)', async () => {
    // Este é o bug clássico: endpoint novo que esqueceu de setar a org.
    // O certo é voltar zero. Se voltar as 2 orgs, o RLS não está valendo.
    const r = await comoApp(db, null, (tx) => tx.query(`select id from orgs`))
    expect(r.rows).toHaveLength(0)
  })

  it('RLS está ligado e forçado em toda tabela com org_id', async () => {
    const r = await db.query<{ relname: string; rls: boolean; forced: boolean }>(`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
        and a.attname = 'org_id' and not a.attisdropped
      order by 1
    `)
    expect(r.rows.length).toBeGreaterThan(0)
    for (const t of r.rows) {
      expect(t.rls, `${t.relname} sem RLS`).toBe(true)
      expect(t.forced, `${t.relname} sem FORCE`).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// LEITURA
// ─────────────────────────────────────────────────────────────

describe('leitura', () => {
  it('cada empresa enxerga só a si mesma', async () => {
    const orgs = (tx: Transaction) => tx.query<{ id: string; nome: string }>(`select id, nome from orgs`)
    const a = await comoApp(db, 'org-a', orgs)
    expect(a.rows).toEqual([{ id: 'org-a', nome: 'Comércio Exemplo' }])

    const b = await comoApp(db, 'org-b', orgs)
    expect(b.rows).toEqual([{ id: 'org-b', nome: 'Empresa Vizinha' }])
  })

  it('A não vê as unidades de B — nem contando', async () => {
    const r = await comoApp(db, 'org-a', (tx) =>
      tx.query<{ id: string }>(`select id from unidades order by id`),
    )
    expect(r.rows.map((u) => u.id)).toEqual(['uni-a1'])
    // B tem 2 unidades e nenhuma pode aparecer, nem no total
    expect(r.rows).toHaveLength(1)
  })

  it('A não alcança linha de B nem pedindo pelo id exato', async () => {
    const r = await comoApp(db, 'org-a', (tx) =>
      tx.query(`select id from usuarios where id = 'usr-b1'`),
    )
    expect(r.rows).toHaveLength(0)
  })

  it('A não vê a auditoria de B', async () => {
    const r = await comoApp(db, 'org-a', (tx) =>
      tx.query<{ id: string }>(`select id, acao from auditoria order by id`),
    )
    expect(r.rows.map((l) => l.id)).toEqual(['aud-a1'])
  })

  it('nada some: o que A vê mais o que B vê é o total', async () => {
    const conta = (org: string) =>
      comoApp(db, org, (tx) => tx.query<{ n: number }>(`select count(*)::int as n from unidades`))
    const a = await conta('org-a')
    const b = await conta('org-b')
    const total = await db.query<{ n: number }>(`select count(*)::int as n from unidades`)

    expect(Number(a.rows[0]!.n) + Number(b.rows[0]!.n)).toBe(total.rows[0]!.n)
  })
})

// ─────────────────────────────────────────────────────────────
// ESCRITA
// ─────────────────────────────────────────────────────────────

describe('escrita', () => {
  it('A não consegue gravar linha carimbada como de B', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`insert into unidades (id, org_id, nome, ativa, eh_deposito, criada_em, atualizada_em)
                  values ('invasora', 'org-b', 'Invasora', true, false, now(), now())`),
      ),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('A não consegue alterar linha de B', async () => {
    await comoApp(db, 'org-a', (tx) =>
      tx.query(`update unidades set nome = 'Hackeada' where id = 'uni-b1'`),
    )
    // sem erro, mas também sem efeito: o UPDATE não enxerga a linha
    const r = await db.query<{ nome: string }>(`select nome from unidades where id = 'uni-b1'`)
    expect(r.rows[0]!.nome).toBe('Loja Sul')
  })

  it('A não consegue apagar linha de B', async () => {
    await comoApp(db, 'org-a', (tx) => tx.query(`delete from unidades where id = 'uni-b1'`))
    const r = await db.query(`select id from unidades where id = 'uni-b1'`)
    expect(r.rows).toHaveLength(1)
  })

  it('A não consegue se mover para dentro de B', async () => {
    // troca de dono: a linha é minha, mas eu tento empurrar pra org vizinha
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`update unidades set org_id = 'org-b' where id = 'uni-a1'`),
      ),
    ).rejects.toThrow(/row-level security|violates/i)
  })
})

// ─────────────────────────────────────────────────────────────
// AUDITORIA É LIVRO: SÓ ENTRA
// ─────────────────────────────────────────────────────────────

describe('livro de auditoria', () => {
  it('aceita registro novo da própria empresa', async () => {
    await comoApp(db, 'org-a', (tx) =>
      tx.query(`insert into auditoria (id, org_id, quem, autor, acao, criado_em)
                values ('aud-a2', 'org-a', 'Agente', 'AGENTE', 'crediario.acordo', now())`),
    )
    const r = await db.query(`select id from auditoria where id = 'aud-a2'`)
    expect(r.rows).toHaveLength(1)
  })

  // Estes dois exigem ERRO, não silêncio. Sem o revoke em rls.sql o Postgres
  // apenas devolveria "0 linhas afetadas" e a tentativa sumiria no vazio.
  it('não deixa reescrever o próprio registro — e reclama alto', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`update auditoria set valor = 0 where id = 'aud-a1'`),
      ),
    ).rejects.toThrow(/permission denied|row-level security|policy/i)

    const r = await db.query<{ valor: string }>(
      `select valor from auditoria where id = 'aud-a1'`)
    expect(Number(r.rows[0]!.valor)).toBe(1250)
  })

  it('não deixa apagar o próprio registro — e reclama alto', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`delete from auditoria where id = 'aud-a1'`),
      ),
    ).rejects.toThrow(/permission denied|row-level security|policy/i)

    const r = await db.query(`select id from auditoria where id = 'aud-a1'`)
    expect(r.rows).toHaveLength(1)
  })
})
