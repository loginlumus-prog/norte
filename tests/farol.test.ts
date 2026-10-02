// O Farol, com banco de verdade e a IA de mentira: só escreve quem contratou,
// cada peça sai da carteira, o crédito do mês cai uma vez por marca, e o que
// vai para a IA é o negócio em números — nunca nome de cliente.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

const ia = vi.hoisted(() => ({ ultimoSistema: '', chamadas: 0 }))
vi.mock('../src/servidor/ia', async (original) => {
  const real = await original<typeof import('../src/servidor/ia')>()
  return {
    ...real,
    temChaveIA: () => true,
    perguntar: async (p: { sistema: string }) => {
      ia.ultimoSistema = p.sistema
      ia.chamadas++
      return { texto: '## Roteiro\n1. Gancho: o picolé derretendo no calor.', entrada: 3000, saida: 800 }
    },
  }
})

let db: PGlite
let servidor: PGLiteSocketServer
let m: { farol: typeof import('../src/servidor/farol'); banco: typeof import('../src/servidor/banco') }

const sessao = (orgId: string): Sessao => ({ orgId, usuarioId: `dono-${orgId}`, nome: 'Dono', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] })
const COM = sessao('org-c')
const SEM = sessao('org-s')

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em, configurada_em) values
    ('org-c', 'Gelados', 'gelados', 'BALCAO', 'ATIVA', '{farol}', 0, now(), now()),
    ('org-s', 'Sem Farol', 'sem-farol', 'BALCAO', 'ATIVA', '{}', 5000, now(), now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('dono-org-c', 'org-c', 'Dono', 'd@c.com', now()), ('dono-org-s', 'org-s', 'Dono', 'd@s.com', now());
  insert into unidades (id, org_id, nome, bairro, cidade, atualizada_em) values
    ('u-c', 'org-c', 'Praia', 'Itapuã', 'Salvador', now());
  insert into clientes (id, org_id, nome, telefone, atualizado_em) values
    ('cli-1', 'org-c', 'Maria Secreta da Silva', '71999990000', now());
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id, criada_em) values
    ('v1', 'org-c', 'u-c', 1, 'CONCLUIDA', 20, 'cli-1', now() - interval '2 days');
  insert into venda_itens (id, org_id, venda_id, descricao, quantidade, preco_unit, total) values
    ('vi1', 'org-c', 'v1', 'Picolé de coco', 10, 2, 20);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 44000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = { farol: await import('../src/servidor/farol'), banco: await import('../src/servidor/banco') }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows

describe('o Farol', () => {
  let marcaId = ''

  it('só existe para quem contratou', async () => {
    await expect(m.farol.salvarMarca(SEM, null, { nome: 'Outra' })).rejects.toThrow(/não está contratado/)
  })

  it('cadastra a marca, sem o @ que a pessoa digitar', async () => {
    const r = await m.farol.salvarMarca(COM, null, { nome: 'Gelados', instagram: '@gelados.ssa', nicho: 'sorveteria', tom: 'leve' })
    marcaId = r.id
    const [marca] = await m.farol.listarMarcas(COM)
    expect(marca).toMatchObject({ nome: 'Gelados', instagram: 'gelados.ssa' })
  })

  it('o crédito do mês cai uma vez, pelas marcas ativas', async () => {
    expect(await m.farol.garantirCreditoDoFarol('org-c')).toBe(20000)
    expect(await m.farol.garantirCreditoDoFarol('org-c')).toBe(0)
    const [o] = await linhas<{ credito_ia_cent: number }>(`select credito_ia_cent from orgs where id = 'org-c'`)
    expect(o!.credito_ia_cent).toBe(20000)
  })

  it('escreve a peça, guarda como rascunho e desconta da carteira', async () => {
    const p = await m.farol.gerarPeca(COM, { marcaId, tipo: 'ROTEIRO', pedido: 'picolé de coco no calor' })
    expect(p.conteudo).toContain('Gancho')
    expect(p.custoCent).toBeGreaterThan(0)
    const [o] = await linhas<{ credito_ia_cent: number }>(`select credito_ia_cent from orgs where id = 'org-c'`)
    expect(o!.credito_ia_cent).toBe(20000 - p.custoCent)
    const [peca] = await m.farol.listarPecas(COM, marcaId)
    expect(peca).toMatchObject({ tipo: 'ROTEIRO', situacao: 'RASCUNHO' })
  })

  it('a IA recebe o negócio em números, nunca o nome nem o telefone de cliente', () => {
    expect(ia.ultimoSistema).toContain('Picolé de coco')
    expect(ia.ultimoSistema).toContain('Itapuã')
    expect(ia.ultimoSistema).not.toContain('Maria Secreta')
    expect(ia.ultimoSistema).not.toContain('99999')
  })

  it('crédito zerado: não escreve', async () => {
    await db.exec(`update orgs set credito_ia_cent = 0 where id = 'org-c'`)
    const antes = ia.chamadas
    await expect(m.farol.gerarPeca(COM, { marcaId, tipo: 'LEGENDA' })).rejects.toThrow(/crédito de IA acabou/)
    expect(ia.chamadas).toBe(antes)
  })

  it('a peça se edita, aprova e marca publicada', async () => {
    const [peca] = await m.farol.listarPecas(COM, marcaId)
    await m.farol.atualizarPeca(COM, peca!.id, { conteudo: 'editado', situacao: 'PUBLICADA', para: '2026-10-10' })
    const [lida] = await m.farol.listarPecas(COM, marcaId)
    expect(lida).toMatchObject({ conteudo: 'editado', situacao: 'PUBLICADA' })
  })
})
