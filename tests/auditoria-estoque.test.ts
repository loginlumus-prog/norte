// AUDITORIA (núcleo do estoque e cadastro de produto) — cada `it` prova um
// defeito encontrado (ou confere um fluxo que está certo). Banco de verdade
// (PGlite com RLS), sessão de dona.

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
  composicao: typeof import('../src/servidor/composicao')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-x', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, atualizada_em, configurada_em) values
    ('org-x', 'Sorvetes X', 'sorvetes-x', 'REDE', 'ATIVA', '{multiUnidade}', 10, now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-1', 'org-x', 'Centro', now()),
    ('uni-2', 'org-x', 'Bairro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-dona', 'org-x', 'Dona', 'd@x.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-dona', 'org-x', 'usr-dona', null, 'DONO');

  -- eixos da empresa: Tipo (Unitário/Atacado) e Sabor
  insert into eixos (id, org_id, nome, ordem) values ('ex-tipo', 'org-x', 'Tipo', 0), ('ex-sabor', 'org-x', 'Sabor', 1);
  insert into opcoes (id, org_id, eixo_id, valor, ordem) values
    ('op-un', 'org-x', 'ex-tipo', 'Unitário', 0),
    ('op-at', 'org-x', 'ex-tipo', 'Atacado', 1),
    ('op-choc', 'org-x', 'ex-sabor', 'Choc Africano', 0);

  -- Picolé "Choc Africano": Tipo × Sabor (Sabor com UMA opção só — o eixo a mais)
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, atualizado_em) values
    ('p-pic', 'org-x', 'Choc Africano', 'UN', 5.00, 1.00, now()),
    ('p-pic2', 'org-x', 'Choc Branco', 'UN', 5.00, 1.00, now()),
    ('p-cam', 'org-x', 'Camiseta', 'UN', 50.00, 10.00, now()),
    ('p-kg', 'org-x', 'Sorvete a granel', 'KG', 60.00, 20.00, now()),
    ('p-man', 'org-x', 'Pote', 'UN', 15.00, 5.00, now()),
    ('p-combo', 'org-x', 'Casquinha + Água', 'UN', 9.00, null, now()),
    ('p-cas', 'org-x', 'Casquinha', 'UN', 6.00, 2.00, now());
  insert into produto_eixos (id, org_id, produto_id, eixo_id, ordem) values
    ('pe-1', 'org-x', 'p-pic', 'ex-tipo', 0), ('pe-2', 'org-x', 'p-pic', 'ex-sabor', 1),
    ('pe-3', 'org-x', 'p-pic2', 'ex-tipo', 0), ('pe-4', 'org-x', 'p-pic2', 'ex-sabor', 1);
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-pic-un', 'org-x', 'p-pic', 'CHO001', false),
    ('v-pic-at', 'org-x', 'p-pic', 'CHO002', false),
    ('v-pic2-un', 'org-x', 'p-pic2', 'CHB001', false),
    ('v-pic2-at', 'org-x', 'p-pic2', 'CHB002', false),
    ('v-cam', 'org-x', 'p-cam', 'CAM001', true),
    ('v-kg', 'org-x', 'p-kg', 'SOR001', true),
    ('v-man', 'org-x', 'p-man', 'POT001', true),
    ('v-combo', 'org-x', 'p-combo', 'CAS010', true),
    ('v-cas', 'org-x', 'p-cas', 'CAS001', true);
  insert into variacao_opcoes (id, org_id, variacao_id, opcao_id) values
    ('vo-1', 'org-x', 'v-pic-un', 'op-un'), ('vo-2', 'org-x', 'v-pic-un', 'op-choc'),
    ('vo-3', 'org-x', 'v-pic-at', 'op-at'), ('vo-4', 'org-x', 'v-pic-at', 'op-choc'),
    ('vo-5', 'org-x', 'v-pic2-un', 'op-un'), ('vo-6', 'org-x', 'v-pic2-un', 'op-choc'),
    ('vo-7', 'org-x', 'v-pic2-at', 'op-at'), ('vo-8', 'org-x', 'v-pic2-at', 'op-choc');
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
    composicao: await import('../src/servidor/composicao'),
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
const entrar = async (variacaoId: string, unidadeId: string, quantidade: number) => {
  const r = await m.entrada.registrarEntrada(DONA, { unidadeId, itens: [{ variacaoId, quantidade }] })
  if (!r.ok) throw new Error(r.motivo)
}

describe('[G] o eixo de UMA opção só ("Choc Africano · Sabor")', () => {
  it('[G1] CORRIGIDO: tirar o eixo Sabor (uma opção) com saldo passa — a mesma peça só perde o rótulo', async () => {
    await entrar('v-pic-un', 'uni-1', 40)
    const r = await m.produto.ajustarGrade(DONA, 'p-pic', [
      { eixoId: 'ex-tipo', opcaoIds: ['op-un', 'op-at'] },
      { eixoId: 'ex-sabor', opcaoIds: [] },
    ])
    expect(r).toEqual({ criadas: 0, desativadas: 0, reativadas: 0, apagadas: 0 })
    expect(await num(`select count(*) n from variacao_opcoes where opcao_id = 'op-choc' and variacao_id like 'v-pic-%'`)).toBe(0)
    const ativas = (await db.query<{ codigo: string }>(`select codigo from variacoes where produto_id = 'p-pic' and ativa order by codigo`)).rows.map((x) => x.codigo)
    expect(ativas).toEqual(['CHO001', 'CHO002'])
    expect(await saldo('v-pic-un', 'uni-1')).toBe(40)
    expect(await num(`select count(*) n from produto_eixos where produto_id = 'p-pic'`)).toBe(1)
  })

  it('[G2] CORRIGIDO: sem saldo e com histórico, as etiquetas continuam as mesmas', async () => {
    await entrar('v-pic2-un', 'uni-1', 5)
    const p = await m.estoque.lancarPerda(DONA, { variacaoId: 'v-pic2-un', unidadeId: 'uni-1', quantidade: 5, motivo: 'derreteu no freezer' })
    expect(p.ok).toBe(true)
    const r = await m.produto.ajustarGrade(DONA, 'p-pic2', [
      { eixoId: 'ex-tipo', opcaoIds: ['op-un', 'op-at'] },
      { eixoId: 'ex-sabor', opcaoIds: [] },
    ])
    expect(r).toEqual({ criadas: 0, desativadas: 0, reativadas: 0, apagadas: 0 })
    const ativas = (await db.query<{ codigo: string }>(`select codigo from variacoes where produto_id = 'p-pic2' and ativa order by codigo`)).rows.map((x) => x.codigo)
    expect(ativas).toEqual(['CHB001', 'CHB002'])
  })

  it('[G3] marcar um sabor único num item SEM variação com saldo continua recusado (não dá para adivinhar)', async () => {
    await entrar('v-cam', 'uni-1', 30)
    await expect(m.produto.ajustarGrade(DONA, 'p-cam', [{ eixoId: 'ex-sabor', opcaoIds: ['op-choc'] }])).rejects.toThrow(/Ainda tem saldo/)
  })

  it('[G4] CORRIGIDO: pôr de volta o sabor único num produto que já tem Tipo: a mesma peça ganha o rótulo', async () => {
    await m.produto.ajustarGrade(DONA, 'p-pic', [
      { eixoId: 'ex-tipo', opcaoIds: ['op-un', 'op-at'] },
      { eixoId: 'ex-sabor', opcaoIds: ['op-choc'] },
    ])
    expect(await num(`select count(*) n from variacao_opcoes where opcao_id = 'op-choc' and variacao_id in ('v-pic-un', 'v-pic-at')`)).toBe(2)
    expect(await saldo('v-pic-un', 'uni-1')).toBe(40)
  })

  it('tirar um eixo de VÁRIAS opções com saldo continua recusado (aí é juntar peças diferentes)', async () => {
    await expect(
      m.produto.ajustarGrade(DONA, 'p-pic', [{ eixoId: 'ex-tipo', opcaoIds: [] }]),
    ).rejects.toThrow(/Ainda tem saldo/)
  })
})

describe('[Q] quantidade com mais de 3 casas', () => {
  it('[Q1] CORRIGIDO: 1 kg menos 0,0015 kg — saldo e livro dizem o mesmo', async () => {
    await entrar('v-kg', 'uni-2', 1)
    const p = await m.estoque.lancarPerda(DONA, { variacaoId: 'v-kg', unidadeId: 'uni-2', quantidade: 0.0015, motivo: 'raspa da balança' })
    expect(p.ok).toBe(true)
    const livro = await num(`select sum(quantidade) s from movimentos_estoque where variacao_id = 'v-kg' and unidade_id = 'uni-2'`)
    expect(await saldo('v-kg', 'uni-2')).toBe(livro)
    expect(await m.estoque.conferirSaldos(DONA, 'uni-2')).toEqual([])
  })

  it('[Q2] CORRIGIDO: tirar 0,0005 de 1 — saldo e livro concordam', async () => {
    await entrar('v-kg', 'uni-1', 1)
    await m.estoque.lancarPerda(DONA, { variacaoId: 'v-kg', unidadeId: 'uni-1', quantidade: 0.0005, motivo: 'raspa da balança' })
    const livro = await num(`select sum(quantidade) s from movimentos_estoque where variacao_id = 'v-kg' and unidade_id = 'uni-1'`)
    expect(await saldo('v-kg', 'uni-1')).toBe(livro)
  })
})

describe('[P] cadastro mexendo no que está na prateleira', () => {
  it('[P1] CORRIGIDO: "Excluir produto" com 12 na prateleira é recusado e diz onde está', async () => {
    await entrar('v-man', 'uni-1', 12)
    const r = await m.produto.excluirProduto(DONA, 'p-man')
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.motivo).toMatch(/Centro: 12/)
    expect(await num(`select count(*) n from produtos where id = 'p-man' and ativo`)).toBe(1)
  })

  it('[P2] CORRIGIDO: virar "serviço" com saldo é recusado', async () => {
    await entrar('v-cas', 'uni-2', 20)
    const r = await m.produto.editarProduto(DONA, 'p-cas', { servico: true })
    expect(r).toMatchObject({ ok: false })
    expect(await num(`select count(*) n from produtos where id = 'p-cas' and not servico`)).toBe(1)
  })

  it('[P3] CORRIGIDO: entrada no próprio item composto é recusada (entra nos componentes)', async () => {
    await m.composicao.definirComposicao(DONA, 'v-combo', [{ componenteId: 'v-cas', quantidade: 1 }])
    const r = await m.entrada.registrarEntrada(DONA, { unidadeId: 'uni-1', itens: [{ variacaoId: 'v-combo', quantidade: 50 }] })
    expect(r).toMatchObject({ ok: false })
    expect(await saldo('v-combo', 'uni-1')).toBe(0)
  })

  it('[P4] CORRIGIDO: virar composto com saldo próprio é recusado', async () => {
    await entrar('v-kg', 'uni-2', 2)
    await entrar('v-man', 'uni-2', 8)
    await expect(m.composicao.definirComposicao(DONA, 'v-man', [{ componenteId: 'v-kg', quantidade: 0.1 }])).rejects.toThrow(/estoque próprio/)
  })
})

describe('fluxos conferidos', () => {
  it('correto: transferência é atômica, recusa a mesma loja e fecha com o livro', async () => {
    expect(await m.estoque.transferir(DONA, { variacaoId: 'v-pic-un', deUnidadeId: 'uni-1', paraUnidadeId: 'uni-1', quantidade: 1 })).toMatchObject({ ok: false, motivo: 'mesma_unidade' })
    const r = await m.estoque.transferir(DONA, { variacaoId: 'v-pic-un', deUnidadeId: 'uni-1', paraUnidadeId: 'uni-2', quantidade: 15 })
    expect(r).toMatchObject({ ok: true, saldoOrigem: 25, saldoDestino: 15 })
    const div = (await m.estoque.conferirSaldos(DONA)).filter((d) => d.variacao_id !== 'v-kg')
    expect(div).toEqual([])
  })
})
