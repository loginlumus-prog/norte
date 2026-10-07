// AUDITORIA (07/10): encomendas — sinal, caixa, venda, estoque.
//
// Cada `describe` "BUG" prova um defeito encontrado na auditoria (o teste
// afirma o comportamento ERRADO de hoje, para ficar verde enquanto o defeito
// existe). Os "OK" conferem o que foi verificado como correto.

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

const DONO: Sessao = { orgId: 'org-q', usuarioId: 'usr-dono', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const BALCAO: Sessao = { orgId: 'org-q', usuarioId: 'usr-bal', nome: 'Caixa', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-q', expiraEm: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, atualizada_em, configurada_em) values
    ('org-q', 'Doceria Q', 'doceria-q', 'BALCAO', 'ATIVA', '{encomenda}', 10, now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-q', 'org-q', 'Centro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dono', 'org-q', 'Dona', 'd@q.com', now()), ('usr-bal', 'org-q', 'Caixa', 'c@q.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dono', 'org-q', 'usr-dono', null, 'DONO'), ('ac-bal', 'org-q', 'usr-bal', 'uni-q', 'BALCAO');
  insert into produtos (id, org_id, nome, medida, preco_vista, ativo, uso_interno, atualizado_em) values
    ('p-bolo', 'org-q', 'Bolo gelado', 'UN', 10.00, true, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('v-bolo', 'org-q', 'p-bolo', 'BOLO', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-bolo', 'org-q', 'v-bolo', 'uni-q', 50, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-q', 'org-q', 'uni-q', 'Dona', 0);
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
  const r = await m.cat.salvarCatalogo(DONO, 'uni-q', {
    ativo: true, endereco: 'centro', whatsapp: '(71) 99999-0000', recado: null, retirada: true, entrega: true,
    taxaEntrega: 5, pedidoMinimo: null, chavePix: null, mostrarEsgotado: false,
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
const valorDe = async (id: string) => Number((await linhas<{ v: string }>(`select valor v from encomendas where id = $1`, [id]))[0]!.v)
const situacao = async (id: string) => (await linhas<{ s: string }>(`select situacao::text s from encomendas where id = $1`, [id]))[0]!.s

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

const daqui = (n: number) => m.enc.somarDias(m.enc.diaEmSP(new Date()), n)

let tel = 0
async function pedir(itens: { variacaoId: string; quantidade: number }[], extra: Record<string, unknown> = {}) {
  tel++
  return m.cat.fazerPedidoPeloCatalogo(
    'doceria-q', 'centro',
    { nome: 'Cliente Teste', telefone: `7198100${String(tel).padStart(4, '0')}`, entrega: false, forma: 'PIX', itens, ...extra } as never,
    `10.9.${tel}.1`, 'https://norte.test',
  )
}

describe('CORRIGIDO 1. o teto de desconto da encomenda de balcão não se dribla em passos', () => {
  it('o balcão (sem venda.desconto, teto 10%) não leva 120 → 50 em passos: a régua é o maior valor que ela teve', async () => {
    const c = await m.enc.criarEncomenda(DONO, {
      unidadeId: 'uni-q', clienteNome: 'Rita', descricao: 'Torta de sorvete', valor: 120, sinal: 50, sinalForma: 'PIX',
      dia: daqui(3), hora: '10:00', entrega: false,
    })
    expect(c.ok).toBe(true)
    const id = (c as { id: string }).id

    // De uma vez: pede PIN (é o que a regra promete).
    expect(await m.enc.editarEncomenda(BALCAO, id, { ...(await dadosDaEdicao(id)), valor: 55 })).toMatchObject({ ok: false, pedePin: true })

    // O primeiro passo (120 → 110, 8%) cabe no teto; o segundo (100, 17% dos 120) não.
    expect(await m.enc.editarEncomenda(BALCAO, id, { ...(await dadosDaEdicao(id)), valor: 110 })).toMatchObject({ ok: true })
    expect(await m.enc.editarEncomenda(BALCAO, id, { ...(await dadosDaEdicao(id)), valor: 100 })).toMatchObject({ ok: false, pedePin: true })
    expect(await valorDe(id)).toBe(110)
    // Subir de volta não pede nada.
    expect(await m.enc.editarEncomenda(BALCAO, id, { ...(await dadosDaEdicao(id)), valor: 115 })).toMatchObject({ ok: true })
  })
})

describe('CORRIGIDO 2. pedido do catálogo com desconto autorizado: mudar só a hora não pede PIN', () => {
  it('a dona baixa 30 → 20; o balcão muda a hora e passa', async () => {
    const r = await pedir([{ variacaoId: 'v-bolo', quantidade: 3 }]) // 3 × 10
    expect(r.ok).toBe(true)
    const id = r.encomendaId!
    const dono = await m.enc.editarEncomenda(DONO, id, { ...(await dadosDaEdicao(id)), valor: 20 })
    expect(dono.ok).toBe(true)

    // Valor intocado (20 → 20); só a hora muda.
    const d = await dadosDaEdicao(id)
    const r2 = await m.enc.editarEncomenda(BALCAO, id, { ...d, dia: daqui(4), hora: '16:00' })
    expect(r2).toMatchObject({ ok: true })
    expect(await valorDe(id)).toBe(20)
    // Baixar mais um pouco ainda é medido contra o pedido (30): 18 é 40% — pede PIN.
    expect(await m.enc.editarEncomenda(BALCAO, id, { ...(await dadosDaEdicao(id)), valor: 18 })).toMatchObject({ ok: false, pedePin: true })
  })
})

describe('OK. o dinheiro do sinal: uma vez, no dia, na gaveta certa', () => {
  it('sinal em dinheiro → suprimento + receita; complemento e devolução geram a diferença; venda cobra só o resto', async () => {
    const c = await m.enc.criarEncomenda(DONO, {
      unidadeId: 'uni-q', clienteNome: 'Joana', descricao: 'Bolo 2 kg', valor: 120, sinal: 50, sinalForma: 'DINHEIRO',
      dia: daqui(2), hora: '15:00', entrega: false,
    })
    const id = (c as { id: string }).id
    const cod = m.enc.codigoEncomenda(id)
    const mov = async () => linhas<{ tipo: string; valor: string }>(`select tipo::text tipo, valor from caixa_movimentos where encomenda_id = $1 order by criado_em`, [id])
    const lan = async () => linhas<{ tipo: string; valor: string }>(`select tipo::text tipo, valor from lancamentos where documento = $1 order by criado_em`, [cod])
    expect((await mov()).map((x) => [x.tipo, Number(x.valor)])).toEqual([['SUPRIMENTO', 50]])
    expect((await lan()).map((x) => [x.tipo, Number(x.valor)])).toEqual([['RECEITA', 50]])

    // Complemento de 20 em Pix: lançamento sim, gaveta não. Reenvio igual não duplica.
    const d = await dadosDaEdicao(id)
    expect((await m.enc.editarEncomenda(DONO, id, { ...d, sinal: 70, sinalForma: 'PIX' })).ok).toBe(true)
    expect((await m.enc.editarEncomenda(DONO, id, { ...d, sinal: 70, sinalForma: 'PIX' })).ok).toBe(true) // sinal já é 70: dif 0
    expect((await lan()).map((x) => Number(x.valor))).toEqual([50, 20])
    expect((await mov()).length).toBe(1)

    // A venda cobra 120 − 70 = 50, e uma segunda venda da mesma encomenda é recusada.
    const v = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-q', caixaId: 'cx-q', encomendaId: id, itens: [], pagamentos: [{ forma: 'PIX', valor: 50 }] })
    expect(v).toMatchObject({ ok: true, total: 50 })
    const v2 = await m.venda.registrarVenda(DONO, { unidadeId: 'uni-q', caixaId: 'cx-q', encomendaId: id, itens: [], pagamentos: [{ forma: 'PIX', valor: 50 }] })
    expect(v2).toMatchObject({ ok: false, motivo: 'encomenda_recusada' })
    expect(await situacao(id)).toBe('ENTREGUE')
  })

  it('cancelar devolvendo em dinheiro: sangria do sinal inteiro e despesa no financeiro', async () => {
    const c = await m.enc.criarEncomenda(DONO, {
      unidadeId: 'uni-q', clienteNome: 'Bia', descricao: 'Torta', valor: 80, sinal: 30, sinalForma: 'DINHEIRO',
      dia: daqui(2), hora: '11:00', entrega: false,
    })
    const id = (c as { id: string }).id
    const r = await m.enc.mudarSituacao(DONO, id, { para: 'CANCELADA', motivo: 'desistiu', devolveuSinal: true })
    expect(r.ok).toBe(true)
    const mov = await linhas<{ tipo: string; valor: string }>(`select tipo::text tipo, valor from caixa_movimentos where encomenda_id = $1 order by criado_em`, [id])
    expect(mov.map((x) => [x.tipo, Number(x.valor)])).toEqual([['SUPRIMENTO', 30], ['SANGRIA', 30]])
    // Repetir o cancelamento não devolve de novo.
    const r2 = await m.enc.mudarSituacao(DONO, id, { para: 'CANCELADA', motivo: 'desistiu', devolveuSinal: true })
    expect(r2.ok).toBe(false)
    const lan = await linhas<{ n: number }>(`select count(*)::int n from lancamentos where documento = $1 and tipo = 'DESPESA'`, [m.enc.codigoEncomenda(id)])
    expect(lan[0]!.n).toBe(1)
  })
})

describe('CORRIGIDO 3. filtro "todas": as abertas vêm primeiro, mesmo com 500 antigas', () => {
  it('500 entregues antigas não empurram a encomenda aberta de amanhã para fora do "todas"', async () => {
    await db.exec(`
      insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, valor, sinal, para, situacao, quem, atualizada_em)
      select 'old-' || g, 'org-q', 'uni-q', 'Antiga', 'Bolo antigo', 10, 0, now() - (g || ' days')::interval - interval '30 days', 'ENTREGUE', 'Ana', now()
        from generate_series(1, 500) g;
      insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, valor, sinal, para, quem, atualizada_em)
      values ('enc-amanha', 'org-q', 'uni-q', 'Nova', 'Bolo de amanhã', 90, 0, now() + interval '1 day', 'Ana', now());
    `)
    const todas = await m.enc.listarEncomendas(DONO, { unidadeIds: ['uni-q'], situacao: 'todas' })
    expect(todas.length).toBe(500)
    expect(todas.some((e) => e.id === 'enc-amanha')).toBe(true)
    // Ela existe e aparece no filtro padrão.
    const abertas = await m.enc.listarEncomendas(DONO, { unidadeIds: ['uni-q'] })
    expect(abertas.some((e) => e.id === 'enc-amanha')).toBe(true)
  })
})
