// Sobe um Postgres de verdade dentro do processo do teste (PGlite = Postgres
// compilado para WASM). Sem Docker, sem banco hospedado, roda em qualquer
// máquina e em CI.
//
// A ARMADILHA que este arquivo existe para evitar:
// superusuário do Postgres IGNORA RLS — inclusive com FORCE ROW LEVEL SECURITY.
// Um teste rodando como superusuário passaria sem provar absolutamente nada.
// Por isso todo acesso de teste passa por `comoApp`, que troca para um papel
// sem privilégio antes de consultar.

import { PGlite } from '@electric-sql/pglite'
import type { Transaction } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(import.meta.dirname, '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

/** Papel da aplicação: sem privilégio, sujeito a RLS. */
export const PAPEL_APP = 'app_norte'

export async function subirBanco(): Promise<PGlite> {
  const db = new PGlite()

  // 1. tabelas (geradas do schema.prisma — fonte única da verdade)
  await db.exec(ler('prisma/sql/tabelas.sql'))

  // 2. o papel da aplicação, sem privilégio nenhum de sistema
  await db.exec(`
    create role ${PAPEL_APP} nologin;
    grant usage on schema public to ${PAPEL_APP};
    grant select, insert, update, delete
      on all tables in schema public to ${PAPEL_APP};
  `)

  // 3. as políticas de isolamento
  await db.exec(ler('prisma/sql/rls.sql'))

  return db
}

/**
 * Roda `fn` como a aplicação rodaria: papel sem privilégio + a org da
 * requisição, tudo preso a uma transação (nada vaza para a próxima chamada).
 *
 * orgId = null simula requisição sem org definida — o caso do bug esquecido.
 */
export async function comoApp<T>(
  db: PGlite,
  orgId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${PAPEL_APP}`)
    await tx.query(`select set_config('app.org_id', $1, true)`, [orgId ?? ''])
    return fn(tx)
  })
}

/** Popula duas empresas vizinhas. Roda como dono, antes das travas valerem. */
export async function semear(db: PGlite) {
  await db.exec(`
    insert into orgs (id, nome, slug, plano, situacao, criada_em, atualizada_em) values
      ('org-a', 'Comércio Exemplo',  'exemplo',  'BALCAO_AGENTE', 'ATIVA', now(), now()),
      ('org-b', 'Empresa Vizinha', 'vizinha',    'REDE',          'ATIVA', now(), now());

    insert into unidades (id, org_id, nome, ativa, eh_deposito, criada_em, atualizada_em) values
      ('uni-a1', 'org-a', 'Loja Centro',     true, false, now(), now()),
      ('uni-b1', 'org-b', 'Loja Sul',   true, false, now(), now()),
      ('uni-b2', 'org-b', 'Deposito',        true, true,  now(), now());

    insert into usuarios (id, org_id, nome, email, ativo, criado_em, atualizado_em) values
      ('usr-a1', 'org-a', 'Ana',   'ana@exemplo.com', true, now(), now()),
      ('usr-b1', 'org-b', 'Vizinho', 'vizinho@exemplo.com',   true, now(), now());

    insert into acessos (id, org_id, usuario_id, unidade_id, papel, criado_em) values
      ('acs-a1', 'org-a', 'usr-a1', 'uni-a1', 'DONO', now()),
      ('acs-b1', 'org-b', 'usr-b1', 'uni-b1', 'DONO', now());

    insert into auditoria (id, org_id, unidade_id, usuario_id, quem, autor, acao, valor, criado_em) values
      ('aud-a1', 'org-a', 'uni-a1', 'usr-a1', 'Ana',   'PESSOA', 'caixa.fechou',          1250.00, now()),
      ('aud-b1', 'org-b', 'uni-b1', 'usr-b1', 'Vizinho', 'PESSOA', 'produto.preco.alterou',  89.90, now());
  `)
}
