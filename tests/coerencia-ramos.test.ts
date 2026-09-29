// As incoerências por ramo que as empresas de demonstração mostraram
// (scripts/demonstracoes.ts), com banco de verdade — PGlite exposto numa
// porta, como em regras-servidor.test.ts.
//
// O que está provado aqui:
//   • MATERIAL DE USO (a luva, a acetona): não se vende — a venda recusa no
//     servidor e o balcão não o oferece —, não é "parado" (painel, análise,
//     comparação de lojas), e o ritmo dele na previsão é o CONSUMO; o estoque
//     e o "acabou" continuam valendo para ele
//   • FEITO NO DIA (o pão): zerado depois de fechar não é "acabou", não entra
//     na previsão de compra, e a "Produção do dia" do painel é só dele
//   • o modelo de abertura tem as tarefas do ramo (a clínica não repõe arara)
//   • a Recepção, a Secretaria e "Serviços e materiais": menu, guia e busca
//   • a escola: mensalidade atrasada no "Precisa de você" de quem recebe, e o
//     professor da unidade escolhida no formulário da turma

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'
import { saldoNaVista } from '../src/servidor/produto'
import { aVendaNaLoja } from '../src/servidor/catalogo-loja'
import { GAVETAS_MARCADAS, RAMOS, marcasDaGaveta } from '../src/servidor/modulos'
import { MODELOS, jeitoDoRamo, modeloPara } from '../src/servidor/tarefas'
import { nomesNoGuia, vocabularioDoRamo } from '../src/servidor/vocabulario'
import { GUIA, buscarNoGuia, manualComoTexto, tituloDaTela } from '../src/servidor/guia'
import { montarPendencias } from '../src/servidor/pendencias'
import { professoresDaUnidadeEscolhida } from '../src/app/[empresa]/turmas/professores'
import { janela } from '../src/servidor/periodo'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  venda: typeof import('../src/servidor/venda')
  painel: typeof import('../src/servidor/painel')
  relatorios: typeof import('../src/servidor/relatorios')
  ruptura: typeof import('../src/servidor/ruptura')
  pendencias: typeof import('../src/servidor/pendencias')
  nicho: typeof import('../src/servidor/nicho')
  tarefas: typeof import('../src/servidor/tarefas')
  escola: typeof import('../src/servidor/escola')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (orgId: string, usuarioId: string, papel: Papel, unidadeId: string | null = null): Sessao => ({
  orgId,
  usuarioId,
  nome: usuarioId,
  acessos: [{ papel, unidadeId, expiraEm: null }],
})
const CLINICA = sessao('org-c', 'usr-c', 'DONO')
const PADARIA = sessao('org-p', 'usr-p', 'DONO')
const ESCOLA = sessao('org-e', 'usr-e', 'DONO')
const SECRETARIA = sessao('org-e', 'usr-sec', 'BALCAO', 'e-1')
const CONTADOR = sessao('org-e', 'usr-cont', 'CONTADOR')

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, ramo, modulos, atualizada_em, configurada_em) values
    ('org-c', 'Clínica', 'clinica', 'REDE', 'ATIVA', 'saude', '{agenda,compras}', now(), now()),
    ('org-p', 'Padaria', 'padaria', 'REDE', 'ATIVA', 'padaria', '{encomenda}', now(), now()),
    ('org-e', 'Escola', 'escola', 'REDE', 'ATIVA', 'escola', '{escola,ponto,multiUnidade}', now(), now());

  insert into unidades (id, org_id, nome, eh_deposito, atualizada_em) values
    ('c-1', 'org-c', 'Clínica', false, now()),
    ('p-1', 'org-p', 'Padaria', false, now()),
    ('e-1', 'org-e', 'Sede', false, now()),
    ('e-2', 'org-e', 'Unidade Norte', false, now());

  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-c', 'org-c', 'Dona', 'dona@c.com', now()),
    ('usr-p', 'org-p', 'Dono', 'dono@p.com', now()),
    ('usr-e', 'org-e', 'Diretora', 'dir@e.com', now()),
    ('usr-sec', 'org-e', 'Secretaria', 'sec@e.com', now()),
    ('usr-cont', 'org-e', 'Contador', 'cont@e.com', now());

  -- A clínica: uma consulta (serviço), a luva (material de uso, com consumo)
  -- e a gaze (material de uso, zerada: "acabou" continua valendo).
  insert into produtos (id, org_id, nome, medida, custo, preco_vista, servico, uso_interno, prazo_reposicao_dias, atualizado_em) values
    ('c-cons', 'org-c', 'Consulta', 'UN', null, 200, true, false, null, now()),
    ('c-luva', 'org-c', 'Luva (caixa)', 'UN', 30, 39.9, false, true, 5, now()),
    ('c-gaze', 'org-c', 'Gaze (pacote)', 'UN', 5, 8.9, false, true, 5, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-cons', 'org-c', 'c-cons', 'CONS', true),
    ('v-luva', 'org-c', 'c-luva', 'LUVA', true),
    ('v-gaze', 'org-c', 'c-gaze', 'GAZE', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, minimo, atualizado_em) values
    ('es-luva', 'org-c', 'v-luva', 'c-1', 10, 4, now()),
    ('es-gaze', 'org-c', 'v-gaze', 'c-1', 0, 20, now());
  -- Três caixas de luva gastas nas últimas semanas: é o ritmo dela.
  insert into movimentos_estoque (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, quem, criado_em) values
    ('mv-1', 'org-c', 'v-luva', 'c-1', 'CONSUMO', -3, 10, 'Recepção', now() - interval '5 days'),
    ('mv-2', 'org-c', 'v-luva', 'c-1', 'CONSUMO', -2, 13, 'Recepção', now() - interval '12 days'),
    ('mv-3', 'org-c', 'v-gaze', 'c-1', 'CONSUMO', -8, 0, 'Recepção', now() - interval '2 days');
  insert into caixas (id, org_id, unidade_id, aberto_por, saldo_abertura) values
    ('cx-c', 'org-c', 'c-1', 'Recepção', 100);

  -- A padaria: o pão (feito no dia, zerado depois de fechar) e o
  -- refrigerante (revenda, zerado de verdade).
  insert into produtos (id, org_id, nome, medida, custo, preco_vista, feito_no_dia, atualizado_em) values
    ('p-pao', 'org-p', 'Pão francês', 'KG', 6, 16.9, true, now()),
    ('p-refri', 'org-p', 'Refrigerante lata', 'UN', 2.8, 5.5, false, now());
  insert into variacoes (id, org_id, produto_id, codigo, padrao) values
    ('v-pao', 'org-p', 'p-pao', 'PAO', true),
    ('v-refri', 'org-p', 'p-refri', 'REF', true);
  insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, atualizado_em) values
    ('es-pao', 'org-p', 'v-pao', 'p-1', 0, now()),
    ('es-refri', 'org-p', 'v-refri', 'p-1', 0, now());
  -- Venderam os dois na mesma quarta (ou o dia que for) da semana passada.
  insert into vendas (id, org_id, unidade_id, numero, situacao, total, criada_em) values
    ('vd-p', 'org-p', 'p-1', 1, 'CONCLUIDA', 22.40, now() - interval '7 days');
  insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, medida, quantidade, preco_unit, total) values
    ('vi-pao', 'org-p', 'vd-p', 'v-pao', 'Pão francês', 'KG', 1, 16.90, 16.90),
    ('vi-refri', 'org-p', 'vd-p', 'v-refri', 'Refrigerante lata', 'UN', 1, 5.50, 5.50);

  -- A escola: duas unidades, um professor em cada, um que roda as duas, e
  -- mensalidades — uma atrasada, uma que vence daqui a 10 dias.
  insert into colaboradores (id, org_id, unidade_id, nome, cargo, atualizado_em) values
    ('prof-sede', 'org-e', 'e-1', 'Carla', 'Inglês', now()),
    ('prof-norte', 'org-e', 'e-2', 'Otávio', 'Robótica', now()),
    ('prof-todas', 'org-e', null, 'Lia', 'Ballet', now());
  insert into clientes (id, org_id, nome, atualizado_em) values
    ('al-1', 'org-e', 'Pedro', now()),
    ('al-2', 'org-e', 'Luísa', now());
  insert into turmas (id, org_id, unidade_id, nome, mensalidade, dia_vencimento, atualizada_em) values
    ('tu-1', 'org-e', 'e-1', 'Inglês Kids', 320, 10, now());
  insert into matriculas (id, org_id, aluno_id, turma_id, unidade_id, inicio, valor, dia_vencimento, quem, atualizada_em) values
    ('ma-1', 'org-e', 'al-1', 'tu-1', 'e-1', current_date - 60, 320, 10, 'Diretora', now()),
    ('ma-2', 'org-e', 'al-2', 'tu-1', 'e-1', current_date - 60, 320, 10, 'Diretora', now());
  insert into mensalidades (id, org_id, matricula_id, aluno_id, unidade_id, mes, vencimento, valor, desconto, pago, atualizada_em) values
    ('me-1', 'org-e', 'ma-1', 'al-1', 'e-1', to_char(current_date - 20, 'YYYY-MM'), current_date - 20, 320, 32, 100, now()),
    ('me-2', 'org-e', 'ma-2', 'al-2', 'e-1', to_char(current_date + 10, 'YYYY-MM'), current_date + 10, 320, 0, 0, now());
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 55500 + Math.floor(Math.random() * 2500)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    venda: await import('../src/servidor/venda'),
    painel: await import('../src/servidor/painel'),
    relatorios: await import('../src/servidor/relatorios'),
    ruptura: await import('../src/servidor/ruptura'),
    pendencias: await import('../src/servidor/pendencias'),
    nicho: await import('../src/servidor/nicho'),
    tarefas: await import('../src/servidor/tarefas'),
    escola: await import('../src/servidor/escola'),
    banco: await import('../src/servidor/banco'),
  }
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

// ─────────────────────────────────────────────────────────────
// 1. MATERIAL DE USO
// ─────────────────────────────────────────────────────────────

describe('material de uso — não vende, não é parado, conta estoque', () => {
  it('a venda recusa no servidor, com o nome do item', async () => {
    const r = await m.venda.registrarVenda(CLINICA, {
      unidadeId: 'c-1',
      itens: [{ variacaoId: 'v-luva', quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 39.9 }],
    })
    expect(r).toMatchObject({ ok: false, motivo: 'uso_interno', itens: ['Luva (caixa)'] })
    // E nada saiu do estoque.
    const [e] = (await db.query<{ q: string }>(`select quantidade::text as q from estoque where id = 'es-luva'`)).rows
    expect(Number(e!.q)).toBe(10)
  })

  it('o balcão não oferece: o filtro da loja tira o material (grade, busca e vitrine usam o mesmo)', async () => {
    expect(aVendaNaLoja('c-1')).toMatchObject({ usoInterno: false })
    const achados = await m.banco.comoOrg('org-c', (tx) =>
      tx.variacao.findMany({ where: { ativa: true, produto: { ativo: true, ...aVendaNaLoja('c-1') } }, select: { id: true } }),
    )
    expect(achados.map((a) => a.id)).toEqual(['v-cons'])
  })

  it('não é "parado" no painel, na análise nem na comparação de lojas', async () => {
    const r = await m.painel.resumoDoPainel(CLINICA, ['c-1'], janela('30d'))
    expect(r.parados).toEqual([])
    expect(await m.relatorios.dinheiroParado(CLINICA, ['c-1'])).toEqual([])
    const lojas = await m.relatorios.compararLojas(CLINICA, ['c-1'], new Date(Date.now() - 30 * 864e5), new Date())
    expect(lojas[0]!.parado).toBe(0)
  })

  it('na previsão, o ritmo é o consumo — não "sem giro"; e zerado é "já faltou"', async () => {
    const linhas = await m.ruptura.previsaoDeRuptura(CLINICA, ['c-1'])
    const luva = linhas.find((l) => l.variacaoId === 'v-luva')!
    expect(luva.usoInterno).toBe(true)
    expect(luva.vendidos30).toBe(5)
    expect(luva.previsao.situacao).not.toBe('sem_giro')
    expect(linhas.find((l) => l.variacaoId === 'v-gaze')!.previsao.situacao).toBe('ja_faltou')
  })

  it('o alarme de estoque continua: a gaze zerada é "acabou" no Precisa de você', async () => {
    const c = await m.pendencias.pendenciasDoDia(CLINICA, { modulos: ['agenda', 'compras'] }, ['c-1'])
    expect(c.acabaram).toBe(1)
  })

  it('a gaveta de material do ramo já traz a ficha marcada', () => {
    expect(marcasDaGaveta(['saude'], 'Insumos')).toEqual({ usoInterno: true, feitoNoDia: false })
    expect(marcasDaGaveta(['beleza'], 'material de uso')).toEqual({ usoInterno: true, feitoNoDia: false })
    expect(marcasDaGaveta(['beleza'], 'Unhas')).toEqual({ usoInterno: false, feitoNoDia: false })
    // A loja de roupa não tem gaveta de material: nada vem marcado.
    expect(marcasDaGaveta(['roupa', null], 'Insumos')).toEqual({ usoInterno: false, feitoNoDia: false })
    // Toda gaveta marcada existe no RAMOS do próprio ramo — senão o padrão nunca aparece.
    for (const [ramo, g] of Object.entries(GAVETAS_MARCADAS)) {
      for (const nome of [...(g.usoInterno ?? []), ...(g.feitoNoDia ?? [])]) {
        expect(RAMOS[ramo as keyof typeof RAMOS].categorias as readonly string[]).toContain(nome)
      }
    }
  })
})

describe('os ramos semeados', () => {
  it('o salão não tem mais a gaveta "Serviços" vazia ao lado de Unhas e Cabelo', () => {
    expect(RAMOS.beleza.categorias).not.toContain('Serviços')
    expect(RAMOS.beleza.categorias).toEqual(expect.arrayContaining(['Unhas', 'Cabelo', 'Estética', 'Material de uso']))
  })

  it('o pet shop sugere agenda (banho e tosa) e compras, com a gaveta de banho e tosa', () => {
    expect(RAMOS.petshop.sugere).toEqual(expect.arrayContaining(['agenda', 'compras']))
    expect(RAMOS.petshop.categorias).toContain('Banho e tosa')
  })
})

// ─────────────────────────────────────────────────────────────
// 2. FEITO NO DIA
// ─────────────────────────────────────────────────────────────

describe('feito no dia — zerado depois de fechar não é falta', () => {
  it('a conta de Produtos e Estoque: zerado e feito no dia é neutro, não "acabou"', () => {
    const lojas = [{ id: 'p-1', ehDeposito: false }]
    const linhas = [{ unidadeId: 'p-1', quantidade: 0, minimo: null }]
    expect(saldoNaVista([], linhas, lojas, false, true)).toMatchObject({ nivel: 'bom', doDia: true, saldo: 0 })
    expect(saldoNaVista([], linhas, lojas, false, false)).toMatchObject({ nivel: 'critico' })
    // Com saldo, é um produto como outro qualquer.
    expect(saldoNaVista([], [{ unidadeId: 'p-1', quantidade: 3, minimo: null }], lojas, false, true).doDia).toBeUndefined()
  })

  it('"Precisa de você" conta só o refrigerante — o pão zerado é o dia normal', async () => {
    const c = await m.pendencias.pendenciasDoDia(PADARIA, { modulos: ['encomenda'] }, ['p-1'])
    expect(c.acabaram).toBe(1)
  })

  it('não entra na previsão de compra (não se compra pão de fornecedor)', async () => {
    const linhas = await m.ruptura.previsaoDeRuptura(PADARIA, ['p-1'])
    expect(linhas.map((l) => l.variacaoId)).toEqual(['v-refri'])
  })

  it('a "Produção do dia" do painel é só o que é feito no dia', async () => {
    const [bloco] = await m.nicho.nichoDoPainel(PADARIA, { modulos: ['encomenda'] }, ['p-1'])
    expect(bloco!.familia).toBe('producao')
    if (bloco!.familia !== 'producao') return
    expect(bloco!.dados.producao.map((i) => i.rotulo)).toEqual(['Pão francês'])
  })

  it('as gavetas do pão já trazem "feito no dia" na padaria e na lanchonete', () => {
    expect(marcasDaGaveta(['padaria'], 'Pães').feitoNoDia).toBe(true)
    expect(marcasDaGaveta(['padaria'], 'Bebidas').feitoNoDia).toBe(false)
    expect(marcasDaGaveta(['lanchonete'], 'Lanches').feitoNoDia).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 3. O MODELO DE TAREFAS DO RAMO
// ─────────────────────────────────────────────────────────────

describe('o modelo de abertura tem a cara do negócio', () => {
  const tarefas = (ramo: string | null) => modeloPara('abertura', ramo).tarefas.map((t) => t.titulo).join(' | ')

  it('só o varejo repõe arara', () => {
    expect(tarefas('roupa')).toMatch(/araras/)
    for (const ramo of ['saude', 'beleza', 'padaria', 'sorveteria', 'escola']) expect(tarefas(ramo)).not.toMatch(/arara/)
  })

  it('cada jeito tem o que é dele', () => {
    expect(jeitoDoRamo('padaria')).toBe('comida')
    expect(jeitoDoRamo('toString')).toBe('varejo')
    expect(tarefas('padaria')).toMatch(/sobra do dia/)
    expect(tarefas('beleza')).toMatch(/alicates/)
    expect(tarefas('saude')).toMatch(/lixo infectante/)
    expect(tarefas('escola')).toMatch(/buscado/)
    expect(modeloPara('abertura', 'saude').titulo).toBe('Abertura e fechamento da clínica')
    // Modelo sem variante continua o de sempre.
    expect(modeloPara('campanha', 'saude')).toBe(MODELOS.campanha)
    // O fechamento de caixa é de todo mundo.
    for (const r of ['roupa', 'padaria', 'beleza', 'saude', 'escola']) expect(tarefas(r)).toMatch(/Fechar o caixa/)
  })

  it('o quadro criado pela tela nasce com as tarefas do ramo da empresa', async () => {
    const q = await m.tarefas.criarDeModelo(CLINICA, 'abertura', 'c-1')
    const linhas = (await db.query<{ titulo: string }>(`select titulo from tarefas where quadro_id = $1`, [q.id])).rows.map((r) => r.titulo)
    expect(linhas.join(' | ')).toMatch(/maca/)
    expect(linhas.join(' | ')).not.toMatch(/arara/)
    const [quadro] = (await db.query<{ nome: string }>(`select nome from quadros where id = $1`, [q.id])).rows
    expect(quadro!.nome).toBe('Abertura e fechamento da clínica')
  })
})

// ─────────────────────────────────────────────────────────────
// 6. AS PALAVRAS DAS TELAS
// ─────────────────────────────────────────────────────────────

describe('Recepção, Secretaria e "Serviços e materiais"', () => {
  it('o vocabulário do ramo', () => {
    expect(vocabularioDoRamo('saude')).toMatchObject({ Balcao: 'Recepção', Produtos: 'Serviços e materiais', Pessoas: 'Pacientes' })
    expect(vocabularioDoRamo('beleza')).toMatchObject({ Balcao: 'Recepção', Pessoas: 'Clientes' })
    expect(vocabularioDoRamo('escola')).toMatchObject({ Balcao: 'Secretaria', Produtos: 'Produtos', Pessoas: 'Alunos' })
    expect(vocabularioDoRamo('roupa')).toMatchObject({ Balcao: 'Balcão', Produtos: 'Produtos' })
    expect(vocabularioDoRamo('toString')).toMatchObject({ Balcao: 'Balcão' })
  })

  it('o guia usa o nome do menu: título, busca e manual', () => {
    const nomes = nomesNoGuia(vocabularioDoRamo('saude'))
    expect(nomes).toEqual({ balcao: 'Recepção', produtos: 'Serviços e materiais', clientes: 'Pacientes' })
    expect(nomesNoGuia(vocabularioDoRamo('roupa'))).toEqual({})

    const balcao = GUIA.find((e) => e.chave === 'balcao')!
    expect(tituloDaTela(balcao, { nomes })).toBe('Recepção')
    expect(tituloDaTela(balcao, null)).toBe('Balcão')

    const quem = { capacidades: ['venda.criar', 'produto.ver', 'cliente.ver'] as const, modulos: [], nomes }
    const achados = buscarNoGuia('recepção', undefined, quem)
    expect(achados[0]).toMatchObject({ titulo: 'Recepção' })
    expect(achados[0]!.entrada.chave).toBe('balcao')

    const texto = manualComoTexto(nomes)
    expect(texto).toContain('"Balcão" aparece como "Recepção"')
    expect(texto).toContain('## Recepção (no manual, Balcão)')
    expect(manualComoTexto()).not.toContain('outro nome no menu')
  })
})

// ─────────────────────────────────────────────────────────────
// 7. A ESCOLA
// ─────────────────────────────────────────────────────────────

describe('a escola no "Precisa de você" e no formulário da turma', () => {
  it('mensalidade atrasada chama quem RECEBE (a dona, a secretaria) — não o contador', async () => {
    const empresa = { modulos: ['escola', 'ponto', 'multiUnidade'] }
    const dona = await m.pendencias.pendenciasDoDia(ESCOLA, empresa, ['e-1', 'e-2'])
    // 320 − 32 de bolsa − 100 já pagos = 188 em atraso; a de daqui a 10 dias não entra.
    expect(dona.mensalidadesAtrasadas).toEqual({ quantas: 1, valor: 188, alunos: 1 })
    const cont = await m.pendencias.pendenciasDoDia(CONTADOR, empresa, ['e-1', 'e-2'])
    expect(cont.mensalidadesAtrasadas).toBeUndefined()
    // Sem o módulo ligado, o assunto nem é lido.
    const sem = await m.pendencias.pendenciasDoDia(ESCOLA, { modulos: [] }, ['e-1', 'e-2'])
    expect(sem.mensalidadesAtrasadas).toBeUndefined()
  })

  it('a frase e o link para a lista de atraso', () => {
    const [p] = montarPendencias({ mensalidadesAtrasadas: { quantas: 3, valor: 960, alunos: 2 } }, 'escola', 'e-1')
    expect(p).toMatchObject({ chave: 'mensalidadesAtrasadas', nivel: 'critico', frase: '3 mensalidades em atraso' })
    expect(p!.detalhe).toMatch(/de 2 alunos/)
    expect(p!.href).toBe('/escola/mensalidades?situacao=atrasada&unidade=e-1')
    expect(montarPendencias({ mensalidadesAtrasadas: { quantas: 1, valor: 188, alunos: 1 } }, 'x')[0]!.frase).toBe('1 mensalidade em atraso')
  })

  it('o formulário mostra os professores da unidade ESCOLHIDA, não os da primeira', async () => {
    const todos = await m.escola.professoresDasUnidades(ESCOLA, ['e-1', 'e-2'])
    expect(todos.map((p) => p.nome).sort()).toEqual(['Carla', 'Lia', 'Otávio'])
    const nomes = (u: string) => professoresDaUnidadeEscolhida(todos, u).map((p) => p.nome).sort()
    expect(nomes('e-1')).toEqual(['Carla', 'Lia'])
    expect(nomes('e-2')).toEqual(['Lia', 'Otávio'])
    expect(professoresDaUnidadeEscolhida(todos, '')).toEqual([])
    // Quem não gere a escola não recebe a lista.
    expect(await m.escola.professoresDasUnidades(SECRETARIA, ['e-1', 'e-2'])).toEqual([])
  })
})
