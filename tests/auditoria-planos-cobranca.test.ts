// Auditoria da lógica comercial (planos, crédito de IA, teste, Farol, lojas).
//
// Cada `it` aqui PROVA um comportamento que divergia do que a página de venda,
// os termos ou o comentário do próprio código prometem. Os casos "CORRIGIDO"
// foram invertidos depois da correção e guardam o comportamento certo; os
// "BUG" que sobraram ainda descrevem o defeito.
//
// Banco de verdade (PGlite numa porta, como farol.test.ts): tudo passa pelo
// comoOrg, com papel sem privilégio e RLS valendo.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'
import { PRECOS, mensalidade, mudanca } from '../src/servidor/planos'
import type { DadosLoja } from '../src/servidor/lojas'

vi.mock('../src/servidor/ia', async (original) => {
  const real = await original<typeof import('../src/servidor/ia')>()
  return { ...real, temChaveIA: () => false }
})

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  assinatura: typeof import('../src/servidor/assinatura')
  farol: typeof import('../src/servidor/farol')
  lojas: typeof import('../src/servidor/lojas')
}

const dono = (orgId: string): Sessao => ({
  orgId,
  usuarioId: `dono-${orgId}`,
  nome: 'Dono',
  acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }],
})

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, teste_ate, atualizada_em, configurada_em) values
    -- Farol contratado (para UMA marca, pela tabela: R$ 497)
    ('org-farol', 'Gelados', 'gelados', 'BALCAO', 'ATIVA', '{farol}', 0, null, now(), now()),
    -- teste do site que atravessa a virada do mes
    ('org-teste', 'Teste Virada', 'teste-virada', 'BALCAO_AGENTE', 'TESTE', '{agente}', 0, now() + interval '25 days', now(), now()),
    -- teste que a equipe confirma como assinatura paga no mesmo mes
    ('org-paga', 'Teste Pago', 'teste-pago', 'BALCAO_AGENTE', 'TESTE', '{agente}', 0, now() + interval '20 days', now(), now()),
    -- criada por scripts/criar-empresa.ts com --dias 0
    ('org-eterno', 'Teste Eterno', 'teste-eterno', 'BALCAO_AGENTE', 'TESTE', '{agente}', 0, null, now(), now()),
    -- loja paga de uma unidade, para o deposito que vira loja
    ('org-loja', 'Roupas', 'roupas', 'BALCAO', 'ATIVA', '{}', 0, null, now(), now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('dono-org-farol', 'org-farol', 'Dono', 'd@farol.com', now()),
    ('dono-org-loja', 'org-loja', 'Dono', 'd@loja.com', now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('u-farol', 'org-farol', 'Praia', now()),
    ('u-teste', 'org-teste', 'Centro', now()),
    ('u-paga', 'org-paga', 'Centro', now()),
    ('u-eterno', 'org-eterno', 'Centro', now()),
    ('u-loja', 'org-loja', 'Centro', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  delete process.env.NORTE_ASSINATURA_LIVRE
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 47000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    assinatura: await import('../src/servidor/assinatura'),
    farol: await import('../src/servidor/farol'),
    lojas: await import('../src/servidor/lojas'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const saldo = async (orgId: string) =>
  (await db.query<{ credito_ia_cent: number }>(`select credito_ia_cent from orgs where id = $1`, [orgId])).rows[0]!.credito_ia_cent

describe('Farol: cobrado por marca na tabela, e a marca respeita o contratado', () => {
  it('CORRIGIDO: com 1 marca contratada, a segunda é recusada e o crédito do mês é de uma só', async () => {
    const s = dono('org-farol')
    await m.farol.salvarMarca(s, null, { nome: 'Marca 1' })
    await expect(m.farol.salvarMarca(s, null, { nome: 'Marca 2' })).rejects.toThrow(/contrato do Farol é de 1 marca/)
    // marca gravada à mão além do contrato não traz crédito
    await db.exec(`insert into marcas_farol (id, org_id, nome, atualizada_em) values ('mf-extra', 'org-farol', 'Por fora', now())`)
    const depositado = await m.farol.garantirCreditoDoFarol('org-farol')
    expect(depositado).toBe(1 * PRECOS.creditoDoFarol * 100)
    expect(await saldo('org-farol')).toBe(PRECOS.creditoDoFarol * 100)
  })

  it('CORRIGIDO: a mensalidade tem a linha do Farol, pelas marcas contratadas', async () => {
    let a = await m.assinatura.assinaturaDaEmpresa('org-farol')
    expect(a.mensal.total).toBe(PRECOS.primeiraLoja + PRECOS.farolMarca)
    expect(a.mensal).toMatchObject({ farolMarcas: 1, farol: PRECOS.farolMarca })
    // a equipe amplia o contrato para 3: a conta acompanha (497 + 2 × 297)
    await db.exec(`update orgs set farol_marcas = 3 where id = 'org-farol'`)
    a = await m.assinatura.assinaturaDaEmpresa('org-farol')
    expect(a.mensal.total).toBe(PRECOS.primeiraLoja + PRECOS.farolMarca + 2 * PRECOS.farolMarcaExtra)
  })
})

describe('Teste de 30 dias e o crédito de IA', () => {
  it('CORRIGIDO: o teste que atravessa a virada do mês recebe o crédito de conhecer UMA vez (R$ 20)', async () => {
    const set = await m.assinatura.garantirCreditoDoMes('org-teste', new Date('2026-09-20T12:00:00-03:00'))
    const out = await m.assinatura.garantirCreditoDoMes('org-teste', new Date('2026-10-05T12:00:00-03:00'))
    expect(set).toBe(PRECOS.creditoDoTeste * 100)
    expect(out).toBe(0)
    expect(await saldo('org-teste')).toBe(PRECOS.creditoDoTeste * 100)
  })

  it('CORRIGIDO: quem assina no mês em que testou tem o crédito completado até os R$ 100 do plano', async () => {
    // O teste já recebeu o crédito de conhecer deste mês.
    expect(await m.assinatura.garantirCreditoDoMes('org-paga')).toBe(PRECOS.creditoDoTeste * 100)
    // A equipe confirma o pagamento: mesmo plano, sai do TESTE para ATIVA.
    await m.assinatura.trocarPlanoComoEquipe('org-paga', 'BALCAO_AGENTE', 'Auditor')
    const [o] = (await db.query<{ situacao: string }>(`select situacao from orgs where id = 'org-paga'`)).rows
    expect(o!.situacao).toBe('ATIVA')
    expect(await saldo('org-paga')).toBe(PRECOS.creditoDoAssistente * 100)
    // E uma vez só: nem o depósito do mês nem a conversão caem de novo.
    expect(await m.assinatura.garantirCreditoDoMes('org-paga')).toBe(0)
    expect(await m.assinatura.completarCreditoDaConversao('org-paga')).toBe(0)
    expect(await saldo('org-paga')).toBe(PRECOS.creditoDoAssistente * 100)
  })

  // O script (scripts/criar-empresa.ts) não cria mais teste sem fim: --dias
  // vai de 1 a 365. A linha que já existe assim continua como está — pode ser
  // de cliente do piloto, e descer o plano dele sozinho seria pior.
  it('BUG (dado antigo): empresa em TESTE sem data de fim nunca vence — o script não cria mais, a que existe fica', async () => {
    expect(await m.assinatura.vencerTesteSeAcabou('org-eterno', new Date('2030-01-01T12:00:00Z'))).toBe(false)
    const a = await m.assinatura.assinaturaDaEmpresa('org-eterno')
    expect(a.plano).toBe('BALCAO_AGENTE')
    expect(a.situacao).toBe('TESTE')
    // o crédito de conhecer já não cai todo mês: o de agora (posto pela
    // assinatura acima) é o único do teste
    expect(await saldo('org-eterno')).toBe(PRECOS.creditoDoTeste * 100)
    expect(await m.assinatura.garantirCreditoDoMes('org-eterno', new Date('2027-03-10T12:00:00-03:00'))).toBe(0)
  })
})

describe('Lojas: a regra de ouro ("a tela diz o valor ANTES") tem porta lateral', () => {
  let depositoId = ''

  it('depósito abre sem custo (correto)', async () => {
    const r = await m.lojas.criarLoja(dono('org-loja'), { nome: 'Depósito', ehDeposito: true } as DadosLoja)
    depositoId = r.loja.id
    expect(r.custoExtra).toBe(0)
    expect((await m.assinatura.assinaturaDaEmpresa('org-loja')).mensal.total).toBe(PRECOS.primeiraLoja)
  })

  it('CORRIGIDO: desmarcar "é depósito" passa pela cota e devolve o custo da loja a mais', async () => {
    const r = await m.lojas.editarLoja(dono('org-loja'), depositoId, { nome: 'Depósito', ehDeposito: false } as DadosLoja)
    expect(r.loja.ehDeposito).toBe(false)
    expect(r.custoExtra).toBe(PRECOS.lojaExtra)
    const a = await m.assinatura.assinaturaDaEmpresa('org-loja')
    expect(a.uso.unidades).toBe(2)
    expect(a.mensal.total).toBe(PRECOS.primeiraLoja + PRECOS.lojaExtra)
  })

  it('CORRIGIDO: abrir uma fábrica devolve o custo dela (R$ 379), o mesmo que a conta soma', async () => {
    const r = await m.lojas.criarLoja(dono('org-loja'), { nome: 'Fábrica', ehFabrica: true } as DadosLoja)
    expect(r.custoExtra).toBe(PRECOS.fabrica)
    const a = await m.assinatura.assinaturaDaEmpresa('org-loja')
    expect(a.mensal.total).toBe(PRECOS.primeiraLoja + PRECOS.lojaExtra + PRECOS.fabrica)
  })

  it('CORRIGIDO: a loja que vira depósito sai do catálogo da internet', async () => {
    await db.exec(`insert into catalogos (id, org_id, unidade_id, ativo, endereco, atualizado_em) values ('cat-dep', 'org-loja', '${depositoId}', true, 'roupas-deposito', now())`)
    await m.lojas.editarLoja(dono('org-loja'), depositoId, { nome: 'Depósito', ehDeposito: true } as DadosLoja)
    const [c] = (await db.query<{ ativo: boolean }>(`select ativo from catalogos where id = 'cat-dep'`)).rows
    expect(c!.ativo).toBe(false)
  })
})

describe('Contas puras que divergem', () => {
  it('CORRIGIDO: a prévia de troca de plano conta a fábrica (e o Farol) — R$ 747, não R$ 368', () => {
    const hoje = mensalidade('BALCAO', 1, 1).total
    expect(hoje).toBe(PRECOS.primeiraLoja + PRECOS.fabrica)
    const m2 = mudanca('BALCAO', 'BALCAO_AGENTE', { unidades: 1, fabricas: 1 })
    expect(m2.novoMensal).toBe(PRECOS.primeiraLoja + PRECOS.assistente + PRECOS.fabrica)
    expect(m2.diferenca).toBe(PRECOS.assistente)
    const m3 = mudanca('BALCAO', 'BALCAO_AGENTE', { unidades: 1, fabricas: 1, farolMarcas: 2 })
    expect(m3.novoMensal).toBe(PRECOS.primeiraLoja + PRECOS.assistente + PRECOS.fabrica + PRECOS.farolMarca + PRECOS.farolMarcaExtra)
  })

  it('BUG: a calculadora arredonda o mês do anual e o total do ano deixa de ser "10 mensalidades"', () => {
    // A mesma conta de src/ui/site/Calculadora.tsx:77-78 e :119, no estado inicial (2 lojas + assistente).
    const mes = PRECOS.primeiraLoja + PRECOS.lojaExtra + PRECOS.assistente // 507
    const noAnual = Math.round((mes * PRECOS.anualPagaMeses) / 12) // 422,5 -> 423
    expect(noAnual * 12).toBe(5076)
    expect(mes * PRECOS.anualPagaMeses).toBe(5070)
    expect(mes * 12 - noAnual * 12).toBe(1008) // "economia" mostrada; a prometida é 1014
  })
})
