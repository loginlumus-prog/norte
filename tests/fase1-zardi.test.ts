// O que a Sonhos Gelatos pediu depois dos primeiros testes, com banco de
// verdade: apagar e renomear eixo e opção de variação (o "oi" criado por
// engano), corrigir e excluir lançamento (e a conta fixa que não volta no mês
// excluído), abonar falta e o primeiro dia de trabalho no ponto.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { diaEmSP } from '../src/servidor/dia'
import { colunaDoDia } from '../src/servidor/dia'
import { aGerar } from '../src/servidor/recorrentes'
import { folhaDoMes } from '../src/servidor/ponto'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  produto: typeof import('../src/servidor/produto')
  fin: typeof import('../src/servidor/financeiro')
  rec: typeof import('../src/servidor/recorrentes')
  ponto: typeof import('../src/servidor/ponto')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-z',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

const DONO = sessao('usr-dono', 'Vitor', [{ papel: 'DONO', unidadeId: null }])
const BALCAO = sessao('usr-bal', 'Atendente', [{ papel: 'BALCAO', unidadeId: 'uni-z1' }])

const MES = diaEmSP().slice(0, 7)

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-z', 'Sorveteria Z', 'sorveteria-z', 'REDE', 'ATIVA', '{ponto,multiUnidade}', now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-z1', 'org-z', 'Itinga', false, true, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dono', 'org-z', 'Vitor', 'vitor@z.com', now()),
    ('usr-bal', 'org-z', 'Atendente', 'bal@z.com', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dono', 'org-z', 'usr-dono', null, 'DONO'),
    ('ac-bal', 'org-z', 'usr-bal', 'uni-z1', 'BALCAO');

  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, ativo, atualizado_em) values
    ('p-pic', 'org-z', 'Picolé', 'UN', 5.00, 5.00, 5.00, 2.00, true, now());

  insert into eixos (id, org_id, nome, ordem) values ('eixo-sabor', 'org-z', 'Sabor', 0);
  insert into opcoes (id, org_id, eixo_id, valor, ordem) values
    ('op-mor', 'org-z', 'eixo-sabor', 'Morango', 0),
    ('op-uva', 'org-z', 'eixo-sabor', 'Uva', 1);
  insert into produto_eixos (id, org_id, produto_id, eixo_id) values ('pe-1', 'org-z', 'p-pic', 'eixo-sabor');
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-mor', 'org-z', 'p-pic', 'PIC-MOR', true),
    ('var-uva', 'org-z', 'p-pic', 'PIC-UVA', false);
  insert into variacao_opcoes (id, org_id, variacao_id, opcao_id) values
    ('vo-1', 'org-z', 'var-mor', 'op-mor'),
    ('vo-2', 'org-z', 'var-uva', 'op-uva');

  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('cat-out', 'org-z', 'Outras despesas', 'DESPESA', 'OUTRA');

  insert into recorrentes (id, org_id, categoria_id, unidade_id, tipo, descricao, valor, dia_vencimento, criado_em) values
    ('rec-luz', 'org-z', 'cat-out', 'uni-z1', 'DESPESA', 'Conta de luz', 280.80, 1, '2020-01-01');

  insert into colaboradores (id, org_id, unidade_id, nome, jornada_min, criado_em, atualizado_em) values
    ('col-vini', 'org-z', 'uni-z1', 'Vinicius', '{480,480,480,480,480,480,480}', '2026-09-01T12:00:00Z', now());
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
    produto: await import('../src/servidor/produto'),
    fin: await import('../src/servidor/financeiro'),
    rec: await import('../src/servidor/recorrentes'),
    ponto: await import('../src/servidor/ponto'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  const g = globalThis as { __prismaNorte?: unknown }
  delete g.__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linha = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

describe('eixos e opções de variação', () => {
  it('o eixo criado por engano, sem uso, some de verdade', async () => {
    const oi = await m.produto.criarEixoDaEmpresa(DONO, 'oi')
    await m.produto.criarOpcaoDoEixo(DONO, oi.id, 'qualquer')
    expect(await m.produto.excluirEixo(DONO, oi.id)).toEqual({ como: 'apagado' })
    expect(await linha(`select id from eixos where id = $1`, [oi.id])).toHaveLength(0)
    expect(await linha(`select id from opcoes where eixo_id = $1`, [oi.id])).toHaveLength(0)
  })

  it('opção marcada num produto à venda não sai, e a mensagem diz onde está', async () => {
    await expect(m.produto.excluirOpcao(DONO, 'op-mor')).rejects.toThrow('Picolé')
    await expect(m.produto.excluirEixo(DONO, 'eixo-sabor')).rejects.toThrow('Picolé')
  })

  it('opção só em item antigo (desmarcado) é arquivada: some da tela e volta se escrita de novo', async () => {
    expect(await m.produto.excluirOpcao(DONO, 'op-uva')).toEqual({ como: 'arquivada' })
    const eixos = await m.produto.eixosDaEmpresa(DONO)
    expect(eixos.find((e) => e.id === 'eixo-sabor')!.opcoes.map((o) => o.valor)).toEqual(['Morango'])
    // O item antigo continua dizendo o sabor.
    expect(await linha(`select id from variacao_opcoes where id = 'vo-2'`)).toHaveLength(1)

    const devolta = await m.produto.criarOpcaoDoEixo(DONO, 'eixo-sabor', 'uva')
    expect(devolta.id).toBe('op-uva')
    const [op] = await linha<{ arquivado_em: Date | null }>(`select arquivado_em from opcoes where id = 'op-uva'`)
    expect(op!.arquivado_em).toBeNull()
  })

  it('renomear: troca o nome, recusa repetido e vazio', async () => {
    expect(await m.produto.renomearOpcao(DONO, 'op-mor', ' Morango  silvestre ')).toEqual({ id: 'op-mor', valor: 'Morango silvestre' })
    await expect(m.produto.renomearOpcao(DONO, 'op-mor', 'UVA')).rejects.toThrow('Já existe')
    await expect(m.produto.renomearOpcao(DONO, 'op-mor', '  ')).rejects.toThrow('Escreva')
    expect((await m.produto.renomearEixo(DONO, 'eixo-sabor', 'Sabores')).nome).toBe('Sabores')
    const livro = await linha<{ acao: string }>(`select acao from auditoria where acao in ('produto.opcao.renomeou','produto.eixo.renomeou','produto.opcao.arquivou','produto.eixo.apagou')`)
    expect(new Set(livro.map((l) => l.acao))).toEqual(new Set(['produto.opcao.renomeou', 'produto.eixo.renomeou', 'produto.opcao.arquivou', 'produto.eixo.apagou']))
  })

  it('quem só vende não mexe nos eixos', async () => {
    await expect(m.produto.renomearEixo(BALCAO, 'eixo-sabor', 'X')).rejects.toThrow()
    await expect(m.produto.excluirOpcao(BALCAO, 'op-uva')).rejects.toThrow()
  })
})

describe('corrigir e excluir lançamento', () => {
  it('corrige descrição, valor e vencimento, e o livro guarda o antes', async () => {
    const id = await m.fin.lancar(DONO, {
      tipo: 'DESPESA', categoriaId: 'cat-out', unidadeId: 'uni-z1', descricao: 'Teste',
      valor: 200, vencimento: colunaDoDia(`${MES}-05`),
    })
    await m.fin.editarLancamento(DONO, id, { descricao: 'Gelo', valor: 1754.05, vencimento: colunaDoDia(`${MES}-06`) })
    const [l] = await linha<{ descricao: string; valor: string }>(`select descricao, valor::text from lancamentos where id = $1`, [id])
    expect(l).toEqual({ descricao: 'Gelo', valor: '1754.05' })
    const [a] = await linha<{ antes: { valor: number } }>(`select antes from auditoria where acao = 'financeiro.editou' and alvo_id = $1`, [id])
    expect(a!.antes.valor).toBe(200)
  })

  it('exclui com motivo; sem motivo, não', async () => {
    const id = await m.fin.lancar(DONO, {
      tipo: 'DESPESA', categoriaId: 'cat-out', unidadeId: 'uni-z1', descricao: 'Lançado em dobro',
      valor: 660, vencimento: colunaDoDia(`${MES}-07`), pagoEm: colunaDoDia(diaEmSP()),
    })
    await expect(m.fin.excluirLancamento(DONO, id, '')).rejects.toThrow('motivo')
    await m.fin.excluirLancamento(DONO, id, 'era teste')
    expect(await linha(`select id from lancamentos where id = $1`, [id])).toHaveLength(0)
    const [a] = await linha<{ motivo: string; valor: string }>(`select motivo, valor::text from auditoria where acao = 'financeiro.excluiu' and alvo_id = $1`, [id])
    expect(a).toEqual({ motivo: 'era teste', valor: '660.00' })
  })

  it('a conta fixa excluída no mês não nasce de novo naquele mês', async () => {
    expect(await m.rec.gerarRecorrentesDoMes(DONO, MES)).toBe(1)
    const [l] = await linha<{ id: string }>(`select id from lancamentos where recorrente_id = 'rec-luz'`)
    await m.fin.excluirLancamento(DONO, l!.id, 'não tem luz nesta loja')
    const [r] = await linha<{ pulados: string[] }>(`select pulados from recorrentes where id = 'rec-luz'`)
    expect(r!.pulados).toEqual([MES])
    expect(await m.rec.gerarRecorrentesDoMes(DONO, MES)).toBe(0)
    expect(await linha(`select id from lancamentos where recorrente_id = 'rec-luz'`)).toHaveLength(0)
  })

  it('o mês pulado fica de fora da geração; os outros, não', () => {
    const r = { id: 'r', ativo: true, diaVencimento: 10, ateEm: null, criadoEm: new Date('2020-01-01'), pulados: ['2030-03'] }
    expect(aGerar([r], [], '2030-03')).toEqual([])
    expect(aGerar([r], [], '2030-04')).toHaveLength(1)
  })

  it('o lançamento da encomenda não se corrige nem se exclui por aqui', async () => {
    await db.exec(`insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, vencimento, pago_em, observacoes, quem, atualizado_em)
      values ('l-enc', 'org-z', 'uni-z1', 'cat-out', 'RECEITA', 'Sinal — Ana: bolo', 50, current_date, current_date,
              'Gerado pela encomenda. Não lance de novo no balcão.', 'Vitor', now())`)
    await expect(m.fin.excluirLancamento(DONO, 'l-enc', 'teste')).rejects.toThrow('encomenda')
    await expect(m.fin.editarLancamento(DONO, 'l-enc', { descricao: 'x', valor: 1, vencimento: colunaDoDia(`${MES}-01`) })).rejects.toThrow('encomenda')
    const lista = await m.fin.listarLancamentos(DONO, { ano: Number(MES.slice(0, 4)), mes: Number(MES.slice(5)), unidadeIds: ['uni-z1'] })
    expect(lista.find((l) => l.id === 'l-enc')?.daEncomenda).toBe(true)
  })
})

describe('abono e primeiro dia no ponto', () => {
  const AGORA = new Date('2026-10-05T15:00:00Z')

  it('o dia abonado não tem jornada nem falta', () => {
    const f = folhaDoMes([], [480, 480, 480, 480, 480, 480, 480], '2026-09', AGORA, '2026-09-01', new Map([['2026-09-03', 'Atestado']]))
    const d = f.dias.find((x) => x.dia === '2026-09-03')!
    expect(d).toMatchObject({ falta: false, previsto: 0, abono: 'Atestado' })
    expect(f.totais.faltas).toBe(29)
  })

  it('abonar, tirar o abono e mudar o primeiro dia mudam a folha', async () => {
    const faltas = async () => (await m.ponto.folhaDe(DONO, 'col-vini', '2026-09', AGORA))!.folha.totais.faltas
    expect(await faltas()).toBe(30)

    expect(await m.ponto.abonarDia(DONO, { colaboradorId: 'col-vini', dia: '2026-09-25', motivo: 'Folga' }, AGORA)).toEqual({ ok: true })
    expect(await faltas()).toBe(29)
    // Abonar de novo o mesmo dia troca o motivo, não duplica.
    await m.ponto.abonarDia(DONO, { colaboradorId: 'col-vini', dia: '2026-09-25', motivo: 'Feriado' }, AGORA)
    expect(await linha(`select motivo from abonos_ponto`)).toEqual([{ motivo: 'Feriado' }])

    expect(await m.ponto.definirInicio(DONO, { colaboradorId: 'col-vini', dia: '2026-09-21' })).toEqual({ ok: true })
    const folha = (await m.ponto.folhaDe(DONO, 'col-vini', '2026-09', AGORA))!
    expect(folha.colaborador.inicio).toBe('2026-09-21')
    expect(folha.folha.totais.faltas).toBe(9) // 21 a 30, menos o 25 abonado

    await m.ponto.desfazerAbono(DONO, { colaboradorId: 'col-vini', dia: '2026-09-25' })
    expect(await faltas()).toBe(10)

    const livro = await linha<{ acao: string }>(`select acao from auditoria where acao like 'ponto.%' order by criado_em`)
    expect(livro.map((l) => l.acao)).toEqual(['ponto.abonou', 'ponto.abonou', 'ponto.inicio', 'ponto.desabonou'])
  })

  it('motivo curto e dia que não existe são recusados; quem só vende não abona', async () => {
    expect(await m.ponto.abonarDia(DONO, { colaboradorId: 'col-vini', dia: '2026-09-25', motivo: 'x' }, AGORA)).toMatchObject({ ok: false })
    expect(await m.ponto.abonarDia(DONO, { colaboradorId: 'col-vini', dia: '2026-02-31', motivo: 'Folga' }, AGORA)).toMatchObject({ ok: false })
    await expect(m.ponto.abonarDia(BALCAO, { colaboradorId: 'col-vini', dia: '2026-09-25', motivo: 'Folga' }, AGORA)).rejects.toThrow()
  })
})

describe('fase 2: o que o funcionário vê', () => {
  it('o balcão não vê a Fábrica, nem vendas e caixa de outros dias; o gerente vê', async () => {
    const { pode, PODERES, CAPACIDADES_DE_CARGO } = await import('../src/servidor/permissao')
    for (const c of ['fabrica.ver', 'fabrica.pedir', 'venda.historico', 'caixa.historico'] as const) {
      expect(pode(BALCAO, c, 'uni-z1')).toBe(false)
      expect(PODERES.GERENTE).toContain(c)
      expect(CAPACIDADES_DE_CARGO).toContain(c)
    }
    expect(pode(BALCAO, 'venda.ver', 'uni-z1')).toBe(true)
    expect(pode(BALCAO, 'estoque.ver', 'uni-z1')).toBe(true)
  })

  it('a tarefa diária feita ontem volta para "a fazer"; a de hoje fica feita', async () => {
    await db.exec(`
      insert into quadros (id, org_id, unidade_id, nome, quem, atualizado_em) values
        ('q-ab', 'org-z', 'uni-z1', 'Abertura e fechamento da casa', 'Vitor', now()),
        ('q-out', 'org-z', null, 'Campanha', 'Vitor', now());
      insert into tarefas (id, org_id, quadro_id, grupo, titulo, situacao, progresso, concluida_em, diaria, quem, atualizado_em) values
        ('t-ontem', 'org-z', 'q-ab', 'Ao abrir', 'Conferir o troco', 'FEITO', 100, now() - interval '2 days', true, 'Vitor', now()),
        ('t-hoje', 'org-z', 'q-ab', 'Ao abrir', 'Ligar a maquininha', 'FEITO', 100, null, true, 'Vitor', now()),
        ('t-aberta', 'org-z', 'q-ab', 'Ao fechar', 'Sangria', 'A_FAZER', 0, null, true, 'Vitor', now()),
        ('t-camp', 'org-z', 'q-out', '', 'Montar a vitrine da campanha', 'A_FAZER', 0, null, false, 'Vitor', now()),
        ('t-minha', 'org-z', 'q-out', '', 'Ligar para o fornecedor', 'A_FAZER', 0, null, false, 'Vitor', now());
      update tarefas set responsavel_id = 'usr-bal' where id = 't-minha';
    `)
    // A hora de "feita hoje" vem do relógio do sistema, como o app grava: o
    // now() do banco de teste fica no fuso local e, logo depois da meia-noite
    // de São Paulo, cairia em "ontem".
    await db.query(`update tarefas set concluida_em = $1 where id = 't-hoje'`, [new Date()])
    const tarefas = await import('../src/servidor/tarefas')
    const hoje = await tarefas.tarefasDeHoje(BALCAO, 'uni-z1')
    // Diárias sem dono + as dela; a da campanha sem dono não entra no balcão.
    expect(hoje.map((t) => [t.id, t.feita]).sort()).toEqual(
      [['t-aberta', false], ['t-hoje', true], ['t-minha', false], ['t-ontem', false]].sort(),
    )
    const [t] = await linha<{ situacao: string; concluida_em: Date | null }>(`select situacao, concluida_em from tarefas where id = 't-ontem'`)
    expect(t).toEqual({ situacao: 'A_FAZER', concluida_em: null })
  })
})

describe('fase 3: preço por loja, composição e custo em %', () => {
  beforeAll(async () => {
    await db.exec(`
      update orgs set pin_em_toda_venda = false, vende_sem_estoque = false where id = 'org-z';
      insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
        ('uni-z2', 'org-z', 'Shopping', false, true, now());
      insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
        ('cx-z1', 'org-z', 'uni-z1', 'Vitor', 100),
        ('cx-z2', 'org-z', 'uni-z2', 'Vitor', 100);
      insert into produtos (id, org_id, nome, medida, preco_vista, custo, ativo, atualizado_em) values
        ('p-casq', 'org-z', 'Casquinha', 'UN', 5.00, 1.00, true, now()),
        ('p-agua', 'org-z', 'Água', 'UN', 3.00, 0.80, true, now()),
        ('p-combo', 'org-z', 'Casquinha + Água', 'UN', 7.00, null, true, now());
      insert into variacoes (id, org_id, produto_id, codigo, padrao, ativa) values
        ('v-casq', 'org-z', 'p-casq', 'CASQ', true, true),
        ('v-agua', 'org-z', 'p-agua', 'AGUA', true, true),
        ('v-combo', 'org-z', 'p-combo', 'COMBO', true, true);
      insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
        ('e-casq', 'org-z', 'v-casq', 'uni-z1', 100, now()),
        ('e-agua', 'org-z', 'v-agua', 'uni-z1', 2, now()),
        ('e-casq2', 'org-z', 'v-casq', 'uni-z2', 100, now());
    `)
  })

  const saldo = async (v: string, u = 'uni-z1') =>
    Number((await linha<{ quantidade: string }>(`select quantidade from estoque where variacao_id = $1 and unidade_id = $2`, [v, u]))[0]?.quantidade ?? 0)

  it('a loja com preço próprio cobra o dela; a outra, o geral', async () => {
    const pl = await import('../src/servidor/preco-loja')
    const venda = await import('../src/servidor/venda')
    await pl.definirPrecoNaLoja(DONO, 'p-casq', 'uni-z2', { vista: 6.5, cartao: null, crediario: null })
    await expect(pl.definirPrecoNaLoja(BALCAO, 'p-casq', 'uni-z1', { vista: 1, cartao: null, crediario: null })).rejects.toThrow()

    const shopping = await venda.registrarVenda(DONO, {
      unidadeId: 'uni-z2', caixaId: 'cx-z2', itens: [{ variacaoId: 'v-casq', quantidade: 2 }], pagamentos: [{ forma: 'PIX', valor: 13 }],
    })
    expect(shopping).toMatchObject({ ok: true, total: 13 })
    const bairro = await venda.registrarVenda(DONO, {
      unidadeId: 'uni-z1', caixaId: 'cx-z1', itens: [{ variacaoId: 'v-casq', quantidade: 2 }], pagamentos: [{ forma: 'PIX', valor: 10 }],
    })
    expect(bairro).toMatchObject({ ok: true, total: 10 })

    // Voltar ao geral.
    await pl.definirPrecoNaLoja(DONO, 'p-casq', 'uni-z2', null)
    expect(await linha(`select id from precos_na_loja`)).toHaveLength(0)
  })

  it('o item composto baixa o que leva, custa a soma, e o cancelamento devolve', async () => {
    const comp = await import('../src/servidor/composicao')
    const venda = await import('../src/servidor/venda')
    await comp.definirComposicao(DONO, 'v-combo', [{ componenteId: 'v-casq', quantidade: 1 }, { componenteId: 'v-agua', quantidade: 1 }])
    // Um nível só, e nunca ele mesmo.
    await expect(comp.definirComposicao(DONO, 'var-mor', [{ componenteId: 'v-combo', quantidade: 1 }])).rejects.toThrow('composto')
    await expect(comp.definirComposicao(DONO, 'v-combo', [{ componenteId: 'v-combo', quantidade: 1 }])).rejects.toThrow('ele mesmo')

    const antesCasq = await saldo('v-casq')
    const r = await venda.registrarVenda(DONO, {
      unidadeId: 'uni-z1', caixaId: 'cx-z1', itens: [{ variacaoId: 'v-combo', quantidade: 2 }], pagamentos: [{ forma: 'PIX', valor: 14 }],
    })
    expect(r).toMatchObject({ ok: true, total: 14 })
    expect(await saldo('v-casq')).toBe(antesCasq - 2)
    expect(await saldo('v-agua')).toBe(0)
    expect(await linha(`select id from estoque where variacao_id = 'v-combo'`)).toHaveLength(0)
    const [item] = await linha<{ custo_unit: string }>(`select custo_unit::text from venda_itens where variacao_id = 'v-combo'`)
    expect(Number(item!.custo_unit)).toBeCloseTo(1.8)

    // Sem água no freezer: a recusa diz qual componente falta.
    const sem = await venda.registrarVenda(DONO, {
      unidadeId: 'uni-z1', caixaId: 'cx-z1', itens: [{ variacaoId: 'v-combo', quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 7 }],
    })
    expect(sem).toMatchObject({ ok: false, motivo: 'sem_estoque', faltando: [{ descricao: 'Água' }] })

    if (!r.ok) throw new Error('venda')
    expect(await venda.cancelarVenda(DONO, r.vendaId, 'teste de composição')).toMatchObject({ ok: true })
    expect(await saldo('v-casq')).toBe(antesCasq)
    expect(await saldo('v-agua')).toBe(2)
  })

  it('o custo em % é do preço à vista; "35%" não vira mais R$ 35', async () => {
    const { lerCusto } = await import('../src/servidor/dinheiro')
    expect(lerCusto('35%', 54.9)).toEqual({ valor: 19.215 })
    expect(lerCusto(' 4,50 ', 10)).toEqual({ valor: 4.5 })
    expect(lerCusto('0,0028', null)).toEqual({ valor: 0.0028 })
    expect(lerCusto('35%', null)).toMatchObject({ erro: expect.stringContaining('preço à vista') })
    expect(lerCusto('150%', 10)).toMatchObject({ erro: expect.any(String) })
    expect(lerCusto('', 10)).toBeNull()
  })
})
