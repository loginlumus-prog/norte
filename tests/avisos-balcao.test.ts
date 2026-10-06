// O sino do balcão (avisos-balcao.ts), com banco de verdade: conta encomenda
// nova do catálogo, pedido da fábrica a caminho e proposta do assistente —
// só da loja aberta, só com o módulo ligado e só para quem pode ver.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: { avisos: typeof import('../src/servidor/avisos-balcao'); banco: typeof import('../src/servidor/banco') }

const DONO: Sessao = { orgId: 'org-s', usuarioId: 'usr-d', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const CAIXA_B: Sessao = { orgId: 'org-s', usuarioId: 'usr-c', nome: 'Caixa B', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-b', expiraEm: null }] }

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  db = await subirBanco()
  await db.exec(`
    insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em) values
      ('org-s', 'Sorveteria', 'sorveteria', 'REDE', 'ATIVA', '{encomenda,fabrica,agente,multiUnidade}', now());
    insert into unidades (id, org_id, nome, eh_deposito, eh_fabrica, ativa, atualizada_em) values
      ('uni-a', 'org-s', 'Loja A', false, false, true, now()),
      ('uni-b', 'org-s', 'Loja B', false, false, true, now()),
      ('uni-f', 'org-s', 'Fábrica', true, true, true, now());
    insert into usuarios (id, org_id, nome, email, atualizado_em) values
      ('usr-d', 'org-s', 'Dona', 'd@s.com', now()), ('usr-c', 'org-s', 'Caixa B', 'c@s.com', now());
    insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
      ('ac-d', 'org-s', 'usr-d', null, 'DONO'), ('ac-c', 'org-s', 'usr-c', 'uni-b', 'BALCAO');
    insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, para, quem, situacao, origem, vista_em, atualizada_em) values
      ('enc-1', 'org-s', 'uni-a', 'Ana', 'bolo', now(), 'Dona', 'ABERTA', 'CATALOGO', null, now()),
      ('enc-2', 'org-s', 'uni-a', 'Bia', 'bolo', now(), 'Dona', 'ABERTA', 'CATALOGO', now(), now()),
      ('enc-3', 'org-s', 'uni-a', 'Cid', 'bolo', now(), 'Dona', 'ABERTA', 'BALCAO', null, now()),
      ('enc-4', 'org-s', 'uni-b', 'Duda', 'bolo', now(), 'Dona', 'ABERTA', 'CATALOGO', null, now());
    insert into agentes (id, org_id, nome, atualizado_em) values ('ag-1', 'org-s', 'Assistente', now());
    insert into pedidos_fabrica (id, org_id, numero, loja_id, fabrica_id, situacao, pedido_por) values
      ('pf-1', 'org-s', 1, 'uni-a', 'uni-f', 'ENVIADO', 'Dona'),
      ('pf-2', 'org-s', 2, 'uni-a', 'uni-f', 'ABERTO', 'Dona');
    insert into propostas_agente (id, org_id, agente_id, poder, resumo, dados, situacao, expira_em) values
      ('pa-1', 'org-s', 'ag-1', 'registrar_compra', 'comprar 10 kg', '{}', 'AGUARDANDO', (now() at time zone 'utc') + interval '1 hour'),
      ('pa-2', 'org-s', 'ag-1', 'registrar_compra', 'velha', '{}', 'AGUARDANDO', (now() at time zone 'utc') - interval '1 hour');
  `)
  const porta = 56000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  m = { avisos: await import('../src/servidor/avisos-balcao'), banco: await import('../src/servidor/banco') }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

describe('o sino do balcão', () => {
  it('na loja A: a encomenda nova do catálogo, o pedido a caminho e a proposta que ainda vale', async () => {
    const r = await m.avisos.avisosDoBalcao(DONO, 'sorveteria', 'uni-a')
    expect(r).toEqual([
      { tipo: 'encomenda', n: 1, texto: 'Encomenda nova do catálogo', href: '/sorveteria/encomendas' },
      { tipo: 'fabrica', n: 1, texto: 'Pedido da fábrica a caminho: conferir e receber', href: '/sorveteria/fabrica/pedir' },
      { tipo: 'assistente', n: 1, texto: 'O assistente espera uma resposta', href: '/sorveteria/agente' },
    ])
  })

  it('a caixa da loja B vê só a encomenda da loja dela, e não o assistente (não configura)', async () => {
    const r = await m.avisos.avisosDoBalcao(CAIXA_B, 'sorveteria', 'uni-b')
    expect(r.map((a) => [a.tipo, a.n])).toEqual([['encomenda', 1]])
  })

  it('módulo desligado não acende', async () => {
    await db.exec(`update orgs set modulos = '{multiUnidade}' where id = 'org-s'`)
    expect(await m.avisos.avisosDoBalcao(DONO, 'sorveteria', 'uni-a')).toEqual([])
  })
})
