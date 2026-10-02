// As correções dos números (02/10/2026), com banco de verdade: a troca sem a
// compra e o desconto do crediário fora da receita, os tetos do financeiro, a
// equipe e os convites do gerente de uma loja só, a meta de quem não tem
// acesso, e a escola (dispensar ao trancar, o carnê de quem não se vê).
//
// O resto dos casos (ticket, troca e comissão, DRE por loja, fiado com
// desconto, parado, quem saiu, trancar e reativar) está em
// auditoria-relatorios-logica.test.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { diaEmSP, inicioDoDiaEmSP, colunaDoDia, somarDias } from '../src/servidor/dia'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  financeiro: typeof import('../src/servidor/financeiro')
  relatorios: typeof import('../src/servidor/relatorios')
  painel: typeof import('../src/servidor/painel')
  metas: typeof import('../src/servidor/metas')
  equipe: typeof import('../src/servidor/equipe')
  convite: typeof import('../src/servidor/convite')
  escola: typeof import('../src/servidor/escola')
  mens: typeof import('../src/servidor/mensalidades')
}

const sessao = (usuarioId: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-r',
  usuarioId,
  nome: usuarioId,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONA = sessao('usr-dona', [{ papel: 'DONO', unidadeId: null }])
const GER1 = sessao('usr-ger1', [{ papel: 'GERENTE', unidadeId: 'u-1' }])
const BAL1 = sessao('usr-bal1', [{ papel: 'BALCAO', unidadeId: 'u-1' }])
const BAL2 = sessao('usr-bal2', [{ papel: 'BALCAO', unidadeId: 'u-2' }])

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-r', 'Loja R', 'loja-r', 'REDE', 'ATIVA', '{multiUnidade,metas,crediario,escola}', now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('u-1', 'org-r', 'Loja 1', false, now()),
    ('u-2', 'org-r', 'Loja 2', false, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-r', 'Dona', 'dona@r.com', now()),
    ('usr-ger1', 'org-r', 'Gerente Um', 'ger1@r.com', now()),
    ('usr-bal1', 'org-r', 'Balcao Um', 'bal1@r.com', now()),
    ('usr-bal2', 'org-r', 'Balcao Dois', 'bal2@r.com', now()),
    ('usr-sem',  'org-r', 'Sem Acesso', 'sem@r.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-r', 'usr-dona', null, 'DONO'),
    ('ac-ger1', 'org-r', 'usr-ger1', 'u-1', 'GERENTE'),
    ('ac-bal1', 'org-r', 'usr-bal1', 'u-1', 'BALCAO'),
    ('ac-bal2', 'org-r', 'usr-bal2', 'u-2', 'BALCAO');
  insert into convites (id, org_id, email, papel, unidade_id, token, expira_em) values
    ('cv-1', 'org-r', 'nova1@r.com', 'BALCAO', 'u-1', 't1', now() + interval '3 days'),
    ('cv-2', 'org-r', 'nova2@r.com', 'BALCAO', 'u-2', 't2', now() + interval '3 days'),
    ('cv-emp', 'org-r', 'socia@r.com', 'DONO', null, 't3', now() + interval '3 days');
  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('c-adm', 'org-r', 'Contabilidade', 'DESPESA', 'ADMINISTRATIVA');
  insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, vencimento, quem, atualizado_em) values
    ('l-1', 'org-r', 'u-1', 'c-adm', 'DESPESA', 'Contador da loja', 100, '2026-09-10', 'Dona', now());
  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-r', 'Cliente Um', now()),
    ('cli-al', 'org-r', 'Aluno Um', now()),
    ('cli-solto', 'org-r', 'Sem Matricula', now());

  -- Troca sem a compra: a peça veio do sistema anterior, virou vale (sem
  -- devolução nesta empresa), e o vale pagou a venda nova de 100.
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, subtotal, vendedor_id, vendedor_nome, criada_em) values
    ('v-sc', 'org-r', 'u-1', 1, 'CONCLUIDA', 100.00, 100.00, 'usr-bal1', 'Balcao Um', now());
  insert into venda_itens (id, org_id, venda_id, descricao, quantidade, preco_unit, total, custo_unit) values
    ('vi-sc', 'org-r', 'v-sc', 'Blusa', 1, 100.00, 100.00, 40.00);
  insert into vales (id, org_id, codigo, cliente_id, unidade_id, valor, saldo, quem, usado_em) values
    ('vale-sc', 'org-r', 'SEMCMP', 'cli-1', 'u-1', 100.00, 0, 'Balcao Um', now());
  insert into pagamentos (id, org_id, venda_id, forma, valor, vale_id) values
    ('pg-sc', 'org-r', 'v-sc', 'VALE', 100.00, 'vale-sc');

  -- Crediário: venda de 200 (de outro mês) e um recebimento hoje com 30 de desconto.
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, subtotal, cliente_id, criada_em) values
    ('v-cred', 'org-r', 'u-1', 2, 'CONCLUIDA', 200.00, 200.00, 'cli-1', now() - interval '90 days');
  insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor, pago, desconto) values
    ('par-1', 'org-r', 'v-cred', 'cli-1', 'u-1', 1, 1, '2026-08-10', 200.00, 170.00, 30.00);
  insert into recebimentos (id, org_id, parcela_id, forma, valor, desconto, quem) values
    ('rec-1', 'org-r', 'par-1', 'PIX', 170.00, 30.00, 'Dona');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 43000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    financeiro: await import('../src/servidor/financeiro'),
    relatorios: await import('../src/servidor/relatorios'),
    painel: await import('../src/servidor/painel'),
    metas: await import('../src/servidor/metas'),
    equipe: await import('../src/servidor/equipe'),
    convite: await import('../src/servidor/convite'),
    escola: await import('../src/servidor/escola'),
    mens: await import('../src/servidor/mensalidades'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const hoje = () => ({ de: inicioDoDiaEmSP(diaEmSP()), ate: new Date(Date.now() + 3600_000) })

describe('receita: troca sem a compra e desconto do crediário', () => {
  it('a venda paga com vale de troca sem a compra não é receita — no DRE e na Análise', async () => {
    const { de, ate } = hoje()
    const dre = await m.financeiro.montarDRE(DONA, ['u-1'], de, ate)
    expect(dre.linhas.find((l) => l.chave === 'venda')?.valor).toBe(100)
    expect(dre.linhas.find((l) => l.chave === 'semCompra')?.valor).toBe(-100)
    const [l1] = await m.relatorios.compararLojas(DONA, ['u-1'], de, ate)
    expect(l1!.receita).toBe(0)
    // E não vira meta de ninguém.
    const p = await m.painel.resumoDoPainel(DONA, ['u-1'], { ...hoje(), deAnterior: de, ateAnterior: de } as never)
    expect(p.atual.liquido).toBe(0)
    expect(p.porVendedor.find((v) => v.nome === 'Balcao Um')?.total ?? 0).toBe(0)
  })

  it('o desconto dado ao receber o crediário sai da receita, no dia do recebimento', async () => {
    const { de, ate } = hoje()
    const dre = await m.financeiro.montarDRE(DONA, ['u-1'], de, ate)
    expect(dre.linhas.find((l) => l.chave === 'descontoCred')?.valor).toBe(-30)
    // bruta = 100 (venda) − 100 (vale sem compra) − 30 (desconto) = −30
    expect(dre.linhas.find((l) => l.chave === 'bruta')?.valor).toBe(-30)
    // A outra loja não leva o desconto da loja 1.
    const d2 = await m.financeiro.montarDRE(DONA, ['u-2'], de, ate)
    expect(d2.linhas.find((l) => l.chave === 'descontoCred')).toBeUndefined()
  })
})

describe('financeiro: tetos', () => {
  const base = { categoriaId: 'c-adm', tipo: 'DESPESA' as const, descricao: 'Teste', vencimento: colunaDoDia(diaEmSP()) }

  it('lançamento acima de R$ 10 milhões é recusado; texto longo é cortado', async () => {
    await expect(m.financeiro.lancar(DONA, { ...base, unidadeId: 'u-1', valor: 10_000_000.01 })).rejects.toThrow(/alto demais/)
    const id = await m.financeiro.lancar(DONA, { ...base, unidadeId: 'u-1', valor: 50, descricao: 'x'.repeat(500), observacoes: 'o'.repeat(5000) })
    const l = await db.query<{ descricao: string; observacoes: string }>(`select descricao, observacoes from lancamentos where id = $1`, [id])
    expect(l.rows[0]!.descricao.length).toBe(200)
    expect(l.rows[0]!.observacoes.length).toBe(1000)
  })

  it('baixa com data de mais de 5 anos atrás (ou no futuro) é recusada', async () => {
    await expect(m.financeiro.marcarPago(DONA, 'l-1', colunaDoDia('1900-01-10'))).rejects.toThrow(/5 anos/)
    await expect(m.financeiro.marcarPago(DONA, 'l-1', colunaDoDia(somarDias(diaEmSP(), 1)))).rejects.toThrow(/depois de hoje/)
    await expect(
      m.financeiro.lancar(DONA, { ...base, unidadeId: 'u-1', valor: 10, pagoEm: colunaDoDia('1999-12-31') }),
    ).rejects.toThrow(/5 anos/)
    await m.financeiro.marcarPago(DONA, 'l-1', colunaDoDia(somarDias(diaEmSP(), -365 * 4)))
    const l = await db.query<{ pago: boolean }>(`select pago_em is not null as pago from lancamentos where id = 'l-1'`)
    expect(l.rows[0]!.pago).toBe(true)
  })
})

describe('equipe: o gerente de uma loja só vê a loja dele', () => {
  it('a lista da equipe traz quem tem acesso na loja dele (e a dona, que é de todas)', async () => {
    const ids = (await m.equipe.listarEquipe(GER1)).map((p) => p.id).sort()
    expect(ids).toEqual(['usr-bal1', 'usr-dona', 'usr-ger1'])
    // A dona vê todo mundo.
    expect((await m.equipe.listarEquipe(DONA)).length).toBe(5)
  })

  it('os convites em aberto: só os da loja dele', async () => {
    expect((await m.convite.listarConvites(GER1)).map((c) => c.id)).toEqual(['cv-1'])
    expect((await m.convite.listarConvites(DONA)).map((c) => c.id).sort()).toEqual(['cv-1', 'cv-2', 'cv-emp'])
  })

  it('meta para quem não tem acesso a loja nenhuma é recusada', async () => {
    await expect(m.metas.salvarMeta(GER1, { usuarioId: 'usr-sem', mes: '2026-10', valor: 1000, comissaoPct: 5 })).rejects.toThrow(/nenhuma loja/)
    await expect(m.metas.salvarMeta(DONA, { usuarioId: 'usr-sem', mes: '2026-10', valor: 1000, comissaoPct: 5 })).rejects.toThrow(/nenhuma loja/)
    await expect(m.metas.salvarMeta(GER1, { usuarioId: 'usr-bal1', mes: '2026-10', valor: 1000, comissaoPct: 5 })).resolves.toMatchObject({ valor: 1000 })
  })
})

describe('escola: dispensar ao sair e o carnê', () => {
  const em = (dia: string) => new Date(`${dia}T10:00:00.000-03:00`)
  let matriculaId = ''

  it('o Balcão não tranca a matrícula se isso dispensa mensalidade; quem ajusta tranca', async () => {
    const t = await m.escola.criarTurma(DONA, {
      unidadeId: 'u-1', nome: 'Violão', curso: 'Música', dias: [3], horaInicio: '18:00', horaFim: '19:00',
      capacidade: 10, mensalidade: 200, diaVencimento: 10,
    } as never)
    expect(t.ok).toBe(true)
    const turmaId = t.ok ? t.id : ''
    const mat = await m.escola.matricular(BAL1, { alunoId: 'cli-al', turmaId, inicio: '2026-10-01' }, em('2026-10-05'))
    expect(mat).toMatchObject({ ok: true, mensalidades: 2 })
    matriculaId = (await db.query<{ id: string }>(`select id from matriculas where aluno_id = 'cli-al'`)).rows[0]!.id

    const r = await m.escola.mudarMatricula(BAL1, matriculaId, { para: 'TRANCADA', motivo: 'viagem' }, em('2026-10-06'))
    expect(r).toMatchObject({ ok: false })
    expect((await db.query<{ n: number }>(`select count(*)::int n from mensalidades where matricula_id = $1 and cancelada_em is not null`, [matriculaId])).rows[0]!.n).toBe(0)

    const g = await m.escola.mudarMatricula(GER1, matriculaId, { para: 'TRANCADA', motivo: 'viagem' }, em('2026-10-06'))
    expect(g).toMatchObject({ ok: true, dispensadas: 1 })
    // Reativar não dispensa nada: o Balcão pode.
    const v = await m.escola.mudarMatricula(BAL1, matriculaId, { para: 'ATIVA' }, em('2026-10-09'))
    expect(v.ok).toBe(true)
    expect((await db.query<{ n: number }>(`select count(*)::int n from mensalidades where matricula_id = $1 and cancelada_em is not null`, [matriculaId])).rows[0]!.n).toBe(0)
  })

  it('o carnê só abre para quem vê alguma matrícula do aluno', async () => {
    expect(await m.mens.carneDoAluno(BAL1, 'cli-al', 3, em('2026-10-10'))).not.toBeNull()
    expect(await m.mens.carneDoAluno(BAL2, 'cli-al', 3, em('2026-10-10'))).toBeNull()
    expect(await m.mens.carneDoAluno(DONA, 'cli-solto', 3, em('2026-10-10'))).toBeNull()
  })
})
