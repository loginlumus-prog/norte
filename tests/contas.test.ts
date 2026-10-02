// Contas com banco de verdade (PGlite exposto numa porta, como em
// lgpd-banco.test.ts), e o e-mail com fetch de mentira. Quatro partes:
//
//   1. O LINK DE SENHA: nasce com 32 bytes e só o SHA-256 no banco, vence em
//      30 minutos, serve uma vez, pedir outro mata o anterior, não vale em
//      outra empresa — e usar derruba as sessões e deixa linha no livro sem
//      segredo nenhum.
//   2. SEM ENUMERAÇÃO E COM FREIO: e-mail que não existe responde igual e não
//      manda nada; o freio conta o e-mail digitado e o endereço de rede.
//   3. EQUIPE E MINHA CONTA: quem pode gerar link para quem; trocar a própria
//      senha com a atual.
//   4. O CADASTRO PELO SITE: a função do banco cria empresa + loja + dono +
//      livro de uma vez só, escolhe o endereço (reservado e ocupado ganham
//      número), recusa entrada ruim, tem freio por IP, só a portaria chama —
//      e não há como mandá-la escrever numa empresa que já existe.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  conta: typeof import('../src/servidor/conta')
  autenticacao: typeof import('../src/servidor/autenticacao')
  cadastro: typeof import('../src/servidor/autocadastro')
  senha: typeof import('../src/servidor/senha')
  permissao: typeof import('../src/servidor/permissao')
  enderecos: typeof import('../src/servidor/enderecos')
}

const raiz = join(import.meta.dirname, '..')
const BASE = 'https://usenorte.test'
const SENHA_ANTIGA = 'senha-antiga-123'

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-dona', nome: 'Dora Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const GERENTE_LOJA: Sessao = { orgId: 'org-a', usuarioId: 'usr-ger', nome: 'Gil Gerente', acessos: [{ papel: 'GERENTE', unidadeId: 'uni-a1', expiraEm: null }] }

/** Os e-mails que "saíram", do fetch de mentira. */
let enviados: { to: string[]; subject: string; text: string; html: string }[] = []

const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const sha = (t: string) => createHash('sha256').update(t).digest('hex')
const tokenDo = (texto: string) => /[?&]t=([A-Za-z0-9_-]{43})/.exec(texto)?.[1] ?? null

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.SEGREDO_SESSAO = 'x'.repeat(48)
  process.env.RESEND_API_KEY = 're_teste'
  process.env.EMAIL_REMETENTE = 'Norte <nao-responda@usenorte.test>'
  db = await subirBanco()

  // A portaria, como o preparar-banco a cria: só a fachada de `orgs`. E o
  // rls.sql de novo, agora que ela existe, para ganhar o EXECUTE da função.
  await db.exec(`
    create role app_portaria nologin;
    grant usage on schema public to app_portaria;
    grant select (id, nome, slug, situacao, logo_url, cor_marca, modulos, configurada_em, agente_nome)
      on public.orgs to app_portaria;
  `)
  await db.exec(readFileSync(join(raiz, 'prisma/sql/rls.sql'), 'utf8'))

  const porta = 53000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url

  m = {
    banco: await import('../src/servidor/banco'),
    conta: await import('../src/servidor/conta'),
    autenticacao: await import('../src/servidor/autenticacao'),
    cadastro: await import('../src/servidor/autocadastro'),
    senha: await import('../src/servidor/senha'),
    permissao: await import('../src/servidor/permissao'),
    enderecos: await import('../src/servidor/enderecos'),
  }

  const hash = await m.senha.guardarSenha(SENHA_ANTIGA)
  await db.query(
    `
    insert into orgs (id, nome, slug, plano, situacao, atualizada_em) values
      ('org-a', 'Loja A', 'loja-a', 'REDE', 'ATIVA', now()),
      ('org-b', 'Vizinha B', 'vizinha-b', 'REDE', 'ATIVA', now());
    `,
  )
  await db.exec(`
    insert into unidades (id, org_id, nome, atualizada_em) values
      ('uni-a1', 'org-a', 'Centro', now()), ('uni-a2', 'org-a', 'Sul', now()), ('uni-b1', 'org-b', 'Norte B', now());
  `)
  for (const [id, org, nome, email, ativo] of [
    ['usr-dona', 'org-a', 'Dora Dona', 'dora@a.test', true],
    ['usr-ger', 'org-a', 'Gil Gerente', 'gil@a.test', true],
    ['usr-bal', 'org-a', 'Bia Balcao', 'bia@a.test', true],
    ['usr-bal2', 'org-a', 'Beto Outra Loja', 'beto@a.test', true],
    ['usr-saiu', 'org-a', 'Sara Saiu', 'sara@a.test', false],
    ['usr-viz', 'org-b', 'Vera Vizinha', 'vera@b.test', true],
  ] as const) {
    await db.query(
      `insert into usuarios (id, org_id, nome, email, senha_hash, ativo, sessoes_desde, atualizado_em)
       values ($1, $2, $3, $4, $5, $6, now() - interval '1 day', now())`,
      [id, org, nome, email, hash, ativo],
    )
  }
  await db.exec(`
    insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
      ('ac-dona', 'org-a', 'usr-dona', null, 'DONO'),
      ('ac-ger', 'org-a', 'usr-ger', 'uni-a1', 'GERENTE'),
      ('ac-bal', 'org-a', 'usr-bal', 'uni-a1', 'BALCAO'),
      ('ac-bal2', 'org-a', 'usr-bal2', 'uni-a2', 'BALCAO'),
      ('ac-saiu', 'org-a', 'usr-saiu', 'uni-a1', 'BALCAO'),
      ('ac-viz', 'org-b', 'usr-viz', null, 'DONO');
  `)
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

beforeEach(() => {
  enviados = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      enviados.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: `em_${enviados.length}` }), { status: 200 })
    }),
  )
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

/** Pede o link de senha e devolve o token que "chegou" no e-mail. */
async function pedirLink(orgId: string, email: string) {
  const r = await m.conta.enviarLinkDeSenha(orgId, email, BASE, '10.0.0.1')
  const ultimo = enviados.at(-1)
  return { r, token: r === 'enviado' && ultimo ? tokenDo(ultimo.text) : null, email: ultimo }
}

// ─────────────────────────────────────────────────────────────
// 1. O LINK DE SENHA
// ─────────────────────────────────────────────────────────────

describe('o link de senha', () => {
  it('nasce com 32 bytes no e-mail e só o SHA-256 no banco, vencendo em 30 minutos', async () => {
    const { r, token, email } = await pedirLink('org-a', 'BIA@a.test ')
    expect(r).toBe('enviado')
    expect(token).toHaveLength(43)
    expect(email!.to).toEqual(['bia@a.test'])
    expect(email!.text).toContain(`${BASE}/loja-a/redefinir-senha?t=${token}`)

    const tokens = await linhas<Record<string, unknown>>(`select * from tokens_conta where usuario_id = 'usr-bal'`)
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.hash).toBe(sha(token!))
    expect(tokens[0]!.tipo).toBe('SENHA')
    // o token em si não está em coluna nenhuma
    expect(JSON.stringify(tokens)).not.toContain(token!)
    // a coluna é timestamp sem fuso, em UTC: a conta é feita no banco
    const [prazo] = await linhas<{ seg: number }>(
      `select extract(epoch from (expira_em - (now() at time zone 'utc')))::float as seg from tokens_conta where usuario_id = 'usr-bal'`,
    )
    expect(prazo!.seg).toBeGreaterThan(29 * 60)
    expect(prazo!.seg).toBeLessThanOrEqual(30 * 60 + 5)
  })

  it('serve uma vez: troca a senha, derruba as sessões e o livro não leva segredo', async () => {
    const { token } = await pedirLink('org-a', 'bia@a.test')
    const [antes] = await linhas<{ sessoes_desde: Date }>(`select sessoes_desde from usuarios where id = 'usr-bal'`)
    const cookieDeAntes = new Date()

    const r = await m.conta.redefinirSenha('loja-a', token!, 'senha-nova-456')
    expect(r).toMatchObject({ ok: true, usuarioId: 'usr-bal', email: 'bia@a.test', empresa: 'Loja A' })

    const [u] = await linhas<{ senha_hash: string; sessoes_desde: Date }>(
      `select senha_hash, sessoes_desde from usuarios where id = 'usr-bal'`,
    )
    expect(await m.senha.conferirSenha('senha-nova-456', u!.senha_hash)).toBe(true)
    expect(await m.senha.conferirSenha(SENHA_ANTIGA, u!.senha_hash)).toBe(false)
    // a sessão aberta antes da troca morre
    expect(new Date(u!.sessoes_desde).getTime()).toBeGreaterThan(new Date(antes!.sessoes_desde).getTime())
    expect(m.permissao.sessaoAindaVale({ ativo: true, sessoesDesde: new Date(u!.sessoes_desde) }, new Date(cookieDeAntes.getTime() - 1000))).toBe(false)

    // de novo, o mesmo link: não
    expect(await m.conta.redefinirSenha('loja-a', token!, 'outra-senha-789')).toEqual({ ok: false, motivo: 'ja_usado' })

    const livro = await linhas<Record<string, unknown>>(
      `select * from auditoria where acao = 'conta.senha.redefiniu' and alvo_id = 'usr-bal'`,
    )
    expect(livro.length).toBeGreaterThanOrEqual(1)
    const texto = JSON.stringify(livro)
    expect(texto).not.toContain(token!)
    expect(texto).not.toContain(sha(token!))
    expect(texto).not.toContain('senha-nova-456')
    expect(texto).not.toContain('scrypt$')
  })

  it('vencido não vale', async () => {
    const { token } = await pedirLink('org-a', 'gil@a.test')
    await db.query(`update tokens_conta set expira_em = now() - interval '1 minute' where hash = $1`, [sha(token!)])
    expect(await m.conta.redefinirSenha('loja-a', token!, 'senha-nova-456')).toEqual({ ok: false, motivo: 'vencido' })
  })

  it('pedir de novo mata o link anterior', async () => {
    const primeiro = await pedirLink('org-a', 'dora@a.test')
    const segundo = await pedirLink('org-a', 'dora@a.test')
    expect(primeiro.token).not.toBe(segundo.token)
    expect(await m.conta.redefinirSenha('loja-a', primeiro.token!, 'senha-nova-456')).toEqual({ ok: false, motivo: 'invalido' })
    const vivos = await linhas(`select 1 from tokens_conta where usuario_id = 'usr-dona' and tipo = 'SENHA' and usado_em is null`)
    expect(vivos).toHaveLength(1)
  })

  it('o link de uma empresa não abre na outra (o RLS nem deixa ver)', async () => {
    const { token } = await pedirLink('org-b', 'vera@b.test')
    expect(await m.conta.redefinirSenha('loja-a', token!, 'senha-nova-456')).toEqual({ ok: false, motivo: 'invalido' })
    expect((await m.conta.redefinirSenha('vizinha-b', token!, 'senha-nova-456')).ok).toBe(true)
  })

  it('senha fraca é recusada ANTES de gastar o link; token sem forma nem consulta', async () => {
    const { token } = await pedirLink('org-a', 'beto@a.test')
    await expect(m.conta.redefinirSenha('loja-a', token!, 'curta')).rejects.toThrow(/8 caracteres/)
    const [t] = await linhas<{ usado_em: Date | null }>(`select usado_em from tokens_conta where hash = $1`, [sha(token!)])
    expect(t!.usado_em).toBeNull()
    expect(await m.conta.redefinirSenha('loja-a', "x' or '1'='1", 'senha-nova-456')).toEqual({ ok: false, motivo: 'invalido' })
  })
})

// ─────────────────────────────────────────────────────────────
// 2. SEM ENUMERAÇÃO, COM FREIO
// ─────────────────────────────────────────────────────────────

describe('esqueci a senha não entrega quem tem conta', () => {
  it('e-mail que não existe e conta desativada: nada sai, nada nasce', async () => {
    const antes = await linhas(`select id from tokens_conta`)
    expect(await m.conta.enviarLinkDeSenha('org-a', 'ninguem@a.test', BASE, null)).toBe('sem_conta')
    expect(await m.conta.enviarLinkDeSenha('org-a', 'sara@a.test', BASE, null)).toBe('sem_conta')
    // e-mail de OUTRA empresa também não existe aqui
    expect(await m.conta.enviarLinkDeSenha('org-a', 'vera@b.test', BASE, null)).toBe('sem_conta')
    expect(enviados).toHaveLength(0)
    expect(await linhas(`select id from tokens_conta`)).toHaveLength(antes.length)
  })

  it('o freio responde igual para quem existe e para quem não existe', async () => {
    const existe = await m.conta.reservarPedido('org-a', 'SENHA', 'gil@a.test', '10.1.1.1')
    const naoExiste = await m.conta.reservarPedido('org-a', 'SENHA', 'fantasma@a.test', '10.1.1.2')
    expect(existe).toEqual(naoExiste)
  })

  it('três pedidos por e-mail na hora; o quarto espera — exista o e-mail ou não', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await m.conta.reservarPedido('org-a', 'SENHA', 'Martela@a.test', `10.2.0.${i}`)).toEqual({ bloqueado: false })
    }
    const quarto = await m.conta.reservarPedido('org-a', 'SENHA', 'martela@a.test ', '10.2.0.9')
    expect(quarto.bloqueado).toBe(true)
    // o reenvio da confirmação soma na mesma conta: é a mesma caixa de entrada
    expect((await m.conta.reservarPedido('org-a', 'EMAIL', 'martela@a.test', '10.2.0.10')).bloqueado).toBe(true)
    // outra empresa tem a própria contagem
    expect(await m.conta.reservarPedido('org-b', 'SENHA', 'martela@a.test', '10.2.0.11')).toEqual({ bloqueado: false })
  })

  it('dez por endereço de rede, somando os e-mails', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await m.conta.reservarPedido('org-a', 'SENHA', `varre${i}@a.test`, '10.3.3.3')).bloqueado).toBe(false)
    }
    expect((await m.conta.reservarPedido('org-a', 'SENHA', 'varre10@a.test', '10.3.3.3')).bloqueado).toBe(true)
    expect((await m.conta.reservarPedido('org-a', 'SENHA', 'varre10@a.test', '10.3.3.4')).bloqueado).toBe(false)
  })

  it('pedidos simultâneos não furam o freio', async () => {
    const r = await Promise.all(
      Array.from({ length: 8 }, (_, i) => m.conta.reservarPedido('org-a', 'SENHA', 'rajada@a.test', `10.4.0.${i}`)),
    )
    expect(r.filter((x) => !x.bloqueado)).toHaveLength(3)
  })

  it('sem e-mail configurado, nem token nasce', async () => {
    const chave = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      expect(await m.conta.enviarLinkDeSenha('org-a', 'gil@a.test', BASE, null)).toBe('nao_configurado')
      expect(enviados).toHaveLength(0)
    } finally {
      process.env.RESEND_API_KEY = chave
    }
  })
})

// ─────────────────────────────────────────────────────────────
// 3. EQUIPE E MINHA CONTA
// ─────────────────────────────────────────────────────────────

describe('o link que quem gere a equipe gera', () => {
  it('a dona gera para o gerente; o link abre e vale 24 horas', async () => {
    const r = await m.conta.gerarLinkDeSenha(DONA, 'usr-ger', 'http://localhost:3000/loja-a')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link).toMatch(/^http:\/\/localhost:3000\/loja-a\/redefinir-senha\?t=[A-Za-z0-9_-]{43}$/)
    expect(r.expiraEm.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000)
    const [livro] = await linhas<{ quem: string; alvo_id: string; depois: unknown }>(
      `select quem, alvo_id, depois from auditoria where acao = 'equipe.senha.gerou-link' order by criado_em desc limit 1`,
    )
    expect(livro).toMatchObject({ quem: 'Dora Dona', alvo_id: 'usr-ger' })
    expect(JSON.stringify(livro)).not.toContain(tokenDo(r.link)!)
    expect((await m.conta.redefinirSenha('loja-a', tokenDo(r.link)!, 'senha-do-gil-1')).ok).toBe(true)
  })

  it('o gerente da loja gera para o balcão DELA, não para a dona nem para outra loja', async () => {
    expect((await m.conta.gerarLinkDeSenha(GERENTE_LOJA, 'usr-bal', 'http://x/loja-a')).ok).toBe(true)
    expect(await m.conta.gerarLinkDeSenha(GERENTE_LOJA, 'usr-dona', 'http://x/loja-a')).toMatchObject({ ok: false })
    expect(await m.conta.gerarLinkDeSenha(GERENTE_LOJA, 'usr-bal2', 'http://x/loja-a')).toMatchObject({ ok: false })
  })

  it('nem para si mesmo, nem para conta desativada, nem para gente de outra empresa', async () => {
    expect(await m.conta.gerarLinkDeSenha(DONA, 'usr-dona', 'http://x/loja-a')).toMatchObject({ ok: false })
    expect(await m.conta.gerarLinkDeSenha(DONA, 'usr-saiu', 'http://x/loja-a')).toMatchObject({ ok: false })
    expect(await m.conta.gerarLinkDeSenha(DONA, 'usr-viz', 'http://x/loja-a')).toEqual({
      ok: false,
      motivo: 'Pessoa não encontrada nesta empresa.',
    })
  })

  it('balcão não gera link para ninguém', async () => {
    const balcao: Sessao = { orgId: 'org-a', usuarioId: 'usr-bal', nome: 'Bia', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a1', expiraEm: null }] }
    await expect(m.conta.gerarLinkDeSenha(balcao, 'usr-bal2', 'http://x/loja-a')).rejects.toThrow()
  })
})

describe('trocar a própria senha', () => {
  const BETO: Sessao = { orgId: 'org-a', usuarioId: 'usr-bal2', nome: 'Beto', acessos: [{ papel: 'BALCAO', unidadeId: 'uni-a2', expiraEm: null }] }

  it('com a atual errada, não; com a certa, troca e corta as outras sessões', async () => {
    expect(await m.conta.trocarMinhaSenha(BETO, 'errada-000', 'nova-senha-beto', '10.9.9.9')).toEqual({
      ok: false,
      motivo: 'A senha atual não confere.',
    })
    expect(await m.conta.trocarMinhaSenha(BETO, SENHA_ANTIGA, SENHA_ANTIGA, null)).toMatchObject({ ok: false })
    expect(await m.conta.trocarMinhaSenha(BETO, SENHA_ANTIGA, 'curta', null)).toMatchObject({ ok: false })

    const antes = new Date()
    const r = await m.conta.trocarMinhaSenha(BETO, SENHA_ANTIGA, 'nova-senha-beto', null)
    expect(r).toMatchObject({ ok: true, email: 'beto@a.test' })
    const [u] = await linhas<{ senha_hash: string; sessoes_desde: Date }>(`select senha_hash, sessoes_desde from usuarios where id = 'usr-bal2'`)
    expect(await m.senha.conferirSenha('nova-senha-beto', u!.senha_hash)).toBe(true)
    expect(new Date(u!.sessoes_desde).getTime()).toBeGreaterThanOrEqual(antes.getTime() - 5)
    expect(await linhas(`select 1 from auditoria where acao = 'conta.senha.trocou' and alvo_id = 'usr-bal2'`)).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────
// 4. O CADASTRO PELO SITE
// ─────────────────────────────────────────────────────────────

const HASH_OK = 'scrypt$16384$8$1$c2FsLXRlc3Rl$ZGVyaXZhZG8tdGVzdGU='

/** Chama a função do banco como um papel (o padrão é a portaria). */
async function chamar(args: (string | boolean | null)[], papel = 'app_portaria') {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${papel}`)
    const r = await tx.query<{ r_org: string | null; r_usuario: string | null; r_endereco: string | null; r_recusa: string | null }>(
      `select * from public.criar_empresa_cadastro($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      args,
    )
    return r.rows[0]!
  })
}
const argumentos = (o: Partial<Record<'nome' | 'endereco' | 'dono' | 'email' | 'hash' | 'ramo' | 'ip' | 'termos', string | null>> & { pendente?: boolean } = {}) => [
  o.nome ?? 'Loja de Teste',
  o.endereco ?? 'loja-de-teste',
  o.dono ?? 'Tina Teste',
  o.email ?? 'tina@teste.test',
  o.hash ?? HASH_OK,
  o.ramo ?? 'roupa',
  o.ip === undefined ? '172.16.0.1' : o.ip,
  o.pendente ?? false,
  o.termos ?? '25 de setembro de 2026',
]

describe('o endereço da empresa', () => {
  it('sai do nome, sem acento nem símbolo, e foge do que é reservado', () => {
    const e = m.enderecos.enderecoDoNome
    expect(e('Sorveteria da Praça')).toBe('sorveteria-da-praca')
    expect(e('  Pão & Café!! ')).toBe('pao-e-cafe')
    expect(e('Zé')).toBe('loja-ze')
    expect(e('Termos')).toBe('loja-termos')
    expect(e('???')).toBe('loja')
    const longo = e('Empório de Secos e Molhados Nossa Senhora Aparecida do Bairro Novo')
    expect(longo.length).toBeLessThanOrEqual(40)
    expect(longo).toMatch(m.enderecos.FORMATO_ENDERECO)
  })

  it('toda página de src/app e toda pasta de public/ é reservada', () => {
    const nomes = [
      ...readdirSync(join(raiz, 'src/app')).filter((n) => !n.startsWith('[') && statSync(join(raiz, 'src/app', n)).isDirectory()),
      ...readdirSync(join(raiz, 'public')).filter((n) => statSync(join(raiz, 'public', n)).isDirectory()),
    ]
    for (const n of nomes) expect(m.enderecos.RESERVADOS.has(n), n).toBe(true)
  })

  it('a lista do banco é a mesma daqui', () => {
    const sql = readFileSync(join(raiz, 'prisma/sql/rls.sql'), 'utf8')
    const bloco = /reservados text\[\] := array\[([\s\S]*?)\];/.exec(sql)?.[1]
    expect(bloco).toBeTruthy()
    const doBanco = new Set([...bloco!.matchAll(/'([^']+)'/g)].map((x) => x[1]!))
    expect(doBanco).toEqual(new Set(m.enderecos.RESERVADOS))
  })
})

describe('o cadastro pelo site', () => {
  it('cria empresa, loja, dono com acesso de DONO e a linha do livro — em teste de 30 dias', async () => {
    const r = await m.cadastro.criarEmpresaPeloCadastro(
      { empresa: 'Sorveteria da Praça', dono: 'Paula Praça', email: 'Paula@Praca.test', senha: 'senha-da-paula', ramo: 'sorveteria', aceitou: true },
      '172.20.0.1',
      { emailPendente: true },
    )
    expect(r).toMatchObject({ ok: true, endereco: 'sorveteria-da-praca' })
    if (!r.ok) return

    const [org] = await linhas<Record<string, unknown>>(`select * from orgs where id = $1`, [r.orgId])
    expect(org).toMatchObject({ nome: 'Sorveteria da Praça', slug: 'sorveteria-da-praca', plano: 'BALCAO_AGENTE', situacao: 'TESTE', ramo: 'sorveteria', configurada_em: null })
    const unidades = await linhas<Record<string, unknown>>(`select * from unidades where org_id = $1`, [r.orgId])
    expect(unidades).toHaveLength(1)
    expect(unidades[0]).toMatchObject({ nome: 'Sorveteria da Praça', ramo: 'sorveteria', ativa: true })
    const [u] = await linhas<Record<string, unknown>>(`select * from usuarios where id = $1`, [r.usuarioId])
    expect(u).toMatchObject({ org_id: r.orgId, email: 'paula@praca.test', nome: 'Paula Praça', ativo: true, email_pendente: true })
    expect(await m.senha.conferirSenha('senha-da-paula', u!.senha_hash as string)).toBe(true)
    expect(await linhas(`select papel, unidade_id from acessos where usuario_id = $1`, [r.usuarioId])).toEqual([{ papel: 'DONO', unidade_id: null }])
    const [livro] = await linhas<{ acao: string; depois: Record<string, unknown> }>(`select acao, depois from auditoria where org_id = $1`, [r.orgId])
    expect(livro).toMatchObject({ acao: 'empresa.criou', depois: { origem: 'cadastro', plano: 'BALCAO_AGENTE', termos: m.cadastro.VERSAO_TERMOS } })
    expect(JSON.stringify(livro)).not.toContain('scrypt')
    // e o IP não fica em lugar nenhum — só o resumo, na tabela do freio
    expect(await linhas(`select 1 from cadastros_publicos where ip_resumo = $1`, [sha('172.20.0.1')])).toHaveLength(1)
  })

  it('e-mail pendente: a senha certa não entra até confirmar; confirmado, entra', async () => {
    const r = await m.cadastro.criarEmpresaPeloCadastro(
      { empresa: 'Pet Confirma', dono: 'Caio Confirma', email: 'caio@confirma.test', senha: 'senha-do-caio', ramo: 'petshop', aceitou: true },
      '172.21.0.1',
      { emailPendente: true },
    )
    if (!r.ok) throw new Error('não criou')
    expect(await m.autenticacao.entrar(r.endereco, 'caio@confirma.test', 'senha-errada', null)).toMatchObject({ ok: false, motivo: 'credenciais' })
    expect(await m.autenticacao.entrar(r.endereco, 'caio@confirma.test', 'senha-do-caio', null)).toMatchObject({ ok: false, motivo: 'email_pendente' })

    expect(await m.conta.enviarConfirmacao(r.orgId, r.usuarioId, BASE, null)).toBe('enviado')
    const token = tokenDo(enviados.at(-1)!.text)!
    expect(enviados.at(-1)!.text).toContain(`${BASE}/${r.endereco}/confirmar-email?t=`)
    expect(await linhas(`select 1 from tokens_conta where hash = $1 and tipo = 'EMAIL'`, [sha(token)])).toHaveLength(1)

    // o link de confirmação não serve de senha, nem abre em outra empresa
    expect(await m.conta.redefinirSenha(r.endereco, token, 'tentativa-123')).toEqual({ ok: false, motivo: 'invalido' })
    expect(await m.conta.confirmarEmail('loja-a', token)).toEqual({ ok: false, motivo: 'invalido' })

    expect(await m.conta.confirmarEmail(r.endereco, token)).toEqual({ ok: true, email: 'caio@confirma.test' })
    expect(await m.conta.confirmarEmail(r.endereco, token)).toEqual({ ok: false, motivo: 'ja_usado' })
    expect((await m.autenticacao.entrar(r.endereco, 'caio@confirma.test', 'senha-do-caio', null)).ok).toBe(true)
  })

  it('servidor sem e-mail não exige confirmação que não tem como chegar', async () => {
    const r = await m.cadastro.criarEmpresaPeloCadastro(
      { empresa: 'Sem Email Ltda', dono: 'Sil Sem', email: 'sil@sem.test', senha: 'senha-do-sil', ramo: 'outro', aceitou: true },
      '172.22.0.1',
      { emailPendente: true },
    )
    if (!r.ok) throw new Error('não criou')
    const chave = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      expect((await m.autenticacao.entrar(r.endereco, 'sil@sem.test', 'senha-do-sil', null)).ok).toBe(true)
    } finally {
      process.env.RESEND_API_KEY = chave
    }
  })

  it('nome repetido ganha número; nome reservado não vira página do site', async () => {
    const a = await chamar(argumentos({ nome: 'Loja A', endereco: 'loja-a', ip: '172.23.0.1' }))
    expect(a.r_endereco).toBe('loja-a-2')
    const b = await chamar(argumentos({ nome: 'Loja A', endereco: 'loja-a', ip: '172.23.0.2' }))
    expect(b.r_endereco).toBe('loja-a-3')
    const t = await chamar(argumentos({ nome: 'Termos', endereco: 'termos', ip: '172.23.0.3' }))
    expect(t.r_endereco).toBe('termos-2')
    const c = await chamar(argumentos({ nome: 'Cadastro', endereco: 'cadastro', ip: '172.23.0.4' }))
    expect(c.r_endereco).toBe('cadastro-2')
  })

  it('não há como escrever numa empresa que já existe', async () => {
    const antes = await linhas<{ n: number }>(`select count(*)::int as n from usuarios where org_id = 'org-a'`)
    const r = await chamar(argumentos({ nome: 'Loja A', endereco: 'loja-a', email: 'dora@a.test', ip: '172.24.0.1' }))
    expect(r.r_org).not.toBe('org-a')
    expect(r.r_endereco).not.toBe('loja-a')
    const depois = await linhas<{ n: number }>(`select count(*)::int as n from usuarios where org_id = 'org-a'`)
    expect(depois[0]!.n).toBe(antes[0]!.n)
    // a dona da loja A continua com a senha dela
    const [dora] = await linhas<{ senha_hash: string }>(`select senha_hash from usuarios where id = 'usr-dona'`)
    expect(dora!.senha_hash).not.toBe(HASH_OK)
  })

  it('três por hora por endereço de rede; outro endereço continua', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await chamar(argumentos({ nome: `Rajada ${i}`, endereco: `rajada-${i}`, ip: '172.25.0.1' }))).r_recusa).toBeNull()
    }
    expect((await chamar(argumentos({ nome: 'Rajada 3', endereco: 'rajada-3', ip: '172.25.0.1' }))).r_recusa).toBe('muitas_tentativas')
    expect(await linhas(`select 1 from orgs where slug = 'rajada-3'`)).toHaveLength(0)
    expect((await chamar(argumentos({ nome: 'Rajada 3', endereco: 'rajada-3', ip: '172.25.0.2' }))).r_recusa).toBeNull()
    // sem IP também conta, num balde só — não é jeito de fugir do freio
    for (let i = 0; i < 3; i++) await chamar(argumentos({ nome: `Sem IP ${i}`, endereco: `sem-ip-${i}`, ip: null }))
    expect((await chamar(argumentos({ nome: 'Sem IP 3', endereco: 'sem-ip-3', ip: null }))).r_recusa).toBe('muitas_tentativas')
  })

  it('recusa entrada ruim, mesmo vinda da portaria', async () => {
    const ruins: [string, Parameters<typeof argumentos>[0]][] = [
      ['senha em texto', { hash: 'minha-senha-123' }],
      ['e-mail', { email: 'nao-e-email' }],
      ['endereço', { endereco: 'Tem Espaço' }],
      ['endereço curto', { endereco: 'ab' }],
      ['endereço com hífen na ponta', { endereco: '-loja' }],
      ['nome com controle', { nome: 'Loja\u0007Bip' }],
      ['nome vazio', { nome: '  ' }],
      ['dono longo', { dono: 'x'.repeat(81) }],
      ['ramo', { ramo: "roupa'; drop table orgs; --" }],
      ['termos', { termos: '' }],
    ]
    for (const [caso, o] of ruins) {
      await expect(chamar(argumentos({ ...o, ip: `172.26.0.${ruins.findIndex((r) => r[0] === caso)}` })), caso).rejects.toThrow(/cadastro:/)
    }
    expect(await linhas(`select 1 from orgs where nome in ('Loja\u0007Bip')`)).toHaveLength(0)
  })

  it('é tudo ou nada: se a última gravação falha, nem a empresa fica', async () => {
    await db.exec(`
      create function public.teste_falha() returns trigger language plpgsql as $$
      begin raise exception 'falha de propósito'; end $$;
      create trigger teste_falha before insert on public.acessos for each row execute function public.teste_falha();
    `)
    try {
      await expect(chamar(argumentos({ nome: 'Pela Metade', endereco: 'pela-metade', ip: '172.27.0.1' }))).rejects.toThrow(/propósito/)
    } finally {
      await db.exec(`drop trigger teste_falha on public.acessos; drop function public.teste_falha();`)
    }
    expect(await linhas(`select 1 from orgs where slug = 'pela-metade'`)).toHaveLength(0)
    expect(await linhas(`select 1 from usuarios where email = 'tina@teste.test' and nome = 'Tina Teste' and org_id not in (select id from orgs)`)).toHaveLength(0)
    expect(await linhas(`select 1 from unidades where nome = 'Pela Metade'`)).toHaveLength(0)
  })

  it('só a portaria chama; a aplicação nem chama nem lê a tabela do freio', async () => {
    await expect(chamar(argumentos({ ip: '172.28.0.1' }), 'app_norte')).rejects.toThrow(/permission denied/)
    for (const papel of ['app_norte', 'app_portaria']) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${papel}`)
          return tx.query('select * from cadastros_publicos')
        }),
        papel,
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('as travas da tela: dados, aceite, carimbo e o interruptor', () => {
    const ok = { empresa: 'Loja', dono: 'Ana', email: 'a@b.co', senha: '12345678', ramo: 'roupa', aceitou: true }
    expect(m.cadastro.conferirDados(ok)).toBeNull()
    expect(m.cadastro.conferirDados({ ...ok, aceitou: false })).toMatch(/aceitar/)
    expect(m.cadastro.conferirDados({ ...ok, ramo: 'cassino' })).toMatch(/ramo/)
    expect(m.cadastro.conferirDados({ ...ok, senha: '1234567' })).toMatch(/8/)
    expect(m.cadastro.conferirDados({ ...ok, email: 'a@b' })).toMatch(/e-mail/)

    const agora = Date.now()
    const carimbo = m.cadastro.carimbar(agora)
    expect(m.cadastro.conferirCarimbo(carimbo, agora + 1000)).toBe('rapido')
    expect(m.cadastro.conferirCarimbo(carimbo, agora + 10_000)).toBe('ok')
    expect(m.cadastro.conferirCarimbo(carimbo, agora + 7 * 3600_000)).toBe('velho')
    // mexer na hora quebra a assinatura
    expect(m.cadastro.conferirCarimbo(`${agora - 60_000}.${carimbo.split('.')[1]}`, agora)).toBe('invalido')
    expect(m.cadastro.conferirCarimbo('lixo', agora)).toBe('invalido')

    expect(m.cadastro.cadastroAberto({})).toBe(true)
    expect(m.cadastro.cadastroAberto({ CADASTRO_ABERTO: '1' })).toBe(true)
    expect(m.cadastro.cadastroAberto({ CADASTRO_ABERTO: '0' })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// 5. O NOSSO SUPORTE NÃO OCUPA VAGA
// ─────────────────────────────────────────────────────────────

describe('o suporte do Norte não ocupa vaga da loja', () => {
  beforeAll(async () => {
    const hash = await m.senha.guardarSenha('senha-da-loja-g')
    // Plano Grátis: UMA vaga. É onde o suporte derrubaria a caixa.
    await db.exec(`
      insert into orgs (id, nome, slug, plano, situacao, atualizada_em) values ('org-g', 'Loja G', 'loja-g', 'GRATIS', 'ATIVA', now());
      insert into unidades (id, org_id, nome, atualizada_em) values ('uni-g1', 'org-g', 'Única', now());
    `)
    for (const [id, nome, email] of [
      ['usr-caixa', 'Cida Caixa', 'cida@g.test'],
      ['usr-sup', 'Suporte Norte', 'suporte@norte.test'],
      ['usr-sup-dono', 'Sócio Suporte', 'socio@g.test'],
    ]) {
      await db.query(
        `insert into usuarios (id, org_id, nome, email, senha_hash, atualizado_em) values ($1, 'org-g', $2, $3, $4, now())`,
        [id, nome, email, hash],
      )
    }
    await db.exec(`
      insert into acessos (id, org_id, usuario_id, unidade_id, papel, expira_em, motivo) values
        ('ac-caixa', 'org-g', 'usr-caixa', 'uni-g1', 'BALCAO', null, null),
        ('ac-sup', 'org-g', 'usr-sup', null, 'SUPORTE', now() + interval '1 day', 'chamado 77: conferir o caixa'),
        ('ac-sd1', 'org-g', 'usr-sup-dono', null, 'SUPORTE', now() + interval '1 day', 'chamado 78'),
        ('ac-sd2', 'org-g', 'usr-sup-dono', 'uni-g1', 'BALCAO', null, null);
    `)
  })

  const presentes = async () =>
    (await linhas<{ usuario_id: string }>(`select usuario_id from presencas where org_id = 'org-g' order by usuario_id`)).map((l) => l.usuario_id)

  it('a caixa dentro, o suporte entra sem derrubar ninguém e sem criar presença', async () => {
    expect((await m.autenticacao.entrar('loja-g', 'cida@g.test', 'senha-da-loja-g', null)).ok).toBe(true)
    const sup = await m.autenticacao.entrar('loja-g', 'suporte@norte.test', 'senha-da-loja-g', null)
    expect(sup).toMatchObject({ ok: true })
    expect((sup as { derrubou?: unknown }).derrubou).toBeUndefined()
    expect(await presentes()).toEqual(['usr-caixa'])
    expect(await linhas(`select 1 from auditoria where org_id = 'org-g' and acao = 'vaga.assumiu'`)).toHaveLength(0)
  })

  it('presença de suporte que tenha sobrado não conta na vaga', async () => {
    const { liberarVaga, quemEstaDentro } = await import('../src/servidor/presenca')
    await liberarVaga('org-g', 'usr-caixa')
    // uma presença do suporte de antes da regra, mexendo agora
    await db.exec(`insert into presencas (org_id, usuario_id, desde, ultimo_sinal) values ('org-g', 'usr-sup', now(), now())`)
    expect((await quemEstaDentro('org-g')).map((o) => o.usuarioId)).toEqual([])
    const caixa = await m.autenticacao.entrar('loja-g', 'cida@g.test', 'senha-da-loja-g', null)
    expect(caixa).toMatchObject({ ok: true })
    expect((caixa as { derrubou?: unknown }).derrubou).toBeUndefined()
  })

  it('quem tem SUPORTE e mais um papel da loja ocupa vaga como qualquer um', async () => {
    const r = await m.autenticacao.entrar('loja-g', 'socio@g.test', 'senha-da-loja-g', null)
    // a caixa acabou de mexer: a única vaga está ocupada e não é tomável
    expect(r).toMatchObject({ ok: false, motivo: 'sem_vaga' })
  })
})
