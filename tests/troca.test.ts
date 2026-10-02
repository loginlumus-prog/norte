// A troca numa tela só, com banco de verdade: a devolução e a venda nova
// numa transação (ou as duas, ou nenhuma), a diferença paga (Pix, dinheiro na
// gaveta, crediário), a sobra virando vale da loja que emitiu, o desconto da
// compra no valor que volta, o crediário da compra abatido primeiro, o
// estoque nos dois sentidos — e a troca sem a compra, que pede o PIN.
//
// Mesmo arranjo de `pdv-balcao.test.ts`: o PGlite exposto numa porta, e o
// código rodando INTEIRO (comoOrg, Prisma, RLS).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { contaDaTroca, resultadoDaTroca, tabelaDaTroca, precoSemCompraPareceErrado, valorDevolvidoCent, fatorPago } from '../src/servidor/troca-conta'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  venda: typeof import('../src/servidor/venda')
  devolucao: typeof import('../src/servidor/devolucao')
  troca: typeof import('../src/servidor/troca')
  autorizacao: typeof import('../src/servidor/autorizacao')
  caixa: typeof import('../src/servidor/caixa')
  senha: typeof import('../src/servidor/senha')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-a',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])
const GER1 = sessao('usr-ger1', 'Gerente Centro', [{ papel: 'GERENTE', unidadeId: 'uni-a1' }])
const BALCAO = sessao('usr-bal1', 'Balcão Centro', [{ papel: 'BALCAO', unidadeId: 'uni-a1' }])

const SENHA = 'senha-boa-123'
const PIN_GER1 = '258014'

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, pontos_ativo, pontos_por_real, ponto_vale,
                    crediario_max_parcelas, vale_por_loja, vende_sem_estoque, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,multiUnidade}', 15, true, 1, 0.01, 12, true, false, now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, now()),
    ('uni-a2', 'org-a', 'Loja Shopping', false, true, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona', 'dona@a.com', now()),
    ('usr-ger1', 'org-a', 'Gerente Centro', 'g1@a.com', now()),
    ('usr-bal1', 'org-a', 'Balcão Centro', 'b1@a.com', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-ger1', 'org-a', 'usr-ger1', 'uni-a1', 'GERENTE'),
    ('ac-bal1', 'org-a', 'usr-bal1', 'uni-a1', 'BALCAO');

  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, ativo, atualizado_em) values
    ('p-blu', 'org-a', 'Blusa', 'UN', 100.00, 110.00, 120.00, 40.00, true, now()),
    ('p-sai', 'org-a', 'Saia', 'UN', 50.00, 55.00, 60.00, 20.00, true, now()),
    ('p-ves', 'org-a', 'Vestido', 'UN', 150.00, 165.00, 180.00, 60.00, true, now()),
    ('p-len', 'org-a', 'Lenço', 'UN', 30.00, 30.00, 30.00, 10.00, true, now());

  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-blu', 'org-a', 'p-blu', 'BLU-1', true),
    ('var-sai', 'org-a', 'p-sai', 'SAI-1', true),
    ('var-ves', 'org-a', 'p-ves', 'VES-1', true),
    ('var-len', 'org-a', 'p-len', 'LEN-1', true);

  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-blu', 'uni-a1', 100, now()),
    ('e2', 'org-a', 'var-sai', 'uni-a1', 100, now()),
    ('e3', 'org-a', 'var-ves', 'uni-a1', 100, now()),
    ('e4', 'org-a', 'var-len', 'uni-a1', 0, now()),
    ('e5', 'org-a', 'var-blu', 'uni-a2', 100, now()),
    ('e6', 'org-a', 'var-ves', 'uni-a2', 100, now());

  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Balcão Centro', 100);

  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-a', 'Cliente Um', now()),
    ('cli-2', 'org-a', 'Cliente Dois', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 55000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url

  m = {
    venda: await import('../src/servidor/venda'),
    devolucao: await import('../src/servidor/devolucao'),
    troca: await import('../src/servidor/troca'),
    autorizacao: await import('../src/servidor/autorizacao'),
    caixa: await import('../src/servidor/caixa'),
    senha: await import('../src/servidor/senha'),
    banco: await import('../src/servidor/banco'),
  }

  const hash = await m.senha.guardarSenha(SENHA)
  await db.query(`update usuarios set senha_hash = $1`, [hash])
  expect(await m.autorizacao.definirMeuPin(GER1, SENHA, PIN_GER1)).toEqual({ ok: true })
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  const g = globalThis as { __prismaNorte?: unknown }
  delete g.__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linha = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const saldo = async (variacao: string, unidade = 'uni-a1') =>
  Number((await linha<{ q: string }>(`select quantidade as q from estoque where variacao_id = $1 and unidade_id = $2`, [variacao, unidade]))[0]!.q)
const contar = async (tabela: string) => Number((await linha<{ n: number }>(`select count(*)::int as n from ${tabela}`))[0]!.n)

type Pag = Parameters<typeof m.venda.registrarVenda>[1]['pagamentos']

/** A compra de antes: vendida pela dona, para a cliente 1. Devolve o id da venda e o do item de cada peça. */
async function comprar(
  itens: { variacaoId: string; quantidade: number }[],
  pagamentos: Pag,
  extra: Partial<Parameters<typeof m.venda.registrarVenda>[1]> = {},
) {
  const r = await m.venda.registrarVenda(DONA, { unidadeId: 'uni-a1', clienteId: 'cli-1', itens, pagamentos, ...extra })
  if (!r.ok) throw new Error(`a compra de teste não fechou: ${JSON.stringify(r)}`)
  const its = await linha<{ id: string; variacao_id: string }>(`select id, variacao_id from venda_itens where venda_id = $1`, [r.vendaId])
  return { vendaId: r.vendaId, numero: r.numero, item: (v: string) => its.find((i) => i.variacao_id === v)!.id }
}

const trocar = (p: Partial<Parameters<typeof m.troca.trocar>[1]>, quem: Sessao = BALCAO) =>
  m.troca.trocar(quem, {
    unidadeId: 'uni-a1',
    vendaId: null,
    voltam: [],
    semCompra: [],
    leva: [],
    diferenca: null,
    clienteId: null,
    motivo: 'tamanho',
    ...p,
  })

// ─────────────────────────────────────────────────────────────
// A CONTA (pura)
// ─────────────────────────────────────────────────────────────

describe('a conta da troca', () => {
  it('as três frases: cliente paga, vira vale, sem diferença', () => {
    const paga = contaDaTroca({ voltaCent: 5000, fiadoAbertoCent: 0, levaCent: 10000 })
    expect(paga).toMatchObject({ creditoCent: 5000, usaCent: 5000, pagaCent: 5000, sobraCent: 0 })
    expect(resultadoDaTroca(paga)).toBe('paga')
    const vale = contaDaTroca({ voltaCent: 10000, fiadoAbertoCent: 0, levaCent: 5000 })
    expect(vale).toMatchObject({ usaCent: 5000, pagaCent: 0, sobraCent: 5000 })
    expect(resultadoDaTroca(vale)).toBe('vale')
    expect(resultadoDaTroca(contaDaTroca({ voltaCent: 5000, fiadoAbertoCent: 0, levaCent: 5000 }))).toBe('zero')
  })

  it('o crediário em aberto da compra abate primeiro; o crédito é só o que sobra', () => {
    expect(contaDaTroca({ voltaCent: 12000, fiadoAbertoCent: 8000, levaCent: 5000 })).toMatchObject({
      abatidoCent: 8000, creditoCent: 4000, usaCent: 4000, pagaCent: 1000, sobraCent: 0,
    })
  })

  it('o valor que volta é o pago: compra com 10% de desconto devolve 90%', () => {
    expect(valorDevolvidoCent(10000, 1, fatorPago(10000, 9000))).toBe(9000)
    // O juro do crédito parcelado não volta.
    expect(fatorPago(10000, 10500, 500)).toBe(1)
  })

  it('a tabela das peças novas é a da forma da diferença', () => {
    expect(tabelaDaTroca(null)).toBe('vista')
    expect(tabelaDaTroca('PIX')).toBe('vista')
    expect(tabelaDaTroca('DEBITO')).toBe('cartao')
    expect(tabelaDaTroca('CREDIARIO')).toBe('crediario')
  })

  it('preço digitado sem a compra: o zero a mais é recusado', () => {
    expect(precoSemCompraPareceErrado(8990, 12000)).toBe(false)
    expect(precoSemCompraPareceErrado(89900, 12000)).toBe(true)
    expect(precoSemCompraPareceErrado(0, 12000)).toBe(true)
  })

  it('o abatimento do crediário conta o desconto já dado na parcela', () => {
    // Parcela de R$ 100 com R$ 30 perdoados deve R$ 70: devolver R$ 100 abate 70.
    const r = m.devolucao.abaterDoFiado([{ id: 'p1', numero: 1, valorCent: 10000, pagoCent: 0, descontoCent: 3000 }], 10000)
    expect(r).toEqual({ abatidoCent: 7000, parcelas: [{ id: 'p1', novoValorCent: 3000, quitada: true }] })
  })
})

// ─────────────────────────────────────────────────────────────
// A TROCA COM A COMPRA
// ─────────────────────────────────────────────────────────────

describe('troca com a compra', () => {
  it('vira vale: a peça nova é mais barata, e a sobra fica num vale DESTA loja, da cliente', async () => {
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 1 }], [{ forma: 'PIX', valor: 100 }])
    const blu = await saldo('var-blu')
    const sai = await saldo('var-sai')

    const r = await trocar({ vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }], leva: [{ variacaoId: 'var-sai', quantidade: 1 }] })
    expect(r).toMatchObject({ ok: true, voltou: 100, credito: 100, levou: 50, pagou: 0, compraNumero: c.numero })
    if (!r.ok) return
    expect(r.vale).toMatchObject({ saldo: 50 })

    // Estoque nos dois sentidos.
    expect(await saldo('var-blu')).toBe(blu + 1)
    expect(await saldo('var-sai')).toBe(sai - 1)

    // A devolução foi para VALE; o vale nasceu com o crédito inteiro, da loja e da cliente, e a venda nova gastou 50.
    const [dev] = await linha<{ destino: string; valor: string; vale_id: string }>(`select destino, valor, vale_id from devolucoes where venda_id = $1`, [c.vendaId])
    expect(dev).toMatchObject({ destino: 'VALE', valor: '100.00' })
    const [vale] = await linha<{ valor: string; saldo: string; unidade_id: string; cliente_id: string; codigo: string }>(
      `select valor, saldo, unidade_id, cliente_id, codigo from vales where id = $1`, [dev!.vale_id])
    expect(vale).toMatchObject({ valor: '100.00', saldo: '50.00', unidade_id: 'uni-a1', cliente_id: 'cli-1', codigo: r.vale!.codigo })
    const pags = await linha<{ forma: string; valor: string; vale_id: string | null }>(`select forma, valor, vale_id from pagamentos where venda_id = $1`, [r.vendaId])
    expect(pags).toEqual([{ forma: 'VALE', valor: '50.00', vale_id: dev!.vale_id }])

    // A venda nova conta de onde veio, e o livro guarda a troca.
    const [nova] = await linha<{ observacoes: string; cliente_id: string; total: string }>(`select observacoes, cliente_id, total from vendas where id = $1`, [r.vendaId])
    expect(nova).toMatchObject({ cliente_id: 'cli-1', total: '50.00' })
    expect(nova!.observacoes).toContain(`Troca da venda ${c.numero}`)
    const livro = await linha<{ motivo: string }>(`select motivo from auditoria where acao = 'venda.trocou' and alvo_id = $1`, [r.vendaId])
    expect(livro).toHaveLength(1)
    expect(livro[0]!.motivo).toMatch(/vale VT-/)

    // O vale que sobrou é desta loja: na outra, com "vale por loja", não serve.
    expect(await m.devolucao.consultarVale(DONA, r.vale!.codigo, 'uni-a2')).toMatchObject({ ok: false, motivo: 'outra_loja' })
    expect(await m.devolucao.consultarVale(DONA, r.vale!.codigo, 'uni-a1')).toMatchObject({ ok: true, saldo: 50 })
  })

  it('cliente paga: a diferença no Pix, e o vale da troca fica zerado (não sobra papel)', async () => {
    const c = await comprar([{ variacaoId: 'var-sai', quantidade: 1 }], [{ forma: 'PIX', valor: 50 }])
    const r = await trocar({
      vendaId: c.vendaId,
      voltam: [{ vendaItemId: c.item('var-sai'), quantidade: 1 }],
      leva: [{ variacaoId: 'var-blu', quantidade: 1 }],
      diferenca: { forma: 'PIX', valor: 50 },
    })
    expect(r).toMatchObject({ ok: true, credito: 50, levou: 100, pagou: 50, vale: null })
    if (!r.ok) return
    const pags = await linha<{ forma: string; valor: string }>(`select forma, valor from pagamentos where venda_id = $1 order by forma`, [r.vendaId])
    expect(pags).toEqual([{ forma: 'PIX', valor: '50.00' }, { forma: 'VALE', valor: '50.00' }])
    const [vale] = await linha<{ saldo: string; usado_em: Date | null }>(
      `select v.saldo, v.usado_em from vales v join devolucoes d on d.vale_id = v.id where d.venda_id = $1`, [c.vendaId])
    expect(vale!.saldo).toBe('0.00')
    expect(vale!.usado_em).not.toBeNull()
  })

  it('sem diferença: troca a peça pela mesma (o defeito), e nada sobra nem se paga', async () => {
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 1 }], [{ forma: 'PIX', valor: 100 }])
    const r = await trocar({ vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }], leva: [{ variacaoId: 'var-blu', quantidade: 1 }] })
    expect(r).toMatchObject({ ok: true, credito: 100, levou: 100, pagou: 0, vale: null })
  })

  it('o valor que volta é o que ela PAGOU: compra com 10% de desconto vira 90 de crédito', async () => {
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 1 }], [{ forma: 'PIX', valor: 90 }], { desconto: 10 })
    const r = await trocar({ vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }], leva: [{ variacaoId: 'var-sai', quantidade: 1 }] })
    expect(r).toMatchObject({ ok: true, voltou: 90, credito: 90, levou: 50, vale: { saldo: 40 } })
  })

  it('peça por peça: das duas blusas, só uma volta', async () => {
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 2 }], [{ forma: 'PIX', valor: 200 }])
    const r = await trocar({ vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }], leva: [] })
    expect(r).toMatchObject({ ok: true, credito: 100, vendaId: null, vale: { saldo: 100 } })
    // A segunda ainda pode voltar; a terceira, não.
    const de = await m.troca.compraParaTroca(BALCAO, c.vendaId)
    expect(de?.itens).toEqual([expect.objectContaining({ restante: 1 })])
    const r2 = await trocar({ vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 2 }], leva: [] })
    expect(r2).toMatchObject({ ok: false, motivo: 'passa_do_vendido' })
  })

  it('a diferença no crediário: parcelas da diferença, preço da tabela do crediário, na ficha da cliente', async () => {
    const c = await comprar([{ variacaoId: 'var-sai', quantidade: 1 }], [{ forma: 'PIX', valor: 50 }])
    // Vestido no crediário: 180. Crédito 50, diferença 130 em 3×.
    const r = await trocar({
      vendaId: c.vendaId,
      voltam: [{ vendaItemId: c.item('var-sai'), quantidade: 1 }],
      leva: [{ variacaoId: 'var-ves', quantidade: 1 }],
      diferenca: { forma: 'CREDIARIO', valor: 130, parcelas: 3 },
    })
    expect(r).toMatchObject({ ok: true, credito: 50, levou: 180, pagou: 130 })
    if (!r.ok) return
    const ps = await linha<{ valor: string; cliente_id: string; numero: number }>(`select valor, cliente_id, numero from parcelas where venda_id = $1 order by numero`, [r.vendaId])
    expect(ps.map((p) => p.valor)).toEqual(['43.34', '43.33', '43.33'])
    expect(ps.every((p) => p.cliente_id === 'cli-1')).toBe(true)
  })

  it('a diferença que a tela mandou errada é recusada, e nada fica', async () => {
    const c = await comprar([{ variacaoId: 'var-sai', quantidade: 1 }], [{ forma: 'PIX', valor: 50 }])
    const antes = await contar('devolucoes')
    const r = await trocar({
      vendaId: c.vendaId,
      voltam: [{ vendaItemId: c.item('var-sai'), quantidade: 1 }],
      leva: [{ variacaoId: 'var-blu', quantidade: 1 }],
      // Débito usa a tabela de cartão: a blusa é 110, a diferença é 60 — não 50.
      diferenca: { forma: 'DEBITO', valor: 50 },
    })
    expect(r).toMatchObject({ ok: false, motivo: 'diferenca_nao_fecha' })
    expect(await contar('devolucoes')).toBe(antes)
  })

  it('compra no crediário ainda em aberto: a peça devolvida abate a dívida da compra antes de virar crédito', async () => {
    // Blusa no crediário (tabela do crediário: 120), em 2×, nada pago.
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 1 }], [{ forma: 'CREDIARIO', valor: 120, parcelas: 2 }])
    const de = await m.troca.compraParaTroca(BALCAO, c.vendaId)
    expect(de?.fiadoAbertoCent).toBe(12000)
    const r = await trocar({
      vendaId: c.vendaId,
      voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }],
      leva: [{ variacaoId: 'var-sai', quantidade: 1 }],
      diferenca: { forma: 'PIX', valor: 50 },
    })
    expect(r).toMatchObject({ ok: true, voltou: 120, abatido: 120, credito: 0, levou: 50, pagou: 50, vale: null })
    const ps = await linha<{ valor: string; quitada_em: Date | null }>(`select valor, quitada_em from parcelas where venda_id = $1`, [c.vendaId])
    expect(ps.every((p) => p.valor === '0.00' && p.quitada_em !== null)).toBe(true)
  })

  it('o dinheiro da diferença entra na gaveta do turno aberto', async () => {
    const c = await comprar([{ variacaoId: 'var-sai', quantidade: 1 }], [{ forma: 'PIX', valor: 50 }])
    const antes = await m.caixa.conferirCaixa(DONA, 'cx-a1')
    const r = await trocar({
      vendaId: c.vendaId,
      voltam: [{ vendaItemId: c.item('var-sai'), quantidade: 1 }],
      leva: [{ variacaoId: 'var-blu', quantidade: 1 }],
      diferenca: { forma: 'DINHEIRO', valor: 50 },
      troco: 50,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [v] = await linha<{ caixa_id: string }>(`select caixa_id from vendas where id = $1`, [r.vendaId])
    expect(v!.caixa_id).toBe('cx-a1')
    const depois = await m.caixa.conferirCaixa(DONA, 'cx-a1')
    // Só os 50 em dinheiro entram na gaveta; o vale não é dinheiro.
    expect(depois.esperado - antes.esperado).toBe(50)
  })

  it('peça sem cadastro (venda do sistema anterior): o estoque volta para a peça do catálogo apontada', async () => {
    const r0 = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', clienteId: 'cli-1',
      itens: [{ variacaoId: null, quantidade: 2, avulso: { descricao: 'BLUSA ANTIGA 123', precoUnit: 80 } }],
      pagamentos: [{ forma: 'PIX', valor: 160 }],
    })
    expect(r0.ok).toBe(true)
    if (!r0.ok) return
    const [item] = await linha<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r0.vendaId])
    const de = await m.troca.compraParaTroca(BALCAO, r0.vendaId)
    expect(de?.itens[0]).toMatchObject({ semCadastro: true })

    const blu = await saldo('var-blu')
    // Uma volta apontando a blusa do catálogo; o estoque dela sobe.
    const r = await trocar({ vendaId: r0.vendaId, voltam: [{ vendaItemId: item!.id, quantidade: 1, variacaoId: 'var-blu' }], leva: [] })
    expect(r).toMatchObject({ ok: true, credito: 80 })
    expect(await saldo('var-blu')).toBe(blu + 1)
    const [mov] = await linha<{ motivo: string }>(`select motivo from movimentos_estoque where referencia = $1 and tipo = 'DEVOLUCAO'`, [r0.vendaId])
    expect(mov!.motivo).toMatch(/sem cadastro, voltou como Blusa/)
    // A outra volta sem apontar: o valor volta, o estoque não mexe.
    const r2 = await trocar({ vendaId: r0.vendaId, voltam: [{ vendaItemId: item!.id, quantidade: 1 }], leva: [] })
    expect(r2).toMatchObject({ ok: true, credito: 80 })
    expect(await saldo('var-blu')).toBe(blu + 1)
  })

  it('pontos: a devolução tira os da compra, a venda nova dá os dela', async () => {
    const [antes] = await linha<{ pontos: number }>(`select pontos from clientes where id = 'cli-1'`)
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 1 }], [{ forma: 'PIX', valor: 100 }])
    const r = await trocar({ vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }], leva: [{ variacaoId: 'var-sai', quantidade: 1 }] })
    expect(r.ok).toBe(true)
    const [depois] = await linha<{ pontos: number }>(`select pontos from clientes where id = 'cli-1'`)
    // +100 da compra, −100 da devolução, +50 da saia.
    expect(depois!.pontos - antes!.pontos).toBe(50)
  })
})

// ─────────────────────────────────────────────────────────────
// OU TUDO, OU NADA
// ─────────────────────────────────────────────────────────────

describe('ou tudo, ou nada', () => {
  const foto = async (vendaId: string) => ({
    devolucoes: (await linha(`select id from devolucoes where venda_id = $1`, [vendaId])).length,
    vales: await contar('vales'),
    vendas: await contar('vendas'),
    movimentos: await contar('movimentos_estoque'),
    blu: await saldo('var-blu'),
    len: await saldo('var-len'),
  })

  it('a peça nova que acabou (a loja não vende sem estoque): a devolução já escrita é desfeita', async () => {
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 1 }], [{ forma: 'PIX', valor: 100 }])
    const antes = await foto(c.vendaId)
    const r = await trocar({ vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }], leva: [{ variacaoId: 'var-len', quantidade: 1 }] })
    expect(r).toMatchObject({ ok: false, motivo: 'sem_estoque' })
    expect(await foto(c.vendaId)).toEqual(antes)
  })

  it('diferença em dinheiro sem caixa aberto na loja: nada fica', async () => {
    const r0 = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a2', clienteId: 'cli-1', itens: [{ variacaoId: 'var-blu', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 100 }],
    })
    expect(r0.ok).toBe(true)
    if (!r0.ok) return
    const [item] = await linha<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r0.vendaId])
    const antes = { ...(await foto(r0.vendaId)), blu2: await saldo('var-blu', 'uni-a2'), ves2: await saldo('var-ves', 'uni-a2') }
    const r = await trocar(
      { unidadeId: 'uni-a2', vendaId: r0.vendaId, voltam: [{ vendaItemId: item!.id, quantidade: 1 }], leva: [{ variacaoId: 'var-ves', quantidade: 1 }], diferenca: { forma: 'DINHEIRO', valor: 50 } },
      DONA,
    )
    expect(r).toMatchObject({ ok: false, motivo: 'caixa_fechado' })
    expect({ ...(await foto(r0.vendaId)), blu2: await saldo('var-blu', 'uni-a2'), ves2: await saldo('var-ves', 'uni-a2') }).toEqual(antes)
  })

  it('a troca é na loja da compra (o vale é de lá)', async () => {
    const c = await comprar([{ variacaoId: 'var-blu', quantidade: 1 }], [{ forma: 'PIX', valor: 100 }])
    const r = await trocar({ unidadeId: 'uni-a2', vendaId: c.vendaId, voltam: [{ vendaItemId: c.item('var-blu'), quantidade: 1 }], leva: [] }, DONA)
    expect(r).toMatchObject({ ok: false, motivo: 'outra_loja' })
  })

  it('o balcão de uma loja não troca na outra', async () => {
    await expect(trocar({ unidadeId: 'uni-a2', vendaId: 'x', voltam: [{ vendaItemId: 'y', quantidade: 1 }] })).rejects.toThrow(/permissão/)
  })
})

// ─────────────────────────────────────────────────────────────
// SEM A COMPRA
// ─────────────────────────────────────────────────────────────

describe('troca sem a compra (comprada no sistema anterior)', () => {
  const semCompra = [{ variacaoId: 'var-blu', quantidade: 1, precoUnit: 89.9 }]

  it('o balcão precisa do PIN de quem pode; sem ele, nada acontece', async () => {
    const antes = { vales: await contar('vales'), blu: await saldo('var-blu') }
    const r = await trocar({ semCompra, leva: [{ variacaoId: 'var-sai', quantidade: 1 }], clienteId: 'cli-2' })
    expect(r).toMatchObject({ ok: false, motivo: 'precisa_pin', precisaPin: true })
    const errado = await trocar({ semCompra, leva: [{ variacaoId: 'var-sai', quantidade: 1 }], clienteId: 'cli-2', pin: '4826' })
    expect(errado).toMatchObject({ ok: false, motivo: 'autorizacao_recusada' })
    expect({ vales: await contar('vales'), blu: await saldo('var-blu') }).toEqual(antes)
  })

  it('com o PIN da gerente: a peça volta ao estoque, o crédito vira vale da loja e paga a peça nova', async () => {
    const blu = await saldo('var-blu')
    const r = await trocar({ semCompra, leva: [{ variacaoId: 'var-sai', quantidade: 1 }], clienteId: 'cli-2', pin: PIN_GER1 })
    expect(r).toMatchObject({ ok: true, compraNumero: null, voltou: 89.9, credito: 89.9, levou: 50, autorizadoPor: 'Gerente Centro', vale: { saldo: 39.9 } })
    if (!r.ok) return
    expect(await saldo('var-blu')).toBe(blu + 1)
    const [vale] = await linha<{ valor: string; unidade_id: string; cliente_id: string }>(`select valor, unidade_id, cliente_id from vales where codigo = $1`, [r.vale!.codigo])
    expect(vale).toMatchObject({ valor: '89.90', unidade_id: 'uni-a1', cliente_id: 'cli-2' })
    const [livro] = await linha<{ motivo: string }>(`select motivo from auditoria where acao = 'venda.trocou' and alvo_id = $1`, [r.vendaId])
    expect(livro!.motivo).toMatch(/sem a compra.*autorizada por Gerente Centro/)
    const pin = await linha(`select id from auditoria where acao = 'autorizacao.pin' and motivo like 'Troca sem a compra%'`)
    expect(pin.length).toBeGreaterThan(0)
  })

  it('quem pode dar desconto não precisa de PIN; preço de dedo errado é recusado', async () => {
    expect(await trocar({ semCompra, leva: [] , clienteId: 'cli-2' }, DONA)).toMatchObject({ ok: true, vale: { saldo: 89.9 } })
    expect(await trocar({ semCompra: [{ variacaoId: 'var-blu', quantidade: 1, precoUnit: 899 }], leva: [] }, DONA)).toMatchObject({ ok: false, motivo: 'preco_errado' })
  })

  it('o preço vai até a etiqueta mais cara de hoje (não 5×): R$ 130 por uma blusa de até R$ 120 é recusado', async () => {
    const antes = await contar('vales')
    expect(await trocar({ semCompra: [{ variacaoId: 'var-blu', quantidade: 1, precoUnit: 130 }], leva: [] }, DONA)).toMatchObject({ ok: false, motivo: 'preco_errado' })
    expect(await contar('vales')).toBe(antes)
    // A etiqueta do crediário (120) é a mais cara: até ela, passa.
    expect(await trocar({ semCompra: [{ variacaoId: 'var-blu', quantidade: 1, precoUnit: 120 }], leva: [], clienteId: 'cli-2' }, DONA)).toMatchObject({ ok: true, credito: 120 })
  })

  it('no máximo 20 peças de cada item, somadas as linhas', async () => {
    const r = await trocar(
      { semCompra: [{ variacaoId: 'var-len', quantidade: 15, precoUnit: 30 }, { variacaoId: 'var-len', quantidade: 6, precoUnit: 30 }], leva: [] },
      DONA,
    )
    expect(r).toMatchObject({ ok: false, motivo: 'quantidade_demais' })
  })

  it('acima de R$ 2.000 de crédito, nem a dona autoriza sozinha: o PIN tem de ser de OUTRA pessoa', async () => {
    // 12 vestidos a R$ 180 (a etiqueta do crediário) = R$ 2.160.
    const semCompra = [{ variacaoId: 'var-ves', quantidade: 12, precoUnit: 180 }]
    const antes = await contar('vales')
    expect(await trocar({ semCompra, leva: [], clienteId: 'cli-2' }, DONA)).toMatchObject({ ok: false, motivo: 'precisa_pin', precisaPin: true })
    // A gerente com o PIN dela mesma: recusado.
    expect(await trocar({ semCompra, leva: [], clienteId: 'cli-2', pin: PIN_GER1 }, GER1)).toMatchObject({ ok: false, motivo: 'autorizacao_recusada' })
    expect(await contar('vales')).toBe(antes)
    // A dona com o PIN da gerente: passa, e fica escrito quem autorizou.
    expect(await trocar({ semCompra, leva: [], clienteId: 'cli-2', pin: PIN_GER1 }, DONA)).toMatchObject({ ok: true, credito: 2160, autorizadoPor: 'Gerente Centro' })
  })
})

describe('consultar o vale no balcão', () => {
  it('pede a loja, e para depois de cinco códigos que não existem (mesmo o vale certo espera)', async () => {
    const [vale] = await linha<{ codigo: string }>(`select codigo from vales where unidade_id = 'uni-a1' and saldo > 0 limit 1`)
    expect(vale).toBeDefined()
    await expect(m.devolucao.consultarVale(BALCAO, vale!.codigo)).rejects.toThrow(/Sem permissão/)
    await expect(m.devolucao.consultarVale(BALCAO, vale!.codigo, 'uni-a2')).rejects.toThrow(/Sem permissão/)
    expect(await m.devolucao.consultarVale(BALCAO, vale!.codigo, 'uni-a1')).toMatchObject({ ok: true })
    for (let i = 0; i < 5; i++) {
      expect(await m.devolucao.consultarVale(BALCAO, `VT-ZZZZZ-ZZZZ${'ABCDE'[i]}`, 'uni-a1')).toMatchObject({ ok: false, motivo: 'nao_achado' })
    }
    expect(await m.devolucao.consultarVale(BALCAO, vale!.codigo, 'uni-a1')).toMatchObject({ ok: false, motivo: 'bloqueado' })
    // Por pessoa: a dona continua consultando.
    expect(await m.devolucao.consultarVale(DONA, vale!.codigo, 'uni-a1')).toMatchObject({ ok: true })
  })
})

describe('achar a compra', () => {
  it('pelo nome da cliente, pela peça, pelo código e pelo valor', async () => {
    await comprar([{ variacaoId: 'var-ves', quantidade: 1 }], [{ forma: 'PIX', valor: 150 }])
    const por = (q: string) => m.troca.procurarCompras(BALCAO, { unidadeId: 'uni-a1', dias: 7, q })
    expect((await por('Cliente Um')).length).toBeGreaterThan(0)
    expect((await por('vestido')).some((v) => v.itens.includes('Vestido'))).toBe(true)
    expect((await por('VES-1')).some((v) => v.itens.includes('Vestido'))).toBe(true)
    expect((await por('150,00')).every((v) => v.total === 150)).toBe(true)
    expect((await por('150,00')).length).toBeGreaterThan(0)
  })
})
