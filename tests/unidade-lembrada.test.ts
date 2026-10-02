// A loja escolhida não se perde no clique do menu.
//
// O dono escolhia a loja do shopping no Estoque, clicava em Produtos e caía
// em "Todas as unidades": os links do menu não levam a loja, e a escolha só
// vivia no endereço. Agora, sem nada no endereço, vale a última escolhida
// (cookie da empresa) — sempre conferida contra o que a pessoa alcança.
//
// Banco de verdade (PGlite exposto numa porta), como em
// auditoria-relatorios-logica.test.ts; o `next/headers` é de mentira só
// para entregar o cookie que o navegador mandaria.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { TODAS_AS_UNIDADES, cookieDaUnidade, pedidaOuLembrada } from '../src/servidor/unidade-lembrada'

const pote = vi.hoisted(() => ({ cookies: new Map<string, string>() }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => {
      const v = pote.cookies.get(nome)
      return v === undefined ? undefined : { name: nome, value: v }
    },
  }),
}))

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  unidade: typeof import('../src/servidor/unidade')
}

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-l', 'Loja L', 'loja-l', 'REDE', 'ATIVA', '{multiUnidade}', now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('u-a', 'org-l', 'Loja A', false, now()),
    ('u-b', 'org-l', 'Loja B', false, now()),
    ('u-c', 'org-l', 'Loja C', false, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-l', 'Dona', 'dona@l.com', now()),
    ('usr-ger',  'org-l', 'Gerente', 'ger@l.com', now()),
    ('usr-bal',  'org-l', 'Balcao', 'bal@l.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-l', 'usr-dona', null, 'DONO'),
    ('ac-ga',   'org-l', 'usr-ger', 'u-a', 'GERENTE'),
    ('ac-gb',   'org-l', 'usr-ger', 'u-b', 'GERENTE'),
    ('ac-bal',  'org-l', 'usr-bal', 'u-c', 'BALCAO');
`

const sessao = (usuarioId: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-l',
  usuarioId,
  nome: usuarioId,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONA = sessao('usr-dona', [{ papel: 'DONO', unidadeId: null }])
const GERENTE = sessao('usr-ger', [
  { papel: 'GERENTE', unidadeId: 'u-a' },
  { papel: 'GERENTE', unidadeId: 'u-b' },
])
const BALCAO = sessao('usr-bal', [{ papel: 'BALCAO', unidadeId: 'u-c' }])

const EMPRESA = { slug: 'loja-l', modulos: ['multiUnidade'] }
const lembrar = (valor: string) => pote.cookies.set(cookieDaUnidade('loja-l'), valor)

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    unidade: await import('../src/servidor/unidade'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

beforeEach(() => pote.cookies.clear())

describe('pedidaOuLembrada', () => {
  it('o endereço manda; sem endereço, vale a lembrada', () => {
    expect(pedidaOuLembrada('u-a', 'u-b')).toBe('u-a')
    expect(pedidaOuLembrada(undefined, 'u-b')).toBe('u-b')
    expect(pedidaOuLembrada('', 'u-b')).toBe('u-b')
    expect(pedidaOuLembrada(undefined, undefined)).toBeUndefined()
  })

  it('cookie comprido demais é ignorado', () => {
    expect(pedidaOuLembrada(undefined, 'x'.repeat(65))).toBeUndefined()
  })
})

describe('escolherUnidade com a loja lembrada', () => {
  it('sem nada no endereço, abre na loja escolhida antes (o clique no menu)', async () => {
    lembrar('u-b')
    const e = await m.unidade.escolherUnidade(DONA, EMPRESA, undefined, 'estoque.ver')
    expect(e.unidadeId).toBe('u-b')
    expect(e.ids).toEqual(['u-b'])
    expect(e.titulo).toBe('Loja B')
  })

  it('o endereço vence o cookie: o link que o gerente manda abre igual para todos', async () => {
    lembrar('u-b')
    const e = await m.unidade.escolherUnidade(DONA, EMPRESA, 'u-a', 'estoque.ver')
    expect(e.unidadeId).toBe('u-a')
  })

  it('"Todas as unidades" também é lembrada', async () => {
    lembrar(TODAS_AS_UNIDADES)
    const e = await m.unidade.escolherUnidade(DONA, EMPRESA, undefined, 'estoque.ver')
    expect(e.unidadeId).toBeNull()
    expect(e.ids.sort()).toEqual(['u-a', 'u-b', 'u-c'])
  })

  it('cookie com loja que a pessoa não alcança cai no consolidado dela — nunca abre a loja', async () => {
    lembrar('u-c')
    const e = await m.unidade.escolherUnidade(GERENTE, EMPRESA, undefined, 'estoque.ver')
    expect(e.unidadeId).toBeNull()
    expect(e.ids.sort()).toEqual(['u-a', 'u-b'])
  })

  it('cookie de outra coisa qualquer (loja de outra empresa, lixo) também', async () => {
    lembrar('u-de-outra-empresa')
    const e = await m.unidade.escolherUnidade(DONA, EMPRESA, undefined, 'estoque.ver')
    expect(e.unidadeId).toBeNull()
  })

  it('quem alcança uma loja só fica sempre nela, lembrada ou não (o balcão)', async () => {
    lembrar('u-a')
    const e = await m.unidade.escolherUnidade(BALCAO, EMPRESA, undefined, 'venda.criar')
    expect(e.unidadeId).toBe('u-c')
    expect(e.mostrarSeletor).toBe(false)
    lembrar(TODAS_AS_UNIDADES)
    expect((await m.unidade.escolherUnidade(BALCAO, EMPRESA, undefined, 'venda.criar')).unidadeId).toBe('u-c')
  })

  it('sem o endereço da empresa (quem chama sem slug), não lê cookie', async () => {
    lembrar('u-b')
    const e = await m.unidade.escolherUnidade(DONA, { modulos: ['multiUnidade'] }, undefined, 'estoque.ver')
    expect(e.unidadeId).toBeNull()
  })

  it('com o módulo de várias lojas desligado, o cookie não muda nada', async () => {
    lembrar('u-b')
    const e = await m.unidade.escolherUnidade(DONA, { slug: 'loja-l', modulos: [] }, undefined, 'estoque.ver')
    expect(e.mostrarSeletor).toBe(false)
    expect(e.unidadeId).toBe('u-a')
  })
})
