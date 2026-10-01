// O que a primeira loja de verdade (duas lojas, 930 peças, 1.700 clientes, 8
// mil parcelas de crediário trazidas de outro sistema) mostrou no Norte, com
// banco de verdade (PGlite exposto numa porta), tudo pelo comoOrg:
//
//   1. o crediário TRAZIDO do sistema anterior (venda SALDO_IMPORTADO) não é
//      venda: fica fora da receita, do DRE e da lista de vendas, não se
//      cancela nem se devolve — e a parcela dele se recebe como qualquer outra
//   2. a lista do Crediário vem do banco em páginas, sem o teto mudo de 500,
//      e "quem deve mais" é somado sobre o carnê inteiro

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer

let m: {
  banco: typeof import('../src/servidor/banco')
  venda: typeof import('../src/servidor/venda')
  crediario: typeof import('../src/servidor/crediario')
  devolucao: typeof import('../src/servidor/devolucao')
  financeiro: typeof import('../src/servidor/financeiro')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-dona', nome: 'Dona Ana', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }

// Um saldo importado de R$ 300 (3 parcelas de 100, uma já vencida), datado em
// julho, e uma venda de verdade de R$ 50 no mesmo mês, na mesma loja.
const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', '{crediario,multiUnidade}', now(), now());
  insert into unidades (id, org_id, nome, eh_deposito, ativa, atualizada_em) values
    ('uni-a1', 'org-a', 'Loja Centro', false, true, now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-dona', 'org-a', 'Dona Ana', 'dona@a.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-dona', 'org-a', 'usr-dona', null, 'DONO');
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-a1', 'org-a', 'uni-a1', 'Dona Ana', 0);
  insert into clientes (id, org_id, nome, atualizado_em) values
    ('cli-1', 'org-a', 'Rosa', now());

  insert into vendas (id, org_id, unidade_id, numero, cliente_id, situacao, subtotal, total, criada_em, concluida_em) values
    ('v-saldo', 'org-a', 'uni-a1', 1, 'cli-1', 'SALDO_IMPORTADO', 300, 300, '2026-07-10 15:00', '2026-07-10 15:00'),
    ('v-real',  'org-a', 'uni-a1', 2, 'cli-1', 'CONCLUIDA', 50, 50, '2026-07-12 15:00', '2026-07-12 15:00');
  insert into venda_itens (id, org_id, venda_id, descricao, quantidade, preco_unit, total) values
    ('i-saldo', 'org-a', 'v-saldo', 'Saldo de crediário importado', 1, 300, 300),
    ('i-real',  'org-a', 'v-real', 'Blusa', 1, 50, 50);
  insert into pagamentos (id, org_id, venda_id, forma, valor, parcelas) values
    ('pg-saldo', 'org-a', 'v-saldo', 'CREDIARIO', 300, 3),
    ('pg-real',  'org-a', 'v-real', 'PIX', 50, 1);
  insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
    ('par-1', 'org-a', 'v-saldo', 'cli-1', 'uni-a1', 1, 3, '2026-08-10', 100),
    ('par-2', 'org-a', 'v-saldo', 'cli-1', 'uni-a1', 2, 3, '2099-09-10', 100),
    ('par-3', 'org-a', 'v-saldo', 'cli-1', 'uni-a1', 3, 3, '2099-10-10', 100);
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
    crediario: await import('../src/servidor/crediario'),
    devolucao: await import('../src/servidor/devolucao'),
    financeiro: await import('../src/servidor/financeiro'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const JULHO = { de: new Date('2026-07-01T03:00:00Z'), ate: new Date('2026-08-01T03:00:00Z') }

describe('1. o crediário trazido do sistema anterior não é venda', () => {
  it('fica fora do resumo e da lista de vendas', async () => {
    const f = { unidadeIds: ['uni-a1'], ...JULHO }
    const r = await m.venda.resumoVendas(DONA, f)
    expect(r.concluidas).toBe(1)
    expect(r.total).toBe(50)
    const lista = await m.venda.listarVendas(DONA, f)
    expect(lista.map((v) => v.id)).toEqual(['v-real'])
  })

  it('não entra na receita nem no custo do DRE do mês dele', async () => {
    const dre = await m.financeiro.montarDRE(DONA, ['uni-a1'], JULHO.de, new Date(JULHO.ate.getTime() - 1))
    const bruta = dre.linhas.find((l) => l.chave === 'bruta')
    expect(bruta?.valor).toBe(50)
  })

  it('não se cancela nem se devolve — a dívida não some sem ninguém receber', async () => {
    const c = await m.venda.cancelarVenda(DONA, 'v-saldo', 'cancelar o saldo')
    expect(c).toEqual({ ok: false, motivo: 'saldo_importado' })
    const d = await m.devolucao.devolver(DONA, {
      vendaId: 'v-saldo', itens: [{ vendaItemId: 'i-saldo', quantidade: 1 }], destino: 'VALE', motivo: 'devolver o saldo',
    })
    expect(d).toEqual({ ok: false, motivo: 'saldo_importado' })
    const parcelas = (await db.query<{ n: number }>(`select count(*)::int n from parcelas where venda_id = 'v-saldo'`)).rows[0]!.n
    expect(parcelas).toBe(3)
  })

  it('a parcela dele aparece no Crediário e se recebe como qualquer outra', async () => {
    const resumo = await m.crediario.resumoCrediario(DONA, ['uni-a1'])
    expect(resumo.emAberto).toBe(300)
    expect(resumo.vencido).toBe(100)
    const r = await m.crediario.receberParcela(DONA, { parcelaId: 'par-1', valor: 100, juros: 0, forma: 'PIX' })
    expect(r.ok).toBe(true)
    const depois = await m.crediario.resumoCrediario(DONA, ['uni-a1'])
    expect(depois.emAberto).toBe(200)
  })
})

describe('2. a lista do Crediário em páginas, sem teto mudo', () => {
  beforeAll(async () => {
    // 650 parcelas de 3 clientes. A "Zélia" só tem parcelas que caem DEPOIS
    // das 500 primeiras (vencimentos mais novos) — e é ela quem mais deve vencido.
    const linhas: string[] = []
    let n = 0
    const vendas: string[] = []
    for (const [cli, nome, qtd, valor, ano] of [['cli-a', 'Ana', 400, 10, 2024], ['cli-b', 'Bia', 200, 10, 2025], ['cli-z', 'Zélia', 50, 90, 2026]] as const) {
      vendas.push(`('${cli}', 'org-a', '${nome}', now())`)
      for (let i = 0; i < qtd; i++) {
        n++
        const mes = String((i % 6) + 1).padStart(2, '0')
        linhas.push(`('pp-${n}', 'org-a', 'v-${cli}', '${cli}', 'uni-a1', ${i + 1}, ${qtd}, '${ano}-${mes}-01', ${valor})`)
      }
    }
    await db.exec(`
      insert into clientes (id, org_id, nome, atualizado_em) values ${vendas.join(',')};
      insert into vendas (id, org_id, unidade_id, numero, cliente_id, situacao, subtotal, total) values
        ('v-cli-a', 'org-a', 'uni-a1', 10, 'cli-a', 'SALDO_IMPORTADO', 4000, 4000),
        ('v-cli-b', 'org-a', 'uni-a1', 11, 'cli-b', 'SALDO_IMPORTADO', 2000, 2000),
        ('v-cli-z', 'org-a', 'uni-a1', 12, 'cli-z', 'SALDO_IMPORTADO', 4500, 4500);
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values ${linhas.join(',')};
    `)
  })

  it('conta todas e entrega página por página, sem repetir nem pular', async () => {
    const f = { unidadeIds: ['uni-a1'], situacao: 'vencida' as const }
    const total = await m.crediario.contarParcelas(DONA, f)
    expect(total).toBe(650)
    const vistos = new Set<string>()
    for (let pagina = 1; pagina <= 7; pagina++) {
      const ps = await m.crediario.listarParcelas(DONA, { ...f, pagina, porPagina: 100 })
      expect(ps.length).toBe(pagina === 7 ? 50 : 100)
      for (const p of ps) vistos.add(p.id)
    }
    expect(vistos.size).toBe(650)
  })

  it('sem página, a ficha do cliente continua recebendo a lista dele', async () => {
    const ps = await m.crediario.listarParcelas(DONA, { unidadeIds: ['uni-a1'], situacao: 'aberta', clienteId: 'cli-z' })
    expect(ps.length).toBe(50)
  })

  it('"quem deve mais" soma o carnê inteiro, não a página da tela', async () => {
    const maiores = await m.crediario.maioresDevedores(DONA, ['uni-a1'], 3)
    expect(maiores.map((d) => d.nome)).toEqual(['Zélia', 'Ana', 'Bia'])
    expect(maiores[0]).toMatchObject({ resta: 4500, vencido: 4500 })
  })
})
