// As campanhas com banco de verdade (PGlite), em duas partes:
//
//   1. as PAREDES: RLS nas cinco tabelas novas (uma empresa não lê nem grava
//      campanha, execução, passo, ajuste ou mídia da outra), o gatilho de FK
//      entre empresas, e o índice "uma campanha viva por telefone";
//   2. o CAMINHO INTEIRO por `receberDeCliente` e pelo relógio, com o canal
//      de mentira: a frase abre, a resposta anda, o relógio acorda, "parar"
//      tira (e confirma uma vez), a frase de outra campanha troca de funil, e a conversa com
//      alguém da loja (`ConversaAgente.humanoAte`) cala as campanhas — nos
//      dois sentidos: quem está com humano não entra, e "Passar para uma
//      pessoa" grava o mesmo campo.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco, comoApp } from './banco'
import type { Sessao } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  entrada: typeof import('../src/servidor/campanhas/entrada')
  execucao: typeof import('../src/servidor/campanhas/execucao')
  admin: typeof import('../src/servidor/campanhas/admin')
  canal: typeof import('../src/servidor/assistente/canal')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-ana', nome: 'Ana', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] } as Sessao

const grafo = (nodes: object[], edges: object[]) => JSON.stringify({ nodes, edges })
const no = (id: string, tipo: string, dados: object = {}) => ({ id, tipo, x: 0, y: 0, dados })
const liga = (de: string, para: string, saida = 'saida') => ({ id: `${de}-${saida}-${para}`, de, saida, para })

const CATALOGO = grafo(
  [
    no('inicio', 'inicio'),
    no('m1', 'mensagem', { textos: ['Oi, {primeiro_nome}! Quer o catálogo? sim ou não'], digitandoSeg: 0 }),
    no('w', 'aguardar_resposta', { quantidade: 1, unidade: 'h' }),
    no('c', 'condicao', { regras: [{ id: 'sim', rotulo: 'Sim', palavras: ['sim'] }] }),
    no('p', 'intervalo', { quantidade: 30, unidade: 'min', soHorarioLoja: false, aoResponder: 'esperar' }),
    no('f', 'fim', { texto: 'Aqui está o catálogo.' }),
    no('h', 'passar_para_pessoa', { para: 'donos', usuarioIds: [], mensagemContato: 'Já chamei alguém da loja.' }),
  ],
  [liga('inicio', 'm1'), liga('m1', 'w'), liga('w', 'c', 'respondeu'), liga('c', 'p', 'sim'), liga('c', 'h', 'outro'), liga('p', 'f')],
)

const CUPOM = grafo([no('inicio', 'inicio'), no('m', 'mensagem', { textos: ['Seu cupom: FELIZ10'], digitandoSeg: 0 }), no('w', 'intervalo', { quantidade: 1, unidade: 'd' })], [liga('inicio', 'm'), liga('m', 'w')])

const gatilho = (frases: string[], reentrada = 'nunca') => JSON.stringify({ tipo: 'frase', frases, anuncioIds: [], reentrada })

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente}', now()),
    ('org-b', 'Vizinha B', 'vizinha-b', 'REDE', 'ATIVA', '{agente}', now()),
    ('org-c', 'Sem Plano', 'sem-plano', 'BALCAO', 'ATIVA', '{agente}', now());

  insert into unidades (id, org_id, nome, horario, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro A', 'Seg a sex 9h-18h', now()),
    ('uni-b1', 'org-b', 'Sul B', null, now());

  insert into usuarios (id, org_id, nome, email, telefone, atualizado_em) values
    ('usr-ana', 'org-a', 'Ana Dona', 'ana@a.com', '(71) 99999-0001', now()),
    ('usr-bia', 'org-b', 'Bia Vizinha', 'bia@b.com', '(11) 97777-0003', now());

  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('ac-ana', 'org-a', 'usr-ana', null, 'DONO'),
    ('ac-bia', 'org-b', 'usr-bia', null, 'DONO');

  insert into agentes (id, org_id, nome, ativo, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, now()),
    ('ag-b', 'org-b', 'Bob', true, now());

  insert into campanhas (id, org_id, nome, ativa, gatilho, grafo, atualizada_em) values
    ('cp-cat', 'org-a', 'Catálogo', true, '${gatilho(['quero o catálogo'])}', '${CATALOGO}', now()),
    ('cp-cupom', 'org-a', 'Cupom', true, '${gatilho(['cupom'])}', '${CUPOM}', now()),
    ('cp-b', 'org-b', 'Da vizinha', true, '${gatilho(['catálogo'])}', '${CUPOM}', now()),
    ('cp-c', 'org-c', 'Fora do plano', true, '${gatilho(['catálogo'])}', '${CUPOM}', now());

  insert into midias (id, org_id, nome, mime, tipo, tamanho, sha256, dados) values
    ('md-b', 'org-b', 'foto.jpg', 'image/jpeg', 'imagem', 3, 'abc', '\\xffd8ff');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 56000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    entrada: await import('../src/servidor/campanhas/entrada'),
    execucao: await import('../src/servidor/campanhas/execucao'),
    admin: await import('../src/servidor/campanhas/admin'),
    canal: await import('../src/servidor/assistente/canal'),
    banco: await import('../src/servidor/banco'),
  }
  // Teste não espera o "digitando" nem o ritmo entre mensagens.
  m.execucao.relogio.dormir = async () => {}
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

// ─────────────────────────────────────────────────────────────
// AS PAREDES
// ─────────────────────────────────────────────────────────────

describe('RLS nas tabelas das campanhas', () => {
  it('uma empresa não enxerga campanha nem mídia da outra', async () => {
    const a = await comoApp(db, 'org-a', (tx) => tx.query<{ id: string }>(`select id from campanhas order by id`))
    expect(a.rows.map((r) => r.id)).toEqual(['cp-cat', 'cp-cupom'])
    const midias = await comoApp(db, 'org-a', (tx) => tx.query(`select id from midias`))
    expect(midias.rows).toEqual([])
    const semEmpresa = await comoApp(db, null, (tx) => tx.query(`select id from campanhas`))
    expect(semEmpresa.rows).toEqual([])
  })

  it('não grava linha com a empresa de outra', async () => {
    for (const sql of [
      `insert into campanhas (id, org_id, nome, gatilho, grafo, atualizada_em) values ('x', 'org-b', 'x', '{}', '{}', now())`,
      `insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id) values ('x', 'org-b', 'cp-b', '1188880000', '5511988880000', 'inicio')`,
      `insert into campanha_ajustes (id, org_id, atualizada_em) values ('x', 'org-b', now())`,
      `insert into midias (id, org_id, nome, mime, tipo, tamanho, sha256, dados) values ('x', 'org-b', 'a', 'image/png', 'imagem', 1, 'x', '\\x00')`,
    ]) {
      // O RLS recusa a linha; quando ela aponta para uma campanha da outra, o
      // gatilho de FK recusa antes (para a A, a campanha da B nem existe).
      await expect(comoApp(db, 'org-a', (tx) => tx.query(sql)), sql).rejects.toThrow(/row-level security|referencia de outra empresa/)
    }
  })

  it('a execução da A não aponta para campanha da B, nem o passo para execução da B', async () => {
    await expect(
      db.query(`insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id) values ('x-fk', 'org-a', 'cp-b', '7188880000', '557188880000', 'inicio')`),
    ).rejects.toThrow(/referencia de outra empresa/)
    await db.query(`insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id, status) values ('x-b', 'org-b', 'cp-b', '1188880009', '5511988880009', 'inicio', 'concluida')`)
    await expect(
      db.query(`insert into campanha_passos (id, org_id, execucao_id, campanha_id, node_id, tipo) values ('p-fk', 'org-a', 'x-b', 'cp-cat', 'inicio', 'inicio')`),
    ).rejects.toThrow(/referencia de outra empresa/)
  })

  it('uma campanha VIVA por telefone; encerrada não conta', async () => {
    const ins = (id: string, status: string) =>
      comoApp(db, 'org-a', (tx) =>
        tx.query(`insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id, status) values ($1, 'org-a', 'cp-cupom', '7133330000', '557133330000', 'inicio', $2)`, [id, status]),
      )
    await ins('v1', 'esperando')
    await expect(ins('v2', 'aguardando_resposta')).rejects.toThrow(/campanha_execucoes_uma_viva/)
    await ins('v3', 'concluida')
    await ins('v4', 'cancelada')
    // mesma pessoa em OUTRA empresa não esbarra
    await comoApp(db, 'org-b', (tx) =>
      tx.query(`insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id, status) values ('vb', 'org-b', 'cp-b', '7133330000', '557133330000', 'inicio', 'esperando')`),
    )
    await comoApp(db, 'org-a', (tx) => tx.query(`update campanha_execucoes set status = 'concluida' where id = 'v1'`))
    await ins('v5', 'rodando')
    await comoApp(db, 'org-a', (tx) => tx.query(`delete from campanha_execucoes where telefone = '7133330000'`))
  })
})

// ─────────────────────────────────────────────────────────────
// O CAMINHO INTEIRO
// ─────────────────────────────────────────────────────────────

const execucoes = async (tel: string) =>
  (await db.query<{ campanha_id: string; status: string; motivo_fim: string | null; node_id: string }>(
    `select campanha_id, status, motivo_fim, node_id from campanha_execucoes where telefone = $1 order by iniciada_em, id`,
    [tel],
  )).rows

describe('uma mensagem de cliente', () => {
  const T0 = new Date('2026-09-25T15:00:00Z')
  const msg = (texto: string, canal: InstanceType<typeof m.canal.CanalFalso>, telefone = '5571988880001', agora = T0, orgId = 'org-a') =>
    m.entrada.receberDeCliente({ orgId, agenteId: 'ag-a', telefone, nome: 'Maria Souza', texto, canal, agora })

  it('conversa solta é da loja: tratou = false, nada sai', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('bom dia, vocês abrem sábado?', canal)).toEqual({ tratou: false })
    expect(canal.enviadas).toEqual([])
  })

  it('a frase abre; a resposta anda; o relógio acorda; o fim encerra; não entra de novo', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('Oi! Quero o CATÁLOGO', canal)).toEqual({ tratou: true })
    expect(canal.enviadas).toEqual([{ numero: '5571988880001', texto: 'Oi, Maria! Quer o catálogo? sim ou não' }])
    expect(await execucoes('7188880001')).toMatchObject([{ status: 'aguardando_resposta', node_id: 'w' }])

    expect(await msg('sim', canal, '5571988880001', new Date(T0.getTime() + 60_000))).toEqual({ tratou: true })
    expect(await execucoes('7188880001')).toMatchObject([{ status: 'esperando', node_id: 'p' }])

    // O relógio antes da hora não faz nada; depois, entrega o fim.
    const tick = (quando: Date) =>
      m.execucao.tickCampanhasCom(quando, {
        empresas: async () => [{ id: 'org-a', slug: 'loja-a' }],
        apta: async () => true,
        canalDe: async () => canal,
      })
    expect((await tick(new Date(T0.getTime() + 10 * 60_000))).acordadas).toBe(0)
    expect((await tick(new Date(T0.getTime() + 32 * 60_000))).acordadas).toBe(1)
    expect(canal.enviadas.at(-1)?.texto).toBe('Aqui está o catálogo.')
    expect(await execucoes('7188880001')).toMatchObject([{ status: 'concluida', motivo_fim: 'fim' }])
    // Idempotente: bater de novo não manda nada.
    const antes = canal.enviadas.length
    await tick(new Date(T0.getTime() + 40 * 60_000))
    expect(canal.enviadas.length).toBe(antes)

    // Reentrada "nunca": a frase de novo não abre, e é da loja.
    expect(await msg('quero o catálogo', canal, '5571988880001', new Date(T0.getTime() + 3_600_000))).toEqual({ tratou: false })
    expect(canal.enviadas.length).toBe(antes)
  })

  it('o mesmo número escrito de outro jeito é a mesma pessoa', async () => {
    const canal = new m.canal.CanalFalso()
    // sem o 55 e sem o nono dígito: chave 7188880001, que já passou pelo catálogo
    expect(await msg('quero o catálogo', canal, '7188880001', new Date(T0.getTime() + 7_200_000))).toEqual({ tratou: false })
  })

  it('"parar" sozinho tira da campanha e manda UMA confirmação (a lista permanente está em lgpd-banco.test.ts)', async () => {
    const canal = new m.canal.CanalFalso()
    await msg('quero o catálogo', canal, '5571988880002')
    expect(await msg('Parar', canal, '5571988880002')).toEqual({ tratou: true })
    expect(canal.enviadas).toHaveLength(2)
    expect(canal.enviadas[1]!.texto).toMatch(/não recebe mais ofertas.*VOLTAR/)
    expect(await execucoes('7188880002')).toMatchObject([{ status: 'cancelada', motivo_fim: 'parou' }])
  })

  it('a frase de outra campanha troca de funil', async () => {
    const canal = new m.canal.CanalFalso()
    await msg('quero o catálogo', canal, '5571988880003')
    expect(await msg('e o cupom?', canal, '5571988880003')).toEqual({ tratou: true })
    expect(canal.enviadas.at(-1)?.texto).toBe('Seu cupom: FELIZ10')
    expect(await execucoes('7188880003')).toMatchObject([
      { campanha_id: 'cp-cat', status: 'cancelada', motivo_fim: 'outro_fluxo' },
      { campanha_id: 'cp-cupom', status: 'esperando' },
    ])
  })

  it('empresa fora do plano: campanha nenhuma, mesmo ativa', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('catálogo', canal, '5571988880004', T0, 'org-c')).toEqual({ tratou: false })
    expect(canal.enviadas).toEqual([])
  })
})

describe('alguém da loja com a conversa (humanoAte)', () => {
  const T0 = new Date('2026-09-25T15:00:00Z')

  it('com humanoAte no futuro, nenhuma campanha começa — e a viva sai (humano_assumiu)', async () => {
    const canal = new m.canal.CanalFalso()
    const e = (texto: string, agora: Date) =>
      m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5571977770001', nome: 'João', texto, canal, agora })
    expect(await e('quero o catálogo', T0)).toEqual({ tratou: true })

    // A loja escreveu pelo celular: o roteamento grava humanoAte (+24 h).
    await db.query(
      `insert into conversas_agente (id, org_id, agente_id, telefone, humano_ate) values ('cv-1', 'org-a', 'ag-a', '5571977770001', $1)`,
      [new Date(T0.getTime() + 24 * 3_600_000)],
    )
    const n = canal.enviadas.length
    expect(await e('sim', new Date(T0.getTime() + 60_000))).toEqual({ tratou: false })
    expect(canal.enviadas.length).toBe(n)
    expect(await execucoes('7177770001')).toMatchObject([{ status: 'cancelada', motivo_fim: 'humano_assumiu' }])
    // E a frase de outra campanha também não abre enquanto a pessoa da loja está com ela.
    expect(await e('cupom', new Date(T0.getTime() + 120_000))).toEqual({ tratou: false })
    // Passadas as 24 horas, a campanha volta a valer.
    expect(await e('cupom', new Date(T0.getTime() + 25 * 3_600_000))).toEqual({ tratou: true })
  })

  it('o relógio também não acorda quem ficou com uma pessoa da loja', async () => {
    const canal = new m.canal.CanalFalso()
    await m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5571977770002', nome: null, texto: 'cupom', canal, agora: T0 })
    expect(await execucoes('7177770002')).toMatchObject([{ status: 'esperando' }])
    // A loja escreveu pelo celular durante a espera de um dia (número gravado
    // do outro jeito: sem o 55 — a chave é a mesma).
    await db.query(
      `insert into conversas_agente (id, org_id, agente_id, telefone, humano_ate) values ('cv-2', 'org-a', 'ag-a', '71977770002', $1)`,
      [new Date(T0.getTime() + 10 * 86_400_000)],
    )
    const n = canal.enviadas.length
    const r = await m.execucao.tickCampanhasCom(new Date(T0.getTime() + 2 * 86_400_000), {
      empresas: async () => [{ id: 'org-a', slug: 'loja-a' }],
      apta: async () => true,
      canalDe: async () => canal,
    })
    expect(r.falhas).toBe(0)
    expect(canal.enviadas.length).toBe(n)
    expect(await execucoes('7177770002')).toMatchObject([{ status: 'cancelada', motivo_fim: 'humano_assumiu' }])
  })

  it('"Passar para uma pessoa" avisa os donos e grava o MESMO humanoAte da conversa', async () => {
    const canal = new m.canal.CanalFalso()
    const e = (texto: string, agora: Date) =>
      m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5571966660001', nome: 'Paula', texto, canal, agora })
    await e('quero o catálogo', T0)
    // "talvez" não é "sim": vai por "outro" → passar para pessoa
    expect(await e('talvez, quanto custa?', new Date(T0.getTime() + 60_000))).toEqual({ tratou: true })
    const textos = canal.enviadas.map((x) => `${x.numero}: ${x.texto.split('\n')[0]}`)
    expect(textos).toContain('5571966660001: Já chamei alguém da loja.')
    expect(textos.some((t) => t.startsWith('5571999990001: *Paula* quer falar'))).toBe(true)
    expect(await execucoes('7166660001')).toMatchObject([{ status: 'concluida', motivo_fim: 'humano' }])

    const conversa = await db.query<{ humano_ate: Date; agente_id: string }>(`select humano_ate, agente_id from conversas_agente where telefone like '%66660001'`)
    expect(conversa.rows).toHaveLength(1)
    expect(conversa.rows[0]!.agente_id).toBe('ag-a')
    expect(new Date(conversa.rows[0]!.humano_ate).getTime()).toBeGreaterThan(T0.getTime())
    // Com a marca, a frase não reabre campanha nenhuma.
    expect(await e('cupom', new Date(T0.getTime() + 120_000))).toEqual({ tratou: false })
  })
})

describe('a tela', () => {
  it('lista com os números contados (o teste não conta)', async () => {
    const lista = await m.admin.listarCampanhas(DONA)
    const cat = lista.find((c) => c.id === 'cp-cat')!
    expect(cat.entraram).toBeGreaterThanOrEqual(5)
    expect(cat.paraPessoa).toBe(1)
    expect(cat.concluiram).toBe(1)
    expect(lista.some((c) => c.id === 'cp-b')).toBe(false)
  })

  it('criar nasce pausada; ativar recusa com pendência e com frase de outra ativa', async () => {
    const id = await m.admin.criarCampanha(DONA, 'Nova')
    const sem = await m.admin.ativarCampanha(DONA, id, true)
    expect(sem.ok).toBe(false)
    const dados = await m.admin.lerParaEditor(DONA, id)
    const salvo = await m.admin.salvarCampanha(DONA, id, {
      nome: 'Nova',
      gatilho: { tipo: 'frase', frases: ['Cupom'], anuncioIds: [], reentrada: 'nunca' },
      grafo: dados!.campanha.grafo,
    })
    expect(salvo.ok).toBe(true)
    const conflito = await m.admin.ativarCampanha(DONA, id, true)
    expect(conflito).toMatchObject({ ok: false })
    expect(conflito.ok === false && conflito.erro).toContain('cupom')
  })

  it('não apaga com gente dentro; testar usa o número de quem testa e não conta', async () => {
    const canal = new m.canal.CanalFalso()
    await m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5571955550001', nome: null, texto: 'quero o catálogo', canal, agora: new Date() })
    await expect(m.admin.apagarCampanha(DONA, 'cp-cat')).rejects.toThrow(/dentro desta campanha/)
    canal.enviadas.length = 0
    const r = await m.admin.testarCampanha(DONA, 'cp-cupom', canal)
    expect(r.ok).toBe(true)
    expect(canal.enviadas).toEqual([{ numero: '5571999990001', texto: 'Seu cupom: FELIZ10' }])
    const dentro = await m.admin.contatosDentro(DONA, 'cp-cupom')
    expect(dentro.some((d) => d.teste)).toBe(true)
    const livro = await db.query(`select acao from auditoria where org_id = 'org-a' and acao like 'campanha.%' order by criado_em`)
    expect(livro.rows.map((x) => (x as { acao: string }).acao)).toEqual(['campanha.criou', 'campanha.alterou', 'campanha.testou'])
  })
})
