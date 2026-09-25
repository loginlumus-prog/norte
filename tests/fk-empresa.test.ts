// Chave estrangeira não atravessa empresa (o gatilho zz_fk_mesma_empresa, em
// prisma/sql/rls.sql).
//
// O furo: a conferência de FK do Postgres roda POR CIMA do RLS. Sem o
// gatilho, a empresa A grava uma venda com `cliente_id` de um cliente da B, e
// o banco aceita — o id existe. Estes testes provam, relação por relação, que
// agora ele recusa; que dentro da mesma empresa tudo continua funcionando; e
// que a regra vale até para o admin, que passa por cima do RLS.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { subirBanco, semear, comoApp } from './banco'

let db: PGlite

const RECUSA = /referencia de outra empresa/

beforeAll(async () => {
  db = await subirBanco()
  await semear(db)
  // Uma de cada lado, para cada tabela pai. Roda como dono (superusuário):
  // o gatilho vale aqui também, então a semente precisa ser honesta.
  await db.exec(`
    insert into clientes (id, org_id, nome, atualizado_em) values
      ('cli-a', 'org-a', 'Cliente A', now()),
      ('cli-b', 'org-b', 'Cliente B', now());
    insert into caixas (id, org_id, unidade_id, aberto_por) values
      ('cx-a', 'org-a', 'uni-a1', 'Ana'),
      ('cx-b', 'org-b', 'uni-b1', 'Vizinho');
    insert into categorias (id, org_id, nome) values
      ('cat-a', 'org-a', 'Blusas'),
      ('cat-b', 'org-b', 'Segredos');
    insert into produtos (id, org_id, nome, atualizado_em) values
      ('prod-a', 'org-a', 'Blusa', now()),
      ('prod-b', 'org-b', 'Segredo', now());
    insert into variacoes (id, org_id, produto_id) values
      ('var-a', 'org-a', 'prod-a'),
      ('var-b', 'org-b', 'prod-b');
    insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
      ('cf-a', 'org-a', 'Aluguel', 'DESPESA', 'OUTRA'),
      ('cf-b', 'org-b', 'Aluguel', 'DESPESA', 'OUTRA');
    insert into quadros (id, org_id, nome, quem, atualizado_em) values
      ('qua-a', 'org-a', 'Quadro A', 'Ana', now()),
      ('qua-b', 'org-b', 'Quadro B', 'Vizinho', now());
    insert into vendas (id, org_id, unidade_id, numero) values
      ('v-a', 'org-a', 'uni-a1', 1),
      ('v-b', 'org-b', 'uni-b1', 1);
  `)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

// ─────────────────────────────────────────────────────────────
// RELAÇÃO POR RELAÇÃO
// ─────────────────────────────────────────────────────────────

// Cada caso: um INSERT da empresa A cuja FK recebe `ref`. Com o id da B tem de
// ser recusado; com o da própria A, aceito. `n` deixa o id da linha único.
type Caso = { relacao: string; daB: string; daA: string; sql: (id: string, ref: string, n: number) => string }

const CASOS: Caso[] = [
  {
    relacao: 'venda → cliente',
    daB: 'cli-b',
    daA: 'cli-a',
    sql: (id, ref, n) => `insert into vendas (id, org_id, unidade_id, numero, cliente_id) values ('${id}', 'org-a', 'uni-a1', ${n}, '${ref}')`,
  },
  {
    relacao: 'venda → caixa',
    daB: 'cx-b',
    daA: 'cx-a',
    sql: (id, ref, n) => `insert into vendas (id, org_id, unidade_id, numero, caixa_id) values ('${id}', 'org-a', 'uni-a1', ${n}, '${ref}')`,
  },
  {
    relacao: 'venda → loja',
    daB: 'uni-b1',
    daA: 'uni-a1',
    sql: (id, ref, n) => `insert into vendas (id, org_id, unidade_id, numero) values ('${id}', 'org-a', '${ref}', ${n})`,
  },
  {
    relacao: 'item de venda → variação',
    daB: 'var-b',
    daA: 'var-a',
    sql: (id, ref) =>
      `insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, quantidade, preco_unit, total)
       values ('${id}', 'org-a', 'v-a', '${ref}', 'x', 1, 1, 1)`,
  },
  {
    relacao: 'item de venda → venda',
    daB: 'v-b',
    daA: 'v-a',
    sql: (id, ref) =>
      `insert into venda_itens (id, org_id, venda_id, descricao, quantidade, preco_unit, total)
       values ('${id}', 'org-a', '${ref}', 'x', 1, 1, 1)`,
  },
  {
    relacao: 'lançamento → categoria financeira',
    daB: 'cf-b',
    daA: 'cf-a',
    sql: (id, ref) =>
      `insert into lancamentos (id, org_id, categoria_id, tipo, descricao, valor, vencimento, quem, atualizado_em)
       values ('${id}', 'org-a', '${ref}', 'DESPESA', 'Aluguel', 100, current_date, 'Ana', now())`,
  },
  {
    relacao: 'estoque → loja',
    daB: 'uni-b1',
    daA: 'uni-a1',
    sql: (id, ref) => `insert into estoque (id, org_id, variacao_id, unidade_id, atualizado_em) values ('${id}', 'org-a', 'var-a', '${ref}', now())`,
  },
  {
    relacao: 'encomenda → cliente',
    daB: 'cli-b',
    daA: 'cli-a',
    sql: (id, ref) =>
      `insert into encomendas (id, org_id, unidade_id, cliente_id, cliente_nome, descricao, para, quem, atualizada_em)
       values ('${id}', 'org-a', 'uni-a1', '${ref}', 'Fulana', 'Bolo', now(), 'Ana', now())`,
  },
  {
    relacao: 'tarefa → quadro',
    daB: 'qua-b',
    daA: 'qua-a',
    sql: (id, ref) => `insert into tarefas (id, org_id, quadro_id, titulo, quem, atualizado_em) values ('${id}', 'org-a', '${ref}', 'Contar estoque', 'Ana', now())`,
  },
  {
    relacao: 'produto → categoria',
    daB: 'cat-b',
    daA: 'cat-a',
    sql: (id, ref) => `insert into produtos (id, org_id, nome, categoria_id, atualizado_em) values ('${id}', 'org-a', 'Saia', '${ref}', now())`,
  },
  {
    relacao: 'categoria → categoria pai (a própria tabela)',
    daB: 'cat-b',
    daA: 'cat-a',
    sql: (id, ref) => `insert into categorias (id, org_id, nome, pai_id) values ('${id}', 'org-a', 'Sub', '${ref}')`,
  },
  {
    // O caso que vira escalada: um acesso da A pendurado no usuário da B.
    relacao: 'acesso → usuário',
    daB: 'usr-b1',
    daA: 'usr-a1',
    sql: (id, ref) => `insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('${id}', 'org-a', '${ref}', 'uni-a1', 'BALCAO')`,
  },
]

describe('a empresa A não aponta para linha da B', () => {
  CASOS.forEach((c, i) => {
    it(`${c.relacao}: recusado com o id da B, aceito com o da A`, async () => {
      const n = 100 + i * 2
      await expect(comoApp(db, 'org-a', (tx) => tx.query(c.sql(`x-${i}-b`, c.daB, n)))).rejects.toThrow(RECUSA)
      await comoApp(db, 'org-a', (tx) => tx.query(c.sql(`x-${i}-a`, c.daA, n + 1)))
      const r = await db.query(`select 1 from ${c.sql(`x`, 'x', 0).match(/insert into (\w+)/)![1]} where id = $1`, [`x-${i}-a`])
      expect(r.rows).toHaveLength(1)
    })
  })

  it('id que não existe em lugar nenhum dá a MESMA recusa — a porta não diz se o id é de alguém', async () => {
    const deOutra = await comoApp(db, 'org-a', (tx) =>
      tx.query(`insert into vendas (id, org_id, unidade_id, numero, cliente_id) values ('o1', 'org-a', 'uni-a1', 900, 'cli-b')`),
    ).catch((e: Error) => e.message)
    const deNinguem = await comoApp(db, 'org-a', (tx) =>
      tx.query(`insert into vendas (id, org_id, unidade_id, numero, cliente_id) values ('o2', 'org-a', 'uni-a1', 901, 'nao-existe')`),
    ).catch((e: Error) => e.message)
    expect(deOutra).toBe(deNinguem)
  })

  it('FK vazia continua valendo (nem toda venda tem cliente)', async () => {
    await comoApp(db, 'org-a', (tx) =>
      tx.query(`insert into vendas (id, org_id, unidade_id, numero, cliente_id) values ('v-sem', 'org-a', 'uni-a1', 902, null)`),
    )
  })
})

describe('UPDATE também não atravessa', () => {
  it('trocar o cliente da venda para um da B: recusado', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) => tx.query(`update vendas set cliente_id = 'cli-b' where id = 'v-a'`)),
    ).rejects.toThrow(RECUSA)
  })

  it('trocar para um cliente da própria A, ou mexer em outra coluna: passa', async () => {
    await comoApp(db, 'org-a', (tx) => tx.query(`update vendas set cliente_id = 'cli-a' where id = 'v-a'`))
    await comoApp(db, 'org-a', (tx) => tx.query(`update vendas set total = 42 where id = 'v-a'`))
    const r = await db.query<{ cliente_id: string; total: string }>(`select cliente_id, total from vendas where id = 'v-a'`)
    expect(r.rows[0]).toMatchObject({ cliente_id: 'cli-a' })
    expect(Number(r.rows[0]!.total)).toBe(42)
  })
})

describe('vale para quem passa por cima do RLS', () => {
  // O `db` direto é o superusuário do PGlite: ignora RLS por completo. Se a
  // regra dependesse de "o pai da B é invisível", aqui ela não valeria.
  it('o admin também não grava venda da A com cliente da B', async () => {
    await expect(
      db.query(`insert into vendas (id, org_id, unidade_id, numero, cliente_id) values ('adm-1', 'org-a', 'uni-a1', 950, 'cli-b')`),
    ).rejects.toThrow(RECUSA)
  })

  it('nem muda a empresa de uma linha deixando a FK apontando para a antiga', async () => {
    await db.exec(`insert into tarefas (id, org_id, quadro_id, titulo, quem, atualizado_em) values ('tar-mud', 'org-a', 'qua-a', 'Mudar', 'Ana', now())`)
    await expect(db.query(`update tarefas set org_id = 'org-b' where id = 'tar-mud'`)).rejects.toThrow(RECUSA)
  })

  it('apagar o pai com ON DELETE SET NULL continua funcionando', async () => {
    await db.exec(`
      insert into clientes (id, org_id, nome, atualizado_em) values ('cli-tmp', 'org-a', 'Temporária', now());
      insert into vendas (id, org_id, unidade_id, numero, cliente_id) values ('v-tmp', 'org-a', 'uni-a1', 960, 'cli-tmp');
      delete from clientes where id = 'cli-tmp';
    `)
    const r = await db.query<{ cliente_id: string | null }>(`select cliente_id from vendas where id = 'v-tmp'`)
    expect(r.rows[0]!.cliente_id).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// NENHUMA RELAÇÃO FICOU DE FORA
// ─────────────────────────────────────────────────────────────

describe('cobertura', () => {
  it('toda FK entre duas tabelas com org_id tem o gatilho, com a coluna certa', async () => {
    const fks = await db.query<{ tabela: string; coluna: string; pai: string }>(`
      select filha.relname as tabela, fcol.attname as coluna, pai.relname as pai
      from pg_constraint k
      join pg_class filha on filha.oid = k.conrelid
      join pg_class pai on pai.oid = k.confrelid
      join pg_attribute fcol on fcol.attrelid = k.conrelid and fcol.attnum = k.conkey[1]
      where k.contype = 'f'
        and exists (select 1 from pg_attribute a where a.attrelid = filha.oid and a.attname = 'org_id')
        and exists (select 1 from pg_attribute a where a.attrelid = pai.oid and a.attname = 'org_id')
    `)
    // Hoje são 56. Se cair muito, a varredura do rls.sql parou de enxergar.
    expect(fks.rows.length).toBeGreaterThanOrEqual(50)

    const gatilhos = await db.query<{ tabela: string; def: string }>(`
      select c.relname as tabela, pg_get_triggerdef(t.oid) as def
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname = 'zz_fk_mesma_empresa'
    `)
    const porTabela = new Map(gatilhos.rows.map((g) => [g.tabela, g.def]))
    const faltando = fks.rows.filter((f) => !porTabela.get(f.tabela)?.includes(`'${f.coluna}', '${f.pai}'`))
    expect(faltando).toEqual([])
  })

  it('orgs não entra: ela não tem org_id, é a própria empresa', async () => {
    const r = await db.query(`select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'orgs' and t.tgname = 'zz_fk_mesma_empresa'`)
    expect(r.rows).toHaveLength(0)
  })

  it('reaplicar o rls.sql não duplica nem quebra nada', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    await db.exec(readFileSync(join(import.meta.dirname, '..', 'prisma', 'sql', 'rls.sql'), 'utf8'))
    const r = await db.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgname = 'zz_fk_mesma_empresa'`)
    const t = await db.query<{ n: number }>(`
      select count(distinct k.conrelid)::int n
      from pg_constraint k
      join pg_class pai on pai.oid = k.confrelid
      where k.contype = 'f'
        and exists (select 1 from pg_attribute a where a.attrelid = k.conrelid and a.attname = 'org_id')
        and exists (select 1 from pg_attribute a where a.attrelid = pai.oid and a.attname = 'org_id')
    `)
    expect(r.rows[0]!.n).toBe(t.rows[0]!.n)
    await expect(comoApp(db, 'org-a', (tx) => tx.query(`update vendas set cliente_id = 'cli-b' where id = 'v-a'`))).rejects.toThrow(RECUSA)
  })
})
