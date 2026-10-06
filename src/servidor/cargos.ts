// Cargos que a empresa cria: "Subgerente", "Caixa da fábrica", "Supervisora".
//
// Os papéis fixos (Gerente, Balcão, Financeiro) servem à maioria. Mas uma rede
// tem gente no meio do caminho — quem abre e fecha o caixa e confere o estoque,
// mas não mexe em preço; quem vê o financeiro da loja e não cancela venda. O
// dono cria o cargo, marca o que ele pode e dá o cargo a quem quiser, em uma
// loja ou em todas.
//
// ── as três travas ───────────────────────────────────────────
// 1. TETO DE GERENTE. A lista do que dá para marcar é `CAPACIDADES_DE_CARGO`:
//    o que o Gerente pode, menos montar a equipe. Marcar além disso não é
//    recusado na tela — é ignorado na hora de conferir (`concede`), então nem
//    um pedido forjado passa do teto.
// 2. FALHA FECHADA. O papel CARGO, sozinho, não pode nada (PODERES.CARGO é
//    vazio). O que ele pode vem do cargo, lido do banco a cada tela. Um caminho
//    que esqueça de ler o cargo deixa a pessoa sem poder, nunca com poder demais.
// 3. SÓ O DONO. Criar, mudar e apagar cargo é configurar a empresa; dar o cargo
//    a alguém segue a régua de `podeConcederAcesso` (só o dono concede CARGO).

import { comoOrg } from './banco'
import { CAPACIDADES_DE_CARGO, exigir, exigirQueNaoSejaSuporte, type Acesso, type Capacidade, type Papel, type Sessao } from './permissao'
import type { Modulo } from './modulos'

/** As caixas da tela, em grupos, com o nome que o dono entende. */
export const GRUPOS_DE_CARGO: {
  titulo: string
  /** Só aparece com o módulo ligado. */
  modulo?: Modulo
  itens: { capacidade: Capacidade; titulo: string }[]
}[] = [
  {
    titulo: 'Balcão e caixa',
    itens: [
      { capacidade: 'venda.criar', titulo: 'Vender no balcão' },
      { capacidade: 'venda.ver', titulo: 'Ver as vendas de hoje' },
      { capacidade: 'venda.historico', titulo: 'Ver as vendas de outros dias, com filtros' },
      { capacidade: 'venda.cancelar', titulo: 'Cancelar venda' },
      { capacidade: 'venda.desconto', titulo: 'Dar desconto acima do limite da empresa' },
      { capacidade: 'caixa.ver', titulo: 'Ver o caixa de hoje' },
      { capacidade: 'caixa.historico', titulo: 'Ver os turnos de outros dias e a diferença acumulada' },
      { capacidade: 'caixa.operar', titulo: 'Abrir, sangrar, suprir e fechar o caixa' },
    ],
  },
  {
    titulo: 'Produtos e estoque',
    itens: [
      { capacidade: 'produto.ver', titulo: 'Ver os produtos' },
      { capacidade: 'produto.cadastrar', titulo: 'Cadastrar produto novo' },
      { capacidade: 'produto.editar', titulo: 'Editar produto' },
      { capacidade: 'produto.preco', titulo: 'Mudar preço' },
      { capacidade: 'estoque.ver', titulo: 'Ver o estoque' },
      { capacidade: 'estoque.ajustar', titulo: 'Dar entrada, transferir e corrigir o estoque' },
      { capacidade: 'estoque.perda', titulo: 'Lançar avaria (tirar o que quebrou ou estragou, sem poder corrigir o estoque)' },
      { capacidade: 'estoque.consumir', titulo: 'Anotar o material usado' },
    ],
  },
  {
    titulo: 'Fábrica',
    modulo: 'fabrica',
    itens: [
      { capacidade: 'fabrica.ver', titulo: 'Ver a Fábrica (produção e pedidos)' },
      { capacidade: 'fabrica.pedir', titulo: 'Pedir à fábrica pela loja' },
    ],
  },
  {
    titulo: 'Compras',
    modulo: 'compras',
    itens: [
      { capacidade: 'compra.ver', titulo: 'Ver pedidos e fornecedores (com o custo)' },
      { capacidade: 'compra.gerir', titulo: 'Fazer, mandar e receber pedido de compra' },
    ],
  },
  {
    titulo: 'Clientes e crediário',
    itens: [
      { capacidade: 'cliente.ver', titulo: 'Ver os clientes' },
      { capacidade: 'cliente.editar', titulo: 'Cadastrar e editar cliente' },
      { capacidade: 'crediario.ver', titulo: 'Ver o crediário' },
      { capacidade: 'crediario.receber', titulo: 'Receber parcela' },
      { capacidade: 'crediario.cobrar', titulo: 'Cobrar e negociar' },
    ],
  },
  {
    titulo: 'Agenda',
    modulo: 'agenda',
    itens: [
      { capacidade: 'agenda.ver', titulo: 'Ver a agenda de todos' },
      { capacidade: 'agenda.marcar', titulo: 'Marcar, remarcar e desmarcar' },
    ],
  },
  {
    titulo: 'Ponto',
    modulo: 'ponto',
    itens: [
      { capacidade: 'ponto.proprio', titulo: 'Bater o próprio ponto' },
      { capacidade: 'ponto.ver', titulo: 'Ver as horas de todos' },
      { capacidade: 'ponto.gerir', titulo: 'Bater por outra pessoa e corrigir' },
    ],
  },
  {
    titulo: 'Escola',
    modulo: 'escola',
    itens: [
      { capacidade: 'escola.ver', titulo: 'Ver turmas e alunos' },
      { capacidade: 'escola.matricular', titulo: 'Matricular e anotar o responsável' },
      { capacidade: 'escola.gerir', titulo: 'Criar turma, mudar valor, dar bolsa' },
      { capacidade: 'mensalidade.ver', titulo: 'Ver as mensalidades' },
      { capacidade: 'mensalidade.receber', titulo: 'Receber mensalidade' },
      { capacidade: 'mensalidade.ajustar', titulo: 'Dispensar a mensalidade de um mês' },
    ],
  },
  {
    titulo: 'Dinheiro e relatórios',
    itens: [
      { capacidade: 'relatorio.ver', titulo: 'Ver o painel e os relatórios' },
      { capacidade: 'financeiro.ver', titulo: 'Ver o financeiro (sem lançar)' },
    ],
  },
  {
    titulo: 'Equipe',
    itens: [
      { capacidade: 'equipe.ver', titulo: 'Ver a equipe' },
      { capacidade: 'tarefa.ver', titulo: 'Ver o quadro e fazer as próprias tarefas' },
      { capacidade: 'tarefa.gerir', titulo: 'Criar e distribuir tarefas' },
      { capacidade: 'auditoria.ver', titulo: 'Ver o livro de auditoria' },
    ],
  },
]

/**
 * Pontos de partida para não começar do zero. "Subgerente" é o pedido mais
 * comum: toca a loja, mas preço, cancelamento e desconto ficam com a gerente.
 */
export const MODELOS_DE_CARGO: { nome: string; capacidades: Capacidade[] }[] = [
  {
    nome: 'Subgerente',
    capacidades: [
      'venda.criar', 'venda.ver', 'venda.historico', 'caixa.ver', 'caixa.operar', 'caixa.historico',
      'produto.ver', 'estoque.ver', 'estoque.ajustar', 'estoque.consumir', 'fabrica.ver', 'fabrica.pedir',
      'cliente.ver', 'cliente.editar', 'crediario.ver', 'crediario.receber',
      'ponto.proprio', 'agenda.ver', 'agenda.marcar',
      'relatorio.ver', 'equipe.ver', 'tarefa.ver', 'tarefa.gerir',
    ],
  },
  {
    // O balcão de sempre, mais a avaria: vende, abre o caixa e tira do estoque o
    // que quebrou — sem dar entrada, transferir nem corrigir o saldo.
    nome: 'Atendente com avaria',
    capacidades: [
      'venda.criar', 'venda.ver', 'caixa.ver', 'caixa.operar',
      'produto.ver', 'estoque.ver', 'estoque.perda',
      'cliente.ver', 'cliente.editar', 'crediario.ver', 'crediario.receber',
      'tarefa.ver',
    ],
  },
  {
    nome: 'Estoquista',
    capacidades: ['produto.ver', 'produto.cadastrar', 'estoque.ver', 'estoque.ajustar', 'estoque.consumir', 'fabrica.ver', 'fabrica.pedir', 'compra.ver', 'compra.gerir', 'ponto.proprio', 'tarefa.ver'],
  },
]

/** Só o que um cargo pode ter, sem repetir, na ordem da tela. */
export function limparCapacidades(lista: readonly string[]): Capacidade[] {
  const pedidas = new Set(lista)
  return CAPACIDADES_DE_CARGO.filter((c) => pedidas.has(c))
}

export const NOME_DO_CARGO_MAX = 40

// ─────────────────────────────────────────────────────────────
// LER OS ACESSOS JUNTO COM O CARGO
// ─────────────────────────────────────────────────────────────
//
// Todo lugar que monta uma Sessao a partir do banco (o assistente, o PIN da
// gerente, "quem vendeu") lê o acesso com isto — senão o cargo chega sem
// capacidades e a pessoa não pode nada ali (falha fechada, mas errada).

export const SELECT_ACESSO = {
  papel: true,
  unidadeId: true,
  expiraEm: true,
  cargo: { select: { capacidades: true } },
} as const

type LinhaDeAcesso = {
  papel: string
  unidadeId: string | null
  expiraEm: Date | null
  cargo?: { capacidades: string[] } | null
}

export function acessosDoBanco(linhas: readonly LinhaDeAcesso[]): Acesso[] {
  return linhas.map((a) => ({
    papel: a.papel as Papel,
    unidadeId: a.unidadeId,
    expiraEm: a.expiraEm,
    ...(a.papel === 'CARGO' ? { capacidades: a.cargo?.capacidades ?? [] } : {}),
  }))
}

// ─────────────────────────────────────────────────────────────
// CRIAR, MUDAR, APAGAR
// ─────────────────────────────────────────────────────────────

export type CargoNaTela = { id: string; nome: string; capacidades: Capacidade[]; pessoas: number; convites: number }

export async function listarCargos(sessao: Sessao): Promise<CargoNaTela[]> {
  exigir(sessao, 'equipe.ver')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.cargo.findMany({
      orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, capacidades: true,
        _count: { select: { acessos: true, convites: { where: { aceitoEm: null } } } },
      },
    }),
  )
  return linhas.map((c) => ({
    id: c.id,
    nome: c.nome,
    capacidades: limparCapacidades(c.capacidades),
    pessoas: c._count.acessos,
    convites: c._count.convites,
  }))
}

export type ResultadoCargo = { ok: true; id: string } | { ok: false; motivo: string }

export async function salvarCargo(
  sessao: Sessao,
  dados: { id?: string | null; nome: string; capacidades: readonly string[] },
): Promise<ResultadoCargo> {
  exigir(sessao, 'empresa.configurar')
  // Cargo é o desenho de quem pode o quê: mexer nele é dar poder a alguém.
  exigirQueNaoSejaSuporte(sessao, 'cria nem muda cargo')
  const nome = String(dados.nome ?? '').replace(/\s+/g, ' ').trim()
  if (nome.length < 2) return { ok: false, motivo: 'Dê um nome ao cargo.' }
  if (nome.length > NOME_DO_CARGO_MAX) return { ok: false, motivo: `Nome longo demais: até ${NOME_DO_CARGO_MAX} letras.` }
  const capacidades = limparCapacidades(dados.capacidades)
  if (capacidades.length === 0) return { ok: false, motivo: 'Marque pelo menos uma coisa que este cargo pode fazer.' }

  return comoOrg(sessao.orgId, async (db): Promise<ResultadoCargo> => {
    const mesmoNome = await db.cargo.findFirst({
      where: { nome: { equals: nome, mode: 'insensitive' }, ...(dados.id ? { id: { not: dados.id } } : {}) },
      select: { id: true },
    })
    if (mesmoNome) return { ok: false, motivo: `Já existe um cargo chamado "${nome}".` }

    if (dados.id) {
      const antes = await db.cargo.findUnique({ where: { id: dados.id }, select: { nome: true, capacidades: true } })
      if (!antes) return { ok: false, motivo: 'Cargo não encontrado nesta empresa.' }
      await db.cargo.update({ where: { id: dados.id }, data: { nome, capacidades } })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
          acao: 'equipe.cargo.alterou', alvoTipo: 'cargo', alvoId: dados.id, alvoNome: nome,
          antes: { nome: antes.nome, capacidades: antes.capacidades }, depois: { nome, capacidades },
        },
      })
      return { ok: true, id: dados.id }
    }

    const criado = await db.cargo.create({ data: { orgId: sessao.orgId, nome, capacidades }, select: { id: true } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'equipe.cargo.criou', alvoTipo: 'cargo', alvoId: criado.id, alvoNome: nome, depois: { nome, capacidades },
      },
    })
    return { ok: true, id: criado.id }
  })
}

export async function apagarCargo(sessao: Sessao, id: string): Promise<ResultadoCargo> {
  exigir(sessao, 'empresa.configurar')
  exigirQueNaoSejaSuporte(sessao, 'apaga cargo')
  return comoOrg(sessao.orgId, async (db): Promise<ResultadoCargo> => {
    const c = await db.cargo.findUnique({
      where: { id },
      select: { nome: true, _count: { select: { acessos: true, convites: { where: { aceitoEm: null } } } } },
    })
    if (!c) return { ok: false, motivo: 'Cargo não encontrado nesta empresa.' }
    if (c._count.acessos > 0) {
      return { ok: false, motivo: `Ainda há ${c._count.acessos === 1 ? '1 pessoa' : `${c._count.acessos} pessoas`} com o cargo "${c.nome}". Mude o acesso delas antes.` }
    }
    // Convite em aberto com este cargo: some junto (o link para de valer).
    await db.convite.deleteMany({ where: { cargoId: id, aceitoEm: null } })
    // Convite já aceito guarda o cargo só como história: solta o vínculo.
    await db.convite.updateMany({ where: { cargoId: id }, data: { cargoId: null } })
    await db.cargo.delete({ where: { id } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: 'equipe.cargo.apagou', alvoTipo: 'cargo', alvoId: id, alvoNome: c.nome,
      },
    })
    return { ok: true, id }
  })
}
