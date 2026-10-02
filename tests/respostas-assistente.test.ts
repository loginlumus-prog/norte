// As respostas do assistente: a unidade que o plano vende (02/10/2026).
//
// O que está provado aqui:
//   • a conta é pura e fecha: franquia + pacotes − usadas; acabou e "baixo"
//   • os tetos de IA saem do preço (70% de R$ 149 por 1.000 respostas)
//   • conta só a mensagem marcada `resposta_ia` — relatório, aviso e recado
//     não contam
//   • o mês é o de calendário em São Paulo: vira no dia 1º, e o pacote vale
//     só para o mês em que entrou
//   • acabou a franquia, o assistente para com o recado em respostas; um
//     pacote destrava; a trava de dinheiro segura antes quando é ela que acaba
//   • no teste, a franquia é a do teste inteiro
//   • de ponta a ponta: a resposta da IA é marcada, o atalho não, e a
//     resposta que cruza os 10% avisa no fim
//
// Banco de verdade (PGlite numa porta, como assistente-fluxo.test.ts).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import {
  PRECOS,
  TETO_IA_DO_MES_CENT,
  TETO_IA_DO_PACOTE_CENT,
  TETO_IA_DO_TESTE_CENT,
  PARCELA_MAX_DE_IA,
} from '../src/servidor/planos'
import { MARGEM } from '../src/servidor/custo-ia'

vi.hoisted(() => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste'
  delete process.env.NORTE_ASSINATURA_LIVRE
})

// As campanhas não são daqui: cliente nenhum entra nelas neste arquivo.
vi.mock('../src/servidor/campanhas/entrada', () => ({
  receberDeCliente: async () => ({ tratou: false }),
  testeVivo: async () => false,
}))

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  assinatura: typeof import('../src/servidor/assinatura')
  agente: typeof import('../src/servidor/agente')
  conversa: typeof import('../src/servidor/assistente/conversa')
  canal: typeof import('../src/servidor/assistente/canal')
}

// O "agora" dos testes de mês: meio de outubro em São Paulo.
const OUT_20 = new Date('2026-10-20T12:00:00-03:00')
const NOV_02 = new Date('2026-11-02T12:00:00-03:00')

const DONA = '5571999990001'

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, teste_ate, criada_em, atualizada_em) values
    ('org-r', 'Loja R', 'loja-r', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 0, null, now() - interval '1 year', now()),
    ('org-x', 'Loja X', 'loja-x', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 0, null, now() - interval '1 year', now()),
    ('org-t', 'Loja T', 'loja-t', 'BALCAO_AGENTE', 'TESTE', '{agente}', 0, now() + interval '20 days', now() - interval '10 days', now()),
    ('org-s', 'Loja S', 'loja-s', 'BALCAO', 'ATIVA', '{}', 0, null, now() - interval '1 year', now()),
    ('org-e', 'Loja E', 'loja-e', 'BALCAO_AGENTE', 'ATIVA', '{agente}', 0, null, now() - interval '1 year', now());

  insert into unidades (id, org_id, nome, atualizada_em) values
    ('u-r', 'org-r', 'Centro', now()), ('u-x', 'org-x', 'Centro', now()),
    ('u-t', 'org-t', 'Centro', now()), ('u-s', 'org-s', 'Centro', now()),
    ('u-e', 'org-e', 'Centro', now());

  insert into usuarios (id, org_id, nome, email, telefone, telefone_confirmado, telefone_confirmado_em, atualizado_em) values
    ('usr-e', 'org-e', 'Dona E', 'dona@e.com', '(71) 99999-0001', '7199990001', now(), now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-e', 'org-e', 'usr-e', null, 'DONO');

  insert into agentes (id, org_id, nome, ativo, canal, poderes, valor_max_cent, gasto_dia_cent, mensagens_dia, atualizado_em) values
    ('ag-r', 'org-r', 'Rô', true, 'ZAPI', '{ver.resumo}', 100000, 1000000, 100000, now()),
    ('ag-x', 'org-x', 'Xis', true, 'ZAPI', '{ver.resumo}', 100000, 1000000, 100000, now()),
    ('ag-t', 'org-t', 'Tê', true, 'ZAPI', '{ver.resumo}', 100000, 1000000, 100000, now()),
    ('ag-e', 'org-e', 'Ê', true, 'ZAPI', '{ver.resumo}', 100000, 1000000, 100000, now());

  insert into conversas_agente (id, org_id, agente_id, telefone, da_equipe) values
    ('cv-r', 'org-r', 'ag-r', '5571900000001', true),
    ('cv-x', 'org-x', 'ag-x', '5571900000002', true),
    ('cv-t', 'org-t', 'ag-t', '5571900000003', true),
    ('cv-e-outra', 'org-e', 'ag-e', '5571900000004', true);
`

beforeAll(async () => {
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 50000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    banco: await import('../src/servidor/banco'),
    assinatura: await import('../src/servidor/assinatura'),
    agente: await import('../src/servidor/agente'),
    conversa: await import('../src/servidor/assistente/conversa'),
    canal: await import('../src/servidor/assistente/canal'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

let seq = 0
/** `n` mensagens do assistente numa conversa, no instante dado (UTC no banco). */
async function mensagens(orgId: string, conversaId: string, n: number, quando: Date, respostaIa = true) {
  const base = `${orgId}-${++seq}`
  await db.query(
    `insert into mensagens_agente (id, org_id, conversa_id, de, texto, resposta_ia, criada_em)
     select $1 || '-' || g, $2, $3, 'AGENTE', 'resposta', $4, $5::timestamp
       from generate_series(1, $6::int) g`,
    [base, orgId, conversaId, respostaIa, quando.toISOString().replace('T', ' ').replace('Z', ''), n],
  )
}

const saldo = async (orgId: string) =>
  (await db.query<{ credito_ia_cent: number }>(`select credito_ia_cent from orgs where id = $1`, [orgId])).rows[0]!.credito_ia_cent

// ─────────────────────────────────────────────────────────────
// A CONTA, PURA
// ─────────────────────────────────────────────────────────────

describe('a conta das respostas', () => {
  it('franquia + pacotes − usadas, e o "baixo" nos últimos 10%', () => {
    const { contaDeRespostas } = m.assinatura
    expect(contaDeRespostas(1000, 0, 0)).toMatchObject({ total: 1000, restam: 1000, acabou: false, baixo: false })
    expect(contaDeRespostas(1000, 0, 900)).toMatchObject({ restam: 100, baixo: true, acabou: false })
    expect(contaDeRespostas(1000, 0, 899)).toMatchObject({ restam: 101, baixo: false })
    expect(contaDeRespostas(1000, 0, 1000)).toMatchObject({ restam: 0, acabou: true, baixo: false })
    // Passar do total (a resposta que já estava a caminho) não vira negativo.
    expect(contaDeRespostas(1000, 0, 1003)).toMatchObject({ restam: 0, acabou: true })
    // O pacote soma ao total do mês.
    expect(contaDeRespostas(1000, 2, 1000)).toMatchObject({ total: 2000, restam: 1000, acabou: false })
    // Sem assistente não "acaba" nada; no contrato não há número.
    expect(contaDeRespostas(0, 0, 0)).toMatchObject({ total: 0, acabou: false })
    expect(contaDeRespostas(null, 0, 50)).toMatchObject({ total: null, restam: null, acabou: false })
  })

  it('a franquia vem do plano, e no teste é a do teste', () => {
    const { franquiaDeRespostas } = m.assinatura
    expect(franquiaDeRespostas('BALCAO_AGENTE', 'ATIVA')).toBe(PRECOS.respostasDoAssistente)
    expect(franquiaDeRespostas('BALCAO_AGENTE', 'TESTE')).toBe(PRECOS.respostasDoTeste)
    expect(franquiaDeRespostas('REDE', 'ATIVA')).toBe(PRECOS.respostasDoAssistente)
    expect(franquiaDeRespostas('BALCAO', 'ATIVA')).toBe(0)
    expect(franquiaDeRespostas('GRATIS', 'ATIVA')).toBe(0)
    expect(franquiaDeRespostas('CORPORATIVO', 'ATIVA')).toBeNull()
  })

  it('o aviso sai uma vez nos 10% e uma vez na última', () => {
    const { avisoDeRespostas } = m.assinatura
    expect(avisoDeRespostas(100, 1000, 'mes')).toBe('Faltam 100 respostas este mês.')
    expect(avisoDeRespostas(99, 1000, 'mes')).toBeNull()
    expect(avisoDeRespostas(101, 1000, 'mes')).toBeNull()
    expect(avisoDeRespostas(0, 1000, 'mes')).toMatch(/última resposta do mês.*\+500.*dia 1º/)
    expect(avisoDeRespostas(20, 200, 'teste')).toBe('Faltam 20 respostas no teste.')
    expect(avisoDeRespostas(0, 200, 'teste')).toMatch(/última resposta do teste.*assine/)
    expect(avisoDeRespostas(null, null, 'mes')).toBeNull()
  })

  it('os tetos de IA saem do preço: 70% de R$ 149 para 1.000 respostas, a mesma régua no pacote e no teste', () => {
    expect(TETO_IA_DO_MES_CENT).toBe(Math.round(PRECOS.assistente * PARCELA_MAX_DE_IA * MARGEM * 100))
    expect(TETO_IA_DO_MES_CENT).toBe(31290)
    expect(TETO_IA_DO_PACOTE_CENT).toBe(Math.round(TETO_IA_DO_MES_CENT / 2))
    expect(TETO_IA_DO_TESTE_CENT).toBe(Math.round((TETO_IA_DO_MES_CENT * 200) / 1000))
    // No pior caso o custo de IA do mês (teto ÷ MARGEM) fica abaixo do que o assistente cobra.
    expect(TETO_IA_DO_MES_CENT / MARGEM / 100).toBeLessThan(PRECOS.assistente)
  })

  it('o mês vira no dia 1º de São Paulo, também na virada do ano', () => {
    const { mesEmSP, inicioDoMesEmSP, proximoMesEmSP } = m.assinatura
    // 31/10 às 23h30 em SP já é 1º/11 em UTC — e ainda é outubro na loja.
    const quase = new Date('2026-10-31T23:30:00-03:00')
    expect(mesEmSP(quase)).toBe('2026-10')
    expect(inicioDoMesEmSP(quase).toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(proximoMesEmSP(quase).toISOString()).toBe('2026-11-01T03:00:00.000Z')
    expect(proximoMesEmSP(new Date('2026-12-15T12:00:00-03:00')).toISOString()).toBe('2027-01-01T03:00:00.000Z')
    expect(proximoMesEmSP(new Date('2027-01-31T12:00:00-03:00')).toISOString()).toBe('2027-02-01T03:00:00.000Z')
  })
})

// ─────────────────────────────────────────────────────────────
// NO BANCO
// ─────────────────────────────────────────────────────────────

describe('o que conta, e o mês que vira', () => {
  it('conta só a resposta da IA, e só a deste mês', async () => {
    // outubro: 3 respostas da IA e 2 mensagens fixas (relatório, aviso)
    await mensagens('org-r', 'cv-r', 3, new Date('2026-10-15T10:00:00-03:00'))
    await mensagens('org-r', 'cv-r', 2, new Date('2026-10-15T10:00:00-03:00'), false)
    // setembro: 4 respostas, que não são deste mês
    await mensagens('org-r', 'cv-r', 4, new Date('2026-09-28T10:00:00-03:00'))
    // 30/09 às 23h em SP (já 1º/10 em UTC): ainda é setembro na loja
    await mensagens('org-r', 'cv-r', 1, new Date('2026-09-30T23:00:00-03:00'))

    const r = await m.assinatura.respostasDoMes('org-r', OUT_20)
    expect(r).toMatchObject({ incluidas: 1000, pacotes: 0, total: 1000, usadas: 3, restam: 997, periodo: 'mes' })
    expect(r.renovaEm?.toISOString()).toBe('2026-11-01T03:00:00.000Z')
  })

  it('no dia 1º a franquia volta inteira', async () => {
    const r = await m.assinatura.respostasDoMes('org-r', NOV_02)
    expect(r).toMatchObject({ usadas: 0, restam: 1000, total: 1000 })
  })

  it('o pacote soma +500 ao mês em que entra, põe o teto dele na carteira, e não passa para o mês seguinte', async () => {
    const antes = await saldo('org-r')
    const r = await m.assinatura.adicionarPacoteDeRespostas('org-r', { quem: 'Equipe Norte (Teste)', autor: 'SISTEMA' }, OUT_20)
    expect(r).toMatchObject({ pacotes: 1, total: 1500, restam: 1497 })
    // O teto de outubro caiu antes (a carteira estava em zero), e o do pacote por cima.
    expect(await saldo('org-r')).toBe(antes + TETO_IA_DO_MES_CENT + TETO_IA_DO_PACOTE_CENT)
    // Novembro: o pacote ficou em outubro.
    expect(await m.assinatura.respostasDoMes('org-r', NOV_02)).toMatchObject({ pacotes: 0, total: 1000 })
    // No livro, com o que a equipe precisa para fechar o pedido.
    const livro = await db.query<{ acao: string; depois: { respostas: number; mes: string } }>(
      `select acao, depois from auditoria where org_id = 'org-r' and acao = 'respostas.adicionou'`,
    )
    expect(livro.rows).toHaveLength(1)
    expect(livro.rows[0]!.depois).toMatchObject({ respostas: 500, mes: '2026-10' })
  })

  it('sem o assistente, não há pacote', async () => {
    await expect(
      m.assinatura.adicionarPacoteDeRespostas('org-s', { quem: 'Equipe Norte (Teste)', autor: 'SISTEMA' }, OUT_20),
    ).rejects.toThrow(/assistente ligado/)
  })

  it('a carteira é COMPLETADA até o teto no mês, não somada: sobra não vira poupança', async () => {
    // org-r já tem outubro. Em novembro, com saldo acima do teto, nada cai —
    // mas o recibo do mês fica, para o meio do mês não completar de novo.
    const antes = await saldo('org-r')
    expect(antes).toBeGreaterThan(TETO_IA_DO_MES_CENT)
    expect(await m.assinatura.garantirCreditoDoMes('org-r', NOV_02)).toBe(0)
    expect(await saldo('org-r')).toBe(antes)
    await db.exec(`update orgs set credito_ia_cent = 100 where id = 'org-r'`)
    expect(await m.assinatura.garantirCreditoDoMes('org-r', NOV_02)).toBe(0)
    // Dezembro completa do que sobrou até o teto: 100 + (teto − 100).
    expect(await m.assinatura.garantirCreditoDoMes('org-r', new Date('2026-12-03T12:00:00-03:00'))).toBe(TETO_IA_DO_MES_CENT - 100)
    expect(await saldo('org-r')).toBe(TETO_IA_DO_MES_CENT)
  })
})

describe('a trava', () => {
  // Respostas no mês de HOJE: `podeGastarHoje` também lê o plano pelo relógio de agora.
  const agora = new Date()

  it('acabou a franquia: para, com o recado em respostas; o pacote destrava', async () => {
    await mensagens('org-x', 'cv-x', PRECOS.respostasDoAssistente, agora)
    const v = await m.agente.podeGastarHoje('org-x', agora)
    expect(v.pode).toBe(false)
    expect(v.motivo).toBe('sem_respostas')
    expect(v.recado).toBe(
      'As respostas do mês acabaram — compre um pacote de +500 em Assinatura ou espere o dia 1º.',
    )
    // A carteira tem dinheiro: quem parou foi a franquia.
    expect(v.saldoCent).toBeGreaterThan(0)

    const a = await m.assinatura.assinaturaDaEmpresa('org-x', agora)
    expect(a.respostas.acabou).toBe(true)
    expect(a.alertas.some((al) => al.nivel === 'critico' && /respostas do mês acabaram/.test(al.texto))).toBe(true)

    await m.assinatura.adicionarPacoteDeRespostas('org-x', { quem: 'Equipe Norte (Teste)', autor: 'SISTEMA' }, agora)
    const depois = await m.agente.podeGastarHoje('org-x', agora)
    expect(depois.pode).toBe(true)
    expect(depois.respostas).toMatchObject({ total: 1500, restam: 500 })
  })

  it('a carteira acabou antes da franquia: para pela trava de custo, dizendo limite de uso', async () => {
    await db.exec(`update orgs set credito_ia_cent = 0 where id = 'org-x'`)
    const v = await m.agente.podeGastarHoje('org-x', agora)
    expect(v.motivo).toBe('sem_credito')
    expect(v.recado).toMatch(/limite de uso deste mês/)
    const a = await m.assinatura.assinaturaDaEmpresa('org-x', agora)
    expect(a.credito.travou).toBe(true)
    expect(a.alertas.some((al) => /limite de uso/.test(al.texto))).toBe(true)
  })

  it('no teste, a franquia é a do teste inteiro (contada desde o cadastro)', async () => {
    await mensagens('org-t', 'cv-t', 150, new Date(agora.getTime() - 5 * 864e5))
    const r = await m.assinatura.respostasDoMes('org-t', agora)
    expect(r).toMatchObject({ periodo: 'teste', total: PRECOS.respostasDoTeste, usadas: 150, restam: 50, renovaEm: null })
    await mensagens('org-t', 'cv-t', 50, agora)
    const v = await m.agente.podeGastarHoje('org-t', agora)
    expect(v.motivo).toBe('sem_respostas')
    expect(v.recado).toMatch(/respostas do teste acabaram.*assine/)
  })

  it('sem o assistente a franquia é zero, e zero não "acaba"', async () => {
    const s = await m.assinatura.respostasDoMes('org-s', agora)
    expect(s).toMatchObject({ incluidas: 0, total: 0, acabou: false, baixo: false })
  })
})

// ─────────────────────────────────────────────────────────────
// DE PONTA A PONTA
// ─────────────────────────────────────────────────────────────

const USO = { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 }
const apiQueDiz = (texto: string) => {
  let chamadas = 0
  const buscar = (async () => {
    chamadas++
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage: USO }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return { buscar, chamadas: () => chamadas }
}

describe('de ponta a ponta, pelo WhatsApp', () => {
  const marcadas = async () =>
    Number((await db.query<{ n: string }>(`select count(*) n from mensagens_agente where org_id = 'org-e' and resposta_ia`)).rows[0]!.n)

  it('a resposta da IA conta uma; a que cruza os 10% avisa no fim', async () => {
    // 899 já usadas este mês (noutra conversa): esta resposta é a 900ª, e
    // depois dela faltam 100 — os 10%.
    await mensagens('org-e', 'cv-e-outra', 899, new Date())
    const canal = new m.canal.CanalFalso()
    const api = apiQueDiz('Ontem a loja vendeu R$ 300.')
    const r = await m.conversa.processarMensagem(
      { orgId: 'org-e', telefone: DONA, nome: null, texto: 'quanto vendi ontem?', idExterno: 'E1' },
      { canal, buscar: api.buscar },
    )
    expect(r).toMatchObject({ tipo: 'respondida', enviada: true })
    expect(api.chamadas()).toBe(1)
    expect(await marcadas()).toBe(900)
    const saiu = canal.enviadas.at(-1)!.texto
    expect(saiu).toContain('Ontem a loja vendeu R$ 300.')
    expect(saiu).toContain('Faltam 100 respostas este mês.')

    // A próxima não repete o aviso.
    await m.conversa.processarMensagem(
      { orgId: 'org-e', telefone: DONA, nome: null, texto: 'e hoje?', idExterno: 'E2' },
      { canal, buscar: api.buscar },
    )
    expect(await marcadas()).toBe(901)
    expect(canal.enviadas.at(-1)!.texto).not.toContain('Faltam')
  })

  it('o recado de recusa não conta como resposta, e a IA nem é chamada', async () => {
    await db.exec(`update orgs set credito_ia_cent = 0 where id = 'org-e'`)
    const canal = new m.canal.CanalFalso()
    const api = apiQueDiz('não deveria ser chamado')
    const antes = await marcadas()
    const r = await m.conversa.processarMensagem(
      { orgId: 'org-e', telefone: DONA, nome: null, texto: 'como foi o dia?', idExterno: 'E3' },
      { canal, buscar: api.buscar },
    )
    expect(r).toEqual({ tipo: 'recusada', motivo: 'sem_credito' })
    expect(api.chamadas()).toBe(0)
    expect(await marcadas()).toBe(antes)
  })
})

// ─────────────────────────────────────────────────────────────
// O PEDIDO DE PACOTE
// ─────────────────────────────────────────────────────────────

describe('o pedido de pacote, no livro', () => {
  const ev = (id: string, acao: string, min: number, depois: unknown = null) => ({
    id, acao, criadoEm: new Date(Date.UTC(2026, 9, 10, 12, min)), alvoNome: null, motivo: null, depois,
  })

  it('abre com o que foi pedido, e o pacote que entra depois atende', async () => {
    const { lerPedidos } = await import('../src/servidor/pedidos')
    const [p] = lerPedidos([
      ev('p1', 'respostas.pediu', 0, { respostas: 500, preco: 49 }),
      ev('a1', 'respostas.adicionou', 5, { pedidoId: 'p1', respostas: 500 }),
    ])
    expect(p).toMatchObject({ tipo: 'respostas', oQue: 'pacote de +500 respostas', estado: 'atendido' })
  })

  it('a recusa da equipe fecha o pedido de pacote, e não mexe no de plano', async () => {
    const { lerPedidos } = await import('../src/servidor/pedidos')
    const todos = lerPedidos([
      ev('p1', 'respostas.pediu', 0),
      ev('p2', 'plano.pediu', 1, { plano: 'BALCAO_AGENTE' }),
      ev('r1', 'pedido.recusou', 2, { tipo: 'respostas', pedidoId: 'p1' }),
    ])
    expect(todos.find((x) => x.id === 'p1')!.estado).toBe('recusado')
    expect(todos.find((x) => x.id === 'p2')!.estado).toBe('aberto')
  })

  it('um pacote que entrou não fecha um pedido antigo de crédito em reais', async () => {
    const { lerPedidos } = await import('../src/servidor/pedidos')
    const [c] = lerPedidos([
      ev('c1', 'credito.pediu', 0, { centavos: 20000 }),
      ev('a1', 'respostas.adicionou', 5, { respostas: 500 }),
    ])
    expect(c!.estado).toBe('aberto')
  })
})
