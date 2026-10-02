// A operação da equipe do Norte com banco de verdade (PGlite exposto numa
// porta, como em lgpd-banco.test.ts): tudo passa pelo comoOrg — papel sem
// privilégio e RLS valendo — e cada mudança deixa a linha certa no livro DA
// LOJA, assinada "Equipe Norte (<quem>)".

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  assinatura: typeof import('../src/servidor/assinatura')
  pedidos: typeof import('../src/servidor/pedidos')
  operacao: typeof import('../src/servidor/operacao')
}

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente,metas,encomenda}', 1000, now()),
    ('org-b', 'Vizinha B', 'vizinha-b', 'REDE', 'ATIVA', '{agente,crediario}', 0, now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro', now()), ('uni-a2', 'org-a', 'Bairro', now()),
    ('uni-b1', 'org-b', 'B1', now()), ('uni-b2', 'org-b', 'B2', now()),
    ('uni-b3', 'org-b', 'B3', now()), ('uni-b4', 'org-b', 'B4', now());
  insert into usuarios (id, org_id, nome, email, senha_hash, sessoes_desde, atualizado_em) values
    ('usr-ana', 'org-a', 'Ana Dona', 'ana@a.com', 'x', '2026-01-01', now()),
    ('usr-bia', 'org-b', 'Bia Dona', 'bia@b.com', 'x', '2026-01-01', now()),
    ('usr-caio', 'org-b', 'Caio Balcão', 'caio@b.com', 'x', '2026-01-01', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-ana', 'org-a', 'usr-ana', null, 'DONO'),
    ('ac-bia', 'org-b', 'usr-bia', null, 'DONO'),
    ('ac-caio', 'org-b', 'usr-caio', 'uni-b1', 'BALCAO');
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
    assinatura: await import('../src/servidor/assinatura'),
    pedidos: await import('../src/servidor/pedidos'),
    operacao: await import('../src/servidor/operacao'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows

type Livro = { acao: string; quem: string; autor: string; usuario_id: string | null; alvo_nome: string | null; motivo: string | null; antes: unknown; depois: Record<string, unknown> | null; org_id: string }
const livro = (org: string, acao: string) =>
  linhas<Livro>(`select * from auditoria where org_id = $1 and acao = $2 order by criado_em`, [org, acao])

/** O pedido como a tela grava (registrarPedido), direto no banco. */
async function pedir(org: string, acao: 'plano.pediu' | 'credito.pediu', depois: object, alvo: string) {
  await db.query(
    `insert into auditoria (id, org_id, usuario_id, quem, acao, alvo_tipo, alvo_id, alvo_nome, depois, criado_em)
     values ($1, $2, null, 'Dona', $3, 'empresa', $2, $4, $5, $6::timestamp)`,
    // O horário vai de cá, em UTC, como o Prisma grava: o `now()` do PGlite
    // sai no fuso da máquina e deixaria o pedido "antes" das trocas acima.
    [`ped-${Math.random().toString(36).slice(2)}`, org, acao, alvo, JSON.stringify(depois), new Date().toISOString()],
  )
}

const aberto = async (org: string, tipo: 'plano' | 'credito') =>
  m.pedidos.pedidoAberto(await m.pedidos.eventosDePedido(org), tipo)

describe('trocarPlanoComoEquipe', () => {
  it('atende o pedido: plano novo, linha no livro assinada pela equipe, pedido fechado', async () => {
    await pedir('org-a', 'plano.pediu', { plano: 'REDE' }, 'Direção')
    const pedido = await aberto('org-a', 'plano')
    expect(pedido).toMatchObject({ plano: 'REDE', estado: 'aberto' })

    const mud = await m.assinatura.trocarPlanoComoEquipe('org-a', 'REDE', 'Rafa Teste', { pedidoId: pedido!.id })
    expect(mud).toMatchObject({ de: 'BALCAO_AGENTE', para: 'REDE', sentido: 'subir', impedimentos: [] })

    const [org] = await linhas<{ plano: string }>(`select plano from orgs where id = 'org-a'`)
    expect(org!.plano).toBe('REDE')
    const [l] = await livro('org-a', 'plano.trocou')
    expect(l).toMatchObject({ quem: 'Equipe Norte (Rafa Teste)', autor: 'SISTEMA', usuario_id: null, alvo_nome: 'Norte sob contrato' })
    expect(l!.depois).toMatchObject({ de: 'BALCAO_AGENTE', para: 'REDE', pedidoId: pedido!.id })
    expect(await aberto('org-a', 'plano')).toBeNull()

    // a vizinha não foi tocada
    const [b] = await linhas<{ plano: string }>(`select plano from orgs where id = 'org-b'`)
    expect(b!.plano).toBe('REDE')
    expect(await livro('org-b', 'plano.trocou')).toEqual([])
  })

  it('descer tira os módulos que o plano novo não cobre', async () => {
    await m.assinatura.trocarPlanoComoEquipe('org-a', 'BALCAO', 'Rafa Teste')
    const [org] = await linhas<{ plano: string; modulos: string[] }>(`select plano, modulos from orgs where id = 'org-a'`)
    // O Norte tem tudo da loja (metas também); só o assistente sai.
    expect(org).toEqual({ plano: 'BALCAO', modulos: ['metas', 'encomenda'] })
    const todas = await livro('org-a', 'plano.trocou')
    expect(todas.at(-1)!.motivo).toMatch(/perdeu: .*Assistente no WhatsApp/)
    expect(todas.at(-1)!.depois).not.toHaveProperty('pedidoId')
  })

  it('as travas da tela valem: loja demais para o plano novo impede, e nada é gravado', async () => {
    const antes = (await livro('org-b', 'plano.trocou')).length
    // No Norte qualquer número de lojas cabe (a conta cresce); o Grátis é de uma só.
    await expect(m.assinatura.trocarPlanoComoEquipe('org-b', 'GRATIS', 'Rafa Teste')).rejects.toThrow(/unidades/)
    const [b] = await linhas<{ plano: string }>(`select plano from orgs where id = 'org-b'`)
    expect(b!.plano).toBe('REDE')
    expect((await livro('org-b', 'plano.trocou')).length).toBe(antes)
  })

  it('sem dizer quem roda, não roda', async () => {
    await expect(m.assinatura.trocarPlanoComoEquipe('org-a', 'REDE', ' ')).rejects.toThrow(/--quem/)
    const [org] = await linhas<{ plano: string }>(`select plano from orgs where id = 'org-a'`)
    expect(org!.plano).toBe('BALCAO')
  })
})

describe('crédito e recusa', () => {
  it('a recarga da equipe atende o pedido e grava recarga + livro juntos', async () => {
    await pedir('org-a', 'credito.pediu', { centavos: 20_000 }, 'R$ 200,00')
    const pedido = await aberto('org-a', 'credito')
    // A troca de plano de cima já depositou o crédito incluso do mês (é o que
    // a troca pela tela sempre fez): o saldo de partida é lido, não suposto.
    const antes = await m.operacao.saldoDeCredito('org-a')
    const r = await m.operacao.recarregarComoEquipe('org-a', 20_000, {
      tipo: 'COMPRA', motivo: 'Pix confirmado em 26/09', quem: 'Rafa Teste', pedidoId: pedido!.id,
    })
    expect(r).toEqual({ saldoAntes: antes, saldoDepois: antes + 20_000 })
    const [rec] = await linhas<{ centavos: number; saldo_depois: number; tipo: string; origem: string; quem: string; motivo: string }>(
      `select centavos, saldo_depois, tipo, origem, quem, motivo from recargas_ia where org_id = 'org-a' and tipo = 'COMPRA'`)
    expect(rec).toEqual({ centavos: 20_000, saldo_depois: antes + 20_000, tipo: 'COMPRA', origem: 'equipe', quem: 'Equipe Norte (Rafa Teste)', motivo: 'Pix confirmado em 26/09' })
    const [l] = await livro('org-a', 'credito.recarregou')
    expect(l!.depois).toMatchObject({ centavos: 20_000, pedidoId: pedido!.id, saldoDepois: antes + 20_000 })
    expect(await aberto('org-a', 'credito')).toBeNull()
  })

  it('ajuste negativo que deixaria o saldo abaixo de zero é recusado; compra negativa também', async () => {
    const saldo = await m.operacao.saldoDeCredito('org-a')
    await expect(m.operacao.recarregarComoEquipe('org-a', -(saldo + 1), { tipo: 'AJUSTE', motivo: 'correção', quem: 'Rafa' })).rejects.toThrow(/negativo/)
    await expect(m.operacao.recarregarComoEquipe('org-a', -100, { tipo: 'COMPRA', motivo: 'correção', quem: 'Rafa' })).rejects.toThrow(/AJUSTE/)
    expect(await m.operacao.saldoDeCredito('org-a')).toBe(saldo)
  })

  it('recusar grava o motivo que a loja lê, e fecha só aquele pedido', async () => {
    await pedir('org-a', 'plano.pediu', { plano: 'REDE' }, 'Direção')
    const p = await m.operacao.recusarPedido('org-a', 'plano', { motivo: 'O pagamento não foi confirmado.', quem: 'Rafa Teste' })
    const [l] = await livro('org-a', 'pedido.recusou')
    expect(l).toMatchObject({ quem: 'Equipe Norte (Rafa Teste)', autor: 'SISTEMA', motivo: 'O pagamento não foi confirmado.', alvo_nome: 'plano Norte sob contrato' })
    expect(l!.depois).toEqual({ tipo: 'plano', pedidoId: p.id })
    const tela = m.pedidos.pedidosParaTela(await m.pedidos.eventosDePedido('org-a'))
    expect(tela.plano).toMatchObject({ estado: 'recusado', motivoRecusa: 'O pagamento não foi confirmado.' })
    await expect(m.operacao.recusarPedido('org-a', 'plano', { motivo: 'de novo não', quem: 'Rafa' })).rejects.toThrow(/Não há pedido/)
  })
})

describe('acesso de SUPORTE', () => {
  type Acesso = { id: string; papel: string; unidade_id: string | null; expira_ms: number; motivo: string }
  const acessosDe = (email: string) =>
    linhas<Acesso>(
      `select a.id, a.papel, a.unidade_id, (extract(epoch from a.expira_em) * 1000)::float8 as expira_ms, a.motivo from acessos a join usuarios u on u.id = a.usuario_id
        where u.org_id = 'org-a' and u.email = $1`, [email])
  const usuario = async (email: string) =>
    (await linhas<{ id: string; nome: string; senha_hash: string | null; ativo: boolean; sessoes_ms: number }>(
      `select id, nome, senha_hash, ativo, (extract(epoch from sessoes_desde) * 1000)::float8 as sessoes_ms from usuarios where org_id = 'org-a' and email = $1`, [email]))[0]

  it('cria a conta (sem senha) e um acesso SUPORTE com prazo e motivo; o livro registra', async () => {
    const agora = new Date()
    const r = await m.operacao.concederSuporte(
      'org-a', { email: 'Rafa@UseNorte.com.br', horas: 4, motivo: 'chamado 51: conferir fechamento', quem: 'Rafa Teste' }, {}, agora)
    expect(r).toMatchObject({ criouConta: true, temSenha: false, expiravaEm: null, sessoesCortadas: false })

    const u = await usuario('rafa@usenorte.com.br')
    expect(u).toMatchObject({ nome: 'Suporte do Norte (Rafa Teste)', senha_hash: null, ativo: true })
    const [a] = await acessosDe('rafa@usenorte.com.br')
    expect(a).toMatchObject({ papel: 'SUPORTE', unidade_id: null, motivo: 'chamado 51: conferir fechamento' })
    expect(a!.expira_ms).toBe(agora.getTime() + 4 * 3_600_000)

    const [l] = await livro('org-a', 'suporte.concedeu')
    expect(l).toMatchObject({ quem: 'Equipe Norte (Rafa Teste)', autor: 'SISTEMA', alvo_nome: 'Suporte do Norte (Rafa Teste)', motivo: 'chamado 51: conferir fechamento' })
    expect(l!.depois).toMatchObject({ horas: 4, criouConta: true })

    // a conta do suporte não vira "pessoa cadastrada" da loja
    expect((await m.assinatura.assinaturaDaEmpresa('org-a')).uso.usuarios).toBe(1)
  })

  it('estender atualiza o MESMO acesso; encurtar corta as sessões abertas', async () => {
    const t = new Date()
    const r8 = await m.operacao.concederSuporte('org-a', { email: 'rafa@usenorte.com.br', horas: 8, motivo: 'chamado 51, continua', quem: 'Rafa' }, {}, t)
    expect(r8).toMatchObject({ criouConta: false, sessoesCortadas: false })
    let acessos = await acessosDe('rafa@usenorte.com.br')
    expect(acessos).toHaveLength(1)
    expect(acessos[0]!.expira_ms).toBe(t.getTime() + 8 * 3_600_000)
    expect(acessos[0]!.motivo).toBe('chamado 51, continua')

    const r1 = await m.operacao.concederSuporte('org-a', { email: 'rafa@usenorte.com.br', horas: 1, motivo: 'chamado 51, só mais uma hora', quem: 'Rafa' }, {}, t)
    expect(r1.sessoesCortadas).toBe(true)
    expect((await usuario('rafa@usenorte.com.br'))!.sessoes_ms).toBe(t.getTime())
    acessos = await acessosDe('rafa@usenorte.com.br')
    expect(acessos).toHaveLength(1)
    expect(await linhas(`select id from usuarios where email = 'rafa@usenorte.com.br'`)).toHaveLength(1)
  })

  it('não dá SUPORTE a quem é da loja, nem passa por cima da loja que desativou a conta', async () => {
    await expect(m.operacao.concederSuporte('org-a', { email: 'ana@a.com', horas: 2, motivo: 'teste de recusa', quem: 'Rafa' }))
      .rejects.toThrow(/empresa cliente/)
    expect(await acessosDe('ana@a.com')).toEqual([expect.objectContaining({ papel: 'DONO' })])

    await db.exec(`update usuarios set ativo = false where email = 'rafa@usenorte.com.br'`)
    await expect(m.operacao.concederSuporte('org-a', { email: 'rafa@usenorte.com.br', horas: 2, motivo: 'teste de recusa', quem: 'Rafa' }))
      .rejects.toThrow(/desativou/)
    await db.exec(`update usuarios set ativo = true where email = 'rafa@usenorte.com.br'`)
  })

  it('revogar: prazo vira agora, sessões cortadas, linha no livro; de novo não faz nada', async () => {
    const agora = new Date()
    expect(await m.operacao.revogarSuporte('org-a', { email: 'rafa@usenorte.com.br', quem: 'Rafa Teste' }, agora)).toEqual({ revogou: true })
    const [a] = await acessosDe('rafa@usenorte.com.br')
    expect(a!.expira_ms).toBe(agora.getTime())
    expect((await usuario('rafa@usenorte.com.br'))!.sessoes_ms).toBe(agora.getTime())
    const [l] = await livro('org-a', 'suporte.revogou')
    expect(l).toMatchObject({ quem: 'Equipe Norte (Rafa Teste)', autor: 'SISTEMA', motivo: 'Acesso de suporte encerrado.' })
    expect(await m.operacao.revogarSuporte('org-a', { email: 'rafa@usenorte.com.br', quem: 'Rafa Teste' })).toEqual({ revogou: false })
  })
})

describe('situação da empresa', () => {
  it('suspender corta a sessão de todo mundo DA EMPRESA e registra; reativar limpa a data', async () => {
    const agora = new Date()
    const r = await m.operacao.mudarSituacao('org-b', 'SUSPENSA', { motivo: 'mensalidade de agosto em aberto', quem: 'Rafa Teste' }, agora)
    expect(r).toEqual({ de: 'ATIVA', para: 'SUSPENSA', mudou: true, sessoesCortadas: 2 })
    const [b] = await linhas<{ situacao: string; suspensa_ms: number }>(
      `select situacao, (extract(epoch from suspensa_em) * 1000)::float8 as suspensa_ms from orgs where id = 'org-b'`)
    expect(b).toEqual({ situacao: 'SUSPENSA', suspensa_ms: agora.getTime() })
    const sessoes = await linhas<{ org_id: string; ms: number }>(
      `select org_id, (extract(epoch from sessoes_desde) * 1000)::float8 as ms from usuarios order by org_id`)
    for (const s of sessoes.filter((x) => x.org_id === 'org-b')) expect(s.ms).toBe(agora.getTime())
    // a loja A não foi tocada
    expect(sessoes.filter((x) => x.org_id === 'org-a' && x.ms === agora.getTime())).toEqual([])
    const [l] = await livro('org-b', 'empresa.situacao')
    expect(l).toMatchObject({ quem: 'Equipe Norte (Rafa Teste)', autor: 'SISTEMA', alvo_nome: 'SUSPENSA', antes: { situacao: 'ATIVA' } })

    expect(await m.operacao.mudarSituacao('org-b', 'SUSPENSA', { motivo: 'de novo, igual', quem: 'Rafa' })).toMatchObject({ mudou: false })
    await m.operacao.mudarSituacao('org-b', 'ATIVA', { motivo: 'pagamento confirmado', quem: 'Rafa Teste' })
    const [b2] = await linhas<{ situacao: string; suspensa_em: Date | null }>(`select situacao, suspensa_em from orgs where id = 'org-b'`)
    expect(b2).toEqual({ situacao: 'ATIVA', suspensa_em: null })
  })
})

