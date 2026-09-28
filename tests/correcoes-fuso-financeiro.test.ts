// O servidor em UTC, e o dinheiro do mês.
//
// A Vercel roda em UTC. Toda conta de "hoje", "este mês" e "período" que
// usava o relógio da máquina (`new Date(ano, mes, dia)`, `setHours(0)`,
// `getMonth()`) virava o dia de Londres: às 22h30 do dia 30 em São Paulo o
// painel e o financeiro já abriam o mês seguinte, vazio. Este arquivo roda
// INTEIRO com TZ=UTC — o fuso é trocado antes de qualquer import — e prova as
// janelas de São Paulo às 22h30 do último dia do mês.
//
// Junto, com banco de verdade (PGlite, como em regras-servidor.test.ts), as
// correções do financeiro da auditoria de 27/09: o custo do que voltou em
// devolução, o gráfico de seis meses igual ao DRE, "sem loja" é a empresa
// inteira, a baixa com dia e com desfazer, o fechamento preso ao mês, a
// troca de plano para baixo e o teste que venceu.

process.env.TZ = 'UTC'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { janela } from '../src/servidor/periodo'
import { mesChave } from '../src/servidor/metas'
import { densificar } from '../src/servidor/painel'
import { janelaDoMes, lerMes, mesDeAgora, outroMes } from '../src/servidor/financeiro'

// 22h30 do dia 30 de setembro em São Paulo = 01h30 do dia 1º de outubro em UTC.
const AS_22H30_DO_DIA_30 = new Date('2026-09-30T22:30:00-03:00')
const iso = (d: Date) => d.toISOString()

describe('com o servidor em UTC, o calendário continua o de São Paulo', () => {
  it('o processo está mesmo em UTC (senão este arquivo não prova nada)', () => {
    expect(new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()).toBe(0)
    expect(new Date(2026, 8, 30, 22, 30).getHours()).toBe(22)
    expect(new Date(2026, 8, 30).toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })

  it('"hoje" às 22h30 do dia 30 ainda é o dia 30', () => {
    const j = janela('hoje', AS_22H30_DO_DIA_30)
    expect(iso(j.de)).toBe('2026-09-30T03:00:00.000Z')
    expect(iso(j.ate)).toBe('2026-10-01T03:00:00.000Z')
    expect(AS_22H30_DO_DIA_30 >= j.de && AS_22H30_DO_DIA_30 < j.ate).toBe(true)
  })

  it('"este mês" ainda é setembro, e a comparação é agosto inteiro até o dia 30', () => {
    const j = janela('mes', AS_22H30_DO_DIA_30)
    expect(iso(j.de)).toBe('2026-09-01T03:00:00.000Z')
    expect(iso(j.ate)).toBe('2026-10-01T03:00:00.000Z')
    expect(j.dias).toBe(30)
    expect(iso(j.deAnterior)).toBe('2026-08-01T03:00:00.000Z')
    expect(iso(j.ateAnterior)).toBe('2026-08-31T03:00:00.000Z')
  })

  it('"mês passado" é agosto, e 30 dias termina amanhã de São Paulo', () => {
    const p = janela('mes-passado', AS_22H30_DO_DIA_30)
    expect(iso(p.de)).toBe('2026-08-01T03:00:00.000Z')
    expect(iso(p.ate)).toBe('2026-09-01T03:00:00.000Z')
    expect(iso(p.deAnterior)).toBe('2026-07-01T03:00:00.000Z')
    const t = janela('30d', AS_22H30_DO_DIA_30)
    expect(iso(t.de)).toBe('2026-09-01T03:00:00.000Z')
    expect(iso(t.ate)).toBe('2026-10-01T03:00:00.000Z')
  })

  it('no dia 31 de março, o pedaço de fevereiro para no fim de fevereiro', () => {
    const j = janela('mes', new Date('2026-03-31T22:30:00-03:00'))
    expect(iso(j.ateAnterior)).toBe('2026-03-01T03:00:00.000Z')
  })

  it('a chave do mês, o mês de agora e a janela do mês', () => {
    expect(mesChave(AS_22H30_DO_DIA_30)).toBe('2026-09')
    expect(mesDeAgora(AS_22H30_DO_DIA_30)).toBe('2026-09')
    const { de, ate } = janelaDoMes('2026-09')
    expect(iso(de)).toBe('2026-09-01T03:00:00.000Z')
    expect(iso(ate)).toBe('2026-10-01T03:00:00.000Z')
    expect(outroMes('2026-12', 1)).toBe('2027-01')
  })

  it('o gráfico por dia tem as chaves de São Paulo — o dia 30 não vira dia 1º', () => {
    const j = janela('7d', AS_22H30_DO_DIA_30)
    const dias = densificar(j.de, j.ate, [{ dia: '2026-09-30', total: 99, vendas: 1 }])
    expect(dias.map((d) => d.dia)).toEqual([
      '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
    ])
    expect(dias.at(-1)!.total).toBe(99)
  })

  it('o mês do endereço: "2026-9" vale, lista e lixo não', () => {
    expect(lerMes('2026-9')).toBe('2026-09')
    expect(lerMes('2026-13')).toBeNull()
    expect(lerMes(['2026-09', '2026-08'])).toBeNull()
    expect(lerMes(undefined)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// COM BANCO
// ─────────────────────────────────────────────────────────────

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  financeiro: typeof import('../src/servidor/financeiro')
  recorrentes: typeof import('../src/servidor/recorrentes')
  fechamento: typeof import('../src/servidor/fechamento')
  painel: typeof import('../src/servidor/painel')
  relatorios: typeof import('../src/servidor/relatorios')
  assinatura: typeof import('../src/servidor/assinatura')
  agente: typeof import('../src/servidor/agente')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, acessos: { papel: Papel; unidadeId: string | null }[], orgId = 'org-f'): Sessao => ({
  orgId,
  usuarioId,
  nome: usuarioId,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONA = sessao('usr-dona', [{ papel: 'DONO', unidadeId: null }])
const FIN_CENTRO = sessao('usr-fin', [{ papel: 'FINANCEIRO', unidadeId: 'u-centro' }])
const CONTADOR = sessao('usr-cont', [{ papel: 'CONTADOR', unidadeId: null }])
const DONA_DESCE = sessao('usr-d2', [{ papel: 'DONO', unidadeId: null }], 'org-desce')
const DONA_TESTE = sessao('usr-d3', [{ papel: 'DONO', unidadeId: null }], 'org-teste')
const DONA_GRATIS = sessao('usr-d4', [{ papel: 'DONO', unidadeId: null }], 'org-gratis')

// Os instantes vão em UTC: `timestamp` sem fuso ignora o "-03:00" escrito.
const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em, teste_ate) values
    ('org-f', 'Loja F', 'loja-f', 'REDE', 'ATIVA', '{multiUnidade,agente,metas,crediario}', now(), now(), null),
    ('org-desce', 'Desce', 'desce', 'REDE', 'ATIVA', '{agente,metas}', now(), now(), null),
    ('org-teste', 'Teste', 'teste', 'REDE', 'TESTE', '{agente,metas,multiUnidade}', now(), now(), now() - interval '2 days'),
    ('org-gratis', 'Grátis', 'gratis', 'GRATIS', 'ATIVA', '{}', now(), now(), null);

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('u-centro', 'org-f', 'Centro', false, now()),
    ('u-shop', 'org-f', 'Shopping', false, now()),
    ('u-desce', 'org-desce', 'Única', false, now()),
    ('u-teste', 'org-teste', 'Única', false, now()),
    ('u-gratis', 'org-gratis', 'Única', false, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-f', 'Dona', 'dona@f.com', now()),
    ('usr-fin', 'org-f', 'Fin', 'fin@f.com', now()),
    ('usr-cont', 'org-f', 'Contador', 'cont@f.com', now()),
    ('usr-d2', 'org-desce', 'D2', 'd2@x.com', now()),
    ('usr-d3', 'org-teste', 'D3', 'd3@x.com', now()),
    ('usr-d4', 'org-gratis', 'D4', 'd4@x.com', now());

  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('c-desp', 'org-f', 'Outras despesas', 'DESPESA', 'OUTRA'),
    ('c-rec', 'org-f', 'Outras receitas', 'RECEITA', 'RECEITA_OUTRA');

  -- Setembro: uma venda às 22h30 do dia 30 (01h30 UTC do dia 1º) e outra no
  -- último segundo do mês; cada uma de 2 peças a R$ 50, custo R$ 20.
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, criada_em) values
    ('v-noite', 'org-f', 'u-centro', 1, 'CONCLUIDA', 100.00, '2026-10-01 01:30:00'),
    ('v-fim',   'org-f', 'u-centro', 2, 'CONCLUIDA', 100.00, '2026-10-01 02:59:59.500'),
    ('v-out',   'org-f', 'u-centro', 3, 'CONCLUIDA', 100.00, '2026-10-01 03:00:00');
  insert into venda_itens (id, org_id, venda_id, descricao, quantidade, preco_unit, total, custo_unit) values
    ('vi-noite', 'org-f', 'v-noite', 'Camiseta', 2, 50.00, 100.00, 20.00),
    ('vi-fim',   'org-f', 'v-fim',   'Camiseta', 2, 50.00, 100.00, 20.00),
    ('vi-out',   'org-f', 'v-out',   'Camiseta', 2, 50.00, 100.00, 20.00);
  insert into pagamentos (id, org_id, venda_id, forma, valor) values
    ('pg-noite', 'org-f', 'v-noite', 'DINHEIRO', 100.00),
    ('pg-fim',   'org-f', 'v-fim',   'DINHEIRO', 100.00),
    ('pg-out',   'org-f', 'v-out',   'DINHEIRO', 100.00);

  -- Uma peça da venda da noite volta no dia 30 mesmo.
  insert into devolucoes (id, org_id, venda_id, unidade_id, destino, valor, motivo, quem, criada_em) values
    ('d-1', 'org-f', 'v-noite', 'u-centro', 'VALE', 50.00, 'tamanho', 'Dona', '2026-10-01 02:00:00');
  insert into devolucao_itens (id, org_id, devolucao_id, venda_item_id, quantidade, valor) values
    ('di-1', 'org-f', 'd-1', 'vi-noite', 1, 50.00);

  -- Uma receita lançada e paga em setembro (sinal de encomenda, por exemplo),
  -- uma despesa paga, e contas da empresa inteira e da loja.
  insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, vencimento, pago_em, quem, atualizado_em) values
    ('l-sinal', 'org-f', 'u-centro', 'c-rec', 'RECEITA', 'Sinal de encomenda', 30.00, '2026-09-15', '2026-09-15', 'Dona', now()),
    ('l-luz', 'org-f', 'u-centro', 'c-desp', 'DESPESA', 'Luz', 40.00, '2026-09-10', '2026-09-10', 'Dona', now()),
    ('l-emp', 'org-f', null, 'c-desp', 'DESPESA', 'Contador', 500.00, '2026-10-20', null, 'Dona', now()),
    ('l-ago', 'org-f', 'u-centro', 'c-desp', 'DESPESA', 'Aluguel de agosto', 900.00, '2026-08-20', null, 'Dona', now()),
    ('l-out', 'org-f', 'u-centro', 'c-desp', 'DESPESA', 'Internet de outubro', 100.00, '2026-10-05', null, 'Dona', now()),
    ('l-pagar', 'org-f', 'u-centro', 'c-desp', 'DESPESA', 'Água', 60.00, '2026-09-20', null, 'Dona', now());

  insert into recorrentes (id, org_id, unidade_id, categoria_id, tipo, descricao, valor, dia_vencimento, criado_em) values
    ('r-emp', 'org-f', null, 'c-desp', 'DESPESA', 'Sistema', 99.00, 5, '2026-01-01');

  -- Um caixa aberto em OUTUBRO (esquecido ontem) e um de agosto, fechado sem diferença.
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura, aberto, aberto_em) values
    ('cx-out', 'org-f', 'u-centro', 'Balcão', 100, true, '2026-10-02 12:00:00');
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura, aberto, aberto_em, fechado_em, saldo_esperado, saldo_contado) values
    ('cx-ago', 'org-f', 'u-centro', 'Balcão', 100, false, '2026-08-10 12:00:00', '2026-08-10 22:00:00', 100, 100);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 56000 + Math.floor(Math.random() * 2500)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    financeiro: await import('../src/servidor/financeiro'),
    recorrentes: await import('../src/servidor/recorrentes'),
    fechamento: await import('../src/servidor/fechamento'),
    painel: await import('../src/servidor/painel'),
    relatorios: await import('../src/servidor/relatorios'),
    assinatura: await import('../src/servidor/assinatura'),
    agente: await import('../src/servidor/agente'),
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
const LOJAS = ['u-centro', 'u-shop']
const setembro = () => {
  const { de, ate } = janelaDoMes('2026-09')
  return { de, ate: new Date(ate.getTime() - 1) }
}
const valor = (dre: { linhas: { chave: string; valor: number }[] }, chave: string) =>
  dre.linhas.find((l) => l.chave === chave)?.valor ?? 0

describe('o DRE do mês, num servidor em UTC', () => {
  it('a venda das 22h30 do dia 30 e a do último segundo entram em setembro; a de 00h de outubro, não', async () => {
    const { de, ate } = setembro()
    const dre = await m.financeiro.montarDRE(DONA, LOJAS, de, ate)
    expect(valor(dre, 'venda')).toBe(200)
  })

  it('a devolução tira a receita E o custo da peça que voltou', async () => {
    const { de, ate } = setembro()
    const dre = await m.financeiro.montarDRE(DONA, LOJAS, de, ate)
    expect(dre.devolucoes).toBe(50)
    // 4 peças vendidas a custo 20 = 80; 1 voltou = 60.
    expect(valor(dre, 'cmv')).toBe(-60)
    // 200 − 50 + 30 (sinal) = 180 de receita; − 60 de CMV − 40 de luz = 80.
    expect(valor(dre, 'bruta')).toBe(180)
    expect(dre.resultado).toBe(80)
  })

  it('o gráfico de seis meses dá, em setembro, o MESMO resultado do quadro', async () => {
    const { de, ate } = setembro()
    const dre = await m.financeiro.montarDRE(DONA, LOJAS, de, ate)
    const meses = await m.financeiro.resultadoPorMes(DONA, LOJAS, 6, AS_22H30_DO_DIA_30)
    expect(meses.map((x) => x.mes)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
    const set = meses.at(-1)!
    expect(set.resultado).toBe(dre.resultado)
    expect(set.receita).toBe(180)
    expect(set.receita - set.cmv - set.despesas - set.taxas).toBeCloseTo(dre.resultado)
  })
})

describe('as margens de Painel e Análise contam a devolução', () => {
  it('o painel desconta o custo do que voltou', async () => {
    const r = await m.painel.resumoDoPainel(DONA, LOJAS, janela('mes', AS_22H30_DO_DIA_30))
    expect(r.atual.total).toBe(200)
    expect(r.devolucoes.valor).toBe(50)
    expect(r.atual.custo).toBe(60)
  })

  it('a comparação entre lojas e a curva ABC tiram receita e custo devolvidos', async () => {
    const j = janela('mes', AS_22H30_DO_DIA_30)
    const [centro] = (await m.relatorios.compararLojas(DONA, LOJAS, j.de, j.ate)).filter((l) => l.unidadeId === 'u-centro')
    expect(centro!.receita).toBe(150)
    expect(centro!.custo).toBe(60)
    expect(centro!.margem).toBe(90)
  })
})

describe('"sem loja" é a empresa inteira', () => {
  it('o financeiro de uma loja não lança conta da empresa inteira', async () => {
    await expect(
      m.financeiro.lancar(FIN_CENTRO, {
        categoriaId: 'c-desp', tipo: 'DESPESA', descricao: 'Aluguel do escritório', valor: 10,
        vencimento: new Date('2026-09-10T00:00:00Z'), unidadeId: null,
      }),
    ).rejects.toThrow(/permissão/)
    // Na própria loja, lança.
    await expect(
      m.financeiro.lancar(FIN_CENTRO, {
        categoriaId: 'c-desp', tipo: 'DESPESA', descricao: 'Sacolas', valor: 10,
        vencimento: new Date('2026-09-10T00:00:00Z'), unidadeId: 'u-centro',
      }),
    ).resolves.toBeTruthy()
  })

  it('nem dá baixa nela', async () => {
    await expect(
      m.financeiro.marcarPago(FIN_CENTRO, 'l-emp', new Date('2026-09-28T00:00:00Z'), AS_22H30_DO_DIA_30),
    ).rejects.toThrow(/permissão/)
  })

  it('nem cria, edita ou pausa a conta recorrente da empresa', async () => {
    await expect(
      m.recorrentes.criarRecorrente(FIN_CENTRO, { descricao: 'Contador', categoriaId: 'c-desp', valor: 10, diaVencimento: 5, unidadeId: null }),
    ).rejects.toThrow(/permissão/)
    await expect(m.recorrentes.alternarRecorrente(FIN_CENTRO, 'r-emp', false)).rejects.toThrow(/permissão/)
    const [r] = await linha<{ ativo: boolean }>(`select ativo from recorrentes where id = 'r-emp'`)
    expect(r!.ativo).toBe(true)
  })
})

describe('abrir o Financeiro só para ler não escreve nada', () => {
  it('o contador abre a tela e nenhuma conta recorrente nasce', async () => {
    expect(await m.recorrentes.garantirRecorrentes(CONTADOR, null, AS_22H30_DO_DIA_30)).toBe(0)
    const gerados = await linha(`select id from lancamentos where recorrente_id = 'r-emp'`)
    expect(gerados).toHaveLength(0)
  })

  it('quem lança na empresa inteira gera', async () => {
    expect(await m.recorrentes.garantirRecorrentes(DONA, null, AS_22H30_DO_DIA_30)).toBeGreaterThan(0)
  })
})

describe('"Paguei" tem dia, e se desfaz', () => {
  it('dá baixa no dia escolhido', async () => {
    await m.financeiro.marcarPago(DONA, 'l-pagar', new Date('2026-09-26T00:00:00Z'), AS_22H30_DO_DIA_30)
    const [l] = await linha<{ pago_em: Date }>(`select pago_em from lancamentos where id = 'l-pagar'`)
    expect(new Date(l!.pago_em).toISOString().slice(0, 10)).toBe('2026-09-26')
  })

  it('dia depois de hoje não é pagamento', async () => {
    await expect(
      m.financeiro.marcarPago(DONA, 'l-pagar', new Date('2026-10-01T00:00:00Z'), AS_22H30_DO_DIA_30),
    ).rejects.toThrow(/depois de hoje/)
  })

  it('trocar o dia e desfazer ficam no livro', async () => {
    await m.financeiro.marcarPago(DONA, 'l-pagar', new Date('2026-09-27T00:00:00Z'), AS_22H30_DO_DIA_30)
    await m.financeiro.marcarPago(DONA, 'l-pagar', null, AS_22H30_DO_DIA_30)
    const [l] = await linha<{ pago_em: Date | null }>(`select pago_em from lancamentos where id = 'l-pagar'`)
    expect(l!.pago_em).toBeNull()
    const livro = await linha<{ acao: string }>(
      `select acao from auditoria where alvo_id = 'l-pagar' order by criado_em, acao`,
    )
    expect(livro.map((x) => x.acao).sort()).toEqual(['financeiro.despagou', 'financeiro.pagou', 'financeiro.pagou'])
  })
})

describe('o fechamento de um mês passado olha AQUELE mês', () => {
  it('agosto, olhado em outubro: o caixa esquecido em outubro e a conta de outubro não pesam', async () => {
    const f = await m.fechamento.montarFechamento(DONA, LOJAS, '2026-08', 'loja-f', false, new Date('2026-10-03T12:00:00-03:00'))
    const caixas = f.itens.find((i) => i.chave === 'caixas')!
    expect(caixas.situacao).toBe('ok')
    const contas = f.itens.find((i) => i.chave === 'contas')!
    // Só o aluguel de agosto: nem a internet de outubro nem o contador de outubro.
    expect(contas.detalhe).toMatch(/1 vencida/)
    expect(contas.detalhe).toMatch(/900,00/)
    expect(f.itens.find((i) => i.chave === 'gaveta')!.situacao).toBe('ok')
  })

  it('mês sem turno fechado não diz que a gaveta bateu', async () => {
    const f = await m.fechamento.montarFechamento(DONA, LOJAS, '2026-07', 'loja-f', false, new Date('2026-10-03T12:00:00-03:00'))
    expect(f.itens.find((i) => i.chave === 'gaveta')!.situacao).toBe('atencao')
  })
})

describe('trocar de plano para baixo', () => {
  it('não deposita o crédito de IA do plano que está saindo', async () => {
    await m.assinatura.trocarPlano(DONA_DESCE, 'GRATIS')
    const recargas = await linha(`select id from recargas_ia where org_id = 'org-desce'`)
    expect(recargas).toHaveLength(0)
    const [o] = await linha<{ plano: string; modulos: string[] }>(`select plano, modulos from orgs where id = 'org-desce'`)
    expect(o!.plano).toBe('GRATIS')
    expect(o!.modulos).toEqual([])
  })
})

describe('o teste que venceu', () => {
  it('vira Grátis na primeira olhada, desliga o que o Grátis não tem e fica no livro', async () => {
    expect(await m.relatorios.planoDaEmpresa(DONA_TESTE)).toBe('GRATIS')
    const [o] = await linha<{ plano: string; situacao: string; modulos: string[] }>(
      `select plano, situacao, modulos from orgs where id = 'org-teste'`,
    )
    expect(o).toEqual({ plano: 'GRATIS', situacao: 'ATIVA', modulos: [] })
    const livro = await linha<{ motivo: string }>(`select motivo from auditoria where org_id = 'org-teste' and acao = 'plano.trocou'`)
    expect(livro[0]!.motivo).toMatch(/^Teste acabou/)
    // E não deposita o crédito do plano que acabou.
    expect(await linha(`select id from recargas_ia where org_id = 'org-teste'`)).toHaveLength(0)
  })

  it('a tela da assinatura avisa por que o menu encolheu', async () => {
    const a = await m.assinatura.assinaturaDe(DONA_TESTE)
    expect(a.alertas.some((x) => /O teste acabou/.test(x.texto))).toBe(true)
  })
})

describe('o assistente é do plano, não só da capacidade', () => {
  it('a empresa do Grátis não configura o assistente', async () => {
    await expect(
      m.agente.salvarAgente(DONA_GRATIS, {
        nome: 'Ajudante', poderes: [], descontoMaxPct: 5, valorMaxCent: 1000, gastoDiaCent: 1000, mensagensDia: 10, ativo: true,
      } as Parameters<typeof m.agente.salvarAgente>[1]),
    ).rejects.toThrow(/plano/)
    expect(await linha(`select id from agentes where org_id = 'org-gratis'`)).toHaveLength(0)
  })
})
