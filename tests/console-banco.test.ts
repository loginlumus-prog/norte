// O console do Norte com banco de verdade (PGlite numa porta, como em
// operacao-banco.test.ts):
//
// • as funções NOVAS da operação (trocar plano com motivo, módulos à parte,
//   refazer o convite do dono) passam pelo comoOrg — RLS valendo — e deixam
//   a linha certa no livro DA LOJA, assinada "Equipe Norte (<quem>)";
// • a leitura de todas as empresas (src/console/leitura.ts), que roda com a
//   credencial de admin: conta certa, e nada do negócio do cliente.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createHash } from 'node:crypto'
import { subirBanco } from './banco'

let db: PGlite
let servidor: PGLiteSocketServer
let url: string
let m: {
  banco: typeof import('../src/servidor/banco')
  pedidos: typeof import('../src/servidor/pedidos')
  operacao: typeof import('../src/servidor/operacao')
  leitura: typeof import('../src/console/leitura')
}
let admin: import('@prisma/client').PrismaClient

const SEMENTE = `
  insert into orgs (id, nome, slug, email, plano, situacao, modulos, credito_ia_cent, farol_marcas, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'ana@a.com', 'BALCAO_AGENTE', 'ATIVA', '{agente,metas}', 1000, 2, now()),
    ('org-b', 'Vizinha B', 'vizinha-b', 'dono@b.com', 'GRATIS', 'TESTE', '{}', 0, 1, now());
  insert into unidades (id, org_id, nome, eh_deposito, eh_fabrica, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro', false, false, now()), ('uni-a2', 'org-a', 'Bairro', false, false, now()),
    ('uni-a3', 'org-a', 'Depósito', true, false, now()), ('uni-a4', 'org-a', 'Cozinha', false, true, now()),
    ('uni-b1', 'org-b', 'B1', false, false, now());
  insert into usuarios (id, org_id, nome, email, telefone, senha_hash, sessoes_desde, atualizado_em) values
    ('usr-ana', 'org-a', 'Ana Dona', 'ana@a.com', '11 99999-0000', 'x', '2026-01-01', now()),
    ('usr-sup', 'org-b', 'Suporte do Norte', 'sup@gestornorte.com', null, null, '2026-01-01', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel, expira_em) values
    ('ac-ana', 'org-a', 'usr-ana', null, 'DONO', null),
    ('ac-sup', 'org-b', 'usr-sup', null, 'SUPORTE', (now() at time zone 'utc') + interval '2 hours');
  insert into convites (id, org_id, email, papel, token, expira_em) values
    ('cv-velho', 'org-b', 'dono@b.com', 'DONO', 'resumo-velho', (now() at time zone 'utc') - interval '1 day');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 50000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    pedidos: await import('../src/servidor/pedidos'),
    operacao: await import('../src/servidor/operacao'),
    leitura: await import('../src/console/leitura'),
  }
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) })
}, 60_000)

afterAll(async () => {
  await admin?.$disconnect()
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
type Livro = { acao: string; quem: string; autor: string; alvo_nome: string | null; motivo: string | null; antes: unknown; depois: Record<string, unknown> | null }
const livro = (org: string, acao: string) =>
  linhas<Livro>(`select * from auditoria where org_id = $1 and acao = $2 order by criado_em`, [org, acao])

describe('leitura de todas as empresas (credencial de admin)', () => {
  it('lista com dono, lojas sem depósito, pessoas sem o suporte, módulos e mensalidade', async () => {
    const todas = await m.leitura.listarEmpresas(admin)
    const a = todas.find((l) => l.slug === 'loja-a')!
    const b = todas.find((l) => l.slug === 'vizinha-b')!
    expect(a).toMatchObject({
      dono: { nome: 'Ana Dona', email: 'ana@a.com', telefone: '11 99999-0000' },
      lojas: 3, depositos: 1, fabricas: 1, pessoas: 1, creditoSaldoCent: 1000, suportesAtivos: 0,
    })
    // A conta é a de planos.ts, com as unidades que cobram (o depósito fora).
    const { mensalidade } = await import('../src/servidor/planos')
    expect(a.mensalCent).toBe(Math.round(mensalidade('BALCAO_AGENTE', 3, 1, 0).total! * 100))
    // A conta de suporte é nossa: não é dona, nem pessoa da loja.
    expect(b).toMatchObject({ dono: null, emailDaEmpresa: 'dono@b.com', pessoas: 0, suportesAtivos: 1 })
  })

  it('nenhuma linha traz dado do negócio do cliente', async () => {
    const [a] = await m.leitura.listarEmpresas(admin)
    const chaves = Object.keys(a!)
    for (const proibida of ['vendas', 'clientes', 'caixa', 'faturamento', 'documento', 'razaoSocial']) {
      expect(chaves).not.toContain(proibida)
    }
  })

  it('o resumo soma o MRR só de quem paga, e o filtro acha por e-mail do dono sem acento', async () => {
    const todas = await m.leitura.listarEmpresas(admin)
    const r = m.leitura.resumir(todas)
    expect(r).toMatchObject({ total: 2, ativas: 1, emTeste: 1, mrrCent: todas.find((l) => l.slug === 'loja-a')!.mensalCent })
    expect(m.leitura.filtrar(todas, { busca: 'ANA@A' }).map((l) => l.slug)).toEqual(['loja-a'])
    expect(m.leitura.filtrar(todas, { busca: 'vizínha' }).map((l) => l.slug)).toEqual(['vizinha-b'])
    expect(m.leitura.filtrar(todas, { situacao: 'TESTE' }).map((l) => l.slug)).toEqual(['vizinha-b'])
  })

  it('o detalhe traz lojas, equipe com papéis e o convite pendente', async () => {
    const d = await m.leitura.detalheEmpresa(admin, 'vizinha-b')
    expect(d!.equipe).toEqual([expect.objectContaining({ email: 'sup@gestornorte.com', temSenha: false, papeis: [expect.objectContaining({ papel: 'SUPORTE' })] })])
    expect(d!.convites).toEqual([expect.objectContaining({ papel: 'DONO', aceitoEm: null })])
    expect(await m.leitura.detalheEmpresa(admin, 'nao-existe')).toBeNull()
  })

  it('o mês começa à meia-noite de São Paulo', () => {
    expect(m.leitura.inicioDoMesEmSP(new Date('2026-10-01T02:59:00Z')).toISOString()).toBe('2026-09-01T03:00:00.000Z')
    expect(m.leitura.inicioDoMesEmSP(new Date('2026-10-01T03:00:00Z')).toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })
})

describe('trocarPlanoPelaEquipe', () => {
  it('exige motivo ANTES de trocar', async () => {
    await expect(m.operacao.trocarPlanoPelaEquipe('org-a', 'BALCAO', { motivo: 'x', quem: 'Rafa' })).rejects.toThrow(/motivo/)
    const [a] = await linhas<{ plano: string }>(`select plano from orgs where id = 'org-a'`)
    expect(a!.plano).toBe('BALCAO_AGENTE')
  })

  it('troca, fecha o pedido e anota o motivo de quem decidiu', async () => {
    await db.query(
      `insert into auditoria (id, org_id, quem, acao, alvo_tipo, alvo_id, alvo_nome, depois, criado_em)
       values ('ped-1', 'org-a', 'Dona', 'plano.pediu', 'empresa', 'org-a', 'x', '{"plano":"REDE"}', $1::timestamp)`,
      [new Date(Date.now() - 1000).toISOString()],
    )
    const pedido = m.pedidos.pedidoAberto(await m.pedidos.eventosDePedido('org-a'), 'plano')
    expect(pedido?.id).toBe('ped-1')
    await m.operacao.trocarPlanoPelaEquipe('org-a', 'REDE', { motivo: 'Contrato assinado em 01/10', quem: 'Rafa Teste', pedidoId: 'ped-1' })
    const [a] = await linhas<{ plano: string }>(`select plano from orgs where id = 'org-a'`)
    expect(a!.plano).toBe('REDE')
    expect(m.pedidos.pedidoAberto(await m.pedidos.eventosDePedido('org-a'), 'plano')).toBeNull()
    const [nota] = await livro('org-a', 'equipe.anotou')
    expect(nota).toMatchObject({ quem: 'Equipe Norte (Rafa Teste)', autor: 'SISTEMA', motivo: 'Contrato assinado em 01/10' })
    expect(nota!.depois).toMatchObject({ sobre: 'plano.trocou', de: 'BALCAO_AGENTE', para: 'REDE', pedidoId: 'ped-1' })
  })
})

describe('definirModuloDaEquipe', () => {
  it('liga o Farol (contratado) e a Fábrica, com linha no livro', async () => {
    expect(await m.operacao.definirModuloDaEquipe('org-a', 'farol', true, { motivo: 'Farol contratado, 2 marcas', quem: 'Rafa' }))
      .toMatchObject({ mudou: true })
    expect(await m.operacao.definirModuloDaEquipe('org-a', 'fabrica', true, { motivo: 'Implantação da fábrica', quem: 'Rafa' }))
      .toMatchObject({ mudou: true })
    const [a] = await linhas<{ modulos: string[] }>(`select modulos from orgs where id = 'org-a'`)
    expect(a!.modulos).toEqual(expect.arrayContaining(['farol', 'fabrica', 'agente']))
    const l = await livro('org-a', 'empresa.modulo')
    expect(l.map((x) => x.alvo_nome)).toEqual(['Farol ligado', 'Fábrica ligado'])
    expect(l[0]).toMatchObject({ quem: 'Equipe Norte (Rafa)', autor: 'SISTEMA', motivo: 'Farol contratado, 2 marcas' })
    // a conta da lista passa a ter o Farol
    const todas = await m.leitura.listarEmpresas(admin)
    expect(todas.find((x) => x.slug === 'loja-a')!.modulos).toContain('farol')
  })

  it('ligado de novo não grava nada; desligar tira só aquele', async () => {
    const antes = (await livro('org-a', 'empresa.modulo')).length
    expect(await m.operacao.definirModuloDaEquipe('org-a', 'farol', true, { motivo: 'de novo, igual', quem: 'Rafa' })).toMatchObject({ mudou: false })
    expect((await livro('org-a', 'empresa.modulo')).length).toBe(antes)
    await m.operacao.definirModuloDaEquipe('org-a', 'fabrica', false, { motivo: 'Fábrica fechou', quem: 'Rafa' })
    const [a] = await linhas<{ modulos: string[] }>(`select modulos from orgs where id = 'org-a'`)
    expect(a!.modulos).not.toContain('fabrica')
    expect(a!.modulos).toContain('farol')
  })

  it('não liga fora do plano (o Grátis não tem Farol), nem módulo que não é à parte', async () => {
    await expect(m.operacao.definirModuloDaEquipe('org-b', 'farol', true, { motivo: 'tentativa errada', quem: 'Rafa' })).rejects.toThrow(/não tem/)
    await expect(
      m.operacao.definirModuloDaEquipe('org-a', 'agente' as never, false, { motivo: 'tentativa errada', quem: 'Rafa' }),
    ).rejects.toThrow(/não é contratado/)
    const [b] = await linhas<{ modulos: string[] }>(`select modulos from orgs where id = 'org-b'`)
    expect(b!.modulos).toEqual([])
  })
})

describe('reconvidarDono', () => {
  it('refaz o convite: o velho some, o novo guarda só o resumo, e o livro registra', async () => {
    const agora = new Date()
    const r = await m.operacao.reconvidarDono('org-b', { motivo: 'O link venceu', quem: 'Rafa Teste' }, 'http://localhost:3000/', agora)
    expect(r.email).toBe('dono@b.com')
    expect(r.link).toMatch(/^http:\/\/localhost:3000\/vizinha-b\/convite\/[A-Za-z0-9_-]{43}$/)
    const token = r.link.split('/').at(-1)!
    const convites = await linhas<{ id: string; email: string; papel: string; token: string }>(`select id, email, papel, token from convites where org_id = 'org-b'`)
    expect(convites).toHaveLength(1)
    expect(convites[0]).toMatchObject({ email: 'dono@b.com', papel: 'DONO', token: createHash('sha256').update(token).digest('hex') })
    expect(convites[0]!.token).not.toBe(token)
    const [l] = await livro('org-b', 'empresa.reconvidou')
    expect(l).toMatchObject({ quem: 'Equipe Norte (Rafa Teste)', autor: 'SISTEMA', motivo: 'O link venceu' })
    // a vizinha não ganhou convite nenhum
    expect(await linhas(`select id from convites where org_id = 'org-a'`)).toEqual([])
  })

  it('com e-mail novo, troca o e-mail da empresa', async () => {
    const r = await m.operacao.reconvidarDono('org-b', { motivo: 'E-mail digitado errado na venda', quem: 'Rafa', email: 'Certo@B.com' }, 'http://x.test')
    expect(r.email).toBe('certo@b.com')
    const [b] = await linhas<{ email: string }>(`select email from orgs where id = 'org-b'`)
    expect(b!.email).toBe('certo@b.com')
  })

  it('recusa quando alguém da loja já entrou (a conta de suporte não conta), e sem endereço público', async () => {
    await expect(m.operacao.reconvidarDono('org-a', { motivo: 'O link venceu', quem: 'Rafa' }, 'http://x.test')).rejects.toThrow(/tela de Equipe/)
    await expect(m.operacao.reconvidarDono('org-b', { motivo: 'O link venceu', quem: 'Rafa' }, '')).rejects.toThrow(/NORTE_URL/)
    expect(await linhas(`select id from convites where org_id = 'org-a'`)).toEqual([])
  })
})
