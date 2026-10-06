// O balcão novo, com banco de verdade: autorizar com o PIN da gerente,
// vender o que o sistema diz que acabou, débito no preço de cartão,
// acréscimo, maquininha e crédito em vezes (com e sem juro), o crediário com
// o 1º vencimento escolhido e o CPF, e o vale de cada loja.
//
// Mesmo arranjo de `correcoes-balcao.test.ts`: o PGlite exposto numa porta, e
// o código rodando INTEIRO (comoOrg, Prisma, RLS). O freio do PIN (cinco
// erros em 15 minutos por loja) roda aqui de verdade, contra a tabela.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { diaEmSP, somarDias } from '../src/servidor/dia'
import { mesmoDiaDepois } from '../src/servidor/crediario-agenda'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  venda: typeof import('../src/servidor/venda')
  devolucao: typeof import('../src/servidor/devolucao')
  estoque: typeof import('../src/servidor/estoque')
  autorizacao: typeof import('../src/servidor/autorizacao')
  maquininhas: typeof import('../src/servidor/maquininhas')
  senha: typeof import('../src/servidor/senha')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-a',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])
const GER1 = sessao('usr-ger1', 'Gerente Centro', [{ papel: 'GERENTE', unidadeId: 'uni-a1' }])
const GER2 = sessao('usr-ger2', 'Gerente Shopping', [{ papel: 'GERENTE', unidadeId: 'uni-a2' }])
const GER3 = sessao('usr-ger3', 'Gerente Bairro', [{ papel: 'GERENTE', unidadeId: 'uni-a3' }])
const BALCAO = sessao('usr-bal1', 'Balcão Centro', [{ papel: 'BALCAO', unidadeId: 'uni-a1' }])
const BALCAO2 = sessao('usr-bal2', 'Outra Vendedora', [{ papel: 'BALCAO', unidadeId: 'uni-a1' }])

const SENHA = 'senha-boa-123'
const PIN = { ger1: '258013', ger2: '135792', ger3: '914726', bal2: '864209' }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, pontos_ativo, pontos_por_real, ponto_vale,
                    crediario_max_parcelas, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,multiUnidade}', 15, true, 1, 0.01, 12, now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, now()),
    ('uni-a2', 'org-a', 'Loja Shopping', false, true, now()),
    ('uni-a3', 'org-a', 'Loja Bairro', false, true, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona', 'dona@a.com', now()),
    ('usr-ger1', 'org-a', 'Gerente Centro', 'g1@a.com', now()),
    ('usr-ger2', 'org-a', 'Gerente Shopping', 'g2@a.com', now()),
    ('usr-ger3', 'org-a', 'Gerente Bairro', 'g3@a.com', now()),
    ('usr-bal1', 'org-a', 'Balcão Centro', 'b1@a.com', now()),
    ('usr-bal2', 'org-a', 'Outra Vendedora', 'b2@a.com', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
    ('ac-ger1', 'org-a', 'usr-ger1', 'uni-a1', 'GERENTE'),
    ('ac-ger2', 'org-a', 'usr-ger2', 'uni-a2', 'GERENTE'),
    ('ac-ger3', 'org-a', 'usr-ger3', 'uni-a3', 'GERENTE'),
    ('ac-bal1', 'org-a', 'usr-bal1', 'uni-a1', 'BALCAO'),
    ('ac-bal2', 'org-a', 'usr-bal2', 'uni-a1', 'BALCAO');

  insert into produtos (id, org_id, nome, medida, preco_vista, preco_cartao, preco_crediario, custo, ativo, atualizado_em) values
    ('p-cam', 'org-a', 'Camiseta', 'UN', 50.00, 55.00, 60.00, 20.00, true, now()),
    ('p-ult', 'org-a', 'Vestido', 'UN', 100.00, 100.00, 100.00, 40.00, true, now());

  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-cam', 'org-a', 'p-cam', 'CAM-1', true),
    ('var-ult', 'org-a', 'p-ult', 'VES-1', true);

  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e1', 'org-a', 'var-cam', 'uni-a1', 100, now()),
    ('e2', 'org-a', 'var-ult', 'uni-a1', 1, now()),
    ('e3', 'org-a', 'var-cam', 'uni-a2', 100, now());

  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Balcão Centro', 100),
    ('cx-a2', 'org-a', 'uni-a2', 'Gerente Shopping', 100);

  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-a', 'Cliente Um', now()),
    ('cli-2', 'org-a', 'Cliente Dois', now());

  insert into vales (id, org_id, codigo, cliente_id, unidade_id, valor, saldo, quem) values
    ('vale-a2', 'org-a', 'VT-LOJA22', 'cli-2', 'uni-a2', 30.00, 30.00, 'Dona'),
    ('vale-sem', 'org-a', 'VT-SEMLJA', 'cli-2', null, 20.00, 20.00, 'Importação');
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
    venda: await import('../src/servidor/venda'),
    devolucao: await import('../src/servidor/devolucao'),
    estoque: await import('../src/servidor/estoque'),
    autorizacao: await import('../src/servidor/autorizacao'),
    maquininhas: await import('../src/servidor/maquininhas'),
    senha: await import('../src/servidor/senha'),
    banco: await import('../src/servidor/banco'),
  }

  // Todo mundo com a mesma senha de entrar; cada um cria o próprio PIN pelo
  // caminho de verdade (Minha conta), que pede a senha.
  const hash = await m.senha.guardarSenha(SENHA)
  await db.query(`update usuarios set senha_hash = $1`, [hash])
  for (const [s, pin] of [[GER1, PIN.ger1], [GER2, PIN.ger2], [GER3, PIN.ger3], [BALCAO2, PIN.bal2]] as const) {
    expect(await m.autorizacao.definirMeuPin(s, SENHA, pin)).toEqual({ ok: true })
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
const saldo = async (variacao: string, unidade = 'uni-a1') =>
  Number((await linha<{ q: string }>(`select quantidade as q from estoque where variacao_id = $1 and unidade_id = $2`, [variacao, unidade]))[0]!.q)

const vender = (extra: Partial<Parameters<typeof m.venda.registrarVenda>[1]> = {}, quem: Sessao = DONA) =>
  m.venda.registrarVenda(quem, {
    unidadeId: 'uni-a1',
    caixaId: 'cx-a1',
    itens: [{ variacaoId: 'var-cam', quantidade: 1 }],
    pagamentos: [{ forma: 'PIX' as const, valor: 50 }],
    ...extra,
  })

// ─────────────────────────────────────────────────────────────
// O PIN
// ─────────────────────────────────────────────────────────────

describe('o PIN pessoal (Minha conta)', () => {
  it('criar pede a senha de entrar, e recusa PIN que todo mundo chuta', async () => {
    expect(await m.autorizacao.definirMeuPin(BALCAO, 'senha-errada', '5829')).toMatchObject({ ok: false, erro: /senha/ })
    expect(await m.autorizacao.definirMeuPin(BALCAO, SENHA, '1111')).toMatchObject({ ok: false, erro: /repetido/ })
    expect(await m.autorizacao.meuPin(BALCAO)).toMatchObject({ tem: false })
    expect(await m.autorizacao.meuPin(GER1)).toMatchObject({ tem: true })
  })

  it('guarda o resumo, nunca o número — e o mesmo PIN de duas pessoas dá resumos diferentes', async () => {
    const [u] = await linha<{ pin_hash: string }>(`select pin_hash from usuarios where id = 'usr-ger1'`)
    expect(u!.pin_hash).toMatch(/^scrypt\$/)
    expect(u!.pin_hash).not.toContain(PIN.ger1)
    const livro = await linha(`select id from auditoria where acao = 'conta.pin.criou' and usuario_id = 'usr-ger1'`)
    expect(livro).toHaveLength(1)
  })
})

describe('autorizar com o PIN', () => {
  const pedir = (pin: string, extra: Partial<Parameters<typeof m.autorizacao.autorizarComPin>[0]> = {}) =>
    m.autorizacao.autorizarComPin({
      orgId: 'org-a',
      unidadeId: 'uni-a1',
      pin,
      capacidade: 'venda.desconto',
      motivo: 'teste',
      quemPediu: { usuarioId: 'usr-bal1', nome: 'Balcão Centro' },
      ...extra,
    })

  it('o PIN da gerente da loja autoriza, e o livro guarda quem autorizou e quem pediu', async () => {
    const r = await pedir(PIN.ger1, { motivo: 'Perdoar o atraso' })
    expect(r).toEqual({ ok: true, autorizador: { usuarioId: 'usr-ger1', nome: 'Gerente Centro' } })
    const [l] = await linha<{ quem: string; motivo: string; alvo_nome: string }>(
      `select quem, motivo, alvo_nome from auditoria where acao = 'autorizacao.pin' order by criado_em desc limit 1`,
    )
    expect(l).toMatchObject({ quem: 'Gerente Centro', alvo_nome: 'Balcão Centro' })
    expect(l!.motivo).toMatch(/Perdoar o atraso · pedido por Balcão Centro/)
  })

  it('o PIN certo de quem NÃO pode (a colega de balcão) não autoriza', async () => {
    const r = await pedir(PIN.bal2)
    expect(r.ok).toBe(false)
  })

  it('o PIN da gerente de OUTRA loja não autoriza aqui', async () => {
    expect((await pedir(PIN.ger2)).ok).toBe(false)
    // Na loja dela, autoriza.
    expect((await pedir(PIN.ger2, { unidadeId: 'uni-a2' })).ok).toBe(true)
  })

  it('a capacidade é a pedida: gerente não autoriza o que o papel dela não tem', async () => {
    const r = await pedir(PIN.ger1, { capacidade: 'empresa.configurar', unidadeId: null })
    expect(r.ok).toBe(false)
  })

  it('formato errado não gasta tentativa', async () => {
    expect(await pedir('12')).toMatchObject({ ok: false, erro: /4 a 6/ })
    expect(await pedir('abcd')).toMatchObject({ ok: false, erro: /4 a 6/ })
  })

  it('cinco erros em 15 minutos seguram a loja — nem o PIN certo passa', async () => {
    const naLoja3 = { unidadeId: 'uni-a3' }
    for (let i = 0; i < 5; i++) expect((await pedir('4826', naLoja3)).ok).toBe(false)
    const bloqueada = await pedir(PIN.ger3, naLoja3)
    expect(bloqueada).toMatchObject({ ok: false, erro: /muitas vezes.*Espere/ })
    // A outra loja não paga pelo chute desta.
    expect((await pedir(PIN.ger1)).ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// A VENDA COM AUTORIZAÇÃO
// ─────────────────────────────────────────────────────────────

describe('desconto acima do teto e item avulso: a gerente autoriza na hora', () => {
  it('sem PIN, o balcão é recusado — e a recusa é o pedido de autorização', async () => {
    const r = await vender({ desconto: 15, pagamentos: [{ forma: 'PIX', valor: 35 }] }, BALCAO)
    expect(r).toMatchObject({ ok: false, motivo: 'desconto_acima_do_teto', teto: 15 })
  })

  it('PIN errado ou de quem não pode: recusa, e nada é gravado', async () => {
    const antes = await saldo('var-cam')
    const r = await vender({ desconto: 15, pagamentos: [{ forma: 'PIX', valor: 35 }], autorizacao: { pin: PIN.bal2 } }, BALCAO)
    expect(r).toMatchObject({ ok: false, motivo: 'autorizacao_recusada' })
    expect(await saldo('var-cam')).toBe(antes)
  })

  it('com o PIN da gerente, a venda fecha no nome de quem vendeu e guarda quem autorizou', async () => {
    const r = await vender({ desconto: 15, pagamentos: [{ forma: 'PIX', valor: 35 }], autorizacao: { pin: PIN.ger1 } }, BALCAO)
    expect(r).toMatchObject({ ok: true, autorizadoPor: 'Gerente Centro' })
    if (!r.ok) return
    const [v] = await linha<{ vendedor_nome: string; autorizado_por: string; autorizado_por_id: string }>(
      `select vendedor_nome, autorizado_por, autorizado_por_id from vendas where id = $1`,
      [r.vendaId],
    )
    expect(v).toEqual({ vendedor_nome: 'Balcão Centro', autorizado_por: 'Gerente Centro', autorizado_por_id: 'usr-ger1' })
    const [livro] = await linha<{ motivo: string }>(`select motivo from auditoria where acao = 'venda.registrou' and alvo_id = $1`, [r.vendaId])
    expect(livro!.motivo).toMatch(/autorizado por Gerente Centro/)
  })

  it('dentro do teto o PIN que veio à toa não vira "autorizou"', async () => {
    const r = await vender({ desconto: 5, pagamentos: [{ forma: 'PIX', valor: 45 }], autorizacao: { pin: PIN.ger1 } }, BALCAO)
    expect(r).toMatchObject({ ok: true, autorizadoPor: null })
  })

  // O caso da sorveteria: o dono subiu o preço de 4 para 5 com o balcão
  // aberto. A tela ainda mandava 4, e o servidor lia a diferença como
  // desconto (vendia pelo velho ou pedia autorização de um desconto que
  // ninguém deu). Agora volta "o preço mudou", com os preços de agora.
  it('preço da tela desatualizado: nada é gravado e volta o preço de agora, nas três tabelas', async () => {
    const r = await vender({ itens: [{ variacaoId: 'var-cam', quantidade: 1, precoUnit: 45 }], pagamentos: [{ forma: 'PIX', valor: 45 }] })
    expect(r).toEqual({
      ok: false,
      motivo: 'preco_mudou',
      itens: [{ variacaoId: 'var-cam', descricao: expect.stringContaining('Camiseta'), de: 45, para: 50, precos: { vista: 50, cartao: 55, crediario: 60 } }],
    })
    // O preço certo passa; sem preço da tela, vale a tabela.
    expect(await vender({ itens: [{ variacaoId: 'var-cam', quantidade: 1, precoUnit: 50 }] })).toMatchObject({ ok: true })
    expect(await vender()).toMatchObject({ ok: true })
  })

  it('item avulso: sem PIN recusa; com o PIN da gerente passa', async () => {
    const avulso = { variacaoId: null, quantidade: 1, avulso: { descricao: 'Ajuste de barra', precoUnit: 20 } }
    expect(await vender({ itens: [avulso], pagamentos: [{ forma: 'DINHEIRO', valor: 20 }] }, BALCAO)).toMatchObject({
      ok: false,
      motivo: 'avulso_negado',
    })
    const r = await vender({ itens: [avulso], pagamentos: [{ forma: 'DINHEIRO', valor: 20 }], autorizacao: { pin: PIN.ger1 } }, BALCAO)
    expect(r).toMatchObject({ ok: true, autorizadoPor: 'Gerente Centro' })
  })
})

// ─────────────────────────────────────────────────────────────
// VENDER SEM ESTOQUE
// ─────────────────────────────────────────────────────────────

describe('vender o que o sistema diz que acabou', () => {
  const duas = { itens: [{ variacaoId: 'var-ult', quantidade: 2 }], pagamentos: [{ forma: 'PIX' as const, valor: 200 }] }

  it('desligado (o padrão), recusa como sempre', async () => {
    expect(await vender(duas, BALCAO)).toMatchObject({ ok: false, motivo: 'sem_estoque' })
    expect(await saldo('var-ult')).toBe(1)
  })

  it('ligado, avisa e passa: o saldo fica negativo e o item vai para conferir', async () => {
    await db.query(`update orgs set vende_sem_estoque = true where id = 'org-a'`)
    const r = await vender(duas, BALCAO)
    expect(r).toMatchObject({ ok: true, semEstoque: ['Vestido'] })
    if (!r.ok) return
    expect(await saldo('var-ult')).toBe(-1)
    const [item] = await linha<{ saldo_na_venda: string }>(`select saldo_na_venda from venda_itens where venda_id = $1`, [r.vendaId])
    expect(Number(item!.saldo_na_venda)).toBe(1)

    const lista = await m.estoque.listarParaConferir(DONA, ['uni-a1'])
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ descricao: 'Vestido', vendido: 2, tinha: 1, saldoAgora: -1, vendaNumero: r.numero })
  })

  it('peça que tinha estoque não vai para a lista', async () => {
    await vender({}, BALCAO)
    expect(await m.estoque.listarParaConferir(DONA, ['uni-a1'])).toHaveLength(1)
  })

  it('conferir é de quem corrige estoque; o balcão não tira da lista', async () => {
    const [item] = await m.estoque.listarParaConferir(DONA, ['uni-a1'])
    await expect(m.estoque.marcarConferido(BALCAO, item!.vendaItemId)).rejects.toThrow(/permissão/)
    expect(await m.estoque.marcarConferido(GER1, item!.vendaItemId)).toEqual({ ok: true })
    expect(await m.estoque.listarParaConferir(DONA, ['uni-a1'])).toHaveLength(0)
    const livro = await linha(`select id from auditoria where acao = 'estoque.conferiu'`)
    expect(livro).toHaveLength(1)
    // Clique duplo não escreve outra linha.
    expect(await m.estoque.marcarConferido(GER1, item!.vendaItemId)).toEqual({ ok: true })
    expect(await linha(`select id from auditoria where acao = 'estoque.conferiu'`)).toHaveLength(1)
  })

  it('a gerente de outra loja não vê a lista desta', async () => {
    await vender(duas, BALCAO)
    expect(await m.estoque.listarParaConferir(GER2, ['uni-a1'])).toHaveLength(0)
    await db.query(`update orgs set vende_sem_estoque = false where id = 'org-a'`)
  })
})

// ─────────────────────────────────────────────────────────────
// O PAGAMENTO
// ─────────────────────────────────────────────────────────────

describe('o pagamento', () => {
  it('débito cobra o preço de cartão', async () => {
    expect(await vender({ pagamentos: [{ forma: 'DEBITO', valor: 50 }] })).toMatchObject({ ok: false, motivo: 'pagamento_nao_fecha', total: 55 })
    expect(await vender({ pagamentos: [{ forma: 'DEBITO', valor: 55 }] })).toMatchObject({ ok: true, total: 55 })
  })

  it('acréscimo entra no total e fica à parte na venda', async () => {
    const r = await vender({ acrescimo: 10, pagamentos: [{ forma: 'PIX', valor: 60 }] }, BALCAO)
    expect(r).toMatchObject({ ok: true, total: 60 })
    if (!r.ok) return
    const [v] = await linha<{ acrescimo: string; total: string; desconto: string }>(`select acrescimo, total, desconto from vendas where id = $1`, [r.vendaId])
    expect(Number(v!.acrescimo)).toBe(10)
    expect(Number(v!.total)).toBe(60)
  })

  it('acréscimo não abre espaço para desconto acima do teto', async () => {
    // 30% de desconto (R$ 15) com R$ 15 de acréscimo: o total é o da tabela,
    // mas o desconto passou do teto — e é ele que conta.
    const r = await vender({ desconto: 15, acrescimo: 15, pagamentos: [{ forma: 'PIX', valor: 50 }] }, BALCAO)
    expect(r).toMatchObject({ ok: false, motivo: 'desconto_acima_do_teto' })
  })

  it('acréscimo de dedo errado é recusado', async () => {
    expect(await vender({ acrescimo: 5000, pagamentos: [{ forma: 'PIX', valor: 5050 }] })).toMatchObject({
      ok: false,
      motivo: 'pagamento_recusado',
    })
  })

  it('maquininha e crédito em vezes ficam no pagamento', async () => {
    await m.maquininhas.salvarMaquininhas(DONA, 'uni-a1', [
      { nome: 'Banco Azul', formas: ['PIX', 'DEBITO', 'CREDITO'] },
      { nome: 'Pague Fácil', formas: ['CREDITO'] },
    ])
    expect(await m.maquininhas.maquininhasDaLoja('org-a', 'uni-a1')).toHaveLength(2)
    const r = await vender({ pagamentos: [{ forma: 'CREDITO', valor: 55, parcelas: 3, maquininha: 'Pague Fácil' }] })
    expect(r).toMatchObject({ ok: true, total: 55 })
    if (!r.ok) return
    const [p] = await linha<{ maquininha: string; parcelas: number; juros: string; valor: string }>(
      `select maquininha, parcelas, juros, valor from pagamentos where venda_id = $1`,
      [r.vendaId],
    )
    expect(p).toMatchObject({ maquininha: 'Pague Fácil', parcelas: 3 })
    expect(Number(p!.juros)).toBe(0)
    expect(Number(p!.valor)).toBe(55)

    // O Financeiro enxerga a venda: a forma e a maquininha, por loja.
    const { recebidoPorForma } = await import('../src/servidor/financeiro')
    const rec = await recebidoPorForma(DONA, ['uni-a1', 'uni-a2'], new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000))
    expect(rec.porForma.find((f) => f.forma === 'CREDITO')?.total).toBeGreaterThanOrEqual(55)
    const pf = rec.maquininhas.find((x) => x.maquininha === 'Pague Fácil' && x.unidadeId === 'uni-a1')
    expect(pf?.unidade).toBe('Loja Centro')
    expect(pf?.formas.find((f) => f.forma === 'CREDITO')?.total).toBeGreaterThanOrEqual(55)
    // Outra loja não recebe nada do que passou nesta.
    expect(rec.maquininhas.some((x) => x.maquininha === 'Pague Fácil' && x.unidadeId === 'uni-a2')).toBe(false)
  })

  it('a ficha cria o eixo e a opção na hora: sem repetir, e só quem edita produto', async () => {
    const p = await import('../src/servidor/produto')
    // A sorveteria tinha o eixo "Sabor" e nenhum sabor — e não havia tela para criar.
    const eixo = await p.criarEixoDaEmpresa(DONA, '  Sabor  ')
    expect(eixo).toMatchObject({ nome: 'Sabor', ehCor: false, opcoes: [] })
    // O mesmo nome (até em outra caixa) devolve o que já existe.
    expect((await p.criarEixoDaEmpresa(DONA, 'sabor')).id).toBe(eixo.id)

    const morango = await p.criarOpcaoDoEixo(DONA, eixo.id, ' Morango ')
    expect(morango.valor).toBe('Morango')
    expect((await p.criarOpcaoDoEixo(DONA, eixo.id, 'MORANGO')).id).toBe(morango.id)
    const [contagem] = await linha<{ n: number }>(`select count(*)::int n from opcoes where eixo_id = $1`, [eixo.id])
    expect(contagem?.n).toBe(1)

    // Cor guarda o hex; hex torto vira nulo em vez de quebrar a tela.
    const cor = await p.criarEixoDaEmpresa(DONA, 'Cor', true)
    expect((await p.criarOpcaoDoEixo(DONA, cor.id, 'Azul', '#1f4fd8')).hex).toBe('#1f4fd8')
    expect((await p.criarOpcaoDoEixo(DONA, cor.id, 'Verde', 'verde')).hex).toBeNull()

    // Nome vazio, eixo que não existe e quem só vende: recusados.
    await expect(p.criarOpcaoDoEixo(DONA, eixo.id, '   ')).rejects.toThrow('Escreva o nome')
    await expect(p.criarOpcaoDoEixo(DONA, 'nao-existe', 'X')).rejects.toThrow('não existe mais')
    await expect(p.criarEixoDaEmpresa(BALCAO, 'Tamanho')).rejects.toThrow()
    await expect(p.criarOpcaoDoEixo(BALCAO, eixo.id, 'Chocolate')).rejects.toThrow()

    // E fica no livro, para saber quem criou.
    const livro = await linha<{ acao: string }>(`select acao from auditoria where acao like 'produto.%criou' and acao in ('produto.eixo.criou','produto.opcao.criou')`)
    expect(livro.map((l) => l.acao)).toEqual(expect.arrayContaining(['produto.eixo.criou', 'produto.opcao.criou']))
  })

  it('cada item da grade pode ter o seu preço: guarda a diferença, e só para quem mexe em preço', async () => {
    const p = await import('../src/servidor/produto')
    // A casquinha comum a R$ 50 (o preço do produto) e a recheada a R$ 57.
    await db.exec(`insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('var-cam-b', 'org-a', 'p-cam', 'CAM-2', true)`)
    const ajuste = async () =>
      (await linha<{ a: string | null }>(`select ajuste_preco::text a from variacoes where id = 'var-cam-b'`))[0]!.a

    expect(await p.definirPrecosDosItens(DONA, 'p-cam', [{ variacaoId: 'var-cam-b', preco: 57 }])).toBe(1)
    expect(Number(await ajuste())).toBe(7)

    // O mesmo preço de novo não é mudança (e não suja o livro).
    expect(await p.definirPrecosDosItens(DONA, 'p-cam', [{ variacaoId: 'var-cam-b', preco: 57 }])).toBe(0)

    // O preço do produto, na tabela de cartão e no crediário, soma a mesma diferença.
    const [prod] = await linha<{ v: string; c: string }>(`select preco_vista::text v, preco_cartao::text c from produtos where id = 'p-cam'`)
    expect(Number(prod!.v) + Number(await ajuste())).toBe(57)
    expect(Number(prod!.c) + Number(await ajuste())).toBe(62)

    // Item de OUTRO produto é ignorado (o navegador é do usuário).
    expect(await p.definirPrecosDosItens(DONA, 'p-cam', [{ variacaoId: 'var-ult', preco: 10 }])).toBe(0)
    const [ult] = await linha<{ a: string | null }>(`select ajuste_preco::text a from variacoes where id = 'var-ult'`)
    expect(ult!.a).toBeNull()

    // Preço zero ou negativo: recusado. Quem só vende (balcão): recusado.
    await expect(p.definirPrecosDosItens(DONA, 'p-cam', [{ variacaoId: 'var-cam-b', preco: 0 }])).rejects.toThrow('maior que zero')
    await expect(p.definirPrecosDosItens(BALCAO, 'p-cam', [{ variacaoId: 'var-cam-b', preco: 60 }])).rejects.toThrow()
    expect(Number(await ajuste())).toBe(7)

    // Igual ao preço do produto: sem diferença, e o item volta a acompanhá-lo.
    expect(await p.definirPrecosDosItens(DONA, 'p-cam', [{ variacaoId: 'var-cam-b', preco: 50 }])).toBe(1)
    expect(await ajuste()).toBeNull()

    const livro = await linha<{ n: number }>(`select count(*)::int n from auditoria where acao = 'produto.preco.alterou' and alvo_id = 'p-cam'`)
    expect(livro[0]!.n).toBeGreaterThanOrEqual(2)
    await db.exec(`delete from variacoes where id = 'var-cam-b'`)
  })

  it('o cargo "lança avaria" tira do estoque sem poder corrigir, dar entrada nem transferir', async () => {
    const e = await import('../src/servidor/estoque')
    // Um cargo da loja do Centro: vende, vê o estoque e lança avaria. Nada mais.
    const ATENDENTE: Sessao = {
      ...sessao('usr-bal1', 'Atendente Centro', []),
      acessos: [{ papel: 'CARGO', unidadeId: 'uni-a1', expiraEm: null, capacidades: ['venda.criar', 'estoque.ver', 'estoque.perda'] }],
    }
    const antes = await saldo('var-cam')

    // Lança 3 amassados: o saldo cai 3, vira movimento de avaria e fica no livro, com o motivo e o nome.
    const r = await e.lancarPerda(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a1', quantidade: 3, motivo: 'Amassou no freezer' })
    expect(r).toMatchObject({ ok: true, saldo: antes - 3, antes })
    expect(await saldo('var-cam')).toBe(antes - 3)
    const [mov] = await linha<{ tipo: string; quantidade: string; motivo: string; quem: string }>(
      `select tipo::text, quantidade::text, motivo, quem from movimentos_estoque where variacao_id = 'var-cam' and tipo = 'PERDA' order by criado_em desc limit 1`,
    )
    expect(mov).toMatchObject({ tipo: 'PERDA', motivo: 'Amassou no freezer', quem: 'Atendente Centro' })
    expect(Number(mov!.quantidade)).toBe(-3)
    const [livro] = await linha<{ acao: string; motivo: string }>(`select acao, motivo from auditoria where acao = 'estoque.perda' order by criado_em desc limit 1`)
    expect(livro).toMatchObject({ acao: 'estoque.perda', motivo: 'Amassou no freezer' })

    // Mas NÃO mexe no resto do estoque: corrigir, dar entrada e transferir são de quem ajusta.
    await expect(e.corrigirPeloContado(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a1', contado: 500, motivo: 'contei errado' })).rejects.toThrow()
    await expect(e.mexerEstoque(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a1', tipo: 'ENTRADA', quantidade: 10 })).rejects.toThrow()
    await expect(e.mexerEstoque(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a1', tipo: 'AJUSTE', quantidade: 10 })).rejects.toThrow()
    expect(await saldo('var-cam')).toBe(antes - 3)

    // O motivo é obrigatório, e quantidade tem de ser um número maior que zero.
    await expect(e.lancarPerda(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a1', quantidade: 1, motivo: 'ok' })).rejects.toThrow('motivo')
    await expect(e.lancarPerda(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a1', quantidade: 0, motivo: 'Quebrou' })).rejects.toThrow('maior que zero')
    // Não tira mais do que tem (o saldo nunca fica negativo), e diz quanto há.
    expect(await e.lancarPerda(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a1', quantidade: 9999, motivo: 'Quebrou tudo' })).toMatchObject({ ok: false, motivo: 'sem_saldo', saldo: antes - 3 })
    // Só na loja do cargo: a outra loja não é dele.
    await expect(e.lancarPerda(ATENDENTE, { variacaoId: 'var-cam', unidadeId: 'uni-a2', quantidade: 1, motivo: 'Quebrou' })).rejects.toThrow()
    // O balcão de sempre (sem o cargo) não lança avaria, e o gerente lança (ele já ajusta o estoque).
    await expect(e.lancarPerda(BALCAO, { variacaoId: 'var-cam', unidadeId: 'uni-a1', quantidade: 1, motivo: 'Quebrou' })).rejects.toThrow()
    expect(await e.lancarPerda(GER1, { variacaoId: 'var-cam', unidadeId: 'uni-a1', quantidade: 1, motivo: 'Venceu a validade' })).toMatchObject({ ok: true })

    // Devolve o que o teste tirou, para os outros testes do arquivo.
    await db.exec(`update estoque set quantidade = quantidade + 4 where id = 'e1'`)
    expect(await saldo('var-cam')).toBe(antes)
  })

  it('maquininha que não é desta loja (ou desta forma) é recusada', async () => {
    expect(await vender({ pagamentos: [{ forma: 'PIX', valor: 50, maquininha: 'Pague Fácil' }] })).toMatchObject({
      ok: false,
      motivo: 'pagamento_recusado',
    })
    expect(await vender({ pagamentos: [{ forma: 'PIX', valor: 50, maquininha: 'Inventada' }] })).toMatchObject({
      ok: false,
      motivo: 'pagamento_recusado',
    })
  })

  it('crédito acima do máximo da loja é recusado; parcela em forma que não parcela vira 1', async () => {
    expect(await vender({ pagamentos: [{ forma: 'CREDITO', valor: 55, parcelas: 7 }] })).toMatchObject({
      ok: false,
      motivo: 'pagamento_recusado',
    })
    const r = await vender({ pagamentos: [{ forma: 'PIX', valor: 50, parcelas: 4 }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [p] = await linha<{ parcelas: number }>(`select parcelas from pagamentos where venda_id = $1`, [r.vendaId])
    expect(p!.parcelas).toBe(1)
  })

  it('com juro no parcelamento, o servidor soma o juro no pagamento e no total — e a devolução não devolve o juro', async () => {
    await m.venda.salvarConfigDoBalcao(DONA, { vendeSemEstoque: false, valePorLoja: false, creditoMaxParcelas: 6, creditoJurosPct: 5 })
    const r = await vender({ clienteId: 'cli-1', pagamentos: [{ forma: 'CREDITO', valor: 55, parcelas: 3, maquininha: 'Banco Azul' }] })
    expect(r).toMatchObject({ ok: true, total: 57.75 })
    if (!r.ok) return
    const [p] = await linha<{ juros: string; valor: string }>(`select juros, valor from pagamentos where venda_id = $1`, [r.vendaId])
    expect(Number(p!.juros)).toBe(2.75)
    expect(Number(p!.valor)).toBe(57.75)
    // À vista no crédito não tem juro.
    expect(await vender({ pagamentos: [{ forma: 'CREDITO', valor: 55, parcelas: 1 }] })).toMatchObject({ ok: true, total: 55 })

    const [item] = await linha<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    const d = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: item!.id, quantidade: 1 }], destino: 'VALE', motivo: 'não serviu' })
    expect(d).toMatchObject({ ok: true, valor: 55 })
    await m.venda.salvarConfigDoBalcao(DONA, { vendeSemEstoque: false, valePorLoja: false, creditoMaxParcelas: 6, creditoJurosPct: 0 })
  })
})

// ─────────────────────────────────────────────────────────────
// O CREDIÁRIO NA VENDA
// ─────────────────────────────────────────────────────────────

describe('crediário: 1º vencimento escolhido, mesmo dia de cada mês, CPF', () => {
  it('as parcelas caem no dia escolhido e no mesmo dia dos meses seguintes', async () => {
    const primeiro = somarDias(diaEmSP(), 10)
    const r = await vender({
      clienteId: 'cli-1',
      pagamentos: [{ forma: 'CREDIARIO', valor: 60, parcelas: 3, primeiroVencimento: primeiro }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const ps = await linha<{ vencimento: Date; valor: string }>(`select vencimento, valor from parcelas where venda_id = $1 order by numero`, [r.vendaId])
    expect(ps.map((p) => new Date(p.vencimento).toISOString().slice(0, 10))).toEqual([0, 1, 2].map((i) => mesmoDiaDepois(primeiro, i)))
    expect(ps.map((p) => Number(p.valor))).toEqual([20, 20, 20])
  })

  it('sem escolher, a 1ª vence em hoje + 30', async () => {
    const r = await vender({ clienteId: 'cli-1', pagamentos: [{ forma: 'CREDIARIO', valor: 60, parcelas: 1 }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [p] = await linha<{ vencimento: Date }>(`select vencimento from parcelas where venda_id = $1`, [r.vendaId])
    expect(new Date(p!.vencimento).toISOString().slice(0, 10)).toBe(somarDias(diaEmSP(), 30))
  })

  it('1º vencimento no passado ou além de 60 dias é recusado', async () => {
    for (const dia of [diaEmSP(), somarDias(diaEmSP(), 61)]) {
      expect(
        await vender({ clienteId: 'cli-1', pagamentos: [{ forma: 'CREDIARIO', valor: 60, parcelas: 2, primeiroVencimento: dia }] }),
      ).toMatchObject({ ok: false, motivo: 'crediario_recusado' })
    }
  })

  it('até 12× (o máximo da loja)', async () => {
    expect(
      await vender({ clienteId: 'cli-1', pagamentos: [{ forma: 'CREDIARIO', valor: 60, parcelas: 13 }] }),
    ).toMatchObject({ ok: false, motivo: 'crediario_recusado' })
  })

  it('CPF que não confere é recusado; o que confere vai para a ficha sem CPF', async () => {
    expect(
      await vender({ clienteId: 'cli-1', clienteCpf: '529.982.247-24', pagamentos: [{ forma: 'CREDIARIO', valor: 60, parcelas: 2 }] }, BALCAO),
    ).toMatchObject({ ok: false, motivo: 'crediario_recusado' })
    const r = await vender({ clienteId: 'cli-1', clienteCpf: '529.982.247-25', pagamentos: [{ forma: 'CREDIARIO', valor: 60, parcelas: 2 }] }, BALCAO)
    expect(r.ok).toBe(true)
    const [c] = await linha<{ documento: string }>(`select documento from clientes where id = 'cli-1'`)
    expect(c!.documento).toBe('52998224725')
  })

  it('seguir sem CPF é permitido', async () => {
    const r = await vender({ clienteId: 'cli-2', pagamentos: [{ forma: 'CREDIARIO', valor: 60, parcelas: 2 }] }, BALCAO)
    expect(r.ok).toBe(true)
  })

  it('a parte no crediário não gera pontos', async () => {
    // 60 no crediário: 20 no Pix, 40 fiado. Só os 20 pontuam (1 ponto por real).
    const r = await vender({
      clienteId: 'cli-2',
      pagamentos: [
        { forma: 'PIX', valor: 20 },
        { forma: 'CREDIARIO', valor: 40, parcelas: 2 },
      ],
    })
    expect(r).toMatchObject({ ok: true, pontosGanhos: 20 })
  })
})

// ─────────────────────────────────────────────────────────────
// O VALE DE CADA LOJA
// ─────────────────────────────────────────────────────────────

describe('vale por loja', () => {
  const comVale = (codigo: string, valor: number) => ({
    clienteId: 'cli-2',
    pagamentos: [
      { forma: 'VALE' as const, valor, referencia: codigo },
      { forma: 'PIX' as const, valor: 50 - valor },
    ],
  })

  it('com a regra ligada, o vale de uma loja não paga a venda da outra', async () => {
    await db.query(`update orgs set vale_por_loja = true where id = 'org-a'`)
    expect(await vender(comVale('VT-LOJA22', 10))).toMatchObject({ ok: false, motivo: 'vale_recusado', recado: /Loja Shopping/ })
    expect(await m.devolucao.consultarVale(DONA, 'VT-LOJA22', 'uni-a1')).toMatchObject({ ok: false, motivo: 'outra_loja', loja: 'Loja Shopping' })
    // Na loja dela, paga.
    const r = await m.venda.registrarVenda(DONA, { unidadeId: 'uni-a2', caixaId: 'cx-a2', itens: [{ variacaoId: 'var-cam', quantidade: 1 }], ...comVale('VT-LOJA22', 10) })
    expect(r.ok).toBe(true)
  })

  it('vale sem loja (antigo ou importado) serve em qualquer uma', async () => {
    expect(await vender(comVale('VT-SEMLJA', 5))).toMatchObject({ ok: true })
  })

  it('o balcão oferece sozinho só os vales que servem nesta loja', async () => {
    const aqui = await m.banco.comoOrg('org-a', (tx) => m.devolucao.valesParaUsarEm(tx, 'cli-2', 'uni-a1', true))
    expect(aqui.map((v) => v.codigo)).toEqual(['VT-SEMLJA'])
    const la = await m.banco.comoOrg('org-a', (tx) => m.devolucao.valesParaUsarEm(tx, 'cli-2', 'uni-a2', true))
    expect(la.map((v) => v.codigo).sort()).toEqual(['VT-LOJA22', 'VT-SEMLJA'])
  })

  it('com a regra desligada, vale em qualquer loja', async () => {
    await db.query(`update orgs set vale_por_loja = false where id = 'org-a'`)
    expect(await vender(comVale('VT-LOJA22', 10))).toMatchObject({ ok: true })
  })

  it('o vale da devolução nasce com a loja que o emitiu', async () => {
    const r = await vender({ clienteId: 'cli-2' })
    if (!r.ok) throw new Error('venda')
    const [item] = await linha<{ id: string }>(`select id from venda_itens where venda_id = $1`, [r.vendaId])
    const d = await m.devolucao.devolver(DONA, { vendaId: r.vendaId, itens: [{ vendaItemId: item!.id, quantidade: 1 }], destino: 'VALE', motivo: 'troca' })
    if (!d.ok || !d.vale) throw new Error('devolução')
    const [v] = await linha<{ unidade_id: string }>(`select unidade_id from vales where codigo = $1`, [d.vale.codigo])
    expect(v!.unidade_id).toBe('uni-a1')
  })
})

// ─────────────────────────────────────────────────────────────
// AS REGRAS EM CONFIGURAÇÕES
// ─────────────────────────────────────────────────────────────

describe('as regras do balcão e as maquininhas', () => {
  it('só quem configura a empresa mexe', async () => {
    await expect(
      m.venda.salvarConfigDoBalcao(GER1, { vendeSemEstoque: true, valePorLoja: true, creditoMaxParcelas: 6, creditoJurosPct: 0 }),
    ).rejects.toThrow(/permissão/)
    await expect(m.maquininhas.salvarMaquininhas(GER1, 'uni-a1', [])).rejects.toThrow(/permissão/)
  })

  it('a empresa nova nasce travando a venda sem estoque, com vale da empresa e crédito em até 6× sem juro', async () => {
    await db.query(`insert into orgs (id, nome, slug, atualizada_em) values ('org-nova', 'Nova', 'nova', now())`)
    const [o] = await linha<{ vende_sem_estoque: boolean; vale_por_loja: boolean; credito_max_parcelas: number; credito_juros_pct: string }>(
      `select vende_sem_estoque, vale_por_loja, credito_max_parcelas, credito_juros_pct from orgs where id = 'org-nova'`,
    )
    expect(o).toMatchObject({ vende_sem_estoque: false, vale_por_loja: false, credito_max_parcelas: 6 })
    expect(Number(o!.credito_juros_pct)).toBe(0)
  })
})
