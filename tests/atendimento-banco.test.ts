// O atendimento com banco de verdade (PGlite exposto numa porta, como em
// caixa-unico.test.ts): tudo passa pelo comoOrg — papel sem privilégio e RLS
// valendo.
//
// A corrida de verdade (duas recepcionistas marcando no mesmo segundo, em duas
// conexões) o PGlite não reproduz: é um backend só. O que se prova aqui é o
// que a corrida encontraria — o segundo horário recusado, venha pela agenda
// (trava + conferência) ou por fora dela (o gatilho do banco).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco, comoApp } from './banco'
import type { Sessao } from '../src/servidor/permissao'
import type { Canal } from '../src/servidor/assistente/canal'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  agenda: typeof import('../src/servidor/agenda')
  ponto: typeof import('../src/servidor/ponto')
  compras: typeof import('../src/servidor/compras')
  lembretes: typeof import('../src/servidor/lembretes')
  venda: typeof import('../src/servidor/venda')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-ana', nome: 'Ana', acessos: [{ papel: 'DONO', unidadeId: null }] }
const RECEPCAO: Sessao = { orgId: 'org-a', usuarioId: 'usr-rec', nome: 'Rita', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a1' }] }
const VIZINHA: Sessao = { orgId: 'org-b', usuarioId: 'usr-bia', nome: 'Bia', acessos: [{ papel: 'DONO', unidadeId: null }] }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, ramo, lembrete_ativo, lembrete_horas, atualizada_em) values
    ('org-a', 'Salão Exemplo', 'salao', 'BALCAO_AGENTE', 'ATIVA', '{agenda,ponto,compras,agente}', 'beleza', true, 24, now()),
    ('org-b', 'Clínica Vizinha', 'clinica', 'REDE', 'ATIVA', '{agenda,ponto,compras}', 'saude', false, 24, now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro', now()), ('uni-b1', 'org-b', 'Sede', now());
  insert into usuarios (id, org_id, nome, email, senha_hash, sessoes_desde, atualizado_em) values
    ('usr-ana', 'org-a', 'Ana', 'ana@a.com', 'x', '2026-01-01', now()),
    ('usr-rec', 'org-a', 'Rita', 'rita@a.com', 'x', '2026-01-01', now()),
    ('usr-bia', 'org-b', 'Bia', 'bia@b.com', 'x', '2026-01-01', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-ana', 'org-a', 'usr-ana', null, 'DONO'),
    ('ac-rec', 'org-a', 'usr-rec', 'uni-a1', 'BALCAO'),
    ('ac-bia', 'org-b', 'usr-bia', null, 'DONO');
  insert into colaboradores (id, org_id, unidade_id, usuario_id, nome, atende, jornada_min, atualizado_em) values
    ('col-lia', 'org-a', 'uni-a1', null, 'Lia Manicure', true, '{0,480,480,480,480,480,240}', now()),
    ('col-rita', 'org-a', 'uni-a1', 'usr-rec', 'Rita Recepção', false, '{}', now()),
    ('col-b', 'org-b', 'uni-b1', null, 'Dra. Vizinha', true, '{}', now());
  insert into clientes (id, org_id, nome, telefone, ofertas_whatsapp, atualizado_em) values
    ('cli-joana', 'org-a', 'Joana Lima', '71999990001', 'SIM', now()),
    ('cli-pedro', 'org-a', 'Pedro Sem Aceite', '71999990002', 'NAO_PERGUNTADO', now()),
    ('cli-parou', 'org-a', 'Carla Parou', '71999990003', 'SIM', now());
  insert into optout_whatsapp (id, org_id, telefone, origem) values ('opt-1', 'org-a', '7199990003', 'parar');
  -- O esmalte é material de uso (uso_interno): só ele sai como consumo.
  insert into produtos (id, org_id, nome, preco_vista, preco_cartao, preco_crediario, servico, duracao_min, uso_interno, atualizado_em) values
    ('p-mani', 'org-a', 'Manicure', 40, 40, 40, true, 45, false, now()),
    ('p-esm', 'org-a', 'Esmalte vermelho', 15, 15, 15, false, null, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-mani', 'org-a', 'p-mani', 'MAN001', true),
    ('v-esm', 'org-a', 'p-esm', 'ESM001', true);
  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values ('cf-merc', 'org-a', 'Compra de mercadoria', 'DESPESA', 'OUTRA');
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
    agenda: await import('../src/servidor/agenda'),
    ponto: await import('../src/servidor/ponto'),
    compras: await import('../src/servidor/compras'),
    lembretes: await import('../src/servidor/lembretes'),
    venda: await import('../src/servidor/venda'),
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
const AGORA = em('2026-10-05', '07:00') // segunda, cedo

// ─────────────────────────────────────────────────────────────
describe('a agenda não marca duas pessoas na mesma hora', () => {
  const horario = (hora: string, cliente = 'Joana Lima', clienteId: string | null = 'cli-joana') => ({
    unidadeId: 'uni-a1',
    colaboradorId: 'col-lia',
    clienteId,
    clienteNome: cliente,
    produtoId: 'p-mani',
    dia: '2026-10-05',
    hora,
  })

  it('dois pedidos para o mesmo horário ao mesmo tempo: um marca, o outro ouve "ocupado"', async () => {
    const [a, b] = await Promise.all([
      m.agenda.marcarHorario(RECEPCAO, horario('10:00'), AGORA),
      m.agenda.marcarHorario(DONA, horario('10:15', 'Outra Pessoa', null), AGORA),
    ])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const recusado = a.ok ? b : a
    expect(recusado.ok).toBe(false)
    if (!recusado.ok) expect(recusado.ocupado).toBe(true)
    const { n } = await um<{ n: number }>(`select count(*)::int n from agendamentos where colaborador_id = 'col-lia'`)
    expect(n).toBe(1)
  })

  it('a duração vem do serviço (45 min), e encostar não é sobrepor', async () => {
    const r = await m.agenda.marcarHorario(RECEPCAO, horario('10:45', 'Pedro Sem Aceite', 'cli-pedro'), AGORA)
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.fim.getTime() - r.inicio.getTime()) / 60_000).toBe(45)
  })

  it('o banco recusa sozinho quem grava por fora da agenda — e desmarcado não ocupa', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`insert into agendamentos (id, org_id, unidade_id, colaborador_id, cliente_nome, servico, inicio, fim, quem, atualizado_em)
                  values ('ag-fora', 'org-a', 'uni-a1', 'col-lia', 'X', 'Y', $1, $2, 'script', now())`, [em('2026-10-05', '10:30').toISOString(), em('2026-10-05', '11:00').toISOString()]),
      ),
    ).rejects.toThrow(/agendamentos_sem_choque|ocupado/)
    // desmarcado, o horário das 10h fica livre para outra pessoa
    const [dez] = await linhas<{ id: string }>(`select id from agendamentos where inicio = $1`, [em('2026-10-05', '10:00').toISOString()])
    const d = await m.agenda.mudarSituacaoAgenda(RECEPCAO, dez!.id, { para: 'CANCELADO', motivo: 'pediu para remarcar' })
    expect(d.ok).toBe(true)
    const r = await m.agenda.marcarHorario(RECEPCAO, horario('10:00', 'Carla Parou', 'cli-parou'), AGORA)
    expect(r.ok).toBe(true)
    // o desmarcado continua na história
    const { n } = await um<{ n: number }>(`select count(*)::int n from agendamentos where situacao = 'CANCELADO'`)
    expect(n).toBe(1)
  })

  it('profissional de outra empresa não entra na agenda (a FK não atravessa empresa)', async () => {
    const r = await m.agenda.marcarHorario(DONA, { ...horario('15:00'), colaboradorId: 'col-b' }, AGORA)
    expect(r.ok).toBe(false)
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`insert into agendamentos (id, org_id, unidade_id, colaborador_id, cliente_nome, servico, inicio, fim, quem, atualizado_em)
                  values ('ag-x', 'org-a', 'uni-a1', 'col-b', 'X', 'Y', now(), now() + interval '1 hour', 'script', now())`),
      ),
    ).rejects.toThrow(/referencia de outra empresa/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('atender e cobrar', () => {
  it('a venda do serviço carimba o horário como atendido, não mexe em estoque e não cobra duas vezes', async () => {
    const [ag] = await linhas<{ id: string }>(`select id from agendamentos where cliente_id = 'cli-joana' and situacao = 'MARCADO'`)
    // o de 10h foi desmarcado; a Joana volta às 16h
    const novo = await m.agenda.marcarHorario(RECEPCAO, { unidadeId: 'uni-a1', colaboradorId: 'col-lia', clienteId: 'cli-joana', produtoId: 'p-mani', dia: '2026-10-05', hora: '16:00' }, AGORA)
    expect(novo.ok).toBe(true)
    const id = ag?.id ?? (novo.ok ? novo.id : '')
    const venda = () =>
      m.venda.registrarVenda(RECEPCAO, {
        unidadeId: 'uni-a1',
        clienteId: 'cli-joana',
        agendamentoId: id,
        itens: [{ variacaoId: 'v-mani', quantidade: 1 }],
        pagamentos: [{ forma: 'PIX', valor: 40 }],
      })
    const r1 = await venda()
    expect(r1.ok).toBe(true)
    const [a] = await linhas<{ situacao: string; venda_id: string | null }>(`select situacao::text, venda_id from agendamentos where id = $1`, [id])
    expect(a).toMatchObject({ situacao: 'ATENDIDO', venda_id: r1.ok ? r1.vendaId : null })
    // serviço não tem estoque: nenhuma linha de saldo, nenhum movimento
    const { n } = await um<{ n: number }>(`select count(*)::int n from movimentos_estoque where variacao_id = 'v-mani'`)
    expect(n).toBe(0)
    const r2 = await venda()
    expect(r2).toMatchObject({ ok: false, motivo: 'agendamento_recusado' })
    const { vendas } = await um<{ vendas: number }>(`select count(*)::int vendas from vendas where cliente_id = 'cli-joana'`)
    expect(vendas).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────
describe('o ponto', () => {
  it('a pessoa bate o próprio; o clique duplo não vira entrada e saída', async () => {
    const r = await m.ponto.baterPonto(RECEPCAO, { colaboradorId: 'col-rita', esperado: 'ENTRADA' }, em('2026-10-05', '08:00'))
    expect(r.ok).toBe(true)
    const dup = await m.ponto.baterPonto(RECEPCAO, { colaboradorId: 'col-rita', esperado: 'ENTRADA' }, em('2026-10-05', '08:00'))
    expect(dup.ok).toBe(false)
    const [x] = await linhas<{ origem: string }>(`select origem::text from registros_ponto where colaborador_id = 'col-rita'`)
    expect(x!.origem).toBe('PROPRIO')
  })

  it('a recepção não bate o ponto dos outros, nem vê a folha deles', async () => {
    await expect(m.ponto.baterPonto(RECEPCAO, { colaboradorId: 'col-lia', esperado: 'ENTRADA' }, em('2026-10-05', '08:00'))).rejects.toThrow(/ponto.gerir/)
    expect(await m.ponto.folhaDe(RECEPCAO, 'col-lia', '2026-10', em('2026-10-05', '12:00'))).toBeNull()
    expect(await m.ponto.folhaDe(RECEPCAO, 'col-rita', '2026-10', em('2026-10-05', '12:00'))).not.toBeNull()
  })

  it('o gestor bate por quem não tem login, ajusta com motivo e anula — e a folha soma certo, virando a meia-noite', async () => {
    expect((await m.ponto.baterPonto(DONA, { colaboradorId: 'col-lia', esperado: 'ENTRADA' }, em('2026-10-05', '22:00'))).ok).toBe(true)
    // a saída errada (bateu duas vezes), depois anulada
    expect((await m.ponto.baterPonto(DONA, { colaboradorId: 'col-lia', esperado: 'SAIDA' }, em('2026-10-05', '22:05'))).ok).toBe(true)
    const [errada] = await linhas<{ id: string }>(`select id from registros_ponto where colaborador_id = 'col-lia' and tipo = 'SAIDA'`)
    expect((await m.ponto.anularBatida(DONA, errada!.id, 'x')).ok).toBe(false) // motivo curto
    expect((await m.ponto.anularBatida(DONA, errada!.id, 'bateu a saída sem querer')).ok).toBe(true)
    // a saída certa, lançada depois como ajuste
    expect((await m.ponto.ajustarPonto(DONA, { colaboradorId: 'col-lia', tipo: 'SAIDA', dia: '2026-10-06', hora: '06:00', motivo: '' }, em('2026-10-06', '09:00'))).ok).toBe(false)
    expect((await m.ponto.ajustarPonto(DONA, { colaboradorId: 'col-lia', tipo: 'SAIDA', dia: '2026-10-06', hora: '06:00', motivo: 'esqueceu de bater a saída do plantão' }, em('2026-10-06', '09:00'))).ok).toBe(true)
    const f = await m.ponto.folhaDe(DONA, 'col-lia', '2026-10', em('2026-10-06', '09:00'))
    expect(f!.folha.dias.find((d) => d.dia === '2026-10-05')!.trabalhado).toBe(480)
    expect(f!.batidas.filter((b) => b.anulada)).toHaveLength(1)
    expect(f!.batidas.find((b) => b.origem === 'AJUSTE')!.motivo).toMatch(/plantão/)
  })

  it('batida não se apaga nem se reescreve — nem por fora da aplicação', async () => {
    await expect(comoApp(db, 'org-a', (tx) => tx.query(`delete from registros_ponto`))).rejects.toThrow(/permission denied/)
    await expect(
      comoApp(db, 'org-a', (tx) => tx.query(`update registros_ponto set em = now() where colaborador_id = 'col-rita'`)),
    ).rejects.toThrow(/só muda para ser anulada|não se reescreve/)
    const { n } = await um<{ n: number }>(`select count(*)::int n from registros_ponto`)
    expect(n).toBe(4)
  })
})

// ─────────────────────────────────────────────────────────────
describe('compras e consumo', () => {
  let pedidoId = ''

  it('a recepção não faz pedido de compra', async () => {
    await expect(m.compras.criarPedido(RECEPCAO, { unidadeId: 'uni-a1', itens: [{ variacaoId: 'v-esm', quantidade: 1 }] })).rejects.toThrow(/compra.gerir/)
  })

  it('serviço não entra em pedido', async () => {
    const r = await m.compras.criarPedido(DONA, { unidadeId: 'uni-a1', itens: [{ variacaoId: 'v-mani', quantidade: 1 }] })
    expect(r.ok).toBe(false)
  })

  it('receber em duas partes dá entrada certa, atualiza o custo e lança a conta; a chave repetida não entra de novo', async () => {
    const p = await m.compras.criarPedido(DONA, { unidadeId: 'uni-a1', itens: [{ variacaoId: 'v-esm', quantidade: 10, custoUnit: 6 }] })
    expect(p.ok).toBe(true)
    pedidoId = p.ok ? p.id : ''
    const [item] = await linhas<{ id: string }>(`select id from itens_compra where pedido_id = $1`, [pedidoId])
    const conta = { categoriaId: 'cf-merc', vencimento: new Date('2026-10-20T00:00:00Z'), jaPago: false }

    const r1 = await m.compras.receberPedido(DONA, pedidoId, { chave: 'chave-primeira-parte', itens: [{ itemId: item!.id, quantidade: 4, custoUnit: 6.5 }], conta })
    expect(r1).toMatchObject({ ok: true, repetido: false, situacao: 'PARCIAL', total: 26, contaLancada: true })
    // o clique duplo: mesma chave
    const r1b = await m.compras.receberPedido(DONA, pedidoId, { chave: 'chave-primeira-parte', itens: [{ itemId: item!.id, quantidade: 4 }], conta })
    expect(r1b).toMatchObject({ ok: true, repetido: true })
    // a mais do que falta
    expect((await m.compras.receberPedido(DONA, pedidoId, { chave: 'chave-a-mais-xyz', itens: [{ itemId: item!.id, quantidade: 7 }] })).ok).toBe(false)
    const r2 = await m.compras.receberPedido(DONA, pedidoId, { chave: 'chave-segunda-parte', itens: [{ itemId: item!.id, quantidade: 6 }] })
    expect(r2).toMatchObject({ ok: true, situacao: 'RECEBIDO' })

    const [e] = await linhas<{ quantidade: string }>(`select quantidade from estoque where variacao_id = 'v-esm' and unidade_id = 'uni-a1'`)
    expect(Number(e!.quantidade)).toBe(10)
    const { n } = await um<{ n: number }>(`select count(*)::int n from movimentos_estoque where variacao_id = 'v-esm' and tipo = 'ENTRADA'`)
    expect(n).toBe(2)
    // vale o custo DESTA compra: a primeira parte veio a 6,50, e a segunda
    // (sem custo informado) segue o combinado, que passou a ser 6,50
    const [custo] = await linhas<{ custo: string }>(`select custo from produtos where id = 'p-esm'`)
    expect(Number(custo!.custo)).toBe(6.5)
    const lanc = await linhas<{ valor: string }>(`select valor from lancamentos where tipo = 'DESPESA'`)
    expect(lanc.map((l) => Number(l.valor))).toEqual([26])
  })

  it('o material usado sai como CONSUMO; sem saldo, nada sai', async () => {
    const r = await m.compras.registrarConsumo(RECEPCAO, { unidadeId: 'uni-a1', itens: [{ variacaoId: 'v-esm', quantidade: 2 }], motivo: 'atendimentos da manhã' })
    expect(r.ok).toBe(true)
    const [e] = await linhas<{ quantidade: string }>(`select quantidade from estoque where variacao_id = 'v-esm'`)
    expect(Number(e!.quantidade)).toBe(8)
    const [mov] = await linhas<{ tipo: string; quantidade: string; quem: string }>(`select tipo::text, quantidade, quem from movimentos_estoque where tipo = 'CONSUMO'`)
    expect(mov).toMatchObject({ tipo: 'CONSUMO', quem: 'Rita' })
    expect(Number(mov!.quantidade)).toBe(-2)

    const semSaldo = await m.compras.registrarConsumo(RECEPCAO, { unidadeId: 'uni-a1', itens: [{ variacaoId: 'v-esm', quantidade: 50 }] })
    expect(semSaldo.ok).toBe(false)
    const [depois] = await linhas<{ quantidade: string }>(`select quantidade from estoque where variacao_id = 'v-esm'`)
    expect(Number(depois!.quantidade)).toBe(8)
  })
})

// ─────────────────────────────────────────────────────────────
describe('as tabelas novas não se enxergam entre empresas (RLS)', () => {
  it('a vizinha não vê nada do salão, e o salão não vê a vizinha', async () => {
    await comoApp(db, 'org-b', (tx) =>
      tx.query(`insert into fornecedores (id, org_id, nome, atualizado_em) values ('forn-b', 'org-b', 'Fornecedor B', now())`),
    )
    for (const t of ['colaboradores', 'registros_ponto', 'agendamentos', 'fornecedores', 'pedidos_compra', 'itens_compra', 'recebimentos_compra']) {
      const deB = await comoApp(db, 'org-b', (tx) => tx.query<{ n: number }>(`select count(*)::int n from ${t} where org_id = 'org-a'`))
      expect(deB.rows[0]!.n, t).toBe(0)
      const semEmpresa = await comoApp(db, null, (tx) => tx.query<{ n: number }>(`select count(*)::int n from ${t}`))
      expect(semEmpresa.rows[0]!.n, t).toBe(0)
    }
    const doSalao = await comoApp(db, 'org-a', (tx) => tx.query<{ n: number }>(`select count(*)::int n from fornecedores`))
    expect(doSalao.rows[0]!.n).toBe(0)
    // e não grava como se fosse a outra
    await expect(
      comoApp(db, 'org-a', (tx) => tx.query(`insert into fornecedores (id, org_id, nome, atualizado_em) values ('forn-x', 'org-b', 'Intruso', now())`)),
    ).rejects.toThrow(/row-level security/)
  })

  it('pelos serviços também: a vizinha não lista a agenda nem as compras do salão', async () => {
    const ag = await m.agenda.listarAgenda(VIZINHA, { unidadeIds: ['uni-a1'], de: em('2026-10-01', '00:00'), ate: em('2026-10-31', '00:00') })
    expect(ag).toEqual([])
    const cs = await m.compras.listarPedidos(VIZINHA, { unidadeIds: ['uni-a1'], situacao: 'todos' })
    expect(cs).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
describe('o lembrete do horário', () => {
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

  const novo = async (id: string, clienteId: string, telefone: string, hora: string) => {
    await db.query(
      `insert into agendamentos (id, org_id, unidade_id, colaborador_id, cliente_id, cliente_nome, telefone, servico, inicio, fim, quem, criado_em, atualizado_em)
       values ($1, 'org-a', 'uni-a1', 'col-lia', $2, 'Cliente', $3, 'Manicure', $4, $5, 'Rita', '2026-10-01', now())`,
      [id, clienteId, telefone, em('2026-10-09', hora).toISOString(), em('2026-10-09', `${Number(hora.slice(0, 2)) + 1}:00`).toISOString()],
    )
  }

  it('sai uma vez só, mesmo com o relógio batendo duas vezes', async () => {
    await novo('lem-joana', 'cli-joana', '71999990001', '10:00')
    const c = canal()
    const agora = em('2026-10-08', '10:30')
    const alvo = { id: 'lem-joana', inicio: em('2026-10-09', '10:00'), telefone: '71999990001', clienteNome: 'Joana Lima' }
    const [r1, r2] = await Promise.all([
      m.lembretes.lembrarUm('org-a', 'Salão Exemplo', alvo, c, agora),
      m.lembretes.lembrarUm('org-a', 'Salão Exemplo', alvo, c, agora),
    ])
    expect([r1, r2].sort()).toEqual(['enviado', 'ja_foi'])
    expect(c.enviados).toHaveLength(1)
    expect(c.enviados[0]!.texto).toMatch(/Salão Exemplo: sex 09\/10 às 10:00/)
    expect(c.enviados[0]!.texto).toMatch(/PARAR/)
    expect(c.enviados[0]!.texto).not.toMatch(/Manicure/)
    const [x] = await linhas<{ lembrete: string }>(`select lembrete from agendamentos where id = 'lem-joana'`)
    expect(x!.lembrete).toBe('enviado')
  })

  it('não sai para quem não aceitou, nem para quem pediu PARAR', async () => {
    await novo('lem-pedro', 'cli-pedro', '71999990002', '12:00')
    await novo('lem-carla', 'cli-parou', '71999990003', '14:00')
    const c = canal()
    const agora = em('2026-10-08', '15:00')
    const pedro = await m.lembretes.lembrarUm('org-a', 'Salão Exemplo', { id: 'lem-pedro', inicio: em('2026-10-09', '12:00'), telefone: '71999990002', clienteNome: 'Pedro' }, c, agora)
    const carla = await m.lembretes.lembrarUm('org-a', 'Salão Exemplo', { id: 'lem-carla', inicio: em('2026-10-09', '14:00'), telefone: '71999990003', clienteNome: 'Carla' }, c, agora)
    expect(pedro).toBe('sem_aceite')
    expect(carla).toBe('sem_aceite')
    expect(c.enviados).toHaveLength(0)
  })

  it('a batida inteira: só a empresa que ligou, só o que está na janela, e a segunda batida não manda nada', async () => {
    await novo('lem-tick', 'cli-joana', '71999990001', '16:00')
    const c = canal()
    const deps = { empresas: async () => [{ id: 'org-a', slug: 'salao' }, { id: 'org-b', slug: 'clinica' }], canalDe: async () => c }
    const agora = em('2026-10-08', '16:30')
    const b1 = await m.lembretes.tickLembretesCom(agora, deps)
    const b2 = await m.lembretes.tickLembretesCom(agora, deps)
    expect(b1.enviados).toBe(1)
    expect(b2.enviados).toBe(0)
    expect(c.enviados).toHaveLength(1)
  })
})
