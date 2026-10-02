// O PIN de quem vendeu, em toda venda (Org.pinEmTodaVenda), com banco de verdade.
//
// O PIN é a confirmação (nada é gravado sem ele) e a assinatura (a venda vai
// para o nome de quem digitou, mesmo no tablet logado numa conta só). Ninguém
// fica preso: quem está na conta aberta e não tem PIN confirma sem ele; o
// freio travado deixa registrar no nome da conta aberta, marcado; e sem
// internet a venda que já aconteceu nunca é recusada — fica para conferir.
// E o convite já cria o PIN, no mesmo passo da senha.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  venda: typeof import('../src/servidor/venda')
  autorizacao: typeof import('../src/servidor/autorizacao')
  convite: typeof import('../src/servidor/convite')
  senha: typeof import('../src/servidor/senha')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, papel: Papel, unidadeId: string | null): Sessao => ({
  orgId: 'org-v',
  usuarioId,
  nome,
  acessos: [{ papel, unidadeId, expiraEm: null }],
})
/** A conta do tablet do balcão, logada o dia todo. */
const CAIXA = sessao('usr-cx', 'Tablet do Caixa', 'BALCAO', 'u-1')
const ANA = sessao('usr-ana', 'Ana Vendedora', 'BALCAO', 'u-1')
const BIA = sessao('usr-bia', 'Bia Praia', 'BALCAO', 'u-2')
const NOVA = sessao('usr-nova', 'Nova Sem Pin', 'BALCAO', 'u-1')
const DONA = sessao('usr-dona', 'Dona', 'DONO', null)

const SENHA = 'senha-boa-123'
const PIN = { caixa: '4826', ana: '7395', bia: '6142' }

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, desconto_maximo, atualizada_em, configurada_em) values
    ('org-v', 'Loja V', 'loja-v', 'REDE', 'ATIVA', '{multiUnidade,metas}', 10, now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('u-1', 'org-v', 'Centro', now()), ('u-2', 'org-v', 'Praia', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-cx', 'org-v', 'Tablet do Caixa', 'cx@v.com', now()),
    ('usr-ana', 'org-v', 'Ana Vendedora', 'ana@v.com', now()),
    ('usr-bia', 'org-v', 'Bia Praia', 'bia@v.com', now()),
    ('usr-nova', 'org-v', 'Nova Sem Pin', 'nova@v.com', now()),
    ('usr-dona', 'org-v', 'Dona', 'dona@v.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('a-cx', 'org-v', 'usr-cx', 'u-1', 'BALCAO'),
    ('a-ana', 'org-v', 'usr-ana', 'u-1', 'BALCAO'),
    ('a-bia', 'org-v', 'usr-bia', 'u-2', 'BALCAO'),
    ('a-nova', 'org-v', 'usr-nova', 'u-1', 'BALCAO'),
    ('a-dona', 'org-v', 'usr-dona', null, 'DONO');
  insert into produtos (id, org_id, nome, medida, preco_vista, ativo, atualizado_em) values
    ('p-1', 'org-v', 'Camiseta', 'UN', 50.00, true, now());
  insert into variacoes (id, org_id, produto_id, codigo, ativa) values ('v-1', 'org-v', 'p-1', 'CAM001', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('e-1', 'org-v', 'v-1', 'u-1', 1000, now());
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values ('cx-1', 'org-v', 'u-1', 'Tablet do Caixa', 50);
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 46000 + Math.floor(Math.random() * 2000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    venda: await import('../src/servidor/venda'),
    autorizacao: await import('../src/servidor/autorizacao'),
    convite: await import('../src/servidor/convite'),
    senha: await import('../src/servidor/senha'),
    banco: await import('../src/servidor/banco'),
  }
  await db.query(`update usuarios set senha_hash = $1`, [await m.senha.guardarSenha(SENHA)])
  for (const [s, pin] of [[CAIXA, PIN.caixa], [ANA, PIN.ana], [BIA, PIN.bia]] as const) {
    expect(await m.autorizacao.definirMeuPin(s, SENHA, pin)).toEqual({ ok: true })
  }
}, 90_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

// Cada teste começa com o freio zerado.
beforeEach(async () => {
  await db.exec(`delete from tentativas_login`)
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const quantasVendas = async () => (await linhas<{ n: number }>(`select count(*)::int n from vendas`))[0]!.n

type Extra = Partial<Parameters<typeof import('../src/servidor/venda').registrarVenda>[1]>
const vender = (s: Sessao, extra: Extra = {}) =>
  m.venda.registrarVenda(s, {
    unidadeId: 'u-1',
    caixaId: 'cx-1',
    itens: [{ variacaoId: 'v-1', quantidade: 1 }],
    pagamentos: [{ forma: 'PIX', valor: 50 }],
    ...extra,
  })

/** A venda e o livro dela. */
async function gravada(vendaId: string) {
  const [v] = await linhas<{ vendedor_id: string; vendedor_nome: string }>(
    `select vendedor_id, vendedor_nome from vendas where id = $1`,
    [vendaId],
  )
  const [a] = await linhas<{ motivo: string | null; depois: { assinatura?: { como: string; por: string; conferir: boolean } } | null }>(
    `select motivo, depois from auditoria where acao = 'venda.registrou' and alvo_id = $1`,
    [vendaId],
  )
  return { ...v!, motivo: a!.motivo, assinatura: a!.depois?.assinatura }
}

describe('a empresa pede o PIN em toda venda (o padrão)', () => {
  it('nasce ligado, inclusive para quem já existia', async () => {
    expect(await m.autorizacao.pedePinNaVenda('org-v')).toBe(true)
  })

  it('sem o PIN, nada é gravado — o toque sem querer não vira venda', async () => {
    const antes = await quantasVendas()
    const r = await vender(CAIXA)
    expect(r).toMatchObject({ ok: false, motivo: 'assinatura_pedida' })
    expect(await quantasVendas()).toBe(antes)
  })

  it('PIN errado é recusado com uma frase clara, e nada é gravado', async () => {
    const antes = await quantasVendas()
    const r = await vender(CAIXA, { assinatura: { pin: '9157' } })
    expect(r).toMatchObject({ ok: false, motivo: 'assinatura_pedida', recado: /não confere/ })
    expect(await quantasVendas()).toBe(antes)
  })

  it('o PIN da conta aberta confirma, e a venda fica no nome dela, assinada no livro', async () => {
    const r = await vender(CAIXA, { assinatura: { pin: PIN.caixa } })
    expect(r).toMatchObject({ ok: true, vendedor: 'Tablet do Caixa' })
    if (!r.ok) return
    const g = await gravada(r.vendaId)
    expect(g.vendedor_id).toBe('usr-cx')
    expect(g.assinatura).toMatchObject({ como: 'pin', por: 'Tablet do Caixa', conferir: false })
  })

  it('no tablet dividido, o PIN da Ana põe a venda no nome da Ana — o vendedor escolhido na tela não manda', async () => {
    const r = await vender(CAIXA, { assinatura: { pin: PIN.ana }, vendedorId: 'usr-nova' })
    expect(r).toMatchObject({ ok: true, vendedor: 'Ana Vendedora' })
    if (!r.ok) return
    const g = await gravada(r.vendaId)
    expect(g.vendedor_id).toBe('usr-ana')
    expect(g.vendedor_nome).toBe('Ana Vendedora')
    expect(g.motivo).toMatch(/assinada com o PIN de Ana Vendedora/)
  })

  it('o PIN de quem não vende NESTA loja não assina (a Bia é da Praia)', async () => {
    const r = await vender(CAIXA, { assinatura: { pin: PIN.bia } })
    expect(r).toMatchObject({ ok: false, motivo: 'assinatura_pedida' })
  })

  it('PIN de formato errado não gasta tentativa', async () => {
    for (let i = 0; i < 8; i++) expect(await vender(CAIXA, { assinatura: { pin: '12' } })).toMatchObject({ ok: false, motivo: 'assinatura_pedida' })
    expect((await linhas<{ n: number }>(`select count(*)::int n from tentativas_login`))[0]!.n).toBe(0)
  })

  it('quem está na conta aberta e ainda não criou o PIN confirma sem ele, no próprio nome', async () => {
    const r = await vender(NOVA)
    expect(r).toMatchObject({ ok: true, vendedor: 'Nova Sem Pin' })
    if (!r.ok) return
    const g = await gravada(r.vendaId)
    expect(g.vendedor_id).toBe('usr-nova')
    expect(g.assinatura).toMatchObject({ como: 'sem_pin', conferir: false })
  })
})

describe('o freio', () => {
  it('cinco erros travam o aparelho — nem o PIN certo passa; o acerto antes zera a conta', async () => {
    // Erro de dedo e acerto em seguida: a conta do aparelho zera.
    for (let i = 0; i < 4; i++) expect((await vender(CAIXA, { assinatura: { pin: `91${50 + i}` } })).ok).toBe(false)
    expect((await vender(CAIXA, { assinatura: { pin: PIN.caixa } })).ok).toBe(true)
    for (let i = 0; i < 4; i++) expect((await vender(CAIXA, { assinatura: { pin: `91${60 + i}` } })).ok).toBe(false)
    expect((await vender(CAIXA, { assinatura: { pin: PIN.caixa } })).ok).toBe(true)

    for (let i = 0; i < 5; i++) expect((await vender(CAIXA, { assinatura: { pin: `92${10 + i}` } })).ok).toBe(false)
    const travado = await vender(CAIXA, { assinatura: { pin: PIN.caixa } })
    expect(travado).toMatchObject({ ok: false, motivo: 'assinatura_pedida', travado: true, recado: /muitas vezes.*Espere/ })
  })

  it('travado de verdade, a venda pode ir no nome da conta aberta — marcada para conferir', async () => {
    for (let i = 0; i < 5; i++) await vender(CAIXA, { assinatura: { pin: `93${10 + i}` } })
    const r = await vender(CAIXA, { assinatura: { travado: true } })
    expect(r).toMatchObject({ ok: true, vendedor: 'Tablet do Caixa' })
    if (!r.ok) return
    const g = await gravada(r.vendaId)
    expect(g.assinatura).toMatchObject({ como: 'travado', conferir: true })
    expect(g.motivo).toMatch(/conferir assinatura/)
  })

  it('"travado" sem trava de verdade é recusado: não é atalho para pular o PIN', async () => {
    const r = await vender(CAIXA, { assinatura: { travado: true } })
    expect(r).toMatchObject({ ok: false, motivo: 'assinatura_pedida' })
  })

  it('a conta da LOJA: os erros de todos os aparelhos somam, e o acerto não zera', async () => {
    // Quatro erros em cada um de três aparelhos (sem travar nenhum) + o acerto
    // no meio: a loja passa de dez e trava para todo mundo.
    for (const s of [CAIXA, ANA, NOVA]) {
      for (let i = 0; i < 4; i++) await vender(s, { assinatura: { pin: `94${10 + i}` } })
      if (s === CAIXA) expect((await vender(CAIXA, { assinatura: { pin: PIN.caixa } })).ok).toBe(true)
    }
    const r = await vender(ANA, { assinatura: { pin: PIN.ana } })
    expect(r).toMatchObject({ ok: false, motivo: 'assinatura_pedida', travado: true, recado: /nesta loja/ })
  })

  it('o erro de dedo de quem vende não trava a autorização da gerente (contas separadas)', async () => {
    for (let i = 0; i < 5; i++) await vender(CAIXA, { assinatura: { pin: `95${10 + i}` } })
    const r = await m.autorizacao.autorizarComPin({
      orgId: 'org-v', unidadeId: 'u-1', pin: '5555', capacidade: 'venda.desconto', motivo: 't',
      quemPediu: { usuarioId: 'usr-cx', nome: 'Tablet do Caixa' },
    })
    // Recusada pelo PIN (ninguém com venda.desconto tem esse), não pela trava.
    expect(r).toMatchObject({ ok: false, erro: /não confere/ })
  })
})

describe('sem internet', () => {
  const offline = { quando: new Date(Date.now() - 5 * 60_000) }

  it('o PIN que subiu com a venda confere, e a venda vai para quem digitou', async () => {
    const r = await vender(CAIXA, { offline, chave: 'off-pin-0001', assinatura: { pin: PIN.ana } })
    expect(r).toMatchObject({ ok: true, vendedor: 'Ana Vendedora' })
    if (!r.ok) return
    expect((await gravada(r.vendaId)).assinatura).toMatchObject({ como: 'pin', conferir: false })
  })

  it('sem PIN (a página fechou antes de subir): a venda que já aconteceu entra, no nome da conta aberta, para conferir', async () => {
    const r = await vender(CAIXA, { offline, chave: 'off-sem-0002' })
    expect(r).toMatchObject({ ok: true, vendedor: 'Tablet do Caixa' })
    if (!r.ok) return
    const g = await gravada(r.vendaId)
    expect(g.assinatura).toMatchObject({ como: 'sem_internet', conferir: true })
    expect(g.motivo).toMatch(/conferir assinatura/)
  })

  it('PIN que não confere não recusa a venda já feita: marca para conferir', async () => {
    const r = await vender(CAIXA, { offline, chave: 'off-err-0003', assinatura: { pin: '9871' } })
    expect(r).toMatchObject({ ok: true, vendedor: 'Tablet do Caixa' })
    if (!r.ok) return
    expect((await gravada(r.vendaId)).assinatura).toMatchObject({ como: 'pin_nao_conferiu', conferir: true })
  })
})

describe('desligado, a venda é a de antes', () => {
  it('sem PIN, no nome escolhido como vendedor', async () => {
    await db.exec(`update orgs set pin_em_toda_venda = false where id = 'org-v'`)
    try {
      const r = await vender(CAIXA, { vendedorId: 'usr-ana' })
      expect(r).toMatchObject({ ok: true })
      if (!r.ok) return
      const g = await gravada(r.vendaId)
      expect(g.vendedor_id).toBe('usr-ana')
      expect(g.assinatura).toBeUndefined()
    } finally {
      await db.exec(`update orgs set pin_em_toda_venda = true where id = 'org-v'`)
    }
  })

  it('a chave muda pelo dono, e fica no livro', async () => {
    await m.autorizacao.mudarPinNaVenda(DONA, false)
    expect(await m.autorizacao.pedePinNaVenda('org-v')).toBe(false)
    await m.autorizacao.mudarPinNaVenda(DONA, true)
    expect(await m.autorizacao.pedePinNaVenda('org-v')).toBe(true)
    const [n] = await linhas<{ n: number }>(`select count(*)::int n from auditoria where acao = 'empresa.assinaturas' and depois ? 'pinEmTodaVenda'`)
    expect(n!.n).toBe(2)
    await expect(m.autorizacao.mudarPinNaVenda(ANA, false)).rejects.toThrow()
  })
})

describe('o convite já cria o PIN', () => {
  const tokenDo = (link: string) => link.split('/convite/')[1]!

  it('convite só pelo WhatsApp: a pessoa digita o e-mail, cria senha e PIN, e o PIN já assina a venda', async () => {
    const c = await m.convite.convidar(DONA, { telefone: '(71) 99876-5432', papel: 'BALCAO', unidadeId: 'u-1' }, 'http://x/loja-v')
    expect(c.email).toBe('')
    const token = tokenDo(c.link)
    expect(await m.convite.conviteParaTela('loja-v', token)).toEqual({ serve: true, pedeEmail: true, pedePin: true })

    // PIN que todo mundo chuta: recusado, e o convite continua valendo.
    const fraco = await m.convite.aceitarConvite('loja-v', token, { nome: 'Carla', senha: 'senha-da-carla-1', pin: '1234', email: 'carla@v.com' })
    expect(fraco).toMatchObject({ ok: false, motivo: 'dados', erro: /Sequência/ })
    // O PIN de quem já vende na mesma loja: recusado sem dizer de quem.
    const repetido = await m.convite.aceitarConvite('loja-v', token, { nome: 'Carla', senha: 'senha-da-carla-1', pin: PIN.ana, email: 'carla@v.com' })
    expect(repetido).toMatchObject({ ok: false, motivo: 'dados', erro: 'Esse PIN não pode ser usado. Escolha outro.' })
    // Sem e-mail, não dá: é com ele que ela entra.
    expect(await m.convite.aceitarConvite('loja-v', token, { nome: 'Carla', senha: 'senha-da-carla-1', pin: '3817' })).toMatchObject({ ok: false, motivo: 'dados' })

    const ok = await m.convite.aceitarConvite('loja-v', token, { nome: 'Carla', senha: 'senha-da-carla-1', pin: '3817', email: 'Carla@V.com' })
    expect(ok).toMatchObject({ ok: true, email: 'carla@v.com', papel: 'BALCAO' })
    const [u] = await linhas<{ id: string; pin_hash: string | null }>(`select id, pin_hash from usuarios where email = 'carla@v.com'`)
    expect(u!.pin_hash).toMatch(/^scrypt\$/)

    // No tablet do caixa, o PIN da Carla põe a venda no nome dela.
    const r = await vender(CAIXA, { assinatura: { pin: '3817' } })
    expect(r).toMatchObject({ ok: true, vendedor: 'Carla' })
  })

  it('o contador não precisa de PIN; convite com e-mail não pede e-mail', async () => {
    const c = await m.convite.convidar(DONA, { email: 'contador@v.com', papel: 'CONTADOR', unidadeId: null }, 'http://x/loja-v')
    expect(await m.convite.conviteParaTela('loja-v', tokenDo(c.link))).toEqual({ serve: true, pedeEmail: false, pedePin: false })
  })

  it('sem e-mail e sem WhatsApp, não há convite', async () => {
    await expect(m.convite.convidar(DONA, { papel: 'BALCAO', unidadeId: 'u-1' }, 'http://x/loja-v')).rejects.toThrow(/e-mail ou o WhatsApp/)
  })
})
