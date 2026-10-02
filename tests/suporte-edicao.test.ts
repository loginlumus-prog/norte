// O acesso de suporte do Norte em dois modos: só leitura (o de sempre) e
// edição — escolhido ao conceder (`concederSuporte`, `--edicao`, o console).
//
// No modo edição o suporte arruma a operação (produto, preço, estoque,
// Configurações, convite de balcão, encomenda sem dinheiro) e NUNCA: vende,
// cancela venda, mexe no caixa, na Assinatura, troca o dono ou apaga dado.
// O acesso vence no prazo, e tudo sai no livro da loja como
// "Equipe Norte (nome)".

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import {
  pode,
  podeConceder,
  podeConcederAcesso,
  ehSuporteDoNorte,
  suporteEdita,
  SemPermissao,
  type Sessao,
} from '../src/servidor/permissao'

const FUTURO = new Date(Date.now() + 4 * 3_600_000)
const PASSADO = new Date(Date.now() - 60_000)

const suporte = (edita: boolean, expiraEm: Date = FUTURO): Sessao => ({
  orgId: 'org-s',
  usuarioId: 'usr-sup',
  nome: 'Equipe Norte (Rafa)',
  acessos: [{ papel: 'SUPORTE', unidadeId: null, expiraEm, suporteEdita: edita }],
})
const LEITURA = suporte(false)
const EDICAO = suporte(true)
const VENCIDO = suporte(true, PASSADO)

describe('as capacidades de cada modo (regra pura)', () => {
  it('só leitura: vê, não escreve nada', () => {
    for (const c of ['produto.ver', 'estoque.ver', 'equipe.ver', 'auditoria.ver'] as const) expect(pode(LEITURA, c)).toBe(true)
    for (const c of ['produto.editar', 'produto.preco', 'estoque.ajustar', 'empresa.configurar', 'equipe.gerir', 'cliente.editar'] as const) {
      expect(pode(LEITURA, c)).toBe(false)
    }
    expect(podeConceder(LEITURA, 'BALCAO')).toBe(false)
  })

  it('edição: arruma a operação da empresa inteira', () => {
    for (const c of ['produto.editar', 'produto.preco', 'produto.cadastrar', 'estoque.ajustar', 'empresa.configurar', 'equipe.gerir', 'cliente.editar'] as const) {
      expect(pode(EDICAO, c)).toBe(true)
      expect(pode(EDICAO, c, 'qualquer-loja')).toBe(true)
    }
  })

  it('edição: nunca vende, cancela, mexe no caixa ou no dinheiro', () => {
    for (const c of [
      'venda.criar', 'venda.cancelar', 'venda.desconto', 'caixa.operar',
      'crediario.receber', 'crediario.cobrar', 'financeiro.lancar',
      'mensalidade.receber', 'mensalidade.ajustar', 'compra.gerir', 'ponto.gerir', 'agente.configurar',
    ] as const) {
      expect(pode(EDICAO, c)).toBe(false)
    }
  })

  it('edição: convida balcão, nunca dono nem gerente', () => {
    expect(podeConceder(EDICAO, 'BALCAO')).toBe(true)
    expect(podeConcederAcesso(EDICAO, 'BALCAO', null)).toBe(true)
    for (const p of ['DONO', 'GERENTE', 'FINANCEIRO', 'CONTADOR', 'CARGO', 'SUPORTE'] as const) {
      expect(podeConceder(EDICAO, p)).toBe(false)
      expect(podeConcederAcesso(EDICAO, p, null)).toBe(false)
    }
  })

  it('vencido: nenhum dos dois modos vale', () => {
    expect(pode(VENCIDO, 'produto.ver')).toBe(false)
    expect(pode(VENCIDO, 'produto.editar')).toBe(false)
    expect(suporteEdita(VENCIDO)).toBe(false)
    expect(podeConceder(VENCIDO, 'BALCAO')).toBe(false)
  })

  it('sem o campo (sessão montada sem ler o banco) é só leitura — falha fechada', () => {
    const s: Sessao = { ...LEITURA, acessos: [{ papel: 'SUPORTE', unidadeId: null, expiraEm: FUTURO }] }
    expect(pode(s, 'produto.editar')).toBe(false)
    expect(ehSuporteDoNorte(s)).toBe(true)
  })

  it('o campo não dá nada a quem não é SUPORTE', () => {
    const balcao: Sessao = { orgId: 'o', usuarioId: 'u', nome: 'B', acessos: [{ papel: 'BALCAO', unidadeId: 'l1', suporteEdita: true }] }
    expect(pode(balcao, 'produto.editar')).toBe(false)
    expect(ehSuporteDoNorte(balcao)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// COM BANCO
// ─────────────────────────────────────────────────────────────

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  banco: typeof import('../src/servidor/banco')
  operacao: typeof import('../src/servidor/operacao')
  produto: typeof import('../src/servidor/produto')
  convite: typeof import('../src/servidor/convite')
  venda: typeof import('../src/servidor/venda')
  caixa: typeof import('../src/servidor/caixa')
  assinatura: typeof import('../src/servidor/assinatura')
  lojas: typeof import('../src/servidor/lojas')
  pagina: typeof import('../src/servidor/pagina')
  pedidos: typeof import('../src/servidor/pedidos')
  encomenda: typeof import('../src/servidor/encomenda')
}

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, credito_ia_cent, atualizada_em, configurada_em) values
    ('org-s', 'Loja S', 'loja-s', 'BALCAO_AGENTE', 'ATIVA', '{agente,encomenda}', 0, now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values ('uni-s1', 'org-s', 'Centro', now());
  insert into usuarios (id, org_id, nome, email, senha_hash, sessoes_desde, atualizado_em) values
    ('usr-dona', 'org-s', 'Dona S', 'dona@s.com', 'x', '2026-01-01', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values ('ac-dona', 'org-s', 'usr-dona', null, 'DONO');
  insert into produtos (id, org_id, nome, medida, preco_vista, custo, vendido_em, atualizado_em) values
    ('p-blusa', 'org-s', 'Blusa', 'UN', 80, 30, '{}', now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values ('v-blusa', 'org-s', 'p-blusa', 'BLU1', true);
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, criada_em) values
    ('venda-1', 'org-s', 'uni-s1', 1, 'CONCLUIDA', 80, now());
  insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, valor, sinal, para, quem, atualizada_em) values
    ('enc-1', 'org-s', 'uni-s1', 'Cliente', 'Bolo de cenoura', 120, 50, now() + interval '3 days', 'Dona S', now());
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
    operacao: await import('../src/servidor/operacao'),
    produto: await import('../src/servidor/produto'),
    convite: await import('../src/servidor/convite'),
    venda: await import('../src/servidor/venda'),
    caixa: await import('../src/servidor/caixa'),
    assinatura: await import('../src/servidor/assinatura'),
    lojas: await import('../src/servidor/lojas'),
    pagina: await import('../src/servidor/pagina'),
    pedidos: await import('../src/servidor/pedidos'),
    encomenda: await import('../src/servidor/encomenda'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const linhas = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows

/**
 * A sessão como `conferirSessao` monta para a conta de suporte: o modo vem
 * do BANCO (não do cookie) e o nome do livro é "Equipe Norte (...)".
 */
async function sessaoDoSuporte(email: string): Promise<Sessao> {
  const [u] = await linhas<{ id: string; nome: string }>(`select id, nome from usuarios where email = $1`, [email])
  const acessos = await linhas<{ expira_em: Date | null; suporte_edita: boolean }>(
    `select expira_em, suporte_edita from acessos where usuario_id = $1 and papel = 'SUPORTE'`,
    [u!.id],
  )
  return {
    orgId: 'org-s',
    usuarioId: u!.id,
    nome: m.pagina.nomeDoSuporteNoLivro(u!.nome),
    acessos: acessos.map((a) => ({ papel: 'SUPORTE' as const, unidadeId: null, expiraEm: a.expira_em, suporteEdita: a.suporte_edita })),
  }
}

describe('conceder escolhe o modo', () => {
  it('sem edição é só leitura; com edição grava o modo e o livro diz qual', async () => {
    await m.operacao.concederSuporte('org-s', { email: 'rafa@usenorte.com.br', horas: 2, motivo: 'Olhar o estoque', quem: 'Rafa' })
    let [a] = await linhas<{ suporte_edita: boolean }>(`select suporte_edita from acessos where papel = 'SUPORTE'`)
    expect(a!.suporte_edita).toBe(false)

    const r = await m.operacao.concederSuporte('org-s', {
      email: 'rafa@usenorte.com.br', horas: 4, motivo: 'Arrumar o cadastro de produtos', quem: 'Rafa', edicao: true,
    })
    expect(r.edicao).toBe(true)
    ;[a] = await linhas<{ suporte_edita: boolean }>(`select suporte_edita from acessos where papel = 'SUPORTE'`)
    expect(a!.suporte_edita).toBe(true)
    const livro = await linhas<{ quem: string; antes: { modo: string }; depois: { modo: string } }>(
      `select quem, antes, depois from auditoria where acao = 'suporte.concedeu' order by criado_em`,
    )
    expect(livro.at(-1)!.quem).toBe('Equipe Norte (Rafa)')
    expect(livro.at(-1)!.antes.modo).toBe('leitura')
    expect(livro.at(-1)!.depois.modo).toBe('edicao')

    const e = await m.operacao.estadoDoSuporte('org-s', 'rafa@usenorte.com.br')
    expect(e.suporte?.edicao).toBe(true)
  })
})

describe('no modo edição', () => {
  it('edita um produto (nome e preço), e o livro diz "Equipe Norte (...)"', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    expect(s.nome).toBe('Equipe Norte (Rafa)')
    const r = await m.produto.editarProduto(s, 'p-blusa', { nome: 'Blusa de linho', precoVista: 90 })
    expect(r.ok).toBe(true)
    const [p] = await linhas<{ nome: string; preco_vista: string }>(`select nome, preco_vista from produtos where id = 'p-blusa'`)
    expect(p!.nome).toBe('Blusa de linho')
    expect(Number(p!.preco_vista)).toBe(90)
    const livro = await linhas<{ quem: string; usuario_id: string }>(
      `select quem, usuario_id from auditoria where alvo_id = 'p-blusa' and acao like 'produto.%'`,
    )
    expect(livro.length).toBeGreaterThan(0)
    for (const l of livro) {
      expect(l.quem).toBe('Equipe Norte (Rafa)')
      expect(l.usuario_id).toBe(s.usuarioId)
    }
  })

  it('convida uma balconista, e não um gerente', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    const c = await m.convite.convidar(s, { email: 'nova@s.com', papel: 'BALCAO', unidadeId: 'uni-s1' }, 'http://x/loja-s')
    expect(c.link).toContain('/convite/')
    const [l] = await linhas<{ quem: string }>(`select quem from auditoria where acao = 'convite.criou'`)
    expect(l!.quem).toBe('Equipe Norte (Rafa)')
    await expect(m.convite.convidar(s, { email: 'chefe@s.com', papel: 'GERENTE', unidadeId: null }, 'http://x/loja-s')).rejects.toThrow()
    await expect(m.convite.convidar(s, { email: 'dono2@s.com', papel: 'DONO', unidadeId: null }, 'http://x/loja-s')).rejects.toThrow()
  })

  it('não registra venda', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    await expect(
      m.venda.registrarVenda(s, {
        unidadeId: 'uni-s1',
        itens: [{ variacaoId: 'v-blusa', quantidade: 1 }],
        pagamentos: [{ forma: 'DINHEIRO', valor: 90 }],
      } as unknown as Parameters<typeof m.venda.registrarVenda>[1]),
    ).rejects.toBeInstanceOf(SemPermissao)
  })

  it('não cancela venda', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    await expect(m.venda.cancelarVenda(s, 'venda-1', 'teste do suporte')).rejects.toBeInstanceOf(SemPermissao)
    const [v] = await linhas<{ situacao: string }>(`select situacao from vendas where id = 'venda-1'`)
    expect(v!.situacao).toBe('CONCLUIDA')
  })

  it('não abre caixa', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    await expect(m.caixa.abrirCaixa(s, 'uni-s1', 100)).rejects.toBeInstanceOf(SemPermissao)
    expect(await linhas(`select id from caixas`)).toHaveLength(0)
  })

  it('não mexe na Assinatura (pedido, troca de plano) mesmo tendo empresa.configurar', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    expect(pode(s, 'empresa.configurar')).toBe(true)
    await expect(m.assinatura.registrarPedido(s, { tipo: 'respostas' })).rejects.toThrow(/suporte do Norte não mexe na Assinatura/)
    await expect(m.assinatura.trocarPlano(s, 'REDE')).rejects.toThrow(/suporte do Norte/)
    expect(await linhas(`select id from auditoria where acao in ('respostas.pediu', 'plano.trocou')`)).toHaveLength(0)
  })

  it('encomenda: corrige o texto e marca pronta; valor, sinal, entregar e cancelar não', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    const dias = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 3 * 864e5))
    const base = { clienteNome: 'Cliente', descricao: 'Bolo de cenoura com cobertura', valor: 120, sinal: 50, dia: dias, hora: '15:00', entrega: false }
    expect((await m.encomenda.editarEncomenda(s, 'enc-1', base)).ok).toBe(true)
    const [e] = await linhas<{ descricao: string; valor: string; sinal: string }>(`select descricao, valor, sinal from encomendas where id = 'enc-1'`)
    expect(e!.descricao).toBe('Bolo de cenoura com cobertura')

    const baixou = await m.encomenda.editarEncomenda(s, 'enc-1', { ...base, valor: 60 })
    expect(baixou.ok).toBe(false)
    const sinal = await m.encomenda.editarEncomenda(s, 'enc-1', { ...base, sinal: 0 })
    expect(sinal.ok).toBe(false)
    const [depois] = await linhas<{ valor: string; sinal: string }>(`select valor, sinal from encomendas where id = 'enc-1'`)
    expect([Number(depois!.valor), Number(depois!.sinal)]).toEqual([120, 50])

    expect((await m.encomenda.mudarSituacao(s, 'enc-1', { para: 'PRONTA' })).ok).toBe(true)
    await expect(m.encomenda.mudarSituacao(s, 'enc-1', { para: 'ENTREGUE', motivo: 'pago fora' })).rejects.toBeInstanceOf(SemPermissao)
    await expect(m.encomenda.mudarSituacao(s, 'enc-1', { para: 'CANCELADA', motivo: 'desistiu', devolveuSinal: false })).rejects.toBeInstanceOf(SemPermissao)
    const livro = await linhas<{ quem: string }>(`select quem from auditoria where alvo_id = 'enc-1'`)
    expect(livro.length).toBeGreaterThan(0)
    for (const l of livro) expect(l.quem).toBe('Equipe Norte (Rafa)')
  })

  it('não abre loja (muda a conta) nem fecha', async () => {
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    await expect(m.lojas.mudarSituacaoLoja(s, 'uni-s1', false)).rejects.toBeInstanceOf(SemPermissao)
    const [u] = await linhas<{ ativa: boolean }>(`select ativa from unidades where id = 'uni-s1'`)
    expect(u!.ativa).toBe(true)
  })
})

describe('no modo leitura e depois do prazo', () => {
  it('só leitura não edita produto', async () => {
    await m.operacao.concederSuporte('org-s', { email: 'rafa@usenorte.com.br', horas: 1, motivo: 'Só olhar agora', quem: 'Rafa' })
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    expect(s.acessos[0]!.suporteEdita).toBe(false)
    await expect(m.produto.editarProduto(s, 'p-blusa', { nome: 'Outra' })).rejects.toBeInstanceOf(SemPermissao)
    await expect(m.convite.convidar(s, { email: 'x@s.com', papel: 'BALCAO', unidadeId: 'uni-s1' }, 'http://x/loja-s')).rejects.toThrow()
  })

  it('vencido não edita, mesmo no modo edição', async () => {
    await m.operacao.concederSuporte('org-s', {
      email: 'rafa@usenorte.com.br', horas: 1, motivo: 'Arrumar de novo', quem: 'Rafa', edicao: true,
    })
    await db.query(`update acessos set expira_em = now() - interval '1 minute' where papel = 'SUPORTE'`)
    const s = await sessaoDoSuporte('rafa@usenorte.com.br')
    expect(s.acessos[0]!.suporteEdita).toBe(true)
    await expect(m.produto.editarProduto(s, 'p-blusa', { nome: 'Vencida' })).rejects.toBeInstanceOf(SemPermissao)
  })
})

describe('o nome no livro', () => {
  it('"Suporte do Norte (X)" e o nome dado ao conceder viram "Equipe Norte (...)"', () => {
    expect(m.pagina.nomeDoSuporteNoLivro('Suporte do Norte (Rafa)')).toBe('Equipe Norte (Rafa)')
    expect(m.pagina.nomeDoSuporteNoLivro('Rafa Lima')).toBe('Equipe Norte (Rafa Lima)')
    expect(m.pagina.nomeDoSuporteNoLivro('Equipe Norte (Rafa)')).toBe('Equipe Norte (Rafa)')
  })
})

describe('o pedido de respostas pela equipe', () => {
  it('atender põe o pacote e fecha o pedido; o livro tem o fato e o porquê', async () => {
    await db.query(
      `insert into auditoria (id, org_id, quem, acao, alvo_tipo, alvo_id, alvo_nome, depois, criado_em)
       values ('ped-r', 'org-s', 'Dona S', 'respostas.pediu', 'empresa', 'org-s', '+500 respostas', '{"respostas":500}', $1::timestamp)`,
      [new Date(Date.now() - 1000).toISOString()],
    )
    const aberto = m.pedidos.pedidoAberto(await m.pedidos.eventosDePedido('org-s'), 'respostas')
    expect(aberto?.id).toBe('ped-r')

    const r = await m.operacao.atenderPacoteDeRespostas('org-s', { motivo: 'Pix confirmado', quem: 'Rafa', pedidoId: 'ped-r' })
    expect(r.pacotes).toBe(1)
    expect(m.pedidos.pedidoAberto(await m.pedidos.eventosDePedido('org-s'), 'respostas')).toBeNull()
    const fato = await linhas<{ quem: string; autor: string }>(`select quem, autor from auditoria where acao = 'respostas.adicionou'`)
    expect(fato).toEqual([{ quem: 'Equipe Norte (Rafa)', autor: 'SISTEMA' }])
    const porque = await linhas<{ motivo: string }>(`select motivo from auditoria where acao = 'equipe.anotou'`)
    expect(porque.map((p) => p.motivo)).toContain('Pix confirmado')
  })

  it('recusar sem pedido de respostas aberto diz o tipo certo', async () => {
    await expect(m.operacao.recusarPedido('org-s', 'respostas', { motivo: 'Não pagou', quem: 'Rafa' })).rejects.toThrow(
      'Não há pedido de pacote de respostas aberto nesta empresa.',
    )
  })
})
