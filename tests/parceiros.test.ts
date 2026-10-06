// O programa de parceiros, com banco de verdade:
//
//   1. AS REGRAS (puras): a faixa sobe de 10% a 30% com os clientes pagando;
//      só 12 meses por cliente; o segundo nível exige cliente próprio; Pix,
//      CPF e CNPJ conferidos; o dia do repasse.
//   2. O CADASTRO E O LOGIN pelas funções do banco: código único, rede pelo
//      código de quem trouxe, e-mail repetido recusado, freio de senha.
//   3. A INDICAÇÃO no cadastro da empresa: o ?ref= vira indicação; o próprio
//      dono não se indica; código desconhecido é ignorado.
//   4. O PAGAMENTO gera a comissão certa (metade na primeira, faixa, segundo
//      nível), uma vez por mês, e o repasse respeita carência e mínimo.
//   5. O ISOLAMENTO: um parceiro não vê o outro; a empresa não vê parceiro;
//      a portaria e a aplicação não leem o freio.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  p: typeof import('../src/servidor/parceiros')
  cadastro: typeof import('../src/servidor/autocadastro')
}

const raiz = join(import.meta.dirname, '..')
const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const SENHA = 'senha-boa-123'

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.SEGREDO_SESSAO = 'x'.repeat(48)
  db = await subirBanco()
  await db.exec(`
    create role app_portaria nologin;
    grant usage on schema public to app_portaria;
    grant select (id, nome, slug, situacao, logo_url, cor_marca, modulos, configurada_em, agente_nome)
      on public.orgs to app_portaria;
  `)
  await db.exec(readFileSync(join(raiz, 'prisma/sql/rls.sql'), 'utf8'))
  const porta = 50000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    p: await import('../src/servidor/parceiros'),
    cadastro: await import('../src/servidor/autocadastro'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  const g = globalThis as { __prismaNorte?: unknown; __prismaPortaria?: unknown }
  delete g.__prismaNorte
  delete g.__prismaPortaria
  await servidor?.stop()
  await db?.close()
})

describe('as regras', () => {
  it('a faixa começa em 10% e chega a 30% com os clientes pagando', () => {
    expect(m.p.faixaDe(0).pct).toBe(10)
    expect(m.p.faixaDe(4)).toMatchObject({ pct: 10, proxima: { pct: 15, faltam: 1 } })
    expect(m.p.faixaDe(5).pct).toBe(15)
    expect(m.p.faixaDe(10).pct).toBe(20)
    expect(m.p.faixaDe(20).pct).toBe(25)
    expect(m.p.faixaDe(30)).toMatchObject({ pct: 30, proxima: null })
    expect(m.p.faixaDe(500).pct).toBe(30)
  })

  it('a comissão: faixa no nível 1, 5% no 2 só com cliente próprio, e só 12 meses', () => {
    const base = { baseCent: 14990, referencia: '2026-11', primeiroMes: '2026-11' }
    const sem = m.p.calcularComissoes({
      ...base,
      parceiro: { id: 'b', ativo: true, clientes: 1 },
      patrocinador: { id: 'a', ativo: true, clientes: 0 },
    })
    expect(sem).toEqual([{ parceiroId: 'b', nivel: 1, pct: 10, valorCent: 1499 }])

    const com = m.p.calcularComissoes({
      ...base,
      parceiro: { id: 'b', ativo: true, clientes: 12 },
      patrocinador: { id: 'a', ativo: true, clientes: 1 },
    })
    expect(com).toEqual([
      { parceiroId: 'b', nivel: 1, pct: 20, valorCent: 2998 },
      { parceiroId: 'a', nivel: 2, pct: 5, valorCent: 750 },
    ])

    // O 12º mês ainda paga; o 13º não.
    const p = { parceiro: { id: 'b', ativo: true, clientes: 1 }, patrocinador: null }
    expect(m.p.calcularComissoes({ ...p, baseCent: 8990, primeiroMes: '2026-11', referencia: '2027-10' })).toHaveLength(1)
    expect(m.p.calcularComissoes({ ...p, baseCent: 8990, primeiroMes: '2026-11', referencia: '2027-11' })).toHaveLength(0)
    // Bloqueado não ganha; patrocinador bloqueado também não.
    expect(m.p.calcularComissoes({ ...base, parceiro: { id: 'b', ativo: false, clientes: 3 }, patrocinador: { id: 'a', ativo: false, clientes: 3 } })).toEqual([])
  })

  it('Pix, CPF e CNPJ conferidos; o código sai do nome; o repasse é no dia 10', () => {
    expect(m.p.lerPix('cpf', '529.982.247-25')).toEqual({ ok: { tipo: 'cpf', chave: '52998224725' } })
    expect(m.p.lerPix('cpf', '111.111.111-11')).toHaveProperty('erro')
    expect(m.p.lerPix('telefone', '(71) 99999-0000')).toEqual({ ok: { tipo: 'telefone', chave: '+5571999990000' } })
    expect(m.p.lerPix('email', 'Maria@Ex.com')).toEqual({ ok: { tipo: 'email', chave: 'maria@ex.com' } })
    expect(m.p.lerPix('aleatoria', 'nao-e-chave')).toHaveProperty('erro')
    expect(m.p.lerDocumento('11.222.333/0001-81')).toEqual({ ok: '11222333000181' })
    expect(m.p.lerDocumento('12345')).toHaveProperty('erro')
    expect(m.p.codigoDoNome('Zé Ló')).toBe('ZELO')
    expect(m.p.codigoDoNome('Maria José da Silva')).toBe('MARIAJOSE')
    expect(m.p.codigoDoNome('Gabriel Souza')).toBe('GABRIEL')
    expect(m.p.proximoDiaDeRepasse(new Date('2026-10-06T15:00:00Z'))).toBe('2026-10-10')
    expect(m.p.proximoDiaDeRepasse(new Date('2026-10-11T15:00:00Z'))).toBe('2026-11-10')
    expect(m.p.proximoDiaDeRepasse(new Date('2026-12-20T15:00:00Z'))).toBe('2027-01-10')
    expect(m.p.valorDaMensalidade(14990, true)).toEqual({ cheioCent: 14990, pagarCent: 7495, descontoCent: 7495 })
  })
})

let gabriel: { id: string; codigo: string }
let bia: { id: string; codigo: string }

describe('cadastro e login do parceiro', () => {
  it('cria a conta com código do nome; o segundo com o mesmo nome ganha número', async () => {
    const r = await m.p.cadastrarParceiro({ nome: 'Gabriel Souza', email: 'Gabriel@Ex.com', telefone: '(71) 98888-7777', senha: SENHA, aceitou: true }, '10.0.0.1', null)
    expect(r).toMatchObject({ ok: true, codigo: 'GABRIEL' })
    if (!r.ok) throw new Error()
    gabriel = { id: r.parceiroId, codigo: r.codigo }
    const r2 = await m.p.cadastrarParceiro({ nome: 'Gabriel Lima', email: 'gl@ex.com', telefone: '', senha: SENHA, aceitou: true }, '10.0.0.1', null)
    expect(r2).toMatchObject({ ok: true, codigo: 'GABRIEL2' })
    const [g] = await linhas<{ email: string; telefone: string; senha_hash: string }>(`select email, telefone, senha_hash from parceiros where id = $1`, [gabriel.id])
    expect(g).toMatchObject({ email: 'gabriel@ex.com', telefone: '71988887777' })
    expect(g!.senha_hash).toMatch(/^scrypt\$/)
  })

  it('quem entra pelo convite fica na rede de quem convidou; e-mail repetido é recusado', async () => {
    const r = await m.p.cadastrarParceiro({ nome: 'Bia Santos', email: 'bia@ex.com', telefone: '', senha: SENHA, aceitou: true }, '10.0.0.2', 'gabriel')
    if (!r.ok) throw new Error(r.recado)
    bia = { id: r.parceiroId, codigo: r.codigo }
    const [b] = await linhas<{ patrocinador_id: string }>(`select patrocinador_id from parceiros where id = $1`, [bia.id])
    expect(b!.patrocinador_id).toBe(gabriel.id)
    const rep = await m.p.cadastrarParceiro({ nome: 'Outra', email: 'BIA@ex.com', telefone: '', senha: SENHA, aceitou: true }, '10.0.0.3', null)
    expect(rep).toMatchObject({ ok: false, recado: expect.stringMatching(/já tem conta/) })
    expect(bia.codigo).toBe('BIASANTOS')
    expect(await m.p.nomePeloCodigo('biasantos')).toBe('Bia')
    expect(await m.p.nomePeloCodigo('NAOEXISTE')).toBeNull()
  })

  it('entra com a senha certa; cinco erros seguidos freiam até a certa', async () => {
    expect(await m.p.entrarParceiro('bia@ex.com', SENHA, '10.0.0.9')).toEqual({ ok: true, parceiroId: bia.id })
    expect(await m.p.entrarParceiro('bia@ex.com', 'errada-123', '10.0.0.9')).toMatchObject({ ok: false, recado: expect.stringMatching(/não conferem/) })
    expect(await m.p.entrarParceiro('ninguem@ex.com', 'errada-123', '10.0.0.9')).toMatchObject({ ok: false, recado: expect.stringMatching(/não conferem/) })
    for (let i = 0; i < 4; i++) await m.p.entrarParceiro('bia@ex.com', 'errada-123', '10.0.0.9')
    expect(await m.p.entrarParceiro('bia@ex.com', SENHA, '10.0.0.9')).toMatchObject({ ok: false, recado: expect.stringMatching(/Muitas tentativas/) })
    await db.exec(`delete from parceiros_tentativas where tipo = 'entrar'`)
  })

  it('esqueci a senha: o código vale uma vez e derruba as sessões de antes', async () => {
    expect(await m.p.pedirTrocaDeSenha('ninguem@ex.com', null)).toBeNull()
    const t = await m.p.pedirTrocaDeSenha('bia@ex.com', null)
    expect(t?.nome).toBe('Bia')
    const [antes] = await linhas<{ troca_resumo: string }>(`select troca_resumo from parceiros where id = $1`, [bia.id])
    expect(antes!.troca_resumo).not.toContain(t!.codigo)
    const velha = new Date(Date.now() - 60_000)
    expect(await m.p.trocarSenhaPeloCodigo(t!.codigo, 'senha-nova-456')).toEqual({ ok: true, parceiroId: bia.id })
    expect(await m.p.trocarSenhaPeloCodigo(t!.codigo, 'outra-senha-789')).toMatchObject({ ok: false })
    expect(await m.p.sessaoDoParceiroVale(bia.id, velha)).toBeNull()
    expect(await m.p.sessaoDoParceiroVale(bia.id, new Date())).toMatchObject({ nome: 'Bia Santos' })
    expect(await m.p.entrarParceiro('bia@ex.com', 'senha-nova-456', '10.0.0.8')).toMatchObject({ ok: true })
  })
})

const empresa = (nome: string, email: string, ref: string | null, ip: string) =>
  m.cadastro.criarEmpresaPeloCadastro({ empresa: nome, dono: 'Dona', email, senha: SENHA, ramo: 'roupa', aceitou: true, ref }, ip, { emailPendente: false })

let lojaDaBia: string
let lojaDoGabriel: string

describe('a indicação no cadastro da empresa', () => {
  it('o ?ref= vira indicação da empresa nova, com o nome dela', async () => {
    const r = await empresa('Loja da Bia', 'dona1@loja.com', bia.codigo.toLowerCase(), '20.0.0.1')
    if (!r.ok) throw new Error()
    lojaDaBia = r.orgId
    const [i] = await linhas<{ parceiro_id: string; empresa_nome: string }>(`select parceiro_id, empresa_nome from indicacoes where org_id = $1`, [r.orgId])
    expect(i).toEqual({ parceiro_id: bia.id, empresa_nome: 'Loja da Bia' })
    expect(await m.p.indicacaoDaEmpresa(r.orgId)).toEqual({ descontoDisponivel: true })
  })

  it('o próprio parceiro não se indica; código desconhecido é ignorado; a empresa nasce igual', async () => {
    const propria = await empresa('Loja da Própria Bia', 'bia@ex.com', bia.codigo, '20.0.0.2')
    const nada = await empresa('Loja Sem Ninguém', 'dona3@loja.com', 'QUEMSABE', '20.0.0.3')
    const lixo = await empresa('Loja Com Lixo', 'dona4@loja.com', "x'; drop table--", '20.0.0.4')
    for (const r of [propria, nada, lixo]) {
      if (!r.ok) throw new Error()
      expect(await linhas(`select 1 from indicacoes where org_id = $1`, [r.orgId])).toHaveLength(0)
    }
    const g = await empresa('Loja do Gabriel', 'dona5@loja.com', 'GABRIEL', '20.0.0.5')
    if (!g.ok) throw new Error()
    lojaDoGabriel = g.orgId
  })
})

describe('pagamento, comissão e repasse', () => {
  const pagar = (orgId: string, referencia: string, cheio: number, pago: number, pagoEm = new Date()) =>
    m.p.registrarPagamento(orgId, { referencia, valorCheioCent: cheio, valorPagoCent: pago, forma: 'pix', pagoEm, quem: 'Equipe Norte (Teste)' })

  it('a primeira mensalidade com 50%: a comissão é sobre o valor pago; sem segundo nível enquanto o Gabriel não tem cliente pagando', async () => {
    const r = await pagar(lojaDaBia, '2026-10', 14990, 7495)
    expect(r.descontoCent).toBe(7495)
    expect(r.comissoes).toEqual([{ parceiroId: bia.id, nivel: 1, pct: 10, valorCent: 750 }])
    expect(await m.p.indicacaoDaEmpresa(lojaDaBia)).toEqual({ descontoDisponivel: false })
    await expect(pagar(lojaDaBia, '2026-10', 14990, 14990)).rejects.toThrow(/já está registrado/)
  })

  it('com cliente próprio pagando, o Gabriel passa a ganhar os 5% da rede', async () => {
    const g = await pagar(lojaDoGabriel, '2026-10', 8990, 4495)
    expect(g.comissoes).toEqual([{ parceiroId: gabriel.id, nivel: 1, pct: 10, valorCent: 450 }])
    const r = await pagar(lojaDaBia, '2026-11', 14990, 14990)
    expect(r.comissoes).toEqual([
      { parceiroId: bia.id, nivel: 1, pct: 10, valorCent: 1499 },
      { parceiroId: gabriel.id, nivel: 2, pct: 5, valorCent: 750 },
    ])
  })

  it('empresa sem indicação paga e não gera comissão nenhuma', async () => {
    const [o] = await linhas<{ id: string }>(`select id from orgs where nome = 'Loja Sem Ninguém'`)
    expect((await pagar(o!.id, '2026-10', 8990, 8990)).comissoes).toEqual([])
  })

  it('o painel conta clientes, faixa, carência e rede; o repasse espera a carência e o mínimo', async () => {
    const agora = new Date()
    const painel = await m.p.painelDoParceiro(gabriel.id, agora)
    expect(painel).toMatchObject({ ativos: 1, faixa: { pct: 10 } })
    expect(painel!.indicacoes).toEqual([expect.objectContaining({ empresa: 'Loja do Gabriel', situacao: 'pagando', ganhoCent: 450 })])
    expect(painel!.rede).toEqual([expect.objectContaining({ nome: 'Bia S.', indicadas: 1, ativas: 1 })])
    expect(painel!.totais).toMatchObject({ carenciaCent: 1200, liberadoCent: 0, nivel2Cent: 750 })
    // No segundo nível, o nome da empresa da Bia não aparece para o Gabriel.
    expect(painel!.comissoes.find((c) => c.nivel === 2)?.empresa).toBe('Cliente da sua rede')

    await expect(m.p.registrarRepasse(gabriel.id, { quem: 'Equipe' })).rejects.toThrow(/Pix/)
    expect(await m.p.salvarDadosDoParceiro(gabriel.id, { pixTipo: 'cpf', pixChave: '529.982.247-25', documento: '52998224725', telefone: '' })).toEqual({ ok: true })
    await expect(m.p.registrarRepasse(gabriel.id, { quem: 'Equipe' })).rejects.toThrow(/Não há comissão liberada/)
    const depois = new Date(agora.getTime() + 31 * 864e5)
    await expect(m.p.registrarRepasse(gabriel.id, { quem: 'Equipe', agora: depois })).rejects.toThrow(/mínimo/)
    const r = await m.p.registrarRepasse(gabriel.id, { quem: 'Equipe', agora: depois, ignorarMinimo: true, comprovante: 'E2E123' })
    expect(r).toMatchObject({ valorCent: 1200, comissoes: 2 })
    const fim = await m.p.painelDoParceiro(gabriel.id, depois)
    expect(fim!.totais).toMatchObject({ pagoCent: 1200, liberadoCent: 0 })
    expect(fim!.repasses).toEqual([expect.objectContaining({ valorCent: 1200, comprovante: 'E2E123' })])
  })

  it('a empresa cliente ativa a conta de parceiro dela (Indique e ganhe), ou vincula a que já existe', async () => {
    const r = await m.p.ativarParceiroDaEmpresa(lojaDoGabriel, { nome: 'Dona do Gabriel', email: 'dona5@loja.com' }, SENHA, null)
    expect(r).toEqual({ ok: true })
    const id = await m.p.parceiroDaEmpresa(lojaDoGabriel)
    expect(id).toBeTruthy()
    // Já é parceira com o e-mail: precisa da senha de lá para vincular.
    expect(await m.p.ativarParceiroDaEmpresa(lojaDaBia, { nome: 'Bia', email: 'bia@ex.com' }, 'senha-errada-1', null)).toMatchObject({ ok: false })
    expect(await m.p.ativarParceiroDaEmpresa(lojaDaBia, { nome: 'Bia', email: 'bia@ex.com' }, 'senha-nova-456', null)).toEqual({ ok: true })
    expect(await m.p.parceiroDaEmpresa(lojaDaBia)).toBe(bia.id)
  })
})

describe('o isolamento', () => {
  const como = (parceiro: string | null, org: string | null, sql: string) =>
    db.transaction(async (tx) => {
      await tx.exec('set local role app_norte')
      await tx.query(`select set_config('app.org_id', $1, true), set_config('app.parceiro_id', $2, true)`, [org ?? '', parceiro ?? ''])
      return (await tx.query(sql)).rows
    })

  it('um parceiro só vê a própria conta, as próprias comissões e indicações', async () => {
    expect(await como(bia.id, null, 'select id from parceiros')).toEqual([{ id: bia.id }])
    const cs = (await como(bia.id, null, 'select parceiro_id from comissoes')) as { parceiro_id: string }[]
    expect(cs.length).toBeGreaterThan(0)
    expect(cs.every((c) => c.parceiro_id === bia.id)).toBe(true)
    expect(await como(bia.id, null, 'select empresa_nome from indicacoes')).toEqual([{ empresa_nome: 'Loja da Bia' }])
    expect(await como(bia.id, null, 'select id from repasses')).toEqual([])
    // Nem um pagamento de empresa, nem a empresa.
    expect(await como(bia.id, null, 'select id from pagamentos_norte')).toEqual([])
    expect(await como(bia.id, null, 'select id from orgs')).toEqual([])
  })

  it('a empresa não enxerga parceiro nenhum, e o pagamento não se reescreve', async () => {
    expect(await como(null, lojaDaBia, 'select id from parceiros')).toEqual([])
    expect(await como(null, lojaDaBia, 'select id from repasses')).toEqual([])
    await expect(como(null, lojaDaBia, `update pagamentos_norte set valor_pago = 1`)).rejects.toThrow(/permission denied/)
    await expect(como(null, lojaDaBia, `delete from pagamentos_norte`)).rejects.toThrow(/permission denied/)
  })

  it('o freio é só das funções; a portaria não lê parceiro', async () => {
    for (const papel of ['app_norte', 'app_portaria']) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${papel}`)
          return tx.query('select * from parceiros_tentativas')
        }),
      ).rejects.toThrow(/permission denied/)
    }
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role app_portaria')
        return tx.query('select email from parceiros')
      }),
    ).rejects.toThrow(/permission denied/)
    // A rede só sai pela função, sem e-mail nem Pix.
    const rede = await como(gabriel.id, null, 'select * from public.rede_do_parceiro()')
    expect(Object.keys(rede[0] as object).sort()).toEqual(['r_ativas', 'r_desde', 'r_id', 'r_indicadas', 'r_nome'])
  })
})
