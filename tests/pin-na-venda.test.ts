// O PIN de quem vendeu, em toda venda (Org.pinEmTodaVenda), com banco de verdade.
//
// O PIN é a confirmação (nada é gravado sem ele) e a assinatura (a venda vai
// para o nome de quem digitou, mesmo no tablet logado numa conta só). Ninguém
// fica preso: quem está na conta aberta e não tem PIN cria o dele na hora; o
// freio travado deixa registrar no nome da conta aberta, marcado; e sem
// internet a venda que já aconteceu nunca é recusada — fica para conferir.
// E o convite já cria o PIN, no mesmo passo da senha.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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
const GER = sessao('usr-ger', 'Gerente Sem Pin', 'GERENTE', 'u-1')

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
    ('usr-ger', 'org-v', 'Gerente Sem Pin', 'ger@v.com', now()),
    ('usr-dona', 'org-v', 'Dona', 'dona@v.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('a-cx', 'org-v', 'usr-cx', 'u-1', 'BALCAO'),
    ('a-ana', 'org-v', 'usr-ana', 'u-1', 'BALCAO'),
    ('a-bia', 'org-v', 'usr-bia', 'u-2', 'BALCAO'),
    ('a-nova', 'org-v', 'usr-nova', 'u-1', 'BALCAO'),
    ('a-ger', 'org-v', 'usr-ger', 'u-1', 'GERENTE'),
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
  db = await subirBanco({ pinEmTodaVenda: true })
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
  it('nasce ligado, inclusive para quem já existia — no schema, na migração e no banco', async () => {
    expect(await m.autorizacao.pedePinNaVenda('org-v')).toBe(true)
    const raiz = join(import.meta.dirname, '..')
    expect(readFileSync(join(raiz, 'prisma/schema.prisma'), 'utf8')).toMatch(/pinEmTodaVenda\s+Boolean\s+@default\(true\)/)
    expect(readFileSync(join(raiz, 'prisma/sql/tabelas.sql'), 'utf8')).toMatch(/"pin_em_toda_venda" BOOLEAN NOT NULL DEFAULT true/)
    // A migração dá o padrão ligado também às empresas que já existem.
    const migracao = readdirSync(join(raiz, 'prisma/migrations')).filter((d) => d.endsWith('_pin-em-toda-venda'))
    expect(migracao).toHaveLength(1)
    expect(readFileSync(join(raiz, 'prisma/migrations', migracao[0]!, 'migration.sql'), 'utf8')).toMatch(/"pin_em_toda_venda" BOOLEAN NOT NULL DEFAULT true/)
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
})

describe('quem ainda não tem PIN cria na hora de registrar', () => {
  const pinDe = async (id: string) => (await linhas<{ pin_hash: string | null }>(`select pin_hash from usuarios where id = $1`, [id]))[0]!.pin_hash
  const semPinDeNovo = async () => {
    await db.query(`update usuarios set pin_hash = null, pin_definido_em = null where id = 'usr-nova'`)
    await db.query(`delete from auditoria where acao like 'conta.pin.%' and usuario_id = 'usr-nova'`)
  }
  const criando = (pin: string, senha = SENHA) => ({ assinatura: { criarPin: { pin, senha } } })

  it('sem PIN e sem criar: nada grava, e a recusa manda criar (não há "confirmar sem PIN")', async () => {
    const antes = await quantasVendas()
    const r = await vender(NOVA)
    expect(r).toMatchObject({ ok: false, motivo: 'assinatura_pedida', pinNovo: 'criar', recado: /Crie o seu PIN/ })
    // Nem o "travado" abre a porta: sem PIN não há trava de PIN.
    expect(await vender(NOVA, { assinatura: { travado: true } })).toMatchObject({ ok: false, pinNovo: 'criar' })
    expect(await quantasVendas()).toBe(antes)
  })

  it('PIN fraco, PIN de colega da loja e senha errada são recusados, cada um voltando ao passo certo — e nada nasce', async () => {
    const antes = await quantasVendas()
    expect(await vender(NOVA, criando('1234'))).toMatchObject({ ok: false, pinNovo: 'refazer_pin', recado: /Sequência/ })
    expect(await vender(NOVA, criando('0000'))).toMatchObject({ ok: false, pinNovo: 'refazer_pin', recado: /repetido/ })
    // O PIN do Tablet do Caixa (mesma loja): frase que não diz de quem.
    expect(await vender(NOVA, criando(PIN.caixa))).toMatchObject({
      ok: false, pinNovo: 'refazer_pin', recado: 'Esse PIN não pode ser usado. Escolha outro.',
    })
    // Quem pode autorizar (gerente): a senha errada, ou faltando, volta ao passo da senha.
    expect(await vender(GER, criando('5829', 'senha-errada'))).toMatchObject({ ok: false, pinNovo: 'refazer_senha', recado: /senha de entrar/ })
    expect(await vender(GER, criando('5829', ''))).toMatchObject({ ok: false, pinNovo: 'refazer_senha' })
    expect(await pinDe('usr-nova')).toBeNull()
    expect(await pinDe('usr-ger')).toBeNull()
    expect(await quantasVendas()).toBe(antes)
  })

  it('o balcão cria SÓ com o PIN, sem senha — qualquer senha que vier é ignorada', async () => {
    const r = await vender(NOVA, criando('5829', ''))
    expect(r).toMatchObject({ ok: true, vendedor: 'Nova Sem Pin' })
    expect(await pinDe('usr-nova')).not.toBeNull()
    await semPinDeNovo()
    expect(await vender(NOVA, criando('5829', 'qualquer-coisa'))).toMatchObject({ ok: true })
    await semPinDeNovo()
  })

  it('o PIN do balcão NUNCA autoriza: nem desconto acima do teto, nem pedido de autorização direto', async () => {
    expect(await vender(NOVA, criando('5829', ''))).toMatchObject({ ok: true })
    // Desconto de 20% (teto 10%) autorizado com o PIN dela: recusado.
    const r = await vender(CAIXA, { desconto: 10, pagamentos: [{ forma: 'PIX', valor: 40 }], autorizacao: { pin: '5829' }, assinatura: { pin: PIN.caixa } })
    expect(r).toMatchObject({ ok: false, motivo: 'autorizacao_recusada' })
    for (const capacidade of ['venda.desconto', 'venda.cancelar', 'crediario.cobrar'] as const) {
      expect(
        await m.autorizacao.autorizarComPin({
          orgId: 'org-v', unidadeId: 'u-1', pin: '5829', capacidade, motivo: 't',
          quemPediu: { usuarioId: 'usr-cx', nome: 'Tablet do Caixa' },
        }),
      ).toMatchObject({ ok: false })
    }
    expect(m.autorizacao.podeAutorizar(NOVA)).toBe(false)
    expect(m.autorizacao.podeAutorizar(GER)).toBe(true)
    expect(m.autorizacao.podeAutorizar(DONA)).toBe(true)
    await semPinDeNovo()
  })

  it('o gerente continua com a senha: com ela, cria e registra; o PIN dele AUTORIZA', async () => {
    const r = await vender(GER, criando('6317', SENHA))
    expect(r).toMatchObject({ ok: true, vendedor: 'Gerente Sem Pin' })
    expect(await pinDe('usr-ger')).not.toBeNull()
    const d = await vender(CAIXA, { desconto: 10, pagamentos: [{ forma: 'PIX', valor: 40 }], autorizacao: { pin: '6317' }, assinatura: { pin: PIN.caixa } })
    expect(d, JSON.stringify(d)).toMatchObject({ ok: true })
    await db.query(`update usuarios set pin_hash = null, pin_definido_em = null where id = 'usr-ger'`)
    await db.query(`delete from auditoria where acao like 'conta.pin.%' and usuario_id = 'usr-ger'`)
  })

  it('sem a senha de barreira, o freio segura quem testa PINs de colegas: cinco recusas travam o balcão', async () => {
    for (let i = 0; i < 5; i++) expect((await vender(NOVA, criando(PIN.caixa, ''))).ok).toBe(false)
    expect(await vender(NOVA, criando('5829', ''))).toMatchObject({ ok: false, recado: /muitas vezes.*Espere/ })
    expect(await pinDe('usr-nova')).toBeNull()
  })

  it('o PIN do colega de OUTRA loja pode (não dividem balcão)', async () => {
    const r = await vender(NOVA, criando(PIN.bia))
    expect(r).toMatchObject({ ok: true })
    await semPinDeNovo()
  })

  it('cria e registra numa chamada só: PIN gravado, venda no nome dela, livro com "PIN criado na hora"', async () => {
    const r = await vender(NOVA, criando('5829'))
    expect(r).toMatchObject({ ok: true, vendedor: 'Nova Sem Pin' })
    if (!r.ok) return
    const g = await gravada(r.vendaId)
    expect(g.vendedor_id).toBe('usr-nova')
    expect(g.assinatura).toMatchObject({ como: 'pin_criado', por: 'Nova Sem Pin', conferir: false })
    expect(g.motivo).toMatch(/PIN criado na hora/)
    expect(await pinDe('usr-nova')).not.toBeNull()
    const [l] = await linhas<{ n: number; motivo: string }>(
      `select count(*)::int n, max(motivo) motivo from auditoria where acao = 'conta.pin.criou' and usuario_id = 'usr-nova'`,
    )
    expect(l).toMatchObject({ n: 1, motivo: 'PIN criado na hora, ao registrar a venda' })

    // Já tem PIN: a próxima venda é a confirmação de sempre, com o PIN criado.
    expect(await vender(NOVA)).toMatchObject({ ok: false, motivo: 'assinatura_pedida', recado: /Confirme a venda/ })
    expect(await vender(NOVA, { assinatura: { pin: '5829' } })).toMatchObject({ ok: true, vendedor: 'Nova Sem Pin' })
  })

  it('quem já tem PIN e manda "criar" é recusado: o servidor olha o banco, não a tela — e o PIN não muda', async () => {
    const antes = await pinDe('usr-nova')
    const n = await quantasVendas()
    expect(await vender(NOVA, criando('7316'))).toMatchObject({ ok: false, pinNovo: 'ja_tem' })
    expect(await pinDe('usr-nova')).toBe(antes)
    expect(await quantasVendas()).toBe(n)
    await semPinDeNovo()
  })

  it('a venda que estoura desfaz o PIN junto: nada fica pela metade', async () => {
    const antes = await quantasVendas()
    const r = await vender(NOVA, { ...criando('5829'), itens: [{ variacaoId: 'v-1', quantidade: 5000 }], pagamentos: [{ forma: 'PIX', valor: 250000 }] }).catch((e) => e)
    expect(r && 'ok' in r && r.ok).toBeFalsy()
    expect(await pinDe('usr-nova')).toBeNull()
    expect(await quantasVendas()).toBe(antes)
  })

  it('o freio da senha vale: cinco senhas erradas travam a criação do gerente, até com a senha certa', async () => {
    for (let i = 0; i < 5; i++) expect((await vender(GER, criando('5829', `errada-${i}`))).ok).toBe(false)
    expect(await vender(GER, criando('5829'))).toMatchObject({ ok: false, pinNovo: 'refazer_senha', recado: /muitas vezes.*Espere/ })
    expect(await pinDe('usr-ger')).toBeNull()
  })

  it('sem internet o caixa não trava: a venda entra no nome da conta, marcada para conferir — e o PIN novo é ignorado', async () => {
    const r = await vender(NOVA, { offline: { quando: new Date(Date.now() - 5 * 60_000) }, chave: 'off-nova-0009', ...criando('5829') })
    expect(r).toMatchObject({ ok: true, vendedor: 'Nova Sem Pin' })
    if (!r.ok) return
    expect((await gravada(r.vendaId)).assinatura).toMatchObject({ como: 'sem_internet', conferir: true })
    expect(await pinDe('usr-nova')).toBeNull()
  })

  it('com a chave desligada, é a venda de antes: sem PIN, sem criar', async () => {
    await db.exec(`update orgs set pin_em_toda_venda = false where id = 'org-v'`)
    try {
      expect(await vender(NOVA)).toMatchObject({ ok: true, vendedor: 'Nova Sem Pin' })
      // E o PIN que viesse mesmo assim é ignorado: nada nasce.
      expect(await vender(NOVA, criando('5829'))).toMatchObject({ ok: true })
      expect(await pinDe('usr-nova')).toBeNull()
    } finally {
      await db.exec(`update orgs set pin_em_toda_venda = true where id = 'org-v'`)
    }
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
