// AUDITORIA (lógica de negócio) — crediário.
//
// Prova, com banco de verdade (PGlite + comoOrg + RLS):
//   A. não existe limite de crédito nem trava de atraso NO SERVIDOR: a cliente
//      com R$ 300 vencidos há 200 dias leva mais R$ 500 no crediário;
//   B. a venda no crediário aceita a ficha INATIVA (juntada em outra): a
//      dívida nova nasce numa ficha sem telefone nem CPF, que ninguém cobra;
//   C. (CORRIGIDO) `receberParcela` com "arredondar" ligado dizia "quitada" e
//      deixava a parcela aberta (o arredondamento saía do principal);
//   D. o desconto dado no recebimento não sai do DRE: a loja recebeu R$ 70 de
//      uma venda de R$ 100 e o resultado continua contando R$ 100;
//   E. Pix recebido com o caixa da loja fechado não entra em turno nenhum —
//      MANTIDO de propósito: é a regra da venda (Pix e cartão sem turno aberto
//      passam; dinheiro não), e o financeiro recebe sem operar caixa;
//   F. (CORRIGIDO) não havia como estornar um recibo lançado errado;
//   G. (CORRIGIDO) a situação do crediário na lista e na busca não filtrava loja;
//   H. (CORRIGIDO) pausar a cobrança não conferia as lojas onde ela deve.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'
import { diaEmSP, somarDias, inicioDoDiaEmSP } from '../src/servidor/dia'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  venda: typeof import('../src/servidor/venda')
  crediario: typeof import('../src/servidor/crediario')
  recibos: typeof import('../src/servidor/recibos')
  fin: typeof import('../src/servidor/financeiro')
  gestao: typeof import('../src/servidor/crediario-gestao')
  autorizacao: typeof import('../src/servidor/autorizacao')
  senha: typeof import('../src/servidor/senha')
}

const DONA: Sessao = { orgId: 'org-c', usuarioId: 'usr-dona', nome: 'Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

const hoje = diaEmSP()
const ha = (n: number) => somarDias(hoje, -n)

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, crediario_max_parcelas, atualizada_em, configurada_em) values
    ('org-c', 'Loja C', 'loja-c', 'REDE', 'ATIVA', '{crediario,multiUnidade}', 12, now(), now());
  update orgs set crediario_juros_mes = 2, crediario_multa_pct = 2;
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-c1', 'org-c', 'Centro', now()),
    ('uni-c2', 'org-c', 'Bairro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-c', 'Dona', 'dona@c.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-c', 'usr-dona', null, 'DONO');
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-c1', 'org-c', 'uni-c1', 'Dona', 0);
  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, ativo, atualizado_em) values
    ('p-blusa', 'org-c', 'Blusa', 'UN', 100, 100, 100, 0, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('var-blusa', 'org-c', 'p-blusa', 'BLU-1', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-c', 'var-blusa', 'uni-c1', 100, now());
  insert into clientes (id, org_id, nome, ativo, atualizado_em) values
    ('cli-devedora', 'org-c', 'Devedora', true, now()),
    ('cli-juntada', 'org-c', 'Devedora (ficha velha)', false, now()),
    ('cli-arred', 'org-c', 'Arredonda', true, now()),
    ('cli-desc', 'org-c', 'Desconto', true, now()),
    ('cli-pix', 'org-c', 'Pix Sem Caixa', true, now());
  update clientes set juntada_na_id = 'cli-devedora', juntada_em = now() where id = 'cli-juntada';
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id, criada_em) values
    ('v-velha', 'org-c', 'uni-c1', 900, 'CONCLUIDA', 300, 'cli-devedora', now() - interval '260 days'),
    ('v-arred', 'org-c', 'uni-c1', 901, 'CONCLUIDA', 100, 'cli-arred', now() - interval '40 days'),
    ('v-pix',   'org-c', 'uni-c2', 1,   'CONCLUIDA', 50,  'cli-pix',  now() - interval '40 days');
  insert into pagamentos (id, org_id, venda_id, forma, valor, parcelas) values
    ('pg-velha', 'org-c', 'v-velha', 'CREDIARIO', 300, 1),
    ('pg-arred', 'org-c', 'v-arred', 'CREDIARIO', 100, 1),
    ('pg-pix',   'org-c', 'v-pix',   'CREDIARIO', 50, 1);
  insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
    ('par-velha', 'org-c', 'v-velha', 'cli-devedora', 'uni-c1', 1, 1, '${ha(200)}', 300),
    ('par-arred', 'org-c', 'v-arred', 'cli-arred',    'uni-c1', 1, 1, '${ha(10)}', 100),
    ('par-pix',   'org-c', 'v-pix',   'cli-pix',      'uni-c2', 1, 1, '${ha(5)}', 50);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 46000 + Math.floor(Math.random() * 2500)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    venda: await import('../src/servidor/venda'),
    crediario: await import('../src/servidor/crediario'),
    recibos: await import('../src/servidor/recibos'),
    fin: await import('../src/servidor/financeiro'),
    gestao: await import('../src/servidor/crediario-gestao'),
    autorizacao: await import('../src/servidor/autorizacao'),
    senha: await import('../src/servidor/senha'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const um = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!

const fiado = (clienteId: string, qtd: number, parcelas: number) =>
  m.venda.registrarVenda(DONA, {
    unidadeId: 'uni-c1', caixaId: 'cx-c1', clienteId,
    itens: [{ variacaoId: 'var-blusa', quantidade: qtd }],
    pagamentos: [{ forma: 'CREDIARIO', valor: 100 * qtd, parcelas }],
  })

describe('A. limite e atraso', () => {
  it('cliente com R$ 300 vencidos há 200 dias compra mais R$ 500 no crediário — o servidor aceita', async () => {
    const antes = await m.crediario.situacaoDeCredito(DONA, 'cli-devedora', 'uni-c1')
    console.log('[auditoria] antes da venda:', { devendo: antes?.devendo, vencido: antes?.vencido, dias: antes?.diasMaisAntiga, atrasoHoje: antes?.atrasoHoje })
    expect(antes?.vencido).toBe(300)
    expect(antes?.diasMaisAntiga).toBe(200)
    const r = await fiado('cli-devedora', 5, 10)
    console.log('[auditoria] venda de R$ 500 em 10x para quem deve R$ 300 vencidos:', r.ok ? 'ACEITA' : r)
    expect(r.ok).toBe(true)
  })
})

describe('B. ficha inativa (juntada)', () => {
  it('CORRIGIDO (venda.ts, outra frente): a venda no crediário não entra na ficha inativa, já juntada em outra', async () => {
    const r = await fiado('cli-juntada', 1, 2)
    expect(r.ok).toBe(false)
    const n = await um<{ n: number }>(`select count(*)::int n from parcelas where cliente_id = 'cli-juntada'`)
    console.log('[auditoria] parcelas novas na ficha INATIVA/juntada:', n.n)
    expect(n.n).toBe(0)
  })
})

describe('C. receberParcela com "arredondar"', () => {
  it('CORRIGIDO: "quitada" é saldo zero — o arredondamento não sai do valor da parcela', async () => {
    await db.query(`update orgs set crediario_arredondar = true where id = 'org-c'`)
    const agora = new Date()
    const regra = { multaPct: 2, jurosMes: 2, carenciaDias: 0 }
    const e = m.crediario.encargosDeHoje({ restaC: 10000, vencimento: new Date(`${ha(10)}T00:00:00Z`), jurosAte: null, multaCobrada: false }, regra, agora)
    const sugerido = (e.multaC + e.jurosC) / 100
    const r = await m.crediario.receberParcela(DONA, { parcelaId: 'par-arred', valor: 100 + sugerido, juros: sugerido, forma: 'PIX' }, agora)
    const p = await um<{ valor: string; pago: string; quitada_em: Date | null }>(`select valor, pago, quitada_em from parcelas where id = 'par-arred'`)
    console.log('[auditoria] receberParcela devolveu:', r, '· parcela no banco:', p)
    await db.query(`update orgs set crediario_arredondar = false where id = 'org-c'`)
    expect(r).toMatchObject({ ok: true, quitada: true, restante: 0 })
    expect(p.quitada_em).not.toBeNull()
    expect(Math.round((Number(p.valor) - Number(p.pago)) * 100)).toBe(0)
  })
})

describe('D. desconto no recebimento e o DRE', () => {
  it('CORRIGIDO (financeiro, outra frente): recebeu R$ 70 de uma venda de R$ 100 (R$ 30 de desconto): o DRE perde os R$ 30', async () => {
    const v = await fiado('cli-desc', 1, 1)
    if (!v.ok) throw new Error(JSON.stringify(v))
    const de = inicioDoDiaEmSP(hoje)
    const ate = new Date(Date.now() + 3600_000)
    const antes = await m.fin.montarDRE(DONA, ['uni-c1'], de, ate)
    const par = await um<{ id: string }>(`select id from parcelas where venda_id = $1`, [v.vendaId])
    const r = await m.recibos.receberVarias(DONA, {
      clienteId: 'cli-desc', unidadeId: 'uni-c1', parcelaIds: [par.id],
      formas: [{ forma: 'PIX', valor: 70 }], desconto: 30, motivo: 'acordo de cobrança',
    })
    expect(r.ok).toBe(true)
    const depois = await m.fin.montarDRE(DONA, ['uni-c1'], de, ate)
    console.log('[auditoria] DRE resultado antes/depois do desconto de R$ 30:', antes.resultado, depois.resultado)
    expect(Math.round((antes.resultado - depois.resultado) * 100)).toBe(3000) // os R$ 30 que a loja abriu mão saem do resultado
  })
})

describe('E. Pix com o caixa fechado', () => {
  it('MANTIDO (a regra da venda): o recebimento no Pix entra sem turno', async () => {
    const r = await m.recibos.receberVarias(DONA, {
      clienteId: 'cli-pix', unidadeId: 'uni-c2', parcelaIds: [], formas: [{ forma: 'PIX', valor: 50 }],
    })
    expect(r.ok).toBe(true)
    const rec = await um<{ caixa_id: string | null; valor: string }>(`select caixa_id, valor from recebimentos where parcela_id = 'par-pix'`)
    console.log('[auditoria] recebimento Pix com caixa fechado:', rec)
    expect(rec.caixa_id).toBeNull()
  })
})

const GER_C1: Sessao = { orgId: 'org-c', usuarioId: 'usr-ger', nome: 'Gerente Centro', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-c1', expiraEm: null }] }
const PIN_DONA = '258014'

describe('F. estorno de recibo', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into usuarios (id, org_id, nome, email, atualizado_em) values ('usr-ger', 'org-c', 'Gerente Centro', 'g@c.com', now());
      insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-ger', 'org-c', 'usr-ger', 'uni-c1', 'GERENTE');
      insert into clientes (id, org_id, nome, ativo, atualizado_em) values ('cli-est', 'org-c', 'Estorno', true, now());
      insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id, criada_em) values
        ('v-est', 'org-c', 'uni-c1', 910, 'CONCLUIDA', 100, 'cli-est', now() - interval '40 days');
      insert into pagamentos (id, org_id, venda_id, forma, valor, parcelas) values ('pg-est', 'org-c', 'v-est', 'CREDIARIO', 100, 1);
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
        ('par-est', 'org-c', 'v-est', 'cli-est', 'uni-c1', 1, 1, '${ha(10)}', 100);
    `)
    const hash = await m.senha.guardarSenha('senha-boa-123')
    await db.query(`update usuarios set senha_hash = $1 where id = 'usr-dona'`, [hash])
    expect(await m.autorizacao.definirMeuPin(DONA, 'senha-boa-123', PIN_DONA)).toEqual({ ok: true })
  })

  const parcela = () =>
    um<{ pago: string; juros: string; multa: string; multa_cobrada: boolean; juros_ate: Date | null; quitada_em: Date | null }>(
      `select pago, juros, multa, multa_cobrada, juros_ate, quitada_em from parcelas where id = 'par-est'`,
    )
  const receber = async (forma: 'DINHEIRO' | 'PIX', valor?: number) => {
    const ficha = await m.recibos.fichaParaReceber(DONA, 'cli-est', 'uni-c1')
    const p = ficha!.parcelas[0]!
    const tudo = (p.restaC + p.multaC + p.jurosC) / 100
    const r = await m.recibos.receberVarias(DONA, { clienteId: 'cli-est', unidadeId: 'uni-c1', parcelaIds: ['par-est'], formas: [{ forma, valor: valor ?? tudo }] })
    if (!r.ok) throw new Error(r.erro)
    return r.reciboId
  }

  it('CORRIGIDO: estorna o recibo lançado errado — a parcela volta a ser o que era e o recibo sai do turno', async () => {
    const antes = await parcela()
    const id = await receber('DINHEIRO')
    expect((await parcela()).quitada_em).not.toBeNull()

    // Precisa de motivo, de quem pode cancelar venda, e do PIN de quem estorna.
    expect(await m.recibos.estornarRecibo(DONA, { reciboId: id, motivo: '' })).toMatchObject({ ok: false })
    expect(await m.recibos.estornarRecibo({ ...GER_C1, acessos: [{ papel: 'BALCAO', unidadeId: 'uni-c1', expiraEm: null }] }, { reciboId: id, motivo: 'cliente errada' }))
      .toMatchObject({ ok: false })
    expect(await m.recibos.estornarRecibo(DONA, { reciboId: id, motivo: 'cliente errada' })).toMatchObject({ ok: false, precisaPin: true })

    const r = await m.recibos.estornarRecibo(DONA, { reciboId: id, motivo: 'cliente errada', pin: PIN_DONA })
    expect(r).toMatchObject({ ok: true, saldoDepois: 100, turnoAberto: true })
    expect(await parcela()).toEqual(antes)
    expect((await um<{ n: number }>(`select count(*)::int n from recebimentos where parcela_id = 'par-est'`)).n).toBe(0)
    expect((await um<{ n: number }>(`select count(*)::int n from recibos_crediario where id = $1`, [id])).n).toBe(0)
    const livro = await um<{ assinado: boolean; motivo: string }>(`select assinado, motivo from auditoria where acao = 'crediario.estornou' and alvo_id = 'cli-est'`)
    expect(livro.assinado).toBe(true)
    expect(livro.motivo).toMatch(/cliente errada/)
  })

  it('só o mais novo de cada parcela, e só com o turno aberto', async () => {
    const primeiro = await receber('PIX', 30)
    const segundo = await receber('PIX', 20)
    expect(await m.recibos.estornarRecibo(DONA, { reciboId: primeiro, motivo: 'valor errado', pin: PIN_DONA })).toMatchObject({
      ok: false, erro: expect.stringMatching(/mais novo/),
    })
    expect(await m.recibos.estornarRecibo(DONA, { reciboId: segundo, motivo: 'valor errado', pin: PIN_DONA })).toMatchObject({ ok: true })
    expect(await m.recibos.estornarRecibo(DONA, { reciboId: primeiro, motivo: 'valor errado', pin: PIN_DONA })).toMatchObject({ ok: true })
    expect(Number((await parcela()).pago)).toBe(0)

    const doTurno = await receber('DINHEIRO')
    await db.query(`update caixas set aberto = false where id = 'cx-c1'`)
    try {
      expect(await m.recibos.estornarRecibo(DONA, { reciboId: doTurno, motivo: 'valor errado', pin: PIN_DONA })).toMatchObject({
        ok: false, erro: expect.stringMatching(/turno/),
      })
    } finally {
      await db.query(`update caixas set aberto = true where id = 'cx-c1'`)
    }
  })
})

describe('G. a situação do crediário respeita a loja de quem vê', () => {
  it('CORRIGIDO: a gerente do Centro não vê, na lista e na busca, a dívida da cliente no Bairro', async () => {
    await db.exec(`
      insert into clientes (id, org_id, nome, ativo, atualizado_em) values ('cli-duas', 'org-c', 'Duas Lojas', true, now());
      insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id, criada_em) values
        ('v-duas1', 'org-c', 'uni-c1', 911, 'CONCLUIDA', 100, 'cli-duas', now()),
        ('v-duas2', 'org-c', 'uni-c2', 2, 'CONCLUIDA', 50, 'cli-duas', now());
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
        ('par-duas1', 'org-c', 'v-duas1', 'cli-duas', 'uni-c1', 1, 1, '${somarDias(hoje, 20)}', 100),
        ('par-duas2', 'org-c', 'v-duas2', 'cli-duas', 'uni-c2', 1, 1, '${somarDias(hoje, 20)}', 50);
    `)
    const sit = (s?: Sessao) => m.banco.comoOrg('org-c', (d) => m.crediario.situacaoDosClientes(d, ['cli-duas'], s))
    expect((await sit(GER_C1)).get('cli-duas')).toEqual({ devendo: 100, vencido: 0 })
    expect((await sit(DONA)).get('cli-duas')).toEqual({ devendo: 150, vencido: 0 })
    const semCrediario: Sessao = { ...GER_C1, acessos: [{ papel: 'CONTADOR', unidadeId: null, expiraEm: null }] }
    expect((await sit(semCrediario)).size).toBe(0)
  })
})

describe('H. pausar a cobrança', () => {
  it('CORRIGIDO: quem não negocia em TODAS as lojas onde ela deve não pausa (nem retoma)', async () => {
    expect(await m.gestao.pausarCobranca(GER_C1, 'cli-duas', true, 'acordo com advogado')).toMatchObject({ ok: false })
    expect((await um<{ p: Date | null }>(`select cobranca_pausada_em p from clientes where id = 'cli-duas'`)).p).toBeNull()
    expect(await m.gestao.pausarCobranca(DONA, 'cli-duas', true, 'acordo com advogado')).toEqual({ ok: true })
    expect(await m.gestao.pausarCobranca(GER_C1, 'cli-duas', false, '')).toMatchObject({ ok: false })
  })
})
