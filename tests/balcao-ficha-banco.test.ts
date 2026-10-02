// A ficha da cliente no balcão e a busca de vendas, com banco de verdade.
//
// Mesmo arranjo de `pdv-balcao.test.ts`: o PGlite exposto numa porta e o
// código rodando inteiro (comoOrg, Prisma, RLS).
//
// - a busca de Vendas acha pela peça, pelo pedaço do código da etiqueta,
//   pela referência do fornecedor, pelo valor ("189,90") e por quem vendeu;
// - a ficha soma o que ela deve em cada loja (vencido separado), mostra o
//   carnê por compra com a parcela paga E o dia em que foi paga, e a linha do
//   tempo de compras e pagamentos — cada um no alcance de quem olha;
// - completar a ficha no balcão não apaga o que o balcão não mostra;
// - o cadastro rápido com CPF não duplica ficha.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { diaEmSP, somarDias } from '../src/servidor/dia'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  venda: typeof import('../src/servidor/venda')
  cliente: typeof import('../src/servidor/cliente')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-f',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const DONA = sessao('usr-dona', 'Dona', [{ papel: 'DONO', unidadeId: null }])
const BALCAO1 = sessao('usr-bal1', 'Vendedora Um', [{ papel: 'BALCAO', unidadeId: 'uni-1' }])

const hoje = diaEmSP()
const dia = (n: number) => somarDias(hoje, n)

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, crediario_max_parcelas, atualizada_em, configurada_em) values
    ('org-f', 'Loja F', 'loja-f', 'REDE', 'ATIVA', '{crediario,multiUnidade}', 15, 12, now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-1', 'org-f', 'Loja Um', false, true, now()),
    ('uni-2', 'org-f', 'Loja Dois', false, true, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-f', 'Dona', 'dona@f.com', now()),
    ('usr-bal1', 'org-f', 'Vendedora Um', 'b1@f.com', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-f', 'usr-dona', null, 'DONO'),
    ('ac-bal1', 'org-f', 'usr-bal1', 'uni-1', 'BALCAO');

  insert into produtos (id, org_id, nome, referencia, medida, preco_vista, ativo, atualizado_em) values
    ('p-blusa', 'org-f', 'Blusa Listrada', 'REF-7781', 'UN', 189.90, true, now()),
    ('p-calca', 'org-f', 'Calça Jeans', null, 'UN', 50.00, true, now());

  insert into variacoes (id, org_id, produto_id, codigo, ativa) values
    ('var-p', 'org-f', 'p-blusa', '0056522-P', true),
    ('var-m', 'org-f', 'p-blusa', '0056522-M', true),
    ('var-calca', 'org-f', 'p-calca', 'CAL-01', true);

  insert into clientes (id, org_id, nome, observacoes, atualizado_em) values
    ('cli-ana', 'org-f', 'Ana Teste', 'não vender fiado sem falar com a gerente', now());
  insert into clientes (id, org_id, nome, documento, ativo, atualizado_em) values
    ('cli-off', 'org-f', 'Ficha Antiga', '11144477735', false, now());

  insert into vendas (id, org_id, unidade_id, numero, situacao, subtotal, total, cliente_id, vendedor_nome, criada_em) values
    ('v41', 'org-f', 'uni-1', 41, 'CONCLUIDA', 189.90, 189.90, 'cli-ana', 'Marta', now() - interval '2 days'),
    ('v42', 'org-f', 'uni-1', 42, 'CONCLUIDA', 50.00, 50.00, null, 'Joana', now() - interval '1 day'),
    ('v43', 'org-f', 'uni-1', 43, 'CONCLUIDA', 120.00, 120.00, 'cli-ana', 'Joana', now() - interval '3 hours'),
    ('v7', 'org-f', 'uni-2', 7, 'SALDO_IMPORTADO', 300.00, 300.00, 'cli-ana', null, now() - interval '90 days');

  insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, codigo, quantidade, preco_unit, total) values
    ('i41', 'org-f', 'v41', 'var-p', 'Blusa Listrada — P', '0056522-P', 1, 189.90, 189.90),
    ('i42', 'org-f', 'v42', 'var-calca', 'Calça Jeans', 'CAL-01', 1, 50.00, 50.00),
    ('i43', 'org-f', 'v43', 'var-m', 'Blusa Listrada — M', '0056522-M', 1, 120.00, 120.00);

  insert into pagamentos (id, org_id, venda_id, forma, valor) values
    ('pg41', 'org-f', 'v41', 'PIX', 189.90),
    ('pg42', 'org-f', 'v42', 'DINHEIRO', 50.00),
    ('pg43', 'org-f', 'v43', 'CREDIARIO', 120.00);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  // As parcelas: o carnê trazido do sistema anterior na Loja Dois (uma paga
  // há 50 dias, uma vencida, uma a vencer) e o crediário de hoje na Loja Um.
  await db.query(
    `insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor, pago, quitada_em) values
       ('pc1', 'org-f', 'v7', 'cli-ana', 'uni-2', 1, 3, $1, 100, 100, (now() at time zone 'utc') - interval '50 days'),
       ('pc2', 'org-f', 'v7', 'cli-ana', 'uni-2', 2, 3, $2, 100, 0, null),
       ('pc3', 'org-f', 'v7', 'cli-ana', 'uni-2', 3, 3, $3, 100, 0, null),
       ('pc4', 'org-f', 'v43', 'cli-ana', 'uni-1', 1, 1, $4, 120, 0, null)`,
    [dia(-60), dia(-30), dia(5), dia(20)],
  )
  await db.exec(`
    insert into recebimentos (id, org_id, parcela_id, forma, valor, quem, criado_em) values
      ('rc1', 'org-f', 'pc1', 'DINHEIRO', 100, 'Importação', (now() at time zone 'utc') - interval '50 days');
  `)
  const porta = 55000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url

  m = {
    venda: await import('../src/servidor/venda'),
    cliente: await import('../src/servidor/cliente'),
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

// ─────────────────────────────────────────────────────────────
// A BUSCA DE VENDAS
// ─────────────────────────────────────────────────────────────

describe('a busca de Vendas acha pela peça, pelo código e pelo valor', () => {
  const achar = async (q: string, quem: Sessao = DONA) =>
    (
      await m.venda.listarVendas(quem, {
        unidadeIds: ['uni-1', 'uni-2'],
        de: new Date(Date.now() - 365 * 864e5),
        ate: new Date(Date.now() + 864e5),
        q,
      })
    )
      .map((v) => v.numero)
      .sort((a, b) => a - b)

  it('pelo nome da peça', async () => {
    expect(await achar('listrada')).toEqual([41, 43])
    expect(await achar('calça')).toEqual([42])
  })

  it('pelo pedaço do código da etiqueta, e pelo código com o final do preço', async () => {
    expect(await achar('56522')).toEqual([41, 43])
    expect(await achar('0056522-P')).toEqual([41])
    expect(await achar('0056522AV')).toEqual([41, 43])
    expect(await achar('cal-01')).toEqual([42])
  })

  it('pela referência do fornecedor', async () => {
    expect(await achar('ref-7781')).toEqual([41, 43])
  })

  it('pelo valor: o total da venda ou o preço de uma peça', async () => {
    expect(await achar('189,90')).toEqual([41])
    expect(await achar('R$ 189,9')).toEqual([41])
    expect(await achar('189.90')).toEqual([41])
    expect(await achar('50,00')).toEqual([42])
    expect(await achar('120,00')).toEqual([43])
    expect(await achar('77,00')).toEqual([])
  })

  it('o número da venda e o nome continuam valendo; quem vendeu também', async () => {
    expect(await achar('42')).toEqual([42])
    expect(await achar('ana teste')).toEqual([41, 43])
    expect(await achar('marta')).toEqual([41])
  })

  it('o saldo trazido do sistema anterior continua fora da lista', async () => {
    expect(await achar('7')).toEqual([])
  })

  it('o resumo do alto conta as mesmas vendas da busca', async () => {
    const r = await m.venda.resumoVendas(DONA, {
      unidadeIds: ['uni-1', 'uni-2'],
      de: new Date(Date.now() - 365 * 864e5),
      ate: new Date(Date.now() + 864e5),
      q: 'listrada',
    })
    expect(r.concluidas).toBe(2)
    expect(r.total).toBeCloseTo(309.9, 2)
  })
})

// ─────────────────────────────────────────────────────────────
// A FICHA NO BALCÃO
// ─────────────────────────────────────────────────────────────

describe('a ficha da cliente no balcão', () => {
  it('o que ela deve em cada loja, com o vencido separado do carnê inteiro', async () => {
    const f = await m.cliente.fichaNoBalcao(DONA, 'cli-ana')
    expect(f).not.toBeNull()
    const lojas = Object.fromEntries(f!.resumo.lojas.map((l) => [l.unidadeId, l]))
    expect(lojas['uni-2']).toMatchObject({ aberto: 200, vencido: 100, parcelasAbertas: 2, parcelasVencidas: 1, podeReceber: true })
    expect(lojas['uni-2']!.atrasoHoje).toBeGreaterThan(0)
    expect(lojas['uni-1']).toMatchObject({ aberto: 120, vencido: 0, parcelasAbertas: 1 })
    expect(f!.resumo.pagoCrediario).toBe(100)
    expect(f!.resumo.compras).toBe(2)
    expect(f!.resumo.anteriores).toBe(1)
    expect(f!.falta).toEqual(['CPF', 'telefone', 'endereço'])
  })

  it('o carnê por compra: a paga diz quando foi paga; o atrasado vem primeiro', async () => {
    const f = await m.cliente.fichaNoBalcao(DONA, 'cli-ana')
    const [primeiro, segundo] = f!.carnes
    expect(primeiro).toMatchObject({ vendaNumero: 7, importada: true, aberto: 200, vencido: 100, pago: 100 })
    expect(primeiro!.parcelas.map((p) => p.situacao)).toEqual(['quitada', 'vencida', 'aberta'])
    const paga = primeiro!.parcelas[0]!
    expect(paga.vencimento).toBe(dia(-60))
    expect(paga.pagamentos).toHaveLength(1)
    expect(paga.pagamentos[0]).toMatchObject({ valor: 100, forma: 'DINHEIRO', externo: false })
    expect(diaEmSP(new Date(paga.pagamentos[0]!.quando))).toBe(diaEmSP(new Date(Date.now() - 50 * 864e5)))
    expect(primeiro!.parcelas[1]!.diasAtraso).toBe(30)
    expect(segundo).toMatchObject({ vendaNumero: 43, importada: false, aberto: 120, vencido: 0 })
  })

  it('a linha do tempo junta compras e pagamentos, do mais novo', async () => {
    const f = await m.cliente.fichaNoBalcao(DONA, 'cli-ana')
    const h = f!.historico
    expect(h.map((e) => e.tipo)).toEqual(['compra', 'compra', 'pagamento'])
    expect(h[0]).toMatchObject({ titulo: 'Compra nº 43', valor: 120 })
    expect(h[0]!.detalhe).toContain('crediário')
    expect(h[2]).toMatchObject({ tipo: 'pagamento', valor: 100, unidade: 'Loja Dois' })
    expect(h[2]!.detalhe).toContain('parcela 1/3 da compra 7')
  })

  it('a vendedora da Loja Um vê o carnê e as compras da Loja Um, e não os da Loja Dois', async () => {
    const f = await m.cliente.fichaNoBalcao(BALCAO1, 'cli-ana')
    expect(f!.resumo.lojas.map((l) => l.unidadeId)).toEqual(['uni-1'])
    expect(f!.carnes.map((k) => k.vendaNumero)).toEqual([43])
    expect(f!.historico.every((e) => e.unidade === 'Loja Um')).toBe(true)
    expect(f!.resumo.pagoCrediario).toBe(0)
  })

  it('ficha que não existe: nula', async () => {
    expect(await m.cliente.fichaNoBalcao(DONA, 'cli-nao-existe')).toBeNull()
  })
})

describe('completar a ficha no balcão', () => {
  const dados = {
    nome: 'Ana Teste',
    telefone: '(71) 99999-0000',
    documento: '529.982.247-25',
    email: null,
    nascimento: new Date('1990-05-10T12:00:00'),
    endereco: 'Rua das Flores',
    numero: '10',
    bairro: 'Centro',
    cidade: 'Salvador',
    estado: 'ba',
    cep: '40000-000',
  }

  it('CPF que não confere é recusado, e nada muda', async () => {
    const r = await m.cliente.editarNoBalcao(BALCAO1, 'cli-ana', { ...dados, documento: '529.982.247-24' })
    expect(r.ok).toBe(false)
    const [c] = (await db.query<{ documento: string | null }>(`select documento from clientes where id = 'cli-ana'`)).rows
    expect(c!.documento).toBeNull()
  })

  it('grava o que o balcão mostra e NÃO apaga a observação da gerente', async () => {
    const r = await m.cliente.editarNoBalcao(BALCAO1, 'cli-ana', dados)
    expect(r).toEqual({ ok: true, clienteId: 'cli-ana' })
    const [c] = (
      await db.query<{ documento: string; telefone: string; estado: string; cep: string; observacoes: string; nascimento: Date }>(
        `select documento, telefone, estado, cep, observacoes, nascimento from clientes where id = 'cli-ana'`,
      )
    ).rows
    expect(c).toMatchObject({ documento: '52998224725', telefone: '71999990000', estado: 'BA', cep: '40000000' })
    expect(c!.observacoes).toBe('não vender fiado sem falar com a gerente')
    expect(new Date(c!.nascimento).toISOString().slice(0, 10)).toBe('1990-05-10')
    const f = await m.cliente.fichaNoBalcao(BALCAO1, 'cli-ana')
    expect(f!.falta).toEqual([])
  })
})

describe('o cadastro rápido do balcão, com CPF', () => {
  it('CPF que não confere: recusa', async () => {
    expect(await m.cliente.cadastroRapido(BALCAO1, 'Bia', '', '123.456.789-00')).toMatchObject({ ok: false })
  })

  it('CPF que já é de alguém aponta a ficha que existe, e não cria outra', async () => {
    const r = await m.cliente.cadastroRapido(BALCAO1, 'Ana de Novo', '', '52998224725')
    expect(r).toMatchObject({ ok: false, jaExiste: { id: 'cli-ana' } })
  })

  it('CPF de ficha desativada também não duplica (pede para reativar)', async () => {
    const r = await m.cliente.cadastroRapido(BALCAO1, 'Ficha Nova', '', '111.444.777-35')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.jaExiste).toBeUndefined()
    expect(r.erro).toContain('desativada')
  })

  it('telefone que já é de alguém também aponta a ficha', async () => {
    const r = await m.cliente.cadastroRapido(BALCAO1, 'Outra Ana', '71 99999-0000')
    expect(r).toMatchObject({ ok: false, jaExiste: { id: 'cli-ana' } })
  })

  it('CPF novo e certo: cria com o CPF na ficha', async () => {
    const r = await m.cliente.cadastroRapido(BALCAO1, 'Bia Nova', '71988887777', '123.456.789-09')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [c] = (await db.query<{ documento: string }>(`select documento from clientes where id = $1`, [r.clienteId])).rows
    expect(c!.documento).toBe('12345678909')
  })
})
