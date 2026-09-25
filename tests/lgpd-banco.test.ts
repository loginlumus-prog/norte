// LGPD com banco de verdade (PGlite exposto numa porta, como em
// campanhas-banco.test.ts), em três partes:
//
//   1. OFERTAS: o aceite na ficha (com caminho, data, quem e versão do texto
//      no livro), a lista permanente de quem não recebe, o PARAR que grava
//      para sempre e confirma UMA vez, o VOLTAR que é o único caminho de
//      volta, a palavra-chave que não fura a lista, e `podeReceberOfertas`
//      segurando o MODELO que a loja começaria fora da janela;
//   2. ANONIMIZAR: o dado pessoal some (ficha, conversas, campanhas,
//      encomenda, financeiro, livro), as vendas ficam, a outra empresa não é
//      tocada, e a linha nova do livro não tem dado pessoal nenhum;
//   3. SUPORTE: todo acesso do nosso suporte vira linha no livro da loja,
//      com motivo e sem a busca do endereço, no máximo uma por tela a cada
//      10 minutos por sessão.

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
  canal: typeof import('../src/servidor/assistente/canal')
  banco: typeof import('../src/servidor/banco')
  ofertas: typeof import('../src/servidor/ofertas')
  cliente: typeof import('../src/servidor/cliente')
  anonimizar: typeof import('../src/servidor/anonimizar')
  pagina: typeof import('../src/servidor/pagina')
  auditoria: typeof import('../src/servidor/auditoria')
}

const DONA: Sessao = { orgId: 'org-a', usuarioId: 'usr-ana', nome: 'Ana Dona', acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: null }] }
const GERENTE: Sessao = { orgId: 'org-a', usuarioId: 'usr-gil', nome: 'Gil Gerente', acessos: [{ papel: 'GERENTE', unidadeId: null, expiraEm: null }] }
const DAQUI_A_UM_DIA = new Date(Date.now() + 86_400_000)
const SUPORTE: Sessao = { orgId: 'org-a', usuarioId: 'usr-sup', nome: 'Suporte Norte', acessos: [{ papel: 'SUPORTE', unidadeId: null, expiraEm: DAQUI_A_UM_DIA }] }

const grafo = (nodes: object[], edges: object[]) => JSON.stringify({ nodes, edges })
const no = (id: string, tipo: string, dados: object = {}) => ({ id, tipo, x: 0, y: 0, dados })
const liga = (de: string, para: string, saida = 'saida') => ({ id: `${de}-${saida}-${para}`, de, saida, para })
const gatilho = (frases: string[]) => JSON.stringify({ tipo: 'frase', frases, anuncioIds: [], reentrada: 'sempre' })

const CATALOGO = grafo(
  [no('inicio', 'inicio'), no('m1', 'mensagem', { textos: ['Oi! Quer o catálogo?'], digitandoSeg: 0 }), no('w', 'aguardar_resposta', { quantidade: 1, unidade: 'h' })],
  [liga('inicio', 'm1'), liga('m1', 'w')],
)
// O bloco com MODELO aprovado: fora da janela, é oferta começada pela loja.
const COM_MODELO = grafo(
  [
    no('inicio', 'inicio'),
    no('m1', 'mensagem', { textos: ['Chegou a coleção nova!'], digitandoSeg: 0, modelo: { nome: 'colecao_nova', idioma: 'pt_BR', variaveis: [] } }),
  ],
  [liga('inicio', 'm1')],
)

// O cliente de teste (e o homônimo na vizinha, que não pode ser tocado).
const NOME = 'Rosália Teste Anonimizável'
const TEL = '(71) 98888-1111'
const CHAVE = '7188881111'
const CPF = '52998224725'
const EMAIL = 'rosalia.teste@exemplo.com'

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em) values
    ('org-a', 'Loja A', 'loja-a', 'BALCAO_AGENTE', 'ATIVA', '{agente}', now()),
    ('org-b', 'Vizinha B', 'vizinha-b', 'BALCAO_AGENTE', 'ATIVA', '{agente}', now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('uni-a1', 'org-a', 'Centro A', now()), ('uni-b1', 'org-b', 'Sul B', now());
  insert into usuarios (id, org_id, nome, email, telefone, atualizado_em) values
    ('usr-ana', 'org-a', 'Ana Dona', 'ana@a.com', '(71) 99999-0001', now()),
    ('usr-gil', 'org-a', 'Gil Gerente', 'gil@a.com', null, now()),
    ('usr-sup', 'org-a', 'Suporte Norte', 'suporte@norte.app', null, now()),
    ('usr-bia', 'org-b', 'Bia Vizinha', 'bia@b.com', '(11) 97777-0003', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel, expira_em, motivo) values
    ('ac-ana', 'org-a', 'usr-ana', null, 'DONO', null, null),
    ('ac-gil', 'org-a', 'usr-gil', null, 'GERENTE', null, null),
    ('ac-sup', 'org-a', 'usr-sup', null, 'SUPORTE', now() + interval '1 day', 'chamado 4412: conferir o fechamento de caixa'),
    ('ac-bia', 'org-b', 'usr-bia', null, 'DONO', null, null);
  insert into agentes (id, org_id, nome, ativo, atualizado_em) values
    ('ag-a', 'org-a', 'Nina', true, now()), ('ag-b', 'org-b', 'Bob', true, now());
  insert into campanhas (id, org_id, nome, ativa, gatilho, grafo, atualizada_em) values
    ('cp-cat', 'org-a', 'Catálogo', true, '${gatilho(['quero o catálogo'])}', '${CATALOGO}', now()),
    ('cp-mod', 'org-a', 'Coleção', true, '${gatilho(['colecao nova'])}', '${COM_MODELO}', now());
  insert into categorias_financeiras (id, org_id, nome, tipo, grupo) values
    ('cat-a', 'org-a', 'Sinal de encomenda', 'RECEITA', 'RECEITA_OUTRA');

  -- a vizinha tem um cliente com o MESMO nome e o MESMO número
  insert into clientes (id, org_id, nome, telefone, documento, atualizado_em) values
    ('cli-b', 'org-b', '${NOME}', '71988881111', '${CPF}', now());
  insert into conversas_agente (id, org_id, agente_id, telefone, cliente_id) values
    ('cv-b', 'org-b', 'ag-b', '5571988881111', 'cli-b');
  insert into mensagens_agente (id, org_id, conversa_id, de, texto) values
    ('mg-b', 'org-b', 'cv-b', 'PESSOA', 'oi, aqui é a ${NOME}');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 50000 + Math.floor(Math.random() * 3000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    entrada: await import('../src/servidor/campanhas/entrada'),
    execucao: await import('../src/servidor/campanhas/execucao'),
    canal: await import('../src/servidor/assistente/canal'),
    banco: await import('../src/servidor/banco'),
    ofertas: await import('../src/servidor/ofertas'),
    cliente: await import('../src/servidor/cliente'),
    anonimizar: await import('../src/servidor/anonimizar'),
    pagina: await import('../src/servidor/pagina'),
    auditoria: await import('../src/servidor/auditoria'),
  }
  m.execucao.relogio.dormir = async () => {}
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const msg = (texto: string, canal: import('../src/servidor/assistente/canal').Canal, telefone: string) =>
  m.entrada.receberDeCliente({ orgId: 'org-a', agenteId: 'ag-a', telefone, nome: 'Contato', texto, canal })

const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows

const naLista = (chave: string) =>
  linhas<{ origem: string }>(`select origem from optout_whatsapp where org_id = 'org-a' and telefone = $1`, [chave])

// ─────────────────────────────────────────────────────────────
// 1. OFERTAS
// ─────────────────────────────────────────────────────────────

describe('a regra, sem banco', () => {
  it('só SIM e fora da lista; na dúvida entre duas fichas, não', () => {
    const f = m.ofertas.podeReceberOfertasCom
    expect(f({ naLista: false, consentimentos: ['SIM'] })).toBe(true)
    expect(f({ naLista: true, consentimentos: ['SIM'] })).toBe(false)
    expect(f({ naLista: false, consentimentos: [] })).toBe(false)
    expect(f({ naLista: false, consentimentos: ['NAO_PERGUNTADO'] })).toBe(false)
    expect(f({ naLista: false, consentimentos: ['SIM', 'NAO'] })).toBe(false)
    expect(f({ naLista: false, consentimentos: ['SIM', 'NAO_PERGUNTADO'] })).toBe(true)
  })

  it('PARAR sem campanha só com palavra que não deixa dúvida; VOLTAR sozinho', () => {
    expect(m.ofertas.ehParadaInequivoca('PARAR')).toBe(true)
    expect(m.ofertas.ehParadaInequivoca('Sair!')).toBe(true)
    expect(m.ofertas.ehParadaInequivoca('cancelar')).toBe(false)
    expect(m.ofertas.ehPedidoDeVolta('Voltar')).toBe(true)
    expect(m.ofertas.ehPedidoDeVolta('quero voltar ao menu')).toBe(false)
  })
})

describe('o aceite na ficha', () => {
  it('SIM grava caminho, data e quem — e o livro guarda a versão do texto', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Célia Aceita', telefone: '(71) 97000-0001' }, { valor: 'SIM', origem: 'balcao' })
    expect(r.ok).toBe(true)
    const id = (r as { clienteId: string }).clienteId
    const [c] = await linhas<{ ofertas_whatsapp: string; ofertas_origem: string; ofertas_por: string; ofertas_em: Date | null }>(
      `select ofertas_whatsapp, ofertas_origem, ofertas_por, ofertas_em from clientes where id = $1`, [id])
    expect(c).toMatchObject({ ofertas_whatsapp: 'SIM', ofertas_origem: 'balcao', ofertas_por: 'Ana Dona' })
    expect(c!.ofertas_em).not.toBeNull()
    const [a] = await linhas<{ depois: { versao: string; origem: string } }>(
      `select depois from auditoria where acao = 'cliente.ofertas.aceitou' and alvo_id = $1`, [id])
    expect(a!.depois).toEqual({ origem: 'balcao', versao: m.ofertas.VERSAO_TEXTO_OFERTAS })
    expect(await m.ofertas.podeReceberOfertas('org-a', '5571970000001')).toBe(true)
  })

  it('SIM sem dizer como a pessoa respondeu não grava', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Sem Caminho', telefone: '(71) 97000-0002' }, { valor: 'SIM', origem: null })
    expect(r).toMatchObject({ ok: false })
    expect(await linhas(`select id from clientes where nome = 'Sem Caminho'`)).toEqual([])
  })

  it('cadastrar sem perguntar não é aceite', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Nunca Perguntada', telefone: '(71) 97000-0003' })
    expect(r.ok).toBe(true)
    expect(await m.ofertas.podeReceberOfertas('org-a', '71970000003')).toBe(false)
  })

  it('NÃO põe o número na lista; a loja desfaz o que a loja fez', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Duda Muda', telefone: '(71) 97000-0004' }, { valor: 'SIM', origem: 'telefone' })
    const id = (r as { clienteId: string }).clienteId
    await m.cliente.editarCliente(DONA, id, { nome: 'Duda Muda', telefone: '(71) 97000-0004' }, { valor: 'NAO', origem: 'telefone' })
    expect(await naLista('7170000004')).toEqual([{ origem: 'cliente' }])
    expect(await m.ofertas.podeReceberOfertas('org-a', '71970000004')).toBe(false)
    await m.cliente.editarCliente(DONA, id, { nome: 'Duda Muda', telefone: '(71) 97000-0004' }, { valor: 'SIM', origem: 'balcao' })
    expect(await naLista('7170000004')).toEqual([])
    expect(await m.ofertas.podeReceberOfertas('org-a', '71970000004')).toBe(true)
  })

  it('salvar a ficha de novo, sem mudar a resposta, não mexe na data do aceite', async () => {
    const [c] = await linhas<{ id: string; ofertas_em: Date }>(`select id, ofertas_em from clientes where nome = 'Célia Aceita'`)
    await m.cliente.editarCliente(DONA, c!.id, { nome: 'Célia Aceita', telefone: '(71) 97000-0001', cidade: 'Salvador' }, { valor: 'SIM', origem: 'site' })
    const [d] = await linhas<{ ofertas_em: Date; ofertas_origem: string }>(`select ofertas_em, ofertas_origem from clientes where id = $1`, [c!.id])
    expect(d!.ofertas_em.getTime()).toBe(c!.ofertas_em.getTime())
    expect(d!.ofertas_origem).toBe('balcao')
  })
})

describe('PARAR e VOLTAR pelo WhatsApp', () => {
  const TEL_P = '5571970000005'
  let id: string

  beforeAll(async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Paula Para', telefone: '(71) 97000-0005' }, { valor: 'SIM', origem: 'balcao' })
    id = (r as { clienteId: string }).clienteId
  })

  it('PARAR sem campanha: grava para sempre, marca a ficha e confirma UMA vez', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('Parar', canal, TEL_P)).toEqual({ tratou: true })
    expect(canal.enviadas).toEqual([{ numero: TEL_P, texto: m.ofertas.RECADO_SAIU }])
    expect(await naLista('7170000005')).toEqual([{ origem: 'parar' }])
    const [c] = await linhas<{ ofertas_whatsapp: string; ofertas_origem: string; ofertas_por: string }>(
      `select ofertas_whatsapp, ofertas_origem, ofertas_por from clientes where id = $1`, [id])
    expect(c).toEqual({ ofertas_whatsapp: 'NAO', ofertas_origem: 'whatsapp', ofertas_por: m.ofertas.PELO_PROPRIO_CLIENTE })
    // de novo: nada sai
    expect(await msg('parar', canal, TEL_P)).toEqual({ tratou: true })
    expect(canal.enviadas).toHaveLength(1)
    expect(await m.ofertas.podeReceberOfertas('org-a', TEL_P)).toBe(false)
  })

  it('na lista, a palavra-chave não abre campanha — nem o motor abre por fora', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('quero o catálogo', canal, TEL_P)).toEqual({ tratou: false })
    expect(canal.enviadas).toEqual([])
    const r = await m.execucao.iniciar('org-a', 'cp-cat', { chave: '7170000005', envio: TEL_P, nome: null }, { teste: false }, { canal })
    expect(r).toBeNull()
    expect(await linhas(`select id from campanha_execucoes where telefone = '7170000005'`)).toEqual([])
  })

  it('a loja não marca "aceitou" por cima de um PARAR, nem tira pela tela', async () => {
    const r = await m.cliente.editarCliente(DONA, id, { nome: 'Paula Para', telefone: '(71) 97000-0005' }, { valor: 'SIM', origem: 'balcao' })
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/VOLTAR/) })
    const [l] = await linhas<{ id: string }>(`select id from optout_whatsapp where telefone = '7170000005'`)
    expect(await m.ofertas.tirarSemOfertas(DONA, l!.id)).toMatchObject({ ok: false })
  })

  it('VOLTAR tira da lista, grava o aceite pelo WhatsApp e confirma; aí a campanha abre', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('VOLTAR', canal, TEL_P)).toEqual({ tratou: true })
    expect(canal.enviadas).toEqual([{ numero: TEL_P, texto: m.ofertas.RECADO_VOLTOU }])
    expect(await naLista('7170000005')).toEqual([])
    const [c] = await linhas<{ ofertas_whatsapp: string; ofertas_origem: string }>(`select ofertas_whatsapp, ofertas_origem from clientes where id = $1`, [id])
    expect(c).toEqual({ ofertas_whatsapp: 'SIM', ofertas_origem: 'whatsapp' })
    expect(await msg('quero o catálogo', canal, TEL_P)).toEqual({ tratou: true })
    expect(canal.enviadas.at(-1)?.texto).toBe('Oi! Quer o catálogo?')
  })

  it('"não quero" no meio da campanha tira dela e grava a saída', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('não quero', canal, TEL_P)).toEqual({ tratou: true })
    expect(await naLista('7170000005')).toEqual([{ origem: 'parar' }])
    const [e] = await linhas<{ status: string; motivo_fim: string }>(
      `select status, motivo_fim from campanha_execucoes where telefone = '7170000005' order by iniciada_em desc limit 1`)
    expect(e).toEqual({ status: 'cancelada', motivo_fim: 'parou' })
    expect(canal.enviadas).toEqual([{ numero: TEL_P, texto: m.ofertas.RECADO_SAIU }])
  })

  it('"cancelar" sozinho, sem campanha, é da loja; "voltar" de quem não está na lista também', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('cancelar', canal, '5571970000006')).toEqual({ tratou: false })
    expect(await msg('voltar', canal, '5571970000006')).toEqual({ tratou: false })
    expect(canal.enviadas).toEqual([])
    expect(await naLista('7170000006')).toEqual([])
  })

  it('quem não é cadastrado também sai (e volta), e o livro guarda só o número mascarado', async () => {
    const canal = new m.canal.CanalFalso()
    expect(await msg('stop', canal, '5571970000007')).toEqual({ tratou: true })
    expect(await naLista('7170000007')).toEqual([{ origem: 'parar' }])
    const [a] = await linhas<{ alvo_nome: string }>(`select alvo_nome from auditoria where acao = 'ofertas.parou' order by criado_em desc limit 1`)
    expect(a!.alvo_nome).toBe('(71) ····-0007')
    expect(await msg('Voltar', canal, '5571970000007')).toEqual({ tratou: true })
    expect(await naLista('7170000007')).toEqual([])
    // sem ficha, ninguém aceitou: fora da lista, mas oferta começada pela loja continua proibida
    expect(await m.ofertas.podeReceberOfertas('org-a', '5571970000007')).toBe(false)
  })

  it('a loja marcou "não aceita" e depois a pessoa mandou PARAR: a saída passa a ser DELA', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Lia Loja Marcou', telefone: '(71) 97000-0011' }, { valor: 'NAO', origem: 'balcao' })
    expect(r.ok).toBe(true)
    expect(await naLista('7170000011')).toEqual([{ origem: 'cliente' }])
    const canal = new m.canal.CanalFalso()
    expect(await msg('parar', canal, '5571970000011')).toEqual({ tratou: true })
    // confirmação sai (o pedido é dela, e é novo), e a loja não tira mais pela tela
    expect(canal.enviadas).toEqual([{ numero: '5571970000011', texto: m.ofertas.RECADO_SAIU }])
    expect(await naLista('7170000011')).toEqual([{ origem: 'parar' }])
    const l = (await m.ofertas.listarSemOfertas(DONA)).find((x) => x.telefone === '(71) ····-0011')!
    expect(l.lojaTira).toBe(false)
  })

  it('a lista de uma loja não vale para a outra (RLS)', async () => {
    const b = await comoApp(db, 'org-b', (tx) => tx.query(`select id from optout_whatsapp`))
    expect(b.rows).toEqual([])
    await expect(
      comoApp(db, 'org-a', (tx) => tx.query(`insert into optout_whatsapp (id, org_id, telefone, origem) values ('x', 'org-b', '1188880000', 'manual')`)),
    ).rejects.toThrow()
  })
})

describe('a oferta que a loja começa (o modelo fora da janela)', () => {
  /** A Meta de mentira: a janela está fechada, e o modelo sai se for pedido. */
  const canalFechado = () => {
    const modelos: string[] = []
    const canal: import('../src/servidor/assistente/canal').Canal = {
      nome: 'meta de mentira',
      real: true,
      enviar: async () => ({ ok: false, motivo: 'janela', codigo: 'janela_fechada' }),
      enviarModelo: async (numero, mo) => {
        modelos.push(`${numero}:${mo.nome}`)
        return { ok: true }
      },
    }
    return { canal, modelos }
  }

  it('sem aceite, o modelo NÃO sai e a execução termina', async () => {
    const { canal, modelos } = canalFechado()
    await msg('colecao nova', canal, '5571970000003') // "Nunca Perguntada"
    expect(modelos).toEqual([])
    const [e] = await linhas<{ motivo_fim: string }>(`select motivo_fim from campanha_execucoes where telefone = '7170000003'`)
    expect(e!.motivo_fim).toBe('janela_fechada')
  })

  it('com aceite, o modelo sai', async () => {
    const { canal, modelos } = canalFechado()
    await msg('colecao nova', canal, '5571970000001') // "Célia Aceita"
    expect(modelos).toEqual(['5571970000001:colecao_nova'])
  })
})

describe('a lista na tela', () => {
  it('a loja anota e tira um número; o balcão não precisa acertar a palavra', async () => {
    expect(await m.ofertas.anotarSemOfertas(DONA, '(71) 97000-0008')).toEqual({ ok: true })
    expect(await m.ofertas.anotarSemOfertas(DONA, '(71) 97000-0008')).toMatchObject({ ok: false })
    expect(await m.ofertas.anotarSemOfertas(DONA, '123')).toMatchObject({ ok: false })
    const lista = await m.ofertas.listarSemOfertas(DONA)
    const minha = lista.find((l) => l.telefone === '(71) ····-0008')!
    expect(minha).toMatchObject({ origem: 'manual', lojaTira: true })
    // a lista não mostra número inteiro
    expect(lista.every((l) => !/\d{5}/.test(l.telefone))).toBe(true)
    expect(await m.ofertas.tirarSemOfertas(DONA, minha.id)).toEqual({ ok: true })
    expect(await naLista('7170000008')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// 2. ANONIMIZAR
// ─────────────────────────────────────────────────────────────

describe('anonimizar um cliente', () => {
  let id: string

  beforeAll(async () => {
    const r = await m.cliente.criarCliente(
      DONA,
      {
        nome: NOME,
        telefone: TEL,
        documento: CPF,
        email: EMAIL,
        nascimento: new Date('1980-05-04T12:00:00Z'),
        endereco: 'Rua das Flores',
        numero: '42',
        bairro: 'Barra',
        cidade: 'Salvador',
        estado: 'BA',
        cep: '40140000',
        observacoes: 'Prefere ser avisada de manhã',
      },
      { valor: 'SIM', origem: 'balcao' },
    )
    id = (r as { clienteId: string }).clienteId
    // um "alterou" deixa o nome e o telefone no `antes` do livro
    await m.cliente.editarCliente(DONA, id, { nome: NOME, telefone: TEL, documento: CPF, email: EMAIL, cidade: 'Lauro de Freitas' })

    // uma compra (fiscal: fica), uma encomenda entregue com sinal no financeiro
    await db.exec(`
      insert into vendas (id, org_id, unidade_id, numero, cliente_id, situacao, total) values
        ('vd-1', 'org-a', 'uni-a1', 1, '${id}', 'CONCLUIDA', 150.00);
      insert into venda_itens (id, org_id, venda_id, descricao, quantidade, preco_unit, total) values
        ('vi-1', 'org-a', 'vd-1', 'Vestido', 1, 150.00, 150.00);
      insert into encomendas (id, org_id, unidade_id, cliente_id, cliente_nome, telefone, descricao, para, quem, situacao, endereco, atualizada_em) values
        ('enc-000001', 'org-a', 'uni-a1', '${id}', '${NOME}', '71988881111', 'Bolo de chocolate', now(), 'Ana Dona', 'ENTREGUE', 'Rua das Flores, 42', now());
      insert into lancamentos (id, org_id, categoria_id, tipo, descricao, valor, vencimento, quem, documento, atualizado_em) values
        ('lc-1', 'org-a', 'cat-a', 'RECEITA', 'Sinal da encomenda — ${NOME}: Bolo de chocolate', 30.00, current_date, 'Ana Dona', 'ENC-000001', now());
      insert into auditoria (id, org_id, quem, acao, alvo_tipo, alvo_id, alvo_nome, depois) values
        ('aud-enc', 'org-a', 'Ana Dona', 'encomenda.criou', 'encomenda', 'enc-000001', '${NOME}: Bolo de chocolate', '{"valor": 80}'),
        ('aud-lc', 'org-a', 'Ana Dona', 'financeiro.receita', 'lancamento', 'lc-1', 'Sinal da encomenda — ${NOME}: Bolo de chocolate', null);
      insert into conversas_agente (id, org_id, agente_id, telefone, cliente_id) values
        ('cv-a', 'org-a', 'ag-a', '5571988881111', '${id}');
      insert into mensagens_agente (id, org_id, conversa_id, de, texto) values
        ('mg-a1', 'org-a', 'cv-a', 'PESSOA', 'meu cpf é ${CPF}'),
        ('mg-a2', 'org-a', 'cv-a', 'AGENTE', 'obrigado!');
    `)
    // e uma campanha em andamento, com a resposta dela guardada
    const canal = new m.canal.CanalFalso()
    await msg('quero o catálogo', canal, '5571988881111')
  })

  it('quem não configura a empresa não anonimiza; palavra errada não apaga nada', async () => {
    await expect(m.anonimizar.anonimizarCliente(GERENTE, id, 'ANONIMIZAR')).rejects.toThrow(/Sem permissão/)
    expect(await m.anonimizar.anonimizarCliente(DONA, id, 'sim')).toMatchObject({ ok: false })
    const [c] = await linhas<{ nome: string }>(`select nome from clientes where id = $1`, [id])
    expect(c!.nome).toBe(NOME)
  })

  it('anonimizar quem a loja tinha marcado "não aceita" tranca a saída (a loja não tira mais)', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Nara Marcada', telefone: '(71) 97000-0012' }, { valor: 'NAO', origem: 'telefone' })
    const nara = (r as { clienteId: string }).clienteId
    expect(await naLista('7170000012')).toEqual([{ origem: 'cliente' }])
    expect(await m.anonimizar.anonimizarCliente(DONA, nara, 'ANONIMIZAR')).toMatchObject({ ok: true })
    expect(await naLista('7170000012')).toEqual([{ origem: 'anonimizado' }])
  })

  it('com parcela em aberto, não anonimiza', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Dora Devedora', telefone: '(71) 97000-0009' })
    const devedora = (r as { clienteId: string }).clienteId
    await db.exec(`
      insert into vendas (id, org_id, unidade_id, numero, cliente_id, situacao, total) values ('vd-dev', 'org-a', 'uni-a1', 2, '${devedora}', 'CONCLUIDA', 100);
      insert into parcelas (id, org_id, venda_id, cliente_id, unidade_id, numero, de, vencimento, valor) values
        ('pc-1', 'org-a', 'vd-dev', '${devedora}', 'uni-a1', 1, 1, current_date + 10, 100);
    `)
    expect(await m.anonimizar.anonimizarCliente(DONA, devedora, 'ANONIMIZAR')).toMatchObject({ ok: false, erro: expect.stringMatching(/crediário/) })
  })

  it('o dado pessoal some; a venda fica; a conversa e a campanha somem', async () => {
    const r = await m.anonimizar.anonimizarCliente(DONA, id, 'anonimizar')
    expect(r).toMatchObject({ ok: true, apagado: { conversas: 1, mensagens: 2, execucoes: 1, encomendas: 1, lancamentos: 1, foraDasOfertas: true } })

    const [c] = await linhas<Record<string, unknown>>(`select * from clientes where id = $1`, [id])
    expect(c).toMatchObject({
      nome: 'Cliente anonimizado', telefone: null, documento: null, email: null, nascimento: null,
      endereco: null, numero: null, bairro: null, cidade: null, estado: null, cep: null, observacoes: null,
      ativo: false, ofertas_whatsapp: 'NAO_PERGUNTADO', ofertas_por: null,
    })
    expect(c!.anonimizado_em).not.toBeNull()

    // fiscal: a venda e o item ficam, ligados à ficha anônima
    expect(await linhas(`select id, cliente_id from vendas where id = 'vd-1'`)).toEqual([{ id: 'vd-1', cliente_id: id }])
    expect(await linhas(`select descricao from venda_itens where venda_id = 'vd-1'`)).toEqual([{ descricao: 'Vestido' }])

    expect(await linhas(`select id from conversas_agente where org_id = 'org-a' and telefone like '%88881111'`)).toEqual([])
    expect(await linhas(`select id from mensagens_agente where conversa_id = 'cv-a'`)).toEqual([])
    expect(await linhas(`select id from campanha_execucoes where telefone = $1`, [CHAVE])).toEqual([])

    expect(await linhas(`select cliente_nome, telefone, endereco, descricao from encomendas where id = 'enc-000001'`)).toEqual([
      { cliente_nome: 'Cliente anonimizado', telefone: null, endereco: null, descricao: 'Bolo de chocolate' },
    ])
    const [l] = await linhas<{ descricao: string; valor: string }>(`select descricao, valor from lancamentos where id = 'lc-1'`)
    expect(l!.descricao).toBe('Sinal da encomenda — Cliente anonimizado: Bolo de chocolate')
    expect(Number(l!.valor)).toBe(30)

    // não recebe mais nada: a chave fica na lista — e a loja não tira pela tela
    expect(await naLista(CHAVE)).toEqual([{ origem: 'anonimizado' }])
  })

  it('o livro da loja não tem mais nome, telefone, CPF nem e-mail — e registrou o que foi feito', async () => {
    const todas = await linhas<{ t: string }>(`select row_to_json(a)::text as t from auditoria a where org_id = 'org-a'`)
    const texto = todas.map((x) => x.t).join('\n')
    for (const pedaco of [NOME, 'Rosália', '88881111', CPF, EMAIL, 'Rua das Flores']) expect(texto).not.toContain(pedaco)

    const [a] = await linhas<{ quem: string; usuario_id: string; alvo_nome: string; motivo: string; depois: object }>(
      `select quem, usuario_id, alvo_nome, motivo, depois from auditoria where acao = 'cliente.anonimizou' and alvo_id = $1`, [id])
    expect(a).toMatchObject({ quem: 'Ana Dona', usuario_id: 'usr-ana', alvo_nome: 'Cliente anonimizado' })
    expect(a!.depois).toMatchObject({ conversas: 1, execucoes: 1 })
    // o que aconteceu continua lá: ação e valor não mudam
    expect(await linhas(`select acao, depois from auditoria where id = 'aud-enc'`)).toEqual([{ acao: 'encomenda.criou', depois: { valor: 80 } }])
  })

  it('a outra empresa não é tocada — nem o cliente com o mesmo nome e número', async () => {
    expect(await linhas(`select nome, telefone, documento from clientes where id = 'cli-b'`)).toEqual([
      { nome: NOME, telefone: '71988881111', documento: CPF },
    ])
    expect(await linhas(`select texto from mensagens_agente where id = 'mg-b'`)).toEqual([{ texto: `oi, aqui é a ${NOME}` }])
    expect(await linhas(`select id from optout_whatsapp where org_id = 'org-b'`)).toEqual([])
  })

  it('anonimizada não se edita, e não se anonimiza duas vezes', async () => {
    expect(await m.cliente.editarCliente(DONA, id, { nome: 'Outra Pessoa' })).toMatchObject({ ok: false })
    expect(await m.anonimizar.anonimizarCliente(DONA, id, 'ANONIMIZAR')).toMatchObject({ ok: false })
  })

  it('o papel da aplicação continua sem reescrever o livro direto', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) => tx.query(`update auditoria set alvo_nome = 'x' where id = 'aud-enc'`)),
    ).rejects.toThrow()
  })

  it('o suporte atende o pedido por e-mail: acha pelo telefone, e o protocolo não aceita texto livre', async () => {
    const r = await m.cliente.criarCliente(DONA, { nome: 'Otília Pediu Por Email', telefone: '(71) 97000-0010', documento: '11144477735' })
    const outra = (r as { clienteId: string }).clienteId
    expect(
      await m.anonimizar.anonimizarPorPedidoAoSuporte('org-a', { telefone: '71970000010' }, { atendente: 'Equipe Norte', protocolo: 'pedido da Otília' }),
    ).toMatchObject({ ok: false })
    const ok = await m.anonimizar.anonimizarPorPedidoAoSuporte(
      'org-a',
      { telefone: '5571970000010' },
      { atendente: 'Equipe Norte', protocolo: 'LGPD-2026-0042' },
    )
    expect(ok).toMatchObject({ ok: true, fichas: 1 })
    const [a] = await linhas<{ quem: string; autor: string; motivo: string; t: string }>(
      `select quem, autor::text, motivo, row_to_json(a)::text as t from auditoria a where acao = 'cliente.anonimizou' and alvo_id = $1`, [outra])
    expect(a).toMatchObject({ quem: 'Suporte do Norte (Equipe Norte)', autor: 'SISTEMA', motivo: 'pedido do titular ao Norte · LGPD-2026-0042' })
    expect(a!.t).not.toContain('Otília')
    expect(await m.anonimizar.anonimizarPorPedidoAoSuporte('org-b', { telefone: '5571970000010' }, { atendente: 'Equipe Norte', protocolo: 'LGPD-2026-0043' }))
      .toMatchObject({ ok: false })
  })
})

// ─────────────────────────────────────────────────────────────
// 3. SUPORTE
// ─────────────────────────────────────────────────────────────

describe('o registro do acesso do suporte', () => {
  const NASCEU = new Date('2026-09-25T12:00:00Z')
  const T0 = new Date('2026-09-25T12:01:00Z')
  const depois = (min: number) => new Date(T0.getTime() + min * 60_000)
  const doSuporte = () =>
    linhas<{ alvo_nome: string; alvo_tipo: string; motivo: string; quem: string; t: string }>(
      `select alvo_nome, alvo_tipo, motivo, quem, row_to_json(a)::text as t from auditoria a where acao = 'suporte.acessou' order by criado_em`)

  it('reconhece só o acesso de suporte que ainda vale', () => {
    expect(m.pagina.ehAcessoDeSuporte(SUPORTE)).toBe(true)
    expect(m.pagina.ehAcessoDeSuporte(DONA)).toBe(false)
    expect(m.pagina.ehAcessoDeSuporte({ ...SUPORTE, acessos: [{ papel: 'SUPORTE', unidadeId: null, expiraEm: new Date(0) }] })).toBe(false)
  })

  it('abre a tela: vira linha, com o motivo e sem a busca do endereço', async () => {
    expect(await m.pagina.registrarAcessoDeSuporte(SUPORTE, { caminho: '/loja-a/clientes?q=Maria%20Silva', tipo: 'tela', sessaoNasceu: NASCEU }, T0)).toBe(true)
    const [l] = await doSuporte()
    expect(l).toMatchObject({ alvo_nome: '/loja-a/clientes', alvo_tipo: 'tela', motivo: 'chamado 4412: conferir o fechamento de caixa', quem: 'Suporte Norte' })
    expect(l!.t).not.toContain('Maria')
  })

  it('a mesma tela de novo, dentro de 10 minutos, não vira outra linha — nem em outro servidor', async () => {
    expect(await m.pagina.registrarAcessoDeSuporte(SUPORTE, { caminho: '/loja-a/clientes', tipo: 'tela', sessaoNasceu: NASCEU }, depois(3))).toBe(false)
    // outro servidor: sem a memória deste processo, quem responde é o livro
    ;(globalThis as { __suporteVisto?: Map<string, number> }).__suporteVisto?.clear()
    expect(await m.pagina.registrarAcessoDeSuporte(SUPORTE, { caminho: '/loja-a/clientes', tipo: 'tela', sessaoNasceu: NASCEU }, depois(5))).toBe(false)
    expect(await doSuporte()).toHaveLength(1)
  })

  it('outra tela, uma ação, outra sessão ou passados 10 minutos: linha nova', async () => {
    expect(await m.pagina.registrarAcessoDeSuporte(SUPORTE, { caminho: '/loja-a/caixa', tipo: 'tela', sessaoNasceu: NASCEU }, depois(4))).toBe(true)
    expect(await m.pagina.registrarAcessoDeSuporte(SUPORTE, { caminho: '/loja-a/clientes', tipo: 'acao', sessaoNasceu: NASCEU }, depois(4))).toBe(true)
    expect(await m.pagina.registrarAcessoDeSuporte(SUPORTE, { caminho: '/loja-a/clientes', tipo: 'tela', sessaoNasceu: depois(6) }, depois(6))).toBe(true)
    expect(await m.pagina.registrarAcessoDeSuporte(SUPORTE, { caminho: '/loja-a/clientes', tipo: 'tela', sessaoNasceu: NASCEU }, depois(11))).toBe(true)
    expect(await doSuporte()).toHaveLength(5)
  })

  it('a dona vê as linhas na Auditoria, com o assunto "suporte do Norte"', async () => {
    const livro = await m.auditoria.listarAuditoria(DONA, {
      unidadeIds: ['uni-a1'],
      de: new Date('2026-09-25T00:00:00Z'),
      ate: new Date('2026-09-26T00:00:00Z'),
      assunto: 'suporte',
    })
    expect(livro).toHaveLength(5)
    expect(livro.every((l) => l.texto === 'acesso do suporte do Norte')).toBe(true)
    // e a vizinha não vê nada disso
    const b = await comoApp(db, 'org-b', (tx) => tx.query(`select id from auditoria where acao = 'suporte.acessou'`))
    expect(b.rows).toEqual([])
  })
})
