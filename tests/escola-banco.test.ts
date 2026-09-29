// A escola com banco de verdade (PGlite exposto numa porta, como em
// atendimento-banco.test.ts): tudo passa pelo comoOrg — papel sem privilégio e
// RLS valendo.
//
// O que se prova aqui: a mensalidade nasce uma vez só (rodando junto ou de
// novo); receber em dinheiro exige caixa aberto e entra na conta da gaveta;
// multa uma vez só e juro só dos dias novos, com pagamento parcial; o
// desconto de pontualidade; o DRE, o gráfico dos meses e a taxa do cartão;
// o isolamento entre escolas; o aviso que vai para o RESPONSÁVEL e nunca
// para o aluno; e a anonimização que leva o responsável junto.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco, comoApp } from './banco'
import { SemPermissao, type Sessao } from '../src/servidor/permissao'
import type { Canal } from '../src/servidor/assistente/canal'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  escola: typeof import('../src/servidor/escola')
  mens: typeof import('../src/servidor/mensalidades')
  avisos: typeof import('../src/servidor/avisos-mensalidade')
  caixa: typeof import('../src/servidor/caixa')
  fin: typeof import('../src/servidor/financeiro')
  ofertas: typeof import('../src/servidor/ofertas')
  cliente: typeof import('../src/servidor/cliente')
  anon: typeof import('../src/servidor/anonimizar')
  ferr: typeof import('../src/servidor/assistente/ferramentas-atendimento')
  nicho: typeof import('../src/servidor/nicho')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-dona', nome: 'Dona Lúcia', acessos: [{ papel: 'DONO', unidadeId: null }] }
const SEC: Sessao = { orgId: 'org-a', usuarioId: 'usr-sec', nome: 'Rita Secretaria', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a1' }] }
const FIN: Sessao = { orgId: 'org-a', usuarioId: 'usr-fin', nome: 'Fábio Financeiro', acessos: [{ papel: 'FINANCEIRO', unidadeId: null }] }
const CONT: Sessao = { orgId: 'org-a', usuarioId: 'usr-cont', nome: 'Célia Contadora', acessos: [{ papel: 'CONTADOR', unidadeId: null }] }
const VIZ: Sessao = { orgId: 'org-b', usuarioId: 'usr-bia', nome: 'Bia', acessos: [{ papel: 'DONO', unidadeId: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, ramo, aviso_mensalidade_ativo, atualizada_em) values
    ('org-a', 'Escola Aprender', 'escola', 'BALCAO_AGENTE', 'ATIVA', '{escola,agente,ponto}', 'escola', true, now()),
    ('org-b', 'Escola Vizinha', 'vizinha', 'REDE', 'ATIVA', '{escola}', 'escola', false, now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a1', 'org-a', 'Sede', now()), ('uni-b1', 'org-b', 'Sede Vizinha', now());
  insert into usuarios (id, org_id, nome, email, senha_hash, sessoes_desde, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona Lúcia', 'dona@a.com', 'x', '2026-01-01', now()),
    ('usr-sec', 'org-a', 'Rita Secretaria', 'rita@a.com', 'x', '2026-01-01', now()),
    ('usr-fin', 'org-a', 'Fábio Financeiro', 'fabio@a.com', 'x', '2026-01-01', now()),
    ('usr-cont', 'org-a', 'Célia Contadora', 'celia@a.com', 'x', '2026-01-01', now()),
    ('usr-bia', 'org-b', 'Bia', 'bia@b.com', 'x', '2026-01-01', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-sec', 'org-a', 'usr-sec', 'uni-a1', 'BALCAO'),
    ('ac-fin', 'org-a', 'usr-fin', null, 'FINANCEIRO'),
    ('ac-cont', 'org-a', 'usr-cont', null, 'CONTADOR'),
    ('ac-bia', 'org-b', 'usr-bia', null, 'DONO');
  insert into colaboradores (id, org_id, unidade_id, nome, cargo, atualizado_em) values
    ('col-prof', 'org-a', 'uni-a1', 'Prof. Carla', 'professora', now());
  -- Pedro tem telefone próprio e "aceitou ofertas": é o caso de a escola ter
  -- marcado sem querer na ficha da criança.
  insert into clientes (id, org_id, nome, telefone, ofertas_whatsapp, atualizado_em) values
    ('cli-pedro', 'org-a', 'Pedro Souza', '71988880001', 'SIM', now()),
    ('cli-ana', 'org-a', 'Ana Lima', null, 'NAO_PERGUNTADO', now()),
    ('cli-joao', 'org-a', 'João Sem Responsável', null, 'NAO_PERGUNTADO', now()),
    ('cli-b', 'org-b', 'Aluno Vizinho', null, 'NAO_PERGUNTADO', now());
  insert into taxas_pagamento (id, org_id, forma, parcelas, percentual, atualizada_em) values
    ('tx-cred', 'org-a', 'CREDITO', 1, 3, now());
  insert into turmas (id, org_id, unidade_id, nome, mensalidade, dia_vencimento, atualizada_em) values
    ('tur-b', 'org-b', 'uni-b1', 'Turma Vizinha', 300, 5, now());
`

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
    escola: await import('../src/servidor/escola'),
    mens: await import('../src/servidor/mensalidades'),
    avisos: await import('../src/servidor/avisos-mensalidade'),
    caixa: await import('../src/servidor/caixa'),
    fin: await import('../src/servidor/financeiro'),
    ofertas: await import('../src/servidor/ofertas'),
    cliente: await import('../src/servidor/cliente'),
    anon: await import('../src/servidor/anonimizar'),
    ferr: await import('../src/servidor/assistente/ferramentas-atendimento'),
    nicho: await import('../src/servidor/nicho'),
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
const em = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`)
const AGORA = em('2026-10-05', '09:00')

let turmaId = ''
const mensalidadeDe = async (alunoId: string, mes: string) =>
  (await um<{ id: string }>(`select id from mensalidades where aluno_id = $1 and mes = $2`, [alunoId, mes])).id
const matriculaDe = async (alunoId: string) => (await um<{ id: string }>(`select id from matriculas where aluno_id = $1`, [alunoId])).id

// ─────────────────────────────────────────────────────────────
describe('turma e matrícula', () => {
  it('a secretaria não cria turma (é preço); a dona cria', async () => {
    const d = { unidadeId: 'uni-a1', nome: 'Inglês A', curso: 'Inglês básico', professorId: 'col-prof', dias: [2, 4], horaInicio: '18:00', horaFim: '19:30', capacidade: 3, mensalidade: 450, diaVencimento: 10 }
    await expect(m.escola.criarTurma(SEC, d)).rejects.toBeInstanceOf(SemPermissao)
    const r = await m.escola.criarTurma(DONA, d)
    expect(r.ok).toBe(true)
    if (r.ok) turmaId = r.id
  })

  it('a secretaria matricula pelo valor da turma — e a mensalidade do mês e a do próximo nascem junto', async () => {
    const r = await m.escola.matricular(SEC, { alunoId: 'cli-pedro', turmaId, inicio: '2026-10-01' }, AGORA)
    expect(r).toMatchObject({ ok: true, mensalidades: 2 })
    const ms = await linhas<{ mes: string; vencimento: Date; valor: string }>(`select mes, vencimento, valor from mensalidades where aluno_id = 'cli-pedro' order by mes`)
    expect(ms.map((x) => x.mes)).toEqual(['2026-10', '2026-11'])
    expect(ms.map((x) => new Date(x.vencimento).toISOString().slice(0, 10))).toEqual(['2026-10-10', '2026-11-10'])
  })

  it('bolsa é com quem gere; matricular duas vezes na mesma turma é recusado', async () => {
    const bolsa = await m.escola.matricular(SEC, { alunoId: 'cli-ana', turmaId, descontoPct: 50, descontoMotivo: 'irmão' }, AGORA)
    expect(bolsa.ok).toBe(false)
    const dup = await m.escola.matricular(SEC, { alunoId: 'cli-pedro', turmaId }, AGORA)
    expect(dup).toMatchObject({ ok: false, erro: expect.stringMatching(/já está matriculado/) })
    const sem = await m.escola.matricular(DONA, { alunoId: 'cli-ana', turmaId, descontoPct: 10 }, AGORA)
    expect(sem).toMatchObject({ ok: false, erro: expect.stringMatching(/motivo/) })
    const ok = await m.escola.matricular(DONA, { alunoId: 'cli-ana', turmaId, descontoPct: 10, descontoMotivo: 'irmão' }, AGORA)
    expect(ok.ok).toBe(true)
    const { desconto } = await um<{ desconto: string }>(`select desconto from mensalidades where aluno_id = 'cli-ana' and mes = '2026-10'`)
    expect(Number(desconto)).toBe(45)
  })

  it('turma cheia pede "é isso mesmo" — e com ele, matricula', async () => {
    await db.query(`update turmas set capacidade = 2 where id = $1`, [turmaId])
    const r = await m.escola.matricular(SEC, { alunoId: 'cli-joao', turmaId }, AGORA)
    expect(r).toMatchObject({ ok: false, pedeConfirmacao: true })
    const c = await m.escola.matricular(SEC, { alunoId: 'cli-joao', turmaId, confirmar: true }, AGORA)
    expect(c.ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
describe('a mensalidade nasce uma vez só', () => {
  it('três gerações ao mesmo tempo não escrevem nada a mais', async () => {
    const antes = (await um<{ n: number }>(`select count(*)::int n from mensalidades where org_id = 'org-a'`)).n
    expect(antes).toBe(6)
    const r = await Promise.all([
      m.mens.gerarMensalidadesDaEmpresa('org-a', AGORA),
      m.mens.gerarMensalidadesDaEmpresa('org-a', AGORA),
      m.mens.garantirMensalidades(SEC, AGORA),
    ])
    expect(r).toEqual([0, 0, 0])
    expect((await um<{ n: number }>(`select count(*)::int n from mensalidades where org_id = 'org-a'`)).n).toBe(6)
  })

  it('o mês seguinte nasce quando chega, e o banco recusa a repetida venha de onde vier', async () => {
    expect(await m.mens.gerarMensalidadesDaEmpresa('org-a', em('2026-11-02', '07:00'))).toBe(3)
    expect(await m.mens.gerarMensalidadesDaEmpresa('org-a', em('2026-11-02', '08:00'))).toBe(0)
    const mat = await matriculaDe('cli-pedro')
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`insert into mensalidades (id, org_id, matricula_id, aluno_id, unidade_id, mes, vencimento, valor, atualizada_em)
                  values ('men-dup', 'org-a', $1, 'cli-pedro', 'uni-a1', '2026-10', '2026-10-10', 450, now())`, [mat]),
      ),
    ).rejects.toThrow(/unique|duplicate/i)
  })

  it('a escola com o módulo desligado não gera nada', async () => {
    await db.query(`update orgs set modulos = '{}' where id = 'org-b'`)
    expect(await m.mens.gerarMensalidadesDaEmpresa('org-b', AGORA)).toBe(0)
    await db.query(`update orgs set modulos = '{escola}' where id = 'org-b'`)
  })
})

// ─────────────────────────────────────────────────────────────
describe('receber', () => {
  it('em dinheiro sem caixa aberto é recusado; com caixa, entra na gaveta', async () => {
    const id = await mensalidadeDe('cli-pedro', '2026-10')
    const sem = await m.mens.receberMensalidade(SEC, { mensalidadeId: id, valor: 450, juros: 0, multa: 0, forma: 'DINHEIRO' }, AGORA)
    expect(sem).toEqual({ ok: false, motivo: 'caixa_fechado' })
    const cx = await m.caixa.abrirCaixa(SEC, 'uni-a1', 100)
    expect(cx.ok).toBe(true)
    const r = await m.mens.receberMensalidade(SEC, { mensalidadeId: id, valor: 450, juros: 0, multa: 0, forma: 'DINHEIRO' }, AGORA)
    expect(r).toMatchObject({ ok: true, quitada: true, restante: 0 })
    if (!cx.ok) return
    const conf = await m.caixa.conferirCaixa(SEC, cx.caixaId)
    expect(conf.dinheiroMensalidades).toBe(450)
    expect(conf.esperado).toBe(550)
  })

  it('não recebe duas vezes, e o contador não recebe', async () => {
    const id = await mensalidadeDe('cli-pedro', '2026-10')
    expect(await m.mens.receberMensalidade(SEC, { mensalidadeId: id, valor: 10, juros: 0, multa: 0, forma: 'PIX' }, AGORA)).toEqual({ ok: false, motivo: 'ja_quitada' })
    const outra = await mensalidadeDe('cli-pedro', '2026-11')
    await expect(m.mens.receberMensalidade(CONT, { mensalidadeId: outra, valor: 10, juros: 0, multa: 0, forma: 'PIX' }, AGORA)).rejects.toBeInstanceOf(SemPermissao)
    // o dinheiro que entrou não se apaga nem se reescreve
    await expect(comoApp(db, 'org-a', (tx) => tx.query(`delete from pagamentos_mensalidade`))).rejects.toThrow(/permission denied/)
    await expect(comoApp(db, 'org-a', (tx) => tx.query(`update pagamentos_mensalidade set valor = 1`))).rejects.toThrow(/permission denied/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('multa e juro, com pagamento parcial', () => {
  it('30 dias de atraso: multa de 2% e juro de 1% ao mês; mais que isso é recusado', async () => {
    const agora = em('2026-11-09', '10:00')
    const [ana] = (await m.mens.listarMensalidades(SEC, { unidadeIds: ['uni-a1'], alunoId: 'cli-ana', mes: '2026-10' }, agora))
    expect(ana).toMatchObject({ devido: 405, situacao: 'atrasada', diasAtraso: 30, multaHoje: 8.1, jurosHoje: 4.05 })
    const acima = await m.mens.receberMensalidade(SEC, { mensalidadeId: ana!.id, valor: 213, juros: 4.06, multa: 8.1, forma: 'PIX' }, agora)
    expect(acima).toEqual({ ok: false, motivo: 'juros_acima' })
    const r = await m.mens.receberMensalidade(SEC, { mensalidadeId: ana!.id, valor: 212.15, juros: 4.05, multa: 8.1, forma: 'PIX' }, agora)
    expect(r).toMatchObject({ ok: true, quitada: false, restante: 205, juros: 4.05, multa: 8.1 })
  })

  it('dez dias depois: a multa não volta, e o juro é só dos dez dias', async () => {
    const agora = em('2026-11-19', '10:00')
    const [ana] = await m.mens.listarMensalidades(SEC, { unidadeIds: ['uni-a1'], alunoId: 'cli-ana', mes: '2026-10' }, agora)
    expect(ana).toMatchObject({ resta: 205, multaHoje: 0, diasJuros: 10, jurosHoje: 0.68 })
    expect(await m.mens.receberMensalidade(SEC, { mensalidadeId: ana!.id, valor: 206.68, juros: 0.68, multa: 1, forma: 'CREDITO' }, agora)).toEqual({ ok: false, motivo: 'multa_acima' })
    const r = await m.mens.receberMensalidade(SEC, { mensalidadeId: ana!.id, valor: 205.68, juros: 0.68, multa: 0, forma: 'CREDITO' }, agora)
    expect(r).toMatchObject({ ok: true, quitada: true })
    const x = await um<{ juros: string; multa: string; pago: string; multa_cobrada: boolean }>(`select juros, multa, pago, multa_cobrada from mensalidades where id = $1`, [ana!.id])
    expect([Number(x.juros), Number(x.multa), Number(x.pago), x.multa_cobrada]).toEqual([4.73, 8.1, 405, true])
    const [taxa] = await linhas<{ taxa_pct: string }>(`select taxa_pct from pagamentos_mensalidade where forma = 'CREDITO'`)
    expect(Number(taxa!.taxa_pct)).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────
describe('o desconto de pontualidade', () => {
  it('vale para quem paga tudo até o vencimento, de uma vez', async () => {
    await m.mens.salvarConfigMensalidade(DONA, { multaPct: 2, jurosMes: 1, pontualidadePct: 5, avisoAtivo: true, avisoDias: 3, atrasoDias: 5 })
    const agora = em('2026-11-05', '10:00')
    const pedro = await mensalidadeDe('cli-pedro', '2026-11')
    const parcial = await m.mens.receberMensalidade(SEC, { mensalidadeId: pedro, valor: 100, juros: 0, multa: 0, forma: 'PIX', pontualidade: true }, agora)
    expect(parcial).toEqual({ ok: false, motivo: 'sem_pontualidade' })
    const joao = await mensalidadeDe('cli-joao', '2026-11')
    const [lj] = await m.mens.listarMensalidades(SEC, { unidadeIds: ['uni-a1'], alunoId: 'cli-joao', mes: '2026-11' }, agora)
    expect(lj!.abonoHoje).toBe(22.5)
    const r = await m.mens.receberMensalidade(SEC, { mensalidadeId: joao, valor: 427.5, juros: 0, multa: 0, forma: 'PIX', pontualidade: true }, agora)
    expect(r).toMatchObject({ ok: true, quitada: true, abono: 22.5 })
  })
})

// ─────────────────────────────────────────────────────────────
describe('o dinheiro no resultado', () => {
  it('outubro: a linha Mensalidades é o que entrou', async () => {
    const { de, ate } = m.fin.janelaDoMes('2026-10')
    const dre = await m.fin.montarDRE(DONA, ['uni-a1'], de, new Date(ate.getTime() - 1))
    expect(dre.linhas.find((l) => l.chave === 'mensalidades')?.valor).toBe(450)
    expect(dre.linhas.find((l) => l.chave === 'bruta')?.valor).toBe(450)
    expect(dre.resultado).toBe(450)
  })

  it('novembro: principal na linha, juro e multa em outras receitas, taxa do cartão em financeiras — e o gráfico bate', async () => {
    const { de, ate } = m.fin.janelaDoMes('2026-11')
    const dre = await m.fin.montarDRE(DONA, ['uni-a1'], de, new Date(ate.getTime() - 1))
    // Ana 200 + 205 e João 427,50 (a pontualidade de 22,50 não é dinheiro)
    expect(dre.linhas.find((l) => l.chave === 'mensalidades')?.valor).toBe(832.5)
    const outras = dre.linhas.find((l) => l.chave === 'outras')
    expect(outras?.itens?.find((i) => i.nome === 'Juros e multa de mensalidades')?.valor).toBe(12.83)
    // 3% de 205,68 no crédito
    expect(dre.taxasCalculadas).toBe(6.17)
    expect(dre.resultado).toBe(Math.round((832.5 + 12.83 - 6.17) * 100) / 100)
    const meses = await m.fin.resultadoPorMes(DONA, ['uni-a1'], 2, em('2026-11-25', '12:00'))
    expect(meses.map((x) => [x.mes, x.receita, x.resultado])).toEqual([
      ['2026-10', 450, 450],
      ['2026-11', 845.33, dre.resultado],
    ])
  })

  it('o painel da escola: alunos ativos, o que falta no mês, o atraso e o que entrou', async () => {
    const [bloco] = await m.nicho.nichoDoPainel(DONA, { modulos: ['escola', 'ponto'] }, ['uni-a1'], em('2026-11-19', '11:00'))
    expect(bloco!.familia).toBe('agenda')
    if (bloco!.familia !== 'agenda') return
    const e = bloco!.dados.escola!
    expect(e.alunosAtivos).toBe(3)
    // Em aberto no mês: novembro do Pedro (450) e da Ana (405, com a bolsa).
    // Em atraso: esses dois e o outubro do João (450) — três alunos.
    expect(e.mensalidades).toMatchObject({ aReceberMes: 855, abertasMes: 2, atraso: { quantas: 3, total: 1305, alunos: 3 }, recebidoNoMes: 845.33 })
    expect(e.quaseCheias.map((t) => t.nome)).toEqual(['Inglês A'])
  })
})

// ─────────────────────────────────────────────────────────────
describe('uma escola não enxerga a outra', () => {
  it('pelos serviços e pelo banco', async () => {
    expect(await m.mens.listarMensalidades(VIZ, { unidadeIds: ['uni-a1'] }, AGORA)).toEqual([])
    expect(await m.escola.listarTurmas(VIZ, { unidadeIds: ['uni-a1'] })).toEqual([])
    for (const t of ['mensalidades', 'turmas', 'matriculas', 'pagamentos_mensalidade', 'responsaveis']) {
      const { n } = await comoApp(db, 'org-b', (tx) => tx.query<{ n: number }>(`select count(*)::int n from ${t} where org_id = 'org-a'`)).then((r) => r.rows[0]!)
      expect(n, t).toBe(0)
    }
  })

  it('e não matricula o aluno da outra, nem pela turma da outra', async () => {
    await expect(
      comoApp(db, 'org-b', (tx) =>
        tx.query(`insert into matriculas (id, org_id, aluno_id, turma_id, unidade_id, inicio, valor, dia_vencimento, quem, atualizada_em)
                  values ('mat-x', 'org-b', 'cli-pedro', 'tur-b', 'uni-b1', '2026-10-01', 300, 5, 'x', now())`),
      ),
    ).rejects.toThrow(/outra empresa|foreign key/)
    const r = await m.escola.matricular(DONA, { alunoId: 'cli-pedro', turmaId: 'tur-b' }, AGORA)
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/não existe/) })
  })
})

// ─────────────────────────────────────────────────────────────
describe('a mensagem vai para o responsável, nunca para o aluno', () => {
  const canal = () => {
    const enviados: { numero: string; texto: string }[] = []
    const c: Canal & { enviados: typeof enviados } = {
      nome: 'teste',
      real: false,
      enviados,
      async enviar(numero: string, texto: string) {
        enviados.push({ numero, texto })
        return { ok: true as const }
      },
    }
    return c
  }
  const alvo = async (alunoId: string, mes: string) => {
    const id = await mensalidadeDe(alunoId, mes)
    const [x] = await linhas<{ vencimento: Date; valor: string; desconto: string; pago: string; abono: string }>(`select vencimento, valor, desconto, pago, abono from mensalidades where id = $1`, [id])
    const r = await linhas<{ nome: string; telefone: string | null }>(`select nome, telefone from responsaveis where aluno_id = $1`, [alunoId])
    const a = await um<{ nome: string }>(`select nome from clientes where id = $1`, [alunoId])
    return { id, mes, vencimento: new Date(x!.vencimento), valor: x!.valor, desconto: x!.desconto, pago: x!.pago, abono: x!.abono, aluno: { nome: a.nome, responsavel: r[0] ?? null } }
  }

  it('a ficha da criança com "aceita ofertas" não vale; a da criança não aceita "sim" com responsável', async () => {
    expect(await m.ofertas.podeReceberOfertas('org-a', '71988880001')).toBe(true)
    const r = await m.escola.salvarResponsavel(SEC, 'cli-pedro', { nome: 'Maria Souza', parentesco: 'mãe', telefone: '(71) 97777-0001', avisos: { valor: 'SIM', origem: 'balcao' } })
    expect(r.ok).toBe(true)
    expect(await m.ofertas.podeReceberOfertas('org-a', '71988880001')).toBe(false)
    await m.escola.salvarResponsavel(SEC, 'cli-ana', { nome: 'Rosa Lima', telefone: '71977770002' })
    const e = await m.cliente.editarCliente(SEC, 'cli-ana', { nome: 'Ana Lima', telefone: '71955550003' }, { valor: 'SIM', origem: 'balcao' })
    expect(e).toMatchObject({ ok: false, motivo: expect.stringMatching(/responsável/) })
  })

  it('sem responsável não sai; sem aceite não sai; com aceite, sai para o número DELE, uma vez só', async () => {
    const c = canal()
    const agora = em('2026-12-08', '10:00')
    await m.mens.gerarMensalidadesDaEmpresa('org-a', em('2026-12-01', '10:00'))
    const joao = await alvo('cli-joao', '2026-12')
    expect(await m.avisos.avisarUm('org-a', 'Escola Aprender', joao, 'antes', c, agora)).toBe('sem_telefone')
    const ana = await alvo('cli-ana', '2026-12')
    expect(await m.avisos.avisarUm('org-a', 'Escola Aprender', ana, 'antes', c, agora)).toBe('sem_aceite')
    const pedro = await alvo('cli-pedro', '2026-12')
    const [r1, r2] = await Promise.all([
      m.avisos.avisarUm('org-a', 'Escola Aprender', pedro, 'antes', c, agora),
      m.avisos.avisarUm('org-a', 'Escola Aprender', pedro, 'antes', c, agora),
    ])
    expect([r1, r2].sort()).toEqual(['enviado', 'ja_foi'])
    expect(c.enviados).toHaveLength(1)
    expect(c.enviados[0]!.numero).toBe('5571977770001')
    expect(c.enviados[0]!.texto).toMatch(/Olá, Maria! A mensalidade de dezembro de 2026 de Pedro na Escola Aprender vence em 10\/12/)
    expect(c.enviados.some((e) => e.numero.endsWith('988880001'))).toBe(false)
  })

  it('PARAR vale: o aviso de atraso não sai para quem pediu para sair', async () => {
    // A lista guarda a CHAVE do telefone (DDD + oito dígitos), como o PARAR grava.
    await db.query(`insert into optout_whatsapp (id, org_id, telefone, origem) values ('opt-maria', 'org-a', '7177770001', 'parar')`)
    const c = canal()
    const pedro = await alvo('cli-pedro', '2026-12')
    expect(await m.avisos.avisarUm('org-a', 'Escola Aprender', pedro, 'atraso', c, em('2026-12-15', '10:00'))).toBe('sem_aceite')
    expect(c.enviados).toHaveLength(0)
    await db.query(`delete from optout_whatsapp where id = 'opt-maria'`)
  })

  it('a batida inteira: a Rosa aceitou agora, e o aviso da Ana sai — uma vez, e só na escola que ligou', async () => {
    await m.escola.salvarResponsavel(SEC, 'cli-ana', { nome: 'Rosa Lima', telefone: '71977770002', avisos: { valor: 'SIM', origem: 'telefone' } })
    // A primeira tentativa (sem aceite) já tinha carimbado; a escola "zera" para testar a batida.
    await db.query(`update mensalidades set aviso_em = null, aviso = null where aluno_id = 'cli-ana' and mes = '2026-12'`)
    const c = canal()
    const deps = { empresas: async () => [{ id: 'org-a', slug: 'escola' }, { id: 'org-b', slug: 'vizinha' }], canalDe: async () => c }
    const b1 = await m.avisos.tickAvisosMensalidadeCom(em('2026-12-08', '11:00'), deps)
    const b2 = await m.avisos.tickAvisosMensalidadeCom(em('2026-12-08', '12:00'), deps)
    expect([b1.enviados, b2.enviados]).toEqual([1, 0])
    expect(c.enviados.map((e) => e.numero)).toEqual(['5571977770002'])
    // de noite não sai nada, nem o que estiver pendente
    expect((await m.avisos.tickAvisosMensalidadeCom(em('2026-12-08', '21:00'), deps)).enviados).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
describe('o assistente lê as mensalidades', () => {
  it('"a Ana pagou a mensalidade de outubro?"', async () => {
    const r = await m.ferr.consultarPagamentos(SEC, { modulos: ['escola'] }, { cliente: 'Ana' }, em('2026-11-20', '10:00'))
    const j = JSON.parse(r.texto)
    const ana = j.pessoas[0]
    expect(ana.mensalidades.find((x: { mes: string }) => x.mes === 'outubro de 2026')).toMatchObject({ situacao: 'paga' })
  })

  it('"quem está atrasado?" e "tem vaga no inglês?" — o contador não vê turma', async () => {
    const a = JSON.parse((await m.ferr.consultarAtrasadas(FIN, {}, em('2026-11-20', '10:00'))).texto)
    expect(a.alunos.map((x: { aluno: string }) => x.aluno)).toContain('João Sem Responsável')
    const t = JSON.parse((await m.ferr.consultarTurmas(SEC, { turma: 'ingl' })).texto)
    expect(t.turmas[0]).toMatchObject({ turma: 'Inglês A', alunos: 3, capacidade: 2, vagas: 0 })
    expect((await m.ferr.consultarTurmas(CONT, {})).erro).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
describe('LGPD: anonimizar o aluno leva o responsável junto', () => {
  it('com matrícula viva ou mensalidade em aberto, não anonimiza', async () => {
    const r = await m.anon.anonimizarCliente(DONA, 'cli-pedro', 'ANONIMIZAR', em('2026-12-20', '10:00'))
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/matrícula/) })
  })

  it('cancelar dispensa o que vem depois; a secretaria não dispensa; o financeiro dispensa com motivo', async () => {
    const mat = await matriculaDe('cli-pedro')
    const c = await m.escola.mudarMatricula(SEC, mat, { para: 'CANCELADA', motivo: 'mudou de cidade com a mãe Maria Souza', dia: '2026-11-20' }, em('2026-12-20', '10:00'))
    // dezembro e janeiro (já nascidos) não se cobram de quem saiu em novembro
    expect(c).toMatchObject({ ok: true, dispensadas: 2 })
    const nov = await mensalidadeDe('cli-pedro', '2026-11')
    const negado = await m.anon.anonimizarCliente(DONA, 'cli-pedro', 'ANONIMIZAR')
    expect(negado).toMatchObject({ ok: false, erro: expect.stringMatching(/mensalidade/) })
    await expect(m.mens.dispensarMensalidade(SEC, nov, 'acordo')).rejects.toBeInstanceOf(SemPermissao)
    expect(await m.mens.dispensarMensalidade(FIN, nov, 'acordo com a família')).toEqual({ ok: true })
  })

  it('anonimizado: some o responsável, os textos livres, e o número dele entra na lista', async () => {
    const r = await m.anon.anonimizarCliente(DONA, 'cli-pedro', 'ANONIMIZAR', em('2026-12-20', '10:00'))
    expect(r).toMatchObject({ ok: true, apagado: { responsavel: true, matriculas: 1 } })
    expect(await linhas(`select 1 from responsaveis where aluno_id = 'cli-pedro'`)).toHaveLength(0)
    const mat = await um<{ motivo_saida: string | null }>(`select motivo_saida from matriculas where aluno_id = 'cli-pedro'`)
    expect(mat.motivo_saida).toBeNull()
    const lista = await linhas<{ telefone: string }>(`select telefone from optout_whatsapp where org_id = 'org-a'`)
    expect(lista.map((l) => l.telefone)).toEqual(expect.arrayContaining(['7177770001']))
    // o livro não guarda mais o nome da mãe nem o do aluno
    const livro = await linhas<{ n: number }>(
      `select count(*)::int n from auditoria where org_id = 'org-a' and (coalesce(motivo, '') ilike '%Maria Souza%' or coalesce(alvo_nome, '') ilike '%Pedro Souza%')`,
    )
    expect(livro[0]!.n).toBe(0)
    // o dinheiro fica: a mensalidade paga de outubro continua lá, e no DRE
    const { de, ate } = m.fin.janelaDoMes('2026-10')
    const dre = await m.fin.montarDRE(DONA, ['uni-a1'], de, new Date(ate.getTime() - 1))
    expect(dre.linhas.find((l) => l.chave === 'mensalidades')?.valor).toBe(450)
  })
})
