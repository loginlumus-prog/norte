// A gestão do crediário (C19), o livro de assinaturas (C20), o que a empresa
// dá a mais ao balcão (C21) e a data corrigida da venda (C23) — com banco de
// verdade (PGlite numa porta, como recibos-banco.test.ts): tudo passa pelo
// comoOrg, com papel sem privilégio e RLS valendo.
//
// O que se prova aqui:
//   • o Balcão ganha estoque e cadastro SÓ com a chave da empresa ligada, e
//     nunca preço; quem pode só pela empresa assina sempre;
//   • a chave do PIN nas exceções: desligada não pede, ligada pede o PIN de
//     QUEM FAZ (sangria, cancelar, baixa fora, corrigir estoque, data), marca
//     a linha do livro como assinada, e só liga com a equipe toda com PIN;
//   • a contagem que mudou no meio é recusada;
//   • juntar fichas leva tudo para a que fica, pede PIN sempre, não atravessa
//     empresa e não passa por loja que quem junta não cuida;
//   • cobrança pausada sai de "quem cobrar"; dívida lançada não é receita;
//     "quitou tudo" dá baixa no carnê inteiro fora do caixa;
//   • corrigir a data muda o dia do fato e não toca no caixa.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import { pode, soPelaEmpresa, unidadesQuePodem, SemPermissao, type Sessao } from '../src/servidor/permissao'
import { avisosDeMesPassado } from '../src/servidor/venda-data'
import { comNota, lerNotas } from '../src/servidor/crediario-gestao'
import { motivoServe } from '../src/servidor/excecoes'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  autorizacao: typeof import('../src/servidor/autorizacao')
  caixa: typeof import('../src/servidor/caixa')
  venda: typeof import('../src/servidor/venda')
  vendaData: typeof import('../src/servidor/venda-data')
  recibos: typeof import('../src/servidor/recibos')
  crediario: typeof import('../src/servidor/crediario')
  gestao: typeof import('../src/servidor/crediario-gestao')
  estoque: typeof import('../src/servidor/estoque')
  produto: typeof import('../src/servidor/produto')
  livro: typeof import('../src/servidor/livro-assinaturas')
  auditoria: typeof import('../src/servidor/auditoria')
  fin: typeof import('../src/servidor/financeiro')
  senha: typeof import('../src/servidor/senha')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-dona', nome: 'Dona Lia', acessos: [{ papel: 'DONO', unidadeId: null }] }
const GER: Sessao = { orgId: 'org-a', usuarioId: 'usr-ger', nome: 'Gil Gerente', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-a1' }] }
const VEND: Sessao = { orgId: 'org-a', usuarioId: 'usr-vend', nome: 'Vera Vendedora', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a1' }] }
const VEND_AMPLA: Sessao = { ...VEND, balcaoAmpliado: true }
const BIA: Sessao = { orgId: 'org-b', usuarioId: 'usr-bia', nome: 'Bia', acessos: [{ papel: 'DONO', unidadeId: null }] }

const AGORA = new Date('2026-10-10T12:00:00-03:00')

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em) values
    ('org-a', 'Loja Exemplo', 'exemplo', 'REDE', 'ATIVA', '{crediario,multiUnidade}', now()),
    ('org-b', 'Loja Vizinha', 'vizinha', 'REDE', 'ATIVA', '{crediario}', now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro', now()),
    ('uni-a2', 'org-a', 'Bairro', now()),
    ('uni-b1', 'org-b', 'Vizinha', now());
  insert into usuarios (id, org_id, nome, email, senha_hash, sessoes_desde, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona Lia', 'dona@a.com', 'x', '2026-01-01', now()),
    ('usr-ger', 'org-a', 'Gil Gerente', 'gil@a.com', 'x', '2026-01-01', now()),
    ('usr-vend', 'org-a', 'Vera Vendedora', 'vera@a.com', 'x', '2026-01-01', now()),
    ('usr-cont', 'org-a', 'Caio Contador', 'caio@a.com', 'x', '2026-01-01', now()),
    ('usr-bia', 'org-b', 'Bia', 'bia@b.com', 'x', '2026-01-01', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-ger', 'org-a', 'usr-ger', 'uni-a1', 'GERENTE'),
    ('ac-vend', 'org-a', 'usr-vend', 'uni-a1', 'BALCAO'),
    ('ac-cont', 'org-a', 'usr-cont', null, 'CONTADOR'),
    ('ac-bia', 'org-b', 'usr-bia', null, 'DONO');
  insert into clientes (id, org_id, nome, documento, telefone, pontos, ofertas_whatsapp, atualizado_em) values
    ('cli-maria', 'org-a', 'Maria Souza', '52998224725', '71999990000', 30, 'SIM', now()),
    ('cli-maria2', 'org-a', 'Maria Souza', null, '71988887777', 12, 'NAO', now()),
    ('cli-joana', 'org-a', 'Joana Lima', null, null, 0, 'NAO_PERGUNTADO', now()),
    ('cli-bairro', 'org-a', 'Rita Bairro', null, null, 0, 'NAO_PERGUNTADO', now()),
    ('cli-b', 'org-b', 'Cliente Vizinha', null, null, 0, 'NAO_PERGUNTADO', now());
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id, criada_em) values
    ('v-m1', 'org-a', 'uni-a1', 10, 'CONCLUIDA', 200, 'cli-maria', '2026-08-10T15:00:00Z'),
    ('v-m2', 'org-a', 'uni-a1', 11, 'CONCLUIDA', 100, 'cli-maria2', '2026-08-20T15:00:00Z'),
    ('v-j', 'org-a', 'uni-a1', 12, 'CONCLUIDA', 100, 'cli-joana', '2026-08-10T15:00:00Z'),
    ('v-r', 'org-a', 'uni-a2', 1, 'CONCLUIDA', 100, 'cli-bairro', '2026-08-10T15:00:00Z'),
    ('v-cancela', 'org-a', 'uni-a1', 13, 'CONCLUIDA', 50, null, '2026-10-10T13:00:00Z'),
    ('v-b', 'org-b', 'uni-b1', 1, 'CONCLUIDA', 100, 'cli-b', '2026-08-10T15:00:00Z');
  update unidades set proxima_venda = 20 where id = 'uni-a1';
  insert into pagamentos (id, org_id, venda_id, forma, valor) values
    ('pg-cancela', 'org-a', 'v-cancela', 'PIX', 50);
  insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
    ('pm1', 'org-a', 'v-m1', 'cli-maria', 'uni-a1', 1, 2, '2026-09-10', 100),
    ('pm2', 'org-a', 'v-m1', 'cli-maria', 'uni-a1', 2, 2, '2026-11-10', 100),
    ('pm3', 'org-a', 'v-m2', 'cli-maria2', 'uni-a1', 1, 1, '2026-09-20', 100),
    ('pj1', 'org-a', 'v-j', 'cli-joana', 'uni-a1', 1, 2, '2026-09-10', 50),
    ('pj2', 'org-a', 'v-j', 'cli-joana', 'uni-a1', 2, 2, '2026-10-30', 50),
    ('pr1', 'org-a', 'v-r', 'cli-bairro', 'uni-a2', 1, 1, '2026-09-10', 100);
  insert into vales (id, org_id, codigo, cliente_id, unidade_id, valor, saldo, quem) values
    ('vale-m2', 'org-a', 'ABC123', 'cli-maria2', 'uni-a1', 30, 30, 'Gil');
  insert into movimentos_pontos (id, org_id, cliente_id, tipo, pontos, saldo_depois, quem) values
    ('mp-m2', 'org-a', 'cli-maria2', 'GANHOU', 12, 12, 'Gil');
  insert into optout_whatsapp (id, org_id, telefone, origem) values ('opt-m2', 'org-a', '7188887777', 'parar');
  insert into produtos (id, org_id, nome, preco_vista, atualizado_em) values ('prod-1', 'org-a', 'Blusa', 50, now());
  insert into variacoes (id, org_id, produto_id, codigo) values ('var-1', 'org-a', 'prod-1', 'BLU001');
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values ('est-1', 'org-a', 'var-1', 'uni-a1', 5, now());
`

const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const um = async <T,>(sql: string, p: unknown[] = []) => (await linhas<T>(sql, p))[0]!
const PIN = { dona: '4826', ger: '4821', vend: '7395' }
let caixaId = ''

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
    autorizacao: await import('../src/servidor/autorizacao'),
    caixa: await import('../src/servidor/caixa'),
    venda: await import('../src/servidor/venda'),
    vendaData: await import('../src/servidor/venda-data'),
    recibos: await import('../src/servidor/recibos'),
    crediario: await import('../src/servidor/crediario'),
    gestao: await import('../src/servidor/crediario-gestao'),
    estoque: await import('../src/servidor/estoque'),
    produto: await import('../src/servidor/produto'),
    livro: await import('../src/servidor/livro-assinaturas'),
    auditoria: await import('../src/servidor/auditoria'),
    fin: await import('../src/servidor/financeiro'),
    senha: await import('../src/servidor/senha'),
  }
  // A gerente e a vendedora já têm PIN; a dona ainda não.
  for (const [id, pin] of [['usr-ger', PIN.ger], ['usr-vend', PIN.vend]] as const) {
    await db.query(`update usuarios set pin_hash = $1 where id = $2`, [await m.senha.guardarSenha(`pin:${id}:${pin}`), id])
  }
  const ab = await m.caixa.abrirCaixa(DONA, 'uni-a1', 100)
  expect(ab.ok).toBe(true)
  if (ab.ok) caixaId = ab.caixaId
  await db.exec(`
    insert into vendas (id, org_id, unidade_id, caixa_id, numero, situacao, total, criada_em) values
      ('v-data', 'org-a', 'uni-a1', '${caixaId}', 14, 'CONCLUIDA', 80, '2026-10-09T18:30:00Z');
    insert into pagamentos (id, org_id, venda_id, forma, valor) values ('pg-data', 'org-a', 'v-data', 'DINHEIRO', 80);
  `)
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const ligarPin = (ligado: boolean) => db.query(`update orgs set pin_nas_excecoes = $1 where id = 'org-a'`, [ligado])

// ─────────────────────────────────────────────────────────────
describe('o que a empresa dá a mais ao balcão (C21)', () => {
  it('sem a chave, o Balcão é o de sempre; com ela, corrige estoque e cadastra — nunca preço', () => {
    expect(pode(VEND, 'estoque.ajustar', 'uni-a1')).toBe(false)
    expect(pode(VEND, 'produto.cadastrar', 'uni-a1')).toBe(false)
    expect(pode(VEND_AMPLA, 'estoque.ajustar', 'uni-a1')).toBe(true)
    expect(pode(VEND_AMPLA, 'produto.cadastrar', 'uni-a1')).toBe(true)
    expect(pode(VEND_AMPLA, 'estoque.ajustar', 'uni-a2')).toBe(false)
    expect(pode(VEND_AMPLA, 'produto.preco')).toBe(false)
    expect(pode(VEND_AMPLA, 'produto.editar')).toBe(false)
    expect(unidadesQuePodem(VEND_AMPLA, 'produto.cadastrar')).toEqual(['uni-a1'])
    // A chave não muda os outros papéis, e a gerente cadastra pelo papel.
    expect(pode({ ...GER, balcaoAmpliado: true }, 'empresa.configurar')).toBe(false)
    expect(pode(GER, 'produto.cadastrar', 'uni-a1')).toBe(true)
    expect(soPelaEmpresa(VEND_AMPLA, 'estoque.ajustar', 'uni-a1')).toBe(true)
    expect(soPelaEmpresa({ ...GER, balcaoAmpliado: true }, 'estoque.ajustar', 'uni-a1')).toBe(false)
  })

  it('a vendedora corrige o estoque só com a chave, e sempre assina com o PIN dela', async () => {
    await expect(m.estoque.corrigirPeloContado(VEND, { variacaoId: 'var-1', unidadeId: 'uni-a1', contado: 4, saldoVisto: 5, motivo: 'contei a arara' })).rejects.toThrow(SemPermissao)
    const sem = await m.estoque.corrigirPeloContado(VEND_AMPLA, { variacaoId: 'var-1', unidadeId: 'uni-a1', contado: 4, saldoVisto: 5, motivo: 'contei a arara' })
    expect(sem).toMatchObject({ ok: false, motivo: 'assinatura' })
    const errado = await m.estoque.corrigirPeloContado(VEND_AMPLA, { variacaoId: 'var-1', unidadeId: 'uni-a1', contado: 4, saldoVisto: 5, motivo: 'contei a arara', pin: PIN.ger })
    expect(errado).toMatchObject({ ok: false, motivo: 'assinatura' })
    const r = await m.estoque.corrigirPeloContado(VEND_AMPLA, { variacaoId: 'var-1', unidadeId: 'uni-a1', contado: 4, saldoVisto: 5, motivo: 'contei a arara', pin: PIN.vend })
    expect(r).toEqual({ ok: true, saldo: 4, antes: 5 })
    const livro = await um<{ assinado: boolean; quem: string }>(`select assinado, quem from auditoria where acao = 'estoque.ajustou' order by criado_em desc limit 1`)
    expect(livro).toEqual({ assinado: true, quem: 'Vera Vendedora' })
  })

  it('o número que mudou enquanto contava é recusado, com o número novo', async () => {
    // A tela mostrava 5; o banco já está em 4 (a correção de cima).
    const r = await m.estoque.corrigirPeloContado(GER, { variacaoId: 'var-1', unidadeId: 'uni-a1', contado: 3, saldoVisto: 5, motivo: 'contei a arara' })
    expect(r).toMatchObject({ ok: false, motivo: 'mudou', saldo: 4 })
    expect(Number((await um<{ quantidade: string }>(`select quantidade from estoque where id = 'est-1'`)).quantidade)).toBe(4)
    // A gerente, com a chave do PIN desligada, não assina.
    const ok = await m.estoque.corrigirPeloContado(GER, { variacaoId: 'var-1', unidadeId: 'uni-a1', contado: 3, saldoVisto: 4, motivo: 'contei a arara' })
    expect(ok).toEqual({ ok: true, saldo: 3, antes: 4 })
  })

  it('a vendedora cadastra produto (só na loja dela, assinando) e não muda o preço depois', async () => {
    const dados = { nome: 'Saia midi', medida: 'UN' as const, precoVista: 120, vendidoEm: ['uni-a1'] }
    await expect(m.produto.criarProduto(VEND, dados)).rejects.toThrow(SemPermissao)
    expect(await m.produto.criarProduto(VEND_AMPLA, dados)).toMatchObject({ ok: false, precisaPin: true })
    expect(await m.produto.criarProduto(VEND_AMPLA, { ...dados, vendidoEm: [] }, [], PIN.vend)).toMatchObject({ ok: false, motivo: m.produto.MOTIVO_FORA_DO_ALCANCE })
    const r = await m.produto.criarProduto(VEND_AMPLA, dados, [], PIN.vend)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = await um<{ preco_vista: string; vendido_em: string[] }>(`select preco_vista, vendido_em from produtos where id = $1`, [r.produtoId])
    expect(Number(p.preco_vista)).toBe(120)
    expect(p.vendido_em).toEqual(['uni-a1'])
    expect((await um<{ assinado: boolean }>(`select assinado from auditoria where acao = 'produto.criou' and alvo_id = $1`, [r.produtoId])).assinado).toBe(true)
    await expect(m.produto.editarProduto(VEND_AMPLA, r.produtoId, { precoVista: 99 })).rejects.toThrow(SemPermissao)
    // A gerente cadastra como sempre, sem PIN.
    expect((await m.produto.criarProduto(GER, { ...dados, nome: 'Saia longa' })).ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
describe('o livro de assinaturas (C20)', () => {
  it('a chave só liga com a equipe toda com PIN — e mostra quem falta', async () => {
    const faltam = await m.autorizacao.quemFaltaPin('org-a')
    // O contador só lê: não faz exceção, não entra na conta.
    expect(faltam.map((f) => f.nome)).toEqual(['Dona Lia'])
    const r = await m.livro.mudarPinNasExcecoes(DONA, true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('Dona Lia')
    await expect(m.livro.mudarPinNasExcecoes(GER, true)).rejects.toThrow(SemPermissao)
    await db.query(`update usuarios set pin_hash = $1 where id = 'usr-dona'`, [await m.senha.guardarSenha(`pin:usr-dona:${PIN.dona}`)])
    expect(await m.livro.mudarPinNasExcecoes(DONA, true)).toEqual({ ok: true })
    expect((await m.livro.situacaoDasAssinaturas(DONA)).pinNasExcecoes).toBe(true)
    await ligarPin(false)
  })

  it('desligada: a sangria passa sem PIN e o livro não marca assinado', async () => {
    await m.caixa.movimentarCaixa(VEND, caixaId, 'SANGRIA', 10, 'Depósito no banco')
    const l = await um<{ assinado: boolean }>(`select assinado from auditoria where acao = 'caixa.sangria' order by criado_em desc limit 1`)
    expect(l.assinado).toBe(false)
  })

  it('ligada: sangria e suprimento pedem o PIN de QUEM FAZ — o da gerente não serve para a vendedora', async () => {
    await ligarPin(true)
    await expect(m.caixa.movimentarCaixa(VEND, caixaId, 'SANGRIA', 10, 'Depósito no banco')).rejects.toBeInstanceOf(m.autorizacao.PinNecessario)
    await expect(m.caixa.movimentarCaixa(VEND, caixaId, 'SANGRIA', 10, 'Depósito no banco', PIN.ger)).rejects.toBeInstanceOf(m.autorizacao.PinNecessario)
    await m.caixa.movimentarCaixa(VEND, caixaId, 'SUPRIMENTO', 20, 'Reforço de troco', PIN.vend)
    const l = await um<{ assinado: boolean; quem: string }>(`select assinado, quem from auditoria where acao = 'caixa.suprimento' order by criado_em desc limit 1`)
    expect(l).toEqual({ assinado: true, quem: 'Vera Vendedora' })
    // Só o que foi gravado com PIN entrou: uma sangria de 10 (desligada) e o suprimento.
    const movs = await linhas<{ tipo: string }>(`select tipo from caixa_movimentos where caixa_id = $1 order by criado_em`, [caixaId])
    expect(movs.map((x) => x.tipo)).toEqual(['SANGRIA', 'SUPRIMENTO'])
  })

  it('ligada: cancelar venda pede o PIN, e com ele cancela assinado', async () => {
    expect(await m.venda.cancelarVenda(GER, 'v-cancela', 'Cliente desistiu')).toMatchObject({ ok: false, motivo: 'assinatura' })
    expect(await um<{ situacao: string }>(`select situacao from vendas where id = 'v-cancela'`)).toEqual({ situacao: 'CONCLUIDA' })
    expect(await m.venda.cancelarVenda(GER, 'v-cancela', 'Cliente desistiu', PIN.ger)).toMatchObject({ ok: true })
    expect((await um<{ assinado: boolean }>(`select assinado from auditoria where acao = 'venda.cancelou' and alvo_id = 'v-cancela'`)).assinado).toBe(true)
  })

  it('ligada: a baixa de pago fora pede o PIN; receber no balcão (a venda do dia a dia) não', async () => {
    const sem = await m.recibos.baixaExterna(GER, { clienteId: 'cli-joana', unidadeId: 'uni-a1', parcelaIds: ['pj1'], valor: 50, referencia: 'sistema antigo, recibo 9', pagoEm: '2026-10-09' }, AGORA)
    expect(sem).toMatchObject({ ok: false, precisaPin: true })
    const com = await m.recibos.baixaExterna(GER, { clienteId: 'cli-joana', unidadeId: 'uni-a1', parcelaIds: ['pj1'], valor: 50, referencia: 'sistema antigo, recibo 9', pagoEm: '2026-10-09', pin: PIN.ger }, AGORA)
    expect(com.ok).toBe(true)
    expect((await um<{ assinado: boolean }>(`select assinado from auditoria where acao = 'crediario.baixa_externa' order by criado_em desc limit 1`)).assinado).toBe(true)
  })

  it('o livro filtra o que foi assinado', async () => {
    const assinadas = await m.auditoria.listarAuditoria(DONA, {
      unidadeIds: ['uni-a1', 'uni-a2'],
      de: new Date('2020-01-01'),
      ate: new Date('2100-01-01'),
      assunto: m.auditoria.ASSINADO,
    })
    expect(assinadas.length).toBeGreaterThanOrEqual(4)
    expect(assinadas.every((l) => l.assinado)).toBe(true)
    expect(assinadas.map((l) => l.acao)).toEqual(expect.arrayContaining(['caixa.suprimento', 'venda.cancelou', 'estoque.ajustou', 'crediario.baixa_externa']))
    await ligarPin(false)
  })
})

// ─────────────────────────────────────────────────────────────
describe('a gestão do crediário (C19)', () => {
  it('pausar a cobrança tira a cliente de "quem cobrar" — a dívida fica', async () => {
    const antes = await m.crediario.maioresDevedores(GER, ['uni-a1'], 10, AGORA)
    expect(antes.map((d) => d.id)).toContain('cli-maria')
    expect(await m.gestao.pausarCobranca(GER, 'cli-maria', true, 'ok')).toMatchObject({ ok: false })
    await expect(m.gestao.pausarCobranca(VEND, 'cli-maria', true, 'acordo em andamento')).rejects.toThrow(SemPermissao)
    expect(await m.gestao.pausarCobranca(GER, 'cli-maria', true, 'acordo em andamento', AGORA)).toEqual({ ok: true })
    const depois = await m.crediario.maioresDevedores(GER, ['uni-a1'], 10, AGORA)
    expect(depois.map((d) => d.id)).not.toContain('cli-maria')
    const resumo = await m.crediario.resumoCrediario(GER, ['uni-a1'])
    expect(resumo.emAberto).toBeGreaterThan(0)
    const lista = await m.crediario.listarParcelas(GER, { unidadeIds: ['uni-a1'], clienteId: 'cli-maria' }, AGORA)
    expect(lista.every((p) => p.cobrancaPausada)).toBe(true)
    const f = await m.gestao.fichaDeGestao(GER, 'cli-maria', AGORA)
    expect(f?.pausa?.motivo).toBe('acordo em andamento')
    expect(f?.notas[0]?.texto).toContain('pausou a cobrança')
  })

  it('as anotações se acumulam na ficha, com o dia e quem anotou', async () => {
    expect(await m.gestao.anotarNaFicha(VEND, 'cli-joana', 'ligou, vai pagar dia 10', AGORA)).toEqual({ ok: true })
    expect(await m.gestao.anotarNaFicha(GER, 'cli-joana', 'pagou metade', AGORA)).toEqual({ ok: true })
    const notas = (await m.gestao.fichaDeGestao(GER, 'cli-joana', AGORA))!.notas
    expect(notas.map((n) => [n.dia, n.quem, n.texto])).toEqual([
      ['10/10/2026', 'Gil Gerente', 'pagou metade'],
      ['10/10/2026', 'Vera Vendedora', 'ligou, vai pagar dia 10'],
    ])
    expect(lerNotas(comNota('escrito à mão', '01/10/2026 · Ana: oi'))).toEqual([
      { dia: '01/10/2026', quem: 'Ana', texto: 'oi' },
      { dia: null, quem: null, texto: 'escrito à mão' },
    ])
    expect(motivoServe('ok')).toBe(false)
    expect(motivoServe('Cliente desistiu')).toBe(true)
  })

  it('dívida lançada na mão: carnê com parcelas, sem estoque, sem caixa e fora da receita', async () => {
    const de = new Date('2026-10-01T03:00:00Z')
    const ate = new Date('2026-11-01T02:59:59Z')
    const dreAntes = await m.fin.montarDRE(DONA, ['uni-a1'], de, ate)
    const movAntes = (await um<{ n: number }>(`select count(*)::int n from movimentos_estoque`)).n
    await expect(m.gestao.lancarDivida(VEND, { clienteId: 'cli-joana', unidadeId: 'uni-a1', valor: 300, parcelas: 3, primeiroVencimento: '2026-09-15', descricao: 'caderno', motivo: 'compras do caderno' }, AGORA)).rejects.toThrow(SemPermissao)
    const r = await m.gestao.lancarDivida(GER, { clienteId: 'cli-joana', unidadeId: 'uni-a1', valor: 300, parcelas: 3, primeiroVencimento: '2026-09-15', descricao: 'caderno', motivo: 'compras do caderno' }, AGORA)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.numero).toBe(20)
    const v = await um<{ situacao: string; total: string; caixa_id: string | null; observacoes: string }>(`select situacao, total, caixa_id, observacoes from vendas where id = $1`, [r.vendaId])
    expect(v.situacao).toBe('SALDO_IMPORTADO')
    expect(v.caixa_id).toBeNull()
    expect(v.observacoes.startsWith(m.gestao.MARCA_DIVIDA)).toBe(true)
    const ps = await linhas<{ venc: string; valor: string }>(`select to_char(vencimento, 'YYYY-MM-DD') venc, valor from parcelas where venda_id = $1 order by numero`, [r.vendaId])
    expect(ps).toEqual([
      { venc: '2026-09-15', valor: '100.00' },
      { venc: '2026-10-15', valor: '100.00' },
      { venc: '2026-11-15', valor: '100.00' },
    ])
    expect((await um<{ n: number }>(`select count(*)::int n from movimentos_estoque`)).n).toBe(movAntes)
    const dreDepois = await m.fin.montarDRE(DONA, ['uni-a1'], de, ate)
    expect(dreDepois.resultado).toBe(dreAntes.resultado)
    expect(await m.venda.cancelarVenda(DONA, r.vendaId, 'cancelar a dívida')).toMatchObject({ ok: false, motivo: 'saldo_importado' })
  })

  it('quitou tudo: baixa no carnê inteiro da loja, fora do caixa, com o valor contado lá dentro', async () => {
    const recebidosAntes = (await um<{ n: number }>(`select count(*)::int n from recebimentos where caixa_id is not null`)).n
    const r = await m.recibos.baixaExterna(GER, { clienteId: 'cli-joana', unidadeId: 'uni-a1', parcelaIds: [], valor: 0, tudo: true, referencia: 'Acordo de quitação', pagoEm: '2026-10-10' }, AGORA)
    expect(r).toMatchObject({ ok: true, quitou: true, saldoDepois: 0, recebido: 350 })
    const abertas = await um<{ n: number }>(`select count(*)::int n from parcelas where cliente_id = 'cli-joana' and quitada_em is null`)
    expect(abertas.n).toBe(0)
    expect((await um<{ n: number }>(`select count(*)::int n from recebimentos where caixa_id is not null`)).n).toBe(recebidosAntes)
    expect((await um<{ acao: string }>(`select acao from auditoria where alvo_id = 'cli-joana' order by criado_em desc limit 1`)).acao).toBe('crediario.quitou')
  })

  it('juntar fichas: pede PIN sempre, e não passa por loja que quem junta não cuida', async () => {
    const semPin = await m.gestao.juntarFichas(GER, { ficaId: 'cli-maria', saiId: 'cli-maria2', motivo: 'Mesma cliente cadastrada duas vezes' }, AGORA)
    expect(semPin).toMatchObject({ ok: false, precisaPin: true })
    // A ficha do Bairro tem venda na loja 2: o gerente do Centro não junta.
    const outraLoja = await m.gestao.juntarFichas(GER, { ficaId: 'cli-maria', saiId: 'cli-bairro', motivo: 'Mesma cliente cadastrada duas vezes', pin: PIN.ger }, AGORA)
    expect(outraLoja.ok).toBe(false)
    expect(await um<{ n: number }>(`select count(*)::int n from vendas where cliente_id = 'cli-bairro'`)).toEqual({ n: 1 })
    await expect(m.gestao.juntarFichas(VEND, { ficaId: 'cli-maria', saiId: 'cli-maria2', motivo: 'Mesma cliente', pin: PIN.vend }, AGORA)).rejects.toThrow(SemPermissao)
  })

  it('juntar não atravessa empresa: a ficha da vizinha é "não encontrada" e nada se move', async () => {
    const r = await m.gestao.juntarFichas(DONA, { ficaId: 'cli-maria', saiId: 'cli-b', motivo: 'Mesma cliente cadastrada duas vezes', pin: PIN.dona }, AGORA)
    expect(r).toEqual({ ok: false, erro: 'Uma das fichas não foi encontrada.' })
    const r2 = await m.gestao.juntarFichas(BIA, { ficaId: 'cli-b', saiId: 'cli-maria2', motivo: 'Mesma cliente cadastrada duas vezes', pin: '1357' }, AGORA)
    expect(r2.ok).toBe(false)
    expect(await um<{ cliente_id: string }>(`select cliente_id from vendas where id = 'v-b'`)).toEqual({ cliente_id: 'cli-b' })
    expect(await um<{ cliente_id: string }>(`select cliente_id from vendas where id = 'v-m2'`)).toEqual({ cliente_id: 'cli-maria2' })
  })

  it('juntar leva vendas, parcelas, vales e pontos; a resposta mais restritiva das ofertas vale; a outra fica apontando', async () => {
    const r = await m.gestao.juntarFichas(GER, { ficaId: 'cli-maria', saiId: 'cli-maria2', motivo: 'Comprou uma vez sem CPF e outra com', pin: PIN.ger }, AGORA)
    expect(r).toMatchObject({ ok: true, fica: 'cli-maria', movidos: { vendas: 1, parcelas: 1, vales: 1, pontos: 1 } })
    expect(await um(`select cliente_id from parcelas where id = 'pm3'`)).toEqual({ cliente_id: 'cli-maria' })
    expect(await um(`select cliente_id from vales where id = 'vale-m2'`)).toEqual({ cliente_id: 'cli-maria' })
    const fica = await um<{ pontos: number; ofertas_whatsapp: string; cobranca_pausada_em: Date | null; observacoes: string }>(
      `select pontos, ofertas_whatsapp, cobranca_pausada_em, observacoes from clientes where id = 'cli-maria'`,
    )
    expect(fica.pontos).toBe(42)
    // Uma ficha dizia NÃO (e o número dela pediu PARAR): a pessoa não recebe oferta.
    expect(fica.ofertas_whatsapp).toBe('NAO')
    expect(fica.cobranca_pausada_em).not.toBeNull()
    expect(fica.observacoes).toContain('juntou a ficha "Maria Souza"')
    // O número que ficou na ficha entrou na lista de quem não recebe.
    expect((await linhas(`select 1 from optout_whatsapp where telefone = '7199990000'`)).length).toBe(1)
    const sai = await um<{ ativo: boolean; juntada_na_id: string; pontos: number; telefone: string | null }>(
      `select ativo, juntada_na_id, pontos, telefone from clientes where id = 'cli-maria2'`,
    )
    expect(sai).toEqual({ ativo: false, juntada_na_id: 'cli-maria', pontos: 0, telefone: null })
    const l = await um<{ assinado: boolean; acao: string }>(`select assinado, acao from auditoria where acao = 'cliente.juntou'`)
    expect(l.assinado).toBe(true)
    // A ficha juntada não se junta de novo.
    expect((await m.gestao.juntarFichas(GER, { ficaId: 'cli-joana', saiId: 'cli-maria2', motivo: 'Mesma cliente', pin: PIN.ger }, AGORA)).ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
describe('corrigir a data da venda (C23)', () => {
  it('muda o dia do fato e a hora fica; o caixa do turno não muda', async () => {
    const caixaAntes = await m.caixa.conferirCaixa(DONA, caixaId)
    await expect(m.vendaData.corrigirDataDaVenda(VEND, { vendaId: 'v-data', dia: '2026-10-08', motivo: 'Venda de outro dia lançada hoje' }, AGORA)).rejects.toThrow(SemPermissao)
    expect(await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-data', dia: '2026-10-11', motivo: 'Venda de outro dia lançada hoje' }, AGORA)).toMatchObject({ ok: false })
    expect(await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-data', dia: '2026-10-08', motivo: '.' }, AGORA)).toMatchObject({ ok: false })
    const r = await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-data', dia: '2026-10-08', motivo: 'Venda de outro dia lançada hoje' }, AGORA)
    expect(r).toEqual({ ok: true, de: '2026-10-09', para: '2026-10-08' })
    // A coluna é `timestamp` sem fuso, em UTC (como o Prisma grava): lida como texto.
    const v = await um<{ criada_em: string; caixa_id: string; data_original: string; data_corrigida_por: string }>(
      `select to_char(criada_em, 'YYYY-MM-DD HH24:MI') criada_em, caixa_id, to_char(data_original, 'YYYY-MM-DD HH24:MI') data_original, data_corrigida_por from vendas where id = 'v-data'`,
    )
    expect(v.criada_em).toBe('2026-10-08 18:30')
    expect(v.caixa_id).toBe(caixaId)
    expect(v.data_original).toBe('2026-10-09 18:30')
    expect(v.data_corrigida_por).toBe('Gil Gerente')
    const caixaDepois = await m.caixa.conferirCaixa(DONA, caixaId)
    expect(caixaDepois.esperado).toBe(caixaAntes.esperado)
    expect(caixaDepois.vendidoTotal).toBe(caixaAntes.vendidoTotal)
  })

  it('mês que já passou avisa e pede confirmação; a data de antes da primeira correção fica', async () => {
    expect(avisosDeMesPassado('2026-10-08', '2026-09-30', '2026-10-10')).toHaveLength(1)
    expect(avisosDeMesPassado('2026-10-08', '2026-10-01', '2026-10-10')).toEqual([])
    const r = await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-data', dia: '2026-09-30', motivo: 'Igualando ao outro sistema' }, AGORA)
    expect(r).toMatchObject({ ok: false, precisaConfirmar: true })
    const ok = await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-data', dia: '2026-09-30', motivo: 'Igualando ao outro sistema', confirmado: true }, AGORA)
    expect(ok).toMatchObject({ ok: true, para: '2026-09-30' })
    const v = await um<{ d: string }>(`select to_char(data_original, 'YYYY-MM-DD HH24:MI') d from vendas where id = 'v-data'`)
    expect(v.d).toBe('2026-10-09 18:30')
  })

  it('com a chave do PIN ligada, corrigir a data também assina; venda cancelada não se corrige', async () => {
    await ligarPin(true)
    expect(await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-data', dia: '2026-10-01', motivo: 'Digitei a data errada', confirmado: true }, AGORA)).toMatchObject({ ok: false, precisaPin: true })
    expect(await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-data', dia: '2026-10-01', motivo: 'Digitei a data errada', confirmado: true, pin: PIN.ger }, AGORA)).toMatchObject({ ok: true })
    expect((await um<{ assinado: boolean }>(`select assinado from auditoria where acao = 'venda.data_corrigiu' order by criado_em desc limit 1`)).assinado).toBe(true)
    await ligarPin(false)
    expect(await m.vendaData.corrigirDataDaVenda(GER, { vendaId: 'v-cancela', dia: '2026-10-01', motivo: 'Digitei a data errada' }, AGORA)).toMatchObject({ ok: false })
  })
})
