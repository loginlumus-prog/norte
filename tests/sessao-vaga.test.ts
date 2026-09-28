// A sessão presa à vaga, o carimbo do caminho, o freio da tela trancada e as
// travas de quem só lê ou só manda numa loja — com banco de verdade (PGlite
// exposto numa porta, como em contas.test.ts).
//
// O cookie é montado pelo próprio `abrirSessao` e lido pelo próprio
// `conferirSessao`: o `next/headers` é de mentira só para guardar o que o
// servidor gravaria no navegador e devolver no pedido seguinte. É o caminho
// inteiro de uma tela: cookie assinado → usuário no banco → vaga no banco.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

// ── o navegador de mentira ───────────────────────────────────
// `cookies().set` grava aqui; `headers().get('cookie')` devolve daqui.
const pote = vi.hoisted(() => ({
  gravados: new Map<string, string>(),
  cookie: '' as string,
  extras: new Map<string, string>(),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (nome: string, valor: string) => pote.gravados.set(nome, valor),
    get: (nome: string) => {
      const v = pote.gravados.get(nome)
      return v === undefined ? undefined : { name: nome, value: v }
    },
  }),
  headers: async () => ({
    get: (n: string) => (n.toLowerCase() === 'cookie' ? pote.cookie || null : (pote.extras.get(n.toLowerCase()) ?? null)),
    has: (n: string) => pote.extras.has(n.toLowerCase()),
  }),
}))

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  autenticacao: typeof import('../src/servidor/autenticacao')
  sessao: typeof import('../src/servidor/sessao')
  pagina: typeof import('../src/servidor/pagina')
  presenca: typeof import('../src/servidor/presenca')
  senha: typeof import('../src/servidor/senha')
  equipe: typeof import('../src/servidor/equipe')
  convite: typeof import('../src/servidor/convite')
  tarefas: typeof import('../src/servidor/tarefas')
  permissao: typeof import('../src/servidor/permissao')
}

const raiz = join(import.meta.dirname, '..')
const SENHA = 'senha-da-loja-v'
const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows

const sessao = (usuarioId: string, acessos: { papel: Papel; unidadeId: string | null }[], orgId = 'org-v'): Sessao => ({
  orgId,
  usuarioId,
  nome: usuarioId,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})

/** Entra de verdade e devolve o valor do cookie que o navegador guardaria. */
async function entrarE(slug: string, email: string): Promise<string> {
  const r = await m.autenticacao.entrar(slug, email, SENHA, null)
  if (!r.ok) throw new Error(`não entrou: ${JSON.stringify(r)}`)
  await m.sessao.abrirSessao(slug, r.sessao)
  const valor = pote.gravados.get(`norte_sessao_${slug}`)!
  pote.gravados.clear()
  return valor
}

/** Abre uma "tela" com este cookie. */
async function comCookie(slug: string, valor: string) {
  pote.cookie = `norte_sessao_${slug}=${valor}`
  return m.pagina.conferirSessao(slug)
}

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  process.env.SEGREDO_SESSAO = 'y'.repeat(48)
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
    autenticacao: await import('../src/servidor/autenticacao'),
    sessao: await import('../src/servidor/sessao'),
    pagina: await import('../src/servidor/pagina'),
    presenca: await import('../src/servidor/presenca'),
    senha: await import('../src/servidor/senha'),
    equipe: await import('../src/servidor/equipe'),
    convite: await import('../src/servidor/convite'),
    tarefas: await import('../src/servidor/tarefas'),
    permissao: await import('../src/servidor/permissao'),
  }

  const hash = await m.senha.guardarSenha(SENHA)
  // Plano Grátis: UMA vaga — o caso em que a vaga tomada importa.
  await db.exec(`
    insert into orgs (id, nome, slug, plano, situacao, atualizada_em, configurada_em) values
      ('org-v', 'Loja V', 'loja-v', 'GRATIS', 'ATIVA', now(), now()),
      ('org-r', 'Rede R', 'rede-r', 'REDE', 'ATIVA', now(), now());
    insert into unidades (id, org_id, nome, atualizada_em) values
      ('uni-v1', 'org-v', 'Única', now()),
      ('uni-r1', 'org-r', 'Centro', now()),
      ('uni-r2', 'org-r', 'Sul', now());
  `)
  for (const [id, org, nome, email] of [
    ['usr-ana', 'org-v', 'Ana Caixa', 'ana@v.test'],
    ['usr-bia', 'org-v', 'Bia Caixa', 'bia@v.test'],
    ['usr-sup', 'org-v', 'Suporte Norte', 'suporte@norte.test'],
    ['usr-dona', 'org-r', 'Dora Dona', 'dora@r.test'],
    ['usr-ger', 'org-r', 'Gil Gerente', 'gil@r.test'],
    ['usr-bal', 'org-r', 'Beto Balcão', 'beto@r.test'],
    ['usr-cont', 'org-r', 'Caio Contador', 'caio@r.test'],
    ['usr-rsup', 'org-r', 'Suporte Norte', 'suporte@norte.test'],
  ] as const) {
    await db.query(
      `insert into usuarios (id, org_id, nome, email, senha_hash, sessoes_desde, atualizado_em)
       values ($1, $2, $3, $4, $5, now() - interval '1 day', now())`,
      [id, org, nome, email, hash],
    )
  }
  await db.exec(`
    insert into acessos (id, org_id, usuario_id, unidade_id, papel, expira_em, motivo) values
      ('ac-ana', 'org-v', 'usr-ana', 'uni-v1', 'BALCAO', null, null),
      ('ac-bia', 'org-v', 'usr-bia', 'uni-v1', 'BALCAO', null, null),
      ('ac-sup', 'org-v', 'usr-sup', null, 'SUPORTE', now() + interval '1 day', 'chamado 12'),
      ('ac-dona', 'org-r', 'usr-dona', null, 'DONO', null, null),
      ('ac-ger', 'org-r', 'usr-ger', 'uni-r1', 'GERENTE', null, null),
      ('ac-bal', 'org-r', 'usr-bal', 'uni-r1', 'BALCAO', null, null),
      ('ac-cont', 'org-r', 'usr-cont', null, 'CONTADOR', null, null),
      ('ac-rsup', 'org-r', 'usr-rsup', null, 'SUPORTE', now() + interval '1 day', 'chamado 99: conferir o caixa');
  `)
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

beforeEach(() => {
  pote.cookie = ''
  pote.gravados.clear()
  pote.extras.clear()
})

// ─────────────────────────────────────────────────────────────
// 1. A VAGA VALE DEPOIS DO LOGIN
// ─────────────────────────────────────────────────────────────

describe('a sessão presa à vaga', () => {
  it('a marca só confere com a mesma presença', () => {
    const desde = new Date('2026-09-27T12:00:00.123Z')
    const marca = m.presenca.marcaDaVaga(desde)
    expect(m.presenca.vagaConfere({ desde }, marca)).toBe(true)
    expect(m.presenca.vagaConfere({ desde: new Date(desde.getTime() + 1) }, marca)).toBe(false)
    expect(m.presenca.vagaConfere(null, marca)).toBe(false)
    expect(m.presenca.vagaConfere({ desde }, null)).toBe(false)
  })

  it('quem perdeu a vaga para outra pessoa cai na próxima tela, com a frase certa', async () => {
    const ana = await entrarE('loja-v', 'ana@v.test')
    expect((await comCookie('loja-v', ana)).sessao?.usuarioId).toBe('usr-ana')

    // Ana parou há 15 minutos: a vaga pode ser tomada.
    await db.exec(`update presencas set ultimo_sinal = now() - interval '15 minutes' where usuario_id = 'usr-ana'`)
    const bia = await entrarE('loja-v', 'bia@v.test')

    const r = await comCookie('loja-v', ana)
    expect(r.sessao).toBeNull()
    expect(r.motivo).toBe('vaga')
    expect(m.pagina.enderecoDeEntrar('loja-v', r.motivo)).toBe('/loja-v/entrar?saiu=vaga')
    // e a Bia, que entrou, segue dentro
    expect((await comCookie('loja-v', bia)).sessao?.usuarioId).toBe('usr-bia')
  })

  it('a mesma pessoa em dois aparelhos segura UMA vaga, e as duas sessões valem', async () => {
    const um = await entrarE('loja-v', 'bia@v.test')
    const dois = await entrarE('loja-v', 'bia@v.test')
    expect((await comCookie('loja-v', um)).sessao).not.toBeNull()
    expect((await comCookie('loja-v', dois)).sessao).not.toBeNull()
    expect(await linhas(`select 1 from presencas where org_id = 'org-v'`)).toHaveLength(1)
  })

  it('sair devolve a vaga e mata o cookie no servidor (uma cópia dele não entra mais)', async () => {
    const bia = await entrarE('loja-v', 'bia@v.test')
    await m.presenca.liberarVaga('org-v', 'usr-bia')
    const r = await comCookie('loja-v', bia)
    expect(r.sessao).toBeNull()
    // Não foi ninguém que tomou: é "entre de novo", não "sua vaga foi usada".
    expect(r.motivo).toBe('saiu')
  })

  it('cookie de antes da vaga ir no cookie não vale (entra de novo)', async () => {
    await entrarE('loja-v', 'bia@v.test')
    const corpo = Buffer.from(
      JSON.stringify({
        orgId: 'org-v',
        usuarioId: 'usr-bia',
        nome: 'Bia Caixa',
        acessos: [{ papel: 'BALCAO', unidadeId: 'uni-v1' }],
        nasceu: Date.now(),
        exp: Date.now() + 3600_000,
      }),
    ).toString('base64url')
    const { createHmac } = await import('node:crypto')
    const ass = createHmac('sha256', process.env.SEGREDO_SESSAO!).update(`loja-v.${corpo}`).digest('base64url')
    const r = await comCookie('loja-v', `${corpo}.${ass}`)
    expect(r.sessao).toBeNull()
    expect(r.motivo).toBe('saiu')
  })

  it('o suporte (só SUPORTE) entra sem vaga e a sessão vale sem presença', async () => {
    await db.exec(`update presencas set ultimo_sinal = now() where org_id = 'org-v'`)
    const sup = await entrarE('loja-v', 'suporte@norte.test')
    const r = await comCookie('loja-v', sup)
    expect(r.sessao?.usuarioId).toBe('usr-sup')
    expect(await linhas(`select 1 from presencas where usuario_id = 'usr-sup'`)).toHaveLength(0)
  })

  it('contar e ocupar na mesma transação: dois logins seguidos não passam do teto', async () => {
    await db.exec(`delete from presencas where org_id = 'org-v'`)
    const agora = new Date()
    const a = await m.presenca.ocuparVaga('org-v', 'GRATIS', { usuarioId: 'usr-ana', ehDono: false }, agora)
    const b = await m.presenca.ocuparVaga('org-v', 'GRATIS', { usuarioId: 'usr-bia', ehDono: false }, agora)
    expect(a.pode).toBe(true)
    expect(a.vaga).toBeTruthy()
    expect(b.pode).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// 2. O CAMINHO DO LIVRO DO SUPORTE NÃO SE FORJA
// ─────────────────────────────────────────────────────────────

describe('o carimbo do caminho', () => {
  it('só o caminho com o selo do servidor é aceito', async () => {
    const { selarCaminho, caminhoCarimbado } = await import('../src/servidor/carimbo')
    const selo = selarCaminho('/loja-v/clientes')!
    expect(caminhoCarimbado('/loja-v/clientes', selo)).toBe('/loja-v/clientes')
    expect(caminhoCarimbado('/loja-v/inicio', selo)).toBeNull()
    expect(caminhoCarimbado('/loja-v/inicio', null)).toBeNull()
    expect(caminhoCarimbado('/loja-v/inicio', 'inventado')).toBeNull()
  })

  it('o proxy troca o caminho e o selo que o navegador mandou', async () => {
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('../src/proxy')
    const { caminhoCarimbado } = await import('../src/servidor/carimbo')
    const req = new NextRequest('http://localhost/loja-v/clientes?q=Maria', {
      headers: { 'x-norte-caminho': '/loja-v/inicio', 'x-norte-caminho-selo': 'inventado' },
    })
    const resp = proxy(req)
    const caminho = resp.headers.get('x-middleware-request-x-norte-caminho')
    const selo = resp.headers.get('x-middleware-request-x-norte-caminho-selo')
    expect(caminho).toBe('/loja-v/clientes')
    expect(caminhoCarimbado(caminho, selo)).toBe('/loja-v/clientes')
  })

  it('pré-carga forjada (sem selo) vai para o livro como "não confirmada"', async () => {
    const sup = await entrarE('loja-v', 'suporte@norte.test')
    pote.extras.set('x-norte-caminho', '/loja-v/inicio')
    pote.extras.set('purpose', 'prefetch')
    const r = await comCookie('loja-v', sup)
    expect(r.sessao).not.toBeNull()
    const livro = await linhas<{ alvo_nome: string }>(
      `select alvo_nome from auditoria where acao = 'suporte.acessou' and usuario_id = 'usr-sup' order by criado_em desc limit 1`,
    )
    expect(livro[0]?.alvo_nome).toBe('/loja-v (pré-carregamento; tela não confirmada)')
  })
})

// ─────────────────────────────────────────────────────────────
// 3. DESTRANCAR A TELA PASSA PELO FREIO DO LOGIN
// ─────────────────────────────────────────────────────────────

describe('destrancar a tela', () => {
  it('senha errada conta no freio do login; na sexta, manda sair', async () => {
    await db.exec(`delete from presencas where org_id = 'org-r'; delete from tentativas_login where org_id = 'org-r'`)
    const beto = await entrarE('rede-r', 'beto@r.test')
    pote.cookie = `norte_sessao_rede-r=${beto}`
    const destrancarAcao = (slug: string, senha: string) => m.pagina.destrancar(slug, senha, '10.0.0.9')

    expect(await destrancarAcao('rede-r', SENHA)).toEqual({ ok: true })
    for (let i = 0; i < 5; i++) {
      const r = await destrancarAcao('rede-r', 'errada-' + i)
      expect(r.ok).toBe(false)
      expect(r.sair).toBeFalsy()
    }
    // Bloqueada: nem a senha certa passa, e a tela sai.
    const r = await destrancarAcao('rede-r', SENHA)
    expect(r).toMatchObject({ ok: false, sair: true })
    expect(r.erro).toMatch(/Muitas tentativas/)
    // E o login do mesmo e-mail está segurado junto.
    expect(await m.autenticacao.entrar('rede-r', 'beto@r.test', SENHA, null)).toMatchObject({ ok: false, motivo: 'muitas_tentativas' })
    await db.exec(`delete from tentativas_login where org_id = 'org-r'`)
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────
// 4. QUEM SÓ LÊ NÃO ESCREVE; QUEM É DE UMA LOJA NÃO MANDA NA EMPRESA
// ─────────────────────────────────────────────────────────────

const DONA = sessao('usr-dona', [{ papel: 'DONO', unidadeId: null }], 'org-r')
const GERENTE = sessao('usr-ger', [{ papel: 'GERENTE', unidadeId: 'uni-r1' }], 'org-r')
const BALCAO = sessao('usr-bal', [{ papel: 'BALCAO', unidadeId: 'uni-r1' }], 'org-r')
const CONTADOR = sessao('usr-cont', [{ papel: 'CONTADOR', unidadeId: null }], 'org-r')
const SUPORTE = sessao('usr-rsup', [{ papel: 'SUPORTE', unidadeId: null }], 'org-r')

describe('dono é da empresa inteira', () => {
  it('acesso de DONO preso a uma loja não configura a empresa nem o assistente', () => {
    const donoDeLoja = sessao('x', [{ papel: 'DONO', unidadeId: 'uni-r1' }], 'org-r')
    expect(m.permissao.pode(donoDeLoja, 'empresa.configurar')).toBe(false)
    expect(m.permissao.pode(donoDeLoja, 'empresa.configurar', 'uni-r1')).toBe(false)
    expect(m.permissao.pode(donoDeLoja, 'agente.configurar')).toBe(false)
    expect(m.permissao.unidadesQuePodem(donoDeLoja, 'empresa.configurar')).toEqual([])
    // o resto, na loja dele, continua
    expect(m.permissao.pode(donoDeLoja, 'financeiro.lancar', 'uni-r1')).toBe(true)
    expect(m.permissao.pode(DONA, 'empresa.configurar')).toBe(true)
  })

  it('a equipe e o convite não criam dono preso a uma loja', async () => {
    const r = await m.equipe.mudarAcesso(DONA, 'usr-bal', { papel: 'DONO', unidadeId: 'uni-r1' })
    expect(r).toEqual({ ok: false, motivo: m.equipe.DONO_SO_DA_EMPRESA })
    await expect(
      m.convite.convidar(DONA, { email: 'novo@r.test', papel: 'DONO', unidadeId: 'uni-r1' }, 'http://x/rede-r'),
    ).rejects.toThrow(/empresa inteira/)
  })

  it('a recusa fala o nome do papel, não o código do banco', async () => {
    const r = await m.equipe.mudarAcesso(GERENTE, 'usr-bal', { papel: 'FINANCEIRO', unidadeId: 'uni-r1' })
    expect(r).toEqual({ ok: false, motivo: 'Você não pode dar o acesso de Financeiro nesta loja.' })
    await expect(
      m.convite.convidar(GERENTE, { email: 'b2@r.test', papel: 'BALCAO', unidadeId: null }, 'http://x/rede-r'),
    ).rejects.toThrow('Você não pode dar o acesso de Balcão para a empresa inteira.')
  })
})

describe('telefone de quem só lê', () => {
  it('suporte e contador não cadastram nem o próprio telefone', async () => {
    for (const s of [SUPORTE, CONTADOR]) {
      const r = await m.equipe.mudarTelefone(s, s.usuarioId, '(71) 98888-7777')
      expect(r.ok).toBe(false)
    }
    expect(await linhas(`select 1 from usuarios where id in ('usr-rsup', 'usr-cont') and telefone is not null`)).toHaveLength(0)
    expect((await m.equipe.mudarTelefone(BALCAO, 'usr-bal', '(71) 98888-7777')).ok).toBe(true)
  })
})

describe('o acesso do suporte, pela dona', () => {
  it('o gerente não corta; a dona corta, e a sessão do suporte cai', async () => {
    expect((await m.equipe.cortarAcessoDoSuporte(GERENTE, 'usr-rsup')).ok).toBe(false)
    const r = await m.equipe.cortarAcessoDoSuporte(DONA, 'usr-rsup')
    expect(r).toEqual({ ok: true })
    // venceu agora (era amanhã; folga de horas pelo fuso da coluna sem fuso)
    expect(await linhas(`select 1 from acessos where id = 'ac-rsup' and expira_em < now() + interval '6 hours'`)).toHaveLength(1)
    expect(await linhas(`select 1 from auditoria where acao = 'equipe.suporte.cortou' and alvo_id = 'usr-rsup'`)).toHaveLength(1)
    // de novo: nada valendo para cortar
    expect((await m.equipe.cortarAcessoDoSuporte(DONA, 'usr-rsup')).ok).toBe(false)
  })
})

describe('o próprio nome', () => {
  it('troca, com linha no livro; suporte não troca', async () => {
    expect(await m.equipe.mudarMeuNome(BALCAO, '  Beto   da Silva ')).toEqual({ ok: true, nome: 'Beto da Silva' })
    expect((await linhas<{ nome: string }>(`select nome from usuarios where id = 'usr-bal'`))[0]!.nome).toBe('Beto da Silva')
    expect((await m.equipe.mudarMeuNome(BALCAO, 'x')).ok).toBe(false)
    expect((await m.equipe.mudarMeuNome(SUPORTE, 'Outro Nome')).ok).toBe(false)
  })
})

describe('o quadro de tarefas', () => {
  let quadroEmpresa: string
  let tarefa: string

  beforeAll(async () => {
    quadroEmpresa = (await m.tarefas.criarQuadro(DONA, { nome: 'Da empresa', unidadeId: null })).id
    tarefa = (await m.tarefas.criarTarefa(DONA, { quadroId: quadroEmpresa, grupo: 'Esta semana', titulo: 'Contar o estoque' })).id
  })

  it('o gerente de uma loja não mexe no quadro da empresa inteira', async () => {
    await expect(m.tarefas.alterarQuadro(GERENTE, quadroEmpresa, { nome: 'Meu' })).rejects.toThrow(/permissão/i)
    await expect(m.tarefas.arquivarQuadro(GERENTE, quadroEmpresa)).rejects.toThrow(/permissão/i)
    await expect(m.tarefas.criarQuadro(GERENTE, { nome: 'Outro da empresa', unidadeId: null })).rejects.toThrow(/permissão/i)
    await expect(m.tarefas.criarTarefa(GERENTE, { quadroId: quadroEmpresa, grupo: 'Esta semana', titulo: 'x' })).rejects.toThrow(
      /permissão/i,
    )
    // no quadro da loja dele, pode
    const daLoja = await m.tarefas.criarQuadro(GERENTE, { nome: 'Do centro', unidadeId: 'uni-r1' })
    expect(daLoja.id).toBeTruthy()
  })

  it('o suporte vê o quadro, mas não marca tarefa como feita', async () => {
    await expect(m.tarefas.moverTarefa(SUPORTE, tarefa, 'FEITO')).rejects.toThrow(/permissão/i)
    expect(m.tarefas.podeMexerNaTarefa(SUPORTE, { responsavelId: null }, null)).toBe(false)
    // quem é da loja marca a tarefa sem responsável do quadro da empresa
    await m.tarefas.moverTarefa(BALCAO, tarefa, 'EM_ANDAMENTO')
    expect((await linhas<{ situacao: string }>(`select situacao from tarefas where id = $1`, [tarefa]))[0]!.situacao).toBe(
      'EM_ANDAMENTO',
    )
  })
})

// ─────────────────────────────────────────────────────────────
// 5. O LIVRO EM PALAVRAS DE GENTE
// ─────────────────────────────────────────────────────────────

describe('o antes → depois da Auditoria', () => {
  it('campo e valor como a tela mostra, sem código de banco', async () => {
    const { resumoDaMudanca } = await import('../src/app/[empresa]/auditoria/mudanca')
    const lojas = new Map([['uni-r1', 'Centro']])
    const preco = resumoDaMudanca({ precoVista: 12.5 }, { precoVista: 14 })!
    expect(preco).toMatch(/^preço à vista: R\$\s12,50 → R\$\s14,00$/)
    expect(resumoDaMudanca({ papel: 'BALCAO', unidadeId: 'uni-r1' }, { papel: 'GERENTE', unidadeId: null }, lojas)).toBe(
      'papel: Balcão → Gerente · loja: Centro → todas as lojas',
    )
    expect(resumoDaMudanca({ ativo: true }, { ativo: false })).toBe('situação: ativo → sem acesso')
    expect(resumoDaMudanca({ situacao: 'A_FAZER' }, { situacao: 'EM_ANDAMENTO' })).toBe('situação: a fazer → em andamento')
    expect(resumoDaMudanca({ prazo: '2026-09-10' }, { prazo: '2026-09-12' })).toBe('prazo: 10/09/2026 → 12/09/2026')
    // id interno não aparece; sem mudança legível, nada
    expect(resumoDaMudanca({ responsavelId: 'a' }, { responsavelId: 'b' })).toBeNull()
    expect(resumoDaMudanca(null, { a: 1 })).toBeNull()
  })
})
