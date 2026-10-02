// AUDITORIA (02/10): pedido do catálogo e encomenda até o balcão.
//
// Cada `it` nasceu provando um defeito de regra de negócio encontrado na
// auditoria. Corrigidos, eles afirmam o comportamento CERTO — e ficam, para o
// defeito não voltar.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  cat: typeof import('../src/servidor/catalogo')
  enc: typeof import('../src/servidor/encomenda')
  venda: typeof import('../src/servidor/venda')
  banco: typeof import('../src/servidor/banco')
}

const DONO: Sessao = { orgId: 'org-c', usuarioId: 'usr-dono', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-c', 'Sorveteria C', 'sorveteria-c', 'BALCAO', 'ATIVA', '{encomenda}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-c', 'org-c', 'Centro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-dono', 'org-c', 'Dona', 'd@c.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-dono', 'org-c', 'usr-dono', null, 'DONO');
  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, ativo, uso_interno, atualizado_em) values
    ('p-pic', 'org-c', 'Picolé',       'UN', 2.00, 2.40, true, false, now()),
    ('p-ult', 'org-c', 'Pote raro',    'UN', 30.00, null, true, false, now()),
    ('p-cx',  'org-c', 'Caixa 12 pic', 'CX', 20.00, null, true, false, now()),
    ('p-kg',  'org-c', 'Sorvete kg',   'KG', 40.00, null, true, false, now()),
    ('p-sin', 'org-c', 'Bolo gelado',  'UN', 10.00, null, true, false, now()),
    ('p-ok',  'org-c', 'Açaí 500',     'UN', 15.00, null, true, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('v-pic', 'org-c', 'p-pic', 'PIC', true), ('v-ult', 'org-c', 'p-ult', 'ULT', true),
    ('v-cx', 'org-c', 'p-cx', 'CX', true), ('v-kg', 'org-c', 'p-kg', 'KG', true),
    ('v-sin', 'org-c', 'p-sin', 'SIN', true), ('v-ok', 'org-c', 'p-ok', 'OK', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-pic', 'org-c', 'v-pic', 'uni-c', 100, now()),
    ('e-ult', 'org-c', 'v-ult', 'uni-c', 1, now()),
    ('e-cx',  'org-c', 'v-cx',  'uni-c', 10, now()),
    ('e-kg',  'org-c', 'v-kg',  'uni-c', 10, now()),
    ('e-sin', 'org-c', 'v-sin', 'uni-c', 10, now()),
    ('e-ok',  'org-c', 'v-ok',  'uni-c', 10, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-c', 'org-c', 'uni-c', 'Dona', 0);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.SEGREDO_SESSAO ??= 'x'.repeat(40)
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    cat: await import('../src/servidor/catalogo'),
    enc: await import('../src/servidor/encomenda'),
    venda: await import('../src/servidor/venda'),
    banco: await import('../src/servidor/banco'),
  }
  const r = await m.cat.salvarCatalogo(DONO, 'uni-c', {
    ativo: true, endereco: 'centro', whatsapp: '(71) 99999-0000', recado: null, retirada: true, entrega: true,
    taxaEntrega: 5, pedidoMinimo: null, chavePix: 'pix@sorveteria.com', mostrarEsgotado: false,
  })
  expect(r.ok).toBe(true)
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const saldo = async (id: string) => Number((await linhas<{ q: string }>(`select quantidade q from estoque where id = $1`, [id]))[0]!.q)
const situacao = async (id: string) => (await linhas<{ s: string }>(`select situacao::text s from encomendas where id = $1`, [id]))[0]!.s

let tel = 0
/** Um pedido do catálogo, de um telefone e IP novos (para não bater no freio). */
async function pedir(itens: { variacaoId: string; quantidade: number }[], extra: Record<string, unknown> = {}) {
  tel++
  const r = await m.cat.fazerPedidoPeloCatalogo(
    'sorveteria-c', 'centro',
    { nome: 'Cliente Teste', telefone: `7198000${String(tel).padStart(4, '0')}`, entrega: false, forma: 'PIX', itens, ...extra } as never,
    `10.1.${tel}.1`, 'https://norte.test',
  )
  return r
}

/** Os campos que a tela de "Mudar" mandaria, a partir do que está gravado. */
async function dadosDaEdicao(id: string) {
  const [e] = await linhas<{ para: Date; descricao: string; cliente_nome: string; valor: string; sinal: string; entrega: boolean; endereco: string | null }>(
    `select para, descricao, cliente_nome, valor, sinal, entrega, endereco from encomendas where id = $1`, [id],
  )
  return {
    clienteNome: e!.cliente_nome,
    descricao: e!.descricao,
    valor: Number(e!.valor),
    sinal: Number(e!.sinal),
    dia: m.enc.diaEmSP(new Date(e!.para)),
    hora: m.enc.horaEmSP(new Date(e!.para)),
    entrega: e!.entrega,
    endereco: e!.endereco,
  }
}

describe('A. pedido do catálogo com sinal: o estoque baixa no balcão', () => {
  it('a loja anota o Pix adiantado como sinal; no balcão entram os produtos, e o sinal é descontado', async () => {
    const r = await pedir([{ variacaoId: 'v-sin', quantidade: 3 }]) // 3 × R$ 10 = R$ 30
    expect(r.ok).toBe(true)
    const id = r.encomendaId!
    const antes = await saldo('e-sin')

    const ed = await m.enc.editarEncomenda(DONO, id, { ...(await dadosDaEdicao(id)), sinal: 10, sinalForma: 'PIX' })
    expect(ed.ok).toBe(true)

    // O balcão abre COM os produtos, pelo preço do pedido, e a linha da
    // encomenda é o crédito do sinal (−R$ 10).
    const tela = await m.enc.encomendaParaReceber(DONO, id, 'uni-c')
    expect(tela.ok && tela.encomenda.itens).toEqual([{ variacaoId: 'v-sin', quantidade: 3, precoUnit: 10 }])
    expect(tela.ok && tela.encomenda.falta).toBe(-10)

    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: id, itens: [{ variacaoId: 'v-sin', quantidade: 3 }], pagamentos: [{ forma: 'PIX', valor: 20 }] })
    expect(v).toMatchObject({ ok: true, total: 20 })
    expect(await situacao(id)).toBe('ENTREGUE')
    // 3 bolos saíram da loja e do estoque.
    expect(await saldo('e-sin')).toBe(antes - 3)
  })

  it('pago tudo por Pix (sinal = total): não se marca entregue por fora; o balcão fecha em zero e baixa o estoque', async () => {
    const r = await pedir([{ variacaoId: 'v-sin', quantidade: 2 }]) // R$ 20
    const id = r.encomendaId!
    const antes = await saldo('e-sin')
    await m.enc.editarEncomenda(DONO, id, { ...(await dadosDaEdicao(id)), sinal: 20, sinalForma: 'PIX' })
    const tela = await m.enc.encomendaParaReceber(DONO, id, 'uni-c')
    expect(tela).toMatchObject({ ok: true, encomenda: { falta: -20 } })
    const e = await m.enc.mudarSituacao(DONO, id, { para: 'ENTREGUE' })
    expect(e.ok).toBe(false)
    expect(await saldo('e-sin')).toBe(antes)

    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: id, itens: [{ variacaoId: 'v-sin', quantidade: 2 }], pagamentos: [] })
    expect(v).toMatchObject({ ok: true, total: 0 })
    expect(await situacao(id)).toBe('ENTREGUE')
    expect(await saldo('e-sin')).toBe(antes - 2)
  })

  it('"Só marcar entregue" num pedido do catálogo é recusado: ele sai pelo balcão, com venda e baixa', async () => {
    const r = await pedir([{ variacaoId: 'v-sin', quantidade: 1 }]) // R$ 10
    const id = r.encomendaId!
    const antes = await saldo('e-sin')
    const e = await m.enc.mudarSituacao(DONO, id, { para: 'ENTREGUE', motivo: 'pagou no Pix da página' })
    expect(e).toMatchObject({ ok: false })
    expect(await situacao(id)).toBe('ABERTA')
    expect(await saldo('e-sin')).toBe(antes)

    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: id, itens: [{ variacaoId: 'v-sin', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 10 }] })
    expect(v.ok).toBe(true)
    expect(await saldo('e-sin')).toBe(antes - 1)
  })
})

describe('B. o catálogo não aceita mais do que a loja tem', () => {
  it('pedir 50 com 1 no estoque é recusado; o último pote ainda pode ser disputado no balcão (sem reserva)', async () => {
    const a = await pedir([{ variacaoId: 'v-ult', quantidade: 1 }])
    const b = await pedir([{ variacaoId: 'v-ult', quantidade: 1 }])
    const c = await pedir([{ variacaoId: 'v-ult', quantidade: 50 }]) // R$ 1.500 com 1 pote na loja
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false])
    expect(c).toMatchObject({ ok: false, mudou: true })

    const va = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: a.encomendaId, itens: [{ variacaoId: 'v-ult', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 30 }] })
    expect(va.ok).toBe(true)
    // Sem reserva: a segunda, aceita quando ainda havia 1, esbarra no balcão.
    const vb = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: b.encomendaId, itens: [{ variacaoId: 'v-ult', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 30 }] })
    expect(vb).toMatchObject({ ok: false, motivo: 'sem_estoque' })
  })
})

describe('C. o balcão cobra o que o catálogo prometeu', () => {
  it('preço mudou depois do pedido: o balcão cobra os R$ 6 do pedido', async () => {
    const r = await pedir([{ variacaoId: 'v-pic', quantidade: 3 }]) // 3 × 2,00
    expect(r.ok && r.totalC).toBe(600)
    await db.exec(`update produtos set preco_vista = 2.50 where id = 'p-pic'`)
    try {
      const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: r.encomendaId, itens: [{ variacaoId: 'v-pic', quantidade: 3 }], pagamentos: [{ forma: 'PIX', valor: 6 }] })
      expect(v).toMatchObject({ ok: true, total: 6 })
    } finally {
      await db.exec(`update produtos set preco_vista = 2.00 where id = 'p-pic'`)
    }
  })

  it('a cliente escolheu "cartão de crédito" no catálogo e viu R$ 6: no balcão o cartão cobra os mesmos R$ 6', async () => {
    const r = await pedir([{ variacaoId: 'v-pic', quantidade: 3 }], { forma: 'CREDITO' })
    expect(r.ok && r.totalC).toBe(600)
    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: r.encomendaId, itens: [{ variacaoId: 'v-pic', quantidade: 3 }], pagamentos: [{ forma: 'CREDITO', valor: 6 }] })
    expect(v).toMatchObject({ ok: true, total: 6 })
  })

  it('a venda com só parte dos produtos (outra linha qualquer) não fecha o pedido', async () => {
    const r = await pedir([{ variacaoId: 'v-ok', quantidade: 4 }]) // R$ 60
    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: r.encomendaId, itens: [{ variacaoId: 'v-pic', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 2 }] })
    expect(v).toMatchObject({ ok: false, motivo: 'encomenda_recusada' })
    expect(await situacao(r.encomendaId!)).toBe('ABERTA')
    // Os produtos do pedido, e mais uma coisa que a cliente levou junto: passa.
    const ok = await m.venda.registrarVenda(DONO, {
      unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: r.encomendaId,
      itens: [{ variacaoId: 'v-ok', quantidade: 4 }, { variacaoId: 'v-pic', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 62 }],
    })
    expect(ok.ok).toBe(true)
    expect(await situacao(r.encomendaId!)).toBe('ENTREGUE')
  })

  it('mudou de entrega para retirada: a taxa sai, e o balcão não cobra entrega', async () => {
    const r = await pedir([{ variacaoId: 'v-pic', quantidade: 1 }], { entrega: true, endereco: 'Rua das Flores, 10 — Centro' })
    expect(r.ok && r.totalC).toBe(700) // 2 + 5
    const id = r.encomendaId!
    // A pessoa só troca para retirada, sem mexer no valor: a taxa sai sozinha.
    const ed = await m.enc.editarEncomenda(DONO, id, { ...(await dadosDaEdicao(id)), entrega: false, endereco: null })
    expect(ed.ok).toBe(true)
    const [e] = await linhas<{ valor: string; taxa_entrega: string | null }>(`select valor, taxa_entrega from encomendas where id = $1`, [id])
    expect([Number(e!.valor), e!.taxa_entrega]).toEqual([2, null])
    const tela = await m.enc.encomendaParaReceber(DONO, id, 'uni-c')
    expect(tela.ok && tela.encomenda.falta).toBe(0)
    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: id, itens: [{ variacaoId: 'v-pic', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 2 }] })
    expect(v).toMatchObject({ ok: true, total: 2 })
  })
})

describe('D. o catálogo recusa a quantidade que o balcão recusaria', () => {
  it('1,5 caixa (medida CX) não entra pelo catálogo', async () => {
    const r = await pedir([{ variacaoId: 'v-cx', quantidade: 1.5 }])
    expect(r.ok).toBe(false)
  })

  it('0,0004 kg (zero com 3 casas) não vira item de R$ 0', async () => {
    const r = await pedir([{ variacaoId: 'v-kg', quantidade: 0.0004 }, { variacaoId: 'v-pic', quantidade: 1 }])
    expect(r.ok).toBe(false)
  })

  it('o teto de 999 por item é conferido depois de juntar: 999 + 999 é recusado', async () => {
    const r = await pedir([{ variacaoId: 'v-pic', quantidade: 999 }, { variacaoId: 'v-pic', quantidade: 999 }])
    expect(r.ok).toBe(false)
  })
})

describe('F. baixar o valor da encomenda é desconto, com o teto da venda', () => {
  const BALCAO: Sessao = { orgId: 'org-c', usuarioId: 'usr-bal', nome: 'Caixa', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-c', expiraEm: null }] }

  it('valor 120 → 55 pelo balcão (sem venda.desconto, teto 10%): pede o PIN e não grava', async () => {
    await db.exec(`
      insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-bal', 'org-c', 'Caixa', 'c@c.com', now()) on conflict do nothing;
      insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-bal', 'org-c', 'usr-bal', 'uni-c', 'BALCAO') on conflict do nothing;
      update orgs set desconto_maximo = 10 where id = 'org-c';
    `)
    const c = await m.enc.criarEncomenda(DONO, {
      unidadeId: 'uni-c', clienteNome: 'Rita', descricao: 'Torta de sorvete', valor: 120, sinal: 50, sinalForma: 'PIX',
      dia: m.enc.somarDias(m.enc.diaEmSP(new Date()), 3), hora: '10:00', entrega: false,
    })
    const id = (c as { id: string }).id
    const ed = await m.enc.editarEncomenda(BALCAO, id, { ...(await dadosDaEdicao(id)), valor: 55 })
    expect(ed).toMatchObject({ ok: false, pedePin: true })
    const [e] = await linhas<{ valor: string }>(`select valor from encomendas where id = $1`, [id])
    expect(Number(e!.valor)).toBe(120)
    // Até o teto, o balcão baixa sozinho (120 → 110 = 8,3%).
    const ate = await m.enc.editarEncomenda(BALCAO, id, { ...(await dadosDaEdicao(id)), valor: 110 })
    expect(ate.ok).toBe(true)
    // Quem tem o poder baixa além do teto, e fica no livro.
    const dono = await m.enc.editarEncomenda(DONO, id, { ...(await dadosDaEdicao(id)), valor: 55 })
    expect(dono.ok).toBe(true)
    const [aud] = await linhas<{ n: number }>(`select count(*)::int n from auditoria where acao = 'encomenda.alterou' and alvo_id = $1`, [id])
    expect(aud!.n).toBe(2)
  })

  it('entregar a encomenda de balcão com saldo em aberto: pede o porquê e, para o balcão, o PIN', async () => {
    const c = await m.enc.criarEncomenda(DONO, {
      unidadeId: 'uni-c', clienteNome: 'Lia', descricao: 'Bolo de sorvete', valor: 80, sinal: 30, sinalForma: 'PIX',
      dia: m.enc.somarDias(m.enc.diaEmSP(new Date()), 1), hora: '11:00', entrega: false,
    })
    const id = (c as { id: string }).id
    expect(await m.enc.mudarSituacao(BALCAO, id, { para: 'ENTREGUE' })).toMatchObject({ ok: false })
    expect(await m.enc.mudarSituacao(BALCAO, id, { para: 'ENTREGUE', motivo: 'pagou o resto no Pix ontem' })).toMatchObject({ ok: false, pedePin: true })
    expect(await situacao(id)).toBe('ABERTA')
    const ok = await m.enc.mudarSituacao(DONO, id, { para: 'ENTREGUE', motivo: 'pagou o resto no Pix ontem' })
    expect(ok).toEqual({ ok: true, falta: 50 })
    const [aud] = await linhas<{ motivo: string }>(`select motivo from auditoria where acao = 'encomenda.entregou' and alvo_id = $1`, [id])
    expect(aud!.motivo).toMatch(/em aberto: pagou o resto no Pix ontem/)
  })
})

describe('E. cancelar a venda que recebeu a encomenda', () => {
  it('a encomenda volta a esperar: dá para receber de novo, ou cancelar devolvendo o sinal', async () => {
    const c = await m.enc.criarEncomenda(DONO, {
      unidadeId: 'uni-c', clienteNome: 'Joana', descricao: 'Bolo de sorvete 2 kg', valor: 120, sinal: 50, sinalForma: 'PIX',
      dia: m.enc.somarDias(m.enc.diaEmSP(new Date()), 2), hora: '15:00', entrega: false,
    })
    expect(c.ok).toBe(true)
    const id = (c as { id: string }).id
    await m.enc.mudarSituacao(DONO, id, { para: 'PRONTA' })
    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: id, itens: [], pagamentos: [{ forma: 'PIX', valor: 70 }] })
    expect(v.ok).toBe(true)
    const can = await m.venda.cancelarVenda(DONO, (v as { vendaId: string }).vendaId, 'lancei na forma errada')
    expect(can.ok).toBe(true)

    // Volta para onde estava antes da venda (pronta), solta da venda cancelada.
    expect(await situacao(id)).toBe('PRONTA')
    const [vend] = await linhas<{ encomenda_id: string | null }>(`select encomenda_id from vendas where id = $1`, [(v as { vendaId: string }).vendaId])
    expect(vend!.encomenda_id).toBeNull()
    expect(await m.enc.encomendaParaReceber(DONO, id, 'uni-c')).toMatchObject({ ok: true, encomenda: { falta: 70 } })
    const cancelar = await m.enc.mudarSituacao(DONO, id, { para: 'CANCELADA', motivo: 'cliente desistiu', devolveuSinal: true, formaDevolucao: 'PIX' })
    expect(cancelar.ok).toBe(true)
  })

  it('o pedido do catálogo recebido e cancelado: os produtos voltam ao estoque e ele pode ser recebido de novo', async () => {
    const r = await pedir([{ variacaoId: 'v-ok', quantidade: 2 }]) // R$ 30
    const id = r.encomendaId!
    const antes = await saldo('e-ok')
    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: id, itens: [{ variacaoId: 'v-ok', quantidade: 2 }], pagamentos: [{ forma: 'PIX', valor: 30 }] })
    expect(v.ok).toBe(true)
    expect(await saldo('e-ok')).toBe(antes - 2)
    expect((await m.venda.cancelarVenda(DONO, (v as { vendaId: string }).vendaId, 'cobrei errado')).ok).toBe(true)
    expect(await saldo('e-ok')).toBe(antes)
    expect(await situacao(id)).toBe('ABERTA')
    const de_novo = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-c', caixaId: 'cx-c', encomendaId: id, itens: [{ variacaoId: 'v-ok', quantidade: 2 }], pagamentos: [{ forma: 'DINHEIRO', valor: 30 }] })
    expect(de_novo.ok).toBe(true)
    expect(await situacao(id)).toBe('ENTREGUE')
  })
})

describe('G. o que o link público mostra, e onde se anota encomenda', () => {
  it('a foto só sai de produto ativo; o gerente de uma loja não troca a foto do produto vendido em todas', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6])
    const f = await m.cat.guardarFotoDoProduto(DONO, 'p-ok', jpeg)
    expect(f.ok).toBe(true)
    const fotoId = (f as { fotoId: string }).fotoId
    expect(await m.cat.lerFotoPublica('sorveteria-c', fotoId)).not.toBeNull()
    await db.exec(`update produtos set ativo = false where id = 'p-ok'`)
    try {
      expect(await m.cat.lerFotoPublica('sorveteria-c', fotoId)).toBeNull()
    } finally {
      await db.exec(`update produtos set ativo = true where id = 'p-ok'`)
    }

    await db.exec(`
      insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-ger', 'org-c', 'Gerente', 'g@c.com', now()) on conflict do nothing;
      insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-ger', 'org-c', 'usr-ger', 'uni-c', 'GERENTE') on conflict do nothing;
    `)
    const GERENTE: Sessao = { orgId: 'org-c', usuarioId: 'usr-ger', nome: 'Gerente', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-c', expiraEm: null }] }
    // "Vendido em" vazio = todas as lojas, inclusive as que abrirem: só quem alcança a empresa inteira.
    expect(await m.cat.tirarFotoDoProduto(GERENTE, 'p-ok')).toMatchObject({ ok: false })
    expect((await m.cat.tirarFotoDoProduto(DONO, 'p-ok')).ok).toBe(true)
    const [aud] = await linhas<{ n: number }>(`select count(*)::int n from auditoria where acao = 'produto.foto' and alvo_id = 'p-ok' and motivo = 'foto retirada'`)
    expect(aud!.n).toBe(1)
  })

  it('depósito não abre catálogo nem recebe encomenda', async () => {
    await db.exec(`
      insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values ('uni-dep', 'org-c', 'Depósito', true, now());
      insert into catalogos (id, org_id, unidade_id, ativo, endereco, whatsapp, atualizado_em) values ('cat-dep', 'org-c', 'uni-dep', true, 'deposito', '5571999990000', now());
    `)
    expect(await m.cat.lerVitrinePublica('sorveteria-c', 'deposito')).toBeNull()
    const c = await m.enc.criarEncomenda(DONO, {
      unidadeId: 'uni-dep', clienteNome: 'Rita', descricao: 'Caixa de picolé', valor: 50,
      dia: m.enc.somarDias(m.enc.diaEmSP(new Date()), 1), hora: '10:00', entrega: false,
    })
    expect(c.ok).toBe(false)
  })
})
