// Auditoria de lógica dos números (02/10/2026).
//
// Cada `describe` nasceu como PROVA de um defeito (o assert passava enquanto
// o defeito existia). Corrigidos, os asserts agora fixam o comportamento
// certo — o título diz o que estava errado, o corpo diz o que vale.
//
// Banco de verdade (PGlite exposto numa porta), como em
// correcoes-fuso-financeiro.test.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { janela } from '../src/servidor/periodo'
import { janelaDoMes } from '../src/servidor/financeiro'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  financeiro: typeof import('../src/servidor/financeiro')
  painel: typeof import('../src/servidor/painel')
  relatorios: typeof import('../src/servidor/relatorios')
  metas: typeof import('../src/servidor/metas')
  pendencias: typeof import('../src/servidor/pendencias')
  fechamento: typeof import('../src/servidor/fechamento')
  crediario: typeof import('../src/servidor/crediario')
  escola: typeof import('../src/servidor/escola')
  mens: typeof import('../src/servidor/mensalidades')
  desempenho: typeof import('../src/servidor/desempenho')
}

const sessao = (usuarioId: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-x',
  usuarioId,
  nome: usuarioId,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONA = sessao('usr-dona', [{ papel: 'DONO', unidadeId: null }])
const GER_A = sessao('usr-ger', [{ papel: 'GERENTE', unidadeId: 'u-a' }])
const FIN_A = sessao('usr-fin', [{ papel: 'FINANCEIRO', unidadeId: 'u-a' }])
const ZE = sessao('usr-z', [{ papel: 'BALCAO', unidadeId: 'u-a' }, { papel: 'BALCAO', unidadeId: 'u-b' }])

// Instantes em UTC (coluna `timestamp` sem fuso): 15h de São Paulo = 18h UTC.
const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-x', 'Loja X', 'loja-x', 'REDE', 'ATIVA', '{multiUnidade,metas,crediario,escola}', now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('u-a', 'org-x', 'Loja A', false, now()),
    ('u-b', 'org-x', 'Loja B', false, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-x', 'Dona', 'dona@x.com', now()),
    ('usr-ger',  'org-x', 'Gerente A', 'ger@x.com', now()),
    ('usr-fin',  'org-x', 'Fin A', 'fin@x.com', now()),
    ('usr-x',    'org-x', 'Xenia', 'x@x.com', now()),
    ('usr-y',    'org-x', 'Yara', 'y@x.com', now()),
    ('usr-z',    'org-x', 'Ze', 'z@x.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-x', 'usr-dona', null, 'DONO'),
    ('ac-ger',  'org-x', 'usr-ger', 'u-a', 'GERENTE'),
    ('ac-fin',  'org-x', 'usr-fin', 'u-a', 'FINANCEIRO'),
    ('ac-x',    'org-x', 'usr-x', 'u-a', 'BALCAO'),
    ('ac-y',    'org-x', 'usr-y', 'u-a', 'BALCAO'),
    ('ac-za',   'org-x', 'usr-z', 'u-a', 'BALCAO'),
    ('ac-zb',   'org-x', 'usr-z', 'u-b', 'BALCAO');
  insert into metas (id, org_id, usuario_id, mes, valor, comissao_pct, quem, atualizada_em) values
    ('m-z', 'org-x', 'usr-z', '2026-09', 1000, 10, 'Dona', now());
  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-x', 'Cliente Um', now()),
    ('cli-al', 'org-x', 'Aluno Um', now()),
    ('cli-al2', 'org-x', 'Aluno Dois', now());
  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('c-ocup', 'org-x', 'Aluguel', 'DESPESA', 'OCUPACAO');

  -- SETEMBRO, Loja A: a Xenia vende 100; a cliente troca a peça dois dias
  -- depois (devolução em vale) e a Yara registra a venda nova de 100 paga com
  -- o vale. O Zé vende 200 na A e 300 na B.
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, subtotal, vendedor_id, vendedor_nome, criada_em) values
    ('v1', 'org-x', 'u-a', 1, 'CONCLUIDA', 100.00, 100.00, 'usr-x', 'Xenia', '2026-09-10 18:00:00'),
    ('v2', 'org-x', 'u-a', 2, 'CONCLUIDA', 100.00, 100.00, 'usr-y', 'Yara',  '2026-09-12 18:05:00'),
    ('v4', 'org-x', 'u-a', 3, 'CONCLUIDA', 200.00, 200.00, 'usr-z', 'Ze',    '2026-09-15 18:00:00'),
    ('v3', 'org-x', 'u-b', 1, 'CONCLUIDA', 300.00, 300.00, 'usr-z', 'Ze',    '2026-09-16 18:00:00');
  insert into venda_itens (id, org_id, venda_id, descricao, quantidade, preco_unit, total, custo_unit) values
    ('vi1', 'org-x', 'v1', 'Blusa', 1, 100.00, 100.00, 40.00),
    ('vi2', 'org-x', 'v2', 'Blusa outra cor', 1, 100.00, 100.00, 40.00),
    ('vi4', 'org-x', 'v4', 'Calça', 1, 200.00, 200.00, 80.00),
    ('vi3', 'org-x', 'v3', 'Vestido', 1, 300.00, 300.00, 120.00);
  insert into vales (id, org_id, codigo, cliente_id, unidade_id, valor, saldo, quem, usado_em) values
    ('vale-1', 'org-x', 'ABC123', 'cli-1', 'u-a', 100.00, 0, 'Yara', '2026-09-12 18:05:00');
  insert into pagamentos (id, org_id, venda_id, forma, valor, vale_id) values
    ('pg1', 'org-x', 'v1', 'DINHEIRO', 100.00, null),
    ('pg2', 'org-x', 'v2', 'VALE', 100.00, 'vale-1'),
    ('pg4', 'org-x', 'v4', 'DINHEIRO', 200.00, null),
    ('pg3', 'org-x', 'v3', 'DINHEIRO', 300.00, null);
  insert into devolucoes (id, org_id, venda_id, unidade_id, destino, valor, motivo, quem, vale_id, criada_em) values
    ('d1', 'org-x', 'v1', 'u-a', 'VALE', 100.00, 'troca de cor', 'Yara', 'vale-1', '2026-09-12 18:00:00');
  insert into devolucao_itens (id, org_id, devolucao_id, venda_item_id, quantidade, valor) values
    ('di1', 'org-x', 'd1', 'vi1', 1, 100.00);

  -- O aluguel do escritório: conta da EMPRESA INTEIRA (sem loja), paga em setembro.
  insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, vencimento, pago_em, quem, atualizado_em) values
    ('l-escr', 'org-x', null, 'c-ocup', 'DESPESA', 'Aluguel do escritório', 1000.00, '2026-09-05', '2026-09-05', 'Dona', now());

  -- AGOSTO: venda no crediário com uma parcela vencida de 100, da qual a
  -- cliente pagou 30 e a gerente concedeu 20 de desconto: resta 50.
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, subtotal, cliente_id, criada_em) values
    ('v-cred', 'org-x', 'u-a', 10, 'CONCLUIDA', 100.00, 100.00, 'cli-1', '2026-08-05 18:00:00');
  insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor, pago, desconto) values
    ('par-1', 'org-x', 'v-cred', 'cli-1', 'u-a', 1, 1, '2026-08-10', 100.00, 30.00, 20.00);

  -- Uma peça com estoque cuja ÚNICA venda recente foi CANCELADA.
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, ativo, atualizado_em) values
    ('p-par', 'org-x', 'Jaqueta parada', 'UN', 300.00, 150.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('va-par', 'org-x', 'p-par', 'JAQ001', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-par', 'org-x', 'va-par', 'u-a', 4, now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  // A venda cancelada é de 5 dias atrás no relógio REAL (o painel usa o dia de hoje).
  const cincoDias = new Date(Date.now() - 5 * 864e5).toISOString().replace('T', ' ').replace('Z', '')
  await db.query(
    `insert into vendas (id, org_id, unidade_id, numero, situacao, total, subtotal, criada_em, cancelada_em, motivo_cancelamento)
     values ('v-canc', 'org-x', 'u-a', 20, 'CANCELADA', 300.00, 300.00, $1, $1, 'desistiu')`,
    [cincoDias],
  )
  await db.exec(`insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, quantidade, preco_unit, total, custo_unit)
                 values ('vi-canc', 'org-x', 'v-canc', 'va-par', 'Jaqueta parada', 1, 300.00, 300.00, 150.00)`)
  const porta = 47000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    financeiro: await import('../src/servidor/financeiro'),
    painel: await import('../src/servidor/painel'),
    relatorios: await import('../src/servidor/relatorios'),
    metas: await import('../src/servidor/metas'),
    pendencias: await import('../src/servidor/pendencias'),
    fechamento: await import('../src/servidor/fechamento'),
    crediario: await import('../src/servidor/crediario'),
    escola: await import('../src/servidor/escola'),
    mens: await import('../src/servidor/mensalidades'),
    desempenho: await import('../src/servidor/desempenho'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const um = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!
const SETEMBRO = janela('mes-passado', new Date('2026-10-02T12:00:00-03:00'))
const setembroDRE = () => {
  const { de, ate } = janelaDoMes('2026-09')
  return { de, ate: new Date(ate.getTime() - 1) }
}

// ─────────────────────────────────────────────────────────────
describe('A1 — ticket médio: painel (bruto) ≠ análise entre lojas (líquido)', () => {
  it('a mesma loja e o mesmo mês dão o MESMO ticket, na régua líquida', async () => {
    const p = await m.painel.resumoDoPainel(DONA, ['u-a'], SETEMBRO)
    const [a] = await m.relatorios.compararLojas(DONA, ['u-a'], SETEMBRO.de, SETEMBRO.ate)
    // O total do painel continua o bruto (400 em 3 vendas)...
    expect(p.atual.total).toBe(400)
    expect(p.atual.vendas).toBe(3)
    expect(p.devolucoes.valor).toBe(100)
    // ...mas o líquido e o ticket são os da Análise: 300 em 3 vendas, 100.
    expect(p.atual.liquido).toBe(300)
    expect(a!.receita).toBe(300)
    expect(a!.ticket).toBe(100)
    expect(p.atual.ticket).toBe(a!.ticket)
  })
})

// ─────────────────────────────────────────────────────────────
describe('A2 — troca transfere a comissão de quem vendeu para quem trocou', () => {
  it('a blusa trocada fica com a Xenia, que vendeu; a Yara, que só registrou a troca, fica com 0', async () => {
    const metas = await m.metas.metasDoMes(DONA, '2026-09')
    const x = metas.find((p) => p.usuarioId === 'usr-x')!
    const y = metas.find((p) => p.usuarioId === 'usr-y')!
    // A devolução que virou venda nova não é devolução, e a venda paga com o
    // vale dela não é venda: a troca é neutra.
    expect(x.vendido).toBe(100)
    expect(x.devolvido).toBe(0)
    expect(x.liquido).toBe(100)
    expect(y.liquido).toBe(0)
    // E o painel, no "por vendedor", dá a mesma conta: uma blusa, R$ 100.
    const p = await m.painel.resumoDoPainel(DONA, ['u-a'], SETEMBRO)
    const porV = Object.fromEntries(p.porVendedor.map((v) => [v.nome, v.total]))
    expect(porV.Xenia).toBe(100)
    expect(porV.Yara ?? 0).toBe(0)
    expect(p.porVendedor.reduce((s, v) => s + v.total, 0)).toBe(p.atual.liquido)
  })

  it('o balcão da Xenia diz o mesmo que a tela da equipe', async () => {
    await db.query(`insert into metas (id, org_id, usuario_id, mes, valor, comissao_pct, quem, atualizada_em)
                    values ('m-x', 'org-x', 'usr-x', '2026-09', 1000, 5, 'Dona', now())`)
    const XENIA = sessao('usr-x', [{ papel: 'BALCAO', unidadeId: 'u-a' }])
    const minha = await m.metas.minhaMeta(XENIA, '2026-09')
    expect(minha!.vendido).toBe(100)
    expect(minha!.comissao).toBe(5)
    await db.query(`delete from metas where id = 'm-x'`)
  })
})

// ─────────────────────────────────────────────────────────────
describe('A3 — DRE por loja leva a despesa da empresa inteira em CADA loja', () => {
  it('Loja A + Loja B + a conta da empresa = consolidado: o aluguel do escritório sai uma vez', async () => {
    const { de, ate } = setembroDRE()
    const tudo = await m.financeiro.montarDRE(DONA, ['u-a', 'u-b'], de, ate)
    const a = await m.financeiro.montarDRE(DONA, ['u-a'], de, ate)
    const b = await m.financeiro.montarDRE(DONA, ['u-b'], de, ate)
    // No consolidado, o aluguel do escritório está no resultado.
    expect(tudo.linhas.find((l) => l.chave === 'OCUPACAO')?.valor).toBe(-1000)
    expect(tudo.linhas.some((l) => l.chave === 'empresa')).toBe(false)
    // Olhando uma loja, ele vem à parte, fora do resultado.
    expect(a.linhas.find((l) => l.chave === 'OCUPACAO')).toBeUndefined()
    expect(a.linhas.find((l) => l.chave === 'empresa')).toMatchObject({ valor: -1000, fora: true })
    expect(a.resultado + b.resultado - 1000).toBe(tudo.resultado)
    // O financeiro preso à loja A nem vê a conta da empresa inteira.
    const fa = await m.financeiro.montarDRE(FIN_A, ['u-a'], de, ate)
    expect(fa.linhas.find((l) => l.chave === 'OCUPACAO')).toBeUndefined()
    expect(fa.linhas.find((l) => l.chave === 'empresa')).toBeUndefined()
    expect(fa.resultado).toBe(a.resultado)
  })

  it('as listas seguem a mesma régua: a conta da empresa só na leitura da empresa', async () => {
    const f = { ano: 2026, mes: 9 }
    const ids = async (s: Sessao, unidadeIds: string[]) =>
      (await m.financeiro.listarLancamentos(s, { ...f, unidadeIds })).map((l) => l.id)
    expect(await ids(DONA, ['u-a', 'u-b'])).toContain('l-escr')
    expect(await ids(DONA, ['u-a'])).not.toContain('l-escr')
    expect(await ids(FIN_A, ['u-a'])).not.toContain('l-escr')
    // A vencer: uma conta da empresa em aberto.
    await db.query(`insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, vencimento, quem, atualizado_em)
                    values ('l-emp-aberto', 'org-x', null, 'c-ocup', 'DESPESA', 'Contador', 300, '2026-09-20', 'Dona', now())`)
    const agora = new Date('2026-10-02T12:00:00-03:00')
    const todas = await m.financeiro.aVencer(DONA, ['u-a', 'u-b'], 15, agora)
    const soA = await m.financeiro.aVencer(DONA, ['u-a'], 15, agora)
    const finA = await m.financeiro.aVencer(FIN_A, ['u-a'], 15, agora)
    expect(todas.vencidas.map((l) => l.id)).toContain('l-emp-aberto')
    expect(soA.vencidas.map((l) => l.id)).not.toContain('l-emp-aberto')
    expect(finA.vencidas.map((l) => l.id)).not.toContain('l-emp-aberto')
    await db.query(`delete from lancamentos where id = 'l-emp-aberto'`)
  })
})

// ─────────────────────────────────────────────────────────────
describe('A4 — fiado vencido ignora o desconto da parcela no Painel e no Fechamento', () => {
  it('a tela do crediário, o "Precisa de você" e o fechamento de agosto dizem 50', async () => {
    const r = await m.crediario.resumoCrediario(DONA, ['u-a', 'u-b'])
    expect(r.vencido).toBe(50)

    const c = await m.pendencias.pendenciasDoDia(
      DONA,
      { modulos: ['crediario', 'multiUnidade', 'metas', 'escola'], plano: 'REDE' } as never,
      ['u-a', 'u-b'],
      new Date('2026-10-02T12:00:00-03:00'),
    )
    expect(c.parcelasVencidas?.valor).toBe(50)

    const f = await m.fechamento.montarFechamento(DONA, ['u-a', 'u-b'], '2026-08', 'loja-x', true, new Date('2026-10-02T12:00:00-03:00'))
    const item = JSON.stringify(f.itens)
    expect(item).toMatch(/50,00/)
    expect(item).not.toMatch(/70,00/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('A5 — "parado" do painel conta venda CANCELADA como venda', () => {
  it('a jaqueta cuja única venda foi cancelada aparece parada no painel e na Análise', async () => {
    const p = await m.painel.resumoDoPainel(DONA, ['u-a'], SETEMBRO)
    expect(p.parados.some((x) => x.codigo === 'JAQ001')).toBe(true)
    const parado = await m.relatorios.dinheiroParado(DONA, ['u-a'])
    expect(parado.some((x) => x.produtoId === 'p-par')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
describe('A6 — a comissão do Zé: o gerente da loja A vê uma, o Zé vê outra', () => {
  it('o gerente da A e o próprio Zé leem o mesmo número: 500 vendidos, R$ 50', async () => {
    const doGerente = (await m.metas.metasDoMes(GER_A, '2026-09')).find((p) => p.usuarioId === 'usr-z')!
    expect(doGerente.liquido).toBe(500)
    expect(doGerente.comissao).toBe(50)
    const doZe = await m.metas.minhaMeta(ZE, '2026-09')
    expect(doZe!.vendido).toBe(500)
    expect(doZe!.comissao).toBe(50)
  })

  it('com a loja pedida (o painel olhando a loja A), a fatia da loja: 200, R$ 20', async () => {
    const daLoja = (await m.metas.metasDoMes(DONA, '2026-09', ['u-a'])).find((p) => p.usuarioId === 'usr-z')!
    expect(daLoja.liquido).toBe(200)
    expect(daLoja.comissao).toBe(20)
    // O desempenho na mesma loja usa a mesma fatia.
    const d = await m.desempenho.desempenhoDoMes(DONA, '2026-09', { metas: true, unidadeIds: ['u-a'] }, new Date('2026-10-02T12:00:00-03:00'))
    expect(d.pessoas.find((p) => p.usuarioId === 'usr-z')?.insumos.vendido).toBe(200)
    // E o gerente da A não lê a loja B pedindo por ela.
    expect(await m.metas.metasDoMes(GER_A, '2026-09', ['u-b'])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
describe('A8 — quem saiu da empresa some das metas dos meses em que vendeu', () => {
  it('desativar a Xenia em outubro NÃO apaga a linha (nem a comissão) dela de setembro', async () => {
    const antes = await m.metas.metasDoMes(DONA, '2026-09')
    const totalAntes = antes.reduce((s, p) => s + p.liquido, 0)
    expect(antes.some((p) => p.usuarioId === 'usr-x')).toBe(true)
    await db.query(`update usuarios set ativo = false where id = 'usr-x'`)
    const depois = await m.metas.metasDoMes(DONA, '2026-09')
    expect(depois.find((p) => p.usuarioId === 'usr-x')?.liquido).toBe(100)
    expect(depois.reduce((s, p) => s + p.liquido, 0)).toBe(totalAntes)
    // O gerente da loja onde ela vendeu também a vê.
    expect((await m.metas.metasDoMes(GER_A, '2026-09')).some((p) => p.usuarioId === 'usr-x')).toBe(true)
    // Em outubro, sem venda nenhuma, quem saiu não aparece.
    expect((await m.metas.metasDoMes(DONA, '2026-10')).some((p) => p.usuarioId === 'usr-x')).toBe(false)
    await db.query(`update usuarios set ativo = true where id = 'usr-x'`)
  })
})

// ─────────────────────────────────────────────────────────────
describe('A7 — mensalidade: trancar e reativar perde o mês seguinte', () => {
  const em = (dia: string, hora = '10:00') => new Date(`${dia}T${hora}:00.000-03:00`)
  let turmaId = ''

  it('a mensalidade de novembro, dispensada ao trancar, volta a valer ao reativar', async () => {
    const t = await m.escola.criarTurma(DONA, {
      unidadeId: 'u-a', nome: 'Inglês A', curso: 'Inglês', dias: [2, 4], horaInicio: '18:00', horaFim: '19:00',
      capacidade: 10, mensalidade: 400, diaVencimento: 10,
    } as never)
    expect(t.ok).toBe(true)
    if (t.ok) turmaId = t.id
    const mat = await m.escola.matricular(DONA, { alunoId: 'cli-al', turmaId, inicio: '2026-10-01' }, em('2026-10-05'))
    expect(mat).toMatchObject({ ok: true, mensalidades: 2 })
    const { id } = await um<{ id: string }>(`select id from matriculas where aluno_id = 'cli-al'`)

    // Tranca no dia 6 (viagem de 3 dias) e reativa no dia 9.
    const tr = await m.escola.mudarMatricula(DONA, id, { para: 'TRANCADA', motivo: 'viagem curta' } as never, em('2026-10-06'))
    expect(tr).toMatchObject({ ok: true, dispensadas: 1 })
    const at = await m.escola.mudarMatricula(DONA, id, { para: 'ATIVA', motivo: '' } as never, em('2026-10-09'))
    expect(at.ok).toBe(true)

    await m.mens.gerarMensalidadesDaEmpresa('org-x', em('2026-11-02'))
    const nov = await um<{ cancelada: boolean }>(
      `select cancelada_em is not null as cancelada from mensalidades where matricula_id = $1 and mes = '2026-11'`, [id],
    )
    expect(nov.cancelada).toBe(false)
    const r = await m.mens.resumoMensalidades(DONA, ['u-a'], '2026-11', em('2026-11-02'))
    expect(r.doMes.devido).toBe(400)
  })

  it('cancelar com data de saída FUTURA segue gerando até lá: dezembro nasce (aula até 15/12), janeiro não', async () => {
    const mat = await m.escola.matricular(DONA, { alunoId: 'cli-al2', turmaId, inicio: '2026-10-01' }, em('2026-10-05'))
    expect(mat.ok).toBe(true)
    const { id } = await um<{ id: string }>(`select id from matriculas where aluno_id = 'cli-al2'`)
    const c = await m.escola.mudarMatricula(DONA, id, { para: 'CANCELADA', motivo: 'muda de cidade', dia: '2026-12-15' } as never, em('2026-10-05'))
    expect(c.ok).toBe(true)
    await m.mens.gerarMensalidadesDaEmpresa('org-x', em('2026-12-02'))
    const dez = await um<{ n: number }>(`select count(*)::int n from mensalidades where matricula_id = $1 and mes = '2026-12'`, [id])
    expect(dez.n).toBe(1)
    await m.mens.gerarMensalidadesDaEmpresa('org-x', em('2027-01-02'))
    const jan = await um<{ n: number }>(`select count(*)::int n from mensalidades where matricula_id = $1 and mes = '2027-01'`, [id])
    expect(jan.n).toBe(0)
  })
})
