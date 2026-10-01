// As correções da auditoria que precisaram de coluna nova (migração
// 20260928203401_correcoes-auditoria), com banco de verdade (PGlite exposto
// numa porta, como em correcoes-balcao.test.ts): tudo passa pelo comoOrg —
// papel sem privilégio e RLS valendo.
//
//   1. sinal de encomenda em dinheiro passa pela gaveta
//   2. a venda que recebe a encomenda aponta para ela (Venda.encomendaId)
//   3. apagar parcela nunca leva o recebimento junto
//   4. o juro do crediário não cobra duas vezes os mesmos dias
//   5. a taxa da maquininha é a do dia da venda
//   6. transferência marcada por id, não pelo texto
//   7. telefone da equipe só vale confirmado

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import type { Canal } from '../src/servidor/assistente/canal'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  banco: typeof import('../src/servidor/banco')
  venda: typeof import('../src/servidor/venda')
  caixa: typeof import('../src/servidor/caixa')
  crediario: typeof import('../src/servidor/crediario')
  encomenda: typeof import('../src/servidor/encomenda')
  taxas: typeof import('../src/servidor/taxas')
  estoque: typeof import('../src/servidor/estoque')
  equipe: typeof import('../src/servidor/equipe')
  contexto: typeof import('../src/servidor/assistente/contexto')
  confirmacao: typeof import('../src/servidor/assistente/confirmacao')
  conversa: typeof import('../src/servidor/assistente/conversa')
  canal: typeof import('../src/servidor/assistente/canal')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-a',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

const DONA = sessao('usr-dona', 'Dona Ana', [{ papel: 'DONO', unidadeId: null }])
const BALCAO = sessao('usr-bal', 'Beto Balcão', [{ papel: 'BALCAO', unidadeId: 'uni-a1' }])
const GIL = sessao('usr-gil', 'Gil Gerente', [{ papel: 'GERENTE', unidadeId: 'uni-a1' }])

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, crediario_juros_mes, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,encomenda,multiUnidade}', 2, now(), now()),
    ('org-b', 'Loja B', 'loja-b', 'REDE', 'ATIVA', '{}', 2, now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, now()),
    ('uni-a2', 'org-a', 'Loja Sem Caixa', false, true, now()),
    ('uni-a3', 'org-a', 'Loja Taxas', false, true, now());

  insert into usuarios (id, org_id, nome, email, telefone, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona Ana', 'dona@a.com', '(71) 99999-0001', now()),
    ('usr-bal', 'org-a', 'Beto Balcão', 'beto@a.com', '(71) 98888-0002', now()),
    ('usr-gil', 'org-a', 'Gil Gerente', 'gil@a.com', '(71) 97777-0003', now()),
    ('usr-b', 'org-b', 'Vizinha', 'viz@b.com', '(71) 96666-0004', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-bal', 'org-a', 'usr-bal', 'uni-a1', 'BALCAO'),
    ('ac-gil', 'org-a', 'usr-gil', 'uni-a1', 'GERENTE'),
    ('ac-b', 'org-b', 'usr-b', null, 'DONO');

  insert into agentes (id, org_id, nome, ativo, canal, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, 'ZAPI', now());

  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('cat-desp', 'org-a', 'Outras despesas', 'DESPESA', 'OUTRA'),
    ('cat-rec',  'org-a', 'Outras receitas', 'RECEITA', 'RECEITA_OUTRA');

  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, ativo, atualizado_em) values
    ('p-cam', 'org-a', 'Camiseta', 'UN', 100.00, 100.00, 100.00, 40.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-cam', 'org-a', 'p-cam', 'CAM-1', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-cam', 'uni-a1', 100, now()),
    ('e3', 'org-a', 'var-cam', 'uni-a3', 100, now());

  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Beto Balcão', 100);

  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-a', 'Cliente Um', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 58000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    venda: await import('../src/servidor/venda'),
    caixa: await import('../src/servidor/caixa'),
    crediario: await import('../src/servidor/crediario'),
    encomenda: await import('../src/servidor/encomenda'),
    taxas: await import('../src/servidor/taxas'),
    estoque: await import('../src/servidor/estoque'),
    equipe: await import('../src/servidor/equipe'),
    contexto: await import('../src/servidor/assistente/contexto'),
    confirmacao: await import('../src/servidor/assistente/confirmacao'),
    conversa: await import('../src/servidor/assistente/conversa'),
    canal: await import('../src/servidor/assistente/canal'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const um = async <T,>(sql: string, p: unknown[] = []) => (await linhas<T>(sql, p))[0]!

// ─────────────────────────────────────────────────────────────
describe('1. o sinal da encomenda em dinheiro passa pela gaveta', () => {
  const daqui2dias = () => m.encomenda.diaEmSP(new Date(Date.now() + 2 * 864e5))
  const dados = (extra: Record<string, unknown> = {}) => ({
    unidadeId: 'uni-a1',
    clienteNome: 'Marta',
    descricao: 'Bolo de chocolate 2 kg',
    valor: 120,
    sinal: 50,
    sinalForma: 'DINHEIRO' as const,
    dia: daqui2dias(),
    hora: '15:00',
    entrega: false,
    ...extra,
  })
  const movs = (encomendaId: string) =>
    linhas<{ tipo: string; valor: string; caixa_id: string }>(
      `select tipo::text as tipo, valor, caixa_id from caixa_movimentos where encomenda_id = $1 order by criado_em, tipo`,
      [encomendaId],
    )

  it('anotar com sinal em dinheiro: suprimento no caixa aberto, ligado à encomenda, e o esperado da gaveta sobe', async () => {
    const antes = await m.caixa.conferirCaixa(DONA, 'cx-a1')
    const r = await m.encomenda.criarEncomenda(BALCAO, dados())
    if (!r.ok) throw new Error(r.erro)
    expect(await movs(r.id)).toEqual([{ tipo: 'SUPRIMENTO', valor: '50.00', caixa_id: 'cx-a1' }])
    const depois = await m.caixa.conferirCaixa(DONA, 'cx-a1')
    expect(depois.esperado - antes.esperado).toBeCloseTo(50)
    expect(depois.suprimentos - antes.suprimentos).toBeCloseTo(50)
    // O lançamento do financeiro continua (o DRE precisa dele).
    const { n } = await um<{ n: number }>(`select count(*)::int n from lancamentos where documento = $1 and tipo = 'RECEITA'`, [
      m.encomenda.codigoEncomenda(r.id),
    ])
    expect(n).toBe(1)
    const { forma } = await um<{ forma: string }>(`select sinal_forma::text as forma from encomendas where id = $1`, [r.id])
    expect(forma).toBe('DINHEIRO')
  })

  it('sem caixa aberto na loja, o sinal em dinheiro é recusado — e nada fica gravado', async () => {
    const r = await m.encomenda.criarEncomenda(DONA, dados({ unidadeId: 'uni-a2', descricao: 'Torta sem caixa' }))
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.erro).toMatch(/caixa desta loja está fechado/)
    const { n } = await um<{ n: number }>(`select count(*)::int n from encomendas where descricao = 'Torta sem caixa'`)
    expect(n).toBe(0)
  })

  it('sinal em Pix não passa pela gaveta: só o lançamento; e sinal sem forma é recusado', async () => {
    const semForma = await m.encomenda.criarEncomenda(BALCAO, dados({ sinalForma: null }))
    expect(semForma).toMatchObject({ ok: false })
    const r = await m.encomenda.criarEncomenda(DONA, dados({ sinalForma: 'PIX', unidadeId: 'uni-a2' }))
    if (!r.ok) throw new Error(r.erro)
    expect(await movs(r.id)).toEqual([])
    const { n } = await um<{ n: number }>(`select count(*)::int n from lancamentos where documento = $1`, [m.encomenda.codigoEncomenda(r.id)])
    expect(n).toBe(1)
  })

  it('mudar o sinal: o complemento em dinheiro é suprimento; a devolução em dinheiro é sangria; sem dizer como, recusa', async () => {
    const r = await m.encomenda.criarEncomenda(BALCAO, dados({ sinalForma: 'PIX' }))
    if (!r.ok) throw new Error(r.erro)
    const { unidadeId: _u, ...semLoja } = dados()
    expect(await m.encomenda.editarEncomenda(BALCAO, r.id, { ...semLoja, sinal: 70, sinalForma: null })).toMatchObject({ ok: false })
    expect(await m.encomenda.editarEncomenda(BALCAO, r.id, { ...semLoja, sinal: 70, sinalForma: 'DINHEIRO' })).toMatchObject({ ok: true })
    expect(await m.encomenda.editarEncomenda(DONA, r.id, { ...semLoja, sinal: 40, sinalForma: 'DINHEIRO' })).toMatchObject({ ok: true })
    expect(await movs(r.id)).toEqual([
      { tipo: 'SUPRIMENTO', valor: '20.00', caixa_id: 'cx-a1' },
      { tipo: 'SANGRIA', valor: '30.00', caixa_id: 'cx-a1' },
    ])
    // A forma guardada é a do último dinheiro que ENTROU.
    const { forma } = await um<{ forma: string }>(`select sinal_forma::text as forma from encomendas where id = $1`, [r.id])
    expect(forma).toBe('DINHEIRO')
  })

  it('cancelar devolvendo o sinal pago em dinheiro: sangria do caixa aberto; sem caixa, a devolução em dinheiro é recusada', async () => {
    const r = await m.encomenda.criarEncomenda(BALCAO, dados())
    if (!r.ok) throw new Error(r.erro)
    const c = await m.encomenda.mudarSituacao(DONA, r.id, { para: 'CANCELADA', motivo: 'desistiu', devolveuSinal: true })
    expect(c).toMatchObject({ ok: true })
    expect(await movs(r.id)).toEqual([
      { tipo: 'SUPRIMENTO', valor: '50.00', caixa_id: 'cx-a1' },
      { tipo: 'SANGRIA', valor: '50.00', caixa_id: 'cx-a1' },
    ])

    // Loja sem caixa: sinal pago em Pix, devolvido em dinheiro → recusa limpa.
    const s = await m.encomenda.criarEncomenda(DONA, dados({ unidadeId: 'uni-a2', sinalForma: 'PIX' }))
    if (!s.ok) throw new Error(s.erro)
    const x = await m.encomenda.mudarSituacao(DONA, s.id, {
      para: 'CANCELADA', motivo: 'desistiu', devolveuSinal: true, formaDevolucao: 'DINHEIRO',
    })
    expect(x).toMatchObject({ ok: false })
    const { sit } = await um<{ sit: string }>(`select situacao::text as sit from encomendas where id = $1`, [s.id])
    expect(sit).toBe('ABERTA')
    // Devolvido em Pix (a forma do pagamento, sem precisar dizer): sem gaveta.
    expect(await m.encomenda.mudarSituacao(DONA, s.id, { para: 'CANCELADA', motivo: 'desistiu', devolveuSinal: true })).toMatchObject({ ok: true })
    expect(await movs(s.id)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
describe('2. a venda que recebe a encomenda aponta para ela', () => {
  it('Receber no balcão grava Venda.encomendaId (e não texto na observação); a lista mostra a venda', async () => {
    const e = await m.encomenda.criarEncomenda(BALCAO, {
      unidadeId: 'uni-a1', clienteNome: 'Rui', descricao: 'Buquê de rosas', valor: 90, sinal: 30, sinalForma: 'PIX',
      dia: m.encomenda.diaEmSP(new Date(Date.now() + 3 * 864e5)), hora: '10:00', entrega: false,
    })
    if (!e.ok) throw new Error(e.erro)
    const v = await m.venda.registrarVenda(BALCAO, {
      unidadeId: 'uni-a1', itens: [], encomendaId: e.id, pagamentos: [{ forma: 'PIX', valor: 60 }],
    })
    if (!v.ok) throw new Error(v.motivo)
    const venda = await um<{ encomenda_id: string; observacoes: string | null }>(
      `select encomenda_id, observacoes from vendas where id = $1`, [v.vendaId],
    )
    expect(venda).toEqual({ encomenda_id: e.id, observacoes: null })
    const enc = await um<{ s: string; o: string | null }>(`select situacao::text s, observacao o from encomendas where id = $1`, [e.id])
    expect(enc).toEqual({ s: 'ENTREGUE', o: null })
    const lista = await m.encomenda.listarEncomendas(DONA, { unidadeIds: ['uni-a1'], situacao: 'ENTREGUE' })
    expect(lista.find((x) => x.id === e.id)?.venda).toEqual({ id: v.vendaId, numero: v.numero })

    // O banco garante: uma encomenda, uma venda.
    await expect(
      db.query(
        `insert into vendas (id, org_id, unidade_id, numero, situacao, total, encomenda_id) values ('v-dupla', 'org-a', 'uni-a1', 999, 'CONCLUIDA', 1, $1)`,
        [e.id],
      ),
    ).rejects.toThrow(/unique|duplicate/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('3 e 4. crediário: recebimento preso à parcela, e o juro sem cobrar duas vezes', () => {
  const AGORA = new Date('2026-10-10T15:00:00-03:00')

  it('R$ 100 com 30 dias de atraso a 2% ao mês: paga 50 + 2,00; uma semana depois o juro sugerido é 0,23 (e não 1,23)', async () => {
    await db.exec(`
      insert into vendas (id, org_id, unidade_id, numero, situacao, total, cliente_id, criada_em) values
        ('v-fiado', 'org-a', 'uni-a1', 900, 'CONCLUIDA', 100, 'cli-1', '2026-08-11');
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
        ('par-1', 'org-a', 'v-fiado', 'cli-1', 'uni-a1', 1, 1, '2026-09-10', 100);
    `)
    const hoje = (await m.crediario.listarParcelas(DONA, { unidadeIds: ['uni-a1'] }, AGORA)).find((p) => p.id === 'par-1')!
    expect(hoje.diasAtraso).toBe(30)
    expect(hoje.jurosHoje).toBe(2)

    const r = await m.crediario.receberParcela(DONA, { parcelaId: 'par-1', valor: 52, juros: 2, forma: 'PIX' }, AGORA)
    expect(r).toMatchObject({ ok: true, restante: 50 })
    const { ate } = await um<{ ate: string }>(`select to_char(juros_ate, 'YYYY-MM-DD') ate from parcelas where id = 'par-1'`)
    expect(ate).toBe('2026-10-10')

    const semana = (await m.crediario.listarParcelas(DONA, { unidadeIds: ['uni-a1'] }, new Date(AGORA.getTime() + 7 * 864e5))).find(
      (p) => p.id === 'par-1',
    )!
    expect(semana.diasAtraso).toBe(37)
    expect(semana.diasJuros).toBe(7)
    expect(semana.jurosHoje).toBe(0.23)
  })

  // Mudou com o recibo (recibos.ts): perdoar o atraso agora é decisão de quem
  // negocia o crediário, registrada — e os dias perdoados ficam resolvidos.
  // Antes o "juros até" ficava parado, e o recebimento seguinte cobrava de
  // novo o juro dos dias que a loja tinha perdoado.
  it('pagar sem juro (a loja perdoou) resolve o juro até hoje: os dias perdoados não voltam', async () => {
    const r = await m.crediario.receberParcela(DONA, { parcelaId: 'par-1', valor: 10, juros: 0, forma: 'PIX' }, new Date(AGORA.getTime() + 864e5))
    expect(r).toMatchObject({ ok: true, juros: 0 })
    const { ate } = await um<{ ate: string }>(`select to_char(juros_ate, 'YYYY-MM-DD') ate from parcelas where id = 'par-1'`)
    expect(ate).toBe('2026-10-11')
  })

  it('apagar parcela que recebeu dinheiro é recusado pelo banco — o recebimento não some junto', async () => {
    await expect(db.query(`delete from parcelas where id = 'par-1'`)).rejects.toThrow(/foreign key|violates/)
    const { n } = await um<{ n: number }>(`select count(*)::int n from recebimentos where parcela_id = 'par-1'`)
    expect(n).toBe(2)
  })

  it('cancelar venda no crediário sem recebimento continua apagando as parcelas', async () => {
    const v = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', clienteId: 'cli-1', itens: [{ variacaoId: 'var-cam', quantidade: 1 }],
      pagamentos: [{ forma: 'CREDIARIO', valor: 100, parcelas: 2 }],
    })
    if (!v.ok) throw new Error(v.motivo)
    expect(await m.venda.cancelarVenda(DONA, v.vendaId, 'errou o cliente')).toMatchObject({ ok: true })
    const { n } = await um<{ n: number }>(`select count(*)::int n from parcelas where venda_id = $1`, [v.vendaId])
    expect(n).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
describe('5. a taxa da maquininha é a do dia da venda', () => {
  it('grava a taxa no pagamento; mudar a taxa depois não reescreve a venda; pagamento antigo (sem taxa) usa a de hoje', async () => {
    await db.exec(`insert into taxas_pagamento (id, org_id, forma, parcelas, percentual, atualizada_em) values ('tx-cred', 'org-a', 'CREDITO', 1, 3, now())`)
    const de = new Date(Date.now() - 60_000)
    const v = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a3', itens: [{ variacaoId: 'var-cam', quantidade: 1 }], pagamentos: [{ forma: 'CREDITO', valor: 100 }],
    })
    if (!v.ok) throw new Error(v.motivo)
    const { pct } = await um<{ pct: string }>(`select taxa_pct pct from pagamentos where venda_id = $1`, [v.vendaId])
    expect(Number(pct)).toBe(3)

    await db.exec(`update taxas_pagamento set percentual = 5 where id = 'tx-cred'`)
    const ate = new Date(Date.now() + 60_000)
    const periodo = () => m.banco.comoOrg('org-a', (tx) => m.taxas.taxasDoPeriodo(tx, ['uni-a3'], de, ate))
    expect((await periodo()).totalCent).toBe(300)

    // Uma venda de antes da coluna: taxa nula → a de hoje (5%).
    const w = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a3', itens: [{ variacaoId: 'var-cam', quantidade: 1 }], pagamentos: [{ forma: 'CREDITO', valor: 100 }],
    })
    if (!w.ok) throw new Error(w.motivo)
    await db.query(`update pagamentos set taxa_pct = null where venda_id = $1`, [w.vendaId])
    const r = await periodo()
    expect(r.totalCent).toBe(800)
    expect(r.porForma).toEqual([{ forma: 'CREDITO', parcelado: false, valorCent: 20000, taxaCent: 800, percentual: 4 }])

    // Dinheiro grava taxa zero (não nula): nunca cai na régua de "venda antiga".
    const d = await m.venda.registrarVenda(DONA, {
      unidadeId: 'uni-a1', itens: [{ variacaoId: 'var-cam', quantidade: 1 }], pagamentos: [{ forma: 'DINHEIRO', valor: 100 }],
    })
    if (!d.ok) throw new Error(d.motivo)
    const { pct: z } = await um<{ pct: string }>(`select taxa_pct pct from pagamentos where venda_id = $1`, [d.vendaId])
    expect(Number(z)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
describe('6. transferência marcada por id', () => {
  it('as duas pernas levam o mesmo transferencia_id; entrada comum fica sem', async () => {
    const r = await m.estoque.transferir(DONA, { variacaoId: 'var-cam', deUnidadeId: 'uni-a1', paraUnidadeId: 'uni-a3', quantidade: 2 })
    expect(r).toMatchObject({ ok: true })
    const pernas = await linhas<{ tipo: string; t: string | null }>(
      `select tipo::text tipo, transferencia_id t from movimentos_estoque where tipo in ('TRANSFERENCIA') or (tipo = 'ENTRADA' and motivo like 'Transferência de%') order by tipo`,
    )
    expect(pernas).toHaveLength(2)
    expect(pernas[0]!.t).toBeTruthy()
    expect(pernas[0]!.t).toBe(pernas[1]!.t)

    await m.estoque.mexerEstoque(DONA, { variacaoId: 'var-cam', unidadeId: 'uni-a1', tipo: 'ENTRADA', quantidade: 5, motivo: 'Transferência de fornecedor' })
    const { t } = await um<{ t: string | null }>(`select transferencia_id t from movimentos_estoque where motivo = 'Transferência de fornecedor'`)
    expect(t).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
describe('7. telefone da equipe só vale confirmado', () => {
  const DONA_WA = '5571999990001'
  const BETO_WA = '5571988880002'
  const GIL_WA = '5571977770003'

  /** Um canal "real" que só anota o que mandaria — de onde o teste lê o código. */
  const canalQueAnota = () => {
    const enviadas: { numero: string; texto: string }[] = []
    const c: Canal = { nome: 'teste-real', real: true, enviar: async (numero, texto) => (enviadas.push({ numero, texto }), { ok: true }) }
    return { canal: c, enviadas, codigo: () => /(\d{6})/.exec(enviadas.at(-1)?.texto ?? '')?.[1] ?? '' }
  }

  it('a regra pura: sem telefone, falta confirmar, confirmado, trocado, e vencido depois de 180 dias sem mensagem', () => {
    const { estadoDoTelefone } = m.confirmacao
    const agora = new Date('2026-10-01T12:00:00Z')
    const base = { telefone: '(71) 99999-0001', telefoneConfirmado: '7199990001', telefoneConfirmadoEm: new Date('2026-09-01'), telefoneVistoEm: null }
    expect(estadoDoTelefone({ ...base, telefone: null }, agora)).toBe('sem_telefone')
    expect(estadoDoTelefone({ ...base, telefoneConfirmadoEm: null }, agora)).toBe('falta_confirmar')
    expect(estadoDoTelefone(base, agora)).toBe('confirmado')
    expect(estadoDoTelefone({ ...base, telefone: '(71) 99999-0009' }, agora)).toBe('falta_confirmar')
    const longe = new Date(base.telefoneConfirmadoEm.getTime() + 181 * 864e5)
    expect(estadoDoTelefone(base, longe)).toBe('vencido')
    expect(estadoDoTelefone({ ...base, telefoneVistoEm: new Date(longe.getTime() - 10 * 864e5) }, longe)).toBe('confirmado')
  })

  it('lê "CONFIRMAR 123456" em qualquer forma razoável, e nada além disso', () => {
    const { lerPedidoDeConfirmacao: ler } = m.confirmacao
    expect(ler('CONFIRMAR 123456')).toBe('123456')
    expect(ler('  confirmar: 123 456 ')).toBe('123456')
    expect(ler('*Confirmar* 123-456')).toBe('123456')
    expect(ler('confirmar o pedido 2')).toBeNull()
    expect(ler('123456')).toBeNull()
  })

  it('número só digitado é cliente: sem assistente e sem relatório', async () => {
    expect((await m.contexto.acharInterlocutor('org-a', DONA_WA, null)).quem.tipo).toBe('cliente')
    expect(await m.contexto.donosComTelefone('org-a')).toEqual([])
  })

  it('código mandado pelo WhatsApp e digitado na tela: confirma; errado conta tentativa', async () => {
    const c = canalQueAnota()
    const r = await m.confirmacao.pedirCodigo(DONA, 'enviar', { canal: c.canal })
    expect(r).toMatchObject({ ok: true, modo: 'enviado' })
    expect(c.enviadas[0]!.numero).toBe(DONA_WA)
    // O resumo, nunca o código.
    const { h } = await um<{ h: string }>(`select codigo_hash h from confirmacoes_telefone where usuario_id = 'usr-dona'`)
    expect(h).not.toContain(c.codigo())

    const errado = c.codigo() === '000000' ? '111111' : '000000'
    expect(await m.confirmacao.confirmarNaTela(DONA, errado)).toMatchObject({ ok: false, erro: expect.stringMatching(/Restam 4/) })
    // O código ENVIADO não vale mandado de volta pelo WhatsApp (quem pôs o
    // próprio celular na conta da dona o receberia).
    expect(await m.confirmacao.confirmarPorMensagem('org-a', DONA_WA, `CONFIRMAR ${c.codigo()}`)).toBeNull()

    expect(await m.confirmacao.confirmarNaTela(DONA, c.codigo())).toEqual({ ok: true })
    const quem = await m.contexto.acharInterlocutor('org-a', DONA_WA, null)
    expect(quem.quem.tipo).toBe('equipe')
    expect((await m.contexto.donosComTelefone('org-a')).map((d) => d.usuarioId)).toEqual(['usr-dona'])
  })

  it('código mostrado na tela e mandado do celular: só vale do número certo, e responde quem mandou', async () => {
    const r = await m.confirmacao.pedirCodigo(BALCAO, 'mostrar')
    if (!r.ok || r.modo !== 'mostrar') throw new Error('sem código')
    // De outro número: não é com ele — segue o caminho de sempre.
    expect(await m.confirmacao.confirmarPorMensagem('org-a', GIL_WA, `CONFIRMAR ${r.codigo}`)).toBeNull()
    // Digitar na tela o código que a tela mostrou não vale.
    expect(await m.confirmacao.confirmarNaTela(BALCAO, r.codigo)).toMatchObject({ ok: false })
    // Código errado, do número certo: tratado, e conta tentativa.
    const errado = r.codigo === '000000' ? '111111' : '000000'
    expect(await m.confirmacao.confirmarPorMensagem('org-a', BETO_WA, `CONFIRMAR ${errado}`)).toMatchObject({ tratou: true, confirmou: false })

    // Pelo laço da conversa (o assistente nem está ligado nesta empresa).
    const canal = new m.canal.CanalFalso()
    const d = await m.conversa.processarMensagem(
      { orgId: 'org-a', telefone: BETO_WA, nome: 'Beto', texto: `confirmar ${r.codigo.slice(0, 3)} ${r.codigo.slice(3)}`, idExterno: 'conf-1' },
      { canal },
    )
    expect(d).toEqual({ tipo: 'confirmacao', confirmou: true })
    expect(canal.enviadas.at(-1)?.texto).toMatch(/Pronto, Beto/)
    expect((await m.contexto.acharInterlocutor('org-a', BETO_WA, null)).quem.tipo).toBe('equipe')

    // A mesma mensagem entregue de novo: não vira conversa com a IA.
    const de2 = await m.conversa.processarMensagem(
      { orgId: 'org-a', telefone: BETO_WA, nome: 'Beto', texto: `CONFIRMAR ${r.codigo}`, idExterno: 'conf-1' },
      { canal },
    )
    expect(de2).toEqual({ tipo: 'confirmacao', confirmou: true })
  })

  it('três códigos por hora, e ninguém pede código para outra conta', async () => {
    for (let i = 0; i < 3; i++) expect(await m.confirmacao.pedirCodigo(GIL, 'mostrar')).toMatchObject({ ok: true })
    expect(await m.confirmacao.pedirCodigo(GIL, 'mostrar')).toMatchObject({ ok: false, erro: expect.stringMatching(/3 códigos/) })
    // O último código aposenta os anteriores: só um vivo.
    const { n } = await um<{ n: number }>(
      `select count(*)::int n from confirmacoes_telefone where usuario_id = 'usr-gil' and usado_em is null and expira_em > (now() at time zone 'utc')`,
    )
    expect(n).toBe(1)
  })

  it('trocar o telefone desfaz a confirmação; salvar o mesmo número de outro jeito, não', async () => {
    expect(await m.equipe.mudarTelefone(DONA, 'usr-dona', '71 9 9999 0001')).toMatchObject({ ok: true, faltaConfirmar: false })
    expect((await m.contexto.acharInterlocutor('org-a', DONA_WA, null)).quem.tipo).toBe('equipe')

    expect(await m.equipe.mudarTelefone(DONA, 'usr-bal', '(71) 95555-0005')).toMatchObject({ ok: true, faltaConfirmar: true })
    expect((await m.contexto.acharInterlocutor('org-a', '5571955550005', null)).quem.tipo).toBe('cliente')
    expect((await m.contexto.acharInterlocutor('org-a', BETO_WA, null)).quem.tipo).toBe('cliente')
    const [beto] = (await m.equipe.listarEquipe(DONA)).filter((p) => p.id === 'usr-bal')
    expect(beto!.telefoneEstado).toBe('falta_confirmar')
    expect((await m.confirmacao.equipeSemConfirmar(DONA)).map((p) => p.nome)).toEqual(['Beto Balcão', 'Gil Gerente'])
  })

  it('mensagem de equipe confirmada empurra os 180 dias (telefone_visto_em)', async () => {
    await db.exec(`update usuarios set telefone_visto_em = null where id = 'usr-dona'`)
    await m.confirmacao.anotarVisto('org-a', 'usr-dona')
    const { v } = await um<{ v: Date | null }>(`select telefone_visto_em v from usuarios where id = 'usr-dona'`)
    expect(v).not.toBeNull()
  })
})
