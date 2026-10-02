// As correções de 27/09, com banco de verdade (PGlite numa porta, como em
// campanhas-banco.test.ts):
//
//   • PARAR/VOLTAR valem com o assistente DESLIGADO e com a porta FECHADA
//     (o QR desconectado) — grava, e só confirma se há por onde;
//   • o relógio não acorda campanha de loja com assistente desligado ou
//     WhatsApp desconectado;
//   • PARAR no meio do envio: a mensagem seguinte do mesmo bloco não sai;
//   • a trava é do relógio da máquina: a batida com o `agora` fixo não toma a
//     trava de quem está mandando;
//   • passou de 24 horas: só com aceite de ofertas; reativar a campanha
//     depois de uma pausa tira quem ficou parado;
//   • o teste do dono confere a lista e a porta;
//   • o recado automático respeita a lista;
//   • a chave antiga do telefone continua achada (e o VOLTAR a tira);
//   • envio 'incerto': sem deduplicação não repete; com ela, repete com a
//     MESMA chave.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao } from '../src/servidor/permissao'
import type { Canal, Envio } from '../src/servidor/assistente/canal'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  conversa: typeof import('../src/servidor/assistente/conversa')
  proprio: typeof import('../src/servidor/assistente/proprio')
  entrada: typeof import('../src/servidor/campanhas/entrada')
  execucao: typeof import('../src/servidor/campanhas/execucao')
  relogio: typeof import('../src/servidor/campanhas/relogio')
  admin: typeof import('../src/servidor/campanhas/admin')
  canal: typeof import('../src/servidor/assistente/canal')
  ofertas: typeof import('../src/servidor/ofertas')
  banco: typeof import('../src/servidor/banco')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-ana', nome: 'Ana', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] } as Sessao

const grafo = (nodes: object[], edges: object[]) => JSON.stringify({ nodes, edges })
const no = (id: string, tipo: string, dados: object = {}) => ({ id, tipo, x: 0, y: 0, dados })
const liga = (de: string, para: string, saida = 'saida') => ({ id: `${de}-${saida}-${para}`, de, saida, para })
const gatilho = (frases: string[]) => JSON.stringify({ tipo: 'frase', frases, anuncioIds: [], reentrada: 'sempre' })

const DUAS = grafo(
  [no('inicio', 'inicio'), no('m1', 'mensagem', { textos: ['primeira'], digitandoSeg: 0 }), no('m2', 'mensagem', { textos: ['segunda'], digitandoSeg: 0 })],
  [liga('inicio', 'm1'), liga('m1', 'm2')],
)
const ESPERA = grafo(
  [
    no('inicio', 'inicio'),
    no('m1', 'mensagem', { textos: ['Oi!'], digitandoSeg: 0 }),
    no('p', 'intervalo', { quantidade: 1, unidade: 'd', soHorarioLoja: false, aoResponder: 'esperar' }),
    no('m2', 'mensagem', { textos: ['Chegou a coleção nova.'], digitandoSeg: 0 }),
  ],
  [liga('inicio', 'm1'), liga('m1', 'p'), liga('p', 'm2')],
)

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente,farol}', now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-a1', 'org-a', 'Centro A', now());
  insert into usuarios (id, org_id, nome, email, telefone, telefone_confirmado, telefone_confirmado_em, atualizado_em) values
    ('usr-ana', 'org-a', 'Ana Dona', 'ana@a.com', '(71) 99999-0001', '7199990001', now(), now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-ana', 'org-a', 'usr-ana', null, 'DONO');
  insert into agentes (id, org_id, nome, ativo, canal, poderes, saudacao, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, 'ZAPI', '{recado.automatico}', 'Oi! Já vamos te atender.', now());
  insert into campanhas (id, org_id, nome, ativa, gatilho, grafo, atualizada_em) values
    ('cp-duas', 'org-a', 'Duas', true, '${gatilho(['duas mensagens'])}', '${DUAS}', now()),
    ('cp-espera', 'org-a', 'Espera', true, '${gatilho(['colecao'])}', '${ESPERA}', now());
  insert into clientes (id, org_id, nome, telefone, ofertas_whatsapp, atualizado_em) values
    ('cl-sim', 'org-a', 'Sônia Aceitou', '(71) 97000-0002', 'SIM', now()),
    ('cl-nao', 'org-a', 'Nina Nunca', '(71) 97000-0001', 'NAO_PERGUNTADO', now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 53000 + Math.floor(Math.random() * 2500)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    conversa: await import('../src/servidor/assistente/conversa'),
    proprio: await import('../src/servidor/assistente/proprio'),
    entrada: await import('../src/servidor/campanhas/entrada'),
    execucao: await import('../src/servidor/campanhas/execucao'),
    relogio: await import('../src/servidor/campanhas/relogio'),
    admin: await import('../src/servidor/campanhas/admin'),
    canal: await import('../src/servidor/assistente/canal'),
    ofertas: await import('../src/servidor/ofertas'),
    banco: await import('../src/servidor/banco'),
  }
  m.execucao.relogio.dormir = async () => {}
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const naLista = (chave: string) => linhas<{ origem: string }>(`select origem from optout_whatsapp where telefone = $1`, [chave])
const execucoes = (chave: string) =>
  linhas<{ id: string; status: string; motivo_fim: string | null; node_id: string; vars: Record<string, unknown> }>(
    `select id, status, motivo_fim, node_id, vars from campanha_execucoes where telefone = $1 order by iniciada_em, id`,
    [chave],
  )
let ids = 0
const msg = (telefone: string, texto: string) => ({ orgId: 'org-a', telefone, nome: 'Cliente', texto, idExterno: `id-${++ids}` })

// ─────────────────────────────────────────────────────────────

describe('PARAR com o assistente desligado ou a porta fechada', () => {
  it('assistente desligado: o PARAR grava e confirma; o da equipe não; o resto é ignorado', async () => {
    await db.query(`update agentes set ativo = false where id = 'ag-a'`)
    const canal = new m.canal.CanalFalso()
    expect(await m.conversa.processarMensagem(msg('5571988880001', 'quero parar'), { canal })).toEqual({ tipo: 'ignorada', motivo: 'empresa' })
    expect(await naLista('7188880001')).toEqual([{ origem: 'parar' }])
    expect(canal.enviadas).toEqual([{ numero: '5571988880001', texto: m.ofertas.RECADO_SAIU }])

    // A dona mandando "parar" para o número da loja não vira cliente que saiu.
    await m.conversa.processarMensagem(msg('5571999990001', 'parar'), { canal })
    expect(await naLista('7199990001')).toEqual([])

    // Conversa comum: nada sai, nada grava.
    await m.conversa.processarMensagem(msg('5571988880003', 'vocês abrem sábado?'), { canal })
    expect(canal.enviadas).toHaveLength(1)

    // E o VOLTAR também vale.
    await m.conversa.processarMensagem(msg('5571988880001', 'VOLTAR'), { canal })
    expect(await naLista('7188880001')).toEqual([])
    expect(canal.enviadas.at(-1)?.texto).toBe(m.ofertas.RECADO_VOLTOU)
    await db.query(`update agentes set ativo = true where id = 'ag-a'`)
  })

  it('porta fechada (a loja não está no QR): o PARAR que chegou pelo conector grava, sem confirmação', async () => {
    const canal = new m.canal.CanalFalso()
    const corpo = (id: string, texto: string) => ({ tipo: 'mensagem', telefone: '5571988880002', id, texto, nome: 'Ju' })
    // mensagem comum: descartada, como sempre
    expect(await m.proprio.receberDoConector('org-a', corpo('Q1', 'oi, tudo bem?'), { canal })).toEqual({ status: 200 })
    const p = await m.proprio.receberDoConector('org-a', corpo('Q2', 'PARE DE MANDAR'), { canal })
    expect(p.trabalho).toBeDefined()
    await p.trabalho!()
    expect(await naLista('7188880002')).toEqual([{ origem: 'parar' }])
    expect(canal.enviadas).toEqual([])
  })
})

describe('o relógio só roda com o assistente falando', () => {
  it('ligado e conectado roda; desligado ou desconectado, não', async () => {
    expect(await m.relogio.campanhasRodam('org-a')).toBe(true)
    await db.query(`update agentes set ativo = false where id = 'ag-a'`)
    expect(await m.relogio.campanhasRodam('org-a')).toBe(false)
    await db.query(`update agentes set ativo = true, canal = 'NENHUM' where id = 'ag-a'`)
    expect(await m.relogio.campanhasRodam('org-a')).toBe(false)
    // e o canal da empresa desconectada não sai por linha guardada nenhuma
    expect((await m.canal.canalPara({ id: 'org-a', slug: 'loja-a' })).real).toBe(false)
    await db.query(`update agentes set canal = 'ZAPI' where id = 'ag-a'`)
    expect(await m.relogio.campanhasRodam('org-a')).toBe(true)
  })
})

describe('PARAR no meio do envio', () => {
  it('a pessoa pede para sair enquanto a primeira mensagem sai: a segunda não vai', async () => {
    const enviadas: string[] = []
    const canal: Canal = {
      nome: 'teste',
      real: true,
      enviar: async (numero, texto) => {
        enviadas.push(texto)
        // Enquanto esta mensagem saía, a pessoa mandou PARAR (o webhook grava).
        if (texto === 'primeira') await m.ofertas.pararPeloWhatsapp('org-a', numero)
        return { ok: true }
      },
    }
    expect(await m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5571988880010', nome: 'Rui', texto: 'duas mensagens', canal })).toEqual({ tratou: true })
    expect(enviadas).toEqual(['primeira'])
    expect(await execucoes('7188880010')).toMatchObject([{ status: 'cancelada', motivo_fim: 'parou' }])
  })
})

describe('a trava é do relógio da máquina', () => {
  it('a batida com o `agora` lá na frente não toma a trava de quem está mandando agora', async () => {
    await db.query(
      `insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id, status, proximo_em, trava, trava_em, ultima_entrada_em)
       values ('ex-trava', 'org-a', 'cp-espera', '7188880011', '5571988880011', 'p', 'esperando', $1, 'de-outra-rodada', $2, $2)`,
      // As datas vão do Node (UTC), como o Prisma grava: o now() do banco de
      // teste segue o fuso da máquina.
      [new Date(Date.now() - 60_000), new Date()],
    )
    const amanha = new Date(Date.now() + 86_400_000)
    expect(await m.execucao.devidas('org-a', amanha)).not.toContain('ex-trava')
    const canal = new m.canal.CanalFalso()
    expect(await m.execucao.andar('org-a', 'ex-trava', { tipo: 'acordar' }, { canal, agora: amanha })).toBeNull()
    expect(canal.enviadas).toEqual([])
    // Trava de verdade velha (processo que morreu): aí sim, é de quem chegar.
    await db.query(`update campanha_execucoes set trava_em = $1 where id = 'ex-trava'`, [new Date(Date.now() - 10 * 60_000)])
    expect(await m.execucao.devidas('org-a', new Date())).toContain('ex-trava')
    await db.query(`delete from campanha_execucoes where id = 'ex-trava'`)
  })
})

describe('passou de 24 horas sem a pessoa escrever', () => {
  const parada = (id: string, chave: string, envio: string) =>
    db.query(
      `insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id, status, proximo_em, ultima_entrada_em, iniciada_em)
       values ($1, 'org-a', 'cp-espera', $2, $3, 'p', 'esperando', now() - interval '1 minute', now() - interval '3 days', now() - interval '3 days')`,
      [id, chave, envio],
    )

  it('sem aceite de ofertas, nada sai — em qualquer canal —, e a execução termina', async () => {
    await parada('ex-24-nao', '7170000001', '5571970000001')
    const canal = new m.canal.CanalFalso()
    const r = await m.execucao.andar('org-a', 'ex-24-nao', { tipo: 'acordar' }, { canal })
    expect(canal.enviadas).toEqual([])
    expect(r?.estado).toMatchObject({ status: 'erro', motivoFim: 'janela_fechada' })
  })

  it('com aceite, sai', async () => {
    await parada('ex-24-sim', '7170000002', '5571970000002')
    const canal = new m.canal.CanalFalso()
    await m.execucao.andar('org-a', 'ex-24-sim', { tipo: 'acordar' }, { canal })
    expect(canal.enviadas).toEqual([{ numero: '5571970000002', texto: 'Chegou a coleção nova.' }])
  })

  it('reativar depois de uma pausa: quem ficou parado há mais de 24 h sai; quem escreveu ontem fica', async () => {
    expect((await m.admin.ativarCampanha(DONA, 'cp-espera', false)).ok).toBe(true)
    await parada('ex-velha', '7170000003', '5571970000003')
    await db.query(
      `insert into campanha_execucoes (id, org_id, campanha_id, telefone, envio, node_id, status, proximo_em, ultima_entrada_em)
       values ('ex-nova', 'org-a', 'cp-espera', '7170000004', '5571970000004', 'p', 'esperando', now() + interval '1 hour', now() - interval '1 hour')`,
    )
    const r = await m.admin.ativarCampanha(DONA, 'cp-espera', true)
    expect(r).toMatchObject({ ok: true, encerradas: 1 })
    expect(await linhas(`select id, status, motivo_fim from campanha_execucoes where id in ('ex-velha', 'ex-nova') order by id`)).toEqual([
      { id: 'ex-nova', status: 'esperando', motivo_fim: null },
      { id: 'ex-velha', status: 'cancelada', motivo_fim: 'pausada' },
    ])
  })
})

describe('"Testar com meu número"', () => {
  it('não começa com o assistente desligado, nem para um número da lista', async () => {
    const canal = new m.canal.CanalFalso()
    await db.query(`update agentes set ativo = false where id = 'ag-a'`)
    expect(await m.admin.testarCampanha(DONA, 'cp-duas', canal)).toMatchObject({ ok: false, erro: expect.stringMatching(/desligado/) })
    await db.query(`update agentes set ativo = true, canal = 'NENHUM' where id = 'ag-a'`)
    expect(await m.admin.testarCampanha(DONA, 'cp-duas', canal)).toMatchObject({ ok: false, erro: expect.stringMatching(/desconectado/) })
    await db.query(`update agentes set canal = 'ZAPI' where id = 'ag-a'`)

    await db.query(`insert into optout_whatsapp (id, org_id, telefone, origem) values ('oo-dona', 'org-a', '7199990001', 'manual')`)
    expect(await m.admin.testarCampanha(DONA, 'cp-duas', canal)).toMatchObject({ ok: false, erro: expect.stringMatching(/não recebe ofertas/) })
    expect(canal.enviadas).toEqual([])
    await db.query(`delete from optout_whatsapp where id = 'oo-dona'`)
    expect(await m.admin.testarCampanha(DONA, 'cp-duas', canal)).toMatchObject({ ok: true })
    expect(canal.enviadas.map((e) => e.texto)).toEqual(['primeira', 'segunda'])
  })
})

describe('o recado automático', () => {
  it('não sai para quem está na lista; sai para os outros', async () => {
    const canal = new m.canal.CanalFalso()
    await db.query(`insert into optout_whatsapp (id, org_id, telefone, origem) values ('oo-rec', 'org-a', '7188880020', 'manual')`)
    expect(await m.conversa.processarMensagem(msg('5571988880020', 'bom dia, tem o vestido azul?'), { canal })).toEqual({ tipo: 'silencio', motivo: 'sem_ofertas' })
    expect(canal.enviadas).toEqual([])
    expect(await m.conversa.processarMensagem(msg('5571988880021', 'bom dia, tem o vestido azul?'), { canal })).toMatchObject({ tipo: 'recado', enviada: true })
  })
})

describe('a chave antiga do telefone', () => {
  it('o PARAR gravado com a chave antiga (sem o nove) continua valendo — e o VOLTAR tira', async () => {
    // Antes de 27/09 o celular (11) 9 3333-4444 era guardado como 1133334444.
    await db.query(`insert into optout_whatsapp (id, org_id, telefone, origem) values ('oo-antiga', 'org-a', '1133334444', 'parar')`)
    expect(await m.ofertas.estaNaLista('org-a', '11933334444')).toBe(true)
    const canal = new m.canal.CanalFalso()
    const e = (texto: string) => m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5511933334444', nome: null, texto, canal })
    expect(await e('duas mensagens')).toEqual({ tratou: false })
    expect(canal.enviadas).toEqual([])
    expect(await e('voltar')).toEqual({ tratou: true })
    expect(await naLista('1133334444')).toEqual([])
    expect(canal.enviadas).toEqual([{ numero: '5511933334444', texto: m.ofertas.RECADO_VOLTOU }])
  })
})

describe('envio sem confirmação', () => {
  const canalQue = (semDuplicar: boolean) => {
    const pedidos: { texto: string; chave?: string }[] = []
    let n = 0
    const canal: Canal = {
      nome: 'teste',
      real: true,
      semDuplicar,
      enviar: async (_numero, texto, opcoes): Promise<Envio> => {
        pedidos.push({ texto, chave: opcoes?.chave })
        return n++ === 0 ? { ok: false, motivo: 'não respondeu a tempo', codigo: 'incerto' } : { ok: true }
      },
    }
    return { canal, pedidos }
  }

  it('canal que não deduplica (Z-API, Meta): não manda de novo, e o roteiro segue', async () => {
    const { canal, pedidos } = canalQue(false)
    await m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5571988880030', nome: null, texto: 'duas mensagens', canal })
    expect(pedidos.map((p) => p.texto)).toEqual(['primeira', 'segunda'])
    expect(await execucoes('7188880030')).toMatchObject([{ status: 'concluida' }])
  })

  it('o conector (deduplica): tenta de novo depois, com a MESMA chave', async () => {
    const { canal, pedidos } = canalQue(true)
    // Meio-dia em São Paulo: a nova tentativa não cai na regra da noite.
    const T0 = new Date('2026-09-25T15:00:00Z')
    await m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone: '5571988880031', nome: null, texto: 'duas mensagens', canal, agora: T0 })
    const [ex] = await execucoes('7188880031')
    expect(ex).toMatchObject({ status: 'esperando', node_id: 'm1' })
    await m.execucao.andar('org-a', ex!.id, { tipo: 'acordar' }, { canal, agora: new Date(T0.getTime() + 3 * 60_000) })
    expect(pedidos.map((p) => p.texto)).toEqual(['primeira', 'primeira', 'segunda'])
    expect(pedidos[0]!.chave).toBeTruthy()
    expect(pedidos[1]!.chave).toBe(pedidos[0]!.chave)
    expect(pedidos[2]!.chave).not.toBe(pedidos[0]!.chave)
  })
})
